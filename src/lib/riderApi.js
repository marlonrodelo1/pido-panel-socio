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
import { isNativePlatform, getDeviceId } from './capacitor'

const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL

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
// Renueva la sesión POR VÍA NATIVA (CapacitorHttp), no con supabase.auth.refreshSession().
//
// POR QUÉ (1-ago-2026, causa DEMOSTRADA del "me desconecto a las 2 horas"):
// el POST del latido ya salía por CapacitorHttp para esquivar el estrangulamiento que
// Android aplica al WebView en segundo plano... pero el REFRESCO del token se hacía con
// supabase.auth.refreshSession(), que usa el fetch DEL WEBVIEW — justo el canal
// estrangulado que motivó usar CapacitorHttp. Así que en background el token caducaba y
// no se podía renovar: los latidos empezaban a dar 401, `socios.last_location_at` se
// congelaba y 60 min después el cron auto-offline apagaba al socio.
// Medido en producción sobre 3 socios reales: la señal GPS moría 51,9 / 51,8 / 22,4 min
// después del último refresco de sesión (≈ lo que le quedaba de vida al token), y la media
// entre refrescos era de 3,5-5 h, es decir, solo se renovaba al abrir la app.
// Renovando por la capa nativa el latido sobrevive con la app minimizada.
async function refreshSessionNative() {
  try {
    const { data: { session } } = await supabase.auth.getSession()
    const refreshToken = session?.refresh_token
    if (!refreshToken) return null
    const { CapacitorHttp } = await import('@capacitor/core')
    const res = await CapacitorHttp.post({
      url: `${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`,
      headers: { 'Content-Type': 'application/json', 'apikey': ANON_KEY },
      data: { refresh_token: refreshToken },
    })
    if (res.status < 200 || res.status >= 300) {
      logDebug('auth_refresh', 'native_refresh_error', { status: res.status })
      return null
    }
    const d = res.data || {}
    if (!d.access_token || !d.refresh_token) return null
    // Persistir la sesión nueva para que el resto de la app (y el próximo latido) la use.
    // Si esto fallara por ir vía WebView, seguimos devolviendo el token: la petición en
    // curso no debe perderse por no haber podido guardar la sesión.
    try { await supabase.auth.setSession({ access_token: d.access_token, refresh_token: d.refresh_token }) } catch (_) {}
    return d.access_token
  } catch (e) {
    logDebug('auth_refresh', 'native_refresh_exception', { error: e?.message })
    return null
  }
}

async function invokeNative(fnName, body = {}) {
  const t0 = Date.now()
  try {
    if (await isNativePlatform()) {
      let { data: { session } } = await supabase.auth.getSession()
      // Refrescar el token si falta o está a <60s de caducar. El refresco va por la capa
      // NATIVA (ver refreshSessionNative): con la app en segundo plano, hacerlo por el
      // WebView es exactamente lo que dejaba al socio sin latido y acababa apagándolo.
      const expSoonMs = session?.expires_at ? session.expires_at * 1000 - Date.now() : 0
      let token = session?.access_token
      if (!session || expSoonMs < 60_000) {
        const fresh = await refreshSessionNative()
        if (fresh) {
          token = fresh
        } else {
          // La vía nativa no pudo renovar (sin red, o refresh token revocado) → último
          // intento por supabase-js, que en primer plano sí funciona.
          try {
            const r = await supabase.auth.refreshSession()
            if (r?.data?.session) token = r.data.session.access_token
          } catch (_) {}
        }
      }
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
        // 401/403 = token rechazado. Primero se reintenta renovando POR VÍA NATIVA y
        // repitiendo el POST nativo: en segundo plano es el único camino que sobrevive
        // al estrangulamiento del WebView. Solo si eso falla se cae a supabase-js.
        if (res.status === 401 || res.status === 403) {
          const fresh = await refreshSessionNative()
          if (fresh) {
            const retry = await CapacitorHttp.post({
              url: `${FUNCTIONS_URL}/${fnName}`,
              headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${fresh}`, 'apikey': ANON_KEY },
              data: body,
            })
            if (retry.status >= 200 && retry.status < 300) {
              return { ok: true, data: retry.data ?? null, error: null }
            }
            logDebug(fnName, 'native_retry_error', { status: retry.status })
            // 409 (sesión superada) es una respuesta de negocio, no un problema de token:
            // devolverla tal cual para que el caller la trate (no reintentar por WebView).
            if (retry.status === 409) return { ok: false, error: 'http_409', data: retry.data ?? null }
          }
          return invoke(fnName, body)
        }
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

export async function riderOnline({ latitud, longitud, accuracy } = {}) {
  const device_id = await getDeviceId()
  return callEdgeAuthed('rider-online', { latitud, longitud, accuracy, device_id })
}

export async function riderOffline() {
  const device_id = await getDeviceId()
  return callEdgeAuthed('rider-offline', { device_id })
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
export async function riderHeartbeat({ latitud, longitud } = {}) {
  const device_id = await getDeviceId()
  return invokeNative('rider-heartbeat', { latitud, longitud, device_id })
}

// v300: LLAVE DE PRESENCIA para el latido del servicio nativo (PresenceBeatService).
// 'emitir' la ROTA (cada online): el servicio del dispositivo anterior recibe 401 y se
// apaga solo. 'revocar' la borra (desconexión manual). La llave no caduca con la sesión:
// es lo que hace al latido nativo inmune a la rotación del JWT y al WebView congelado.
export async function riderPresenceToken(accion) {
  const device_id = await getDeviceId()
  return callEdgeAuthed('rider-presence-token', { accion, device_id })
}

// ────────────────────────────────────────────────────────────
// ASIGNACIONES
// ────────────────────────────────────────────────────────────

export async function riderAcceptOrder(asignacionId) {
  const device_id = await getDeviceId()
  return callEdgeAuthed('rider-accept-order', { asignacion_id: asignacionId, device_id })
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
export async function riderEstado(pedidoId, accion, extra = {}) {
  const device_id = await getDeviceId()
  return callEdgeAuthed('rider-estado', { pedido_id: pedidoId, accion, device_id, ...extra })
}
