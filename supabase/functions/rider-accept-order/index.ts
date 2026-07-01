// rider-accept-order v8 — el socio acepta la asignacion.
// v8 (rendimiento): el push al cliente ya NO bloquea la respuesta (EdgeRuntime.waitUntil,
//     fire-and-forget) + los 2 updates en paralelo. La respuesta al socio vuelve en cuanto
//     se guarda el estado; antes esperaba ~1-2s al envio del push -> 'Aceptar' tardaba 3-4s.
// v6: ya NO salta pedido.estado a 'recogido'. El estado del pedido lo controla el
//     restaurante (preparando/listo); aceptar solo marca la asignacion 'aceptado' +
//     shipday_status='accepted' (saca el pedido del reassign cron).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
const URL = Deno.env.get('SUPABASE_URL')!, SVC = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, ANON = Deno.env.get('SUPABASE_ANON_KEY')!
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } })
const admin = () => createClient(URL, SVC, { auth: { persistSession: false } })
function background(p: Promise<unknown>) { try { (globalThis as any).EdgeRuntime?.waitUntil?.(p) } catch (_) {} }
async function socioFromAuth(req: Request) {
  const t = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
  if (!t) return null
  const sb = createClient(URL, ANON, { global: { headers: { Authorization: `Bearer ${t}` } }, auth: { persistSession: false } })
  const { data } = await sb.auth.getUser()
  if (!data?.user) return null
  const { data: s } = await admin().from('socios').select('id').eq('user_id', data.user.id).maybeSingle()
  return s ? { socioId: s.id, userId: data.user.id } : null
}
async function pushCliente(usuario_id: string | null, title: string, body: string, data: unknown) {
  if (!usuario_id) return
  try { await fetch(`${URL}/functions/v1/enviar_push`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SVC}` }, body: JSON.stringify({ target_type: 'cliente', target_id: usuario_id, title, body, data }) }) } catch (_) {}
}
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)
  const auth = await socioFromAuth(req)
  if (!auth) return json({ error: 'unauthorized' }, 401)
  let b: { asignacion_id?: string } = {}
  try { b = await req.json() } catch (_) {}
  if (!b.asignacion_id) return json({ error: 'asignacion_id_required' }, 400)
  const sb = admin()
  const { data: asig } = await sb.from('pedido_asignaciones')
    .select('id, pedido_id, socio_id, estado, rider_accounts!inner(socios!inner(nombre))')
    .eq('id', b.asignacion_id).maybeSingle()
  if (!asig) return json({ error: 'asignacion_not_found' }, 404)
  if ((asig as any).socio_id !== auth.socioId) return json({ error: 'forbidden' }, 403)
  if (asig.estado !== 'esperando_aceptacion') return json({ error: 'estado_invalido', actual: asig.estado }, 409)
  const now = new Date().toISOString()
  // UPDATE atomico condicional: solo pasa a 'aceptado' si sigue 'esperando_aceptacion'.
  // Evita la carrera TOCTOU (dos riders aceptando la misma asignacion entre read y write).
  const { data: aceptadas } = await sb.from('pedido_asignaciones')
    .update({ estado: 'aceptado', aceptado_at: now })
    .eq('id', asig.id).eq('estado', 'esperando_aceptacion').select('id')
  if (!aceptadas || aceptadas.length === 0) return json({ error: 'estado_invalido', actual: asig.estado }, 409)
  await sb.from('pedidos').update({ shipday_status: 'accepted' }).eq('id', asig.pedido_id)
  // Aviso al cliente en segundo plano: NO bloquea la respuesta al socio.
  const rider = (asig as any).rider_accounts?.socios?.nombre || 'Tu repartidor'
  background((async () => {
    const { data: ped } = await sb.from('pedidos').select('codigo, usuario_id').eq('id', asig.pedido_id).maybeSingle()
    await pushCliente(ped?.usuario_id ?? null, `${rider} aceptó tu pedido`, `Pedido #${ped?.codigo} · pulsa para ver el seguimiento`, { tipo: 'rider_aceptado', pedido_id: asig.pedido_id, codigo: ped?.codigo })
  })())
  return json({ ok: true })
})
