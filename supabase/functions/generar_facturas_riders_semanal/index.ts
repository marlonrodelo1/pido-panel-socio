// generar_facturas_riders_semanal v4 — protegida por CRON_SECRET (X-Cron-Secret).
// Cron pg_cron jobid=7 lunes 02:00.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

function getSemanaAnterior(now: Date): { inicio: Date; fin: Date } {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const dow = d.getUTCDay()
  const daysSinceMon = (dow + 6) % 7
  const lunesActual = new Date(d)
  lunesActual.setUTCDate(d.getUTCDate() - daysSinceMon)
  const inicio = new Date(lunesActual)
  inicio.setUTCDate(lunesActual.getUTCDate() - 7)
  inicio.setUTCHours(0, 0, 0, 0)
  const fin = new Date(lunesActual)
  fin.setUTCMilliseconds(-1)
  return { inicio, fin }
}

serve(async (req: Request) => {
  // Auth: CRON_SECRET o superadmin JWT
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const cronSecret = Deno.env.get('CRON_SECRET')
  const headerSecret = req.headers.get('X-Cron-Secret')
  const authHeader = req.headers.get('Authorization')

  let autorizado = false
  if (cronSecret && headerSecret && headerSecret === cronSecret) autorizado = true
  else if (authHeader) {
    try {
      const sUser = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authHeader } } })
      const { data: u } = await sUser.auth.getUser()
      if (u?.user) {
        const { data: usuario } = await supabase.from('usuarios').select('rol').eq('id', u.user.id).maybeSingle()
        if (usuario?.rol === 'superadmin') autorizado = true
      }
    } catch (_) {}
  }
  if (!autorizado) return Response.json({ error: 'unauthorized' }, { status: 401 })

  try {
    const now = new Date()
    const { inicio, fin } = getSemanaAnterior(now)
    const semanaInicioIso = inicio.toISOString().slice(0, 10)
    const semanaFinIso = fin.toISOString().slice(0, 10)

    const { data: earnings, error } = await supabase
      .from('rider_earnings')
      .select('rider_account_id, coste_envio, propina, comision_rider_sobre_subtotal, neto_rider, pedido_id')
      .eq('estado_pago', 'pendiente')
      .gte('created_at', inicio.toISOString())
      .lte('created_at', fin.toISOString())
    if (error) return Response.json({ error: error.message }, { status: 500 })
    if (!earnings || earnings.length === 0) return Response.json({ success: true, facturas_creadas: 0, semana_inicio: semanaInicioIso, semana_fin: semanaFinIso })

    const grupos: Record<string, any> = {}
    for (const e of earnings) {
      const rid = e.rider_account_id
      if (!grupos[rid]) grupos[rid] = { total_pedidos: 0, total_envios: 0, total_comisiones: 0, total_propinas: 0, total_neto: 0 }
      grupos[rid].total_pedidos += 1
      grupos[rid].total_envios += Number(e.coste_envio || 0)
      grupos[rid].total_comisiones += Number(e.comision_rider_sobre_subtotal || 0)
      grupos[rid].total_propinas += Number(e.propina || 0)
      grupos[rid].total_neto += Number(e.neto_rider || 0)
    }

    const rows = Object.entries(grupos).map(([rid, g]: [string, any]) => ({
      rider_account_id: rid,
      semana_inicio: semanaInicioIso,
      semana_fin: semanaFinIso,
      total_pedidos: g.total_pedidos,
      total_envios: Number(g.total_envios.toFixed(2)),
      total_comisiones: Number(g.total_comisiones.toFixed(2)),
      total_propinas: Number(g.total_propinas.toFixed(2)),
      total_neto: Number(g.total_neto.toFixed(2)),
      estado: 'pendiente',
    }))

    const { error: upErr } = await supabase.from('rider_facturas_semanales').upsert(rows, { onConflict: 'rider_account_id,semana_inicio' })
    if (upErr) return Response.json({ error: upErr.message }, { status: 500 })

    return Response.json({ success: true, facturas_creadas: rows.length, semana_inicio: semanaInicioIso, semana_fin: semanaFinIso })
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Internal server error'
    return Response.json({ error: msg }, { status: 500 })
  }
})
