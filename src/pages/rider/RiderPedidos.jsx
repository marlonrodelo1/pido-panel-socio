// RiderPedidos — Lista de pedidos activos del rider para click → detalle.
import { ChevronRight, Bike, ShoppingBag } from 'lucide-react'
import { useRider } from '../../context/RiderContext'
import { colors } from '../../lib/uiStyles'

const ESTADO_LABEL = {
  recogido: 'Recogido',
  en_camino: 'En camino',
}

export default function RiderPedidos({ onOpenPedido }) {
  const { asignacionesActivas } = useRider() || {}

  return (
    <div style={{
      padding: '16px 16px calc(80px + env(safe-area-inset-bottom, 0px))',
      fontFamily: "'Plus Jakarta Sans', sans-serif",
    }}>
      <h1 style={{
        fontSize: 22, fontWeight: 800, color: colors.ink,
        margin: '4px 0 14px', letterSpacing: '-0.02em',
      }}>Pedidos activos</h1>

      {(!asignacionesActivas || asignacionesActivas.length === 0) ? (
        <div style={{
          padding: 24, textAlign: 'center', color: colors.stone,
          background: colors.paper, borderRadius: 14,
          border: `1px dashed ${colors.border}`,
        }}>
          <div style={{ fontSize: 14, fontWeight: 600 }}>Sin pedidos en curso</div>
          <div style={{ fontSize: 12, marginTop: 4 }}>
            Cuando aceptes uno aparecerá aquí.
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {asignacionesActivas.map(p => {
            const total = Number(p.total || 0)
            const isDelivery = p.modo_entrega === 'delivery'
            return (
              <button
                key={p.id}
                onClick={() => onOpenPedido?.(p)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: 14, borderRadius: 14, border: 'none',
                  background: colors.paper, cursor: 'pointer',
                  textAlign: 'left', fontFamily: 'inherit',
                  borderLeft: `3px solid ${colors.terracotta}`,
                }}
              >
                <div style={{
                  width: 42, height: 42, borderRadius: '50%',
                  background: colors.terracottaSoft, color: colors.terracotta,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {isDelivery
                    ? <Bike size={18} strokeWidth={2.2} />
                    : <ShoppingBag size={18} strokeWidth={2.2} />}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: 14, fontWeight: 800, color: colors.ink,
                    fontFamily: 'ui-monospace, monospace',
                  }}>{p.codigo}</div>
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    fontSize: 11, color: colors.stone, marginTop: 3, fontWeight: 600,
                  }}>
                    <span style={{
                      background: colors.cream2, padding: '2px 7px', borderRadius: 999,
                    }}>{ESTADO_LABEL[p.estado] || p.estado}</span>
                    <span>{total.toFixed(2).replace('.', ',')} €</span>
                  </div>
                </div>
                <ChevronRight size={18} color={colors.stone2} strokeWidth={2.2} />
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
