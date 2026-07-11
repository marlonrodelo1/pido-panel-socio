// ganancia.js — Cálculo de la ganancia del socio por pedido.
//
// Fórmula acordada (por pedido):
//   - delivery: coste_envio + 10% del subtotal + propina
//   - recogida: 10% del subtotal
//   - TELEFÓNICO (origen_pedido='telefonico', creado por el restaurante desde su
//     panel): SOLO coste_envio + propina, sin % del subtotal.
// El 10% es la comisión del socio sobre el subtotal.
// El envío y la propina solo aplican en delivery.

export const COMISION_PCT = 0.10

// Redondeo a 2 decimales seguro.
function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100
}

// calcGanancia(pedido) → { envio, comision, propina, total }
// Lee: pedido.modo_entrega, pedido.origen_pedido, pedido.subtotal, pedido.coste_envio, pedido.propina
export function calcGanancia(pedido) {
  const p = pedido || {}
  const isDelivery = p.modo_entrega === 'delivery'

  const subtotal = Number(p.subtotal) || 0
  const comision = p.origen_pedido === 'telefonico' ? 0 : round2(subtotal * COMISION_PCT)

  const envio = isDelivery ? round2(p.coste_envio) : 0
  const propina = isDelivery ? round2(p.propina) : 0

  const total = round2(envio + comision + propina)

  return { envio, comision, propina, total }
}
