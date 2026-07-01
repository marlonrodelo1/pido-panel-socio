// rider-estado v4 — transiciones de estado del reparto por el socio.
// v4 (rendimiento): el push al cliente ya NO bloquea la respuesta (EdgeRuntime.waitUntil) +
//     updates en paralelo + la lectura del pedido (solo para el push) se hace en 2º plano.
//     Antes cada cambio de estado esperaba ~1-2s al envio del push.
// Body: { pedido_id, accion: 'recogido'|'en_camino'|'entregado'|'fallido', motivo?, foto_url? }
// NOTA: pedido_asignaciones.estado tiene CHECK (esperando_aceptacion|aceptado|timeout|
//   rechazado|cancelado_manual|sin_riders|fallido). La ENTREGA OK se marca con entregado_at
//   + resolved_at (estado queda 'aceptado'). El progreso visible vive en pedidos.estado.
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
  let b: { pedido_id?: string; accion?: string; motivo?: string; foto_url?: string } = {}
  try { b = await req.json() } catch (_) {}
  const { pedido_id, accion, motivo, foto_url } = b
  if (!pedido_id || !accion) return json({ error: 'pedido_id_y_accion_requeridos' }, 400)
  const sb = admin()
  const { data: asig } = await sb.from('pedido_asignaciones')
    .select('id, pedido_id, estado, recogido_at, socio_id')
    .eq('pedido_id', pedido_id).eq('socio_id', auth.socioId)
    .order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (!asig) return json({ error: 'asignacion_not_found' }, 404)
  const now = new Date().toISOString()
  // Aviso al cliente (lee el pedido solo para codigo/usuario_id) en 2º plano.
  const notify = (kind: string) => (async () => {
    const { data: ped } = await sb.from('pedidos').select('codigo, usuario_id').eq('id', pedido_id).maybeSingle()
    if (!ped?.usuario_id) return
    if (kind === 'en_camino') await pushCliente(ped.usuario_id, 'Tu pedido va de camino', `#${ped.codigo} está en ruta hacia ti`, { tipo: 'rider_en_camino', pedido_id, codigo: ped.codigo })
    else if (kind === 'entregado') await pushCliente(ped.usuario_id, 'Pedido entregado', `Tu pedido #${ped.codigo} ha sido entregado. ¡Buen provecho!`, { tipo: 'pedido_entregado', pedido_id, codigo: ped.codigo })
    else if (kind === 'fallido') await pushCliente(ped.usuario_id, 'Problema con tu pedido', `No se pudo entregar tu pedido #${ped.codigo}. El soporte de Pidoo te contactará.`, { tipo: 'pedido_fallido', pedido_id, codigo: ped.codigo })
  })()

  if (accion === 'recogido') {
    await Promise.all([
      sb.from('pedido_asignaciones').update({ recogido_at: now }).eq('id', asig.id),
      sb.from('pedidos').update({ estado: 'recogido', recogido_at: now, shipday_status: 'picked_up' }).eq('id', pedido_id),
    ])
  } else if (accion === 'en_camino') {
    await sb.from('pedidos').update({ estado: 'en_camino', shipday_status: 'on_the_way' }).eq('id', pedido_id)
    background(notify('en_camino'))
  } else if (accion === 'entregado') {
    await Promise.all([
      sb.from('pedido_asignaciones').update({ entregado_at: now, resolved_at: now, foto_entrega_url: foto_url || null }).eq('id', asig.id),
      sb.from('pedidos').update({ estado: 'entregado', entregado_at: now, shipday_status: 'delivered' }).eq('id', pedido_id),
    ])
    background(notify('entregado'))
  } else if (accion === 'fallido') {
    await Promise.all([
      sb.from('pedido_asignaciones').update({ estado: 'fallido', resolved_at: now, motivo_rechazo: motivo || null }).eq('id', asig.id),
      sb.from('pedidos').update({ estado: 'fallido', shipday_status: 'fallido' }).eq('id', pedido_id),
    ])
    background(notify('fallido'))
  } else {
    return json({ error: 'accion_invalida' }, 400)
  }
  return json({ ok: true, accion })
})
