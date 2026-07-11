// create-shipday-order — DISPATCHER PROPIO (sin Shipday) desde 20-jun-2026.
// Asigna el pedido delivery al mejor rider (socio) ONLINE del establecimiento.
// v53 (11-jul-2026): PEDIDOS TELEFONICOS (origen_pedido='telefonico', creados por el
//   restaurante via crear-pedido-telefonico). En la terminal de no-cobertura se cancela
//   igual PERO SIN cargo del 80% al responsable: la comida y el cobro ya son del
//   restaurante (metodo pagado_local/efectivo propio), cargar al socio sobre-compensaria.
//   Aviso al restaurante adaptado ("vuelve a crearlo o entregalo por tus medios").
// v52 (10-jul-2026, Fase 2): al agotar las 2 vueltas se CANCELA el pedido de inmediato
//   (cancelarPorNoCobertura) y se crea un cargo del 80% del subtotal al socio responsable
//   (R1) en cargos_socio. El reembolso al cliente (tarjeta) lo emite la red
//   reconciliar-reembolsos. Antes solo se marcaba no_rider y cancelaba el rescatador ~10 min.
// v51 (10-jul-2026): ROUND-ROBIN DE 2 VUELTAS + RESPONSABLE (decision de Marlon).
//   Antes: "no reofrecer a quien rechazo; tope 3 intentos". Ahora: cada rider elegible
//   puede recibir el pedido hasta 2 veces (2 vueltas completas por la lista ordenada). Se
//   ofrece SIEMPRE al que menos veces lo ha recibido (para completar la vuelta en curso),
//   desempatando por score (mas cercano). Un rider que rechazo/dejo expirar en la 1a vuelta
//   VUELVE a recibirlo en la 2a. El PRIMER asignado (R1) queda fijado en
//   pedidos.socio_responsable_id y es el responsable del coste si el pedido acaba cancelado
//   por no-cobertura (el cobro en si es Fase 2). Cada asignacion guarda su 'vuelta' (1|2) y
//   'es_responsable' para los avisos de la app. Terminal cuando todos los elegibles llegan a
//   2 ofertas -> se cancela y se cobra al responsable. Ventana de aceptacion 150 s (2:30).
// v50 (5-jul-2026): FRESCURA DE GPS AHORA ES FILTRO DURO. Un socio sin senal reciente
//   (app cerrada/colgada) NO es asignable aunque siga en_servicio. Umbral MAX_LOC_AGE_MIN 12 min.
// v48-v49: CANDADO DE AUTENTICACION (cron-secret / service-role / JWT dueno o admin).
//   verify_jwt sigue false a nivel plataforma; el candado vive en el codigo.
// v47: FILTRO DURO por GPS y radio (15 km); score = dist + activos*1500; gating socios.activo.
// v44: IDEMPOTENCIA anti-duplicado. v42: REGLA 1 marketplace del socio.
// Body: { pedido_id }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Env numerico blindado: secret vacio/basura/<=0 cae al valor por defecto.
function envNum(name: string, fallback: number): number {
  const n = Number(Deno.env.get(name))
  return Number.isFinite(n) && n > 0 ? n : fallback
}
const MAX_LOC_AGE_MS = envNum('DISPATCH_MAX_LOC_AGE_MIN', 12) * 60 * 1000
const MAX_RADIUS_KM = envNum('DISPATCH_MAX_RADIUS_KM', 15)
const CARGA_PESO_METROS = envNum('DISPATCH_CARGA_PESO_METROS', 1500)
// v51: numero de vueltas completas por la lista de riders antes de cancelar.
const MAX_VUELTAS = envNum('DISPATCH_MAX_VUELTAS', 2)

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

  // v48: CANDADO. Servidor (cron-secret o service role) pasa directo; cualquier otro
  // necesita un JWT de usuario valido (la titularidad se comprueba tras cargar el pedido).
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

  // 1. Pedido + establecimiento (con GPS y dueno para el candado)
  const { data: pedido, error: pErr } = await sb.from('pedidos')
    .select('id, codigo, estado, modo_entrega, establecimiento_id, intento_asignacion, socio_id, socio_responsable_id, subtotal, origen_pedido, usuario_id, metodo_pago, establecimientos(id, nombre, latitud, longitud, user_id)')
    .eq('id', body.pedido_id).maybeSingle()
  if (pErr || !pedido) return json({ error: 'pedido_not_found', detail: pErr?.message }, 404)
  const est: any = (pedido as any).establecimientos

  // v48: un usuario autenticado solo puede despachar pedidos de SU establecimiento,
  // salvo rol admin/superadmin.
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
    // v47: condicional — SOLO se marca no_rider desde NULL o 'created'. Nunca pisa
    // 'accepted'/'picked_up'/etc y no repite avisos si ya estaba en no_rider.
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

  // v52 (Fase 2): terminal de las 2 vueltas. Cancela el pedido YA y crea el cargo del 80%
  // del subtotal al socio responsable (R1). El reembolso al cliente (tarjeta) lo emite la
  // red reconciliar-reembolsos; el aviso al cliente lo dispara el trigger de estado -> 'cancelado'.
  // v53: los pedidos TELEFONICOS se cancelan igual pero SIN cargo al responsable (la comida
  // y el cobro ya son del restaurante; el cargo sobre-compensaria) y con aviso adaptado.
  async function cancelarPorNoCobertura() {
    const ahora = new Date().toISOString()
    const esTelefonico = (pedido as any).origen_pedido === 'telefonico'
    // Cancelacion CONDICIONAL: si el pedido avanzo en carrera (aceptado/recogido/...), no tocar.
    const { data: cancelado, error: cancErr } = await sb.from('pedidos')
      .update({ estado: 'cancelado', cancelado_at: ahora, motivo_cancelacion: 'no_cubierto_2_vueltas', shipday_status: 'no_rider' })
      .eq('id', pedido.id)
      .in('estado', ['nuevo', 'preparando', 'listo'])
      .select('id')
    if (cancErr) {
      console.error('[dispatch] cancelarPorNoCobertura update fallo', pedido.id, cancErr.message)
      return json({ ok: false, reason: 'agotadas_2_vueltas', error: 'cancel_update_failed', detail: cancErr.message }, 500)
    }
    if (!cancelado || cancelado.length === 0) {
      return json({ ok: false, reason: 'ya_resuelto_en_carrera' })
    }
    // Cargo al responsable (R1) = 80% del subtotal. Idempotente (indice unico por pedido).
    // v53: NUNCA en pedidos telefonicos.
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
        concepto: `Pedido ${pedido.codigo} cancelado sin repartidor (2 vueltas). Compensacion al restaurante = 80% del subtotal.`,
        estado: 'pendiente',
      })
      if (cargoErr) {
        if ((cargoErr as any).code !== '23505') console.error('[dispatch] cargo insert fallo', cargoErr.message)
      } else { cargoCreado = true }
    }
    await enviarPush({
      user_type: 'superadmin',
      title: 'Pedido cancelado sin rider',
      body: `#${pedido.codigo}: nadie lo acepto en 2 vueltas. Cancelado${cargoCreado ? ` · cargo ${monto.toFixed(2)} EUR al responsable` : (esTelefonico ? ' · telefonico, sin cargo' : '')}.`,
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
    return json({ ok: false, reason: 'cancelado_no_cubierto', responsable_socio_id: responsable, cargo: cargoCreado ? monto : 0 })
  }

  // 1b. Historial de asignaciones + IDEMPOTENCIA. Si hay una asignacion activa (esperando o
  //     aceptada), se corta aqui sin disparar ningun aviso.
  const { data: prev, error: prevErr } = await sb.from('pedido_asignaciones').select('id, rider_account_id, intento, estado').eq('pedido_id', pedido.id)
  if (prevErr) return json({ error: 'historial_query_failed', detail: prevErr.message }, 500)
  const maxPrev = (prev || []).reduce((m: number, p: any) => Math.max(m, p.intento || 0), 0)
  const yaActiva = (prev || []).find((p: any) => p.estado === 'esperando_aceptacion' || p.estado === 'aceptado')
  if (yaActiva) {
    return json({ ok: true, ya_asignado: true, pedido_id: pedido.id, asignacion_id: yaActiva.id })
  }

  // 1c. Establecimiento sin GPS -> motivo propio (alta mal geocodificada).
  if (est?.latitud == null || est?.longitud == null) {
    return await marcarNoRider('establecimiento_sin_gps')
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

  // 3. Riders de esos socios.
  const { data: riders, error: rErr } = await sb.from('rider_accounts')
    .select('id, nombre, socio_id, activa, estado, socios!inner(id, user_id, nombre, en_servicio, activo, marketplace_activo, latitud_actual, longitud_actual, last_location_at)')
    .in('socio_id', socioIds).eq('activa', true).eq('estado', 'activa')
  if (rErr) return json({ error: 'riders_query_failed', detail: rErr.message }, 500)

  // 5. Candidatos ONLINE + distancia Haversine. Gating por socios.activo. marketplace_activo
  //    NO se usa a proposito (pausar la tienda publica no debe cortar el reparto de pidoo.es).
  const base = (riders || [])
    .filter((r: any) => r.socios?.en_servicio === true && r.socios?.activo !== false)
    .map((r: any) => {
      const s = r.socios
      const dist = (s?.latitud_actual != null && s?.longitud_actual != null)
        ? haversine(est.latitud, est.longitud, s.latitud_actual, s.longitud_actual)
        : null
      return { rider: r, socio: s, dist, score: 0 }
    })
  if (!base.length) return await marcarNoRider(esMarketplaceSocio ? 'socio_marketplace_offline' : 'no_rider')

  // v50: FRESCURA como GATE DURO.
  const ahoraMs = Date.now()
  const esFresco = (c: any) => {
    const ts = c.socio?.last_location_at ? new Date(c.socio.last_location_at).getTime() : NaN
    return Number.isFinite(ts) && (ahoraMs - ts) <= MAX_LOC_AGE_MS
  }

  // 5b. FILTRO DURO: sin coordenadas, fuera de radio, o SIN SENAL RECIENTE => NO asignable.
  const enRadio = base.filter((c: any) => c.dist != null && c.dist <= MAX_RADIUS_KM * 1000)
  if (!enRadio.length) return await marcarNoRider('sin_rider_en_radio')
  const elegibles = enRadio.filter((c: any) => esFresco(c))
  if (!elegibles.length) return await marcarNoRider('sin_rider_fresco')

  // 5c. Carga activa por rider: multi-pedido permitido pero penalizado en el score.
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

  // 5d. ROUND-ROBIN DE 2 VUELTAS (v51). Cada rider elegible puede recibir el pedido hasta
  //     MAX_VUELTAS veces; se ofrece SIEMPRE al que menos veces lo ha recibido (para completar
  //     la vuelta en curso), desempatando por score (mas cercano). Un rider que rechazo/dejo
  //     expirar en la 1a vuelta VUELVE a recibirlo en la 2a. Cuando todos los elegibles llegan
  //     a MAX_VUELTAS ofertas -> terminal (se cancela y R1 respondera del coste).
  const offersByRider = new Map<string, number>()
  for (const p of (prev || []) as any[]) {
    offersByRider.set(p.rider_account_id, (offersByRider.get(p.rider_account_id) || 0) + 1)
  }
  const conOffers = (elegibles as any[]).map((c) => ({ ...c, offers: offersByRider.get(c.rider.id) || 0 }))
  const minOffers = Math.min(...conOffers.map((c) => c.offers))
  if (minOffers >= MAX_VUELTAS) return await cancelarPorNoCobertura()
  const porScore = (a: any, b: any) => a.score - b.score
  const elegido = conOffers.filter((c) => c.offers === minOffers).slice().sort(porScore)[0]
  const vueltaRider = elegido.offers + 1               // 1 = primera vuelta, 2 = ultima
  const esUltimaVuelta = vueltaRider >= MAX_VUELTAS
  const esPrimeraAsignacion = !(prev && prev.length)
  const responsableId = esPrimeraAsignacion ? elegido.socio.id : ((pedido as any).socio_responsable_id || null)
  const esResponsable = elegido.socio.id === responsableId
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
    vuelta: vueltaRider,
    es_responsable: esResponsable,
  }).select('id').single()
  if (aErr) {
    if ((aErr as any).code === '23505') {
      return json({ ok: true, ya_asignado: true, pedido_id: pedido.id })
    }
    return json({ error: 'asignacion_insert_failed', detail: aErr.message }, 500)
  }

  // 7. Update pedido. socio_responsable_id se fija SOLO en la primera asignacion (R1).
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

  // 8. Push inmediato al rider (v51: 150 s + aviso de responsable / ultima vuelta)
  let sufijo = ''
  if (esUltimaVuelta) sufijo = ' · ÚLTIMA VUELTA: acéptalo o se cancela'
  else if (esResponsable) sufijo = ' · eres el responsable del pedido'
  await enviarPush({
    user_ids: [elegido.socio.user_id],
    title: `Nuevo pedido · ${est?.nombre || ''}`,
    body: `#${pedido.codigo}${elegido.dist != null ? ` · ${(elegido.dist / 1000).toFixed(1)} km` : ''} — acepta en 2:30${sufijo}`,
    data: { tipo: 'nueva_asignacion', pedido_id: pedido.id, asignacion_id: asignacion?.id, urgente: true, vuelta: vueltaRider, es_responsable: esResponsable },
  })

  return json({ ok: true, pedido_id: pedido.id, rider_account_id: elegido.rider.id, socio_id: elegido.socio.id, intento, vuelta: vueltaRider, es_responsable: esResponsable, ultima_vuelta: esUltimaVuelta, distancia_metros: elegido.dist, carga_previa: cargaPorRider.get(elegido.rider.id) || 0, marketplace_socio: esMarketplaceSocio })
})
