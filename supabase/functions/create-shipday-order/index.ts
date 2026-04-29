// create-shipday-order — Reactivada (sustituye al dispatcher propio).
//
// Body: { pedido_id }
//
// 1. Lee pedido + establecimiento.
// 2. Localiza el socio activo del establecimiento (socio_establecimiento.estado='activa').
// 3. Usa la `socios.shipday_api_key` para crear la orden en Shipday.
// 4. Persiste shipday_order_id, shipday_tracking_url, shipday_status='created'
//    y socio_id en `pedidos`.
//
// Auth Shipday: header `Authorization: Basic <api_key>` (la API key se manda
// tal cual; Shipday no espera base64 adicional).

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS_BASE: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-supabase-api-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
function preflight(req: Request) {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_BASE })
  return null
}
function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_BASE, 'Content-Type': 'application/json' },
  })
}
function adminClient() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  )
}

const SHIPDAY_API = 'https://api.shipday.com'

function pad(n: number) {
  return n < 10 ? '0' + n : '' + n
}

// Devuelve fecha YYYY-MM-DD y hora HH:mm:ss en TZ Europe/Madrid (Tenerife usa
// Atlantic/Canary que es UTC sin DST en invierno y UTC+1 en verano; usamos
// Atlantic/Canary explicito).
function expectedDeliveryParts(minutosPrep: number) {
  const now = new Date(Date.now() + (Math.max(minutosPrep || 0, 30) + 25) * 60_000)
  // formato ISO en UTC, Shipday acepta hora local; mandamos UTC simple.
  const yyyy = now.getUTCFullYear()
  const mm = pad(now.getUTCMonth() + 1)
  const dd = pad(now.getUTCDate())
  const hh = pad(now.getUTCHours())
  const mi = pad(now.getUTCMinutes())
  const ss = pad(now.getUTCSeconds())
  return { date: `${yyyy}-${mm}-${dd}`, time: `${hh}:${mi}:${ss}` }
}

serve(async (req) => {
  const pre = preflight(req)
  if (pre) return pre
  if (req.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405)

  let body: { pedido_id?: string } = {}
  try { body = await req.json() } catch (_) {}
  if (!body.pedido_id) return jsonResponse({ error: 'pedido_id_required' }, 400)

  const sb = adminClient()

  // 1. Pedido
  const { data: pedido, error: pedErr } = await sb
    .from('pedidos')
    .select(
      'id, codigo, usuario_id, establecimiento_id, modo_entrega, subtotal, coste_envio, propina, total, metodo_pago, notas, minutos_preparacion, direccion_entrega, lat_entrega, lng_entrega',
    )
    .eq('id', body.pedido_id)
    .maybeSingle()
  if (pedErr || !pedido) {
    return jsonResponse({ error: 'pedido_not_found', detail: pedErr?.message }, 404)
  }
  if (pedido.modo_entrega !== 'delivery') {
    return jsonResponse({ error: 'pedido_no_delivery' }, 400)
  }

  // 2. Establecimiento
  const { data: est, error: estErr } = await sb
    .from('establecimientos')
    .select('id, nombre, telefono, direccion, latitud, longitud')
    .eq('id', pedido.establecimiento_id)
    .maybeSingle()
  if (estErr || !est) {
    return jsonResponse({ error: 'establecimiento_not_found', detail: estErr?.message }, 404)
  }

  // 3. Cliente (usuarios)
  const { data: cliente } = await sb
    .from('usuarios')
    .select('nombre, apellido, telefono, email')
    .eq('id', pedido.usuario_id)
    .maybeSingle()

  // 4. Socio activo + API key Shipday
  const { data: vinc, error: vincErr } = await sb
    .from('socio_establecimiento')
    .select('socio_id, socios!inner(id, shipday_api_key, nombre)')
    .eq('establecimiento_id', est.id)
    .eq('estado', 'activa')
    .order('aceptado_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (vincErr) {
    return jsonResponse({ error: 'vinculo_query_failed', detail: vincErr.message }, 500)
  }
  const socioRaw = (vinc as any)?.socios
  const apiKey = socioRaw?.shipday_api_key
  const socioId = socioRaw?.id
  if (!apiKey || typeof apiKey !== 'string' || !apiKey.trim()) {
    await sb.from('pedidos').update({ shipday_status: 'no_api_key' }).eq('id', pedido.id)
    return jsonResponse({ error: 'Socio sin API Key Shipday configurada' }, 400)
  }

  // 5. Construir payload Shipday
  const { date, time } = expectedDeliveryParts(pedido.minutos_preparacion || 0)
  const customerName = [cliente?.nombre, cliente?.apellido].filter(Boolean).join(' ').trim() || 'Cliente Pidoo'
  const paymentMethod = (pedido.metodo_pago === 'efectivo' || pedido.metodo_pago === 'cash') ? 'cash' : 'credit_card'

  const shipdayPayload: Record<string, unknown> = {
    orderNumber: pedido.codigo,
    customerName,
    customerAddress: pedido.direccion_entrega || '',
    customerPhoneNumber: cliente?.telefono || '',
    customerEmail: cliente?.email || undefined,
    restaurantName: est.nombre,
    restaurantAddress: est.direccion || '',
    restaurantPhoneNumber: est.telefono || '',
    expectedDeliveryDate: date,
    expectedDeliveryTime: time,
    pickupLatitude: est.latitud,
    pickupLongitude: est.longitud,
    deliveryLatitude: pedido.lat_entrega,
    deliveryLongitude: pedido.lng_entrega,
    deliveryFee: Number(pedido.coste_envio || 0),
    tip: Number(pedido.propina || 0),
    totalOrderCost: Number(pedido.total || 0),
    paymentMethod,
    deliveryInstruction: pedido.notas || '',
  }

  // 6. POST a Shipday
  let shipdayRes: Response
  try {
    shipdayRes = await fetch(`${SHIPDAY_API}/orders`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(shipdayPayload),
    })
  } catch (err) {
    console.error('[create-shipday-order] network error', err)
    await sb.from('pedidos').update({ shipday_status: 'error_crear_orden' }).eq('id', pedido.id)
    return jsonResponse({ error: 'shipday_unreachable', detail: String(err) }, 502)
  }

  const respText = await shipdayRes.text()
  let respJson: any = null
  try { respJson = respText ? JSON.parse(respText) : null } catch (_) {}

  if (!shipdayRes.ok) {
    console.error('[create-shipday-order] shipday error', shipdayRes.status, respText)
    await sb.from('pedidos').update({ shipday_status: 'error_crear_orden' }).eq('id', pedido.id)
    return jsonResponse({
      error: 'shipday_error',
      status: shipdayRes.status,
      detail: respJson || respText,
    }, 502)
  }

  // 7. Extraer orderId + trackingUrl tolerante a varios formatos.
  const orderId =
    respJson?.orderId ||
    respJson?.order_id ||
    respJson?.id ||
    respJson?.order?.id ||
    respJson?.order?.orderId ||
    null
  const trackingUrl =
    respJson?.trackingLink ||
    respJson?.tracking_link ||
    respJson?.tracking_url ||
    respJson?.trackingUrl ||
    respJson?.order?.trackingLink ||
    null

  // NOTA: la tabla `pedidos` no tiene columna `shipday_order_id` actualmente.
  // El order_id se devuelve en la respuesta y se localiza por `codigo` en el
  // webhook (Shipday lo manda como `order.order_number`). Si en el futuro se
  // quiere persistir, añadir la columna y actualizar este update.
  const updates: Record<string, unknown> = {
    shipday_status: 'created',
    shipday_tracking_url: trackingUrl,
  }
  if (socioId) updates.socio_id = socioId
  await sb.from('pedidos').update(updates).eq('id', pedido.id)

  return jsonResponse({
    ok: true,
    pedido_id: pedido.id,
    shipday_order_id: orderId,
    shipday_tracking_url: trackingUrl,
    socio_id: socioId,
  })
})
