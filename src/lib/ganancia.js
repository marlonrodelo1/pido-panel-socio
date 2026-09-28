// ganancia.js — Cálculo de la ganancia del socio por pedido.
//
// Respeta el PACTO socio<->restaurante (socio_establecimiento), 21-jul-2026:
//   - Tarifa FIJA (tarifa_modo='fija'): el socio cobra el IMPORTE FIJO por entrega
//     (tarifa_fija) en lugar del coste_envio, "vaya donde vaya". + propina.
//   - Tarifa por DISTANCIA / sin pacto: coste_envio + propina.
//   - Comisión: % del pacto (comision_pct); si el pacto no lo define, 10% por defecto.
//     TELEFÓNICO (origen_pedido='telefonico'): cobra IGUAL que la app en cuanto existe
//     la clave configuracion_plataforma.comision_telefonico_pct_desde (28-sep-2026);
//     sin ella, sin comisión (solo envío + propina), como antes. Es el mismo interruptor
//     que la BD: la migración que quita la exención de calc_ganancia_socio crea la clave,
//     y la vuelta atrás la borra a la vez que devuelve la exención.
//   - La PROPINA siempre es del socio (delivery).
//   - Recogida: no hay envío; solo comisión (% del pacto).
//
// Retrocompatible: si no se pasa `pacto`, se comporta como antes (envío + 10% + propina).

import { useSyncExternalStore } from 'react'
import { supabase } from './supabase'

export const COMISION_PCT = 0.10

// ── ¿El telefónico ya lleva comisión para el socio? ─────────────────────────
// Se lee la clave una vez al cargar la app y, como mucho, cada 10 min después. Mientras
// no se sabe (arranque, sin red), se estima como siempre: SIN comisión. Mejor quedarse
// corto en una estimación que prometer dinero; lo que se cobra de verdad es lo que se
// congela al entregar (socio_liq_*). El formato válido es el mismo que exige la BD
// (_comision_telefonico_corte): lo que la BD no acepta, aquí tampoco.
const RE_CORTE_UTC = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|\+00(:?00)?)$/
const REFRESCO_MS = 10 * 60 * 1000

// Mismo criterio que la BD: formato UTC y una fecha que exista (el 30 de febrero la BD
// lo toma como "sin clave"; JS lo pasaría al 2 de marzo).
function claveValida(t) {
  if (!RE_CORTE_UTC.test(t)) return false
  const iso = t.replace(' ', 'T').replace(/\+00(:?00)?$/, 'Z')
  const d = new Date(iso)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso.slice(0, 10)
}
let telConComision = false
let leidoAt = 0
const oyentes = new Set()

async function leerClaveTelefonico() {
  try {
    const { data, error } = await supabase
      .from('configuracion_plataforma')
      .select('valor')
      .eq('clave', 'comision_telefonico_pct_desde')
      .maybeSingle()
    if (error) return // se queda lo último que se supo
    const nuevo = claveValida(String(data?.valor ?? '').trim())
    if (nuevo !== telConComision) {
      telConComision = nuevo
      oyentes.forEach((fn) => { try { fn() } catch { /* un oyente roto no para a los demás */ } })
    }
  } catch { /* sin red: se queda lo último que se supo */ }
}

function refrescarSiToca() {
  if (Date.now() - leidoAt < REFRESCO_MS) return
  leidoAt = Date.now()
  leerClaveTelefonico()
}
refrescarSiToca()

// Suscripción y lectura FUERA del hook: React quiere funciones estables (si cambian en
// cada render, se da de baja y de alta cada vez).
function suscribir(fn) {
  oyentes.add(fn)
  refrescarSiToca()
  return () => oyentes.delete(fn)
}
const leerTelConComision = () => telConComision

// Para las pantallas: se repintan solas cuando se sabe (o cambia) la clave.
export function useTelefonicoCobraComision() {
  return useSyncExternalStore(suscribir, leerTelConComision)
}

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
  const esFija = pacto?.tarifa_modo === 'fija'
  // Telefónico sin la clave del cambio: sin comisión, como calc_ganancia_socio antes del cambio.
  const telSinComision = p.origen_pedido === 'telefonico' && !telConComision

  const subtotal = Number(p.subtotal) || 0

  // Comisión: 0 si es una ENTREGA con tarifa fija (el fijo ya es el pago completo del
  // reparto, "vaya donde vaya", sin comisión encima — decisión 21-jul-2026, alineado con
  // calc_ganancia_socio de la BD). Resto: comision_pct del pacto (o 10% por defecto).
  // El telefónico solo se exime mientras no exista la clave del cambio (28-sep-2026).
  const comisionFrac = (telSinComision || (isDelivery && esFija))
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
