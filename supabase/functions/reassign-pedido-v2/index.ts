// reassign-pedido-v2 — sustituye a reassign-pedido cuando el restaurante
// usa dispatcher propio. Lo dispara:
//  - rider-reject-order (rechazo manual)
//  - cron reassign-timeout-pedidos-v2 (timeout 45s)
//
// Body: { pedido_id }

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { preflight, jsonResponse } from '../_shared/cors.ts'
import { adminClient } from '../_shared/auth.ts'

const MAX_INTENTOS = 3

serve(async (req) => {
  const pre = preflight(req)
  if (pre) return pre
  if (req.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405)

  let body: { pedido_id?: string } = {}
  try { body = await req.json() } catch (_) {}
  if (!body.pedido_id) return jsonResponse({ error: 'pedido_id_required' }, 400)

  const sb = adminClient()
  const { data: pedido } = await sb
    .from('pedidos')
    .select('id, intento_asignacion, establecimiento_id, estado')
    .eq('id', body.pedido_id)
    .maybeSingle()

  if (!pedido) return jsonResponse({ error: 'pedido_not_found' }, 404)

  if ((pedido.intento_asignacion || 0) >= MAX_INTENTOS) {
    await sb.from('pedidos').update({ shipday_status: 'no_rider' }).eq('id', pedido.id)
    // Notifica al super-admin
    try {
      const supabaseUrl = Deno.env.get('SUPABASE_URL')!
      await fetch(`${supabaseUrl}/functions/v1/enviar_push`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
        },
        body: JSON.stringify({
          user_type: 'superadmin',
          title: 'Pedido sin rider',
          body: `${pedido.id} agoto los ${MAX_INTENTOS} intentos`,
          data: { tipo: 'no_rider', pedido_id: pedido.id },
        }),
      })
    } catch (_) {}
    return jsonResponse({ ok: false, reason: 'max_intentos' })
  }

  // Marca asignaciones previas en esperando_aceptacion como timeout
  await sb.from('pedido_asignaciones').update({
    estado: 'timeout',
    resolved_at: new Date().toISOString(),
  })
    .eq('pedido_id', pedido.id)
    .eq('estado', 'esperando_aceptacion')

  // Reinvoca dispatch-order
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const r = await fetch(`${supabaseUrl}/functions/v1/dispatch-order`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
    },
    body: JSON.stringify({ pedido_id: pedido.id }),
  })
  const txt = await r.text()
  return new Response(txt, { status: r.status, headers: { 'Content-Type': 'application/json' } })
})
