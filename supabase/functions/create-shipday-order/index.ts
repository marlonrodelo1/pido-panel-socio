// create-shipday-order — DISPATCHER PROPIO (sin Shipday) desde 20-jun-2026.
// Asigna el pedido delivery al rider (socio) mas cercano ONLINE del establecimiento.
// v44 (1-jul): IDEMPOTENCIA anti-duplicado (chequeo de asignacion activa por pedido_id
//   antes de insertar + captura del 23505 del indice unico uq_pedido_asignacion_activa).
//   Cierra la carrera que creaba 2 asignaciones (p.ej. 2 dispositivos del restaurante).
//   Deno.serve nativo (el import de deno.land/std daba timeout al bundlear). verify_jwt=false.
// v42 (22-jun): REGLA 1 marketplace del socio (origen_pedido='marketplace_socio' -> solo ese socio).
// Body: { pedido_id }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const MAX_LOC_AGE_MS = Number(Deno.env.get('DISPATCH_MAX_LOC_AGE_MIN') ?? '15') * 60 * 1000
const MAX_RADIUS_KM = Number(Deno.env.get('DISPATCH_MAX_RADIUS_KM') ?? '15')

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-api-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
function json(b: unknown, s = 200) {
  return new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } })
}
function admin() {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
}
function haversine(aLat: number, aLng: number, bLat: number, bLng: number) {
  const R = 6371000
  const toRad = (d: number) => d * Math.PI / 180
  const dLat = toRad(bLat - aLat)
  const dLng = toRad(bLng - aLng)
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2
  return Math.round(2 * R * Math.asin(Math.sqrt(x)))
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  let body: { pedido_id?: string } = {}
  try { body = await req.json() } catch (_) {}
  if (!body.pedido_id) return json({ error: 'pedido_id_required' }, 400)

  const sb = admin()
  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
  const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  // 1. Pedido + establecimiento (con GPS)
  const { data: pedido, error: pErr } = await sb.from('pedidos')
    .select('id, codigo, estado, modo_entrega, establecimiento_id, intento_asignacion, socio_id, origen_pedido, establecimientos(id, nombre, latitud, longitud)')
    .eq('id', body.pedido_id).maybeSingle()
  if (pErr || !pedido) return json({ error: 'pedido_not_found', detail: pErr?.message }, 404)
  if (pedido.modo_entrega !== 'delivery') return json({ error: 'pedido_no_delivery' }, 400)
  if (pedido.estado === 'entregado' || pedido.estado === 'cancelado') return json({ error: `pedido_${pedido.estado}` }, 400)
  const est: any = (pedido as any).establecimientos

  async function marcarNoRider(reason: string) {
    await sb.from('pedidos').update({ shipday_status: 'no_rider' }).eq('id', pedido.id)
    try {
      await fetch(`${SUPABASE_URL}/functions/v1/enviar_push`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SERVICE_KEY}` },
        body: JSON.stringify({ user_type: 'superadmin', title: 'Pedido sin rider', body: `#${pedido.codigo} sin rider disponible (${reason})`, data: { tipo: 'no_rider', pedido_id: pedido.id } }),
      })
    } catch (_) {}
    return json({ ok: false, reason })
  }

  // 2. Socios candidatos. REGLA 1: marketplace del socio -> solo ese socio.
  const esMarketplaceSocio = (pedido as any).origen_pedido === 'marketplace_socio' && !!(pedido as any).socio_id
  let socioIds: string[]
  if (esMarketplaceSocio) {
    socioIds = [(pedido as any).socio_id]
  } else {
    const { data: vincs, error: vErr } = await sb.from('socio_establecimiento')
      .select('socio_id').eq('establecimiento_id', pedido.establecimiento_id).eq('estado', 'activa')
    if (vErr) return json({ error: 'vinculo_query_failed', detail: vErr.message }, 500)
    socioIds = [...new Set((vincs || []).map((v: any) => v.socio_id))]
  }
  if (!socioIds.length) return await marcarNoRider('sin_socio_vinculado')

  // 3. Riders de esos socios
  const { data: riders, error: rErr } = await sb.from('rider_accounts')
    .select('id, nombre, socio_id, activa, estado, socios!inner(id, user_id, nombre, en_servicio, latitud_actual, longitud_actual, last_location_at)')
    .in('socio_id', socioIds).eq('activa', true).eq('estado', 'activa')
  if (rErr) return json({ error: 'riders_query_failed', detail: rErr.message }, 500)

  // 4. Excluir riders ya intentados (+ estado para idempotencia)
  const { data: prev } = await sb.from('pedido_asignaciones').select('id, rider_account_id, intento, estado').eq('pedido_id', pedido.id)
  const tried = new Set((prev || []).map((p: any) => p.rider_account_id))
  const maxPrev = (prev || []).reduce((m: number, p: any) => Math.max(m, p.intento || 0), 0)

  // 4b. IDEMPOTENCIA: si el pedido YA tiene asignacion ACTIVA (otra invocacion concurrente
  //     la creo, p.ej. 2 dispositivos del restaurante), devolvemos ok sin insertar otra.
  const yaActiva = (prev || []).find((p: any) => p.estado === 'esperando_aceptacion' || p.estado === 'aceptado')
  if (yaActiva) {
    return json({ ok: true, ya_asignado: true, pedido_id: pedido.id, asignacion_id: yaActiva.id })
  }

  // 5. Candidatos ONLINE + distancia Haversine
  const candidatos = (riders || [])
    .filter((r: any) => r.socios?.en_servicio === true && !tried.has(r.id))
    .map((r: any) => {
      const s = r.socios
      const dist = (est?.latitud && est?.longitud && s?.latitud_actual && s?.longitud_actual)
        ? haversine(est.latitud, est.longitud, s.latitud_actual, s.longitud_actual)
        : null
      return { rider: r, socio: s, dist }
    })
    .sort((a, b) => (a.dist ?? Infinity) - (b.dist ?? Infinity))

  if (!candidatos.length) return await marcarNoRider(esMarketplaceSocio ? 'socio_marketplace_offline' : 'no_rider')

  // 5b. PREFERENCIA (no filtro duro): ubicacion fresca (last_location_at reciente) + dentro de radio.
  //     Si hay preferentes se elige el mas cercano de ese subconjunto; si NO hay, FALLBACK EXACTO
  //     al comportamiento anterior (mas cercano de la lista completa). Nunca deja el pedido sin
  //     candidato: con un solo candidato (marketplace del socio) el fallback lo elige igual.
  const ahoraMs = Date.now()
  const preferentes = candidatos.filter((c: any) => {
    const s = c.socio
    if (!(s?.latitud_actual && s?.longitud_actual)) return false
    if (c.dist == null || c.dist > MAX_RADIUS_KM * 1000) return false
    const locTs = s?.last_location_at ? new Date(s.last_location_at).getTime() : NaN
    if (!Number.isFinite(locTs) || (ahoraMs - locTs) > MAX_LOC_AGE_MS) return false
    return true
  })
  const elegido = preferentes.length ? preferentes[0] : candidatos[0]
  const intento = Math.max((pedido.intento_asignacion || 0), maxPrev) + 1
  const ts = new Date().toISOString()

  // 6. Insert asignacion (socio_id imprescindible: el realtime del socio filtra por socio_id)
  const { data: asignacion, error: aErr } = await sb.from('pedido_asignaciones').insert({
    pedido_id: pedido.id,
    rider_account_id: elegido.rider.id,
    socio_id: elegido.socio.id,
    intento,
    distancia_metros: elegido.dist,
    estado: 'esperando_aceptacion',
  }).select('id').single()
  if (aErr) {
    if ((aErr as any).code === '23505') {
      return json({ ok: true, ya_asignado: true, pedido_id: pedido.id })
    }
    return json({ error: 'asignacion_insert_failed', detail: aErr.message }, 500)
  }

  // 7. Update pedido
  await sb.from('pedidos').update({
    shipday_status: 'created',
    shipday_tracking_url: `https://socio.pidoo.es/seguir/${pedido.codigo}`,
    rider_account_id: elegido.rider.id,
    socio_id: elegido.socio.id,
    intento_asignacion: intento,
    assigned_at: ts,
  }).eq('id', pedido.id)

  // 8. Push inmediato al rider
  try {
    await fetch(`${SUPABASE_URL}/functions/v1/enviar_push`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SERVICE_KEY}` },
      body: JSON.stringify({
        user_ids: [elegido.socio.user_id],
        title: `Nuevo pedido · ${est?.nombre || ''}`,
        body: `#${pedido.codigo}${elegido.dist != null ? ` · ${(elegido.dist / 1000).toFixed(1)} km` : ''} — acepta antes de 3 min`,
        data: { tipo: 'nueva_asignacion', pedido_id: pedido.id, asignacion_id: asignacion?.id, urgente: true },
      }),
    })
  } catch (_) {}

  return json({ ok: true, pedido_id: pedido.id, rider_account_id: elegido.rider.id, socio_id: elegido.socio.id, intento, distancia_metros: elegido.dist, marketplace_socio: esMarketplaceSocio })
})
