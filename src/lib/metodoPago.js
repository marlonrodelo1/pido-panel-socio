// Cómo se paga un pedido, en un solo sitio.
//
// REGLA DE SEGURIDAD: solo `tarjeta` y `pagado_local` están COBRADOS. Cualquier
// otro método —incluido uno que no conozcamos todavía— se trata como "hay que
// cobrar". Al revés el fallo es silencioso y cuesta dinero: antes, un pedido
// con datáfono caía en el `else` y le decía al repartidor "Tarjeta (ya pagado)",
// así que lo entregaba sin cobrar.

export const METODOS = {
  efectivo:     { etiqueta: 'Efectivo',  detalle: 'cobra al cliente',   icono: '💵', cobrar: true },
  datafono:     { etiqueta: 'Datáfono',  detalle: 'cobra con el TPV',   icono: '💳', cobrar: true },
  tarjeta:      { etiqueta: 'Tarjeta',   detalle: 'ya pagado',          icono: '✅', cobrar: false },
  pagado_local: { etiqueta: 'Ya pagado', detalle: 'solo entregar',      icono: '✅', cobrar: false },
}

// ¿El repartidor tiene que cobrar en la puerta?
export function hayQueCobrar(metodo) {
  return METODOS[metodo]?.cobrar ?? true
}

// Texto para la pantalla del repartidor: "💳 Datáfono (cobra con el TPV)"
export function textoPago(metodo) {
  const m = METODOS[metodo]
  if (!m) return `💵 Cobrar al cliente (${metodo || 'sin especificar'})`
  return `${m.icono} ${m.etiqueta} (${m.detalle})`
}

// Solo el nombre, para tablas y listados
export function etiquetaPago(metodo) {
  return METODOS[metodo]?.etiqueta || metodo || '—'
}

// ─── Estado del PAGO de un pedido (historial y detalle) ───────────────────────
//
// `metodo_pago` dice cómo QUERÍA pagar el cliente. Esto dice si el dinero se cobró de
// verdad y cómo. El CHECK VERDE solo sale cuando hay prueba de Stripe:
//   - un cobro con el móvil confirmado (pedido_cobros_movil.estado = 'cobrado'), o
//   - un pago con tarjeta en la app (stripe_payment_id 'pi_…').
// El efectivo y el datáfono del restaurante no dejan prueba en Pidoo: sin check.
// Y NUNCA en un pedido cancelado, fallido o sin terminar de pagar (pendiente_pago): el pi_ se
// guarda al crear el pago, no al cobrarlo, así que ahí no prueba nada.
// OJO: el cobro con el móvil pasa el pedido a metodo_pago='tarjeta' con su pi_, así que sin
// mirar `cobros` se confundiría con un pago en la app.
//
// cobros: filas de pedido_cobros_movil del pedido (puede haber varias: intentos anulados,
// uno cobrado…). Solo cuenta la que está 'cobrado'.
// Devuelve { clave, texto, detalle, check, tono } — tono: 'ok' | 'aviso' | 'pendiente' | 'neutro' | 'error'.

const MARCAS = {
  visa: 'Visa', mastercard: 'Mastercard', amex: 'American Express', maestro: 'Maestro',
  discover: 'Discover', diners: 'Diners', jcb: 'JCB', unionpay: 'UnionPay',
  interac: 'Interac', eftpos_au: 'eftpos', cartes_bancaires: 'Cartes Bancaires',
}
const CARTERAS = { apple_pay: 'Apple Pay', google_pay: 'Google Pay', samsung_pay: 'Samsung Pay' }

// "Visa ···4242 · Google Pay" (lo que haya).
export function describirTarjeta(cobro) {
  if (!cobro) return ''
  const marcaCruda = String(cobro.tarjeta_marca || '').toLowerCase()
  const marca = MARCAS[marcaCruda] || (marcaCruda && marcaCruda !== 'unknown' ? cobro.tarjeta_marca : '')
  const ult = cobro.tarjeta_ultimos4 ? `···${cobro.tarjeta_ultimos4}` : ''
  const cartera = CARTERAS[String(cobro.tarjeta_lectura || '').toLowerCase()] || ''
  const tarjeta = [marca, ult].filter(Boolean).join(' ')
  return [tarjeta, cartera].filter(Boolean).join(' · ')
}

function horaCorta(iso) {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
  } catch (_) {
    return ''
  }
}

const eur = (n) => `${(Number(n) || 0).toFixed(2).replace('.', ',')} €`

// El cobro con el móvil que vale (el último confirmado), o null.
export function cobroConfirmado(cobros) {
  const lista = (Array.isArray(cobros) ? cobros : []).filter((c) => c?.estado === 'cobrado')
  lista.sort((a, b) => String(b.cobrado_at || '').localeCompare(String(a.cobrado_at || '')))
  return lista[0] || null
}

export function estadoPago(pedido, cobros = []) {
  const p = pedido || {}
  const metodo = p.metodo_pago
  const filas = (Array.isArray(cobros) ? cobros : []).filter((c) => c && (!c.pedido_id || !p.id || c.pedido_id === p.id))
  const cobrado = cobroConfirmado(filas)
  const conPi = typeof p.stripe_payment_id === 'string' && p.stripe_payment_id.startsWith('pi_')
  const devuelto = Number(p.monto_reembolsado) || 0
  const anulado = p.estado === 'cancelado' || p.estado === 'fallido'
  const sinPagar = p.estado === 'pendiente_pago'

  // 1) Devuelto: nunca con check, aunque se cobrara.
  if (p.reembolsado_at || devuelto > 0) {
    return { clave: 'reembolsado', texto: 'Reembolsado', detalle: devuelto > 0 ? `${eur(devuelto)} devueltos al cliente` : null, check: false, tono: 'neutro' }
  }
  // 2) Cobro con el móvil que Pidoo tiene que mirar (importe distinto, cobrado dos veces…).
  if (filas.some((c) => c.estado === 'cobrado' && c.revisar)) {
    return { clave: 'cobro_revision', texto: 'Cobro con tarjeta en revisión', detalle: 'Pidoo lo está comprobando. No lo vuelvas a cobrar.', check: false, tono: 'aviso' }
  }
  // 3) Anulado o sin terminar de pagar: NUNCA check verde, se mira ANTES que la tarjeta.
  //    El pi_ del pedido NO prueba que se cobrara: se guarda al CREAR el pago en la app, no al
  //    cobrarlo (hay cancelados con pi_ que nunca se pagaron: carritos abandonados). Y un pedido
  //    pagado que el restaurante cancela sigue sin reembolso unos minutos, hasta que
  //    reconciliar-reembolsos pone reembolsado_at. Con check saldría como «pagado» en el historial.
  if (anulado || sinPagar) {
    if (cobrado) {
      // Aquí sí hay prueba (cobro con el móvil confirmado por Stripe) y el pedido no se entregó.
      const detalle = ['Cobro con tarjeta en la puerta', describirTarjeta(cobrado), horaCorta(cobrado.cobrado_at)].filter(Boolean).join(' · ')
      return {
        clave: 'cobrado_sin_entregar',
        texto: anulado ? 'Cobrado · pendiente de devolver' : 'Cobrado · pedido sin completar',
        detalle: `${detalle}. Pidoo lo revisa. No lo vuelvas a cobrar.`,
        check: false, tono: 'aviso',
      }
    }
    if (sinPagar) {
      return { clave: 'pago_sin_completar', texto: 'Pago con tarjeta sin completar', detalle: 'El cliente no ha terminado de pagar en la app.', check: false, tono: 'aviso' }
    }
    if (metodo === 'tarjeta' && conPi) {
      // No sabemos si se llegó a cobrar: no se afirma ni una cosa ni la otra.
      return { clave: 'anulado_tarjeta', texto: 'Anulado', detalle: 'Pago con tarjeta en la app: si llegó a cobrarse, se le devuelve al cliente.', check: false, tono: 'neutro' }
    }
    return { clave: 'no_cobrado', texto: 'No se cobró', detalle: null, check: false, tono: 'neutro' }
  }
  // Desde aquí, solo pedidos en curso o entregados.
  // 4) Cobrado con el móvil en la puerta: prueba de Stripe.
  if (cobrado) {
    const detalle = [describirTarjeta(cobrado), horaCorta(cobrado.cobrado_at)].filter(Boolean).join(' · ')
    return { clave: 'cobro_puerta', texto: 'Cobrado con tarjeta en la puerta', detalle: detalle || null, check: true, tono: 'ok' }
  }
  // 5-6) Tarjeta de la app.
  if (metodo === 'tarjeta' && conPi) {
    return { clave: 'tarjeta_app', texto: 'Pagado con tarjeta en la app', detalle: null, check: true, tono: 'ok' }
  }
  if (metodo === 'tarjeta') {
    return { clave: 'tarjeta_sin_pago', texto: 'Pago no completado', detalle: 'El pago con tarjeta no llegó a confirmarse.', check: false, tono: 'error' }
  }
  // 7-8) Entregado sin prueba en Pidoo.
  if (p.estado === 'entregado' && metodo === 'efectivo') {
    return { clave: 'efectivo', texto: 'Cobrado en efectivo', detalle: null, check: false, tono: 'neutro' }
  }
  if (p.estado === 'entregado' && metodo === 'datafono') {
    return { clave: 'datafono', texto: 'Datáfono del restaurante', detalle: null, check: false, tono: 'neutro' }
  }
  // 9) Pagado en el local.
  if (metodo === 'pagado_local') {
    return { clave: 'pagado_local', texto: 'Pagado en el local', detalle: null, check: false, tono: 'neutro' }
  }
  if (p.estado === 'entregado') {
    return { clave: 'entregado', texto: 'Entregado', detalle: etiquetaPago(metodo), check: false, tono: 'neutro' }
  }
  // 10) En curso: todavía hay que cobrarlo.
  return { clave: 'pendiente', texto: 'Pendiente de cobro', detalle: METODOS[metodo] ? METODOS[metodo].etiqueta : 'Forma de pago sin especificar', check: false, tono: 'pendiente' }
}
