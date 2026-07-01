import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { preflight, jsonResponse } from '../_shared/cors.ts'
import { adminClient, socioFromAuth } from '../_shared/auth.ts'

serve(async (req) => {
  const pre = preflight(req); if (pre) return pre
  if (req.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405)
  const auth = await socioFromAuth(req)
  if (!auth) return jsonResponse({ error: 'unauthorized' }, 401)
  let body: { asignacion_id?: string } = {}
  try { body = await req.json() } catch (_) {}
  if (!body.asignacion_id) return jsonResponse({ error: 'asignacion_id_required' }, 400)
  const sb = adminClient()
  const { data: asig } = await sb.from('pedido_asignaciones')
    .select('id, pedido_id, estado, rider_accounts!inner(socio_id, socios!inner(nombre))')
    .eq('id', body.asignacion_id).maybeSingle()
  if (!asig) return jsonResponse({ error: 'asignacion_not_found' }, 404)
  if ((asig as any).rider_accounts?.socio_id !== auth.socioId) return jsonResponse({ error: 'forbidden' }, 403)
  if (asig.estado !== 'aceptado') return jsonResponse({ error: 'estado_invalido', actual: asig.estado }, 409)
  const now = new Date().toISOString()
  await sb.from('pedido_asignaciones').update({ recogido_at: now }).eq('id', asig.id)
  await sb.from('pedidos').update({ estado: 'en_camino', recogido_at: now, shipday_status: 'picked_up' }).eq('id', asig.pedido_id)

  // Push al cliente: "el repartidor recogio tu pedido y va de camino"
  try {
    const { data: ped } = await sb.from('pedidos').select('codigo, usuario_id').eq('id', asig.pedido_id).maybeSingle()
    const rider = (asig as any).rider_accounts?.socios?.nombre || 'Tu repartidor'
    if (ped?.usuario_id) {
      const supabaseUrl = Deno.env.get('SUPABASE_URL')!
      await fetch(`${supabaseUrl}/functions/v1/enviar_push`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}` },
        body: JSON.stringify({
          target_type: 'cliente', target_id: ped.usuario_id,
          title: `${rider} va de camino`,
          body: `Tu pedido #${ped.codigo} esta en ruta hacia ti`,
          data: { tipo: 'rider_recogido', pedido_id: asig.pedido_id, codigo: ped.codigo },
        }),
      })
    }
  } catch (e) { console.error('[rider-pickup] push fail', e) }

  return jsonResponse({ ok: true })
})
