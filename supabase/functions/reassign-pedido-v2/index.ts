import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'

// reassign-pedido-v2 — reasigna un pedido cuya asignacion expiro (llamada por el
// cron reassign-timeout-pedidos-v2). Endurecida: exige x-cron-secret o la service
// role key, y no re-despacha pedidos ya resueltos. Helpers _shared inlineados para
// un despliegue autonomo de un solo fichero.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const MAX_INTENTOS = 3

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

  // Autorizacion: invocada server-side (cron / proxy). Se acepta el cron-secret o
  // la service role key en el Authorization. Sin uno de los dos => 401.
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
    .select('id, intento_asignacion, establecimiento_id, estado')
    .eq('id', body.pedido_id).maybeSingle()
  if (!pedido) return jsonResponse({ error: 'pedido_not_found' }, 404)

  // No re-despachar un pedido ya resuelto/avanzado (evita carrera con la aceptacion).
  if (['entregado', 'cancelado', 'recogido', 'en_camino'].includes(pedido.estado)) {
    return jsonResponse({ ok: false, reason: 'estado_no_reasignable', estado: pedido.estado })
  }

  if ((pedido.intento_asignacion || 0) >= MAX_INTENTOS) {
    await sb.from('pedidos').update({ shipday_status: 'no_rider' }).eq('id', pedido.id)
    try {
      const supabaseUrl = Deno.env.get('SUPABASE_URL')!
      await fetch(`${supabaseUrl}/functions/v1/enviar_push`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}` },
        body: JSON.stringify({ user_type: 'superadmin', title: 'Pedido sin rider', body: `${pedido.id} agoto los ${MAX_INTENTOS} intentos`, data: { tipo: 'no_rider', pedido_id: pedido.id } }),
      })
    } catch (_) {}
    return jsonResponse({ ok: false, reason: 'max_intentos' })
  }
  await sb.from('pedido_asignaciones').update({ estado: 'timeout', resolved_at: new Date().toISOString() })
    .eq('pedido_id', pedido.id).eq('estado', 'esperando_aceptacion')
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const r = await fetch(`${supabaseUrl}/functions/v1/dispatch-order`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}` },
    body: JSON.stringify({ pedido_id: pedido.id }),
  })
  const txt = await r.text()
  return new Response(txt, { status: r.status, headers: { 'Content-Type': 'application/json' } })
})
