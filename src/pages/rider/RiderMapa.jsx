// Mapa global del rider — usa OpenStreetMap embed (sin API key) y pinta
// rider + restaurantes + entregas activas con un iframe simple. El cliente
// nativo abrira maps://maps.apple.com / Google Maps en deeplinks.

import { useMemo } from 'react'
import { colors, type } from '../../lib/uiStyles'
import { useRider } from '../../context/RiderContext'

export default function RiderMapa() {
  const { pos, asignaciones } = useRider()

  const center = pos || (asignaciones[0]?.pedidos?.establecimientos
    ? { lat: asignaciones[0].pedidos.establecimientos.latitud, lng: asignaciones[0].pedidos.establecimientos.longitud }
    : null)

  const url = useMemo(() => {
    if (!center) return null
    const d = 0.02
    const bbox = `${center.lng - d},${center.lat - d},${center.lng + d},${center.lat + d}`
    const marker = `${center.lat},${center.lng}`
    return `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${marker}`
  }, [center?.lat, center?.lng])

  if (!center) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: colors.textMute }}>
        <div style={{ fontSize: type.base, fontWeight: 600, color: colors.text }}>Sin posicion GPS</div>
        <div style={{ fontSize: type.xs, marginTop: 6 }}>Activa la ubicacion del telefono.</div>
      </div>
    )
  }

  return (
    <div style={{ position: 'relative', height: 'calc(100vh - 56px - 70px - env(safe-area-inset-bottom))' }}>
      <iframe title="Mapa rider" src={url} style={{ width: '100%', height: '100%', border: 0 }} />
      <div style={{
        position: 'absolute', bottom: 12, left: 12, right: 12,
        background: colors.surface, padding: '10px 14px',
        borderRadius: 12, border: `1px solid ${colors.border}`, boxShadow: colors.shadowMd,
      }}>
        <div style={{ fontSize: type.xs, fontWeight: 700, color: colors.text }}>
          {asignaciones.length === 0 ? 'Esperando pedidos…' : `${asignaciones.length} pedido${asignaciones.length > 1 ? 's' : ''} activo${asignaciones.length > 1 ? 's' : ''}`}
        </div>
        <div style={{ fontSize: type.xxs, color: colors.textMute, marginTop: 2 }}>
          {center.lat.toFixed(4)}, {center.lng.toFixed(4)}
        </div>
      </div>
    </div>
  )
}
