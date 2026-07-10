import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'

// reassign-pedido-v2 — reasigna un pedido cuya asignacion expiro (llamada por el cron
// dispatcher-cada-minuto a los 150s, o por rider-reject-order al rechazar).
// v8 (10-jul-2026): la TERMINACION la decide ahora el dispatcher (create-shipday-order v51,
//   round-robin de 2 vueltas). Esta funcion solo: marca la asignacion expirada como 'timeout'
//   y vuelve a llamar al dispatcher, que decide si asigna al siguiente rider o, si ya se
//   agotaron las 2 vueltas, marca no_rider (con sus avisos a superadmin/restaurante/cliente).
//   Se quito el tope fijo de 3 intentos (MAX_INTENTOS) y el bloque de avisos duplicado.
// Auth: exige x-cron-secret o la service role key en Bearer. No re-despacha pedidos ya resueltos.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-api-version, x-cron-secret',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
}
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}
function adminClient() {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405)

  const cronSecret = req.headers.get('x-cron-secret') || ''
  const expected = Deno.env.get('CRON_SECRET') || ''
  const bearer = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
  const authorized = (!!expected && cronSecret === expected) || (!!serviceKey && bearer === serviceKey)
  if (!authorized) return jsonResponse({ error: 'no_autorizado' }, 401)

  let body: { pedido_id?: string } = {}
  try { body = await req.json() } catch (_) {}
  if (!body.pedido_id) return jsonResponse({ error: 'pedido_id_required' }, 400)
  const sb = adminClient()
  const { data: pedido } = await sb.from('pedidos')
    .select('id, codigo, estado, shipday_status')
    .eq('id', body.pedido_id).maybeSingle()
  if (!pedido) return jsonResponse({ error: 'pedido_not_found' }, 404)

  // No re-despachar un pedido ya resuelto/avanzado (evita carrera con la aceptacion).
  if (['entregado', 'cancelado', 'recogido', 'en_camino'].includes(pedido.estado)) {
    return jsonResponse({ ok: false, reason: 'estado_no_reasignable', estado: pedido.estado })
  }
  // Si la asignacion ya fue aceptada (o el pedido ya no espera rider), no hay nada que reasignar.
  if (pedido.shipday_status !== 'created') {
    return jsonResponse({ ok: false, reason: 'ya_resuelto', shipday_status: pedido.shipday_status })
  }

  // Marca la asignacion expirada como timeout (cuenta como una oferta gastada para el
  // round-robin) y deja paso a una nueva asignacion.
  await sb.from('pedido_asignaciones').update({ estado: 'timeout', resolved_at: new Date().toISOString() })
    .eq('pedido_id', pedido.id).eq('estado', 'esperando_aceptacion')

  // El dispatcher (via dispatch-order) elige el siguiente rider de la vuelta o, si ya se
  // agotaron las 2 vueltas, marca no_rider con sus avisos.
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const r = await fetch(`${supabaseUrl}/functions/v1/dispatch-order`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}` },
    body: JSON.stringify({ pedido_id: pedido.id }),
  })
  const txt = await r.text()
  return new Response(txt, { status: r.status, headers: { 'Content-Type': 'application/json' } })
})
