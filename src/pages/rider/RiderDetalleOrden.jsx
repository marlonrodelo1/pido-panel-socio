// RiderDetalleOrden — Detalle del pedido con acciones pickup/deliver/fail.
import { useEffect, useState } from 'react'
import { ArrowLeft, Phone, MapPin, Package, CheckCircle2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { riderPickup, riderDeliver, riderFailDelivery } from '../../lib/riderApi'
import { useRider } from '../../context/RiderContext'
import { colors } from '../../lib/uiStyles'

export default function RiderDetalleOrden({ pedido: initial, onBack }) {
  const { refreshAsignaciones } = useRider() || {}
  const [pedido, setPedido] = useState(initial)
  const [items, setItems] = useState([])
  const [est, setEst] = useState(null)
  const [cliente, setCliente] = useState(null)
  const [busy, setBusy] = useState(null)

  useEffect(() => {
    let cancel = false
    ;(async () => {
      const [itemsRes, estRes, cliRes] = await Promise.all([
        supabase.from('pedido_items').select('*').eq('pedido_id', pedido.id),
        pedido.establecimiento_id
          ? supabase.from('establecimientos').select('nombre, direccion, telefono, logo_url, latitud, longitud').eq('id', pedido.establecimiento_id).maybeSingle()
          : Promise.resolve({ data: null }),
        pedido.usuario_id
          ? supabase.from('usuarios').select('nombre, apellido, telefono').eq('id', pedido.usuario_id).maybeSingle()
          : Promise.resolve({ data: null }),
      ])
      if (cancel) return
      setItems(itemsRes.data || [])
      setEst(estRes.data || null)
      setCliente(cliRes.data || null)
    })()
    return () => { cancel = true }
  }, [pedido.id])

  // Realtime sobre el pedido para reflejar cambios externos
  useEffect(() => {
    const ch = supabase.channel('rider-detalle-' + pedido.id)
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'pedidos',
        filter: `id=eq.${pedido.id}`,
      }, (payload) => setPedido(p => ({ ...p, ...payload.new })))
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [pedido.id])

  async function handlePickup() {
    setBusy('pickup')
    try { await riderPickup(pedido.id) } finally { setBusy(null); refreshAsignaciones?.() }
  }

  async function handleDeliver() {
    setBusy('deliver')
    try { await riderDeliver(pedido.id) } finally { setBusy(null); refreshAsignaciones?.(); onBack?.() }
  }

  async function handleFail() {
    const motivo = window.prompt('Motivo del fallo de entrega:')
    if (!motivo?.trim()) return
    setBusy('fail')
    try { await riderFailDelivery(pedido.id, motivo) } finally { setBusy(null); refreshAsignaciones?.(); onBack?.() }
  }

  const isDelivery = pedido.modo_entrega === 'delivery'
  const total = Number(pedido.total || 0)
  const subtotal = Number(pedido.subtotal || 0)
  const envio = Number(pedido.coste_envio || 0)
  const propina = Number(pedido.propina || 0)

  // Estados visibles del rider:
  //  - recogido: rider llegó a restaurante, está esperando comida → puede marcar "Recogido"
  //  - en_camino: tiene la comida, llevándola → puede marcar "Entregado" o "Fallido"
  const canPickup = pedido.estado === 'recogido'
  const canDeliver = pedido.estado === 'en_camino'

  function abrirMaps(lat, lng, label) {
    if (lat && lng) {
      const url = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`
      window.open(url, '_blank')
    } else if (label) {
      window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(label)}`, '_blank')
    }
  }

  return (
    <div style={{
      paddingTop: 'calc(env(safe-area-inset-top, 0px) + 10px)',
      paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 18px)',
      fontFamily: "'Plus Jakarta Sans', sans-serif",
      background: colors.cream, minHeight: '100vh',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '4px 14px 12px',
      }}>
        <button onClick={onBack} style={{
          width: 36, height: 36, borderRadius: 10, border: 'none',
          background: colors.cream2, color: colors.ink, cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }} aria-label="Volver">
          <ArrowLeft size={18} strokeWidth={2.2} />
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 11, color: colors.stone, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Pedido
          </div>
          <div style={{ fontSize: 17, fontWeight: 800, color: colors.ink, fontFamily: 'ui-monospace, monospace' }}>
            {pedido.codigo}
          </div>
        </div>
        <div style={{
          padding: '5px 11px', borderRadius: 999,
          background: colors.terracottaSoft, color: colors.terracotta2,
          fontSize: 11, fontWeight: 700,
        }}>{pedido.estado}</div>
      </div>

      <div style={{ padding: '0 14px', display: 'flex', flexDirection: 'column', gap: 12 }}>

        {/* Restaurante */}
        {est && (
          <Card>
            <SectionLabel>Restaurante</SectionLabel>
            <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
              <div style={{
                width: 46, height: 46, borderRadius: '50%',
                background: colors.cream2, overflow: 'hidden', flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                {est.logo_url
                  ? <img src={est.logo_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  : '🍽️'}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: colors.ink }}>{est.nombre}</div>
                <button onClick={() => abrirMaps(est.latitud, est.longitud, est.direccion)} style={{
                  background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                  color: colors.terracotta, fontSize: 11, fontWeight: 600,
                  fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 4, marginTop: 2,
                }}>
                  <MapPin size={11} strokeWidth={2.2} /> Cómo llegar
                </button>
              </div>
              {est.telefono && (
                <a href={`tel:${est.telefono}`} aria-label="Llamar restaurante" style={callBtnStyle}>
                  <Phone size={16} strokeWidth={2.4} />
                </a>
              )}
            </div>
          </Card>
        )}

        {/* Cliente / Entrega */}
        {isDelivery && (
          <Card>
            <SectionLabel>Entregar a</SectionLabel>
            <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
              <div style={{
                width: 46, height: 46, borderRadius: '50%',
                background: colors.terracottaSoft, color: colors.terracotta,
                fontWeight: 800, fontSize: 16,
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              }}>
                {cliente?.nombre?.[0]?.toUpperCase() || '👤'}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: colors.ink }}>
                  {cliente?.nombre} {cliente?.apellido}
                </div>
                <div style={{ fontSize: 12, color: colors.stone, marginTop: 1, lineHeight: 1.4 }}>
                  {pedido.direccion_entrega}
                </div>
                <button onClick={() => abrirMaps(pedido.lat_entrega, pedido.lng_entrega, pedido.direccion_entrega)} style={{
                  background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                  color: colors.terracotta, fontSize: 11, fontWeight: 600,
                  fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 4, marginTop: 4,
                }}>
                  <MapPin size={11} strokeWidth={2.2} /> Navegar al destino
                </button>
              </div>
              {cliente?.telefono && (
                <a href={`tel:${cliente.telefono}`} aria-label="Llamar cliente" style={callBtnStyle}>
                  <Phone size={16} strokeWidth={2.4} />
                </a>
              )}
            </div>
          </Card>
        )}

        {/* Items */}
        <Card>
          <SectionLabel>Pedido ({items.length})</SectionLabel>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {items.map((it, i) => (
              <div key={i} style={{
                display: 'flex', justifyContent: 'space-between',
                fontSize: 13, color: colors.ink,
              }}>
                <span>
                  {it.cantidad}× <strong>{it.nombre}</strong>
                  {it.tamano && <span style={{ color: colors.stone }}> · {it.tamano}</span>}
                </span>
                <span style={{ color: colors.stone, fontFamily: 'ui-monospace, monospace' }}>
                  {Number(it.precio_unitario * it.cantidad).toFixed(2)}€
                </span>
              </div>
            ))}
          </div>

          <div style={{ height: 1, background: colors.border, margin: '12px 0' }} />

          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
            <Row label="Subtotal" value={subtotal} />
            {envio > 0 && <Row label="Envío" value={envio} />}
            {propina > 0 && <Row label="Propina" value={propina} />}
          </div>

          <div style={{ height: 1, background: colors.border, margin: '12px 0' }} />

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <span style={{ fontSize: 13, color: colors.stone, fontWeight: 600 }}>Total</span>
            <span style={{ fontSize: 19, fontWeight: 800, color: colors.terracotta }}>
              {total.toFixed(2).replace('.', ',')} €
            </span>
          </div>

          <div style={{
            marginTop: 10, padding: '8px 12px', borderRadius: 8,
            background: colors.cream2, fontSize: 11, color: colors.stone, fontWeight: 600,
          }}>
            Pago: {pedido.metodo_pago === 'efectivo' ? '💵 Efectivo (cobra al cliente)' : '💳 Tarjeta (ya pagado)'}
          </div>
        </Card>

        {/* Acciones */}
        {canPickup && (
          <button onClick={handlePickup} disabled={busy} style={primaryBtn(busy)}>
            <Package size={17} strokeWidth={2.4} />
            {busy === 'pickup' ? 'Marcando…' : 'Recogí el pedido'}
          </button>
        )}

        {canDeliver && (
          <>
            <button onClick={handleDeliver} disabled={busy} style={primaryBtn(busy)}>
              <CheckCircle2 size={17} strokeWidth={2.4} />
              {busy === 'deliver' ? 'Marcando…' : 'Entregado al cliente'}
            </button>
            <button onClick={handleFail} disabled={busy} style={{
              ...primaryBtn(busy),
              background: 'transparent',
              color: colors.danger,
              border: `1px solid ${colors.danger}`,
              boxShadow: 'none',
            }}>
              No se pudo entregar
            </button>
          </>
        )}
      </div>
    </div>
  )
}

function Card({ children }) {
  return (
    <div style={{
      background: colors.paper, borderRadius: 14, padding: 14,
      border: `1px solid ${colors.border}`,
    }}>{children}</div>
  )
}

function SectionLabel({ children }) {
  return (
    <div style={{
      fontSize: 10, color: colors.stone, fontWeight: 700,
      textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8,
    }}>{children}</div>
  )
}

function Row({ label, value }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
      <span style={{ color: colors.stone }}>{label}</span>
      <span style={{ color: colors.ink, fontFamily: 'ui-monospace, monospace' }}>
        {Number(value).toFixed(2)}€
      </span>
    </div>
  )
}

const callBtnStyle = {
  width: 38, height: 38, borderRadius: '50%',
  background: colors.sageSoft, color: colors.sage2,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  textDecoration: 'none', flexShrink: 0,
}

function primaryBtn(disabled) {
  return {
    width: '100%', padding: '14px', borderRadius: 14, border: 'none',
    background: `linear-gradient(180deg, ${colors.terracotta}, ${colors.terracotta2})`,
    color: '#fff', fontSize: 15, fontWeight: 800,
    cursor: disabled ? 'wait' : 'pointer', fontFamily: "'Plus Jakarta Sans', sans-serif",
    boxShadow: '0 8px 18px rgba(197,86,44,0.30), inset 0 1px 0 rgba(255,255,255,0.18)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
    opacity: disabled ? 0.65 : 1,
  }
}
