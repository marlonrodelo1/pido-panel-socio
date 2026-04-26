// rider-update-location — la app llama cada 15s con pedido / 60s en idle.
// Body: { lat, lng, heading?, speed?, accuracy?, battery? }

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { preflight, jsonResponse } from '../_shared/cors.ts'
import { adminClient, socioFromAuth } from '../_shared/auth.ts'

serve(async (req) => {
  const pre = preflight(req)
  if (pre) return pre
  if (req.method !== 'POST' && req.method !== 'PATCH') return jsonResponse({ error: 'method_not_allowed' }, 405)

  const auth = await socioFromAuth(req)
  if (!auth) return jsonResponse({ error: 'unauthorized' }, 401)

  let body: { lat?: number; lng?: number } = {}
  try { body = await req.json() } catch (_) {}
  if (typeof body.lat !== 'number' || typeof body.lng !== 'number') {
    return jsonResponse({ error: 'lat_lng_required' }, 400)
  }

  const sb = adminClient()
  const { error } = await sb.from('socios').update({
    latitud_actual: body.lat,
    longitud_actual: body.lng,
    last_location_at: new Date().toISOString(),
  }).eq('id', auth.socioId)

  if (error) return jsonResponse({ error: error.message }, 500)
  return jsonResponse({ ok: true })
})
