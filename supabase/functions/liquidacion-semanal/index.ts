import { createClient } from 'jsr:@supabase/supabase-js@2'

// liquidacion-semanal v8 — corte de los lunes (modelo 19-jun, Opcion 1: saldo acumulado).
// Calcula por restaurante el neto de la semana, ARRASTRA el saldo no pagado de
// semanas anteriores y GUARDA el documento consolidado en liquidaciones_semanales.
// NO mueve dinero: el pago (Stripe/transferencia) lo lanza Marlon aparte.
// Auth: header x-cron-secret == CRON_SECRET, o JWT superadmin.
//
// NOTA 11-jul-2026 (pedidos telefonicos): el calculo por restaurante vive en la RPC
// public.calcular_liquidacion_restaurante (migracion telefonico_excluir_comision_rpcs):
// los telefonicos pagan tarifa fija (comision_pedido_telefonico_eur, default 1 EUR) en vez
// de %, y metodo_pago='pagado_local' queda fuera de tarjeta_total/efectivo_total. Esta edge
// NO necesita cambios: delega en la RPC. (Este archivo es el espejo del contenido v9
// DESPLEGADO; lo que habia antes en disco era una v4 obsoleta de facturas_semanales.)

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const CRON_SECRET = Deno.env.get('CRON_SECRET') || ''

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
function json(b: unknown, s = 200) { return new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } }) }
function isoDate(d: Date) { return d.toISOString().slice(0, 10) }
function r2(n: number) { return Math.round((Number(n) || 0) * 100) / 100 }
function prevWeek() {
  const now = new Date()
  const day = now.getUTCDay() // 0 Dom .. 6 Sab
  const diffToMonday = (day + 6) % 7
  const thisMonday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - diffToMonday, 0, 0, 0))
  return { inicio: new Date(thisMonday.getTime() - 7 * 86400000), fin: thisMonday }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  const admin = createClient(SUPABASE_URL, SERVICE_KEY)
  try {
    // ---- Auth ----
    const secret = req.headers.get('x-cron-secret') || ''
    let autorizado = !!CRON_SECRET && secret === CRON_SECRET
    if (!autorizado) {
      const tok = (req.headers.get('Authorization') || '').replace('Bearer ', '').trim()
      if (tok) {
        const uc = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: `Bearer ${tok}` } } })
        const { data: { user } } = await uc.auth.getUser()
        if (user) {
          const { data: rol } = await admin.from('usuarios').select('rol').eq('id', user.id).maybeSingle()
          autorizado = rol?.rol === 'superadmin' || rol?.rol === 'admin'
        }
      }
    }
    if (!autorizado) return json({ error: 'no autorizado' }, 401)

    // ---- Periodo ----
    const body = await req.json().catch(() => ({}))
    let inicio: Date, fin: Date
    if (body?.periodo_inicio && body?.periodo_fin) {
      inicio = new Date(body.periodo_inicio); fin = new Date(body.periodo_fin)
    } else {
      const w = prevWeek(); inicio = w.inicio; fin = w.fin
    }
    const pInicio = isoDate(inicio)
    const pFin = isoDate(new Date(fin.getTime() - 1)) // periodo cerrado: ultimo dia incluido

    // ---- Por restaurante activo ----
    const { data: ests } = await admin.from('establecimientos')
      .select('id, nombre, stripe_connect_status').eq('activo', true)
    const resultados: any[] = []
    for (const e of (ests || [])) {
      const { data: calcRows, error: calcErr } = await admin.rpc('calcular_liquidacion_restaurante', {
        p_est_id: e.id, p_inicio: inicio.toISOString(), p_fin: fin.toISOString(),
      })
      if (calcErr) { resultados.push({ establecimiento: e.nombre, error: calcErr.message }); continue }
      const c = Array.isArray(calcRows) ? calcRows[0] : calcRows
      if (!c) continue

      // ---- Arrastre: movimiento propio de semanas anteriores aun no pagadas ----
      // (suma transfer_restaurante de filas pendientes/arrastradas; nunca neto, para no duplicar)
      const { data: prevRows, error: prevErr } = await admin.from('liquidaciones_semanales')
        .select('transfer_restaurante')
        .eq('establecimiento_id', e.id)
        .lt('periodo_fin', pInicio)
        .in('estado', ['pendiente', 'arrastrada'])
      if (prevErr) { resultados.push({ establecimiento: e.nombre, error: prevErr.message }); continue }
      const hayArrastre = (prevRows || []).length > 0
      const saldoArrastre = r2((prevRows || []).reduce((s, r) => s + Number(r.transfer_restaurante || 0), 0))

      const transfer = r2(c.transfer_restaurante)
      const neto = r2(transfer + saldoArrastre)
      const sinMov = (c.pedidos_count || 0) === 0 && !hayArrastre

      const row = {
        periodo_inicio: pInicio,
        periodo_fin: pFin,
        establecimiento_id: e.id,
        pedidos_count: c.pedidos_count || 0,
        subtotal_total: c.subtotal_total || 0,
        envios_total: c.envios_total || 0,
        propinas_total: c.propinas_total || 0,
        efectivo_total: c.efectivo_total || 0,
        tarjeta_total: c.tarjeta_total || 0,
        comision_pido: c.comision_pido || 0,
        transfer_restaurante: transfer,
        saldo_arrastre: saldoArrastre,
        neto_a_pagar: neto,
        direccion: sinMov ? 'sin_movimiento' : (neto >= 0 ? 'pido_paga' : 'restaurante_paga'),
        estado: sinMov ? 'sin_movimiento' : 'pendiente',
      }
      const { error } = await admin.from('liquidaciones_semanales')
        .upsert(row, { onConflict: 'establecimiento_id,periodo_inicio,periodo_fin' })

      // Absorber las semanas anteriores no pagadas en esta liquidacion consolidada.
      // Solo pendiente -> arrastrada (idempotente: en un recalculo ya estan arrastradas).
      if (!error && !sinMov && hayArrastre) {
        await admin.from('liquidaciones_semanales')
          .update({ estado: 'arrastrada' })
          .eq('establecimiento_id', e.id)
          .lt('periodo_fin', pInicio)
          .eq('estado', 'pendiente')
      }
      resultados.push({ establecimiento: e.nombre, ...row, upsert_error: error?.message || null })
    }

    return json({ ok: true, periodo: { inicio: pInicio, fin: pFin }, restaurantes: resultados.length, resultados })
  } catch (err: any) {
    console.error('[liquidacion-semanal]', err)
    return json({ error: err.message }, 500)
  }
})
