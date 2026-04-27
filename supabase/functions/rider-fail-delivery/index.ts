// rider-fail-delivery — el rider marca una entrega como fallida tras haber
// recogido el pedido (cliente no aparece, direccion erronea, paquete danado…).
// A diferencia de rider-reject-order, no dispara reasignacion: el pedido
// queda cerrado como fallido y el admin decide reembolso.
// Body: { asignacion_id, motivo (obligatorio) }

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { preflight, jsonResponse } from '../_shared/cors.ts'
import { adminClient, socioFromAuth } from '../_shared/auth.ts'

serve(async (req) => {
  const pre = preflight(req)
  if (pre) return pre
  if (req.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405)

  const auth = await socioFromAuth(req)
  if (!auth) return jsonResponse({ error: 'unauthorized' }, 401)

  let body: { asignacion_id?: string; motivo?: string } = {}
  try { body = await req.json() } catch (_) {}
  if (!body.asignacion_id) return jsonResponse({ error: 'asignacion_id_required' }, 400)
  const motivo = (body.motivo || '').trim()
  if (!motivo) return jsonResponse({ error: 'motivo_required' }, 400)

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
    estado: 'fallido',
    motivo_rechazo: motivo,
    resolved_at: now,
  }).eq('id', asig.id)

  await sb.from('pedidos').update({
    estado: 'fallido',
    fallido_at: now,
    motivo_fallo: motivo,
  }).eq('id', asig.pedido_id)

  return jsonResponse({ ok: true })
})
