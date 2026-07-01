import { createContext, useContext, useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { registerSocioPush, unregisterSocioPush } from '../lib/webPush'
import { isNativePlatform } from '../lib/capacitor'
import { registerSocioPushNative, unregisterSocioPushNative } from '../lib/pushNative'
import { stopTracking } from '../lib/riderGeo'
import { riderOffline } from '../lib/riderApi'

const SocioContext = createContext(null)

const MAX_NUEVOS = 20

export function SocioProvider({ children }) {
  const [session, setSession] = useState(null)
  const [user, setUser] = useState(null)
  const [socio, setSocio] = useState(null)
  const [loading, setLoading] = useState(true)
  const [authError, setAuthError] = useState(null)
  const [pushToast, setPushToast] = useState(null) // { type, message }
  const [pedidosNuevosSocio, setPedidosNuevosSocio] = useState([])

  const realtimeChannelRef = useRef(null)
  const pushRegisteredRef = useRef(false)
  const userIdRef = useRef(null)   // último user.id conocido (para detectar cambio real de usuario)

  const fetchSocio = useCallback(async (uid) => {
    if (!uid) { setSocio(null); return }
    const { data, error } = await supabase
      .from('socios')
      .select('*')
      .eq('user_id', uid)
      .maybeSingle()
    if (error) {
      // Error de red / 5xx (NO "fila inexistente": maybeSingle devuelve data=null sin
      // error cuando no hay socio). Un fallo transitorio NO debe borrar el socio ya
      // cargado, porque App.jsx interpretaría !socio como "no dado de alta" y mandaría
      // a un socio veterano a la pantalla de Onboarding (con riesgo de sobrescribir).
      console.error('[SocioContext] error fetch socio', error)
      return
    }
    setSocio(data || null)
  }, [])

  const refreshSocio = useCallback(async () => {
    if (user?.id) await fetchSocio(user.id)
  }, [user, fetchSocio])

  // Auth bootstrap
  useEffect(() => {
    let mounted = true
    ;(async () => {
      const { data } = await supabase.auth.getSession()
      if (!mounted) return
      setSession(data.session)
      setUser(data.session?.user || null)
      userIdRef.current = data.session?.user?.id || null
      if (data.session?.user) await fetchSocio(data.session.user.id)
      setLoading(false)
    })()

    const { data: listener } = supabase.auth.onAuthStateChange((evt, newSession) => {
      const prevUserId = userIdRef.current
      const newUserId = newSession?.user?.id || null
      setSession(newSession)
      setUser(newSession?.user || null)
      userIdRef.current = newUserId
      if (newSession?.user) {
        // supabase-js re-emite SIGNED_IN/TOKEN_REFRESHED al recuperar el foco de la
        // app/pestaña. Solo mostramos "Cargando…" (loading=true, que desmonta toda la
        // UI) cuando cambia el USUARIO; si es el mismo usuario que ya vuelve, no
        // desmontamos ni bloqueamos — solo refrescamos el socio en segundo plano.
        const isNewUser = newUserId !== prevUserId
        if (isNewUser) setLoading(true)
        // Solo (re)cargamos el socio cuando cambia el usuario o es un login/arranque
        // real. En TOKEN_REFRESHED (cada ~hora y al recuperar el foco) NO refetcheamos:
        // el socio no cambia y su refetch reemplazaba el objeto → disparaba las queries
        // de Dashboard/Pedidos que dependen de él. Para cambios explícitos existe
        // refreshSocio() (se llama tras online/offline y tras editar el perfil).
        if (isNewUser || evt === 'SIGNED_IN' || evt === 'INITIAL_SESSION') {
          fetchSocio(newSession.user.id).finally(() => { if (isNewUser) setLoading(false) })
        }
        if (evt === 'SIGNED_IN' || evt === 'INITIAL_SESSION' || evt === 'TOKEN_REFRESHED') {
          maybeRegisterPush(newSession.user.id)
        }
      } else {
        setSocio(null)
      }
    })

    return () => {
      mounted = false
      listener?.subscription?.unsubscribe?.()
    }
  }, [fetchSocio])

  // Registrar push una vez por sesión. En nativo usa FCM, en web usa VAPID.
  async function maybeRegisterPush(uid) {
    if (pushRegisteredRef.current) return
    // Marcamos "en curso" para evitar registros concurrentes, pero solo lo dejamos
    // fijado si el registro tiene ÉXITO (o el permiso fue denegado, caso terminal).
    // Antes se marcaba siempre: un fallo transitorio (timeout de 5s, red lenta en el
    // primer arranque) dejaba al rider sin push toda la sesión (fallback crítico si
    // el realtime se cae). Ahora un fallo recuperable permite reintentar.
    pushRegisteredRef.current = true
    const markFailed = () => { pushRegisteredRef.current = false }
    const native = await isNativePlatform()
    if (native) {
      const res = await registerSocioPushNative(uid)
      if (!res.ok) {
        if (res.reason !== 'denied') { console.warn('[SocioContext] FCM nativo no registrado:', res.reason); markFailed() }
      }
      return
    }
    const res = await registerSocioPush(uid)
    if (!res.ok) {
      if (res.reason === 'no-vapid') {
        setPushToast({ type: 'info', message: 'Para notificaciones configura VAPID key' })
      } else if (res.reason === 'denied' || res.reason === 'unsupported') {
        // terminal: no reintentar
      } else {
        console.warn('[SocioContext] web push no registrado:', res.reason); markFailed()
      }
    }
  }

  // Registrar push al tener user+socio (evita doble SIGNED_IN races)
  useEffect(() => {
    if (user?.id) maybeRegisterPush(user.id)
  }, [user?.id])

  // Realtime: nuevos pedidos del socio
  useEffect(() => {
    if (!socio?.id) return
    const ch = supabase
      .channel('socio-pedidos-' + socio.id)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'pedidos', filter: `socio_id=eq.${socio.id}` },
        (payload) => {
          const p = payload.new
          if (!p) return
          setPedidosNuevosSocio((prev) => {
            if (prev.find((x) => x.id === p.id)) return prev
            return [{ id: p.id, codigo: p.codigo, total: p.total, created_at: p.created_at }, ...prev].slice(0, MAX_NUEVOS)
          })
          try {
            if ('Notification' in window && Notification.permission === 'granted') {
              const n = new Notification('Nuevo pedido #' + (p.codigo || ''), {
                body: 'Total: ' + Number(p.total || 0).toFixed(2) + ' €',
                icon: '/icon.png',
                tag: 'socio-nuevo-' + p.id,
              })
              n.onclick = () => { window.focus(); n.close() }
            }
          } catch (_) {}
        }
      )
      .subscribe()
    realtimeChannelRef.current = ch
    return () => {
      try { supabase.removeChannel(ch) } catch (_) {}
      realtimeChannelRef.current = null
    }
  }, [socio?.id])

  const dismissNuevo = useCallback((id) => {
    setPedidosNuevosSocio((prev) => prev.filter((p) => p.id !== id))
  }, [])

  const dismissAllNuevos = useCallback(() => {
    setPedidosNuevosSocio([])
  }, [])

  const updateSocio = useCallback(async (cambios) => {
    if (!socio?.id) return
    const { data, error } = await supabase
      .from('socios')
      .update(cambios)
      .eq('id', socio.id)
      .select()
      .single()
    if (error) throw error
    setSocio(data)
    return data
  }, [socio?.id])

  const logout = useCallback(async () => {
    // Parar el GPS/foreground service ANTES de cerrar sesión: es estado de módulo en
    // riderGeo, así que sin esto la notificación "Pidoo en servicio" y el tracking
    // seguirían vivos tras el logout. Y marcar offline en DB (best-effort) para no
    // dejar al socio "en servicio" hasta que lo apague el cron.
    try { stopTracking() } catch (_) {}
    try { await riderOffline() } catch (_) {}
    try {
      if (user?.id) {
        const native = await isNativePlatform()
        if (native) await unregisterSocioPushNative(user.id)
        else await unregisterSocioPush(user.id)
      }
    } catch (_) {}
    pushRegisteredRef.current = false
    userIdRef.current = null
    await supabase.auth.signOut()
    setSocio(null)
    setPedidosNuevosSocio([])
  }, [user?.id])

  // Memoizamos el value: sin esto, cada INSERT de realtime / cada toast / cada
  // refresh de token creaba un objeto nuevo y re-renderizaba TODOS los consumidores
  // (Shell entero, header, páginas) — jank perceptible en gama baja.
  const value = useMemo(() => ({
    session, user, socio, loading,
    authError, setAuthError,
    refreshSocio, updateSocio, logout,
    pedidosNuevosSocio, dismissNuevo, dismissAllNuevos,
    pushToast, setPushToast,
  }), [session, user, socio, loading, authError, refreshSocio, updateSocio, logout,
    pedidosNuevosSocio, dismissNuevo, dismissAllNuevos, pushToast])

  return (
    <SocioContext.Provider value={value}>
      {children}
    </SocioContext.Provider>
  )
}

export function useSocio() {
  const ctx = useContext(SocioContext)
  if (!ctx) throw new Error('useSocio fuera de SocioProvider')
  return ctx
}
