// rider-reject-order — el rider rechaza una asignacion. Dispara reasignacion
// inmediata via reassign-pedido-v2.
// Body: { asignacion_id, motivo? }

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
  if (asig.estado !== 'esperando_aceptacion') {
    return jsonResponse({ error: 'estado_invalido', actual: asig.estado }, 409)
  }

  await sb.from('pedido_asignaciones').update({
    estado: 'rechazado',
    motivo_rechazo: body.motivo || null,
    resolved_at: new Date().toISOString(),
  }).eq('id', asig.id)

  // Dispara reasignacion inmediata
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  fetch(`${supabaseUrl}/functions/v1/reassign-pedido-v2`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
    },
    body: JSON.stringify({ pedido_id: asig.pedido_id }),
  }).catch((e) => console.error('[rider-reject] reassign trigger fail', e))

  return jsonResponse({ ok: true })
})
