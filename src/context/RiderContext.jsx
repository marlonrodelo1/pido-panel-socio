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

  // Hidratar isOnline desde socio.en_servicio cuando cargue
  useEffect(() => {
    if (socio) setIsOnline(!!socio.en_servicio)
  }, [socio?.en_servicio])

  // ─── Acción: cambiar online/offline ────────────────────────
  // El estado online lo fija la edge `rider-online` (fuente de verdad). El permiso
  // GPS es BEST-EFFORT: si falta, NO bloqueamos ni revertimos el online — la edge
  // pone en_servicio aunque no haya coordenadas y avisamos con `needsLocation`
  // (banner en RiderEsperando). Solo revertimos si la edge falla de verdad (red).
  const setOnline = async (next) => {
    setActionError(null)
    setIsOnline(next) // optimista
    if (next) {
      const granted = await requestLocationPermission()
      setNeedsLocation(!granted)
      let pos = null
      if (granted) {
        try { pos = await getCurrentPosition() } catch (_) {}
      }
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
      if (granted) startTracking({ onUpdate: (pos) => { lastPosRef.current = pos } })
      refreshSocio?.()
      return res
    } else {
      // OJO: no paramos el tracking hasta confirmar que la desconexión fue OK.
      // Si riderOffline() falla por red, revertimos a online y el GPS/latido deben
      // seguir vivos (si paráramos el tracking antes, quedaría "online + latiendo"
      // pero sin posición, justo lo que este sistema quiere evitar).
      const res = await riderOffline()
      if (!res.ok) {
        setIsOnline(true)
        if (res.sessionDead) {
          setActionError('Tu sesión ha caducado. Vuelve a iniciar sesión.')
          try { await supabase.auth.signOut() } catch (_) {}
        } else {
          setActionError('No se pudo desconectar. Inténtalo de nuevo.')
        }
        return res
      }
      stopTracking()
      setNeedsLocation(false)
      refreshSocio?.()
      return res
    }
  }

  // Reintentar el permiso de ubicación desde el banner. Si se concede y ya
  // estamos online, arranca el tracking y empuja una posición; si sigue
  // denegado, abre los ajustes del sistema para que el usuario lo active.
  const retryLocation = async () => {
    const granted = await requestLocationPermission()
    setNeedsLocation(!granted)
    if (granted) {
      if (isOnline) { startTracking({ onUpdate: (pos) => { lastPosRef.current = pos } }); captureAndPush() }
    } else {
      openLocationSettings()
    }
    return granted
  }

  const clearActionError = () => setActionError(null)

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
    // Funcional: no pisar una pendiente ya mostrada (evita leer estado stale).
    if (pendiente) setAsignacionPendiente((prev) => prev || pendiente)
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
        if (newRow?.estado === 'esperando_aceptacion') {
          // Enriquecer con datos del pedido
          const { data: pedido } = await supabase
            .from('pedidos')
            .select('codigo, total, modo_entrega, direccion_entrega, establecimientos(nombre, direccion)')
            .eq('id', newRow.pedido_id)
            .maybeSingle()
          setAsignacionPendiente({ ...newRow, pedidos: pedido })
        }
      })
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'pedido_asignaciones',
        filter: `socio_id=eq.${socio.id}`,
      }, () => { refreshAsignaciones() })
      .subscribe()
    channelRef.current = ch
    return () => { supabase.removeChannel(ch); channelRef.current = null }
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

  // ─── Latido de presencia mientras online ──────────────────
  // Cada 60s, estando EN SERVICIO, mandamos un latido (rider-heartbeat) aunque el
  // repartidor no se mueva. Mantiene fresco socios.last_location_at para que el
  // cron `auto-offline-socios-inactivos` no lo apague mientras la app siga viva.
  // Si la app se cierra / pierde red / se queda sin batería, los latidos cesan y
  // el cron lo marca offline pasados los minutos de gracia. Va por CapacitorHttp
  // (capa nativa) para resistir el throttling del WebView en segundo plano.
  useEffect(() => {
    if (!isOnline) return
    // Latido inmediato al ponerse online + cada 60s.
    const beat = () => {
      const p = lastPosRef.current
      riderHeartbeat(p ? { latitud: p.latitud, longitud: p.longitud } : {})
    }
    beat()
    const id = setInterval(beat, 60_000)
    return () => clearInterval(id)
  }, [isOnline])

  // ─── Dismiss asignación pendiente (tras aceptar/rechazar/timeout) ──
  const dismissPendiente = () => {
    setAsignacionPendiente(null)
    // refrescar para mover a activas si aceptó
    setTimeout(refreshAsignaciones, 500)
  }

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

  return <RiderCtx.Provider value={value}>{children}</RiderCtx.Provider>
}
