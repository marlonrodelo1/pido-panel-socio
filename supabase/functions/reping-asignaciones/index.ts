// reping-asignaciones — reenvia push a riders con asignaciones pendientes
// de aceptar. Se ejecuta dos veces dentro de la misma invocacion (0s y +30s)
// para cubrir el minuto entero, ya que pg_cron solo admite resolucion 1 min.
//
// Solo asignaciones con estado='esperando_aceptacion' creadas hace mas de 10s
// y menos de 180s (timeout total). Despues de eso reassign-pedido-v2 las pasa
// al siguiente rider.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

async function repingPass() {
  const sb = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } })
  const ahora = new Date()
  const desde = new Date(ahora.getTime() - 180_000).toISOString()
  const hasta = new Date(ahora.getTime() - 10_000).toISOString()

  const { data: asigs } = await sb
    .from('pedido_asignaciones')
    .select('id, pedido_id, distancia_metros, rider_account_id, rider_accounts!inner(socio_id, socios!inner(user_id, nombre)), pedidos!inner(codigo, establecimientos!inner(nombre))')
    .eq('estado', 'esperando_aceptacion')
    .gte('created_at', desde)
    .lte('created_at', hasta)

  if (!asigs?.length) return 0

  let count = 0
  for (const a of asigs as any[]) {
    const userId = a.rider_accounts?.socios?.user_id
    if (!userId) continue
    try {
      await fetch(`${SUPABASE_URL}/functions/v1/enviar_push`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SERVICE_ROLE}` },
        body: JSON.stringify({
          user_ids: [userId],
          title: `Pedido pendiente · ${a.pedidos?.establecimientos?.nombre || ''}`,
          body: `#${a.pedidos?.codigo} · ${(a.distancia_metros / 1000).toFixed(1)} km — acepta o se reasignará`,
          data: { tipo: 'reping_asignacion', pedido_id: a.pedido_id, asignacion_id: a.id, urgente: true },
        }),
      })
      count += 1
    } catch (_) {}
  }
  return count
}

serve(async () => {
  const first = await repingPass()
  // Segundo pase a los 30s para cubrir el minuto entero
  const second = await new Promise<number>((resolve) => {
    setTimeout(() => repingPass().then(resolve).catch(() => resolve(0)), 30_000)
  })
  return new Response(JSON.stringify({ ok: true, first, second }), {
    headers: { 'Content-Type': 'application/json' },
  })
})
