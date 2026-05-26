// riderApi.js — Cliente HTTP a las edge functions rider-*.
//
// Wraps supabase.functions.invoke con logging a push_debug_logs para depurar
// en producción cuando algo falla. Sin estado, solo funciones puras.

import { supabase } from './supabase'

async function invoke(fnName, body = {}) {
  const t0 = Date.now()
  try {
    const { data, error } = await supabase.functions.invoke(fnName, { body })
    const ms = Date.now() - t0
    if (error) {
      console.error(`[riderApi] ${fnName} (${ms}ms) error:`, error)
      logDebug(fnName, 'error', { error: error.message, body, ms })
      return { ok: false, error: error.message, data: null }
    }
    console.log(`[riderApi] ${fnName} (${ms}ms) ok`, data)
    return { ok: true, data, error: null }
  } catch (e) {
    const ms = Date.now() - t0
    console.error(`[riderApi] ${fnName} (${ms}ms) exception:`, e)
    logDebug(fnName, 'exception', { error: e?.message, body, ms })
    return { ok: false, error: e?.message || 'Excepción', data: null }
  }
}

// Log best-effort a push_debug_logs (RLS lo permite con ANON insert).
function logDebug(fn, level, payload) {
  try {
    supabase.from('push_debug_logs').insert({
      source: `riderApi.${fn}`,
      level,
      payload,
    }).then(() => {}, () => {})
  } catch (_) {}
}

// ────────────────────────────────────────────────────────────
// ONLINE / OFFLINE
// ────────────────────────────────────────────────────────────

export function riderOnline({ latitud, longitud, accuracy } = {}) {
  return invoke('rider-online', { latitud, longitud, accuracy })
}

export function riderOffline() {
  return invoke('rider-offline', {})
}

// ────────────────────────────────────────────────────────────
// GPS
// ────────────────────────────────────────────────────────────

export function riderUpdateLocation({ latitud, longitud, accuracy }) {
  return invoke('rider-update-location', { latitud, longitud, accuracy })
}

// ────────────────────────────────────────────────────────────
// ASIGNACIONES
// ────────────────────────────────────────────────────────────

export function riderAcceptOrder(asignacionId) {
  return invoke('rider-accept-order', { asignacion_id: asignacionId })
}

export function riderRejectOrder(asignacionId, motivo = null) {
  return invoke('rider-reject-order', { asignacion_id: asignacionId, motivo })
}

export function riderPickup(pedidoId) {
  return invoke('rider-pickup', { pedido_id: pedidoId })
}

export function riderDeliver(pedidoId, fotoUrl = null) {
  return invoke('rider-deliver', { pedido_id: pedidoId, foto_url: fotoUrl })
}

export function riderFailDelivery(pedidoId, motivo) {
  return invoke('rider-fail-delivery', { pedido_id: pedidoId, motivo })
}
