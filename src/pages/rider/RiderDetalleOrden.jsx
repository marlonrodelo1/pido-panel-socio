// RiderDetalleOrden — Detalle del pedido + máquina de estados del reparto.
//
// Stepper de 4 estados: Aceptado → Recogido → En camino → Entregado.
// Botón de acción principal según pedido.estado, vía edge `rider-estado`.
//   - Aceptado (asignación aceptada, estado nuevo/preparando/listo): "Recogí el pedido" → 'recogido'
//   - Recogido: "Voy en camino" → 'en_camino'
//   - En camino: "Entregado" → 'entregado'  +  "No se pudo entregar" → 'fallido' { motivo }
//   - Entregado: cerrado, mensaje de éxito.
import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Phone, MessageCircle, Package, Truck, CheckCircle2, Navigation } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { riderEstado } from '../../lib/riderApi'
import { useRider } from '../../context/RiderContext'
import { isNativeSync } from '../../lib/capacitor'
import { colors } from '../../lib/uiStyles'
import { calcGanancia } from '../../lib/ganancia'

const GMAPS_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY

// pedido.estado → índice del paso del stepper (0..3).
// 'nuevo' / 'preparando' / 'listo' (asignación ya aceptada) = paso "Aceptado".
function pasoActual(estado) {
  if (estado === 'entregado') return 3
  if (estado === 'en_camino') return 2
  if (estado === 'recogido') return 1
  return 0 // nuevo / preparando / listo / aceptado
}

const PASOS = [
  { key: 'aceptado', label: 'Aceptado', Icon: CheckCircle2 },
  { key: 'recogido', label: 'Recogido', Icon: Package },
  { key: 'en_camino', label: 'En camino', Icon: Truck },
  { key: 'entregado', label: 'Entregado', Icon: CheckCircle2 },
]

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
      // Re-cargamos el pedido completo (el objeto entrante puede venir parcial).
      const [pedRes, itemsRes] = await Promise.all([
        supabase.from('pedidos')
          .select('id, codigo, estado, modo_entrega, subtotal, total, coste_envio, propina, establecimiento_id, usuario_id, direccion_entrega, lat_entrega, lng_entrega, metodo_pago, cliente_telefono, guest_telefono, guest_nombre')
          .eq('id', pedido.id).maybeSingle(),
        supabase.from('pedido_items').select('*').eq('pedido_id', pedido.id),
      ])
      if (cancel) return
      const ped = pedRes.data ? { ...pedido, ...pedRes.data } : pedido
      setPedido(ped)
      setItems(itemsRes.data || [])

      const [estRes, cliRes] = await Promise.all([
        ped.establecimiento_id
          ? supabase.from('establecimientos').select('nombre, direccion, telefono, logo_url, latitud, longitud').eq('id', ped.establecimiento_id).maybeSingle()
          : Promise.resolve({ data: null }),
        ped.usuario_id
          ? supabase.from('usuarios').select('nombre, apellido, telefono').eq('id', ped.usuario_id).maybeSingle()
          : Promise.resolve({ data: null }),
      ])
      if (cancel) return
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

  // ─── Transiciones de estado vía edge `rider-estado` ─────────
  async function transicion(accion, extra = {}, cerrar = false) {
    setBusy(accion)
    try {
      const res = await riderEstado(pedido.id, accion, extra)
      if (res?.ok) {
        refreshAsignaciones?.()
        if (cerrar) onBack?.()
        return
      }
      // NO tocó la BD: no cerramos ni avanzamos en falso (si no, el socio cree
      // que entregó pero el pedido sigue en_camino y se pierde su liquidación).
      try { if (navigator.vibrate) navigator.vibrate(200) } catch (_) {}
      if (res?.sessionDead) {
        alert('Tu sesión ha caducado. Vuelve a iniciar sesión para continuar.')
        try { await supabase.auth.signOut() } catch (_) {}
        return
      }
      alert('No se pudo actualizar el pedido. Revisa tu conexión e inténtalo de nuevo.')
    } catch (e) {
      alert('No se pudo actualizar el pedido. Revisa tu conexión e inténtalo de nuevo.')
    } finally {
      setBusy(null)
    }
  }

  function handleRecogido() { transicion('recogido') }
  function handleEnCamino() { transicion('en_camino') }
  function handleEntregado() { transicion('entregado', {}, true) }
  function handleFallido() {
    const motivo = window.prompt('¿Por qué no se pudo entregar?')
    if (!motivo?.trim()) return
    transicion('fallido', { motivo: motivo.trim() }, true)
  }

  const isDelivery = pedido.modo_entrega === 'delivery'
  const total = Number(pedido.total || 0)
  const subtotal = Number(pedido.subtotal || 0)
  const envio = Number(pedido.coste_envio || 0)
  const propina = Number(pedido.propina || 0)

  const paso = pasoActual(pedido.estado)
  const cerrado = paso >= 3

  // Teléfono del cliente: snapshot en el pedido (siempre presente desde el checkout
  // nuevo) y, como respaldo, usuario registrado o invitado.
  const telefonoCliente = pedido.cliente_telefono || cliente?.telefono || pedido.guest_telefono || null
  const nombreCliente = [cliente?.nombre, cliente?.apellido].filter(Boolean).join(' ').trim()
    || pedido.guest_nombre || 'Cliente'

  // Mini-mapa estático: requiere coords de restaurante y destino + key.
  const estLat = est?.latitud, estLng = est?.longitud
  const entLat = pedido.lat_entrega, entLng = pedido.lng_entrega
  const mapaUrl = useMemo(() => {
    if (!GMAPS_KEY) return null
    if (estLat == null || estLng == null || entLat == null || entLng == null) return null
    const o = `${estLat},${estLng}`
    const d = `${entLat},${entLng}`
    return `https://maps.googleapis.com/maps/api/staticmap?size=640x320&scale=2`
      + `&markers=color:0xC5562C%7C${o}`
      + `&markers=color:0x2E7D32%7C${d}`
      + `&path=color:0x8B9D7A%7Cweight:4%7C${o}%7C${d}`
      + `&key=${encodeURIComponent(GMAPS_KEY)}`
  }, [estLat, estLng, entLat, entLng])

  // Navegación: antes de recoger → al restaurante; ya recogido → al cliente.
  function navegar() {
    const haciaCliente = paso >= 1
    if (haciaCliente) abrirMaps(entLat, entLng, pedido.direccion_entrega)
    else abrirMaps(estLat, estLng, est?.direccion)
  }

  return (
    <div style={{
      paddingTop: 'calc(env(safe-area-inset-top, 0px) + 10px)',
      paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 18px)',
      fontFamily: "'Plus Jakarta Sans', sans-serif",
      background: colors.cream, minHeight: '100vh',
    }}>
      {/* Cabecera */}
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
        }}>{PASOS[paso].label}</div>
      </div>

      <div style={{ padding: '0 14px', display: 'flex', flexDirection: 'column', gap: 12 }}>

        {/* STEPPER */}
        <Stepper paso={paso} />

        {/* MINI-MAPA */}
        {mapaUrl && (
          <button
            onClick={navegar}
            style={{
              position: 'relative', display: 'block', width: '100%', padding: 0,
              height: 160, borderRadius: 14, overflow: 'hidden', border: `1px solid ${colors.border}`,
              cursor: 'pointer', background: colors.cream2,
            }}
            aria-label="Abrir navegación"
          >
            <img src={mapaUrl} alt="Mapa del reparto" onError={(e) => { e.currentTarget.style.display = 'none' }} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
            <span style={{
              position: 'absolute', right: 10, bottom: 10,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              padding: 8, borderRadius: 999,
              background: 'rgba(26,24,21,0.82)', color: '#fff',
            }}>
              <Navigation size={14} strokeWidth={2.4} />
            </span>
          </button>
        )}

        {/* DIRECCIONES: recoger / entregar */}
        <Card>
          {/* Recoger en (restaurante) */}
          {est && (
            <>
              <SectionLabel>Recoger en</SectionLabel>
              <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
                <div style={{
                  width: 44, height: 44, borderRadius: '50%',
                  background: colors.cream2, overflow: 'hidden', flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {est.logo_url
                    ? <img src={est.logo_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    : '🍽️'}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: colors.ink }}>{est.nombre}</div>
                  {est.direccion && (
                    <div style={{ fontSize: 12, color: colors.stone, marginTop: 1, lineHeight: 1.4 }}>{est.direccion}</div>
                  )}
                </div>
                {est.telefono && (
                  <a href={`tel:${est.telefono}`} aria-label="Llamar restaurante" style={callBtnStyle}>
                    <Phone size={16} strokeWidth={2.4} />
                  </a>
                )}
                <button
                  onClick={() => abrirMaps(est.latitud, est.longitud, est.direccion)}
                  aria-label="Navegar a la recogida"
                  style={navBtnStyle}
                >
                  <Navigation size={16} strokeWidth={2.4} />
                </button>
              </div>
            </>
          )}

          {/* Entregar en (cliente) */}
          {isDelivery && (
            <>
              {est && <div style={{ height: 1, background: colors.border, margin: '12px 0' }} />}
              <SectionLabel>Entregar en</SectionLabel>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 11 }}>
                <div style={{
                  width: 44, height: 44, borderRadius: '50%',
                  background: colors.terracottaSoft, color: colors.terracotta,
                  fontWeight: 800, fontSize: 16, flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {nombreCliente?.[0]?.toUpperCase() || '👤'}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: colors.ink }}>{nombreCliente}</div>
                  <div style={{ fontSize: 12, color: colors.stone, marginTop: 1, lineHeight: 1.4 }}>
                    {pedido.direccion_entrega}
                  </div>
                </div>
                <button
                  onClick={() => abrirMaps(pedido.lat_entrega, pedido.lng_entrega, pedido.direccion_entrega)}
                  aria-label="Navegar a la entrega"
                  style={navBtnStyle}
                >
                  <Navigation size={16} strokeWidth={2.4} />
                </button>
              </div>
            </>
          )}

          {/* Contacto del cliente — SIEMPRE (delivery y recogida) para poder llamar */}
          <div style={{ height: 1, background: colors.border, margin: '12px 0' }} />
          <SectionLabel>Contacto del cliente</SectionLabel>
          {!isDelivery && (
            <div style={{ fontSize: 14, fontWeight: 700, color: colors.ink, marginBottom: 8 }}>{nombreCliente}</div>
          )}
          {telefonoCliente ? (
            <div style={{ display: 'flex', gap: 8 }}>
              <a href={`tel:${telefonoCliente}`} style={contactBtn(colors.sageSoft, colors.sage2)}>
                <Phone size={15} strokeWidth={2.4} /> Llamar
              </a>
              <a
                href={waLink(telefonoCliente, pedido.codigo)}
                target="_blank" rel="noopener noreferrer"
                style={contactBtn('#DCF8C6', '#128C2E')}
              >
                <MessageCircle size={15} strokeWidth={2.4} /> WhatsApp
              </a>
            </div>
          ) : (
            <div style={{ fontSize: 12, color: colors.stone, fontWeight: 600 }}>
              Este pedido no tiene teléfono de contacto del cliente.
            </div>
          )}
        </Card>

        {/* Items + totales */}
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

        {/* TU GANANCIA — desglose de lo que gana el socio en este pedido */}
        <GananciaCard pedido={pedido} />

        {/* ACCIONES según estado */}
        {paso === 0 && (
          <button onClick={handleRecogido} disabled={busy} style={primaryBtn(busy)}>
            <Package size={17} strokeWidth={2.4} />
            {busy === 'recogido' ? 'Marcando…' : 'Recogí el pedido'}
          </button>
        )}

        {paso === 1 && (
          <button onClick={handleEnCamino} disabled={busy} style={primaryBtn(busy)}>
            <Truck size={17} strokeWidth={2.4} />
            {busy === 'en_camino' ? 'Marcando…' : 'Voy en camino'}
          </button>
        )}

        {paso === 2 && (
          <>
            <button onClick={handleEntregado} disabled={busy} style={primaryBtn(busy)}>
              <CheckCircle2 size={17} strokeWidth={2.4} />
              {busy === 'entregado' ? 'Marcando…' : 'Entregado'}
            </button>
            <button onClick={handleFallido} disabled={busy} style={{
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

        {cerrado && (
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
            padding: '20px 14px', borderRadius: 14,
            background: colors.sageSoft, color: colors.sage2,
            textAlign: 'center',
          }}>
            <CheckCircle2 size={34} strokeWidth={2.2} />
            <div style={{ fontSize: 15, fontWeight: 800 }}>Pedido entregado</div>
            <div style={{ fontSize: 12, color: colors.stone, fontWeight: 600 }}>
              ¡Buen trabajo! Este reparto está completo.
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Stepper de 4 estados ───────────────────────────────────
function Stepper({ paso }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start',
      background: colors.paper, borderRadius: 14, padding: '14px 8px',
      border: `1px solid ${colors.border}`,
    }}>
      {PASOS.map((p, i) => {
        const done = i < paso
        const active = i === paso
        const reached = i <= paso
        const Icon = p.Icon
        const dotBg = reached ? colors.terracotta : colors.cream2
        const dotColor = reached ? '#fff' : colors.stone2
        return (
          <div key={p.key} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', position: 'relative' }}>
            {/* Línea conectora hacia el siguiente */}
            {i < PASOS.length - 1 && (
              <div style={{
                position: 'absolute', top: 15, left: '50%', width: '100%', height: 3,
                background: i < paso ? colors.terracotta : colors.cream2,
                zIndex: 0,
              }} />
            )}
            <div style={{
              width: 32, height: 32, borderRadius: '50%',
              background: dotBg, color: dotColor,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              zIndex: 1, position: 'relative',
              boxShadow: active ? `0 0 0 4px ${colors.terracottaSoft}` : 'none',
            }}>
              <Icon size={16} strokeWidth={2.4} />
            </div>
            <div style={{
              fontSize: 10, fontWeight: active ? 800 : 600,
              color: reached ? colors.ink : colors.stone2,
              marginTop: 6, textAlign: 'center', lineHeight: 1.2,
            }}>{p.label}</div>
          </div>
        )
      })}
    </div>
  )
}

// ─── Tu ganancia (desglose para el socio) ───────────────────
function GananciaCard({ pedido }) {
  const isDelivery = pedido.modo_entrega === 'delivery'
  const g = calcGanancia(pedido)
  return (
    <div style={{
      background: colors.sageSoft, borderRadius: 14, padding: 14,
      border: `1px solid ${colors.sage}`,
    }}>
      <SectionLabel>Tu ganancia</SectionLabel>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 }}>
        {isDelivery && <GananciaRow label="Envío" value={g.envio} />}
        {isDelivery && <GananciaRow label="Propina" value={g.propina} />}
        <GananciaRow label="Comisión 10%" value={g.comision} />
      </div>

      <div style={{ height: 1, background: colors.sage, opacity: 0.5, margin: '12px 0' }} />

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span style={{ fontSize: 13, color: colors.sage2, fontWeight: 700 }}>Total ganancia</span>
        <span style={{ fontSize: 21, fontWeight: 800, color: colors.sage2 }}>
          {g.total.toFixed(2).replace('.', ',')} €
        </span>
      </div>
    </div>
  )
}

function GananciaRow({ label, value }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
      <span style={{ color: colors.stone }}>{label}</span>
      <span style={{ color: colors.ink, fontWeight: 700, fontFamily: 'ui-monospace, monospace' }}>
        {Number(value).toFixed(2)}€
      </span>
    </div>
  )
}

// ─── Helpers ────────────────────────────────────────────────

// Normaliza un teléfono a solo dígitos con prefijo 34 si no lo trae.
function normalizarTel(tel) {
  let d = String(tel || '').replace(/\D/g, '')
  if (!d) return ''
  if (d.startsWith('00')) d = d.slice(2)
  // Número español de 9 dígitos sin prefijo → anteponer 34.
  if (d.length === 9) d = '34' + d
  return d
}

function waLink(tel, codigo) {
  const num = normalizarTel(tel)
  const texto = `Hola, soy tu repartidor de Pidoo con el pedido #${codigo || ''}`
  return `https://wa.me/${num}?text=${encodeURIComponent(texto)}`
}

// Abre la navegación: en nativo deja que el SO elija app de mapas; en web abre tab.
function abrirMaps(lat, lng, label) {
  let url
  if (lat != null && lng != null) {
    url = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`
  } else if (label) {
    url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(label)}`
  } else {
    return
  }
  if (isNativeSync()) {
    // En nativo, _system fuerza al SO a abrir la app de mapas / navegador externo.
    window.open(url, '_system')
  } else {
    window.open(url, '_blank', 'noopener')
  }
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

const navBtnStyle = {
  width: 38, height: 38, borderRadius: '50%',
  background: colors.terracottaSoft, color: colors.terracotta,
  border: 'none', cursor: 'pointer',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  textDecoration: 'none', flexShrink: 0,
}

function contactBtn(bg, color) {
  return {
    flex: 1, padding: '10px', borderRadius: 10,
    background: bg, color,
    fontSize: 13, fontWeight: 700, textDecoration: 'none',
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
    fontFamily: "'Plus Jakarta Sans', sans-serif",
  }
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
