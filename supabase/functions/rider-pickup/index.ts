// rider-pickup — el rider marca recogida. Body: { asignacion_id }

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { preflight, jsonResponse } from '../_shared/cors.ts'
import { adminClient, socioFromAuth } from '../_shared/auth.ts'

serve(async (req) => {
  const pre = preflight(req)
  if (pre) return pre
  if (req.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405)

  const auth = await socioFromAuth(req)
  if (!auth) return jsonResponse({ error: 'unauthorized' }, 401)

  let body: { asignacion_id?: string } = {}
  try { body = await req.json() } catch (_) {}
  if (!body.asignacion_id) return jsonResponse({ error: 'asignacion_id_required' }, 400)

  const sb = adminClient()
  const { data: asig } = await sb
    .from('pedido_asignaciones')
    .select('id, pedido_id, estado, rider_accounts!inner(socio_id)')
    .eq('id', body.asignacion_id)
    .maybeSingle()

  if (!asig) return jsonResponse({ error: 'asignacion_not_found' }, 404)
  if ((asig as any).rider_accounts?.socio_id !== auth.socioId) {
    return jsonResponse({ error: 'forbidden' }, 403)
  }
  if (asig.estado !== 'aceptado') {
    return jsonResponse({ error: 'estado_invalido', actual: asig.estado }, 409)
  }

  const now = new Date().toISOString()
  await sb.from('pedido_asignaciones').update({
    recogido_at: now,
  }).eq('id', asig.id)

  await sb.from('pedidos').update({
    estado: 'en_camino',
    recogido_at: now,
    shipday_status: 'picked_up',
  }).eq('id', asig.pedido_id)

  return jsonResponse({ ok: true })
})
