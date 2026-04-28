// Pantalla idle del rider: mapa Google con su posicion + restaurantes
// vinculados al socio + asignaciones activas. Banner inferior con estado.
// Al tocar un restaurante muestra un circulo con su radio de cobertura.

import { useEffect, useRef, useState } from 'react'
import { colors, type } from '../../lib/uiStyles'
import { useRider } from '../../context/RiderContext'
import { useSocio } from '../../context/SocioContext'
import { supabase } from '../../lib/supabase'
import { loadGoogleMaps } from '../../lib/googleMaps'
import { emojiIcon, imageRoundIcon } from '../../lib/mapMarkers'
import { getCurrentPosition } from '../../lib/riderGeo'
import { formatTarifa } from '../../lib/tarifas'

export default function RiderEsperando({ onGoPedidos }) {
  const { socio } = useSocio()
  const { pos: ridPos, online, asignaciones } = useRider()
  const mapDivRef = useRef(null)
  const mapRef = useRef(null)
  const markersRef = useRef({ rider: null, rests: [], pedidos: [] })
  const radioCircleRef = useRef(null)
  const [restaurantes, setRestaurantes] = useState([])
  const [selectedRestId, setSelectedRestId] = useState(null)
  // Posicion local: prefiere la del context (live), si no la pide al GPS al
  // montar para mostrar el marker incluso cuando el rider no esta "online".
  const [localPos, setLocalPos] = useState(null)
  const pos = ridPos || localPos

  // Cargar restaurantes vinculados al socio + tarifa pactada del par.
  // En 2 pasos para evitar problemas con el inner join anidado de PostgREST
  // que silenciaba resultados cuando una de las dos tablas falla.
  useEffect(() => {
    if (!socio?.id) return
    let cancel = false
    ;(async () => {
      // Paso 1: vinculaciones activas (con tarifa)
      const { data: vinc, error: errV } = await supabase
        .from('socio_establecimiento')
        .select('establecimiento_id, tarifa_base, tarifa_radio_base_km, tarifa_precio_km, tarifa_maxima')
        .eq('socio_id', socio.id)
        .eq('estado', 'activa')
      if (cancel) return
      try {
        await supabase.from('push_debug_logs').insert({
          platform: 'rider-app', event: 'mapa:vinc_load',
          details: JSON.stringify({ count: vinc?.length || 0, error: errV?.message || null }).slice(0, 1000),
        })
      } catch (_) {}
      const ids = (vinc || []).map((v) => v.establecimiento_id).filter(Boolean)
      if (ids.length === 0) { setRestaurantes([]); return }

      // Paso 2: traer datos de los establecimientos
      const { data: ests, error: errE } = await supabase
        .from('establecimientos')
        .select('id, nombre, latitud, longitud, activo, logo_url, radio_cobertura_km')
        .in('id', ids)
      if (cancel) return
      try {
        await supabase.from('push_debug_logs').insert({
          platform: 'rider-app', event: 'mapa:rests_load',
          details: JSON.stringify({
            count: ests?.length || 0,
            con_coords: (ests || []).filter((e) => e.latitud && e.longitud).length,
            error: errE?.message || null,
          }).slice(0, 1000),
        })
      } catch (_) {}

      // Combinar tarifa de la vinculacion + datos del establecimiento
      const tarifaPorId = new Map((vinc || []).map((v) => [v.establecimiento_id, v]))
      const rests = (ests || [])
        .filter((e) => e.activo && e.latitud != null && e.longitud != null)
        .map((e) => {
          const t = tarifaPorId.get(e.id) || {}
          return {
            ...e,
            tarifa_base: t.tarifa_base,
            tarifa_radio_base_km: t.tarifa_radio_base_km,
            tarifa_precio_km: t.tarifa_precio_km,
            tarifa_maxima: t.tarifa_maxima,
          }
        })
      setRestaurantes(rests)
    })()
    return () => { cancel = true }
  }, [socio?.id])

  // GPS resilient: arrancamos un watchPosition propio mientras el rider esta
  // en este mapa, asi obtenemos la primera lectura cuando llegue (incluso si
  // el GPS estaba frio) y vamos refrescando si se mueve. Se libera al salir.
  // Si ya tenemos pos del context (rider online) NO arrancamos watcher
  // duplicado: el context ya esta empujando posiciones.
  const [gpsBuscando, setGpsBuscando] = useState(false)
  useEffect(() => {
    if (ridPos) { setGpsBuscando(false); return }
    if (typeof window === 'undefined') return
    let cancelled = false
    let watcherId = null
    let capRef = null
    setGpsBuscando(true)
    ;(async () => {
      try {
        // Cargar plugin Capacitor Geolocation
        const { Capacitor } = await import('@capacitor/core')
        if (Capacitor.getPlatform() === 'web') {
          // En web usar navigator.geolocation directamente con watch
          if (!('geolocation' in navigator)) return
          watcherId = navigator.geolocation.watchPosition(
            (p) => {
              if (cancelled || !p?.coords) return
              setLocalPos({ lat: p.coords.latitude, lng: p.coords.longitude })
              setGpsBuscando(false)
            },
            () => {},
            { enableHighAccuracy: true, timeout: 30000, maximumAge: 30000 },
          )
          return
        }
        const mod = await import('@capacitor/geolocation')
        const Geo = mod.Geolocation
        capRef = Geo
        watcherId = await Geo.watchPosition(
          { enableHighAccuracy: true, timeout: 30000 },
          (position, err) => {
            if (cancelled) return
            if (err) return
            if (!position?.coords) return
            setLocalPos({ lat: position.coords.latitude, lng: position.coords.longitude })
            setGpsBuscando(false)
          },
        )
      } catch (_) {
        if (!cancelled) setGpsBuscando(false)
      }
    })()
    return () => {
      cancelled = true
      try {
        if (watcherId != null) {
          if (capRef) capRef.clearWatch({ id: watcherId })
          else if (typeof navigator !== 'undefined') navigator.geolocation.clearWatch(watcherId)
        }
      } catch (_) {}
    }
  }, [ridPos])

  // Inicializar mapa
  useEffect(() => {
    if (!mapDivRef.current || mapRef.current) return
    const center = pos
      ? { lat: pos.lat, lng: pos.lng }
      : restaurantes[0]
        ? { lat: restaurantes[0].latitud, lng: restaurantes[0].longitud }
        : { lat: 28.4148, lng: -16.5477 } // Tenerife default
    let cancel = false
    loadGoogleMaps().then((maps) => {
      if (cancel || !mapDivRef.current || mapRef.current) return
      mapRef.current = new maps.Map(mapDivRef.current, {
        center, zoom: 13,
        disableDefaultUI: true, zoomControl: true, gestureHandling: 'greedy',
        clickableIcons: false,
        styles: [{ featureType: 'poi', elementType: 'labels', stylers: [{ visibility: 'off' }] }],
      })
      // Tocar fuera de un marker -> cerrar circulo
      mapRef.current.addListener('click', () => setSelectedRestId(null))
    }).catch((e) => console.warn('[esperando] gmaps load fail', e?.message))
    return () => { cancel = true }
  }, [])

  // Marcar restaurantes (logo redondo o emoji) — con click listener
  useEffect(() => {
    if (!mapRef.current || !window.google?.maps) return
    const maps = window.google.maps
    markersRef.current.rests.forEach((m) => m.setMap(null))
    markersRef.current.rests = []
    ;(async () => {
      const newMarkers = []
      for (const r of restaurantes) {
        const icon = r.logo_url
          ? await imageRoundIcon(r.logo_url, '#FF6B2C')
          : emojiIcon('🍽️', '#FF6B2C')
        if (!mapRef.current) return
        const m = new maps.Marker({
          position: { lat: r.latitud, lng: r.longitud },
          map: mapRef.current, title: r.nombre,
          icon,
        })
        // Click en el marker: toggle del circulo de radio
        m.addListener('click', () => {
          setSelectedRestId((prev) => (prev === r.id ? null : r.id))
        })
        m._restId = r.id
        newMarkers.push(m)
      }
      markersRef.current.rests = newMarkers
    })()
  }, [restaurantes])

  // Mostrar/ocultar circulo de radio cuando cambia selectedRestId
  useEffect(() => {
    if (!mapRef.current || !window.google?.maps) return
    const maps = window.google.maps
    // Limpiar circulo anterior siempre
    if (radioCircleRef.current) {
      radioCircleRef.current.setMap(null)
      radioCircleRef.current = null
    }
    if (!selectedRestId) return
    const rest = restaurantes.find((r) => r.id === selectedRestId)
    if (!rest) return
    const radioKm = Number(rest.radio_cobertura_km) || 3
    radioCircleRef.current = new maps.Circle({
      map: mapRef.current,
      center: { lat: rest.latitud, lng: rest.longitud },
      radius: radioKm * 1000, // Circle.radius en metros
      strokeColor: '#FF6B2C',
      strokeOpacity: 0.85,
      strokeWeight: 2,
      fillColor: '#FF6B2C',
      fillOpacity: 0.15,
      clickable: false,
    })
    // Encuadrar el circulo al elegir
    try {
      const bounds = radioCircleRef.current.getBounds()
      if (bounds) mapRef.current.fitBounds(bounds, 80)
    } catch (_) {}
  }, [selectedRestId, restaurantes])

  // Marcar pedidos (casa cliente)
  useEffect(() => {
    if (!mapRef.current || !window.google?.maps) return
    const maps = window.google.maps
    markersRef.current.pedidos.forEach((m) => m.setMap(null))
    markersRef.current.pedidos = asignaciones
      .filter((a) => a.pedidos?.lat_entrega && a.pedidos?.lng_entrega)
      .map((a) => new maps.Marker({
        position: { lat: a.pedidos.lat_entrega, lng: a.pedidos.lng_entrega },
        map: mapRef.current,
        title: `Pedido #${a.pedidos.codigo}`,
        icon: emojiIcon('🏠', '#1F1F1E'),
      }))
  }, [asignaciones])

  // Marcador propio del rider: logo del socio si existe, si no emoji moto
  useEffect(() => {
    if (!mapRef.current || !window.google?.maps || !pos) return
    const maps = window.google.maps
    const p = { lat: pos.lat, lng: pos.lng }
    let cancel = false
    ;(async () => {
      const icon = socio?.logo_url
        ? await imageRoundIcon(socio.logo_url, '#16A34A')
        : emojiIcon('🛵', '#16A34A')
      if (cancel || !mapRef.current) return
      if (!markersRef.current.rider) {
        markersRef.current.rider = new maps.Marker({
          position: p, map: mapRef.current, title: socio?.nombre || 'Tú',
          icon, zIndex: 999,
        })
      } else {
        markersRef.current.rider.setPosition(p)
        markersRef.current.rider.setIcon(icon)
      }
    })()
    return () => { cancel = true }
  }, [pos?.lat, pos?.lng, socio?.logo_url, socio?.nombre])

  // Auto-fit cuando cambia el conjunto de markers (sin pisar el fitBounds del circulo)
  useEffect(() => {
    if (!mapRef.current || !window.google?.maps || selectedRestId) return
    const maps = window.google.maps
    try {
      const bounds = new maps.LatLngBounds()
      if (markersRef.current.rider) bounds.extend(markersRef.current.rider.getPosition())
      markersRef.current.rests.forEach((m) => bounds.extend(m.getPosition()))
      markersRef.current.pedidos.forEach((m) => bounds.extend(m.getPosition()))
      if (!bounds.isEmpty()) mapRef.current.fitBounds(bounds, 60)
    } catch (_) {}
  }, [pos?.lat, pos?.lng, restaurantes.length, asignaciones.length, selectedRestId])

  const tienePedidos = asignaciones.length > 0
  const labelPedidos = asignaciones.length === 1 ? 'pedido en espera' : 'pedidos en espera'
  const restSeleccionado = selectedRestId ? restaurantes.find((r) => r.id === selectedRestId) : null

  return (
    <div style={{
      position: 'relative',
      // Compensa header rider (incluye safe-area-top) + bottom nav rider (70 + safe-area-bottom)
      height: 'calc(100vh - 56px - env(safe-area-inset-top) - 70px - env(safe-area-inset-bottom))',
    }}>
      <div ref={mapDivRef} style={{ position: 'absolute', inset: 0, background: '#E8E6E0' }} />

      {/* Banner superior: instruccion o info del restaurante seleccionado */}
      <div style={{ position: 'absolute', top: 12, left: 12, right: 12, zIndex: 5 }}>
        {restSeleccionado ? (
          <div style={{
            background: colors.surface, padding: '10px 14px',
            borderRadius: 12, border: `1px solid ${colors.primaryBorder}`,
            boxShadow: colors.shadowMd, display: 'flex', alignItems: 'flex-start', gap: 10,
          }}>
            <div style={{
              width: 8, height: 8, borderRadius: 4, background: colors.primary,
              flexShrink: 0, marginTop: 6,
            }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: type.sm, fontWeight: 700, color: colors.text,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {restSeleccionado.nombre}
                {' · '}
                <span style={{ color: colors.primary }}>
                  {Number(restSeleccionado.radio_cobertura_km) || 3} km
                </span>
              </div>
              <div style={{ fontSize: type.xs, color: colors.textMute, marginTop: 2,
                lineHeight: 1.35 }}>
                <span style={{ fontWeight: 600, color: colors.text }}>Te paga: </span>
                {formatTarifa({
                  tarifa_base: restSeleccionado.tarifa_base,
                  tarifa_radio_base_km: restSeleccionado.tarifa_radio_base_km,
                  tarifa_precio_km: restSeleccionado.tarifa_precio_km,
                  tarifa_maxima: restSeleccionado.tarifa_maxima,
                })}
              </div>
            </div>
            <button onClick={() => setSelectedRestId(null)} style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              padding: 4, color: colors.textMute, display: 'inline-flex',
              marginTop: 2,
            }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="2.4" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        ) : (
          <div style={{
            background: 'rgba(255,255,255,0.95)', padding: '10px 14px',
            borderRadius: 12, border: `1px solid ${colors.border}`,
            boxShadow: colors.shadowMd, fontSize: type.xs,
            color: colors.textMute, textAlign: 'center', fontWeight: 600,
          }}>
            Toca un restaurante para ver su radio de entrega
          </div>
        )}
      </div>

      {!pos && (
        <div style={{
          position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
          background: 'rgba(255,255,255,0.95)', padding: '12px 18px', borderRadius: 12,
          fontSize: type.xs, color: colors.textMute, textAlign: 'center',
          boxShadow: colors.shadowMd, display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <span style={{
            width: 8, height: 8, borderRadius: 4,
            background: gpsBuscando ? colors.primary : colors.danger,
            animation: gpsBuscando ? 'pidoo-pulse 1.4s ease-in-out infinite' : 'none',
          }} />
          {gpsBuscando ? 'Buscando tu ubicación…' : 'Activa la ubicación del teléfono'}
          <style>{`@keyframes pidoo-pulse { 0%, 100% { opacity: 1 } 50% { opacity: 0.3 } }`}</style>
        </div>
      )}

      <div style={{ position: 'absolute', bottom: 16, left: 12, right: 12 }}>
        {!online ? (
          <div style={{
            background: colors.surface, padding: '14px 18px', textAlign: 'center',
            borderRadius: 12, border: `1px solid ${colors.border}`, boxShadow: colors.shadowMd,
            fontSize: type.sm, fontWeight: 700, color: colors.danger,
          }}>
            Estás fuera de línea
          </div>
        ) : tienePedidos ? (
          <button onClick={onGoPedidos} style={{
            width: '100%', background: colors.surface, padding: '14px 18px',
            borderRadius: 12, border: `1px solid ${colors.primaryBorder}`, boxShadow: colors.shadowMd,
            cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            gap: 12, fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
          }}>
            <div style={{ flex: 1, textAlign: 'left', overflow: 'hidden', display: 'flex', alignItems: 'baseline', gap: 10 }}>
              <span style={{
                fontSize: 32, lineHeight: 1, fontWeight: 800,
                color: colors.primary, letterSpacing: '-0.5px',
                flexShrink: 0,
              }}>
                {asignaciones.length}
              </span>
              <span style={{
                fontSize: type.sm, fontWeight: 600,
                color: colors.text, overflow: 'hidden',
                textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {labelPedidos}
              </span>
            </div>
            <span style={{
              fontSize: 22, color: colors.primary, fontWeight: 800,
              flexShrink: 0, lineHeight: 1,
            }}>→</span>
          </button>
        ) : (
          <div style={{
            background: colors.surface, padding: '14px 18px', textAlign: 'center',
            borderRadius: 12, border: `1px solid ${colors.border}`, boxShadow: colors.shadowMd,
            fontSize: type.sm, fontWeight: 700, color: colors.text,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            width: '100%', boxSizing: 'border-box',
          }}>
            <span style={{
              width: 8, height: 8, borderRadius: 4,
              background: colors.primary,
              animation: 'pidoo-pulse 1.4s ease-in-out infinite',
            }} />
            Esperando pedidos…
            <style>{`@keyframes pidoo-pulse { 0%, 100% { opacity: 1 } 50% { opacity: 0.3 } }`}</style>
          </div>
        )}
      </div>
    </div>
  )
}
