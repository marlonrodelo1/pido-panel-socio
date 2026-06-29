// riderApi.js — Cliente HTTP a las edge functions rider-*.
//
// Wraps supabase.functions.invoke con logging a push_debug_logs para depurar
// en producción cuando algo falla. Sin estado, solo funciones puras.
//
// ENVÍO NATIVO (junio 2026): las llamadas de ubicación y latido (rider-update-
// location, rider-heartbeat) se mandan por CapacitorHttp en la app nativa, NO por
// supabase.functions.invoke. Motivo: supabase-js corre dentro del WebView y
// Android estrangula las peticiones HTTP del WebView cuando la app lleva ~5 min en
// segundo plano, dejando de subir la señal aunque el repartidor siga ahí.
// CapacitorHttp sale por la capa nativa y no sufre ese throttling, así que el
// socio sigue "vivo" para el cron de auto-offline aunque tenga la app de fondo.

import { supabase, FUNCTIONS_URL } from './supabase'
import { isNativePlatform } from './capacitor'

const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

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

// Igual que invoke() pero, en la app NATIVA, sale por CapacitorHttp (capa nativa)
// para esquivar el throttling del WebView en segundo plano. En web cae al invoke
// normal de supabase-js (que en foreground funciona perfecto). Si el envío nativo
// falla por lo que sea, también cae al invoke normal como red de seguridad.
async function invokeNative(fnName, body = {}) {
  const t0 = Date.now()
  try {
    if (await isNativePlatform()) {
      let { data: { session } } = await supabase.auth.getSession()
      // Refrescar el token si falta o está a <60s de caducar: en segundo plano el
      // autoRefresh del WebView puede no haber disparado, y la edge (verify_jwt)
      // devolvería 401 justo cuando más falta hace el latido.
      const expSoonMs = session?.expires_at ? session.expires_at * 1000 - Date.now() : 0
      if (!session || expSoonMs < 60_000) {
        try {
          const r = await supabase.auth.refreshSession()
          if (r?.data?.session) session = r.data.session
        } catch (_) {}
      }
      const token = session?.access_token
      if (!token) {
        // Sin token utilizable: caer a la vía supabase-js, que refresca por su cuenta.
        logDebug(fnName, 'native_no_session_fallback', { body })
        return invoke(fnName, body)
      }
      const { CapacitorHttp } = await import('@capacitor/core')
      const res = await CapacitorHttp.post({
        url: `${FUNCTIONS_URL}/${fnName}`,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'apikey': ANON_KEY,
        },
        data: body,
      })
      const ms = Date.now() - t0
      const ok = res.status >= 200 && res.status < 300
      if (!ok) {
        console.warn(`[riderApi] ${fnName} native (${ms}ms) http ${res.status}`)
        logDebug(fnName, 'native_error', { status: res.status, body, ms })
        // 401/403 = token rechazado: reintentar por supabase-js, que refresca el
        // token internamente. Así un beat en background no se pierde por caducidad.
        if (res.status === 401 || res.status === 403) return invoke(fnName, body)
        return { ok: false, error: `http_${res.status}`, data: res.data ?? null }
      }
      return { ok: true, data: res.data ?? null, error: null }
    }
  } catch (e) {
    console.warn(`[riderApi] ${fnName} native exception, fallback invoke:`, e?.message)
    logDebug(fnName, 'native_exception', { error: e?.message, body })
    // cae al invoke normal abajo
  }
  return invoke(fnName, body)
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

// Llamada autenticada que devuelve el CÓDIGO HTTP real + bandera `sessionDead`.
// Si el token es rechazado (401/403), fuerza un refresh y reintenta UNA vez; si
// vuelve a fallar, la sesión está muerta (refresh token caducado) → sessionDead=true
// para que el caller fuerce re-login. Se usa en aceptar/rechazar (foreground), donde
// hay que distinguir "sesión caducada" (401) de "ya lo tomó otro / expiró" (409).
async function callEdgeAuthed(fnName, body = {}) {
  async function getToken(forceRefresh) {
    let { data: { session } } = await supabase.auth.getSession()
    const expSoonMs = session?.expires_at ? session.expires_at * 1000 - Date.now() : 0
    if (forceRefresh || !session || expSoonMs < 60_000) {
      try { const r = await supabase.auth.refreshSession(); if (r?.data?.session) session = r.data.session } catch (_) {}
    }
    return session?.access_token || null
  }
  const post = (token) => fetch(`${FUNCTIONS_URL}/${fnName}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}`, 'apikey': ANON_KEY },
    body: JSON.stringify(body),
  })
  try {
    let token = await getToken(false)
    if (!token) return { ok: false, status: 401, sessionDead: true, error: 'no_session', data: null }
    let res = await post(token)
    if (res.status === 401 || res.status === 403) {
      token = await getToken(true)
      if (token) res = await post(token)
      if (res.status === 401 || res.status === 403) {
        logDebug(fnName, 'session_dead', { status: res.status })
        return { ok: false, status: res.status, sessionDead: true, error: `http_${res.status}`, data: null }
      }
    }
    let data = null
    try { data = await res.json() } catch (_) {}
    if (!res.ok) {
      logDebug(fnName, 'http_error', { status: res.status, data })
      return { ok: false, status: res.status, error: data?.error || `http_${res.status}`, data }
    }
    return { ok: true, status: res.status, data, error: null }
  } catch (e) {
    logDebug(fnName, 'exception', { error: e?.message })
    return { ok: false, status: 0, error: e?.message || 'network', data: null }
  }
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
// GPS + LATIDO DE PRESENCIA
// ────────────────────────────────────────────────────────────

// Actualización de posición (se dispara al moverse el repartidor). Vía nativa.
export function riderUpdateLocation({ latitud, longitud, accuracy }) {
  return invokeNative('rider-update-location', { latitud, longitud, accuracy })
}

// Latido cada ~60s mientras el socio está online, aunque NO se mueva. Mantiene
// vivo socios.last_location_at para que el cron de auto-offline no lo apague.
// lat/lng son opcionales (última posición conocida si la hay). Vía nativa.
export function riderHeartbeat({ latitud, longitud } = {}) {
  return invokeNative('rider-heartbeat', { latitud, longitud })
}

// ────────────────────────────────────────────────────────────
// ASIGNACIONES
// ────────────────────────────────────────────────────────────

export function riderAcceptOrder(asignacionId) {
  return callEdgeAuthed('rider-accept-order', { asignacion_id: asignacionId })
}

export function riderRejectOrder(asignacionId, motivo = null) {
  return callEdgeAuthed('rider-reject-order', { asignacion_id: asignacionId, motivo })
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

// ────────────────────────────────────────────────────────────
// MÁQUINA DE ESTADOS DEL REPARTO (edge unificada `rider-estado`)
// ────────────────────────────────────────────────────────────
//
// accion = 'recogido' | 'en_camino' | 'entregado' | 'fallido'
//   - 'fallido' admite extra = { motivo }
//   - 'entregado' admite extra = { foto_url } opcional
// El backend actualiza pedido.estado y dispara el push al cliente.
export function riderEstado(pedidoId, accion, extra = {}) {
  return invoke('rider-estado', { pedido_id: pedidoId, accion, ...extra })
}
