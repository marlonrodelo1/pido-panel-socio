// Cliente HTTP de las edge functions del rider.
// Todas requieren JWT del socio (verify_jwt=true) salvo dispatch-order que
// no lo invocamos desde el cliente.

import { supabase, FUNCTIONS_URL } from './supabase'

async function call(fn, body) {
  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token
  const r = await fetch(`${FUNCTIONS_URL}/${fn}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
    },
    body: JSON.stringify(body || {}),
  })
  let json = null
  try { json = await r.json() } catch (_) {}
  if (!r.ok) {
    const msg = json?.error || `HTTP ${r.status}`
    const err = new Error(msg)
    err.status = r.status
    err.detail = json
    throw err
  }
  return json
}

export const riderApi = {
  online:        ({ lat, lng }) => call('rider-online', { lat, lng }),
  offline:       () => call('rider-offline', {}),
  updateLocation: ({ lat, lng }) => call('rider-update-location', { lat, lng }),
  accept:        (asignacion_id) => call('rider-accept-order', { asignacion_id }),
  reject:        (asignacion_id, motivo) => call('rider-reject-order', { asignacion_id, motivo }),
  pickup:        (asignacion_id) => call('rider-pickup', { asignacion_id }),
  deliver:       (asignacion_id, foto_url) => call('rider-deliver', { asignacion_id, foto_url: foto_url || null }),
}
