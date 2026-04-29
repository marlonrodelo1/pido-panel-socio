// shipday-webhook — Reactivado.
//
// Recibe POST de Shipday con eventos del ciclo de vida de la orden.
// Soporta el formato nuevo (snake_case anidado bajo `payload.order.*`) y el
// viejo (camelCase top-level) para no romper si alguna cuenta Shipday legacy
// sigue mandando el formato antiguo.
//
// Auth: header `token` debe coincidir con env `SHIPDAY_WEBHOOK_TOKEN`. Si no
// está configurado el env, se acepta cualquier request (modo bootstrapping).
//
// Mapeo event -> shipday_status -> estado del pedido:
//   ORDER_ASSIGNED, ORDER_ACCEPTED_AND_STARTED -> accepted -> preparando
//   ORDER_PIKEDUP                              -> picked_up -> recogido
//   ORDER_ONTHEWAY                             -> en_camino -> en_camino
//   ORDER_COMPLETED                            -> delivered -> entregado
//   ORDER_FAILED, ORDER_INCOMPLETE             -> failed   -> cancelado
//   ORDER_UNASSIGNED, ORDER_PIKEDUP_REMOVED,
//   ORDER_ONTHEWAY_REMOVED                     -> created  -> (no toca estado)

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

serve(async (req) => {
  const pre = preflight(req)
  if (pre) return pre
  if (req.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405)

  // Auth por header `token`
  const expectedToken = Deno.env.get('SHIPDAY_WEBHOOK_TOKEN')
  if (expectedToken) {
    const got = req.headers.get('token') || ''
    if (got !== expectedToken) {
      return jsonResponse({ error: 'unauthorized' }, 401)
    }
  }

  let payload: any = null
  try {
    payload = await req.json()
  } catch (_) {
    return jsonResponse({ error: 'invalid_json' }, 400)
  }

  const sb = adminClient()

  const orderNumber = extractOrderNumber(payload)
  const orderId = extractOrderId(payload)
  const event = extractEvent(payload)
  const orderStatus = extractOrderStatus(payload)

  // Localiza pedido por codigo (= orderNumber)
  let pedidoId: string | null = null
  if (orderNumber) {
    const { data: ped } = await sb
      .from('pedidos')
      .select('id')
      .eq('codigo', orderNumber)
      .maybeSingle()
    pedidoId = ped?.id ?? null
  }

  // Log (best-effort, no bloqueante)
  try {
    await sb.from('shipday_webhook_logs').insert({
      payload,
      pedido_id: pedidoId,
      extracted_order_number: orderNumber,
      extracted_order_id: orderId,
      extracted_status: orderStatus || event,
    })
  } catch (e) {
    console.warn('[shipday-webhook] no se pudo loggear', (e as any)?.message)
  }

  if (!pedidoId) {
    // 200 para que Shipday no reintente infinito
    return jsonResponse({ ok: true, warning: 'pedido_not_found', orderNumber })
  }

  // Mapear evento -> estados
  const mapping = event ? EVENT_MAP[event] : null
  if (!mapping) {
    return jsonResponse({ ok: true, warning: 'event_not_mapped', event })
  }

  const updates: Record<string, unknown> = {
    shipday_status: mapping.shipday,
  }
  if (mapping.estado) updates.estado = mapping.estado
  // Timestamps utiles para el ciclo de vida del pedido
  if (mapping.estado === 'recogido') updates.recogido_at = new Date().toISOString()
  if (mapping.estado === 'entregado') updates.entregado_at = new Date().toISOString()
  if (mapping.estado === 'cancelado') updates.cancelado_at = new Date().toISOString()

  const { error: updErr } = await sb.from('pedidos').update(updates).eq('id', pedidoId)
  if (updErr) {
    console.error('[shipday-webhook] update fallo', updErr)
    return jsonResponse({ ok: false, error: 'update_failed', detail: updErr.message }, 500)
  }

  return jsonResponse({
    ok: true,
    pedido_id: pedidoId,
    event,
    shipday_status: mapping.shipday,
    estado: mapping.estado || null,
  })
})
