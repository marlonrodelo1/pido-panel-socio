// Cliente HTTP de las edge functions del rider.
// Todas requieren JWT del socio (verify_jwt=true) salvo dispatch-order que
// no lo invocamos desde el cliente.

import { supabase, FUNCTIONS_URL } from './supabase'

async function dbgLog(event, details) {
  try {
    await supabase.from('push_debug_logs').insert({
      platform: 'rider-app',
      event: 'riderApi:' + event,
      details: details ? JSON.stringify(details).slice(0, 1500) : null,
    })
  } catch (_) {}
}

// Timeout por defecto de 12s para acciones del rider. iOS con red lenta puede
// dejar fetch colgado indefinidamente; con AbortController garantizamos
// feedback al usuario en tiempo razonable.
const DEFAULT_TIMEOUT_MS = 12000

async function call(fn, body, opts = {}) {
  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token
  if (!token) {
    dbgLog(fn + ':no_token', { hasSession: !!session })
    throw new Error('no_session')
  }
  const timeoutMs = opts.timeoutMs || DEFAULT_TIMEOUT_MS
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null
  const tid = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null
  try {
    const r = await fetch(`${FUNCTIONS_URL}/${fn}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
      },
      body: JSON.stringify(body || {}),
      signal: ctrl?.signal,
    })
    let json = null
    try { json = await r.json() } catch (_) {}
    if (!r.ok) {
      dbgLog(fn + ':http_error', { status: r.status, body: json })
      const err = new Error(json?.error || `HTTP ${r.status}`)
      err.status = r.status
      err.detail = json
      throw err
    }
    dbgLog(fn + ':ok', { ...body })
    return json
  } catch (e) {
    const aborted = e?.name === 'AbortError'
    if (aborted) {
      dbgLog(fn + ':timeout', { ms: timeoutMs })
      const err = new Error('timeout')
      err.code = 'timeout'
      throw err
    }
    if (!e?.status) dbgLog(fn + ':network_error', { msg: e?.message })
    throw e
  } finally {
    if (tid) clearTimeout(tid)
  }
}

export const riderApi = {
  online:        ({ lat, lng }) => call('rider-online', { lat, lng }),
  offline:       () => call('rider-offline', {}),
  updateLocation: ({ lat, lng }) => call('rider-update-location', { lat, lng }),
  accept:        (asignacion_id) => call('rider-accept-order', { asignacion_id }),
  reject:        (asignacion_id, motivo) => call('rider-reject-order', { asignacion_id, motivo }),
  pickup:        (asignacion_id) => call('rider-pickup', { asignacion_id }),
  deliver:       (asignacion_id, foto_url) => call('rider-deliver', { asignacion_id, foto_url: foto_url || null }),
  failDeliver:   (asignacion_id, motivo) => call('rider-fail-delivery', { asignacion_id, motivo }),
}
