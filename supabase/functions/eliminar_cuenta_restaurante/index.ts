import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'npm:@supabase/supabase-js@2'
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Content-Type': 'application/json' }
function json(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: CORS }) }
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)
  try {
    const authHeader = req.headers.get('Authorization') || ''
    const token = authHeader.replace(/^Bearer\s+/i, '').trim()
    if (!token || token === ANON) return json({ error: 'auth_required' }, 401)
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false, autoRefreshToken: false } })
    const { data: userData, error: userErr } = await admin.auth.getUser(token)
    if (userErr || !userData?.user) return json({ error: 'invalid_token' }, 401)
    const userId = userData.user.id
    let body: { establecimiento_id?: string } = {}
    try { body = await req.json() } catch (_) {}
    const { data: meRow } = await admin.from('usuarios').select('rol').eq('id', userId).maybeSingle()
    const isSuperadmin = meRow?.rol === 'superadmin' || meRow?.rol === 'admin'
    let estabId = body.establecimiento_id || null
    let dueñoUserId = userId
    if (estabId) {
      const { data: est } = await admin.from('establecimientos').select('id, user_id').eq('id', estabId).maybeSingle()
      if (!est) return json({ error: 'establecimiento_no_encontrado' }, 404)
      if (est.user_id !== userId && !isSuperadmin) return json({ error: 'forbidden' }, 403)
      dueñoUserId = est.user_id
    } else {
      const { data: est } = await admin.from('establecimientos').select('id, user_id').eq('user_id', userId).maybeSingle()
      if (est) estabId = est.id
    }
    const errors: string[] = []
    if (estabId) {
      const { error: estErr } = await admin.from('establecimientos').update({ nombre: 'Cuenta eliminada', email: null, telefono: null, direccion: null, razon_social: null, nif: null, direccion_fiscal: null, codigo_postal: null, ciudad_fiscal: null, provincia_fiscal: null, shipday_api_key: null, activo: false, estado: 'eliminado' }).eq('id', estabId)
      if (estErr) errors.push(`establecimientos: ${estErr.message}`)
    }
    const { error: usrErr } = await admin.from('usuarios').update({ eliminado_at: new Date().toISOString() }).eq('id', dueñoUserId)
    if (usrErr) errors.push(`usuarios: ${usrErr.message}`)
    const { error: pushErr } = await admin.from('push_subscriptions').delete().eq('user_id', dueñoUserId)
    if (pushErr) errors.push(`push_subscriptions: ${pushErr.message}`)
    const { error: authErr } = await admin.auth.admin.deleteUser(dueñoUserId)
    if (authErr) return json({ error: `auth_delete_failed: ${authErr.message}`, partial: errors }, 500)
    return json({ ok: true, warnings: errors.length ? errors : undefined })
  } catch (e) { console.error('[eliminar_cuenta_restaurante] fatal:', e); return json({ error: String((e as Error).message || e) }, 500) }
})
