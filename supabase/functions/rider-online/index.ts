// rider-online — pone al socio en servicio + actualiza GPS inicial.
// Body: { lat, lng }

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { preflight, jsonResponse } from '../_shared/cors.ts'
import { adminClient, socioFromAuth } from '../_shared/auth.ts'

serve(async (req) => {
  const pre = preflight(req)
  if (pre) return pre
  if (req.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405)

  const auth = await socioFromAuth(req)
  if (!auth) return jsonResponse({ error: 'unauthorized' }, 401)

  let body: { lat?: number; lng?: number } = {}
  try { body = await req.json() } catch (_) {}

  const sb = adminClient()
  // SIEMPRE actualizar last_location_at = now() al ponerse online. Si llega
  // lat/lng se actualiza tambien la posicion. Si no llega (permiso GPS lento
  // o emulador sin location), igual lo marcamos vivo para que dispatch-order
  // no lo excluya en los siguientes minutos.
  const update: Record<string, unknown> = {
    en_servicio: true,
    last_location_at: new Date().toISOString(),
  }
  if (typeof body.lat === 'number' && typeof body.lng === 'number') {
    update.latitud_actual = body.lat
    update.longitud_actual = body.lng
  }

  const { error } = await sb.from('socios').update(update).eq('id', auth.socioId)
  if (error) return jsonResponse({ error: error.message }, 500)
  return jsonResponse({ ok: true })
})
