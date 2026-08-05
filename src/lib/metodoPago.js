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
