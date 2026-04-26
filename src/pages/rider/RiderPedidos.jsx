// Lista de pedidos activos del rider. Tap a la card abre el detalle.

import { colors, type, ds } from '../../lib/uiStyles'
import { useRider } from '../../context/RiderContext'

function fmtTime(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', hour12: true })
}

function fmtDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' })
}

function openMaps(lat, lng) {
  if (typeof window === 'undefined' || !lat || !lng) return
  const ua = navigator.userAgent || ''
  const isIOS = /iPad|iPhone|iPod/.test(ua)
  const url = isIOS ? `maps:?daddr=${lat},${lng}` : `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`
  window.open(url, '_blank')
}

export default function RiderPedidos({ onOpenDetalle }) {
  const { asignaciones } = useRider()

  if (!asignaciones || asignaciones.length === 0) {
    return (
      <div style={{ padding: '40px 20px', textAlign: 'center', color: colors.textMute }}>
        <div style={{ fontSize: type.base, fontWeight: 600, color: colors.text, marginBottom: 6 }}>Sin pedidos activos</div>
        <div style={{ fontSize: type.xs }}>Cuando recibas un pedido aparecerá aquí.</div>
      </div>
    )
  }

  return (
    <div style={{ padding: '12px 14px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      {asignaciones.map((a) => {
        const ped = a.pedidos
        const est = ped?.establecimientos
        const recogido = !!a.recogido_at

        const stop = (e) => e.stopPropagation()

        return (
          <div key={a.id} role="button" onClick={() => onOpenDetalle?.(a.id)} style={{
            ...ds.card, padding: 14, cursor: 'pointer', userSelect: 'none',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{
                ...ds.badge,
                background: recogido ? colors.infoSoft : colors.statePrepSoft,
                color: recogido ? colors.info : colors.statePrep,
              }}>
                {recogido ? 'En camino' : 'Iniciada'}
              </span>
              <div style={{ display: 'flex', gap: 8 }} onClick={stop}>
                <button title="Navegar" onClick={(e) => {
                  stop(e)
                  const lat = recogido ? ped?.lat_entrega : est?.latitud
                  const lng = recogido ? ped?.lng_entrega : est?.longitud
                  openMaps(lat, lng)
                }} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: colors.textMute, padding: 6 }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg>
                </button>
                {est?.telefono && (
                  <a href={`tel:${est.telefono}`} onClick={stop} style={{ color: colors.textMute, padding: 6, lineHeight: 0 }}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.13.96.37 1.9.72 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.91.35 1.85.59 2.81.72A2 2 0 0122 16.92z"/></svg>
                  </a>
                )}
              </div>
            </div>

            <div style={{ fontSize: type.xs, color: colors.textMute, marginBottom: 8 }}>
              #{ped?.codigo}
            </div>

            <div style={{ display: 'flex', gap: 10, marginBottom: 8 }}>
              <span style={{ marginTop: 4, width: 10, height: 10, borderRadius: 5, border: `2px solid ${colors.text}`, flexShrink: 0 }} />
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <div style={{ fontSize: type.sm, fontWeight: 700, color: colors.text }}>{est?.nombre}</div>
                  <div style={{ fontSize: type.xs, color: colors.textMute, textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {fmtTime(ped?.created_at)}<br/>{fmtDate(ped?.created_at)}
                  </div>
                </div>
                <div style={{ fontSize: type.xs, color: colors.textMute, marginTop: 2 }}>{est?.direccion}</div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <span style={{ marginTop: 4, width: 12, height: 16, background: colors.primary, borderRadius: '50% 50% 50% 0', transform: 'rotate(-45deg)', flexShrink: 0 }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: type.sm, fontWeight: 700, color: colors.text }}>{ped?.direccion_entrega || '—'}</div>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
