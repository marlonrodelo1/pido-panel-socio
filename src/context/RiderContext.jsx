// RiderContext — estado del modo reparto del socio.
// Maneja:
//  - online/offline (toggle "Salir de linea" del drawer)
//  - GPS loop (15s activo / 60s idle) via riderGeo
//  - asignaciones (lista en realtime via canal rider-asignaciones-{rider_account_id})
//  - notificacion de nueva asignacion para Modal full-screen

import { createContext, useContext, useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { riderApi } from '../lib/riderApi'
import { makeRiderTracker, getCurrentPosition } from '../lib/riderGeo'
import { useSocio } from './SocioContext'

const RiderContext = createContext(null)

export function RiderProvider({ children }) {
  const { socio, refreshSocio } = useSocio()
  const [online, setOnline] = useState(false)
  const [riderAccountId, setRiderAccountId] = useState(null)
  const [asignaciones, setAsignaciones] = useState([])
  const [pendingNew, setPendingNew] = useState(null) // asignacion_id pendiente de aceptar/rechazar
  const [pos, setPos] = useState(null)
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
    ;(async () => {
      const { data } = await supabase
        .from('pedido_asignaciones')
        .select('id, pedido_id, estado, intento, distancia_metros, aceptado_at, recogido_at, entregado_at, created_at, pedidos!inner(id, codigo, total, direccion_entrega, lat_entrega, lng_entrega, modo_entrega, estado, establecimiento_id, establecimientos!inner(id, nombre, direccion, telefono, latitud, longitud))')
        .eq('rider_account_id', riderAccountId)
        .in('estado', ['esperando_aceptacion', 'aceptado'])
        .is('entregado_at', null)
        .order('created_at', { ascending: false })
      if (!cancel) setAsignaciones(data || [])
    })()
    const ch = supabase.channel('rider-asign-' + riderAccountId)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'pedido_asignaciones', filter: `rider_account_id=eq.${riderAccountId}` },
        async (payload) => {
          // Cargar fila completa con joins
          const { data } = await supabase
            .from('pedido_asignaciones')
            .select('id, pedido_id, estado, intento, distancia_metros, aceptado_at, recogido_at, entregado_at, created_at, pedidos!inner(id, codigo, total, direccion_entrega, lat_entrega, lng_entrega, modo_entrega, estado, establecimiento_id, establecimientos!inner(id, nombre, direccion, telefono, latitud, longitud))')
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
        try { await riderApi.updateLocation({ lat, lng }) } catch (e) { console.warn('[Rider] update-location fail', e?.message) }
      },
      onError: (e) => console.warn('[Rider] gps fail', e?.message),
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

  // Acciones del rider — toggle instantaneo y optimista. La UI no espera al
  // servidor: si falla, revertimos.
  const goOnline = useCallback(() => {
    setOnline(true) // optimista
    ;(async () => {
      let lat, lng
      try {
        const p = await getCurrentPosition()
        lat = p.lat; lng = p.lng
        setPos({ lat, lng })
      } catch (_) {}
      try {
        await riderApi.online({ lat, lng })
        refreshSocio().catch(() => {})
      } catch (e) {
        console.error('[Rider] online failed', e)
        setOnline(false)
      }
    })()
  }, [refreshSocio])

  const goOffline = useCallback(() => {
    setOnline(false) // optimista
    trackerRef.current?.stop()
    trackerRef.current = null
    ;(async () => {
      try {
        await riderApi.offline()
        refreshSocio().catch(() => {})
      } catch (e) {
        console.error('[Rider] offline failed', e)
        setOnline(true)
      }
    })()
  }, [refreshSocio])

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

  const dismissPending = useCallback(() => setPendingNew(null), [])

  const value = useMemo(() => ({
    online, riderAccountId,
    asignaciones, pendingNew,
    pos,
    goOnline, goOffline,
    accept, reject, pickup, deliver,
    dismissPending,
  }), [online, riderAccountId, asignaciones, pendingNew, pos, goOnline, goOffline, accept, reject, pickup, deliver, dismissPending])

  return <RiderContext.Provider value={value}>{children}</RiderContext.Provider>
}

export function useRider() {
  const ctx = useContext(RiderContext)
  if (!ctx) throw new Error('useRider fuera de RiderProvider')
  return ctx
}
