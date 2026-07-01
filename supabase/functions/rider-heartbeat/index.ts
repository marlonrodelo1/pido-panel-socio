// rider-heartbeat v1 — latido de presencia del socio (independiente del GPS).
//
// La app del socio llama a esta edge cada ~60s mientras está EN SERVICIO, aunque
// el repartidor no se mueva (el watcher GPS solo reporta al moverse 30m, así que
// un socio parado no refrescaría su señal). Estampa socios.last_location_at = now()
// para que el cron `auto-offline-socios-inactivos` NO lo apague mientras la app
// siga viva. Si la app se cierra / pierde conexión / se queda sin batería, los
// latidos cesan y el cron lo marca offline pasados los minutos de gracia.
//
// lat/lng son OPCIONALES: si llegan, refrescamos también la posición; si no,
// solo el latido. Esto permite mantener vivo a un socio online sin permiso GPS.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-api-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
function preflight(req: Request) { if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS }); return null }
function jsonResponse(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } }) }
function adminClient() { return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } }) }

async function socioFromAuth(req: Request) {
  const auth = req.headers.get('Authorization') || ''
  const token = auth.replace(/^Bearer\s+/i, '')
  if (!token) return null
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } })
  const { data: userRes, error: userErr } = await sb.auth.getUser()
  if (userErr || !userRes?.user) return null
  const admin = adminClient()
  const { data: socio } = await admin.from('socios').select('id').eq('user_id', userRes.user.id).maybeSingle()
  if (!socio) return null
  return { socioId: socio.id }
}

serve(async (req) => {
  const pre = preflight(req); if (pre) return pre
  if (req.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405)
  const auth = await socioFromAuth(req)
  if (!auth) return jsonResponse({ error: 'unauthorized' }, 401)

  let body: { lat?: number; lng?: number; latitud?: number; longitud?: number } = {}
  try { body = await req.json() } catch (_) {}

  const update: Record<string, unknown> = { last_location_at: new Date().toISOString() }
  const lat = typeof body.lat === 'number' ? body.lat : body.latitud
  const lng = typeof body.lng === 'number' ? body.lng : body.longitud
  if (typeof lat === 'number' && typeof lng === 'number') {
    update.latitud_actual = lat
    update.longitud_actual = lng
  }

  // Solo refrescamos el latido si el socio está realmente en servicio. Si está
  // offline, un latido tardío no debe "resucitarlo".
  const sb = adminClient()
  const { data, error } = await sb.from('socios').update(update).eq('id', auth.socioId).eq('en_servicio', true).select('id').maybeSingle()
  if (error) return jsonResponse({ error: error.message }, 500)
  return jsonResponse({ ok: true, alive: !!data })
})
