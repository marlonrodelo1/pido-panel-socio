// crear-pedido-telefonico v3 (18-jul-2026) — el RESTAURANTE crea un envío manual
// para un pedido que le entró por TELÉFONO (fuera de la app cliente).
// v3: AUTONOMIA DEL SOCIO — el pre-check de riders online ahora excluye:
//     - vínculos con reparto_activo=false (el socio pausó ese restaurante)
//     - socios con acepta_telefonicos=false (el socio no acepta esta fuente)
//     Alineado con el dispatcher v54 y assign-pedido-restaurante v4.
// v2: el pre-check de riders online exige frescura de GPS (≤12 min), igual que
//     check-socio-availability-now v9 y el dispatcher v53 (evita el "verde" fantasma
//     que dejaba pedidos huérfanos si el socio tenía la app colgada).
//
// Modelo de negocio (decidido por Marlon 11-jul):
//   - Sin productos: solo importe acordado + notas. subtotal = importe de la comida.
//   - metodo_cobro: 'efectivo' (el rider cobra el TOTAL al entregar) o 'pagado_local'
//     (bizum/pago en el local: el rider solo entrega, no cobra nada).
//   - El rider gana SOLO su tarifa de envío (sin % del subtotal) → los cálculos de
//     ganancia excluyen origen_pedido='telefonico' (ganancia.js, RPCs, facturas).
//   - Pidoo cobra comisión FIJA por pedido (configuracion_plataforma.comision_pedido_telefonico_eur,
//     default 1 €) en la liquidación semanal. comision_pidoo_pct_override=0 blinda el % clásico.
//
// Flujo: valida dueño → riders online → calcular_envio (edge desplegada) → upsert
// clientes_telefonicos (memoria por restaurante) → generar_codigo_pedido → INSERT pedidos
// (estado 'preparando': nace auto-aceptado, el timbre trg_notificar_pedido_nuevo solo
// dispara con 'nuevo') → asignación auto (create-shipday-order, service) o socio concreto
// (assign-pedido-restaurante, reenviando el JWT del dueño — requiere JWT de usuario).
//
// Body: { establecimiento_id, telefono, nombre?, direccion, lat, lng, importe_comida,
//         metodo_cobro: 'efectivo'|'pagado_local', notas?, minutos_preparacion?,
//         asignacion?: { modo:'auto' } | { modo:'socio', socio_id } }
// verify_jwt=true (plataforma). Candado adicional en código: dueño del establecimiento,
// admin/superadmin, o service role (tests/automatizaciones).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
function json(b: unknown, s = 200) {
  return new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } })
}

// Normaliza un teléfono español a E.164 (+34XXXXXXXXX). Devuelve null si no es válido.
function normalizarTelefonoES(raw: string): string | null {
  let t = String(raw || '').replace(/[\s\-().]/g, '')
  if (t.startsWith('0034')) t = '+34' + t.slice(4)
  else if (t.startsWith('34') && t.length === 11) t = '+' + t
  else if (/^[6789]\d{8}$/.test(t)) t = '+34' + t
  return /^\+34[6789]\d{8}$/.test(t) ? t : null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
  const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const ANON = Deno.env.get('SUPABASE_ANON_KEY')!
  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

  let body: any = {}
  try { body = await req.json() } catch (_) {}

  // ── Auth: servidor (service role) pasa directo; usuario debe ser dueño o admin ──
  const bearer = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim()
  const esServidor = !!SERVICE_KEY && bearer === SERVICE_KEY
  let usuarioAutenticado: string | null = null
  if (!esServidor) {
    if (!bearer) return json({ error: 'no_autorizado' }, 401)
    const sbUser = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: `Bearer ${bearer}` } }, auth: { persistSession: false } })
    const { data: u } = await sbUser.auth.getUser()
    if (!u?.user) return json({ error: 'no_autorizado' }, 401)
    usuarioAutenticado = u.user.id
  }

  // ── Validaciones de entrada ──
  const establecimiento_id = body?.establecimiento_id
  if (!establecimiento_id) return json({ error: 'validacion', campo: 'establecimiento_id' }, 400)

  const telefono = normalizarTelefonoES(body?.telefono)
  if (!telefono) return json({ error: 'validacion', campo: 'telefono', detalle: 'Teléfono español no válido (9 dígitos, empieza por 6/7/8/9)' }, 400)

  const direccion = String(body?.direccion || '').trim()
  const lat = Number(body?.lat), lng = Number(body?.lng)
  if (!direccion || !Number.isFinite(lat) || !Number.isFinite(lng)) return json({ error: 'validacion', campo: 'direccion' }, 400)

  const importe = Number(String(body?.importe_comida ?? '').replace(',', '.'))
  if (!Number.isFinite(importe) || importe < 0.5 || importe > 500) return json({ error: 'validacion', campo: 'importe_comida', detalle: 'Entre 0,50 € y 500 €' }, 400)

  const metodo_cobro = body?.metodo_cobro
  if (metodo_cobro !== 'efectivo' && metodo_cobro !== 'pagado_local') return json({ error: 'validacion', campo: 'metodo_cobro' }, 400)

  let minutos = Number(body?.minutos_preparacion)
  if (!Number.isFinite(minutos)) minutos = 20
  minutos = Math.min(120, Math.max(5, Math.round(minutos)))

  const nombre = String(body?.nombre || '').trim() || null
  const notas = String(body?.notas || '').trim() || null
  const asignacion = body?.asignacion?.modo === 'socio'
    ? { modo: 'socio' as const, socio_id: body.asignacion.socio_id }
    : { modo: 'auto' as const }
  if (asignacion.modo === 'socio' && !asignacion.socio_id) return json({ error: 'validacion', campo: 'asignacion.socio_id' }, 400)

  // ── Establecimiento + ownership ──
  const { data: est, error: estErr } = await sb.from('establecimientos')
    .select('id, nombre, user_id, latitud, longitud')
    .eq('id', establecimiento_id).maybeSingle()
  if (estErr || !est) return json({ error: 'establecimiento_no_encontrado' }, 404)

  if (usuarioAutenticado) {
    if (est.user_id !== usuarioAutenticado) {
      const { data: rolRow } = await sb.from('usuarios').select('rol').eq('id', usuarioAutenticado).maybeSingle()
      if (rolRow?.rol !== 'admin' && rolRow?.rol !== 'superadmin') return json({ error: 'forbidden' }, 403)
    }
  }

  // ── Riders online — MISMO criterio que check-socio-availability-now v9 y el
  //    dispatcher create-shipday-order v53: activo + en_servicio + señal GPS fresca
  //    (last_location_at ≤ 12 min). Sin la frescura, un socio con la app cerrada/colgada
  //    daría "verde" aquí pero el dispatcher (gate duro de frescura) no podría asignarlo,
  //    dejando el pedido huérfano. v2 (12-jul): añadida la frescura para alinear los 3.
  const MAX_LOC_AGE_MS = 12 * 60 * 1000
  const ahoraLoc = Date.now()
  const esFresco = (s: any) => {
    const ts = s?.last_location_at ? new Date(s.last_location_at).getTime() : NaN
    return Number.isFinite(ts) && (ahoraLoc - ts) <= MAX_LOC_AGE_MS
  }
  const { data: vinc } = await sb.from('socio_establecimiento')
    .select('socio_id, reparto_activo, socios!inner(id, en_servicio, activo, last_location_at, acepta_telefonicos)')
    .eq('establecimiento_id', establecimiento_id).eq('estado', 'activa')
  const online = (vinc || [])
    .filter((v: any) => v.reparto_activo !== false)
    .map((v: any) => v.socios)
    .filter((s: any) => s && s.activo && s.en_servicio && esFresco(s) && s.acepta_telefonicos !== false)
  if (online.length === 0) return json({ error: 'sin_riders_online', online_count: 0 }, 409)
  if (asignacion.modo === 'socio' && !online.some((s: any) => s.id === asignacion.socio_id)) {
    return json({ error: 'socio_offline', online_count: online.length }, 409)
  }

  // ── Coste de envío: SIEMPRE la edge desplegada (fuente única de tarifas) ──
  let envio = 0, distancia_km: number | null = null
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 10000)
    const res = await fetch(`${SUPABASE_URL}/functions/v1/calcular_envio`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SERVICE_KEY}` },
      body: JSON.stringify({ canal: 'pido', establecimiento_id, lat_cliente: lat, lng_cliente: lng }),
      signal: ctrl.signal,
    })
    clearTimeout(t)
    const d = await res.json().catch(() => ({}))
    if (d?.fuera_de_radio) return json({ error: 'fuera_de_radio', distancia_km: d.distancia_km, radio_km: d.radio_km }, 400)
    if (d?.delivery_disabled) return json({ error: 'delivery_disabled' }, 400)
    if (!res.ok || typeof d?.envio !== 'number') return json({ error: 'calcular_envio_failed', detail: d?.error || res.status }, 502)
    envio = d.envio
    distancia_km = d.distancia_km ?? null
  } catch (_) {
    return json({ error: 'calcular_envio_timeout' }, 502)
  }

  // ── Memoria de cliente telefónico (por restaurante) ──
  try {
    const { data: cliPrev } = await sb.from('clientes_telefonicos')
      .select('id, pedidos_count')
      .eq('establecimiento_id', establecimiento_id).eq('telefono_normalizado', telefono).maybeSingle()
    const ts = new Date().toISOString()
    const datos = { telefono_raw: String(body?.telefono || ''), nombre, direccion, lat, lng, last_pedido_at: ts, updated_at: ts }
    if (cliPrev) {
      await sb.from('clientes_telefonicos').update({ ...datos, pedidos_count: (cliPrev.pedidos_count || 0) + 1 }).eq('id', cliPrev.id)
    } else {
      const { error: insErr } = await sb.from('clientes_telefonicos')
        .insert({ establecimiento_id, telefono_normalizado: telefono, ...datos, pedidos_count: 1 })
      if (insErr && insErr.code === '23505') { // carrera con otro insert: convertir en update
        await sb.from('clientes_telefonicos').update(datos)
          .eq('establecimiento_id', establecimiento_id).eq('telefono_normalizado', telefono)
      }
    }
  } catch (_) { /* la memoria de clientes nunca bloquea el pedido */ }

  // ── Código de pedido ──
  let codigo: string | null = null
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/generar_codigo_pedido`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SERVICE_KEY}` },
      body: JSON.stringify({}),
    })
    const d = await res.json().catch(() => ({}))
    if (res.ok && d?.codigo) codigo = d.codigo
  } catch (_) {}
  if (!codigo) return json({ error: 'generar_codigo_failed' }, 502)

  // ── INSERT del pedido (service role; total lo recalcula trg_enforce_pedido_total) ──
  const now = new Date().toISOString()
  const { data: pedido, error: insPedErr } = await sb.from('pedidos').insert({
    codigo,
    establecimiento_id,
    usuario_id: null,
    canal: 'pido',
    modo_entrega: 'delivery',
    origen_pedido: 'telefonico',
    estado: 'preparando',            // nace aceptado por el propio restaurante (sin timbre)
    metodo_pago: metodo_cobro,       // 'efectivo' | 'pagado_local'
    subtotal: importe,
    coste_envio: envio,
    propina: 0,
    guest_nombre: nombre,
    guest_telefono: telefono,
    cliente_telefono: telefono,
    direccion_entrega: direccion,
    lat_entrega: lat,
    lng_entrega: lng,
    notas,
    minutos_preparacion: minutos,
    aceptado_at: now,
    comision_pidoo_pct_override: 0,  // Pidoo cobra tarifa fija, no % (ver liquidacion-semanal)
  }).select('id, codigo, tracking_token, subtotal, coste_envio, total').single()
  if (insPedErr || !pedido) return json({ error: 'pedido_insert_failed', detail: insPedErr?.message }, 500)

  // ── Asignación de repartidor ──
  let resultadoAsignacion: any = { ok: false, reason: 'no_intentada' }
  try {
    if (asignacion.modo === 'socio') {
      // Reenvía el JWT del dueño: assign-pedido-restaurante re-valida ownership.
      const res = await fetch(`${SUPABASE_URL}/functions/v1/assign-pedido-restaurante`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}` },
        body: JSON.stringify({ pedido_id: pedido.id, socio_id: asignacion.socio_id, motivo: 'Pedido telefónico — socio elegido por el restaurante' }),
      })
      const d = await res.json().catch(() => ({}))
      resultadoAsignacion = res.ok && d?.ok
        ? { ok: true, socio_id: d.socio_id, rider_account_id: d.rider_account_id, distancia_metros: d.distancia_metros }
        : { ok: false, reason: d?.reason || d?.error || `http_${res.status}` }
    } else {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/create-shipday-order`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SERVICE_KEY}` },
        body: JSON.stringify({ pedido_id: pedido.id }),
      })
      const d = await res.json().catch(() => ({}))
      resultadoAsignacion = res.ok && (d?.ok || d?.success)
        ? { ok: true, socio_id: d.socio_id ?? null, rider_account_id: d.rider_account_id ?? null, distancia_metros: d.distancia_metros ?? null }
        : { ok: false, reason: d?.reason || d?.error || `http_${res.status}` }
    }
  } catch (_) {
    resultadoAsignacion = { ok: false, reason: 'asignacion_timeout' }
  }
  // Un fallo de asignación NO revierte el pedido: el restaurante puede reasignar desde su panel.

  return json({
    ok: true,
    pedido: {
      id: pedido.id,
      codigo: pedido.codigo,
      estado: 'preparando',
      subtotal: pedido.subtotal,
      coste_envio: pedido.coste_envio,
      total: pedido.total,
      distancia_km,
    },
    asignacion: resultadoAsignacion,
    online_count: online.length,
    tracking_url: `https://socio.pidoo.es/seguir/${pedido.codigo}?t=${pedido.tracking_token}`,
  })
})
