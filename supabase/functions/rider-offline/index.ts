// rider-offline v5 — el socio se pone FUERA DE SERVICIO (offline).
// CAMBIO v5: ya NO toca marketplace_activo. Solo en_servicio=false → trigger
// recalcula tiene_delivery (sus restaurantes quedan SOLO recogida). La tienda
// del socio sigue visible (marketplace_activo no cambia).
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-api-version', 'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS' }
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
  const userId = userRes.user.id
  const admin = adminClient()
  const { data: socio } = await admin.from('socios').select('id').eq('user_id', userId).maybeSingle()
  if (!socio) return null
  return { socioId: socio.id, userId }
}

serve(async (req) => {
  const pre = preflight(req); if (pre) return pre
  if (req.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405)
  const auth = await socioFromAuth(req)
  if (!auth) return jsonResponse({ error: 'unauthorized' }, 401)
  const sb = adminClient()
  const { error } = await sb.from('socios').update({ en_servicio: false }).eq('id', auth.socioId)
  if (error) return jsonResponse({ error: error.message }, 500)
  return jsonResponse({ ok: true })
})
