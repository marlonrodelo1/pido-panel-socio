// RiderContext — estado del modo reparto del socio.
// Maneja:
//  - online/offline (toggle "Salir de linea" del drawer)
//  - GPS loop (15s activo / 60s idle) via riderGeo
//  - asignaciones (lista en realtime via canal rider-asignaciones-{rider_account_id})
//  - notificacion de nueva asignacion para Modal full-screen

import { createContext, useContext, useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { riderApi } from '../lib/riderApi'
import { makeRiderTracker, getCurrentPosition, ensureBackgroundLocationPermission } from '../lib/riderGeo'
import { useSocio } from './SocioContext'

const RiderContext = createContext(null)

export function RiderProvider({ children }) {
  const { socio, refreshSocio } = useSocio()
  const [online, setOnline] = useState(false)
  const [riderAccountId, setRiderAccountId] = useState(null)
  const [asignaciones, setAsignaciones] = useState([])
  const [pendingNew, setPendingNew] = useState(null) // asignacion_id pendiente de aceptar/rechazar
  const [pos, setPos] = useState(null)
  // gpsStatus: { ok: bool, reason?: string, code?: string }
  // - ok=true sin reason -> tracker corriendo bien
  // - ok=false -> mostrar banner rojo en HeaderRider con boton "Reintentar"
  const [gpsStatus, setGpsStatus] = useState({ ok: true })
  // gpsToast: mensaje informativo no bloqueante (ej. "permiso parcial")
  const [gpsToast, setGpsToast] = useState(null)
  const trackerRef = useRef(null)
  const channelRef = useRef(null)

  // Estado online del socio en BD = source of truth
  useEffect(() => {
    if (!socio) return
    setOnline(!!socio.en_servicio)
  }, [socio?.en_servicio])

  // rider_account ligada al socio (para identificar en pedido_asignaciones)
  useEffect(() => {
    let cancel = false
    ;(async () => {
      if (!socio?.id) { setRiderAccountId(null); return }
      const { data } = await supabase
        .from('rider_accounts')
        .select('id')
        .eq('socio_id', socio.id)
        .eq('estado', 'activa')
        .eq('activa', true)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle()
      if (cancel) return
      setRiderAccountId(data?.id || null)
    })()
    return () => { cancel = true }
  }, [socio?.id])

  // Cargar asignaciones activas + suscribir realtime
  useEffect(() => {
    if (!riderAccountId) { setAsignaciones([]); return }
    let cancel = false
    async function loadAsignaciones() {
      const { data } = await supabase
        .from('pedido_asignaciones')
        .select('id, pedido_id, estado, intento, distancia_metros, aceptado_at, recogido_at, entregado_at, created_at, pedidos!inner(id, codigo, total, direccion_entrega, lat_entrega, lng_entrega, modo_entrega, estado, establecimiento_id, usuario_id, notas, usuarios(nombre, apellido, telefono), establecimientos!inner(id, nombre, direccion, telefono, latitud, longitud))')
        .eq('rider_account_id', riderAccountId)
        .in('estado', ['esperando_aceptacion', 'aceptado'])
        .is('entregado_at', null)
        .order('created_at', { ascending: false })
      if (!cancel) {
        setAsignaciones(data || [])
        // Si hay una asignacion esperando_aceptacion creada en los ultimos 3 min,
        // abrir el modal automaticamente (el rider abrio la app justo cuando le
        // llego un pedido pendiente).
        const ahora = Date.now()
        const reciente = (data || []).find((a) =>
          a.estado === 'esperando_aceptacion'
          && (ahora - new Date(a.created_at).getTime()) < 180_000
        )
        if (reciente) setPendingNew((prev) => prev?.id === reciente.id ? prev : reciente)
      }
    }
    loadAsignaciones()

    // Recargar al volver al foreground o al recibir push
    const onFocus = () => loadAsignaciones()
    const onPushReceived = () => loadAsignaciones()
    const onPushTapped = () => loadAsignaciones()
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', () => { if (!document.hidden) loadAsignaciones() })
    window.addEventListener('pidoo-push-received', onPushReceived)
    window.addEventListener('pidoo-push-tapped', onPushTapped)

    const ch = supabase.channel('rider-asign-' + riderAccountId)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'pedido_asignaciones', filter: `rider_account_id=eq.${riderAccountId}` },
        async (payload) => {
          // Cargar fila completa con joins
          const { data } = await supabase
            .from('pedido_asignaciones')
            .select('id, pedido_id, estado, intento, distancia_metros, aceptado_at, recogido_at, entregado_at, created_at, pedidos!inner(id, codigo, total, direccion_entrega, lat_entrega, lng_entrega, modo_entrega, estado, establecimiento_id, usuario_id, notas, usuarios(nombre, apellido, telefono), establecimientos!inner(id, nombre, direccion, telefono, latitud, longitud))')
            .eq('id', payload.new.id)
            .maybeSingle()
          if (!data) return
          setAsignaciones((prev) => prev.find((a) => a.id === data.id) ? prev : [data, ...prev])
          if (data.estado === 'esperando_aceptacion') {
            setPendingNew(data)
            try {
              if ('Notification' in window && Notification.permission === 'granted') {
                new Notification('Nuevo pedido', {
                  body: `#${data.pedidos?.codigo} · ${data.pedidos?.establecimientos?.nombre}`,
                  tag: 'rider-' + data.id,
                })
              }
            } catch (_) {}
          }
        })
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'pedido_asignaciones', filter: `rider_account_id=eq.${riderAccountId}` },
        (payload) => {
          setAsignaciones((prev) => prev.map((a) => a.id === payload.new.id ? { ...a, ...payload.new } : a)
            .filter((a) => a.estado === 'esperando_aceptacion' || a.estado === 'aceptado'))
        })
      .subscribe()
    channelRef.current = ch
    return () => {
      cancel = true
      try { supabase.removeChannel(ch) } catch (_) {}
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('pidoo-push-received', onPushReceived)
      window.removeEventListener('pidoo-push-tapped', onPushTapped)
      channelRef.current = null
    }
  }, [riderAccountId])

  // Tracker GPS: arranca al estar online, marca "active" si hay asignacion aceptada
  useEffect(() => {
    if (!online || !socio?.id) {
      trackerRef.current?.stop()
      trackerRef.current = null
      return
    }
    const t = makeRiderTracker({
      onTick: async ({ lat, lng }) => {
        setPos({ lat, lng })
        // Si llega un tick limpio el banner de GPS bloqueado.
        setGpsStatus((prev) => prev.ok ? prev : { ok: true })
        try { await riderApi.updateLocation({ lat, lng }) } catch (e) { console.warn('[Rider] update-location fail', e?.message) }
      },
      onError: (e) => {
        console.warn('[Rider] gps fail', e?.message)
        // No marcamos ok=false aqui: que sea el onStatusChange quien decida.
        // Esto evita parpadeos por errores transitorios (timeout, etc.).
      },
      onStatusChange: (s) => {
        // s = { kind, ok, reason?, code?, message? }
        if (s.ok === false) {
          setGpsStatus({ ok: false, reason: s.reason || s.code || 'gps_error', message: s.message })
        }
      },
    })
    trackerRef.current = t
    t.start()
    return () => { t.stop(); trackerRef.current = null }
  }, [online, socio?.id])

  // Marca cadencia 15s cuando hay asignacion aceptada
  useEffect(() => {
    const hayActiva = asignaciones.some((a) => a.estado === 'aceptado')
    trackerRef.current?.setActive(hayActiva)
  }, [asignaciones])

  // Helper: log a push_debug_logs (no bloquea si falla)
  const dbg = useCallback(async (event, details) => {
    try {
      await supabase.from('push_debug_logs').insert({
        platform: 'rider-app', event,
        details: details ? JSON.stringify(details).slice(0, 1000) : null,
      })
    } catch (_) {}
  }, [])

  // Acciones del rider — UPDATE directo a socios via supabase-js client.
  // ESTRATEGIA: hacer el UPDATE PRIMERO sin esperar a permisos ni GPS.
  // Antes esperabamos a ensureBackgroundLocationPermission y getCurrentPosition
  // ANTES del UPDATE, pero esas funciones podian colgarse indefinidamente
  // (imports dinamicos del plugin Capacitor que nunca resuelven). El rider
  // veia "ONLINE" en la UI pero en BD seguia offline -> pido-app cliente
  // mostraba "solo recogida". Lo critico es marcar en_servicio=true cuanto
  // antes para que clientes vean Delivery. Permisos y coords son secundarios.
  const goOnline = useCallback(() => {
    setOnline(true) // optimista
    dbg('goOnline:start', { socio_id: socio?.id })
    ;(async () => {
      if (!socio?.id) {
        await dbg('goOnline:no_socio')
        setOnline(false)
        return
      }
      // PASO 1 (CRITICO): UPDATE INMEDIATO de en_servicio + marketplace_activo.
      // Sin coords iniciales — el tracker o el watcher del mapa las pondra
      // cuando lleguen. Lo importante: que el cliente vea Delivery YA.
      const { error } = await supabase
        .from('socios')
        .update({
          en_servicio: true,
          marketplace_activo: true,
          last_location_at: new Date().toISOString(),
        })
        .eq('id', socio.id)
      if (error) {
        await dbg('goOnline:db_error', { msg: error.message, code: error.code })
        console.error('[Rider] online UPDATE failed', error)
        setOnline(false)
        setGpsToast({ type: 'error', message: 'No se pudo conectar. Reintenta en unos segundos.' })
        return
      }
      await dbg('goOnline:ok')
      refreshSocio().catch(() => {})

      // PASO 2 (NO BLOQUEANTE): pedir permisos sin esperar. Si la promesa
      // se cuelga indefinidamente, no nos importa: ya estamos online en BD.
      Promise.race([
        ensureBackgroundLocationPermission().catch(() => null),
        new Promise((r) => setTimeout(() => r(null), 5000)),
      ]).then((perm) => {
        if (!perm) return
        if (perm.foreground === false) {
          setGpsToast({ type: 'error', message: 'Sin permiso de ubicacion no recibiras pedidos. Activalo en Ajustes.' })
        } else if (perm.background === false) {
          setGpsToast({ type: 'warn', message: 'Cambia el permiso de ubicacion a "Permitir todo el tiempo" para recibir pedidos con la pantalla bloqueada.' })
        }
      })

      // PASO 3 (NO BLOQUEANTE): GPS one-shot. Si llega coordenada, la
      // empujamos a BD para que la primera asignacion sea precisa.
      Promise.race([
        getCurrentPosition().catch(() => null),
        new Promise((r) => setTimeout(() => r(null), 12000)),
      ]).then((p) => {
        if (!p?.lat || !p?.lng) return
        setPos({ lat: p.lat, lng: p.lng })
        supabase.from('socios').update({
          latitud_actual: p.lat,
          longitud_actual: p.lng,
          last_location_at: new Date().toISOString(),
        }).eq('id', socio.id).then(({ error: e2 }) => {
          if (e2) dbg('goOnline:coords_err', { msg: e2.message })
          else dbg('goOnline:coords_ok', { lat: p.lat, lng: p.lng })
        })
      })
    })()
  }, [refreshSocio, socio?.id, dbg])

  const goOffline = useCallback(() => {
    setOnline(false) // optimista
    trackerRef.current?.stop()
    trackerRef.current = null
    dbg('goOffline:start', { socio_id: socio?.id })
    ;(async () => {
      if (!socio?.id) return
      const { error } = await supabase
        .from('socios')
        .update({ en_servicio: false, marketplace_activo: false })
        .eq('id', socio.id)
      if (error) {
        await dbg('goOffline:db_error', { msg: error.message, code: error.code })
        console.error('[Rider] offline UPDATE failed', error)
        setOnline(true)
        return
      }
      await dbg('goOffline:ok')
      refreshSocio().catch(() => {})
    })()
  }, [refreshSocio, socio?.id, dbg])

  const accept = useCallback(async (asignacionId) => {
    await riderApi.accept(asignacionId)
    setPendingNew((p) => (p?.id === asignacionId ? null : p))
    setAsignaciones((prev) => prev.map((a) => a.id === asignacionId ? { ...a, estado: 'aceptado', aceptado_at: new Date().toISOString() } : a))
  }, [])

  const reject = useCallback(async (asignacionId, motivo) => {
    await riderApi.reject(asignacionId, motivo)
    setPendingNew((p) => (p?.id === asignacionId ? null : p))
    setAsignaciones((prev) => prev.filter((a) => a.id !== asignacionId))
  }, [])

  const pickup = useCallback(async (asignacionId) => {
    await riderApi.pickup(asignacionId)
    setAsignaciones((prev) => prev.map((a) => a.id === asignacionId ? { ...a, recogido_at: new Date().toISOString() } : a))
  }, [])

  const deliver = useCallback(async (asignacionId, fotoUrl) => {
    await riderApi.deliver(asignacionId, fotoUrl)
    setAsignaciones((prev) => prev.filter((a) => a.id !== asignacionId))
  }, [])

  const failDeliver = useCallback(async (asignacionId, motivo) => {
    await riderApi.failDeliver(asignacionId, motivo)
    setAsignaciones((prev) => prev.filter((a) => a.id !== asignacionId))
  }, [])

  const dismissPending = useCallback(() => setPendingNew(null), [])

  // Reintenta el tracker tras un error de GPS (banner "Reintentar"). Para el
  // tracker actual y deja que el efecto de `online` lo recree.
  const retryGps = useCallback(() => {
    if (!online) return
    setGpsStatus({ ok: true })
    try { trackerRef.current?.stop() } catch (_) {}
    trackerRef.current = null
    // Pequeno toggle para forzar re-ejecucion del effect.
    setOnline(false)
    setTimeout(() => setOnline(true), 50)
  }, [online])

  const dismissGpsToast = useCallback(() => setGpsToast(null), [])

  const value = useMemo(() => ({
    online, riderAccountId,
    asignaciones, pendingNew,
    pos,
    gpsStatus, gpsToast, retryGps, dismissGpsToast,
    goOnline, goOffline,
    accept, reject, pickup, deliver, failDeliver,
    dismissPending,
  }), [online, riderAccountId, asignaciones, pendingNew, pos, gpsStatus, gpsToast, retryGps, dismissGpsToast, goOnline, goOffline, accept, reject, pickup, deliver, failDeliver, dismissPending])

  return <RiderContext.Provider value={value}>{children}</RiderContext.Provider>
}

export function useRider() {
  const ctx = useContext(RiderContext)
  if (!ctx) throw new Error('useRider fuera de RiderProvider')
  return ctx
}
