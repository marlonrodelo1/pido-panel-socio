import { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { registerSocioPush, unregisterSocioPush } from '../lib/webPush'
import { registerSocioNativePush, unregisterSocioNativePush } from '../lib/pushNative'

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

  const fetchSocio = useCallback(async (uid) => {
    if (!uid) { setSocio(null); return }
    const { data, error } = await supabase
      .from('socios')
      .select('*')
      .eq('user_id', uid)
      .maybeSingle()
    if (error && error.code !== 'PGRST116') {
      console.error('[SocioContext] error fetch socio', error)
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
      if (data.session?.user) await fetchSocio(data.session.user.id)
      setLoading(false)
    })()

    const { data: listener } = supabase.auth.onAuthStateChange((evt, newSession) => {
      setSession(newSession)
      setUser(newSession?.user || null)
      if (newSession?.user) {
        fetchSocio(newSession.user.id)
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

  // Registrar push una vez por sesión (web VAPID + nativo FCM/APNs)
  async function maybeRegisterPush(uid) {
    if (pushRegisteredRef.current) return
    pushRegisteredRef.current = true
    const res = await registerSocioPush(uid)
    if (!res.ok) {
      if (res.reason === 'no-vapid') {
        setPushToast({ type: 'info', message: 'Para notificaciones configura VAPID key' })
      } else if (res.reason !== 'denied' && res.reason !== 'unsupported') {
        console.warn('[SocioContext] web push no registrado:', res.reason)
      }
    }
    try { await registerSocioNativePush(uid) } catch (e) { console.warn('[SocioContext] native push fail', e?.message) }
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
                icon: '/favicon.svg',
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

  const updateSocio = async (cambios) => {
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
  }

  const logout = async () => {
    try { if (user?.id) await unregisterSocioPush(user.id) } catch (_) {}
    try { await unregisterSocioNativePush() } catch (_) {}
    pushRegisteredRef.current = false
    await supabase.auth.signOut()
    setSocio(null)
    setPedidosNuevosSocio([])
  }

  return (
    <SocioContext.Provider value={{
      session, user, socio, loading,
      authError, setAuthError,
      refreshSocio, updateSocio, logout,
      pedidosNuevosSocio, dismissNuevo, dismissAllNuevos,
      pushToast, setPushToast,
    }}>
      {children}
    </SocioContext.Provider>
  )
}

export function useSocio() {
  const ctx = useContext(SocioContext)
  if (!ctx) throw new Error('useSocio fuera de SocioProvider')
  return ctx
}
