import { useEffect, useMemo, useState } from 'react'
import { useSocio } from '../context/SocioContext'
import { supabase } from '../lib/supabase'
import { colors, ds, type, stateBadge } from '../lib/uiStyles'

const RANGOS = [
  { id: 'hoy', label: 'Hoy' },
  { id: 'semana', label: 'Semana' },
  { id: 'mes', label: 'Mes' },
  { id: 'todos', label: 'Todos' },
]

const ESTADOS = [
  { id: 'todos', label: 'Todos' },
  { id: 'nuevo', label: 'Nuevo' },
  { id: 'preparando', label: 'Preparando' },
  { id: 'listo', label: 'Listo' },
  { id: 'recogido', label: 'Recogido' },
  { id: 'en_camino', label: 'En camino' },
  { id: 'entregado', label: 'Entregado' },
  { id: 'cancelado', label: 'Cancelado' },
  { id: 'fallido', label: 'Fallido' },
]

const PAGOS = [
  { id: 'todos', label: 'Todos' },
  { id: 'tarjeta', label: 'Tarjeta' },
  { id: 'efectivo', label: 'Efectivo' },
]

function estadoColor(estado) {
  if (estado === 'entregado') return { bg: colors.stateOkSoft, color: colors.stateOk }
  if (estado === 'preparando') return { bg: colors.statePrepSoft, color: colors.statePrep }
  if (estado === 'cancelado' || estado === 'fallido') return { bg: colors.dangerSoft, color: colors.danger }
  if (estado === 'nuevo') return { bg: 'rgba(255,107,44,0.14)', color: colors.primary }
  if (estado === 'en_camino') return { bg: colors.infoSoft, color: colors.info }
  return { bg: colors.stateNeutralSoft, color: colors.stateNeutral }
}

function rangoToDesde(id) {
  if (id === 'todos') return null
  const now = new Date()
  if (id === 'hoy') {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    return d.toISOString()
  }
  if (id === 'semana') {
    const d = new Date(now); d.setDate(d.getDate() - 7)
    return d.toISOString()
  }
  if (id === 'mes') {
    const d = new Date(now); d.setMonth(d.getMonth() - 1)
    return d.toISOString()
  }
  return null
}

export default function Pedidos() {
  const { socio } = useSocio()
  const [pedidos, setPedidos] = useState([])
  const [loading, setLoading] = useState(true)
  const [rango, setRango] = useState('semana')
  const [estado, setEstado] = useState('todos')
  const [pago, setPago] = useState('todos')
  const [detalle, setDetalle] = useState(null)

  useEffect(() => {
    if (!socio?.id) return
    ;(async () => {
      setLoading(true)
      // El socio ve TODOS los pedidos en los que ha trabajado:
      // 1) los de su marketplace (pedidos.socio_id = socio.id)
      // 2) los que ha repartido aunque vengan de pidoo.es (rider_account.socio_id = socio.id)
      // Cogemos el conjunto union: ids de pedidos que cumplan cualquiera.
      const { data: riderAccs } = await supabase
        .from('rider_accounts')
        .select('id')
        .eq('socio_id', socio.id)
      const riderAccIds = (riderAccs || []).map((r) => r.id)

      let pedidoIds = []
      if (riderAccIds.length > 0) {
        // Trae TODOS los pedidos en los que cualquier rider del socio fue
        // asignado (aceptado, rechazado, esperando_aceptacion, etc.).
        // Esto incluye historico de entregados.
        const { data: asigs } = await supabase
          .from('pedido_asignaciones')
          .select('pedido_id')
          .in('rider_account_id', riderAccIds)
        pedidoIds = Array.from(new Set((asigs || []).map((a) => a.pedido_id)))
      }

      let q = supabase
        .from('pedidos')
        .select('id, codigo, estado, metodo_pago, total, created_at, establecimiento:establecimientos(nombre), rider_earnings(neto_rider, coste_envio, propina, comision_rider_sobre_subtotal)')
        .order('created_at', { ascending: false })
        .limit(200)

      if (pedidoIds.length > 0) {
        // Or: socio_id == X OR id IN (...)
        const idList = pedidoIds.map((x) => `"${x}"`).join(',')
        q = q.or(`socio_id.eq.${socio.id},id.in.(${idList})`)
      } else {
        q = q.eq('socio_id', socio.id)
      }

      const desde = rangoToDesde(rango)
      if (desde) q = q.gte('created_at', desde)
      if (estado !== 'todos') q = q.eq('estado', estado)
      if (pago !== 'todos') q = q.eq('metodo_pago', pago)
      const { data } = await q
      // Normalizar: rider_earnings viene como array — aplanar a comision_generada (neto_rider)
      const pedidosNorm = (data || []).map(p => {
        const re = Array.isArray(p.rider_earnings) ? p.rider_earnings[0] : p.rider_earnings
        return {
          ...p,
          comision_generada: re?.neto_rider ?? 0,
          _re_envio: re?.coste_envio ?? 0,
          _re_propina: re?.propina ?? 0,
          _re_comision: re?.comision_rider_sobre_subtotal ?? 0,
        }
      })
      setPedidos(pedidosNorm)
      setLoading(false)
    })()
  }, [socio, rango, estado, pago])

  const resumen = useMemo(() => {
    const total = pedidos.reduce((a, p) => a + Number(p.total || 0), 0)
    const comision = pedidos.reduce((a, p) => a + Number(p.comision_generada || 0), 0)
    return { count: pedidos.length, total, comision }
  }, [pedidos])

  return (
    <div>
      <h1 style={ds.h1}>Pedidos</h1>
      <p style={{ color: colors.textMute, fontSize: type.sm, marginTop: 4, marginBottom: 18 }}>
        Pedidos de tu marketplace y los que has repartido.
      </p>

      {/* Filtros */}
      <div style={{ ...ds.card, padding: 14, marginBottom: 14 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14 }}>
          <FilterGroup label="Fecha" options={RANGOS} value={rango} onChange={setRango} />
          <FilterGroup label="Estado" options={ESTADOS} value={estado} onChange={setEstado} />
          <FilterGroup label="Pago" options={PAGOS} value={pago} onChange={setPago} />
        </div>
        <div style={{
          marginTop: 12, paddingTop: 12, borderTop: `1px solid ${colors.border}`,
          display: 'flex', gap: 20, flexWrap: 'wrap', fontSize: type.xs, color: colors.textMute,
        }}>
          <div><strong style={{ color: colors.text }}>{resumen.count}</strong> pedidos</div>
          <div>Total: <strong style={{ color: colors.text }}>{resumen.total.toFixed(2)} €</strong></div>
          <div>Tu comisión: <strong style={{ color: colors.primary }}>{resumen.comision.toFixed(2)} €</strong></div>
        </div>
      </div>

      {loading ? (
        <div style={{ color: colors.textMute, padding: 20 }}>Cargando…</div>
      ) : pedidos.length === 0 ? (
        <div style={{ ...ds.card, textAlign: 'center', padding: 28 }}>
          <div style={{ fontSize: type.base, fontWeight: 600 }}>Sin pedidos con los filtros actuales</div>
          <div style={{ fontSize: type.sm, color: colors.textMute, marginTop: 4 }}>
            Prueba a ampliar el rango de fechas o quitar filtros.
          </div>
        </div>
      ) : (
        <div style={{ ...ds.card, padding: 0, overflow: 'hidden' }}>
          <div style={{
            display: 'grid', gridTemplateColumns: '100px 1fr 120px 90px 100px 100px 120px',
            padding: '10px 14px', gap: 8,
            fontSize: type.xxs, fontWeight: 700, color: colors.textMute,
            textTransform: 'uppercase', letterSpacing: '0.06em',
            borderBottom: `1px solid ${colors.border}`, background: colors.elev2,
          }}>
            <div>Código</div>
            <div>Restaurante</div>
            <div>Estado</div>
            <div>Pago</div>
            <div>Total</div>
            <div>Comisión</div>
            <div>Fecha</div>
          </div>
          {pedidos.map(p => {
            const ec = estadoColor(p.estado)
            const b = stateBadge(p.estado)
            return (
              <div
                key={p.id}
                onClick={() => setDetalle({ id: p.id })}
                style={{
                  display: 'grid', gridTemplateColumns: '100px 1fr 120px 90px 100px 100px 120px',
                  padding: '10px 14px', gap: 8,
                  fontSize: type.sm, color: colors.textDim,
                  borderBottom: `1px solid ${colors.border}`,
                  alignItems: 'center', cursor: 'pointer',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = colors.elev2 }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
              >
                <div style={{ fontWeight: 600, color: colors.text }}>{p.codigo}</div>
                <div>{p.establecimiento?.nombre || '—'}</div>
                <div>
                  <span style={{
                    display: 'inline-flex', alignItems: 'center',
                    background: ec.bg, color: ec.color,
                    fontSize: type.xxs, fontWeight: 700,
                    padding: '3px 8px', borderRadius: 6,
                    letterSpacing: '0.04em', textTransform: 'uppercase',
                  }}>{b._label}</span>
                </div>
                <div style={{ fontSize: type.xxs, textTransform: 'uppercase', color: colors.textMute }}>{p.metodo_pago || '—'}</div>
                <div>{Number(p.total || 0).toFixed(2)} €</div>
                <div style={{ color: colors.primary, fontWeight: 600 }}>{Number(p.comision_generada || 0).toFixed(2)} €</div>
                <div style={{ color: colors.textMute }}>{new Date(p.created_at).toLocaleDateString('es-ES')}</div>
              </div>
            )
          })}
        </div>
      )}

      {detalle && <DetalleModal pedidoId={detalle.id} onClose={() => setDetalle(null)} />}
    </div>
  )
}

function FilterGroup({ label, options, value, onChange }) {
  return (
    <div>
      <div style={ds.label}>{label}</div>
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {options.map(o => {
          const active = value === o.id
          return (
            <button key={o.id} onClick={() => onChange(o.id)} style={{
              padding: '6px 10px', borderRadius: 6,
              border: active ? `1px solid ${colors.primaryBorder}` : `1px solid ${colors.border}`,
              background: active ? colors.primarySoft : colors.surface,
              color: active ? colors.primary : colors.textDim,
              fontSize: type.xs, fontWeight: 600, cursor: 'pointer',
            }}>{o.label}</button>
          )
        })}
      </div>
    </div>
  )
}

function DetalleModal({ pedidoId, onClose }) {
  const [pedido, setPedido] = useState(null)
  const [items, setItems] = useState([])
  const [earning, setEarning] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    ;(async () => {
      setLoading(true)
      const [pedRes, itemsRes, earnRes] = await Promise.all([
        supabase
          .from('pedidos')
          .select('*, establecimiento:establecimientos(nombre, telefono, direccion), usuario:usuarios(nombre, apellido, telefono, direccion, latitud, longitud)')
          .eq('id', pedidoId)
          .maybeSingle(),
        supabase
          .from('pedido_items')
          .select('*')
          .eq('pedido_id', pedidoId),
        supabase
          .from('rider_earnings')
          .select('*')
          .eq('pedido_id', pedidoId)
          .maybeSingle(),
      ])
      setPedido(pedRes.data || null)
      setItems(itemsRes.data || [])
      setEarning(earnRes.data || null)
      setLoading(false)
    })()
  }, [pedidoId])

  const coords = pedido?.usuario?.latitud && pedido?.usuario?.longitud
    ? { lat: pedido.usuario.latitud, lng: pedido.usuario.longitud }
    : null

  const subtotal = items.reduce((a, it) => a + Number(it.subtotal || it.precio * (it.cantidad || 1) || 0), 0)
  const envio = Number(pedido?.coste_envio || pedido?.precio_envio || 0)
  const propina = Number(pedido?.propina || 0)

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(15,15,15,0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16, zIndex: 100,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: colors.surface, borderRadius: 14,
          width: '100%', maxWidth: 720, maxHeight: '90vh', overflowY: 'auto',
          border: `1px solid ${colors.border}`, boxShadow: colors.shadowLg,
        }}
      >
        {/* Header */}
        <div style={{
          padding: '14px 18px', borderBottom: `1px solid ${colors.border}`,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          position: 'sticky', top: 0, background: colors.surface, zIndex: 2,
        }}>
          <div>
            <div style={{ fontSize: type.lg, fontWeight: 800, color: colors.text, letterSpacing: '-0.2px' }}>
              {pedido?.codigo || '—'}
            </div>
            {pedido?.estado && (() => {
              const b = stateBadge(pedido.estado); const ec = estadoColor(pedido.estado)
              return (
                <span style={{
                  display: 'inline-flex', alignItems: 'center',
                  background: ec.bg, color: ec.color,
                  fontSize: type.xxs, fontWeight: 700,
                  padding: '3px 8px', borderRadius: 6,
                  letterSpacing: '0.04em', textTransform: 'uppercase',
                  marginTop: 4,
                }}>{b._label}</span>
              )
            })()}
          </div>
          <button onClick={onClose} aria-label="Cerrar" style={{
            width: 32, height: 32, borderRadius: 8, border: `1px solid ${colors.border}`,
            background: colors.surface, cursor: 'pointer', color: colors.textDim,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          }}>×</button>
        </div>

        {loading ? (
          <div style={{ padding: 24, color: colors.textMute }}>Cargando…</div>
        ) : !pedido ? (
          <div style={{ padding: 24, color: colors.textMute }}>Pedido no encontrado</div>
        ) : (
          <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
            {/* Info básica */}
            <Section title="Resumen">
              <Row k="Fecha" v={new Date(pedido.created_at).toLocaleString('es-ES')} />
              <Row k="Método pago" v={(pedido.metodo_pago || '—').toUpperCase()} />
              <Row k="Total" v={`${Number(pedido.total || 0).toFixed(2)} €`} highlight />
              {pedido.minutos_preparacion && <Row k="Tiempo prep." v={`${pedido.minutos_preparacion} min`} />}
            </Section>

            {/* Restaurante */}
            <Section title="Restaurante">
              <Row k="Nombre" v={pedido.establecimiento?.nombre || '—'} />
              {pedido.establecimiento?.telefono && <Row k="Teléfono" v={pedido.establecimiento.telefono} />}
              {pedido.establecimiento?.direccion && <Row k="Dirección" v={pedido.establecimiento.direccion} />}
            </Section>

            {/* Cliente */}
            <Section title="Cliente">
              <Row k="Nombre" v={`${pedido.usuario?.nombre || ''} ${pedido.usuario?.apellido || ''}`.trim() || '—'} />
              {pedido.usuario?.telefono && <Row k="Teléfono" v={pedido.usuario.telefono} />}
              {(pedido.direccion_entrega || pedido.usuario?.direccion) && (
                <Row k="Dirección" v={pedido.direccion_entrega || pedido.usuario?.direccion} />
              )}
              {coords && (
                <div style={{ marginTop: 8 }}>
                  <a
                    href={`https://maps.google.com/?q=${coords.lat},${coords.lng}`}
                    target="_blank" rel="noreferrer"
                    style={{
                      ...ds.secondaryBtn, textDecoration: 'none',
                      display: 'inline-flex', fontSize: type.xs,
                    }}
                  >Abrir en Google Maps</a>
                </div>
              )}
            </Section>

            {/* Productos */}
            <Section title="Productos">
              {items.length === 0 ? (
                <div style={{ color: colors.textMute, fontSize: type.sm }}>Sin items</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {items.map((it) => (
                    <div key={it.id} style={{
                      padding: 10, background: colors.elev2, borderRadius: 8,
                      border: `1px solid ${colors.border}`,
                    }}>
                      <div style={{
                        display: 'flex', justifyContent: 'space-between', gap: 8,
                        fontSize: type.sm, fontWeight: 600, color: colors.text,
                      }}>
                        <span>{it.cantidad || 1}× {it.nombre || it.producto_nombre || 'Producto'}</span>
                        <span>{Number(it.subtotal || it.precio * (it.cantidad || 1) || 0).toFixed(2)} €</span>
                      </div>
                      {Array.isArray(it.extras) && it.extras.length > 0 && (
                        <div style={{ marginTop: 4, fontSize: type.xxs, color: colors.textMute }}>
                          {it.extras.join(' · ')}
                        </div>
                      )}
                      {it.notas && (
                        <div style={{ marginTop: 4, fontSize: type.xxs, color: colors.textMute, fontStyle: 'italic' }}>
                          {it.notas}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </Section>

            {pedido.notas_cliente && (
              <Section title="Notas del cliente">
                <div style={{ fontSize: type.sm, color: colors.textDim, fontStyle: 'italic' }}>
                  {pedido.notas_cliente}
                </div>
              </Section>
            )}

            {/* Totales */}
            <Section title="Importes">
              <Row k="Subtotal" v={`${subtotal.toFixed(2)} €`} />
              {envio > 0 && <Row k="Coste envío" v={`${envio.toFixed(2)} €`} />}
              {propina > 0 && <Row k="Propina" v={`${propina.toFixed(2)} €`} />}
              <Row k="Total pagado" v={`${Number(pedido.total || 0).toFixed(2)} €`} highlight />
              <Row k="Tu comisión" v={`${Number(pedido.comision_generada || 0).toFixed(2)} €`} accent />
            </Section>

            {/* Rider earnings */}
            {earning && (
              <Section title="Mi comisión (detalle rider)">
                <Row k="Lo que cobras" v={`${Number(earning.neto_rider || 0).toFixed(2)} €`} accent />
                {earning.envio_rider != null && <Row k="Envío" v={`${Number(earning.envio_rider).toFixed(2)} €`} />}
                {earning.comision_rider_subtotal != null && <Row k="10% subtotal" v={`${Number(earning.comision_rider_subtotal).toFixed(2)} €`} />}
                {earning.propina != null && <Row k="Propina" v={`${Number(earning.propina).toFixed(2)} €`} />}
              </Section>
            )}

            {/* Timeline */}
            <Section title="Timeline">
              <Timeline pedido={pedido} />
            </Section>

            {pedido.shipday_tracking_url && (
              <div>
                <a
                  href={pedido.shipday_tracking_url}
                  target="_blank" rel="noreferrer"
                  style={{ ...ds.primaryBtn, textDecoration: 'none', display: 'inline-flex' }}
                >Ver seguimiento</a>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function Section({ title, children }) {
  return (
    <div>
      <div style={{
        fontSize: type.xxs, fontWeight: 700, color: colors.textMute,
        textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8,
      }}>{title}</div>
      <div style={{
        background: colors.surface, border: `1px solid ${colors.border}`,
        borderRadius: 10, padding: 12,
      }}>{children}</div>
    </div>
  )
}

function Row({ k, v, highlight, accent }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
      gap: 10, padding: '4px 0', fontSize: type.sm,
    }}>
      <span style={{ color: colors.textMute }}>{k}</span>
      <span style={{
        color: accent ? colors.primary : colors.text,
        fontWeight: highlight || accent ? 700 : 500,
        textAlign: 'right',
      }}>{v}</span>
    </div>
  )
}

function Timeline({ pedido }) {
  const steps = [
    { k: 'Creado', t: pedido.created_at },
    { k: 'Aceptado', t: pedido.aceptado_at },
    { k: 'Listo', t: pedido.listo_at },
    { k: 'Recogido', t: pedido.recogido_at || pedido.picked_up_at },
    { k: 'Entregado', t: pedido.entregado_at },
  ].filter(s => s.t)
  if (steps.length === 0) return <div style={{ color: colors.textMute, fontSize: type.sm }}>Sin hitos registrados</div>
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {steps.map((s) => (
        <div key={s.k} style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: type.sm }}>
          <span style={{
            width: 8, height: 8, borderRadius: 4,
            background: colors.primary, flexShrink: 0,
          }} />
          <span style={{ color: colors.textDim, minWidth: 90 }}>{s.k}</span>
          <span style={{ color: colors.textMute, fontSize: type.xs }}>
            {new Date(s.t).toLocaleString('es-ES')}
          </span>
        </div>
      ))}
    </div>
  )
}
