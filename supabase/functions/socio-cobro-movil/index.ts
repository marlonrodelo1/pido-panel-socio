// socio-cobro-movil v2 (28 sep 2026) — cobrar un pedido con el móvil del socio (Tap to Pay de Stripe).
// v2: los errores de negocio van con 409, nunca 403 (la app toma 401/403 por sesión caducada).
//
// QUE ES: en la puerta, el socio pulsa «Cobrar con el móvil» y el cliente acerca la tarjeta (o
// Apple Pay / Google Pay) a SU móvil. Stripe Terminal, lector «Tap to Pay». El dinero entra en
// la cuenta de Stripe de Pidoo, igual que un pago con tarjeta de la app.
//
// QUE PASA CON EL DINERO: al confirmarse, la RPC registrar_cobro_movil pasa el pedido a
// metodo_pago='tarjeta' con su stripe_payment_id. Con eso:
//   - calcular_liquidacion_restaurante (el lunes) lo cuenta como dinero que Pidoo le debe al
//     restaurante, sin tocar la liquidación;
//   - si el pedido acabara cancelado o fallido, reconciliar-reembolsos lo devuelve solo;
//   - la ganancia del socio no depende del método de pago: no cambia.
//
// ACCIONES (POST, JWT del socio salvo diagnostico):
//   config      -> ¿puede este socio cobrar con el móvil? + formas de pago cobrables + Location.
//   token       -> connection token de Stripe Terminal (lo pide el SDK al conectar el lector).
//   crear       -> { pedido_id, plataforma? } prepara (o reutiliza) el PaymentIntent card_present.
//                  EL IMPORTE LO PONE EL SERVIDOR (total del pedido), nunca el móvil.
//   confirmar   -> { pedido_id, payment_intent_id } pregunta a Stripe y, si está cobrado, registra.
//   cancelar    -> { pedido_id, payment_intent_id } anula un cobro a medias (sin dinero movido).
//   diagnostico -> { diag_token } prueba de servidor sin sesión de socio: Location + connection
//                  token + PaymentIntent de 0,50 € creado y anulado al momento. Solo con el token
//                  de configuracion_plataforma.cobro_movil_diag_token (se borra tras usarlo).
//
// RED DE SEGURIDAD: si la app muere justo después de cobrar, stripe-webhook-pagos recibe el
// payment_intent.succeeded (metadata.origen='cobro_movil_socio') y llama a la misma RPC, que es
// idempotente. Y si el socio vuelve a pulsar «Cobrar», `crear` ve que ya estaba cobrado y lo
// registra en vez de cobrar dos veces.
//
// INTERRUPTOR (sin compilar): configuracion_plataforma.cobro_movil_modo = off | pruebas | on.
// En «pruebas» solo lo ven los socios de cobro_movil_socios_prueba.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const URL = Deno.env.get('SUPABASE_URL')!
const SVC = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!
const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY') || ''

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } })
const admin = () => createClient(URL, SVC, { auth: { persistSession: false } })

const ORIGEN = 'cobro_movil_socio'
// Se cobra en la puerta: con el pedido ya recogido.
const ESTADOS_COBRABLES = ['recogido', 'en_camino']
// Mínimo que admite Stripe en EUR.
const MINIMO_CENT = 50
// Estados de un PaymentIntent que todavía no han movido dinero y se pueden anular.
const PI_ANULABLES = ['requires_payment_method', 'requires_confirmation', 'requires_action']

// ── Stripe (API REST con fetch, como crear_pago_stripe) ─────────────────────────────────────
type StripeResp = { ok: boolean; status: number; data: any }
async function stripe(method: 'GET' | 'POST', path: string, params?: Record<string, string>, idem?: string): Promise<StripeResp> {
  const headers: Record<string, string> = { Authorization: `Basic ${btoa(`${STRIPE_SECRET_KEY}:`)}` }
  let body: string | undefined
  if (method === 'POST') {
    headers['Content-Type'] = 'application/x-www-form-urlencoded'
    body = new URLSearchParams(params || {}).toString()
    if (idem) headers['Idempotency-Key'] = idem
  }
  const r = await fetch(`https://api.stripe.com/v1${path}`, { method, headers, body })
  const data = await r.json().catch(() => ({}))
  return { ok: r.ok, status: r.status, data }
}
const stripeError = (r: StripeResp) => ({
  code: r.data?.error?.code || null,
  type: r.data?.error?.type || null,
  message: r.data?.error?.message || `stripe_http_${r.status}`,
})
const errorDePago = (pi: any) => {
  const e = pi?.last_payment_error
  return e ? { code: e.code || null, decline_code: e.decline_code || null, message: e.message || null } : null
}

// ── Configuración ───────────────────────────────────────────────────────────────────────────
type Cfg = { modo: string; sociosPrueba: string[]; metodos: string[]; locationId: string; locationDireccion: string; diagToken: string }
async function leerConfig(sb: ReturnType<typeof admin>): Promise<Cfg> {
  const { data } = await sb.from('configuracion_plataforma').select('clave, valor').like('clave', 'cobro_movil_%')
  const c: Record<string, string> = {}
  for (const row of data || []) c[row.clave] = row.valor
  const lista = (s: string | undefined) => (s || '').split(',').map((x) => x.trim()).filter(Boolean)
  return {
    modo: (c.cobro_movil_modo || 'off').trim(),
    sociosPrueba: lista(c.cobro_movil_socios_prueba),
    metodos: lista(c.cobro_movil_metodos || 'datafono'),
    locationId: (c.cobro_movil_location_id || '').trim(),
    locationDireccion: c.cobro_movil_location_direccion || '',
    diagToken: (c.cobro_movil_diag_token || '').trim(),
  }
}
function socioHabilitado(cfg: Cfg, socioId: string) {
  if (cfg.modo === 'on') return true
  if (cfg.modo === 'pruebas') return cfg.sociosPrueba.includes(socioId)
  return false
}

// La Location de Stripe Terminal es obligatoria para conectar el lector. Una sola para todo
// Pidoo: se crea la primera vez y su id se guarda en configuracion_plataforma.
async function asegurarLocation(sb: ReturnType<typeof admin>, cfg: Cfg): Promise<{ id: string | null; error?: unknown }> {
  if (cfg.locationId) return { id: cfg.locationId }
  let dir: Record<string, string> = {}
  try { dir = JSON.parse(cfg.locationDireccion || '{}') } catch (_) { return { id: null, error: 'direccion_location_invalida' } }
  const params: Record<string, string> = { display_name: 'Pidoo' }
  for (const k of ['line1', 'line2', 'city', 'state', 'postal_code', 'country']) if (dir[k]) params[`address[${k}]`] = dir[k]
  const r = await stripe('POST', '/terminal/locations', params, 'pidoo-cobro-movil-location-v1')
  if (!r.ok || !r.data?.id) return { id: null, error: stripeError(r) }
  // Solo se escribe si sigue vacía: dos primeras llamadas a la vez no se pisan (y la
  // Idempotency-Key hace que Stripe les devuelva la misma Location a las dos).
  await sb.from('configuracion_plataforma')
    .update({ valor: r.data.id, updated_at: new Date().toISOString() })
    .eq('clave', 'cobro_movil_location_id').eq('valor', '')
  cfg.locationId = r.data.id
  return { id: r.data.id }
}

// ── Socio ───────────────────────────────────────────────────────────────────────────────────
async function socioFromAuth(req: Request) {
  const t = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
  if (!t) return null
  const sb = createClient(URL, ANON, { global: { headers: { Authorization: `Bearer ${t}` } }, auth: { persistSession: false } })
  const { data } = await sb.auth.getUser()
  if (!data?.user) return null
  const { data: socio } = await admin().from('socios').select('id, activo').eq('user_id', data.user.id).maybeSingle()
  return socio ? { socioId: socio.id as string, activo: socio.activo !== false } : null
}

// El pedido tiene que ser de este socio (asignación aceptada), estar en la puerta y deberse.
async function validarPedido(sb: ReturnType<typeof admin>, socioId: string, pedidoId: string, cfg: Cfg) {
  const { data: ped } = await sb.from('pedidos')
    .select('id, codigo, estado, metodo_pago, total, modo_entrega, establecimiento_id, stripe_payment_id')
    .eq('id', pedidoId).maybeSingle()
  if (!ped) return { ok: false as const, status: 404, body: { error: 'pedido_no_encontrado' } }
  const { data: asig } = await sb.from('pedido_asignaciones')
    .select('id, estado')
    .eq('pedido_id', pedidoId).eq('socio_id', socioId)
    .order('created_at', { ascending: false }).limit(1).maybeSingle()
  // 409 y no 403: la app (riderApi.callEdgeAuthed) toma cualquier 401/403 por sesión
  // caducada y desloguea al socio. Los errores de negocio van siempre con 409.
  if (!asig || asig.estado !== 'aceptado') return { ok: false as const, status: 409, body: { error: 'pedido_no_asignado' } }
  if (ped.metodo_pago === 'tarjeta' || ped.metodo_pago === 'pagado_local' || ped.stripe_payment_id) {
    return { ok: false as const, status: 409, body: { error: 'ya_pagado', metodo_pago: ped.metodo_pago } }
  }
  if (!cfg.metodos.includes(ped.metodo_pago)) return { ok: false as const, status: 409, body: { error: 'metodo_no_cobrable', metodo_pago: ped.metodo_pago } }
  if (!ESTADOS_COBRABLES.includes(ped.estado)) return { ok: false as const, status: 409, body: { error: 'estado_no_cobrable', estado: ped.estado } }
  return { ok: true as const, ped }
}

type Registro = { ok: boolean; already?: boolean; error?: string; revisar?: boolean; message?: string }
async function registrar(sb: ReturnType<typeof admin>, pedidoId: string, pi: any, fuente: 'app' | 'webhook'): Promise<Registro> {
  const { data, error } = await sb.rpc('registrar_cobro_movil', {
    p_pedido_id: pedidoId,
    p_payment_intent_id: pi.id,
    p_importe_cent: Number(pi.amount_received ?? pi.amount ?? 0),
    p_fuente: fuente,
  })
  if (error) return { ok: false, error: 'registro_fallido', message: error.message }
  return data as Registro
}

// ── Acciones ────────────────────────────────────────────────────────────────────────────────
async function accionCrear(sb: ReturnType<typeof admin>, cfg: Cfg, socioId: string, b: any) {
  const pedidoId = String(b?.pedido_id || '')
  if (!pedidoId) return json({ error: 'pedido_id_requerido' }, 400)
  const plataforma = typeof b?.plataforma === 'string' ? b.plataforma.slice(0, 20) : null

  const v = await validarPedido(sb, socioId, pedidoId, cfg)
  if (!v.ok) return json(v.body, v.status)
  const ped = v.ped
  const importeCent = Math.round((Number(ped.total) || 0) * 100)
  if (importeCent < MINIMO_CENT) return json({ error: 'importe_minimo', importe_cent: importeCent }, 409)

  const loc = await asegurarLocation(sb, cfg)
  if (!loc.id) return json({ error: 'location_no_disponible', detalle: loc.error }, 502)

  // ¿Hay un cobro a medias de este pedido? Si sigue esperando tarjeta y el importe no ha
  // cambiado, se reutiliza. Si ya se cobró (la app murió antes de confirmar), se registra.
  const { data: previos } = await sb.from('pedido_cobros_movil')
    .select('id, payment_intent_id, estado')
    .eq('pedido_id', pedidoId)
    .order('created_at', { ascending: false })
  for (const c of (previos || []).filter((x) => x.estado === 'creado')) {
    const r = await stripe('GET', `/payment_intents/${c.payment_intent_id}`)
    if (!r.ok) return json({ error: 'stripe_no_responde', detalle: stripeError(r) }, 502)
    const pi = r.data
    if (pi.status === 'succeeded') {
      const reg = await registrar(sb, pedidoId, pi, 'app')
      return json({ ok: true, ya_cobrado: true, importe_cent: pi.amount_received, registro: reg })
    }
    if (pi.status === 'processing') return json({ error: 'cobro_en_curso', payment_intent_id: pi.id }, 409)
    if (PI_ANULABLES.includes(pi.status) && pi.amount === importeCent) {
      return json({ ok: true, client_secret: pi.client_secret, payment_intent_id: pi.id, importe_cent: importeCent, codigo: ped.codigo, location_id: loc.id })
    }
    // Importe distinto (pedido editado) o PaymentIntent muerto: se anula y se hace uno nuevo.
    if (PI_ANULABLES.includes(pi.status)) {
      const an = await stripe('POST', `/payment_intents/${pi.id}/cancel`, {}, `cobro-movil-anular-${pi.id}`)
      if (!an.ok) return json({ error: 'no_se_pudo_anular_cobro_previo', detalle: stripeError(an) }, 502)
    }
    await sb.from('pedido_cobros_movil').update({ estado: 'cancelado', updated_at: new Date().toISOString() }).eq('id', c.id)
  }

  const { data: est } = await sb.from('establecimientos').select('nombre').eq('id', ped.establecimiento_id).maybeSingle()
  const intento = (previos || []).length
  const r = await stripe('POST', '/payment_intents', {
    amount: String(importeCent),
    currency: 'eur',
    'payment_method_types[]': 'card_present',
    capture_method: 'automatic',
    description: `Pidoo ${ped.codigo}${est?.nombre ? ` · ${est.nombre}` : ''}`,
    'metadata[origen]': ORIGEN,
    'metadata[pedido_id]': ped.id,
    'metadata[pedido_codigo]': ped.codigo,
    'metadata[establecimiento_id]': ped.establecimiento_id,
    'metadata[socio_id]': socioId,
    'metadata[metodo_pago_pedido]': ped.metodo_pago,
  }, `cobro-movil-${ped.id}-${importeCent}-${intento}`)
  if (!r.ok || !r.data?.id) return json({ error: 'no_se_pudo_preparar_cobro', detalle: stripeError(r) }, 502)
  const pi = r.data

  const { error: insErr } = await sb.from('pedido_cobros_movil').insert({
    pedido_id: ped.id,
    socio_id: socioId,
    establecimiento_id: ped.establecimiento_id,
    payment_intent_id: pi.id,
    importe: importeCent / 100,
    estado: 'creado',
    metodo_pago_anterior: ped.metodo_pago,
    plataforma,
  })
  // 23505 = la misma Idempotency-Key devolvió el mismo PaymentIntent a una llamada doble.
  if (insErr && insErr.code !== '23505') return json({ error: 'no_se_pudo_apuntar_cobro', message: insErr.message }, 500)

  return json({ ok: true, client_secret: pi.client_secret, payment_intent_id: pi.id, importe_cent: importeCent, codigo: ped.codigo, location_id: loc.id })
}

async function cobroDelSocio(sb: ReturnType<typeof admin>, socioId: string, b: any) {
  const pedidoId = String(b?.pedido_id || '')
  const piId = String(b?.payment_intent_id || '')
  if (!pedidoId || !piId.startsWith('pi_')) return { error: json({ error: 'pedido_id_y_payment_intent_id_requeridos' }, 400) }
  const { data: cobro } = await sb.from('pedido_cobros_movil')
    .select('id, pedido_id, socio_id, estado')
    .eq('payment_intent_id', piId).maybeSingle()
  if (!cobro || cobro.pedido_id !== pedidoId || cobro.socio_id !== socioId) return { error: json({ error: 'cobro_no_encontrado' }, 404) }
  return { cobro, pedidoId, piId }
}

async function accionConfirmar(sb: ReturnType<typeof admin>, socioId: string, b: any) {
  const c = await cobroDelSocio(sb, socioId, b)
  if ('error' in c) return c.error
  const r = await stripe('GET', `/payment_intents/${c.piId}`)
  if (!r.ok) return json({ error: 'stripe_no_responde', detalle: stripeError(r) }, 502)
  const pi = r.data
  if (pi?.metadata?.pedido_id !== c.pedidoId) return json({ error: 'cobro_de_otro_pedido' }, 409)

  if (pi.status === 'succeeded') {
    const reg = await registrar(sb, c.pedidoId, pi, 'app')
    const ok = !!(reg?.ok || reg?.already)
    // Aunque el registro falle, el cobro ES real: la app debe decir «cobrado» y el webhook
    // reintentará el registro. revisar/pedido_ya_pagado quedan en la fila para Pidoo.
    return json({ ok: true, cobrado: true, registrado: ok, importe_cent: pi.amount_received, registro: reg })
  }
  if (pi.status === 'processing') return json({ ok: false, pendiente: true, status: pi.status }, 202)

  const err = errorDePago(pi)
  await sb.from('pedido_cobros_movil').update({ ultimo_error: err, updated_at: new Date().toISOString() }).eq('id', c.cobro.id)
  return json({ ok: false, cobrado: false, status: pi.status, error: err }, 409)
}

async function accionCancelar(sb: ReturnType<typeof admin>, socioId: string, b: any) {
  const c = await cobroDelSocio(sb, socioId, b)
  if ('error' in c) return c.error
  const r = await stripe('GET', `/payment_intents/${c.piId}`)
  if (!r.ok) return json({ error: 'stripe_no_responde', detalle: stripeError(r) }, 502)
  const pi = r.data
  if (pi.status === 'succeeded') {
    // Llegó a cobrarse: no se anula nada, se registra.
    const reg = await registrar(sb, c.pedidoId, pi, 'app')
    return json({ ok: false, ya_cobrado: true, registro: reg }, 409)
  }
  if (PI_ANULABLES.includes(pi.status)) {
    const an = await stripe('POST', `/payment_intents/${pi.id}/cancel`, {}, `cobro-movil-anular-${pi.id}`)
    if (!an.ok) return json({ error: 'no_se_pudo_anular', detalle: stripeError(an) }, 502)
  }
  await sb.from('pedido_cobros_movil').update({ estado: 'cancelado', updated_at: new Date().toISOString() }).eq('id', c.cobro.id).eq('estado', 'creado')
  return json({ ok: true, anulado: true })
}

async function accionDiagnostico(sb: ReturnType<typeof admin>, cfg: Cfg, b: any) {
  if (!cfg.diagToken || String(b?.diag_token || '') !== cfg.diagToken) return json({ error: 'unauthorized' }, 401)
  const out: Record<string, unknown> = { modo: cfg.modo, metodos: cfg.metodos, socios_prueba: cfg.sociosPrueba.length }
  const loc = await asegurarLocation(sb, cfg)
  out.location = loc
  const t = await stripe('POST', '/terminal/connection_tokens', {})
  out.connection_token = t.ok && t.data?.secret ? 'ok' : stripeError(t)
  const pi = await stripe('POST', '/payment_intents', {
    amount: String(MINIMO_CENT),
    currency: 'eur',
    'payment_method_types[]': 'card_present',
    capture_method: 'automatic',
    description: 'Pidoo · diagnóstico del cobro con el móvil (se anula al momento)',
    'metadata[origen]': 'cobro_movil_diagnostico',
  })
  if (pi.ok && pi.data?.id) {
    out.payment_intent = { status: pi.data.status, metodos: pi.data.payment_method_types, captura: pi.data.capture_method, tiene_client_secret: !!pi.data.client_secret }
    const an = await stripe('POST', `/payment_intents/${pi.data.id}/cancel`, {})
    out.payment_intent_anulado = an.ok ? an.data?.status : stripeError(an)
  } else {
    out.payment_intent = stripeError(pi)
  }
  return json({ ok: true, diagnostico: out })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)
  if (!STRIPE_SECRET_KEY) return json({ error: 'sin_clave_stripe' }, 500)
  let b: any = {}
  try { b = await req.json() } catch (_) {}
  const accion = String(b?.accion || '')
  const sb = admin()

  try {
    const cfg = await leerConfig(sb)
    if (accion === 'diagnostico') return await accionDiagnostico(sb, cfg, b)

    const auth = await socioFromAuth(req)
    if (!auth) return json({ error: 'unauthorized' }, 401)
    const habilitado = auth.activo && socioHabilitado(cfg, auth.socioId)

    if (accion === 'config') {
      if (!habilitado) return json({ ok: true, habilitado: false, metodos: [] })
      const loc = await asegurarLocation(sb, cfg)
      return json({ ok: true, habilitado: !!loc.id, metodos: cfg.metodos, location_id: loc.id, error_location: loc.id ? undefined : loc.error })
    }
    if (!habilitado) return json({ error: 'cobro_movil_desactivado' }, 409)

    if (accion === 'token') {
      const t = await stripe('POST', '/terminal/connection_tokens', {})
      if (!t.ok || !t.data?.secret) return json({ error: 'token_fallido', detalle: stripeError(t) }, 502)
      return json({ ok: true, secret: t.data.secret })
    }
    if (accion === 'crear') return await accionCrear(sb, cfg, auth.socioId, b)
    if (accion === 'confirmar') return await accionConfirmar(sb, auth.socioId, b)
    if (accion === 'cancelar') return await accionCancelar(sb, auth.socioId, b)
    return json({ error: 'accion_invalida' }, 400)
  } catch (e) {
    console.error('[socio-cobro-movil]', accion, e)
    return json({ error: 'error_interno', message: (e as Error)?.message || String(e) }, 500)
  }
})
