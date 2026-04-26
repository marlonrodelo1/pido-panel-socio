// Pantalla de idle/standby. Mapa + banner inferior. Si hay pedidos activos,
// el banner pasa a CTA naranja y al tocar lleva a la lista de Pedidos.

import { useMemo } from 'react'
import { colors, type } from '../../lib/uiStyles'
import { useRider } from '../../context/RiderContext'

export default function RiderEsperando({ onGoPedidos }) {
  const { pos, online, asignaciones } = useRider()

  const url = useMemo(() => {
    if (!pos) return null
    const d = 0.005
    const bbox = `${pos.lng - d},${pos.lat - d},${pos.lng + d},${pos.lat + d}`
    return `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${pos.lat},${pos.lng}`
  }, [pos?.lat, pos?.lng])

  const tienePedidos = asignaciones.length > 0

  return (
    <div style={{ position: 'relative', height: 'calc(100vh - 56px - 70px - env(safe-area-inset-bottom))' }}>
      {url ? (
        <iframe title="Esperando" src={url} style={{ width: '100%', height: '100%', border: 0 }} />
      ) : (
        <div style={{ height: '100%', display: 'grid', placeItems: 'center', background: colors.surface2, color: colors.textMute, fontSize: type.xs }}>
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
            width: '100%', background: colors.surface, padding: '14px 18px', textAlign: 'center',
            borderRadius: 12, border: `1px solid ${colors.border}`, boxShadow: colors.shadowMd,
            fontSize: type.base, fontWeight: 700, color: colors.primary,
            cursor: 'pointer',
          }}>
            Tienes {asignaciones.length} pedido{asignaciones.length > 1 ? 's' : ''} activo{asignaciones.length > 1 ? 's' : ''} →
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
