// ganancia.js — Cálculo de la ganancia del socio por pedido.
//
// Respeta el PACTO socio<->restaurante (socio_establecimiento), 21-jul-2026:
//   - Tarifa FIJA (tarifa_modo='fija'): el socio cobra el IMPORTE FIJO por entrega
//     (tarifa_fija) en lugar del coste_envio, "vaya donde vaya". + propina.
//   - Tarifa por DISTANCIA / sin pacto: coste_envio + propina.
//   - Comisión: % del pacto (comision_pct); si el pacto no lo define, 10% por defecto.
//     TELEFÓNICO (origen_pedido='telefonico'): sin comisión (solo envío + propina).
//   - La PROPINA siempre es del socio (delivery).
//   - Recogida: no hay envío; solo comisión (% del pacto).
//
// Retrocompatible: si no se pasa `pacto`, se comporta como antes (envío + 10% + propina).

export const COMISION_PCT = 0.10

// Redondeo a 2 decimales seguro.
function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100
}

// calcGanancia(pedido, pacto) → { envio, comision, propina, comisionPct, esFija, total }
// pedido: modo_entrega, origen_pedido, subtotal, coste_envio, propina
// pacto (opcional): tarifa_modo, tarifa_fija, comision_pct
export function calcGanancia(pedido, pacto) {
  const p = pedido || {}
  const isDelivery = p.modo_entrega === 'delivery'
  const esTelefonico = p.origen_pedido === 'telefonico'
  const esFija = pacto?.tarifa_modo === 'fija'

  const subtotal = Number(p.subtotal) || 0

  // Comisión: 0 si telefónico O si es una ENTREGA con tarifa fija (el fijo ya es el pago
  // completo del reparto, "vaya donde vaya", sin comisión encima — decisión 21-jul-2026,
  // alineado con calc_ganancia_socio de la BD). Resto: comision_pct del pacto (o 10% por defecto).
  const comisionFrac = (esTelefonico || (isDelivery && esFija))
    ? 0
    : (pacto && pacto.comision_pct != null ? Number(pacto.comision_pct) / 100 : COMISION_PCT)
  const comision = round2(subtotal * comisionFrac)

  // Envío: tarifa fija pactada => importe fijo por entrega; si no => coste_envio real.
  const envio = isDelivery
    ? (esFija ? round2(pacto.tarifa_fija) : round2(p.coste_envio))
    : 0
  const propina = isDelivery ? round2(p.propina) : 0

  const total = round2(envio + comision + propina)

  return { envio, comision, propina, comisionPct: round2(comisionFrac * 100), esFija, total }
}
