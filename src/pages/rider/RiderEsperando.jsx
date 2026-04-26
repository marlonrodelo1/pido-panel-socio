// Pantalla de idle: rider online sin pedidos. Muestra posicion centrada y
// banner "Esperando pedidos...".

import { useMemo } from 'react'
import { colors, type } from '../../lib/uiStyles'
import { useRider } from '../../context/RiderContext'

export default function RiderEsperando() {
  const { pos, online, asignaciones } = useRider()

  const url = useMemo(() => {
    if (!pos) return null
    const d = 0.005
    const bbox = `${pos.lng - d},${pos.lat - d},${pos.lng + d},${pos.lat + d}`
    return `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${pos.lat},${pos.lng}`
  }, [pos?.lat, pos?.lng])

  return (
    <div style={{ position: 'relative', height: 'calc(100vh - 56px - 70px - env(safe-area-inset-bottom))' }}>
      {url && <iframe title="Esperando" src={url} style={{ width: '100%', height: '100%', border: 0 }} />}
      <div style={{
        position: 'absolute', bottom: 12, left: 12, right: 12,
        background: colors.surface, padding: '14px 18px', textAlign: 'center',
        borderRadius: 12, border: `1px solid ${colors.border}`, boxShadow: colors.shadowMd,
      }}>
        {!online && <div style={{ fontSize: type.sm, fontWeight: 700, color: colors.danger }}>Estás fuera de línea</div>}
        {online && asignaciones.length === 0 && <div style={{ fontSize: type.sm, fontWeight: 700, color: colors.text }}>Esperando pedidos…</div>}
        {online && asignaciones.length > 0 && <div style={{ fontSize: type.sm, fontWeight: 700, color: colors.primary }}>Tienes {asignaciones.length} pedido{asignaciones.length > 1 ? 's' : ''} activo{asignaciones.length > 1 ? 's' : ''}</div>}
      </div>
    </div>
  )
}
