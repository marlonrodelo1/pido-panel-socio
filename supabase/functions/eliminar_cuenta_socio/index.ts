import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'npm:@supabase/supabase-js@2'
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!
const STRIPE_SECRET = Deno.env.get('STRIPE_SECRET_KEY') || ''
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Content-Type': 'application/json' }
function json(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: CORS }) }
async function cancelStripeSub(subId: string): Promise<{ ok: boolean; err?: string }> {
  if (!STRIPE_SECRET || !subId) return { ok: false, err: 'no_stripe_or_id' }
  try {
    const r = await fetch(`https://api.stripe.com/v1/subscriptions/${subId}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${STRIPE_SECRET}` } })
    if (!r.ok) { const t = await r.text(); return { ok: false, err: `stripe ${r.status}: ${t.slice(0, 200)}` } }
    return { ok: true }
  } catch (e) { return { ok: false, err: String((e as Error).message || e) } }
}
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
    let body: { socio_id?: string } = {}
    try { body = await req.json() } catch (_) {}
    const { data: meRow } = await admin.from('usuarios').select('rol').eq('id', userId).maybeSingle()
    const isSuperadmin = meRow?.rol === 'superadmin' || meRow?.rol === 'admin'
    let socioRow: any = null
    if (body.socio_id) {
      const { data } = await admin.from('socios').select('id, user_id, stripe_subscription_multirider_id').eq('id', body.socio_id).maybeSingle()
      if (!data) return json({ error: 'socio_no_encontrado' }, 404)
      if (data.user_id !== userId && !isSuperadmin) return json({ error: 'forbidden' }, 403)
      socioRow = data
    } else {
      const { data } = await admin.from('socios').select('id, user_id, stripe_subscription_multirider_id').eq('user_id', userId).maybeSingle()
      socioRow = data
    }
    const targetUserId = socioRow?.user_id || userId
    const errors: string[] = []
    if (socioRow?.stripe_subscription_multirider_id) { const r = await cancelStripeSub(socioRow.stripe_subscription_multirider_id); if (!r.ok) errors.push(`stripe_multirider: ${r.err}`) }
    try {
      const { data: subs } = await admin.from('socio_subscripciones_marketplace').select('stripe_subscription_id, estado').eq('socio_id', socioRow?.id || '').eq('estado', 'activa')
      for (const s of (subs || []) as any[]) { if (s.stripe_subscription_id) { const r = await cancelStripeSub(s.stripe_subscription_id); if (!r.ok) errors.push(`stripe_marketplace: ${r.err}`) } }
    } catch (_) {}
    if (socioRow?.id) { const { error: raErr } = await admin.from('rider_accounts').update({ activa: false, estado: 'eliminada' }).eq('socio_id', socioRow.id); if (raErr) errors.push(`rider_accounts: ${raErr.message}`) }
    if (socioRow?.id) { const { error: socErr } = await admin.from('socios').update({ nombre: 'Cuenta eliminada', nombre_comercial: 'Cuenta eliminada', email: null, telefono: null, logo_url: null, banner_url: null, descripcion: null, redes: null, shipday_api_key: null, razon_social: null, nif: null, direccion_fiscal: null, codigo_postal: null, ciudad: null, provincia: null, pais: null, iban: null, activo: false, marketplace_activo: false, en_servicio: false, facturacion_multirider_activa: false, stripe_subscription_multirider_id: null, multirider_estado: 'cancelada' }).eq('id', socioRow.id); if (socErr) errors.push(`socios: ${socErr.message}`) }
    const { error: usrErr } = await admin.from('usuarios').update({ eliminado_at: new Date().toISOString() }).eq('id', targetUserId)
    if (usrErr) errors.push(`usuarios: ${usrErr.message}`)
    const { error: pushErr } = await admin.from('push_subscriptions').delete().eq('user_id', targetUserId)
    if (pushErr) errors.push(`push_subscriptions: ${pushErr.message}`)
    const { error: authErr } = await admin.auth.admin.deleteUser(targetUserId)
    if (authErr) return json({ error: `auth_delete_failed: ${authErr.message}`, partial: errors }, 500)
    return json({ ok: true, warnings: errors.length ? errors : undefined })
  } catch (e) { console.error('[eliminar_cuenta_socio] fatal:', e); return json({ error: String((e as Error).message || e) }, 500) }
})
