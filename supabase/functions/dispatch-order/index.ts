// dispatch-order — sustituye a create-shipday-order cuando
// establecimientos.usa_dispatcher_propio = true.
//
// Body: { pedido_id }
// 1. Lee pedido + establecimiento (lat/lng).
// 2. Si establecimiento.usa_dispatcher_propio = false → reenvia a
//    create-shipday-order (compatibilidad mientras dura la migracion).
// 3. Si true → busca socios online del establecimiento, ranquea por score y
//    crea fila en pedido_asignaciones + push al socio elegido.
//
// score = pedidos_activos * CARGA_PESO_METROS + distancia_metros
// (mismo algoritmo que create-shipday-order v25)

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { preflight, jsonResponse } from '../_shared/cors.ts'
import { adminClient } from '../_shared/auth.ts'
import { haversineMeters } from '../_shared/geo.ts'

const CARGA_PESO_METROS = 1500
const VENTANA_GPS_MINUTOS = 3 // GPS mas viejo se considera offline

serve(async (req) => {
  const pre = preflight(req)
  if (pre) return pre
  if (req.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405)

  let body: { pedido_id?: string } = {}
  try { body = await req.json() } catch (_) {}
  if (!body.pedido_id) return jsonResponse({ error: 'pedido_id_required' }, 400)

  const sb = adminClient()

  const { data: pedido, error: pedErr } = await sb
    .from('pedidos')
    .select('id, codigo, establecimiento_id, lat_entrega, lng_entrega, intento_asignacion, modo_entrega, estado')
    .eq('id', body.pedido_id)
    .maybeSingle()

  if (pedErr || !pedido) return jsonResponse({ error: 'pedido_not_found' }, 404)
  if (pedido.modo_entrega !== 'delivery') return jsonResponse({ error: 'pedido_no_delivery' }, 400)

  const { data: est } = await sb
    .from('establecimientos')
    .select('id, latitud, longitud, usa_dispatcher_propio, nombre')
    .eq('id', pedido.establecimiento_id)
    .maybeSingle()

  if (!est) return jsonResponse({ error: 'establecimiento_not_found' }, 404)

  // Compatibilidad: si el restaurante aun no usa el dispatcher propio,
  // delegamos en la funcion legacy de Shipday.
  if (!est.usa_dispatcher_propio) {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const r = await fetch(`${supabaseUrl}/functions/v1/create-shipday-order`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: req.headers.get('Authorization') || `Bearer ${Deno.env.get('SUPABASE_ANON_KEY')}`,
      },
      body: JSON.stringify({ pedido_id: pedido.id }),
    })
    const txt = await r.text()
    return new Response(txt, { status: r.status, headers: { 'Content-Type': 'application/json' } })
  }

  // Dispatcher propio: candidatos = socios vinculados al establecimiento via
  // restaurante_riders -> rider_accounts -> socios, online y con GPS reciente.
  const { data: vinculos } = await sb
    .from('restaurante_riders')
    .select('rider_account_id, prioridad, rider_accounts!inner(id, socio_id, activa, estado, socios!inner(id, en_servicio, latitud_actual, longitud_actual, last_location_at, user_id, nombre))')
    .eq('establecimiento_id', est.id)
    .eq('rider_accounts.activa', true)
    .eq('rider_accounts.estado', 'activa')

  const ahora = Date.now()
  type Cand = {
    socio_id: string
    rider_account_id: string
    nombre: string
    user_id: string
    prioridad: number
    distancia: number
  }

  const candidatos: Cand[] = []
  for (const v of (vinculos || []) as any[]) {
    const ra = v.rider_accounts
    const s = ra?.socios
    if (!s?.en_servicio) continue
    if (s.latitud_actual == null || s.longitud_actual == null) continue
    if (s.last_location_at) {
      const edad = (ahora - new Date(s.last_location_at).getTime()) / 60000
      if (edad > VENTANA_GPS_MINUTOS) continue
    }
    candidatos.push({
      socio_id: s.id,
      rider_account_id: ra.id,
      nombre: s.nombre,
      user_id: s.user_id,
      prioridad: v.prioridad ?? 100,
      distancia: haversineMeters(est.latitud, est.longitud, s.latitud_actual, s.longitud_actual),
    })
  }

  if (candidatos.length === 0) {
    await sb.from('pedidos').update({ shipday_status: 'no_rider' }).eq('id', pedido.id)
    return jsonResponse({ error: 'no_riders_online', candidatos: 0 }, 200)
  }

  // Cargar pedidos activos por rider para el calculo del score
  const riderIds = candidatos.map((c) => c.rider_account_id)
  const { data: activos } = await sb
    .from('pedido_asignaciones')
    .select('rider_account_id, estado')
    .in('rider_account_id', riderIds)
    .in('estado', ['esperando_aceptacion', 'aceptado'])

  const activosByRider: Record<string, number> = {}
  ;(activos || []).forEach((a: any) => {
    activosByRider[a.rider_account_id] = (activosByRider[a.rider_account_id] || 0) + 1
  })

  // Excluir riders que ya intentaron este pedido
  const { data: intentadosRows } = await sb
    .from('pedido_asignaciones')
    .select('rider_account_id')
    .eq('pedido_id', pedido.id)
  const yaIntentados = new Set((intentadosRows || []).map((r: any) => r.rider_account_id))

  const restantes = candidatos.filter((c) => !yaIntentados.has(c.rider_account_id))
  if (restantes.length === 0) {
    await sb.from('pedidos').update({ shipday_status: 'no_rider' }).eq('id', pedido.id)
    return jsonResponse({ error: 'all_riders_attempted' }, 200)
  }

  restantes.sort((a, b) => {
    const sa = (activosByRider[a.rider_account_id] || 0) * CARGA_PESO_METROS + a.distancia
    const sb_ = (activosByRider[b.rider_account_id] || 0) * CARGA_PESO_METROS + b.distancia
    if (sa !== sb_) return sa - sb_
    return b.prioridad - a.prioridad
  })

  const elegido = restantes[0]
  const intento = (pedido.intento_asignacion || 0) + 1

  const { data: asignacion, error: asignErr } = await sb
    .from('pedido_asignaciones')
    .insert({
      pedido_id: pedido.id,
      rider_account_id: elegido.rider_account_id,
      intento,
      distancia_metros: elegido.distancia,
      estado: 'esperando_aceptacion',
    })
    .select()
    .single()

  if (asignErr) return jsonResponse({ error: 'insert_failed', detail: asignErr.message }, 500)

  await sb.from('pedidos').update({
    rider_account_id: elegido.rider_account_id,
    intento_asignacion: intento,
    assigned_at: new Date().toISOString(),
    shipday_status: 'created',
  }).eq('id', pedido.id)

  // Push al rider elegido. Logueamos en push_debug_logs para diagnostico
  // (console.log de edge functions se pierde rapido). Si el fetch falla,
  // intentamos un segundo path llamando enviar_push con anon key.
  const dbg = async (event: string, details: any) => {
    try {
      await sb.from('push_debug_logs').insert({
        platform: 'edge', event: 'dispatch:' + event,
        details: details ? JSON.stringify(details).slice(0, 1500) : null,
      })
    } catch (_) {}
  }

  await dbg('elegido', { user_id: elegido.user_id, rider_account_id: elegido.rider_account_id, asignacion_id: asignacion.id, codigo: pedido.codigo })

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || ''
  const pushBody = JSON.stringify({
    user_ids: [elegido.user_id],
    title: `Nuevo pedido · ${est.nombre}`,
    body: `#${pedido.codigo} · ${(elegido.distancia / 1000).toFixed(1)} km`,
    data: { tipo: 'nueva_asignacion', pedido_id: pedido.id, asignacion_id: asignacion.id },
  })

  async function tryPush(authToken: string, label: string) {
    try {
      const r = await fetch(`${supabaseUrl}/functions/v1/enviar_push`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
          apikey: anonKey,
        },
        body: pushBody,
      })
      const text = await r.text()
      await dbg('push_' + label, { status: r.status, body: text.slice(0, 400) })
      return r.ok
    } catch (e: any) {
      await dbg('push_' + label + '_throw', { msg: e?.message || String(e) })
      return false
    }
  }

  let ok = await tryPush(serviceKey, 'service')
  if (!ok) ok = await tryPush(anonKey, 'anon')

  return jsonResponse({ ok: true, asignacion_id: asignacion.id, rider_account_id: elegido.rider_account_id, intento, distancia_metros: elegido.distancia, push_ok: ok })
})
