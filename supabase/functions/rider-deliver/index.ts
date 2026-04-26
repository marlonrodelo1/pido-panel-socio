// rider-deliver — el rider marca entregado. Foto opcional ya subida al
// bucket rider-deliveries por el cliente; aqui solo guardamos la URL.
// Body: { asignacion_id, foto_url? }

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { preflight, jsonResponse } from '../_shared/cors.ts'
import { adminClient, socioFromAuth } from '../_shared/auth.ts'

serve(async (req) => {
  const pre = preflight(req)
  if (pre) return pre
  if (req.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405)

  const auth = await socioFromAuth(req)
  if (!auth) return jsonResponse({ error: 'unauthorized' }, 401)

  let body: { asignacion_id?: string; foto_url?: string } = {}
  try { body = await req.json() } catch (_) {}
  if (!body.asignacion_id) return jsonResponse({ error: 'asignacion_id_required' }, 400)

  const sb = adminClient()
  const { data: asig } = await sb
    .from('pedido_asignaciones')
    .select('id, pedido_id, estado, recogido_at, rider_accounts!inner(socio_id)')
    .eq('id', body.asignacion_id)
    .maybeSingle()

  if (!asig) return jsonResponse({ error: 'asignacion_not_found' }, 404)
  if ((asig as any).rider_accounts?.socio_id !== auth.socioId) {
    return jsonResponse({ error: 'forbidden' }, 403)
  }
  if (!asig.recogido_at) {
    return jsonResponse({ error: 'no_recogido_aun' }, 409)
  }

  const now = new Date().toISOString()
  await sb.from('pedido_asignaciones').update({
    estado: 'aceptado', // mantenemos 'aceptado' (asig terminada por entrega)
    entregado_at: now,
    foto_entrega_url: body.foto_url || null,
    resolved_at: now,
  }).eq('id', asig.id)

  await sb.from('pedidos').update({
    estado: 'entregado',
    entregado_at: now,
    shipday_status: 'delivered',
  }).eq('id', asig.pedido_id)

  return jsonResponse({ ok: true })
})
