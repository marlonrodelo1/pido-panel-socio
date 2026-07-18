// Helpers para mostrar y comparar tarifas pactadas socio<->restaurante.

const fmtEuro = (n) => {
  if (n === null || n === undefined || isNaN(Number(n))) return '—'
  return Number(n).toLocaleString('es-ES', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  }) + ' €'
}

const fmtKm = (n) => {
  if (n === null || n === undefined || isNaN(Number(n))) return '—'
  return Number(n).toLocaleString('es-ES', {
    minimumFractionDigits: 0, maximumFractionDigits: 1,
  }) + ' km'
}

export const fmtPct = (n) => {
  if (n === null || n === undefined || isNaN(Number(n))) return '—'
  return Number(n).toLocaleString('es-ES', {
    minimumFractionDigits: 0, maximumFractionDigits: 1,
  }) + ' %'
}

// ¿La tarifa está pactada como PRECIO FIJO por entrega? (18-jul-2026)
// Las tarifas antiguas no traen tarifa_modo → se asumen 'distancia'.
export function esTarifaFija(t) {
  return t?.tarifa_modo === 'fija'
}

// Formato compacto: "3,00 € (≤5 km) · +0,50 €/km · máx 10,00 €"
// En modo fijo: "4,50 € por entrega · 10 % comisión"
export function formatTarifa(t) {
  if (!t) return 'Tarifa por defecto de la plataforma'

  if (esTarifaFija(t)) {
    const partes = [`${fmtEuro(t.tarifa_fija)} por entrega`]
    if (t.comision_pct !== null && t.comision_pct !== undefined) {
      partes.push(`${fmtPct(t.comision_pct)} comisión`)
    }
    return partes.join(' · ')
  }

  const base = t.tarifa_base
  const radio = t.tarifa_radio_base_km
  const porKm = t.tarifa_precio_km
  const max = t.tarifa_maxima

  const partes = []
  if (base !== null && base !== undefined) {
    partes.push(`${fmtEuro(base)} (≤${fmtKm(radio)})`)
  }
  if (porKm !== null && porKm !== undefined && Number(porKm) > 0) {
    partes.push(`+${fmtEuro(porKm)}/km`)
  }
  if (max !== null && max !== undefined) {
    partes.push(`máx ${fmtEuro(max)}`)
  }
  if (t.comision_pct !== null && t.comision_pct !== undefined) {
    partes.push(`${fmtPct(t.comision_pct)} comisión`)
  }
  if (partes.length === 0) return 'Tarifa por defecto de la plataforma'
  return partes.join(' · ')
}

// Versión larga, una línea por concepto. Se usa en la tabla comparativa.
export function tarifaCampos(t) {
  if (esTarifaFija(t)) {
    return [
      { campo: 'tarifa_fija', label: 'Precio por entrega', valor: t?.tarifa_fija, fmt: fmtEuro },
    ]
  }
  return [
    { campo: 'tarifa_base', label: 'Tarifa base', valor: t?.tarifa_base, fmt: fmtEuro },
    { campo: 'tarifa_radio_base_km', label: 'Radio incluido', valor: t?.tarifa_radio_base_km, fmt: fmtKm },
    { campo: 'tarifa_precio_km', label: 'Precio km extra', valor: t?.tarifa_precio_km, fmt: fmtEuro },
    { campo: 'tarifa_maxima', label: 'Tarifa máxima', valor: t?.tarifa_maxima, fmt: fmtEuro },
  ]
}

// Compara dos tarifas. Devuelve 'mejor' desde el punto de vista del socio:
//  - tarifa_base sube => mejor para socio (cobra más)
//  - tarifa_precio_km sube => mejor para socio
//  - tarifa_maxima sube => mejor para socio
//  - tarifa_radio_base_km sube => peor para socio (más km incluidos sin cobrar extra)
export function compararTarifas(actual, propuesta) {
  const a = actual || {}
  const p = propuesta || {}

  // Cambio de MODALIDAD (fija <-> distancia): los importes no son comparables campo a
  // campo, así que se muestra como un único cambio de tipo de acuerdo.
  const modoA = esTarifaFija(a) ? 'fija' : 'distancia'
  const modoP = esTarifaFija(p) ? 'fija' : 'distancia'
  if (modoA !== modoP) {
    return [
      { campo: 'tarifa_modo', antes: modoA, despues: modoP, mejor: 'cambio_modalidad', esModalidad: true },
      { campo: 'comision_pct', antes: a.comision_pct, despues: p.comision_pct, mejor: 'igual' },
    ]
  }

  // Ambas fijas: solo importe + comisión.
  if (modoP === 'fija') {
    const antes = a.tarifa_fija, despues = p.tarifa_fija
    const igual = Number(antes) === Number(despues)
    return [
      { campo: 'tarifa_fija', antes, despues, mejor: igual ? 'igual' : (Number(despues) > Number(antes) ? 'despues' : 'antes') },
      { campo: 'comision_pct', antes: a.comision_pct, despues: p.comision_pct,
        mejor: Number(a.comision_pct) === Number(p.comision_pct) ? 'igual' : (Number(p.comision_pct) > Number(a.comision_pct) ? 'despues' : 'antes') },
    ]
  }

  const cmp = (campo, subeEsMejor) => {
    const antes = a[campo]
    const despues = p[campo]
    const igual = (antes ?? null) === (despues ?? null) ||
      (Number(antes) === Number(despues))
    if (igual) return { campo, antes, despues, mejor: 'igual' }
    if (antes === null || antes === undefined) return { campo, antes, despues, mejor: 'despues' }
    if (despues === null || despues === undefined) return { campo, antes, despues, mejor: 'antes' }
    const sube = Number(despues) > Number(antes)
    const mejor = (sube === subeEsMejor) ? 'despues' : 'antes'
    return { campo, antes, despues, mejor }
  }
  return [
    cmp('tarifa_base', true),
    cmp('tarifa_radio_base_km', false),
    cmp('tarifa_precio_km', true),
    cmp('tarifa_maxima', true),
    cmp('comision_pct', true),
  ]
}

// "X días Y horas" o, si <24h, "Y horas Z minutos". Si <1h, "Z minutos".
export function formatCuentaAtras(timestamp) {
  if (!timestamp) return null
  const ahora = Date.now()
  const fin = new Date(timestamp).getTime()
  const ms = fin - ahora
  if (ms <= 0) return { label: 'Caducada', urgente: true, expirada: true }
  const totalMin = Math.floor(ms / 60000)
  const dias = Math.floor(totalMin / (60 * 24))
  const horas = Math.floor((totalMin % (60 * 24)) / 60)
  const minutos = totalMin % 60
  let label
  if (dias >= 1) label = `${dias} día${dias === 1 ? '' : 's'} ${horas} h`
  else if (horas >= 1) label = `${horas} h ${minutos} min`
  else label = `${minutos} min`
  const urgente = ms < 24 * 60 * 60 * 1000
  return { label, urgente, expirada: false }
}

// Fecha corta DD/MM
export function formatFechaCorta(timestamp) {
  if (!timestamp) return '—'
  const d = new Date(timestamp)
  return d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' })
}

export const _fmtEuro = fmtEuro
export const _fmtKm = fmtKm
