// reping-asignaciones — reenvia push a riders con asignaciones pendientes
// de aceptar. Varios pases por invocacion para cubrir el minuto entero, ya que
// pg_cron solo admite resolucion 1 min.
//
// Solo asignaciones con estado='esperando_aceptacion' creadas hace mas de 10s
// y menos de 180s (timeout total). Despues de eso reassign-pedido-v2 las pasa
// al siguiente rider.
//
// v5 (2 jul 2026): limite de 100 filas en la query de asignaciones (antes sin limite).
// v6 (4 jul 2026, auditoria): el segundo pase (+30s) se ejecuta en 2º plano con
// EdgeRuntime.waitUntil. Antes el handler esperaba los 30s dentro de la respuesta:
// cada invocacion tardaba ~31s, el pg_net del cron la cortaba a los 5s (timeout
// espurio cada minuto en net._http_response) y un worker quedaba bloqueado medio
// minuto de cada minuto.
// v7 (14 ago 2026, peticion de Marlon: "que suene repetido"): la cadencia deja de
// estar a fuego. Se lee de configuracion_plataforma.reping_asignacion_seg (20s por
// defecto, antes 30) y se dan TODOS los pases que quepan en el minuto — con 20s
// son 3 (0/20/40) y el socio recibe un aviso cada 20s durante los 150s que vive la
// oferta. En iPhone esto es lo mas parecido a una alarma en bucle que permite APNs:
// no se puede repetir un sonido desde una app dormida, asi que la repeticion la
// pone el servidor. En Android el bucle real lo hace PedidoAlarmService (150s).
//   Ademas se manda user_type:'socio'. Sin eso, enviar_push no filtra por tipo y en
// un usuario que ademas sea cliente (el caso de Marlon) el aviso podia salir por el
// token equivocado.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const INTERVALO_DEFECTO_SEG = 20
const MIN_SEG = 10   // por debajo de esto son avisos encima de avisos
const MAX_SEG = 60
const VENTANA_MS = 60_000  // el cron vuelve a llamar dentro de un minuto

async function leerIntervaloSeg(sb: any): Promise<number> {
  try {
    const { data } = await sb.from('configuracion_plataforma')
      .select('valor').eq('clave', 'reping_asignacion_seg').maybeSingle()
    const n = Number(data?.valor)
    if (!Number.isFinite(n)) return INTERVALO_DEFECTO_SEG
    return Math.min(MAX_SEG, Math.max(MIN_SEG, Math.round(n)))
  } catch (_) {
    return INTERVALO_DEFECTO_SEG
  }
}

async function repingPass(sb: any) {
  const ahora = new Date()
  const desde = new Date(ahora.getTime() - 180_000).toISOString()
  const hasta = new Date(ahora.getTime() - 10_000).toISOString()

  const { data: asigs } = await sb
    .from('pedido_asignaciones')
    .select('id, pedido_id, distancia_metros, rider_account_id, rider_accounts!inner(socio_id, socios!inner(user_id, nombre)), pedidos!inner(codigo, establecimientos!inner(nombre))')
    .eq('estado', 'esperando_aceptacion')
    .gte('created_at', desde)
    .lte('created_at', hasta)
    .limit(100)

  if (!asigs?.length) return 0

  let count = 0
  for (const a of asigs as any[]) {
    const userId = a.rider_accounts?.socios?.user_id
    if (!userId) continue
    const km = a.distancia_metros != null ? ` · ${(a.distancia_metros / 1000).toFixed(1)} km` : ''
    try {
      await fetch(`${SUPABASE_URL}/functions/v1/enviar_push`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SERVICE_ROLE}` },
        body: JSON.stringify({
          user_ids: [userId],
          user_type: 'socio',
          title: `Pedido pendiente · ${a.pedidos?.establecimientos?.nombre || ''}`,
          body: `#${a.pedidos?.codigo}${km} — acepta o se reasignará`,
          data: { tipo: 'reping_asignacion', pedido_id: a.pedido_id, asignacion_id: a.id, urgente: true },
        }),
      })
      count += 1
    } catch (_) {}
  }
  return count
}

serve(async () => {
  const sb = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } })
  const intervaloSeg = await leerIntervaloSeg(sb)
  const first = await repingPass(sb)

  // Pases restantes del minuto, en 2º plano (waitUntil) para no bloquear la respuesta
  // ni provocar el timeout de pg_net del cron.
  const retrasos: number[] = []
  for (let t = intervaloSeg * 1000; t < VENTANA_MS; t += intervaloSeg * 1000) retrasos.push(t)
  try {
    for (const ms of retrasos) {
      ;(globalThis as any).EdgeRuntime?.waitUntil?.(
        new Promise((resolve) => setTimeout(() => repingPass(sb).then(resolve).catch(() => resolve(0)), ms))
      )
    }
  } catch (_) {}

  return new Response(JSON.stringify({
    ok: true, first, intervalo_seg: intervaloSeg, pases_programados: retrasos.length,
  }), { headers: { 'Content-Type': 'application/json' } })
})
