// RiderContext — Estado central de la app rider.
//
// Responsabilidades:
//   - Cargar el socio del usuario logueado (`socios.user_id = user.id`).
//   - Tracking online/offline optimista con llamadas a rider-online/offline.
//   - GPS loop integrado con riderGeo cuando está online.
//   - Realtime: detectar nuevas filas en `pedido_asignaciones` con `socio_id` y
//     `estado='esperando_aceptacion'` → dispara modal pedido entrante.
//   - Listener push nativo para fallback cuando realtime no llega (app cerrada).
//   - Listado de asignaciones activas (aceptado, recogido, en_camino) para
//     RiderPedidos.jsx.
//
// API expuesta:
//   { socio, isOnline, asignacionPendiente, asignacionesActivas,
//     setOnline(boolean), dismissPendiente(), refreshAsignaciones() }

import { createContext, useContext, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useSocio } from './SocioContext'
import { riderOnline, riderOffline, riderHeartbeat } from '../lib/riderApi'
import { startTracking, stopTracking, getCurrentPosition, requestLocationPermission, captureAndPush, openLocationSettings } from '../lib/riderGeo'
import { onPushReceived, onPushTapped } from '../lib/pushNative'
import { armOfflineBeacon, disarmOfflineBeacon, refreshOfflineBeaconToken, requestBatteryExemption } from '../lib/offlineBeacon'
import { isNativePlatform, getPlugin, getDeviceId } from '../lib/capacitor'
import LocationDisclosureModal from '../components/LocationDisclosureModal'

const RiderCtx = createContext(null)
export const useRider = () => useContext(RiderCtx)

export function RiderProvider({ children }) {
  const { socio, user, refreshSocio } = useSocio() || {}
  const [isOnline, setIsOnline] = useState(false)
  const [needsLocation, setNeedsLocation] = useState(false) // online sin permiso GPS → banner
  const [actionError, setActionError] = useState(null)      // error de red al conectar/desconectar
  const [asignacionPendiente, setAsignacionPendiente] = useState(null) // { id, pedido_id, codigo, ... }
  const [asignacionesActivas, setAsignacionesActivas] = useState([]) // pedidos en curso del rider
  const channelRef = useRef(null)
  const lastFetchRef = useRef(0)
  const lastPosRef = useRef(null)   // última posición GPS conocida (para el latido)
  const togglingRef = useRef(false) // mutex: hay un setOnline en vuelo (evita toggles cruzados)
  const dismissedIdsRef = useRef(new Set()) // asignaciones ya descartadas localmente (no re-mostrar)
  const [showDisclosure, setShowDisclosure] = useState(false)
  const disclosureResolveRef = useRef(null)
  const deviceIdRef = useRef(null)     // id de este dispositivo (single-device)
  const supersededRef = useRef(false)  // ya se detecto que otro dispositivo tomo la cuenta

  // Handler de fallo del watcher nativo (permiso denegado / GPS del sistema off).
  // El watcher entrega el error de forma asíncrona; aquí encendemos el banner para
  // que el rider sepa que está "en línea pero ciego" y pueda reactivar la ubicación.
  const handleWatcherError = useCallback((err) => {
    if (err?.code === 'NOT_AUTHORIZED') setNeedsLocation(true)
  }, [])

  // Al ARRANCAR la app empezamos SIEMPRE offline: el rider debe pulsar "En servicio"
  // para compartir su ubicación (eso dispara el aviso de geolocalización + el permiso).
  // Si en el DB quedó "en servicio" de una sesión anterior, lo sincronizamos a offline
  // (la app acaba de arrancar sin tracking → no está realmente disponible para pedidos).
  // Tras el primer arranque, solo reflejamos cambios EXTERNOS hacia offline (p. ej. el
  // cron auto-offline); nunca auto-encendemos online desde el DB.
  const didInitRef = useRef(false)
  useEffect(() => {
    if (!socio) return
    if (!didInitRef.current) {
      didInitRef.current = true
      let consented = false
      try { consented = localStorage.getItem('pidoo_bg_loc_consent') === '1' } catch (_) {}
      if (socio.en_servicio && consented) {
        // REANUDAR turno: seguía En servicio y ya dio el consentimiento de ubicación
        // → mantener online y RE-ARRANCAR el tracking (que de verdad comparta, no solo
        // la UI). Así reabrir la app NO te apaga. El latido (efecto de abajo) revive solo
        // al pasar isOnline=true.
        setIsOnline(true)
        armOfflineBeacon() // Parte B: re-armar el beacon de cierre al reanudar turno
        requestLocationPermission().then((granted) => {
          setNeedsLocation(!granted)
          if (granted) startTracking({ onUpdate: (pos) => { lastPosRef.current = pos }, onError: handleWatcherError })
        })
      } else {
        // Primer login / sin consentimiento previo / estaba offline → empezar offline
        // (aquí, al pulsar "En servicio", sale el aviso + se piden permisos).
        setIsOnline(false)
        if (socio.en_servicio) { riderOffline().catch(() => {}) }
      }
      return
    }
    // Cambios externos posteriores (p. ej. cron auto-offline) → reflejar offline.
    // Importante: además de la UI, hay que PARAR el tracking nativo; si no, el
    // foreground service y los POST de ubicación siguen corriendo con el rider
    // ya offline en DB (batería + privacidad).
    if (!socio.en_servicio) {
      setIsOnline(false)
      setNeedsLocation(false)
      stopTracking()
      disarmOfflineBeacon()
      lastPosRef.current = null
    }
  }, [socio?.id, socio?.en_servicio, handleWatcherError])

  // Disclosure obligatoria de Google Play (ubicación en segundo plano): se muestra
  // ANTES de pedir el permiso, una sola vez (consentimiento guardado en localStorage).
  // En web no aplica. Devuelve true si el usuario acepta (o ya consintió antes).
  const ensureBgConsent = async () => {
    if (!(await isNativePlatform())) return true
    try { if (localStorage.getItem('pidoo_bg_loc_consent') === '1') return true } catch (_) {}
    const ok = await new Promise((resolve) => {
      disclosureResolveRef.current = resolve
      setShowDisclosure(true)
    })
    setShowDisclosure(false)
    disclosureResolveRef.current = null
    if (ok) { try { localStorage.setItem('pidoo_bg_loc_consent', '1') } catch (_) {} }
    return ok
  }

  // ─── Acción: cambiar online/offline ────────────────────────
  // El estado online lo fija la edge `rider-online` (fuente de verdad). El permiso
  // GPS es BEST-EFFORT: si falta, NO bloqueamos ni revertimos el online — la edge
  // pone en_servicio aunque no haya coordenadas y avisamos con `needsLocation`
  // (banner en RiderEsperando). Solo revertimos si la edge falla de verdad (red).
  const setOnline = async (next) => {
    // Mutex: si ya hay un cambio de estado en vuelo, ignoramos el segundo tap
    // (posiblemente desde otro toggle en otra pantalla). Evita que un online y un
    // offline concurrentes dejen la UI, la DB y el watcher desincronizados.
    if (togglingRef.current) return { ok: false, busy: true }
    togglingRef.current = true
    setActionError(null)
    try {
      if (next) {
        // El consentimiento y el permiso se piden ANTES de marcar la UI como online,
        // para no mostrar "En línea" mientras el modal de disclosure sigue abierto.
        const consent = await ensureBgConsent()
        if (!consent) { setIsOnline(false); return { ok: false, declined: true } }
        const granted = await requestLocationPermission()
        setNeedsLocation(!granted)
        let pos = null
        if (granted) {
          try { pos = await getCurrentPosition() } catch (_) {}
          if (pos) lastPosRef.current = pos
        }
        setIsOnline(true) // optimista, ya con consentimiento y permiso resueltos
        const res = await riderOnline({
          latitud: pos?.latitud,
          longitud: pos?.longitud,
          accuracy: pos?.accuracy,
        })
        if (!res.ok) {
          setIsOnline(false)
          if (res.sessionDead) {
            setActionError('Tu sesión ha caducado. Vuelve a iniciar sesión.')
            try { await supabase.auth.signOut() } catch (_) {}
          } else {
            setActionError('No se pudo conectar. Revisa tu conexión e inténtalo de nuevo.')
          }
          return res
        }
        if (granted) startTracking({ onUpdate: (p) => { lastPosRef.current = p }, onError: handleWatcherError })
        // Parte B: armar el beacon de cierre (offline instantáneo al cerrar la app) y pedir
        // la exención de batería una sola vez (para que el SO no mate el proceso de fondo).
        armOfflineBeacon()
        try { if (localStorage.getItem('pidoo_batt_asked') !== '1') { localStorage.setItem('pidoo_batt_asked', '1'); requestBatteryExemption() } } catch (_) {}
        refreshSocio?.()
        return res
      } else {
        setIsOnline(false) // optimista
        // OJO: no paramos el tracking hasta confirmar que la desconexión fue OK.
        // Si riderOffline() falla por red, revertimos a online y el GPS/latido deben
        // seguir vivos (si paráramos el tracking antes, quedaría "online + latiendo"
        // pero sin posición, justo lo que este sistema quiere evitar).
        const res = await riderOffline()
        if (!res.ok) {
          setIsOnline(true)
          if (res.sessionDead) {
            // Sesión muerta: la app se va a cerrar. Paramos el tracking igualmente
            // para no dejar el foreground service + GPS huérfanos tras el signOut.
            stopTracking()
            disarmOfflineBeacon()
            lastPosRef.current = null
            setActionError('Tu sesión ha caducado. Vuelve a iniciar sesión.')
            try { await supabase.auth.signOut() } catch (_) {}
          } else {
            setActionError('No se pudo desconectar. Inténtalo de nuevo.')
          }
          return res
        }
        stopTracking()
        disarmOfflineBeacon() // Parte B: desconexión manual -> desarmar beacon
        lastPosRef.current = null
        setNeedsLocation(false)
        refreshSocio?.()
        return res
      }
    } finally {
      togglingRef.current = false
    }
  }

  // Reintentar el permiso de ubicación desde el banner. Si se concede y ya
  // estamos online, arranca el tracking y empuja una posición; si sigue
  // denegado, abre los ajustes del sistema para que el usuario lo active.
  const retryLocation = async () => {
    const granted = await requestLocationPermission()
    setNeedsLocation(!granted)
    if (granted) {
      if (isOnline) { startTracking({ onUpdate: (pos) => { lastPosRef.current = pos }, onError: handleWatcherError }); captureAndPush() }
    } else {
      openLocationSettings()
    }
    return granted
  }

  const clearActionError = () => setActionError(null)

  // ─── Single-device: cerrar sesion si otro dispositivo toma la cuenta ──
  useEffect(() => { getDeviceId().then((id) => { deviceIdRef.current = id }).catch(() => {}) }, [])

  const handleSuperseded = useCallback(async () => {
    if (supersededRef.current) return
    supersededRef.current = true
    setIsOnline(false)
    stopTracking()
    disarmOfflineBeacon()
    lastPosRef.current = null
    setActionError('Se inició sesión en otro dispositivo. Este teléfono se ha desconectado.')
    // Logout LOCAL a propósito: NO usamos logout() del SocioContext porque llama a
    // riderOffline() (flip-earía el en_servicio COMPARTIDO con el dispositivo nuevo) y a
    // unregisterSocioPushNative (borra el token por user_id → borraría el del dispositivo
    // nuevo, mismo login). El trigger ya dejó solo el token del dispositivo activo, así que
    // aquí basta con cerrar la sesión de ESTE dispositivo.
    try { await supabase.auth.signOut() } catch (_) {}
  }, [])

  // Realtime sobre la fila del socio: si active_device_id pasa a ser OTRO dispositivo,
  // esta sesion fue superada → logout inmediato.
  useEffect(() => {
    if (!socio?.id) return
    const ch = supabase
      .channel(`socio-device-${socio.id}`)
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'socios', filter: `id=eq.${socio.id}`,
      }, (payload) => {
        const active = payload.new?.active_device_id
        const mine = deviceIdRef.current
        if (active && mine && active !== mine) handleSuperseded()
      })
      .subscribe()
    return () => { try { supabase.removeChannel(ch) } catch (_) {} }
  }, [socio?.id, handleSuperseded])

  // ─── Cargar asignaciones activas del rider ─────────────────
  const refreshAsignaciones = useCallback(async () => {
    if (!socio?.id) return
    lastFetchRef.current = Date.now()
    // Pedidos en curso del rider = asignaciones ACEPTADAS aún no entregadas.
    // El pedido.estado dentro puede ser preparando/listo (Aceptado), recogido o
    // en_camino — la pantalla de detalle gestiona el avance. Filtrar por la
    // asignación (no por pedido.estado) evita perder los recién aceptados.
    const { data: asigs } = await supabase
      .from('pedido_asignaciones')
      .select('created_at, pedidos!inner(id, codigo, estado, shipday_status, modo_entrega, subtotal, total, coste_envio, propina, establecimiento_id, usuario_id, direccion_entrega, lat_entrega, lng_entrega, created_at)')
      .eq('socio_id', socio.id)
      .eq('estado', 'aceptado')
      .in('pedidos.estado', ['preparando', 'listo', 'recogido', 'en_camino'])
      .order('created_at', { ascending: false })
      .limit(20)
    setAsignacionesActivas((asigs || []).map(a => a.pedidos).filter(Boolean))

    // Asignación pendiente (esperando aceptación)
    const { data: pendiente } = await supabase
      .from('pedido_asignaciones')
      .select('id, pedido_id, estado, created_at, pedidos!inner(codigo, total, modo_entrega, direccion_entrega, establecimientos(nombre, direccion))')
      .eq('socio_id', socio.id)
      .eq('estado', 'esperando_aceptacion')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    // Funcional: no pisar una pendiente ya mostrada (evita leer estado stale) y no
    // re-mostrar una que el rider ya descartó localmente (rechazo/timeout) mientras
    // el backend aún no la resuelve → evita el "modal zombi" que reaparecía en bucle.
    if (pendiente && !dismissedIdsRef.current.has(pendiente.id)) {
      setAsignacionPendiente((prev) => prev || pendiente)
    }
  }, [socio?.id])

  useEffect(() => {
    if (!socio?.id) return
    refreshAsignaciones()
  }, [socio?.id, refreshAsignaciones])

  // ─── Realtime: pedido_asignaciones del socio ───────────────
  useEffect(() => {
    if (!socio?.id) return
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current)
    }
    const ch = supabase
      .channel(`rider-${socio.id}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'pedido_asignaciones',
        filter: `socio_id=eq.${socio.id}`,
      }, async (payload) => {
        const newRow = payload.new
        if (newRow?.estado === 'esperando_aceptacion' && !dismissedIdsRef.current.has(newRow.id)) {
          // Enriquecer con datos del pedido
          const { data: pedido } = await supabase
            .from('pedidos')
            .select('codigo, total, modo_entrega, direccion_entrega, establecimientos(nombre, direccion)')
            .eq('id', newRow.pedido_id)
            .maybeSingle()
          // No pisar una pendiente ya mostrada: si llegan dos pedidos casi a la vez,
          // el segundo no debe reemplazar (y reiniciar el countdown de) el primero.
          setAsignacionPendiente((prev) => prev || { ...newRow, pedidos: pedido })
        }
      })
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'pedido_asignaciones',
        filter: `socio_id=eq.${socio.id}`,
      }, (payload) => {
        // Si la asignación que el rider tiene abierta deja de estar "esperando
        // aceptación" (la tomó otro, expiró o se reasignó), cerramos el modal.
        const row = payload.new
        if (row?.estado && row.estado !== 'esperando_aceptacion') {
          setAsignacionPendiente((prev) => (prev && prev.id === row.id ? null : prev))
        }
        refreshAsignaciones()
      })
      .subscribe((status) => {
        // Recuperación: si el canal se cae (WebView congelado en background, pérdida
        // de red), supabase-js no siempre re-une solo. Al reconectar, refrescamos por
        // si perdimos algún INSERT mientras el socket estuvo muerto.
        if (status === 'SUBSCRIBED') {
          refreshAsignaciones()
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          console.warn('[RiderContext] realtime status:', status)
        }
      })
    channelRef.current = ch
    return () => { supabase.removeChannel(ch); channelRef.current = null }
  }, [socio?.id, refreshAsignaciones])

  // ─── Recuperar realtime al volver del segundo plano ────────
  // El WebView de Android congela el websocket tras minutos en background; al volver,
  // reconectamos el socket y refrescamos las asignaciones para no perder pedidos.
  useEffect(() => {
    if (!socio?.id) return
    let removed = false
    let appHandle = null
    const onResume = () => {
      try { supabase.realtime.connect() } catch (_) {}
      refreshAsignaciones()
    }
    // Web / PWA
    const onVisibility = () => { if (typeof document !== 'undefined' && !document.hidden) onResume() }
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility)
    // Nativo (Capacitor App)
    ;(async () => {
      const App = (await getPlugin('App'))?.plugin
      if (!App || removed) return
      appHandle = await App.addListener('appStateChange', (state) => {
        if (state?.isActive) onResume()
      })
    })()
    return () => {
      removed = true
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility)
      try { appHandle?.remove?.() } catch (_) {}
    }
  }, [socio?.id, refreshAsignaciones])

  // ─── Listeners push: fallback cuando realtime no llega ─────
  useEffect(() => {
    const offRecv = onPushReceived(() => {
      // Re-fetch para coger la asignación nueva
      refreshAsignaciones()
    })
    const offTap = onPushTapped(() => {
      refreshAsignaciones()
    })
    return () => { offRecv?.(); offTap?.() }
  }, [socio?.id, refreshAsignaciones])

  // ─── Latido de presencia mientras online (SOLO foreground/web) ─────
  // Cada 60s, estando EN SERVICIO, mandamos un latido (rider-heartbeat) aunque el
  // repartidor no se mueva. Mantiene fresco socios.last_location_at para que el
  // cron `auto-offline-socios-inactivos` no lo apague mientras la app siga viva.
  // OJO: este setInterval SOLO late con la app en primer plano (o en web) — al
  // minimizar, el SO congela los timers JS del WebView (CapacitorHttp hace nativa
  // la petición, pero no el timer que la dispara). En background el latido real
  // es el keepalive del watcher nativo de riderGeo.js (callback nativo→JS con
  // distanceFilter:0, postea rider-update-location ≥1 vez/min aunque esté quieto).
  // Este latido de foreground se mantiene porque además detecta sesión muerta.
  useEffect(() => {
    if (!isOnline) return
    // Latido inmediato al ponerse online + cada 60s.
    const beat = async () => {
      // Comprobación de sesión: si el refresh token está muerto (caducado/revocado),
      // el latido fallaría con 401 y el cron acabaría marcando al socio offline en
      // silencio, dejándolo sin pedidos con la UI diciendo "En línea". Lo detectamos
      // aquí y forzamos re-login en vez de "morir callado".
      try {
        let { data: { session } } = await supabase.auth.getSession()
        const expSoonMs = session?.expires_at ? session.expires_at * 1000 - Date.now() : 0
        if (!session || expSoonMs < 60_000) {
          const r = await supabase.auth.refreshSession()
          session = r?.data?.session || null
        }
        if (!session) {
          setIsOnline(false)
          stopTracking()
          disarmOfflineBeacon()
          lastPosRef.current = null
          setActionError('Tu sesión ha caducado. Vuelve a iniciar sesión para seguir recibiendo pedidos.')
          try { await supabase.auth.signOut() } catch (_) {}
          return
        }
      } catch (_) { /* sin red: no forzamos logout, reintentamos al siguiente latido */ }
      // Parte B: mantener fresco el token del beacon de cierre mientras la app esté viva.
      refreshOfflineBeaconToken()
      const p = lastPosRef.current
      const hb = await riderHeartbeat(p ? { latitud: p.latitud, longitud: p.longitud } : {})
      // Single-device: 409 = sesion superada por otro dispositivo → logout.
      if (hb && hb.ok === false && (hb.data?.error === 'sesion_superada' || hb.error === 'http_409')) {
        handleSuperseded()
      }
    }
    beat()
    const id = setInterval(beat, 60_000)
    return () => clearInterval(id)
  }, [isOnline])

  // ─── Dismiss asignación pendiente (tras aceptar/rechazar/timeout) ──
  const dismissPendiente = () => {
    setAsignacionPendiente((prev) => {
      // Recordamos el id descartado para que refreshAsignaciones / el INSERT realtime
      // no lo vuelvan a mostrar mientras el backend aún no lo resuelve (modal zombi).
      if (prev?.id) {
        dismissedIdsRef.current.add(prev.id)
        // Limpieza defensiva: no dejar crecer el set indefinidamente.
        if (dismissedIdsRef.current.size > 50) {
          dismissedIdsRef.current = new Set(Array.from(dismissedIdsRef.current).slice(-25))
        }
      }
      return null
    })
    // refrescar para mover a activas si aceptó
    setTimeout(refreshAsignaciones, 500)
  }

  // Cleanup global: al desmontar el provider (logout, cambio de árbol) paramos el
  // tracking nativo. Es estado de módulo en riderGeo, así que sin esto el foreground
  // service y el GPS seguirían vivos tras cerrar sesión.
  useEffect(() => () => { stopTracking(); disarmOfflineBeacon() }, [])

  const value = useMemo(() => ({
    socio,
    user,
    isOnline,
    needsLocation,
    actionError,
    asignacionPendiente,
    asignacionesActivas,
    setOnline,
    retryLocation,
    clearActionError,
    dismissPendiente,
    refreshAsignaciones,
  }), [socio, user, isOnline, needsLocation, actionError, asignacionPendiente, asignacionesActivas, refreshAsignaciones])

  return (
    <RiderCtx.Provider value={value}>
      {children}
      <LocationDisclosureModal
        open={showDisclosure}
        onAccept={() => disclosureResolveRef.current?.(true)}
        onDecline={() => disclosureResolveRef.current?.(false)}
      />
    </RiderCtx.Provider>
  )
}
