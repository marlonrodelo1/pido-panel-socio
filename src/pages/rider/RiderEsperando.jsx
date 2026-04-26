// Pantalla idle del rider: mapa Google con su posicion + restaurantes
// vinculados al socio + asignaciones activas. Banner inferior con estado.

import { useEffect, useRef, useState } from 'react'
import { colors, type } from '../../lib/uiStyles'
import { useRider } from '../../context/RiderContext'
import { useSocio } from '../../context/SocioContext'
import { supabase } from '../../lib/supabase'
import { loadGoogleMaps } from '../../lib/googleMaps'
import { emojiIcon, imageRoundIcon } from '../../lib/mapMarkers'

export default function RiderEsperando({ onGoPedidos }) {
  const { socio } = useSocio()
  const { pos, online, asignaciones } = useRider()
  const mapDivRef = useRef(null)
  const mapRef = useRef(null)
  const markersRef = useRef({ rider: null, rests: [], pedidos: [] })
  const [restaurantes, setRestaurantes] = useState([])
  // mapReady fuerza un re-render cuando el mapa esta listo, para que los
  // efectos de marcadores se vuelvan a disparar aunque sus datos ya estuvieran
  // cargados antes que la API de Google.
  const [mapReady, setMapReady] = useState(false)

  // Cargar restaurantes vinculados al socio
  useEffect(() => {
    if (!socio?.id) return
    let cancel = false
    ;(async () => {
      const { data: vinc } = await supabase
        .from('socio_establecimiento')
        .select('establecimiento_id, establecimientos!inner(id, nombre, latitud, longitud, activo, estado, logo_url)')
        .eq('socio_id', socio.id)
        .eq('estado', 'activa')
      if (cancel) return
      const rests = (vinc || [])
        .map((v) => v.establecimientos)
        .filter((e) => e && e.activo && e.latitud && e.longitud)
      setRestaurantes(rests)
    })()
    return () => { cancel = true }
  }, [socio?.id])

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
      setMapReady(true)
    }).catch((e) => console.warn('[esperando] gmaps load fail', e?.message))
    return () => { cancel = true }
  }, [])

  // Marcar restaurantes (logo redondo o emoji)
  useEffect(() => {
    if (!mapReady || !mapRef.current || !window.google?.maps) return
    const maps = window.google.maps
    markersRef.current.rests.forEach((m) => m.setMap(null))
    markersRef.current.rests = []
    let cancel = false
    ;(async () => {
      const newMarkers = []
      for (const r of restaurantes) {
        const icon = r.logo_url
          ? await imageRoundIcon(r.logo_url, '#FF6B2C')
          : emojiIcon('🍽️', '#FF6B2C')
        if (cancel || !mapRef.current) return
        newMarkers.push(new maps.Marker({
          position: { lat: r.latitud, lng: r.longitud },
          map: mapRef.current, title: r.nombre,
          icon,
        }))
      }
      if (!cancel) markersRef.current.rests = newMarkers
    })()
    return () => { cancel = true }
  }, [mapReady, restaurantes])

  // Marcar pedidos (casa cliente)
  useEffect(() => {
    if (!mapReady || !mapRef.current || !window.google?.maps) return
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
  }, [mapReady, asignaciones])

  // Marcador propio (rider con emoji moto)
  useEffect(() => {
    if (!mapReady || !mapRef.current || !window.google?.maps || !pos) return
    const maps = window.google.maps
    const p = { lat: pos.lat, lng: pos.lng }
    if (!markersRef.current.rider) {
      markersRef.current.rider = new maps.Marker({
        position: p, map: mapRef.current, title: 'Tú',
        icon: emojiIcon('🛵', '#16A34A'),
        zIndex: 999,
      })
    } else {
      markersRef.current.rider.setPosition(p)
    }
    try {
      const bounds = new maps.LatLngBounds()
      if (markersRef.current.rider) bounds.extend(markersRef.current.rider.getPosition())
      markersRef.current.rests.forEach((m) => bounds.extend(m.getPosition()))
      markersRef.current.pedidos.forEach((m) => bounds.extend(m.getPosition()))
      if (!bounds.isEmpty()) mapRef.current.fitBounds(bounds, 60)
    } catch (_) {}
  }, [mapReady, pos?.lat, pos?.lng, restaurantes.length, asignaciones.length])

  const tienePedidos = asignaciones.length > 0
  const txtPedidos = asignaciones.length === 1 ? '1 pedido en espera' : `${asignaciones.length} pedidos en espera`

  return (
    <div style={{ position: 'relative', height: 'calc(100vh - 56px - 70px - env(safe-area-inset-bottom))' }}>
      <div ref={mapDivRef} style={{ position: 'absolute', inset: 0, background: '#E8E6E0' }} />

      {!pos && (
        <div style={{
          position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
          background: 'rgba(255,255,255,0.95)', padding: '12px 18px', borderRadius: 12,
          fontSize: type.xs, color: colors.textMute, textAlign: 'center',
          boxShadow: colors.shadowMd,
        }}>
          Activa la ubicación del teléfono…
        </div>
      )}

      <div style={{ position: 'absolute', bottom: 12, left: 12, right: 12 }}>
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
            width: '100%', background: colors.surface, padding: '14px 16px',
            borderRadius: 12, border: `1px solid ${colors.border}`, boxShadow: colors.shadowMd,
            cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            gap: 10,
          }}>
            <div style={{ flex: 1, textAlign: 'left', overflow: 'hidden' }}>
              <div style={{ fontSize: type.xxs, fontWeight: 700, color: colors.textMute, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Tienes
              </div>
              <div style={{ fontSize: type.base, fontWeight: 800, color: colors.primary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {txtPedidos}
              </div>
            </div>
            <span style={{ fontSize: type.lg, color: colors.primary, fontWeight: 800, flexShrink: 0 }}>→</span>
          </button>
        ) : (
          <div style={{
            background: colors.surface, padding: '14px 18px', textAlign: 'center',
            borderRadius: 12, border: `1px solid ${colors.border}`, boxShadow: colors.shadowMd,
            fontSize: type.sm, fontWeight: 700, color: colors.text,
          }}>
            Esperando pedidos…
          </div>
        )}
      </div>
    </div>
  )
}
