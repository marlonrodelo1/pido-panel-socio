// shipday-webhook v3 —
//
// Recibe POST de Shipday con eventos del ciclo de vida de la orden.
// Soporta el formato nuevo (snake_case anidado bajo `payload.order.*`) y el
// viejo (camelCase top-level).
//
// Cuando llega ORDER_ASSIGNED / ORDER_ACCEPTED_AND_STARTED y el pedido aun
// no tiene shipday_tracking_url, hace GET a Shipday /orders/{orderNumber}
// con la api_key del socio para obtener el `trackingLink` y guardarlo.
//
// Auth: header `token` debe coincidir con env `SHIPDAY_WEBHOOK_TOKEN`. Si no
// esta configurado, se acepta cualquier request (modo bootstrapping).

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS_BASE: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, token, x-supabase-api-version',
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

type Mapping = { shipday: string; estado?: string }
const EVENT_MAP: Record<string, Mapping> = {
  ORDER_ASSIGNED: { shipday: 'accepted', estado: 'preparando' },
  ORDER_ACCEPTED_AND_STARTED: { shipday: 'accepted', estado: 'preparando' },
  ORDER_PIKEDUP: { shipday: 'picked_up', estado: 'recogido' },
  ORDER_ONTHEWAY: { shipday: 'en_camino', estado: 'en_camino' },
  ORDER_COMPLETED: { shipday: 'delivered', estado: 'entregado' },
  ORDER_FAILED: { shipday: 'failed', estado: 'cancelado' },
  ORDER_INCOMPLETE: { shipday: 'failed', estado: 'cancelado' },
  ORDER_UNASSIGNED: { shipday: 'created' },
  ORDER_PIKEDUP_REMOVED: { shipday: 'created' },
  ORDER_ONTHEWAY_REMOVED: { shipday: 'created' },
}

function extractOrderNumber(p: any): string | null {
  return (
    p?.order?.order_number ||
    p?.payload?.order?.order_number ||
    p?.orderNumber ||
    p?.order_number ||
    null
  )
}
function extractOrderId(p: any): string | null {
  const v =
    p?.order?.id ||
    p?.payload?.order?.id ||
    p?.orderId ||
    p?.order_id ||
    null
  return v != null ? String(v) : null
}
function extractEvent(p: any): string | null {
  return p?.event || p?.payload?.event || p?.eventName || null
}
function extractOrderStatus(p: any): string | null {
  return (
    p?.order_status ||
    p?.payload?.order_status ||
    p?.orderStatus ||
    p?.order?.order_status ||
    null
  )
}

async function fetchTrackingLink(orderNumber: string, apiKey: string): Promise<string | null> {
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 6000)
    const res = await fetch(`https://api.shipday.com/orders/${encodeURIComponent(orderNumber)}`, {
      method: 'GET',
      headers: { 'Authorization': `Basic ${apiKey}`, 'Content-Type': 'application/json' },
      signal: ctrl.signal,
    })
    clearTimeout(t)
    if (!res.ok) return null
    const data = await res.json().catch(() => null)
    const arr = Array.isArray(data) ? data : (data ? [data] : [])
    for (const o of arr) {
      const link = o?.trackingLink || o?.tracking_link || o?.trackingUrl
      if (link) return String(link)
    }
  } catch (_) {}
  return null
}

serve(async (req) => {
  const pre = preflight(req)
  if (pre) return pre
  if (req.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405)

  const expectedToken = Deno.env.get('SHIPDAY_WEBHOOK_TOKEN')
  if (expectedToken) {
    const got = req.headers.get('token') || ''
    if (got !== expectedToken) return jsonResponse({ error: 'unauthorized' }, 401)
  }

  let payload: any = null
  try { payload = await req.json() } catch (_) { return jsonResponse({ error: 'invalid_json' }, 400) }

  const sb = adminClient()

  const orderNumber = extractOrderNumber(payload)
  const orderId = extractOrderId(payload)
  const event = extractEvent(payload)
  const orderStatus = extractOrderStatus(payload)

  // Localiza pedido por codigo + carga shipday_tracking_url y socio_id
  let pedidoId: string | null = null
  let pedidoTrackingUrl: string | null = null
  let pedidoSocioId: string | null = null
  if (orderNumber) {
    const { data: ped } = await sb
      .from('pedidos')
      .select('id, shipday_tracking_url, socio_id')
      .eq('codigo', orderNumber)
      .maybeSingle()
    if (ped) {
      pedidoId = ped.id
      pedidoTrackingUrl = ped.shipday_tracking_url
      pedidoSocioId = ped.socio_id
    }
  }

  // Log (best-effort)
  try {
    await sb.from('shipday_webhook_logs').insert({
      payload, pedido_id: pedidoId,
      extracted_order_number: orderNumber,
      extracted_order_id: orderId,
      extracted_status: orderStatus || event,
    })
  } catch (e) {
    console.warn('[shipday-webhook] log fail', (e as any)?.message)
  }

  if (!pedidoId) {
    return jsonResponse({ ok: true, warning: 'pedido_not_found', orderNumber })
  }

  const mapping = event ? EVENT_MAP[event] : null
  if (!mapping) {
    return jsonResponse({ ok: true, warning: 'event_not_mapped', event })
  }

  const updates: Record<string, unknown> = { shipday_status: mapping.shipday }
  if (mapping.estado) updates.estado = mapping.estado
  if (mapping.estado === 'recogido') updates.recogido_at = new Date().toISOString()
  if (mapping.estado === 'entregado') updates.entregado_at = new Date().toISOString()
  if (mapping.estado === 'cancelado') updates.cancelado_at = new Date().toISOString()

  // Si el pedido aun no tiene tracking url y el evento es de asignacion/aceptacion,
  // pedimos a Shipday GET /orders/{orderNumber} para obtener trackingLink.
  if (!pedidoTrackingUrl && pedidoSocioId && orderNumber &&
      (event === 'ORDER_ASSIGNED' || event === 'ORDER_ACCEPTED_AND_STARTED')) {
    const { data: socio } = await sb
      .from('socios').select('shipday_api_key').eq('id', pedidoSocioId).maybeSingle()
    const apiKey = (socio as any)?.shipday_api_key
    if (apiKey) {
      const link = await fetchTrackingLink(orderNumber, apiKey)
      if (link) updates.shipday_tracking_url = link
    }
  }

  const { error: updErr } = await sb.from('pedidos').update(updates).eq('id', pedidoId)
  if (updErr) {
    console.error('[shipday-webhook] update fallo', updErr)
    return jsonResponse({ ok: false, error: 'update_failed', detail: updErr.message }, 500)
  }

  return jsonResponse({
    ok: true, pedido_id: pedidoId, event,
    shipday_status: mapping.shipday, estado: mapping.estado || null,
    tracking_url_set: 'shipday_tracking_url' in updates,
  })
})
