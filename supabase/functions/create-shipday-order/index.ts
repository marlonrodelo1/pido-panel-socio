// create-shipday-order — DISPATCHER PROPIO (sin Shipday) desde 20-jun-2026.
// v56 (23-jul-2026): 20 VUELTAS + TOPE DE TIEMPO + BLINDAJE.
//   1) MAX_VUELTAS default 2 -> 20 (decision Marlon 23-jul: insistir mucho mas antes de cancelar).
//   2) NUEVO tope de tiempo total DISPATCH_MAX_ESPERA_MIN (default 60 min): si el pedido lleva
//      mas de 60 min desde que el restaurante lo acepto (o desde la 1a asignacion) sin que
//      nadie lo coja, se cancela por no-cobertura aunque queden vueltas. Evita pedidos zombi
//      de horas cuando haya muchos repartidores (20 vueltas x N riders x 150s).
//   3) BLINDAJE rama marketplace: si el vinculo del socio ya no esta 'activa' (se desvinculo
//      en vuelo), antes se seguia y el insert reventaba con 23514 del guard en bucle infinito
//      de 500 -> ahora marcarNoRider('sin_socio_vinculado').
//   4) BLINDAJE insert: un 23514 (trg_guard_asignacion_socio_vinculado) ya no devuelve 500
//      crudo reintentable -> marcarNoRider('sin_socio_vinculado') (el rescate cancela+reembolsa).
// v55 (19-jul-2026): RECHAZO EXPLICITO = DEFINITIVO. Si el rider pulsa "Rechazar", ya no
//   se le vuelve a ofrecer ese pedido en las vueltas siguientes. Los timeout SI vuelven.
// v54 (18-jul-2026): AUTONOMIA DEL SOCIO (reparto_activo + acepta_* + aviso telefonicos).
// v53: PEDIDOS TELEFONICOS — en la terminal de no-cobertura se cancela SIN cargo del 80%.
// v52: al agotar las vueltas se CANCELA el pedido y se carga el 80% al responsable (R1).
// v51: ROUND-ROBIN + RESPONSABLE. Ventana de aceptacion 150 s (2:30).
// v50: FRESCURA DE GPS como FILTRO DURO (MAX_LOC_AGE_MIN 12 min).
// v48-v49: CANDADO DE AUTENTICACION (cron-secret / service-role / JWT dueno o admin).
// v47: FILTRO DURO por GPS y radio (15 km); score = dist + activos*1500.
// v44: IDEMPOTENCIA anti-duplicado. v42: REGLA 1 marketplace del socio.
// Body: { pedido_id }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

function envNum(name: string, fallback: number): number {
  const n = Number(Deno.env.get(name))
  return Number.isFinite(n) && n > 0 ? n : fallback
}
const MAX_LOC_AGE_MS = envNum('DISPATCH_MAX_LOC_AGE_MIN', 12) * 60 * 1000
const MAX_RADIUS_KM = envNum('DISPATCH_MAX_RADIUS_KM', 15)
const CARGA_PESO_METROS = envNum('DISPATCH_CARGA_PESO_METROS', 1500)
const MAX_VUELTAS = envNum('DISPATCH_MAX_VUELTAS', 20)
const MAX_ESPERA_MIN = envNum('DISPATCH_MAX_ESPERA_MIN', 60)

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-api-version, x-cron-secret',
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

  let body: { pedido_id?: string } | null = {}
  try { body = await req.json() } catch (_) {}
  if (!body?.pedido_id) return json({ error: 'pedido_id_required' }, 400)

  const sb = admin()
  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
  const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  const cronSecret = req.headers.get('x-cron-secret') || ''
  const expectedSecret = Deno.env.get('CRON_SECRET') || ''
  const bearer = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim()
  const esServidor = (!!expectedSecret && cronSecret === expectedSecret) || (!!SERVICE_KEY && bearer === SERVICE_KEY)
  let usuarioAutenticado: string | null = null
  if (!esServidor) {
    if (!bearer) return json({ error: 'no_autorizado' }, 401)
    const ANON = Deno.env.get('SUPABASE_ANON_KEY')!
    const sbUser = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: `Bearer ${bearer}` } }, auth: { persistSession: false } })
    const { data: u } = await sbUser.auth.getUser()
    if (!u?.user) return json({ error: 'no_autorizado' }, 401)
    usuarioAutenticado = u.user.id
  }

  async function enviarPush(payload: unknown) {
    try {
      await fetch(`${SUPABASE_URL}/functions/v1/enviar_push`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SERVICE_KEY}` },
        body: JSON.stringify(payload),
      })
    } catch (_) { /* best-effort */ }
  }

  const { data: pedido, error: pErr } = await sb.from('pedidos')
    .select('id, codigo, estado, modo_entrega, establecimiento_id, intento_asignacion, socio_id, socio_responsable_id, subtotal, origen_pedido, usuario_id, metodo_pago, aceptado_at, establecimientos(id, nombre, latitud, longitud, user_id)')
    .eq('id', body.pedido_id).maybeSingle()
  if (pErr || !pedido) return json({ error: 'pedido_not_found', detail: pErr?.message }, 404)
  const est: any = (pedido as any).establecimientos

  if (usuarioAutenticado) {
    const esDueno = est?.user_id === usuarioAutenticado
    if (!esDueno) {
      const { data: rolRow } = await sb.from('usuarios').select('rol').eq('id', usuarioAutenticado).maybeSingle()
      if (rolRow?.rol !== 'admin' && rolRow?.rol !== 'superadmin') {
        return json({ error: 'forbidden' }, 403)
      }
    }
  }

  if (pedido.modo_entrega !== 'delivery') return json({ error: 'pedido_no_delivery' }, 400)
  if (pedido.estado === 'entregado' || pedido.estado === 'cancelado') return json({ error: `pedido_${pedido.estado}` }, 400)

  async function marcarNoRider(reason: string) {
    const { data: marcado, error: marcadoErr } = await sb.from('pedidos')
      .update({ shipday_status: 'no_rider' })
      .eq('id', pedido.id)
      .or('shipday_status.is.null,shipday_status.eq.created')
      .select('id')
    if (marcadoErr) {
      console.error('[dispatch] marcarNoRider update fallo', pedido.id, marcadoErr.message)
      return json({ ok: false, reason, error: 'no_rider_update_failed', detail: marcadoErr.message }, 500)
    }
    if (marcado && marcado.length > 0) {
      await enviarPush({
        user_type: 'superadmin',
        title: 'Pedido sin rider',
        body: `#${pedido.codigo} sin rider disponible (${reason})`,
        data: { tipo: 'no_rider', pedido_id: pedido.id },
      })
      if (pedido.establecimiento_id) {
        const { error: nErr } = await sb.from('notificaciones').insert({
          establecimiento_id: pedido.establecimiento_id,
          titulo: `Pedido ${pedido.codigo}: sin repartidor`,
          descripcion: `No hay ningún repartidor disponible ahora mismo para el pedido ${pedido.codigo}. Si no aparece uno en unos minutos, se cancelará automáticamente. Pausa la preparación.`,
          tipo: 'no_rider',
          data: { pedido_id: pedido.id, codigo: pedido.codigo, motivo: reason },
        })
        if (nErr) console.error('[dispatch] notif restaurante', nErr.message)
        await enviarPush({
          target_type: 'restaurante', target_id: pedido.establecimiento_id,
          title: `Pedido ${pedido.codigo}: sin repartidor`,
          body: 'No hay repartidor disponible ahora mismo. Si no aparece uno en unos minutos, se cancelará automáticamente.',
          data: { tipo: 'no_rider', pedido_id: pedido.id, codigo: pedido.codigo },
        })
      }
      if ((pedido as any).usuario_id) {
        const reembolso = (pedido as any).metodo_pago === 'tarjeta' ? ' y te devolveremos el importe completo' : ''
        const { error: cErr } = await sb.from('notificaciones').insert({
          usuario_id: (pedido as any).usuario_id,
          titulo: 'Buscando repartidor',
          descripcion: `Estamos buscando repartidor para tu pedido ${pedido.codigo}. Si no encontramos uno en unos minutos, se cancelará automáticamente${reembolso}.`,
          tipo: 'no_rider',
          data: { pedido_id: pedido.id, codigo: pedido.codigo },
        })
        if (cErr) console.error('[dispatch] notif cliente', cErr.message)
        await enviarPush({
          target_type: 'cliente', target_id: (pedido as any).usuario_id,
          title: 'Buscando repartidor',
          body: `Tu pedido ${pedido.codigo} está tardando en asignarse. Si no encontramos repartidor en unos minutos, se cancelará automáticamente${reembolso}.`,
          data: { tipo: 'no_rider', pedido_id: pedido.id, codigo: pedido.codigo },
        })
      }
    }
    return json({ ok: false, reason })
  }

  async function cancelarPorNoCobertura(motivo = 'no_cubierto_sin_repartidor') {
    const ahora = new Date().toISOString()
    const esTelefonico = (pedido as any).origen_pedido === 'telefonico'
    const { data: cancelado, error: cancErr } = await sb.from('pedidos')
      .update({ estado: 'cancelado', cancelado_at: ahora, motivo_cancelacion: motivo, shipday_status: 'no_rider' })
      .eq('id', pedido.id)
      .in('estado', ['nuevo', 'preparando', 'listo'])
      .select('id')
    if (cancErr) {
      console.error('[dispatch] cancelarPorNoCobertura update fallo', pedido.id, cancErr.message)
      return json({ ok: false, reason: 'no_cubierto', error: 'cancel_update_failed', detail: cancErr.message }, 500)
    }
    if (!cancelado || cancelado.length === 0) {
      return json({ ok: false, reason: 'ya_resuelto_en_carrera' })
    }
    const responsable = (pedido as any).socio_responsable_id
    const subtotal = Number((pedido as any).subtotal || 0)
    const monto = Math.round(subtotal * 0.80 * 100) / 100
    let cargoCreado = false
    if (responsable && monto > 0 && !esTelefonico) {
      const { error: cargoErr } = await sb.from('cargos_socio').insert({
        socio_id: responsable,
        pedido_id: pedido.id,
        establecimiento_id: pedido.establecimiento_id,
        tipo: 'pedido_no_cubierto',
        monto,
        concepto: `Pedido ${pedido.codigo} cancelado sin repartidor. Compensacion al restaurante = 80% del subtotal.`,
        estado: 'pendiente',
      })
      if (cargoErr) {
        if ((cargoErr as any).code !== '23505') console.error('[dispatch] cargo insert fallo', cargoErr.message)
      } else { cargoCreado = true }
    }
    await enviarPush({
      user_type: 'superadmin',
      title: 'Pedido cancelado sin rider',
      body: `#${pedido.codigo}: nadie lo acepto (${motivo}). Cancelado${cargoCreado ? ` · cargo ${monto.toFixed(2)} EUR al responsable` : (esTelefonico ? ' · telefonico, sin cargo' : '')}.`,
      data: { tipo: 'pedido_no_cubierto', pedido_id: pedido.id },
    })
    if (pedido.establecimiento_id) {
      const descRestaurante = esTelefonico
        ? `Ningun repartidor acepto el pedido telefonico ${pedido.codigo} y se ha cancelado. Vuelve a crearlo si sigues necesitando el envio, o entregalo por tus medios.`
        : `Ningun repartidor acepto el pedido ${pedido.codigo}, se ha cancelado. La compensacion de la comida se gestiona con el repartidor responsable.`
      await sb.from('notificaciones').insert({
        establecimiento_id: pedido.establecimiento_id,
        titulo: `Pedido ${pedido.codigo} cancelado`,
        descripcion: descRestaurante,
        tipo: 'pedido_cancelado',
        data: { pedido_id: pedido.id, codigo: pedido.codigo },
      })
      await enviarPush({
        target_type: 'restaurante', target_id: pedido.establecimiento_id,
        title: `Pedido ${pedido.codigo} cancelado`,
        body: esTelefonico
          ? 'Ningun repartidor acepto el envio telefonico. Vuelve a crearlo o entregalo por tus medios.'
          : 'Ningun repartidor lo acepto. Cancelado; la compensacion se gestiona con el repartidor responsable.',
        data: { tipo: 'pedido_cancelado', pedido_id: pedido.id, codigo: pedido.codigo },
      })
    }
    return json({ ok: false, reason: 'cancelado_no_cubierto', motivo, responsable_socio_id: responsable, cargo: cargoCreado ? monto : 0 })
  }

  // v55: se trae motivo_rechazo para distinguir rechazo explicito de timeout.
  // v56: se trae created_at para el tope de tiempo total.
  const { data: prev, error: prevErr } = await sb.from('pedido_asignaciones').select('id, rider_account_id, intento, estado, motivo_rechazo, created_at').eq('pedido_id', pedido.id)
  if (prevErr) return json({ error: 'historial_query_failed', detail: prevErr.message }, 500)
  const maxPrev = (prev || []).reduce((m: number, p: any) => Math.max(m, p.intento || 0), 0)
  const yaActiva = (prev || []).find((p: any) => p.estado === 'esperando_aceptacion' || p.estado === 'aceptado')
  if (yaActiva) {
    return json({ ok: true, ya_asignado: true, pedido_id: pedido.id, asignacion_id: yaActiva.id })
  }

  // v56: TOPE DE TIEMPO TOTAL. Referencia = cuando el restaurante acepto el pedido
  // (aceptado_at); si no existe, la 1a asignacion. Pasado MAX_ESPERA_MIN sin que nadie
  // lo coja => cancelar por no-cobertura aunque queden vueltas. Nunca pisa un pedido
  // aceptado por un rider (el check de yaActiva ya retorno antes) ni uno recogido/en
  // camino (el update condicional de cancelarPorNoCobertura solo toca nuevo/preparando/listo).
  {
    const aceptMs = (pedido as any).aceptado_at ? new Date((pedido as any).aceptado_at).getTime() : NaN
    const primeraAsigMs = (prev || []).reduce((m: number, p: any) => {
      const t = p.created_at ? new Date(p.created_at).getTime() : NaN
      return Number.isFinite(t) && t < m ? t : m
    }, Infinity)
    const refMs = Number.isFinite(aceptMs) ? aceptMs : (primeraAsigMs !== Infinity ? primeraAsigMs : NaN)
    if (Number.isFinite(refMs) && (Date.now() - refMs) > MAX_ESPERA_MIN * 60 * 1000) {
      return await cancelarPorNoCobertura('no_cubierto_tiempo_maximo')
    }
  }

  if (est?.latitud == null || est?.longitud == null) {
    return await marcarNoRider('establecimiento_sin_gps')
  }

  const origenPedido = (pedido as any).origen_pedido
  const esMarketplaceSocio = origenPedido === 'marketplace_socio' && !!(pedido as any).socio_id
  const esTelefonicoPed = origenPedido === 'telefonico'
  const aceptaFuente = (s: any) => {
    if (esMarketplaceSocio) return s?.acepta_marketplace !== false
    if (esTelefonicoPed) return s?.acepta_telefonicos !== false
    return s?.acepta_app !== false
  }

  let socioIds: string[]
  if (esMarketplaceSocio) {
    const { data: vincSocio, error: vincErr } = await sb.from('socio_establecimiento')
      .select('id, reparto_activo')
      .eq('establecimiento_id', pedido.establecimiento_id)
      .eq('socio_id', (pedido as any).socio_id)
      .eq('estado', 'activa')
      .maybeSingle()
    if (vincErr) return json({ error: 'vinculo_query_failed', detail: vincErr.message }, 500)
    // v56: si el vinculo ya no esta 'activa' (se desvinculo en vuelo), antes se seguia
    // adelante y el insert reventaba con 23514 del guard en bucle -> ahora terminal limpia.
    if (!vincSocio) return await marcarNoRider('sin_socio_vinculado')
    if (vincSocio.reparto_activo === false) {
      return await marcarNoRider('socio_pauso_restaurante')
    }
    socioIds = [(pedido as any).socio_id]
  } else {
    const { data: vincs, error: vErr } = await sb.from('socio_establecimiento')
      .select('socio_id').eq('establecimiento_id', pedido.establecimiento_id).eq('estado', 'activa').eq('reparto_activo', true)
    if (vErr) return json({ error: 'vinculo_query_failed', detail: vErr.message }, 500)
    socioIds = [...new Set((vincs || []).map((v: any) => v.socio_id))]
  }
  if (!socioIds.length) return await marcarNoRider('sin_socio_vinculado')

  const { data: riders, error: rErr } = await sb.from('rider_accounts')
    .select('id, nombre, socio_id, activa, estado, socios!inner(id, user_id, nombre, en_servicio, activo, marketplace_activo, latitud_actual, longitud_actual, last_location_at, acepta_marketplace, acepta_telefonicos, acepta_app)')
    .in('socio_id', socioIds).eq('activa', true).eq('estado', 'activa')
  if (rErr) return json({ error: 'riders_query_failed', detail: rErr.message }, 500)

  const online = (riders || [])
    .filter((r: any) => r.socios?.en_servicio === true && r.socios?.activo !== false)
  if (!online.length) return await marcarNoRider(esMarketplaceSocio ? 'socio_marketplace_offline' : 'no_rider')

  const base = online
    .filter((r: any) => aceptaFuente(r.socios))
    .map((r: any) => {
      const s = r.socios
      const dist = (s?.latitud_actual != null && s?.longitud_actual != null)
        ? haversine(est.latitud, est.longitud, s.latitud_actual, s.longitud_actual)
        : null
      return { rider: r, socio: s, dist, score: 0 }
    })
  if (!base.length) {
    return await marcarNoRider(esMarketplaceSocio ? 'socio_no_acepta_marketplace' : (esTelefonicoPed ? 'sin_rider_acepta_telefonicos' : 'sin_rider_acepta_app'))
  }

  const ahoraMs = Date.now()
  const esFresco = (c: any) => {
    const ts = c.socio?.last_location_at ? new Date(c.socio.last_location_at).getTime() : NaN
    return Number.isFinite(ts) && (ahoraMs - ts) <= MAX_LOC_AGE_MS
  }

  const enRadio = base.filter((c: any) => c.dist != null && c.dist <= MAX_RADIUS_KM * 1000)
  if (!enRadio.length) return await marcarNoRider('sin_rider_en_radio')
  const elegibles = enRadio.filter((c: any) => esFresco(c))
  if (!elegibles.length) return await marcarNoRider('sin_rider_fresco')

  const cargaPorRider = new Map<string, number>()
  try {
    const riderIds = [...new Set(elegibles.map((c: any) => c.rider.id))]
    const { data: activas } = await sb.from('pedido_asignaciones')
      .select('rider_account_id, estado, resolved_at, pedidos!inner(estado)')
      .in('rider_account_id', riderIds)
      .neq('pedido_id', pedido.id)
      .or('estado.eq.esperando_aceptacion,and(estado.eq.aceptado,resolved_at.is.null)')
      .in('pedidos.estado', ['nuevo', 'preparando', 'listo', 'recogido', 'en_camino'])
    for (const a of (activas || []) as any[]) {
      cargaPorRider.set(a.rider_account_id, (cargaPorRider.get(a.rider_account_id) || 0) + 1)
    }
  } catch (_) { /* si falla, carga 0 para todos */ }
  for (const c of elegibles as any[]) c.score = c.dist + (cargaPorRider.get(c.rider.id) || 0) * CARGA_PESO_METROS

  // 5d. ROUND-ROBIN (v51) + RECHAZO DEFINITIVO (v55).
  const offersByRider = new Map<string, number>()
  for (const p of (prev || []) as any[]) {
    offersByRider.set(p.rider_account_id, (offersByRider.get(p.rider_account_id) || 0) + 1)
  }

  // v55: un rechazo EXPLICITO del rider es DEFINITIVO — no se le vuelve a ofrecer el mismo
  // pedido en las vueltas siguientes. Los TIMEOUT si vuelven:
  // no ver el movil a tiempo no es lo mismo que decir que no.
  const rechazoExplicito = new Set<string>()
  for (const p of (prev || []) as any[]) {
    if (p.estado === 'rechazado' && p.motivo_rechazo && p.motivo_rechazo !== 'timeout') {
      rechazoExplicito.add(p.rider_account_id)
    }
  }
  const noRechazados = (elegibles as any[]).filter((c) => !rechazoExplicito.has(c.rider.id))
  if (!noRechazados.length) {
    // Todos los elegibles lo han rechazado a mano => no hay a quien ofrecerselo.
    return await cancelarPorNoCobertura('no_cubierto_todos_rechazaron')
  }

  const conOffers = noRechazados.map((c) => ({ ...c, offers: offersByRider.get(c.rider.id) || 0 }))
  const minOffers = Math.min(...conOffers.map((c) => c.offers))
  if (minOffers >= MAX_VUELTAS) return await cancelarPorNoCobertura('no_cubierto_vueltas_agotadas')
  const porScore = (a: any, b: any) => a.score - b.score
  const elegido = conOffers.filter((c) => c.offers === minOffers).slice().sort(porScore)[0]
  const vueltaRider = elegido.offers + 1
  const esUltimaVuelta = vueltaRider >= MAX_VUELTAS
  const esPrimeraAsignacion = !(prev && prev.length)
  const responsableId = esPrimeraAsignacion ? elegido.socio.id : ((pedido as any).socio_responsable_id || null)
  const esResponsable = elegido.socio.id === responsableId
  const intento = Math.max((pedido.intento_asignacion || 0), maxPrev) + 1
  const ts = new Date().toISOString()

  const { data: asignacion, error: aErr } = await sb.from('pedido_asignaciones').insert({
    pedido_id: pedido.id,
    rider_account_id: elegido.rider.id,
    socio_id: elegido.socio.id,
    intento,
    distancia_metros: elegido.dist,
    estado: 'esperando_aceptacion',
    vuelta: vueltaRider,
    es_responsable: esResponsable,
  }).select('id').single()
  if (aErr) {
    if ((aErr as any).code === '23505') {
      return json({ ok: true, ya_asignado: true, pedido_id: pedido.id })
    }
    // v56: el guard de BD trg_guard_asignacion_socio_vinculado (23514) significa que el
    // socio se desvinculo en carrera -> terminal limpia en vez de 500 reintentable en bucle.
    if ((aErr as any).code === '23514' || /guard_vinculo/i.test(aErr.message || '')) {
      return await marcarNoRider('sin_socio_vinculado')
    }
    return json({ error: 'asignacion_insert_failed', detail: aErr.message }, 500)
  }

  const updatePedido: Record<string, unknown> = {
    shipday_status: 'created',
    shipday_tracking_url: `https://socio.pidoo.es/seguir/${pedido.codigo}`,
    rider_account_id: elegido.rider.id,
    socio_id: elegido.socio.id,
    intento_asignacion: intento,
    assigned_at: ts,
  }
  if (esPrimeraAsignacion) updatePedido.socio_responsable_id = elegido.socio.id
  const { error: updPedidoErr } = await sb.from('pedidos').update(updatePedido).eq('id', pedido.id)
  if (updPedidoErr) console.error('[dispatch] update pedido fallo', pedido.id, updPedidoErr.message)

  let sufijo = ''
  if (esUltimaVuelta) sufijo = ' · ÚLTIMA VUELTA: acéptalo o se cancela'
  else if (esResponsable) sufijo = ' · eres el responsable del pedido'
  const prefijoTel = esTelefonicoPed ? 'Telefónico (solo envío, sin comisión) · ' : ''
  await enviarPush({
    user_ids: [elegido.socio.user_id],
    user_type: 'socio',
    title: `Nuevo pedido · ${est?.nombre || ''}`,
    body: `${prefijoTel}#${pedido.codigo}${elegido.dist != null ? ` · ${(elegido.dist / 1000).toFixed(1)} km` : ''} — acepta en 2:30${sufijo}`,
    data: { tipo: 'nueva_asignacion', pedido_id: pedido.id, asignacion_id: asignacion?.id, urgente: true, vuelta: vueltaRider, es_responsable: esResponsable, telefonico: esTelefonicoPed, loop_sound: '1', codigo: pedido.codigo },
  })

  return json({ ok: true, pedido_id: pedido.id, rider_account_id: elegido.rider.id, socio_id: elegido.socio.id, intento, vuelta: vueltaRider, es_responsable: esResponsable, ultima_vuelta: esUltimaVuelta, distancia_metros: elegido.dist, carga_previa: cargaPorRider.get(elegido.rider.id) || 0, marketplace_socio: esMarketplaceSocio })
})
