import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, TriangleAlert } from 'lucide-react'
import { useSocio } from '../context/SocioContext'
import { supabase } from '../lib/supabase'
import { colors, ds, type, stateBadge } from '../lib/uiStyles'
import { etiquetaPago, estadoPago, cobroConfirmado } from '../lib/metodoPago'
import { leerCobros } from '../lib/cobroMovil'
import { calcGanancia } from '../lib/ganancia'

// Colores del estado del pago (estadoPago → tono). El check verde solo sale con prueba de Stripe.
const TONO_PAGO = {
  ok:        { bg: colors.sageSoft,    fg: colors.sage2 },
  aviso:     { bg: colors.warningSoft, fg: colors.warning },
  pendiente: { bg: colors.warningSoft, fg: colors.warning },
  error:     { bg: colors.dangerSoft,  fg: colors.danger },
  neutro:    { bg: colors.surface2,    fg: colors.textDim },
}

const RANGOS = [
  { id: 'hoy', label: 'Hoy' },
  { id: 'semana', label: 'Semana' },
  { id: 'mes', label: 'Mes' },
  { id: 'todos', label: 'Todos' },
]

const ESTADOS = [
  { id: 'todos', label: 'Todos' },
  { id: 'entregado', label: 'Entregado' },
  { id: 'en_camino', label: 'En camino' },
  { id: 'cancelado', label: 'Cancelado' },
  { id: 'fallido', label: 'Fallido' },
]

const PAGOS = [
  { id: 'todos', label: 'Todos' },
  { id: 'tarjeta', label: 'Tarjeta' },
  { id: 'efectivo', label: 'Efectivo' },
  { id: 'datafono', label: 'Datáfono' },
  { id: 'pagado_local', label: 'Pagado en el local' },
]

// Un solo sitio decide qué está cobrado y qué no: lib/metodoPago.js (estadoPago)
const metodoPagoLabel = etiquetaPago

// Origen del pedido para el socio.
const origenLabel = (o) => {
  if (o === 'tienda_publica') return 'Tienda del restaurante'
  if (o === 'marketplace_socio') return 'Mi marketplace'
  if (o === 'telefonico') return 'Pedido telefónico'
  return 'App Pidoo'
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

function fmtFechaCorta(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export default function Pedidos() {
  const { socio } = useSocio()
  const [pedidos, setPedidos] = useState([])
  const [loading, setLoading] = useState(true)
  const [rango, setRango] = useState('mes')
  const [estado, setEstado] = useState('todos')
  const [pago, setPago] = useState('todos')
  const [detalle, setDetalle] = useState(null)

  useEffect(() => {
    if (!socio?.id) return
    let cancel = false
    ;(async () => {
      setLoading(true)
      const desde = rangoToDesde(rango)

      const { data: riderAccs } = await supabase
        .from('rider_accounts')
        .select('id')
        .eq('socio_id', socio.id)
      if (cancel) return
      const riderAccIds = (riderAccs || []).map((r) => r.id)

      let pedidoIds = []
      if (riderAccIds.length > 0) {
        // Acotamos por rango de fecha (y con límite): sin esto se traían TODOS los
        // pedido_id históricos del socio y se metían como lista de UUIDs en la URL del
        // `.or(...)`, que con miles de pedidos disparaba la longitud/plan de la query.
        let aq = supabase
          .from('pedido_asignaciones')
          .select('pedido_id, created_at')
          .in('rider_account_id', riderAccIds)
          .order('created_at', { ascending: false })
          .limit(500)
        if (desde) aq = aq.gte('created_at', desde)
        const { data: asigs } = await aq
        if (cancel) return
        pedidoIds = Array.from(new Set((asigs || []).map((a) => a.pedido_id)))
      }

      // Nota: se quitó el embed `rider_earnings(...)` porque esa tabla ya no
      // existe (renombrada a _deprecated_rider_earnings) y el embed devolvía 400.
      // El desglose de comisión del rider ya no tiene fuente de datos.
      let q = supabase
        .from('pedidos')
        .select('id, codigo, estado, metodo_pago, stripe_payment_id, reembolsado_at, monto_reembolsado, total, created_at, origen_pedido, establecimiento:establecimientos(nombre)')
        .order('created_at', { ascending: false })
        .limit(200)

      if (pedidoIds.length > 0) {
        const idList = pedidoIds.map((x) => `"${x}"`).join(',')
        q = q.or(`socio_id.eq.${socio.id},id.in.(${idList})`)
      } else {
        q = q.eq('socio_id', socio.id)
      }

      if (desde) q = q.gte('created_at', desde)
      if (estado !== 'todos') q = q.eq('estado', estado)
      if (pago !== 'todos') q = q.eq('metodo_pago', pago)
      const { data, error } = await q
      if (cancel) return
      if (error) {
        // No tragar el error como "sin pedidos": lo registramos y no borramos la lista
        // previa (evita mostrar "Sin pedidos" cuando en realidad la query falló).
        console.error('[Pedidos] error cargando pedidos', error)
        setLoading(false)
        return
      }

      // Cobros con el móvil (check verde). SEGUNDA consulta y tolerante: si falla, la lista se
      // pinta igual, solo sin el check de la puerta (un embed roto tiraría la lista entera).
      const { filas: cobros } = await leerCobros((data || []).map((p) => p.id))
      if (cancel) return
      const cobrosPorPedido = {}
      for (const c of cobros) (cobrosPorPedido[c.pedido_id] ||= []).push(c)

      // Sin tabla rider_earnings → no hay desglose de comisión; se deja en null
      // para mostrar "—" en la columna Comisión (no inventamos cifras).
      const pedidosNorm = (data || []).map(p => ({
        ...p,
        cobros: cobrosPorPedido[p.id] || [],
        comision_generada: null,
      }))
      setPedidos(pedidosNorm)
      setLoading(false)
    })()
    return () => { cancel = true }
  }, [socio?.id, rango, estado, pago])

  const resumen = useMemo(() => {
    const total = pedidos.reduce((a, p) => a + Number(p.total || 0), 0)
    return { count: pedidos.length, total }
  }, [pedidos])

  return (
    <div>
      <h1 style={ds.h1}>Pedidos</h1>
      <p style={{ color: colors.textMute, fontSize: type.sm, marginTop: 4, marginBottom: 18 }}>
        Todos los pedidos asignados a tus riders.
      </p>

      {/* Filtros compactos: 3 selects en fila */}
      <div style={{
        ...ds.card,
        padding: '12px 14px', marginBottom: 18,
        display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end',
      }}>
        <Select label="Fecha"  value={rango}  onChange={setRango}  options={RANGOS} />
        <Select label="Estado" value={estado} onChange={setEstado} options={ESTADOS} />
        <Select label="Pago"   value={pago}   onChange={setPago}   options={PAGOS} />
        {(rango !== 'mes' || estado !== 'todos' || pago !== 'todos') && (
          <button
            onClick={() => { setRango('mes'); setEstado('todos'); setPago('todos') }}
            style={{
              marginLeft: 'auto', padding: '8px 14px',
              borderRadius: 999, border: `1px solid ${colors.border}`,
              background: 'transparent', color: colors.textDim,
              fontSize: 12, fontWeight: 600, cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            Limpiar
          </button>
        )}
      </div>

      {/* Resumen línea — la comisión del rider ya no tiene fuente (rider_earnings
          eliminada), por eso se oculta ese segmento en vez de mostrar 0. */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 16, marginBottom: 14,
        fontSize: type.sm, flexWrap: 'wrap',
      }}>
        <span style={{ color: colors.textDim }}>
          <strong style={{ color: colors.text }}>{resumen.count}</strong> pedidos · total <strong style={{ color: colors.text }}>{resumen.total.toFixed(2)} €</strong>
        </span>
      </div>

      {loading ? (
        <div style={{ color: colors.textMute, padding: 20 }}>Cargando…</div>
      ) : pedidos.length === 0 ? (
        <div style={{ ...ds.card, textAlign: 'center', padding: 30 }}>
          <div style={{ fontSize: type.base, fontWeight: 700 }}>Sin pedidos con los filtros actuales</div>
          <div style={{ fontSize: type.sm, color: colors.textMute, marginTop: 4 }}>
            Prueba a ampliar el rango de fechas o quitar filtros.
          </div>
        </div>
      ) : (
        <div style={{ ...ds.card, padding: 0, overflow: 'hidden' }}>
          <div className="pedidos-tabla-head" style={{
            display: 'grid',
            gridTemplateColumns: '1.1fr 1.5fr 0.9fr 1.5fr 0.8fr 0.8fr 1fr',
            gap: 12, padding: '12px 18px',
            background: colors.surface2,
            fontSize: 11, fontWeight: 700, color: colors.textMute,
            textTransform: 'uppercase', letterSpacing: '0.04em',
          }}>
            <span>Código</span>
            <span>Restaurante</span>
            <span>Estado</span>
            <span>Pago</span>
            <span>Total</span>
            <span>Comisión</span>
            <span>Fecha</span>
          </div>
          {pedidos.map((p, i) => {
            const b = stateBadge(p.estado)
            // Estado REAL del pago (no solo cómo quería pagar el cliente): check verde si hay
            // prueba de Stripe, ámbar si falta cobrar o hay que revisarlo.
            const ep = estadoPago(p, p.cobros)
            const tono = TONO_PAGO[ep.tono] || TONO_PAGO.neutro
            return (
              <div
                key={p.id}
                onClick={() => setDetalle({ id: p.id })}
                className="pedidos-tabla-row"
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1.1fr 1.5fr 0.9fr 1.5fr 0.8fr 0.8fr 1fr',
                  gap: 12, padding: '14px 18px',
                  alignItems: 'center',
                  borderTop: i > 0 ? `1px solid ${colors.border}` : 'none',
                  fontSize: type.sm, cursor: 'pointer',
                  transition: 'background 0.15s',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = colors.surface2 }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
              >
                <span style={{ fontFamily: type.mono, color: colors.text, fontWeight: 600 }}>{p.codigo}</span>
                <span style={{ color: colors.text, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {p.establecimiento?.nombre || '—'}
                </span>
                <span><span style={b}>{b._label}</span></span>
                <span
                  title={ep.detalle || ep.texto}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                    fontSize: 11, fontWeight: 700, lineHeight: 1.25,
                    background: tono.bg, color: tono.fg,
                    padding: '3px 8px', borderRadius: 999,
                    justifySelf: 'start',
                  }}
                >
                  {ep.check && <CheckCircle2 size={13} strokeWidth={2.6} style={{ flexShrink: 0 }} />}
                  {ep.tono === 'aviso' && <TriangleAlert size={12} strokeWidth={2.6} style={{ flexShrink: 0 }} />}
                  {ep.clave === 'pendiente' ? `Pendiente · ${metodoPagoLabel(p.metodo_pago)}` : ep.texto}
                </span>
                <span style={{
                  color: colors.text, fontWeight: 600,
                  fontVariantNumeric: 'tabular-nums',
                }}>{Number(p.total || 0).toFixed(2)} €</span>
                <span style={{
                  color: p.comision_generada > 0 ? colors.sage2 : colors.textFaint,
                  fontWeight: 700,
                  fontVariantNumeric: 'tabular-nums',
                }}>
                  {p.comision_generada > 0 ? `${Number(p.comision_generada).toFixed(2)} €` : '—'}
                </span>
                <span style={{ color: colors.textMute, fontSize: 12 }}>
                  {fmtFechaCorta(p.created_at)}
                </span>
              </div>
            )
          })}
        </div>
      )}

      <style>{`
        @media (max-width: 720px) {
          .pedidos-tabla-head { display: none !important; }
          .pedidos-tabla-row {
            grid-template-columns: 1fr 1fr !important;
            row-gap: 6px !important;
            padding: 14px 14px !important;
          }
          .pedidos-tabla-row > span:nth-child(1),
          .pedidos-tabla-row > span:nth-child(2) {
            grid-column: 1 / -1;
          }
        }
      `}</style>

      {detalle && <DetalleModal pedidoId={detalle.id} onClose={() => setDetalle(null)} />}
    </div>
  )
}

/**
 * Select compacto reutilizable. Native <select> con label arriba.
 * Estilo coherente con la paleta cream/terracotta del design system.
 */
function Select({ label, value, onChange, options }) {
  return (
    <label style={{
      display: 'flex', flexDirection: 'column', gap: 4,
      minWidth: 130, flex: '1 1 130px',
    }}>
      <span style={{
        fontSize: 10, fontWeight: 700, color: colors.textMute,
        textTransform: 'uppercase', letterSpacing: '0.06em',
      }}>{label}</span>
      <div style={{ position: 'relative' }}>
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          style={{
            width: '100%', appearance: 'none', WebkitAppearance: 'none',
            padding: '9px 32px 9px 12px', borderRadius: 10,
            border: `1px solid ${colors.border}`, background: colors.paper,
            color: colors.text, fontSize: 13, fontWeight: 600,
            fontFamily: type.family, cursor: 'pointer',
            outline: 'none',
          }}
        >
          {options.map(o => (
            <option key={o.id} value={o.id}>{o.label}</option>
          ))}
        </select>
        {/* Chevron */}
        <span style={{
          position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
          pointerEvents: 'none', color: colors.textMute, fontSize: 10,
        }}>▾</span>
      </div>
    </label>
  )
}

function DetalleModal({ pedidoId, onClose }) {
  const { socio } = useSocio()
  const [pedido, setPedido] = useState(null)
  const [items, setItems] = useState([])
  const [cobros, setCobros] = useState([])
  const [cliente, setCliente] = useState(null)
  const [pacto, setPacto] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    ;(async () => {
      setLoading(true)
      const [pedRes, itemsRes, cobrosRes] = await Promise.all([
        supabase
          .from('pedidos')
          // El contacto del cliente NO se embebe desde `usuarios`: el socio no tiene
          // acceso a esa tabla (le daria la ficha entera: email, GPS, metodo de pago).
          // Va por la vista `v_clientes_de_mis_pedidos`, que expone solo lo que se pinta.
          .select('*, establecimiento:establecimientos(nombre, telefono, direccion)')
          .eq('id', pedidoId)
          .maybeSingle(),
        supabase
          .from('pedido_items')
          .select('*')
          .eq('pedido_id', pedidoId),
        // Cobros con el móvil: consulta aparte y tolerante (si falla, el detalle sale igual).
        leerCobros([pedidoId]),
      ])
      const ped = pedRes.data || null
      setPedido(ped)
      setItems(itemsRes.data || [])
      setCobros(cobrosRes.filas || [])
      // Contacto del cliente registrado. En los pedidos sin cuenta no hay fila: el
      // nombre y el teléfono viven en el propio pedido (guest_*).
      if (ped?.usuario_id) {
        const { data: cli } = await supabase
          .from('v_clientes_de_mis_pedidos')
          .select('nombre, apellido, telefono, direccion, latitud, longitud')
          .eq('id', ped.usuario_id)
          .maybeSingle()
        setCliente(cli || null)
      } else {
        setCliente(null)
      }
      // Pacto REAL del socio con este restaurante (para estimar la ganancia mientras no esté
      // congelada). Sin vinculación, calcGanancia usa su regla por defecto.
      if (ped?.establecimiento_id && socio?.id) {
        const { data: vinc } = await supabase
          .from('socio_establecimiento')
          .select('comision_pct, tarifa_modo, tarifa_fija')
          .eq('socio_id', socio.id)
          .eq('establecimiento_id', ped.establecimiento_id)
          .maybeSingle()
        if (vinc) setPacto(vinc)
      }
      setLoading(false)
    })()
  }, [pedidoId, socio?.id])

  // Punto de entrega: primero el del propio pedido (es el que se pactó al pedir), y
  // solo si falta, la dirección guardada del cliente.
  const coords = pedido?.lat_entrega && pedido?.lng_entrega
    ? { lat: pedido.lat_entrega, lng: pedido.lng_entrega }
    : (cliente?.latitud && cliente?.longitud ? { lat: cliente.latitud, lng: cliente.longitud } : null)

  // Cliente registrado, invitado o (si aún no cargó) el literal 'Cliente'. Misma cadena
  // que usa la pantalla de reparto, para que no digan cosas distintas del mismo pedido.
  const nombreCliente = [cliente?.nombre, cliente?.apellido].filter(Boolean).join(' ').trim()
    || pedido?.guest_nombre || null
  const telefonoCliente = pedido?.cliente_telefono || cliente?.telefono || pedido?.guest_telefono || null

  // Manda `pedidos.subtotal`, que es la cifra con la que calcula el backend (la mantiene
  // trg_recalculate_subtotal). La suma por líneas queda de respaldo para los pedidos sin
  // items — telefónicos, por ejemplo, donde el trigger nunca llega a dispararse.
  // (Antes leía it.subtotal / it.precio, columnas que no existen: daba SIEMPRE 0.)
  const subtotal = pedido?.subtotal != null
    ? Number(pedido.subtotal)
    : items.reduce((a, it) => a + Number(it.precio_unitario || 0) * (it.cantidad || 1), 0)
  const descuento = Number(pedido?.descuento || 0)
  const envio = Number(pedido?.coste_envio || pedido?.precio_envio || 0)
  const propina = Number(pedido?.propina || 0)
  const badge = pedido?.estado ? stateBadge(pedido.estado) : null
  // Estado REAL del pago (check verde solo con prueba de Stripe) y el cobro con el móvil que vale.
  const pago = pedido ? estadoPago(pedido, cobros) : null
  const cobroPuerta = cobroConfirmado(cobros)
  // Ganancia del socio. Si el pedido tiene la ganancia CONGELADA (socio_liq_*, se congela al
  // entregar con el pacto vigente), se usa esa. Si no, se estima con el pacto: calcGanancia
  // (lib/ganancia.js), la misma regla que la pantalla de reparto y que calc_ganancia_socio.
  // 28-sep-2026: el telefónico cobra lo pactado, como la app, en cuanto existe la clave del
  // cambio (comision_telefonico_pct_desde); sin ella, sin comisión. Lo decide calcGanancia.
  const esReparto = pedido?.modo_entrega === 'delivery' || envio > 0
  const esEntregado = pedido?.estado === 'entregado'
  const tieneSnap = pedido?.socio_liq_total != null
  const estimada = calcGanancia(
    pedido ? { ...pedido, modo_entrega: esReparto ? 'delivery' : pedido.modo_entrega, coste_envio: envio, subtotal } : null,
    pacto,
  )
  const esFijaPacto = tieneSnap ? pedido.socio_liq_tarifa_modo === 'fija' : estimada.esFija
  const gEnvio = tieneSnap ? Number(pedido.socio_liq_envio || 0) : estimada.envio
  const comisionSocio = tieneSnap ? Number(pedido.socio_liq_comision || 0) : estimada.comision
  const comisionPct = tieneSnap ? Number(pedido.socio_liq_comision_pct || 0) : estimada.comisionPct
  const gPropina = tieneSnap ? Number(pedido.socio_liq_propina || 0) : estimada.propina
  const gananciaSocio = tieneSnap ? Number(pedido.socio_liq_total || 0) : estimada.total

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(26,24,21,0.45)',
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
        padding: 0, zIndex: 100,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: colors.paper, borderRadius: '20px 20px 0 0',
          width: '100%', maxWidth: 720, maxHeight: '92vh', overflowY: 'auto',
          border: `1px solid ${colors.border}`, boxShadow: colors.shadowLg,
        }}
      >
        {/* Header */}
        <div style={{
          padding: '16px 22px', borderBottom: `1px solid ${colors.border}`,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          position: 'sticky', top: 0, background: colors.paper, zIndex: 2,
        }}>
          <div style={{ minWidth: 0 }}>
            {/* El restaurante, lo primero: es lo que el socio busca al abrir un pedido del historial. */}
            {pedido?.establecimiento?.nombre && (
              <div style={{
                fontSize: type.base, fontWeight: 800, color: colors.text, letterSpacing: '-0.2px',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {pedido.establecimiento.nombre}
              </div>
            )}
            <div style={{ fontSize: type.sm, fontWeight: 700, color: colors.textMute, fontFamily: type.mono, marginTop: 2 }}>
              {pedido?.codigo || '—'}
            </div>
            {badge && <span style={{ ...badge, marginTop: 6 }}>{badge._label}</span>}
          </div>
          <button onClick={onClose} aria-label="Cerrar" style={{
            width: 34, height: 34, borderRadius: 8, border: `1px solid ${colors.border}`,
            background: colors.paper, cursor: 'pointer', color: colors.textDim,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 18,
          }}>×</button>
        </div>

        {loading ? (
          <div style={{ padding: 24, color: colors.textMute }}>Cargando…</div>
        ) : !pedido ? (
          <div style={{ padding: 24, color: colors.textMute }}>Pedido no encontrado</div>
        ) : (
          <div style={{ padding: 22, display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* PAGO: si el dinero se cobró de verdad y cómo. Check verde solo con prueba de
                Stripe (cobro con el móvil en la puerta o tarjeta pagada en la app). */}
            {pago && (
              <Section title="Pago">
                <PagoEstado pago={pago} total={pedido.total} />
                {cobroPuerta && cobroPuerta.importe != null && Math.abs(Number(cobroPuerta.importe) - Number(pedido.total || 0)) >= 0.005 && (
                  <Row k="Cobrado con el móvil" v={`${Number(cobroPuerta.importe).toFixed(2)} €`} />
                )}
                {cobroPuerta?.metodo_pago_anterior && (
                  <Row k="Forma de pago al pedir" v={metodoPagoLabel(cobroPuerta.metodo_pago_anterior)} />
                )}
                {!cobroPuerta && ['pendiente', 'no_cobrado', 'anulado_tarjeta', 'pago_sin_completar', 'reembolsado', 'tarjeta_sin_pago', 'entregado'].includes(pago.clave) && (
                  <Row k="Forma de pago elegida" v={metodoPagoLabel(pedido.metodo_pago)} />
                )}
                {cobroPuerta?.recibo_url && (
                  <div style={{ marginTop: 6 }}>
                    <a href={cobroPuerta.recibo_url} target="_blank" rel="noreferrer" style={{
                      fontSize: type.xs, fontWeight: 700, color: colors.textDim,
                    }}>Ver recibo del cobro</a>
                  </div>
                )}
              </Section>
            )}

            <Section title="Resumen">
              <Row k="Fecha" v={new Date(pedido.created_at).toLocaleString('es-ES')} />
              <Row k="Origen" v={origenLabel(pedido.origen_pedido)} />
              <Row k="Total" v={`${Number(pedido.total || 0).toFixed(2)} €`} highlight />
              {pedido.minutos_preparacion && <Row k="Tiempo prep." v={`${pedido.minutos_preparacion} min`} />}
            </Section>

            <Section title="Restaurante">
              <Row k="Nombre" v={pedido.establecimiento?.nombre || '—'} />
              {pedido.establecimiento?.telefono && <Row k="Teléfono" v={pedido.establecimiento.telefono} />}
              {pedido.establecimiento?.direccion && <Row k="Dirección" v={pedido.establecimiento.direccion} />}
            </Section>

            <Section title="Cliente">
              <Row k="Nombre" v={nombreCliente || '—'} />
              {telefonoCliente && <Row k="Teléfono" v={telefonoCliente} />}
              {(pedido.direccion_entrega || cliente?.direccion) && (
                <Row k="Dirección" v={pedido.direccion_entrega || cliente?.direccion} />
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

            <Section title="Productos">
              {items.length === 0 ? (
                <div style={{ color: colors.textMute, fontSize: type.sm }}>Sin items</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {items.map((it) => (
                    <div key={it.id} style={{
                      padding: 12, background: colors.surface2, borderRadius: 10,
                      border: `1px solid ${colors.border}`,
                    }}>
                      <div style={{
                        display: 'flex', justifyContent: 'space-between', gap: 8,
                        fontSize: type.sm, fontWeight: 700, color: colors.text,
                      }}>
                        <span>
                          {it.cantidad || 1}× {it.nombre_producto || 'Producto'}
                          {it.tamano ? <span style={{ color: colors.textMute, fontWeight: 600 }}> · {it.tamano}</span> : null}
                        </span>
                        <span style={{ fontVariantNumeric: 'tabular-nums' }}>{(Number(it.precio_unitario || 0) * (it.cantidad || 1)).toFixed(2)} €</span>
                      </div>
                      {Array.isArray(it.extras) && it.extras.length > 0 && (
                        <div style={{ marginTop: 6, fontSize: 11, color: colors.textMute }}>
                          {it.extras.join(' · ')}
                        </div>
                      )}
                      {it.notas && (
                        <div style={{ marginTop: 4, fontSize: 11, color: colors.textMute, fontStyle: 'italic' }}>
                          {it.notas}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </Section>

            {/* La nota del cliente vive en `pedidos.notas`. El guard leía `notas_cliente`,
                columna que NO existe, así que esta sección no se ha visto nunca: el socio
                no llegaba a leer cosas como "portal 3, el timbre no va". */}
            {pedido.notas && (
              <Section title="Notas del cliente">
                <div style={{ fontSize: type.sm, color: colors.textDim, fontStyle: 'italic' }}>
                  {pedido.notas}
                </div>
              </Section>
            )}

            <Section title="Importes">
              <Row k="Subtotal" v={`${subtotal.toFixed(2)} €`} />
              {envio > 0 && <Row k="Coste envío" v={`${envio.toFixed(2)} €`} />}
              {propina > 0 && <Row k="Propina" v={`${propina.toFixed(2)} €`} />}
              {/* Sin esta fila las líneas no sumaban el total y parecía un error de cuentas. */}
              {descuento > 0 && <Row k="Descuento" v={`−${descuento.toFixed(2)} €`} />}
              <Row k="Total pagado" v={`${Number(pedido.total || 0).toFixed(2)} €`} highlight />
            </Section>

            {/* Un pedido cancelado NO se cobra: pintar aquí "Total para ti 7,30 €" es
                prometer dinero que no llega. Entregado = cifra real; en curso = estimación
                declarada como tal; cancelado/fallido = no se muestra. */}
            {esReparto && !['cancelado', 'fallido'].includes(pedido.estado) && (
              <Section title={esEntregado ? 'Tu ganancia por este pedido' : 'Tu ganancia estimada'}>
                <Row k={esFijaPacto ? 'Tarifa fija' : 'Envío'} v={`${gEnvio.toFixed(2)} €`} />
                {comisionSocio > 0 && <Row k={`Comisión (${comisionPct}% del subtotal)`} v={`${comisionSocio.toFixed(2)} €`} />}
                {gPropina > 0 && <Row k="Propina (100% para ti)" v={`${gPropina.toFixed(2)} €`} />}
                <Row k={esEntregado ? 'Total para ti' : 'Total si se entrega'} v={`${gananciaSocio.toFixed(2)} €`} highlight />
                <div style={{ fontSize: 11, color: colors.textMute, marginTop: 8, lineHeight: 1.4 }}>
                  {esEntregado
                    ? 'Cifra orientativa según tu tarifa con este restaurante. El importe que cobras es el de tus facturas / lo que tienes por cobrar.'
                    : 'Todavía no está entregado: esta cifra es una estimación y solo se cobra si el reparto se completa.'}
                </div>
              </Section>
            )}

            <Section title="Timeline">
              <Timeline pedido={pedido} />
            </Section>

            {pedido.shipday_tracking_url && (
              <div>
                <a
                  href={pedido.shipday_tracking_url}
                  target="_blank" rel="noreferrer"
                  style={{ ...ds.glossyBtn, textDecoration: 'none', display: 'inline-flex' }}
                >Ver seguimiento</a>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// Línea grande del estado del pago: check verde, aviso ámbar o texto neutro.
function PagoEstado({ pago, total }) {
  const tono = TONO_PAGO[pago.tono] || TONO_PAGO.neutro
  const pendiente = pago.clave === 'pendiente'
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 10,
      padding: '10px 12px', borderRadius: 10, marginBottom: 6,
      background: tono.bg, color: tono.fg,
    }}>
      {pago.check && <CheckCircle2 size={22} strokeWidth={2.4} style={{ flexShrink: 0 }} />}
      {(pago.tono === 'aviso' || pago.tono === 'error') && <TriangleAlert size={20} strokeWidth={2.4} style={{ flexShrink: 0 }} />}
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: type.base, fontWeight: 800 }}>
          {pendiente ? `Pendiente de cobro · ${Number(total || 0).toFixed(2)} €` : pago.texto}
        </div>
        {pago.detalle && !pendiente && (
          <div style={{ fontSize: type.xs, fontWeight: 600, marginTop: 2, opacity: 0.9 }}>{pago.detalle}</div>
        )}
      </div>
    </div>
  )
}

function Section({ title, children }) {
  return (
    <div>
      <div style={{
        fontSize: 11, fontWeight: 700, color: colors.textMute,
        textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8,
      }}>{title}</div>
      <div style={{
        background: colors.surface2, border: `1px solid ${colors.border}`,
        borderRadius: 12, padding: 14,
      }}>{children}</div>
    </div>
  )
}

function Row({ k, v, highlight, accent, muted }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
      gap: 10, padding: '4px 0', fontSize: type.sm,
    }}>
      <span style={{ color: muted ? colors.sage2 : colors.textMute, opacity: muted ? 0.85 : 1 }}>{k}</span>
      <span style={{
        color: accent ? colors.sage2 : muted ? colors.sage2 : colors.text,
        fontWeight: highlight || accent ? 800 : 500,
        textAlign: 'right',
        fontVariantNumeric: 'tabular-nums',
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {steps.map((s, i) => (
        <div key={s.k} style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: type.sm }}>
          <span style={{
            width: 8, height: 8, borderRadius: 4,
            background: colors.sage2, flexShrink: 0,
          }} />
          <span style={{ color: colors.text, minWidth: 90, fontWeight: 600 }}>{s.k}</span>
          <span style={{ color: colors.textMute, fontSize: type.xs }}>
            {new Date(s.t).toLocaleString('es-ES')}
          </span>
        </div>
      ))}
    </div>
  )
}
