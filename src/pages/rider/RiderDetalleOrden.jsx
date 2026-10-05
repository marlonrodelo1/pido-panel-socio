// RiderDetalleOrden — Detalle del pedido + máquina de estados del reparto.
//
// Stepper de 4 estados: Aceptado → Recogido → En camino → Entregado.
// Botón de acción principal según pedido.estado, vía edge `rider-estado`.
//   - Aceptado (asignación aceptada, estado nuevo/preparando/listo): "Recogí el pedido" → 'recogido'
//   - Recogido: "Voy en camino" → 'en_camino'
//   - En camino: COBRO + ENTREGA en la puerta (v305) y "No se pudo entregar" → 'fallido' { motivo }
//       · ya pagado (tarjeta de la app, cobrado con el móvil o pagado en el local) → "Entregado".
//       · efectivo / datáfono → "Cobrado en efectivo · X €" (un toque: cobra y entrega) y, si este
//         móvil puede cobrar con tarjeta y el socio está habilitado, "Cobrar con tarjeta · X €"
//         (al confirmarlo Stripe, el pedido queda entregado solo). En datáfono sale además
//         "Cobrado con datáfono del restaurante" (antes que efectivo) salvo que la clave
//         cobro_datafono_fisico esté en 'off': hoy Duende da el datáfono al repartidor.
//       Todo va en UNA petición a rider-estado ('entregado' + `cobro`), que mira Stripe antes de
//       dar por bueno el efectivo: nunca se cobra dos veces ni queda un pedido a medias.
//       Los botones NO se pintan hasta tener la forma de pago recargada del servidor: el pedido que
//       llega de la lista puede venir sin ella y se vería «cobrar» en un pedido ya pagado.
//   - Entregado: cerrado, mensaje de éxito.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Phone, MessageCircle, Package, Truck, CheckCircle2, Navigation, CreditCard, Banknote, TriangleAlert, RefreshCw } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { riderEstado } from '../../lib/riderApi'
import { useRider } from '../../context/RiderContext'
import { isNativeSync } from '../../lib/capacitor'
import { colors } from '../../lib/uiStyles'
import { calcGanancia } from '../../lib/ganancia'
import { hayQueCobrar, estadoPago, etiquetaPago } from '../../lib/metodoPago'
import {
  cobroMovilSoportado, configCobroMovil, prepararLector, cobrarPedido,
  leerCobros, datafonoFisicoActivo, requisitosTapToPay, abrirAjustesNfc, mensajeEntrega,
} from '../../lib/cobroMovil'

// Columnas que se recargan del pedido. metodo_pago + stripe_payment_id + reembolso deciden los
// botones de cobro y el bloque de pago; socio_liq_* es la ganancia congelada al entregar.
const COLUMNAS_PEDIDO = 'id, codigo, estado, modo_entrega, origen_pedido, subtotal, total, coste_envio, propina, establecimiento_id, usuario_id, direccion_entrega, lat_entrega, lng_entrega, metodo_pago, stripe_payment_id, reembolsado_at, monto_reembolsado, cliente_telefono, guest_telefono, guest_nombre, notas, socio_liq_total, socio_liq_envio, socio_liq_comision, socio_liq_propina, socio_liq_comision_pct, socio_liq_tarifa_modo, socio_liq_tarifa_fija'

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
  const { refreshAsignaciones, socio } = useRider() || {}
  const [pedido, setPedido] = useState(initial)
  const [pacto, setPacto] = useState(null) // tarifa pactada con el restaurante (fija/distancia)
  const [items, setItems] = useState([])
  const [est, setEst] = useState(null)
  const [cliente, setCliente] = useState(null)
  const [busy, setBusy] = useState(null)
  // Forma de pago recargada del servidor (sin ella no se pintan los botones de cobro/entrega).
  const [cargado, setCargado] = useState(false)
  const [errorCarga, setErrorCarga] = useState(false)
  const [recarga, setRecarga] = useState(0)
  // Cobros con el móvil de este pedido (pedido_cobros_movil; no llega por realtime).
  const [cobros, setCobros] = useState([])

  const releerCobros = useCallback(async () => {
    const r = await leerCobros([pedido.id])
    if (r.ok) setCobros(r.filas)
  }, [pedido.id])

  useEffect(() => {
    let cancel = false
    ;(async () => {
      setErrorCarga(false)
      // Re-cargamos el pedido completo (el objeto entrante puede venir parcial).
      const [pedRes, itemsRes, cobrosRes] = await Promise.all([
        supabase.from('pedidos').select(COLUMNAS_PEDIDO).eq('id', pedido.id).maybeSingle(),
        supabase.from('pedido_items').select('*').eq('pedido_id', pedido.id),
        leerCobros([pedido.id]),
      ])
      if (cancel) return
      if (pedRes.error || !pedRes.data) {
        // Sin la forma de pago real no se enseña ni «cobrar» ni «entregado».
        setErrorCarga(true)
      } else {
        setCargado(true)
      }
      const ped = pedRes.data ? { ...pedido, ...pedRes.data } : pedido
      setPedido((p) => (pedRes.data ? { ...p, ...pedRes.data } : p))
      if (itemsRes.data) setItems(itemsRes.data)
      if (cobrosRes.ok) setCobros(cobrosRes.filas)

      // Pacto vigente con ese restaurante: si es precio fijo, se muestra en la ganancia.
      if (socio?.id && ped.establecimiento_id) {
        supabase.from('socio_establecimiento')
          .select('tarifa_modo, tarifa_fija, comision_pct')
          .eq('socio_id', socio.id).eq('establecimiento_id', ped.establecimiento_id)
          .maybeSingle()
          .then(({ data }) => { if (!cancel && data) setPacto(data) }, () => {})
      }

      const [estRes, cliRes] = await Promise.all([
        ped.establecimiento_id
          ? supabase.from('establecimientos').select('nombre, direccion, telefono, logo_url, latitud, longitud').eq('id', ped.establecimiento_id).maybeSingle()
          : Promise.resolve({ data: null }),
        // Vista, no la tabla `usuarios`: el socio solo puede ver el contacto de los
        // clientes de sus pedidos, y solo las columnas que se pintan aquí.
        ped.usuario_id
          ? supabase.from('v_clientes_de_mis_pedidos').select('nombre, apellido, telefono').eq('id', ped.usuario_id).maybeSingle()
          : Promise.resolve({ data: null }),
      ])
      if (cancel) return
      setEst(estRes.data || null)
      setCliente(cliRes.data || null)
    })()
    return () => { cancel = true }
  }, [pedido.id, recarga])

  // Realtime sobre el pedido para reflejar cambios externos. Si pasa a tarjeta (el webhook de
  // Stripe registró un cobro con el móvil), se releen los cobros: esa tabla no va por realtime.
  useEffect(() => {
    const ch = supabase.channel('rider-detalle-' + pedido.id)
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'pedidos',
        filter: `id=eq.${pedido.id}`,
      }, (payload) => {
        setPedido(p => ({ ...p, ...payload.new }))
        if (payload.new?.metodo_pago === 'tarjeta') releerCobros()
      })
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [pedido.id, releerCobros])

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

  // ─── Cobro en la puerta (v305) ───────────────────────────────
  // Tap to Pay: la configuración (¿habilitado este socio?, ¿qué formas de pago?) y los requisitos
  // del móvil se miran desde «Recogido», para calentar el lector antes de llegar a la puerta.
  const soportado = cobroMovilSoportado()
  const enReparto = paso === 1 || paso === 2
  const [cfgCobro, setCfgCobro] = useState(null)        // null = todavía no se sabe
  const [reqMovil, setReqMovil] = useState(undefined)   // undefined = comprobando · null = no se pudo
  // «Cobrado con datáfono del restaurante»: undefined = comprobando · true/false · null = no se pudo leer.
  const [datafonoFisico, setDatafonoFisico] = useState(undefined)
  const [faseTarjeta, setFaseTarjeta] = useState(null)  // null | 'preparando' | 'tarjeta' | 'confirmando'
  const [cobradoTarjeta, setCobradoTarjeta] = useState(null) // { importeCent, pendienteRegistro }
  const [errorTarjeta, setErrorTarjeta] = useState(null)
  const [aviso, setAviso] = useState(null)              // mensaje de la última entrega que no salió

  useEffect(() => {
    if (!enReparto) return
    let cancel = false
    datafonoFisicoActivo().then((v) => { if (!cancel) setDatafonoFisico(v) }, () => { if (!cancel) setDatafonoFisico(null) })
    if (soportado) {
      configCobroMovil().then((c) => { if (!cancel) setCfgCobro(c) }, () => { if (!cancel) setCfgCobro({ habilitado: false, metodos: [] }) })
      requisitosTapToPay().then((r) => { if (!cancel) setReqMovil(r) }, () => { if (!cancel) setReqMovil(null) })
    }
    // Con mala cobertura la configuración puede tardar: el socio no se queda sin botones.
    // Se enseña «efectivo» y, si luego llega que puede cobrar con tarjeta, aparece ese botón.
    // El datáfono del restaurante, si no se pudo leer, se ENSEÑA (null): decide el servidor.
    const espera = setTimeout(() => {
      if (cancel) return
      setDatafonoFisico((v) => (v === undefined ? null : v))
      if (soportado) {
        setCfgCobro((c) => c ?? { habilitado: false, metodos: [] })
        setReqMovil((r) => (r === undefined ? null : r))
      }
    }, 6000)
    return () => { cancel = true; clearTimeout(espera) }
  }, [enReparto, soportado])

  // ¿Puede ESTE móvil cobrar ESTE pedido con tarjeta? Sin NFC o con Android < 13, no.
  const tapToPay = !!(soportado && cfgCobro?.habilitado
    && cfgCobro.metodos.includes(pedido.metodo_pago)
    && (reqMovil == null || reqMovil.hardwareOk))

  // Se calienta el lector en cuanto se sabe que este pedido se cobra con el móvil: la primera
  // conexión tarda unos segundos y mejor que no sea delante del cliente. Si falla, se reintenta
  // al pulsar el botón, y ahí sí se enseña el motivo.
  useEffect(() => {
    if (!tapToPay || !cfgCobro?.locationId || !cargado) return
    prepararLector(cfgCobro.locationId).catch(() => {})
  }, [tapToPay, cfgCobro?.locationId, cargado])

  // Pagado = la forma de pago no pide cobrar (tarjeta de la app, pagado en el local) o hay un cobro
  // con el móvil confirmado. Si la tarjeta se acaba de cobrar aquí y aún no consta en el servidor
  // (sin cobertura), tampoco se ofrece «efectivo»: el cliente ya ha pagado.
  const cobroMovilOk = cobros.some((c) => c.estado === 'cobrado')
  const tarjetaSinApuntar = !!cobradoTarjeta && hayQueCobrar(pedido.metodo_pago) && !cobroMovilOk
  const yaPagado = !hayQueCobrar(pedido.metodo_pago) || cobroMovilOk
  // No se pintan los botones de la puerta hasta saber la forma de pago real y, si el móvil puede
  // cobrar con tarjeta, hasta saber si este socio puede: así no «salta» un botón encima de otro.
  // En datáfono se espera también a saber si sale «Cobrado con datáfono del restaurante»: si
  // apareciera tarde, el socio podría pulsar «efectivo» sin querer y descuadrar el cajón.
  const botonesListos = cargado
    && (!soportado || (cfgCobro !== null && reqMovil !== undefined))
    && (pedido.metodo_pago !== 'datafono' || datafonoFisico !== undefined)
  // Solo un 'off' leído del servidor lo esconde (null = no se pudo leer → se enseña).
  const verDatafonoFisico = pedido.metodo_pago === 'datafono' && datafonoFisico !== false

  // Entrega con (o sin) cobro. UNA petición: rider-estado cobra y entrega a la vez.
  async function entregar(cobro) {
    setBusy(cobro || 'entregado')
    setAviso(null)
    try {
      const res = await riderEstado(pedido.id, 'entregado', cobro ? { cobro } : {})
      if (res?.ok) {
        refreshAsignaciones?.()
        onBack?.()
        return true
      }
      try { if (navigator.vibrate) navigator.vibrate(200) } catch (_) {}
      if (res?.sessionDead) {
        alert('Tu sesión ha caducado. Vuelve a iniciar sesión para continuar.')
        try { await supabase.auth.signOut() } catch (_) {}
        return false
      }
      setAviso(mensajeEntrega(res))
      // El servidor puede haber encontrado (y registrado) un cobro con tarjeta: se relee todo.
      const cod = res?.data?.error || res?.error
      if (['ya_cobrado_con_tarjeta', 'ya_pagado', 'cobro_tarjeta_en_curso', 'estado_invalido', 'estado_no_cobrable'].includes(cod)) {
        setRecarga((n) => n + 1)
      }
      return false
    } catch (_) {
      setAviso(mensajeEntrega({ status: 0 }))
      return false
    } finally {
      setBusy(null)
    }
  }

  async function cobrarConTarjeta() {
    if (faseTarjeta || busy) return
    setErrorTarjeta(null)
    setAviso(null)
    try {
      const r = await cobrarPedido(pedido.id, { onPaso: setFaseTarjeta })
      setCobradoTarjeta(r)
      try { if (navigator.vibrate) navigator.vibrate([60, 40, 60]) } catch (_) {}
      setFaseTarjeta(null)
      releerCobros()
      // Cobrado: el pedido queda entregado solo (rider-estado vuelve a mirar Stripe antes).
      await entregar('tarjeta')
    } catch (e) {
      setErrorTarjeta(e?.message || 'No se pudo cobrar. Inténtalo otra vez.')
      try { if (navigator.vibrate) navigator.vibrate(200) } catch (_) {}
      // Por si el fallo fue de red tras cobrar: el servidor manda.
      releerCobros()
    } finally {
      setFaseTarjeta(null)
    }
  }

  const ocupado = !!busy || !!faseTarjeta
  const importeTxt = total.toFixed(2).replace('.', ',')

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
          {/* Indicaciones del cliente ("portal 3, el timbre no va"). Es la pantalla que
              el socio mira en la puerta, así que van aquí y no enterradas en el pedido. */}
          {pedido.notas && (
            <div style={{
              marginBottom: 10, padding: '9px 11px', borderRadius: 10,
              background: colors.cream2, border: `1px solid ${colors.border}`,
              fontSize: 12.5, color: colors.ink, lineHeight: 1.4,
            }}>
              <strong>Indicaciones:</strong> {pedido.notas}
            </div>
          )}
          {telefonoCliente ? (
            <div style={{ display: 'flex', gap: 8 }}>
              <a href={`tel:${telefonoCliente}`} style={contactBtn(colors.sageSoft, colors.sage2)}>
                <Phone size={15} strokeWidth={2.4} /> Llamar
              </a>
              <a
                href={waLink(telefonoCliente, pedido.codigo)}
                target="_blank" rel="noopener noreferrer"
                style={contactBtn(colors.whatsappBg, colors.whatsappInk)}
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
                  {it.cantidad}× <strong>{it.nombre_producto || 'Producto'}</strong>
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

          {/* Estado del pago: es lo último que mira el repartidor antes de llamar al timbre.
              Check verde solo con prueba de Stripe (cobro con el móvil o tarjeta de la app). */}
          <PagoBox pedido={pedido} cobros={cobros} cargado={cargado} total={total} />
        </Card>

        {/* TU GANANCIA — desglose de lo que gana el socio en este pedido */}
        <GananciaCard pedido={pedido} pacto={pacto} />

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
            {/* Mensaje de la última entrega que no salió (ya cobrado con tarjeta, sin red…). */}
            {aviso && (
              <div style={{
                display: 'flex', gap: 8, alignItems: 'flex-start',
                padding: '10px 12px', borderRadius: 10,
                background: colors.warningSoft, color: colors.warningInk,
                fontSize: 12.5, fontWeight: 700, lineHeight: 1.4,
              }}>
                <TriangleAlert size={16} strokeWidth={2.4} style={{ flexShrink: 0, marginTop: 1 }} />
                <span>{aviso}</span>
              </div>
            )}

            {!botonesListos ? (
              // Sin la forma de pago real no se ofrece ni cobrar ni entregar.
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                padding: '14px', borderRadius: 14,
                background: colors.cream2, color: colors.stone,
                fontSize: 13, fontWeight: 700, textAlign: 'center',
              }}>
                {errorCarga ? (
                  <>
                    <span>No se pudo cargar la forma de pago.</span>
                    <button onClick={() => setRecarga((n) => n + 1)} style={{
                      display: 'inline-flex', alignItems: 'center', gap: 5,
                      padding: '6px 10px', borderRadius: 999, border: `1px solid ${colors.border}`,
                      background: colors.paper, color: colors.ink, fontSize: 12, fontWeight: 700,
                      cursor: 'pointer', fontFamily: "'Plus Jakarta Sans', sans-serif",
                    }}>
                      <RefreshCw size={13} strokeWidth={2.4} /> Reintentar
                    </button>
                  </>
                ) : 'Comprobando la forma de pago…'}
              </div>
            ) : tarjetaSinApuntar ? (
              // Cobrado con el móvil pero la entrega no salió (sin cobertura): solo queda entregar.
              <>
                <CobradoTarjetaBox cobrado={cobradoTarjeta} />
                <button onClick={() => entregar('tarjeta')} disabled={ocupado} style={primaryBtn(ocupado)}>
                  <CheckCircle2 size={17} strokeWidth={2.4} />
                  {busy === 'tarjeta' ? 'Marcando…' : 'Marcar entregado'}
                </button>
              </>
            ) : yaPagado ? (
              <button onClick={() => entregar(null)} disabled={ocupado} style={primaryBtn(ocupado)}>
                <CheckCircle2 size={17} strokeWidth={2.4} />
                {busy === 'entregado' ? 'Marcando…' : 'Entregado'}
              </button>
            ) : (
              <>
                {tapToPay && (
                  <>
                    <button onClick={cobrarConTarjeta} disabled={ocupado} style={{
                      ...primaryBtn(ocupado),
                      background: colors.ink, color: colors.cream,
                      boxShadow: '0 8px 18px rgba(26,24,21,0.22), inset 0 1px 0 rgba(255,255,255,0.12)',
                    }}>
                      <CreditCard size={17} strokeWidth={2.4} />
                      {faseTarjeta === 'preparando' ? 'Preparando el cobro…'
                        : faseTarjeta === 'tarjeta' ? 'Acerca la tarjeta al móvil…'
                          : faseTarjeta === 'confirmando' ? 'Comprobando el pago…'
                            : busy === 'tarjeta' ? 'Marcando entregado…'
                              : `Cobrar con tarjeta · ${importeTxt} €`}
                    </button>
                    {errorTarjeta ? (
                      <div style={{
                        padding: '9px 12px', borderRadius: 10,
                        background: colors.dangerSoft, color: colors.danger,
                        fontSize: 12.5, fontWeight: 700, lineHeight: 1.4,
                      }}>{errorTarjeta}</div>
                    ) : reqMovil && !reqMovil.listo ? (
                      // El móvil vale, pero falta algo que el socio puede arreglar en Ajustes.
                      <div style={{
                        display: 'flex', flexDirection: 'column', gap: 6,
                        padding: '9px 12px', borderRadius: 10,
                        background: colors.warningSoft, color: colors.warningInk,
                        fontSize: 12, fontWeight: 700, lineHeight: 1.4,
                      }}>
                        {!reqMovil.nfcActivado && <span>El NFC está apagado: actívalo para cobrar con tarjeta.</span>}
                        {reqMovil.opcionesDesarrollador && <span>Apaga las «Opciones de desarrollador» del móvil para cobrar con tarjeta.</span>}
                        {!reqMovil.nfcActivado && (
                          <button onClick={abrirAjustesNfc} style={{
                            alignSelf: 'flex-start', padding: '6px 10px', borderRadius: 999,
                            border: `1px solid ${colors.warning}`, background: colors.paper, color: colors.warningInk,
                            fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: "'Plus Jakarta Sans', sans-serif",
                          }}>Abrir ajustes de NFC</button>
                        )}
                      </div>
                    ) : (
                      <div style={{ fontSize: 11.5, color: colors.stone, fontWeight: 600, textAlign: 'center' }}>
                        El cliente acerca su tarjeta o su móvil a la parte de atrás de tu teléfono.
                      </div>
                    )}
                  </>
                )}
                {/* Datáfono del restaurante ANTES que efectivo: el cliente eligió pagar con tarjeta, y
                    pulsar «efectivo» por error pasa el pedido a efectivo y descuadra el cajón. */}
                {verDatafonoFisico && (
                  <button onClick={() => entregar('datafono_fisico')} disabled={ocupado} style={{
                    ...primaryBtn(ocupado),
                    background: colors.paper,
                    color: colors.ink,
                    border: `1px solid ${colors.borderStrong}`,
                    boxShadow: 'none',
                  }}>
                    <CreditCard size={17} strokeWidth={2.4} />
                    {busy === 'datafono_fisico' ? 'Marcando…' : 'Cobrado con datáfono del restaurante'}
                  </button>
                )}
                <button onClick={() => entregar('efectivo')} disabled={ocupado} style={primaryBtn(ocupado)}>
                  <Banknote size={17} strokeWidth={2.4} />
                  {busy === 'efectivo' ? 'Marcando…' : `Cobrado en efectivo · ${importeTxt} €`}
                </button>
              </>
            )}

            <button onClick={handleFallido} disabled={ocupado} style={{
              ...primaryBtn(ocupado),
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
// Si el pedido ya tiene la ganancia CONGELADA (socio_liq_*, se congela al entregar con el pacto
// vigente), manda esa: es la que se factura. Si no, se estima con el pacto (calcGanancia).
function GananciaCard({ pedido, pacto }) {
  const isDelivery = pedido.modo_entrega === 'delivery'
  const congelada = pedido.socio_liq_total != null
  const g = congelada
    ? {
        envio: Number(pedido.socio_liq_envio || 0),
        comision: Number(pedido.socio_liq_comision || 0),
        propina: Number(pedido.socio_liq_propina || 0),
        comisionPct: Number(pedido.socio_liq_comision_pct || 0),
        total: Number(pedido.socio_liq_total || 0),
      }
    : calcGanancia(pedido, pacto)
  const esTarifaFija = congelada ? pedido.socio_liq_tarifa_modo === 'fija' : pacto?.tarifa_modo === 'fija'
  const importeFijo = congelada
    ? Number(pedido.socio_liq_tarifa_fija ?? g.envio)
    : Number(pacto?.tarifa_fija ?? 0)
  return (
    <div style={{
      background: colors.sageSoft, borderRadius: 14, padding: 14,
      border: `1px solid ${colors.sage}`,
    }}>
      <SectionLabel>Tu ganancia</SectionLabel>
      {esTarifaFija && (
        <div style={{ fontSize: 11.5, fontWeight: 700, color: colors.sage2, marginBottom: 8 }}>
          Tarifa fija pactada: {importeFijo.toFixed(2).replace('.', ',')} € por entrega, sea cual sea la distancia.
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 }}>
        {isDelivery && <GananciaRow label={esTarifaFija ? 'Tarifa fija' : 'Envío'} value={g.envio} />}
        {isDelivery && <GananciaRow label="Propina" value={g.propina} />}
        {g.comision > 0 && <GananciaRow label={`Comisión ${Number(g.comisionPct)}%`} value={g.comision} />}
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

// ─── Estado del pago (lib/metodoPago.js → estadoPago) ──────
// Check verde solo con prueba de Stripe. En curso y sin cobrar: aviso ámbar con el importe y la
// forma de pago que eligió el cliente, que es lo que el socio necesita en la puerta.
const TONOS_PAGO = {
  ok:        { bg: colors.sageSoft,    fg: colors.sage2 },
  aviso:     { bg: colors.warningSoft, fg: colors.warningInk },
  pendiente: { bg: colors.warningSoft, fg: colors.warningInk },
  error:     { bg: colors.dangerSoft,  fg: colors.danger },
  neutro:    { bg: colors.cream2,      fg: colors.stone },
}

function PagoBox({ pedido, cobros, cargado, total }) {
  if (!cargado) {
    return (
      <div style={{
        marginTop: 10, padding: '8px 12px', borderRadius: 8,
        background: colors.cream2, color: colors.stone, fontSize: 11, fontWeight: 700,
      }}>
        Comprobando la forma de pago…
      </div>
    )
  }
  const e = estadoPago(pedido, cobros)
  const t = TONOS_PAGO[e.tono] || TONOS_PAGO.neutro
  const pendiente = e.tono === 'pendiente'
  return (
    <div style={{
      marginTop: 10, padding: '9px 12px', borderRadius: 8,
      background: t.bg, color: t.fg,
      display: 'flex', alignItems: 'flex-start', gap: 8,
    }}>
      {e.check && <CheckCircle2 size={17} strokeWidth={2.6} style={{ flexShrink: 0, marginTop: 1 }} />}
      {(e.tono === 'aviso' || e.tono === 'error') && <TriangleAlert size={16} strokeWidth={2.4} style={{ flexShrink: 0, marginTop: 1 }} />}
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 12.5, fontWeight: 800 }}>
          {pendiente ? `Pendiente de cobro · ${total.toFixed(2).replace('.', ',')} €` : e.texto}
        </div>
        {pendiente ? (
          <div style={{ fontSize: 11, fontWeight: 700, marginTop: 2 }}>
            El cliente eligió pagar con {METODO_ELEGIDO[pedido.metodo_pago] || etiquetaPago(pedido.metodo_pago).toLowerCase()}.
          </div>
        ) : e.detalle ? (
          <div style={{ fontSize: 11, fontWeight: 700, marginTop: 2, opacity: 0.9 }}>{e.detalle}</div>
        ) : null}
      </div>
    </div>
  )
}

const METODO_ELEGIDO = { efectivo: 'efectivo', datafono: 'datáfono (tarjeta)' }

// Cobrado con el móvil, pero la entrega todavía no ha llegado al servidor.
function CobradoTarjetaBox({ cobrado }) {
  const cobradoTxt = (Number(cobrado?.importeCent || 0) / 100).toFixed(2).replace('.', ',')
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
      padding: '14px', borderRadius: 14,
      background: colors.sageSoft, color: colors.sage2, textAlign: 'center',
    }}>
      <CheckCircle2 size={26} strokeWidth={2.4} />
      <div style={{ fontSize: 15, fontWeight: 800 }}>Cobrado {cobradoTxt} € con tarjeta</div>
      <div style={{ fontSize: 12, color: colors.stone, fontWeight: 600 }}>
        {cobrado?.pendienteRegistro
          ? 'Se apuntará en cuanto haya conexión. No vuelvas a cobrarlo: pulsa «Marcar entregado».'
          : 'No vuelvas a cobrarlo: pulsa «Marcar entregado».'}
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
    background: `linear-gradient(180deg, ${colors.terracotta}, ${colors.terracottaDeep})`,
    color: '#fff', fontSize: 15, fontWeight: 800,
    cursor: disabled ? 'wait' : 'pointer', fontFamily: "'Plus Jakarta Sans', sans-serif",
    boxShadow: '0 8px 18px rgba(197,86,44,0.30), inset 0 1px 0 rgba(255,255,255,0.18)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
    opacity: disabled ? 0.65 : 1,
  }
}
