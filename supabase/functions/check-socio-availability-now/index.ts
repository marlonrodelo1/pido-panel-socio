// check-socio-availability-now — verificacion on-demand al abrir carrito.
//
// Body: { establecimiento_id }  ó  { socio_id }
//
// Llama a Shipday /carriers en directo, actualiza socios.en_servicio si
// difiere, y devuelve si el socio puede tomar pedidos delivery ahora mismo.
//
// Sirve para evitar que un cliente pague un pedido que no se puede
// repartir porque el socio acaba de desconectarse en los ultimos 60s
// (entre cron y el momento del pago).

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

serve(async (req) => {
  const pre = preflight(req)
  if (pre) return pre
  if (req.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405)

  let body: { establecimiento_id?: string; socio_id?: string } = {}
  try { body = await req.json() } catch (_) {}

  const sb = adminClient()

  // Resolver socio destino.
  let socioId = body.socio_id || null
  if (!socioId && body.establecimiento_id) {
    const { data: vinc } = await sb
      .from('socio_establecimiento')
      .select('socio_id')
      .eq('establecimiento_id', body.establecimiento_id)
      .eq('estado', 'activa')
      .order('aceptado_at', { ascending: true })
      .limit(1)
      .maybeSingle()
    socioId = (vinc as any)?.socio_id || null
  }
  if (!socioId) {
    return jsonResponse({ available: false, reason: 'no_socio_active' })
  }

  const { data: socio } = await sb
    .from('socios')
    .select('id, activo, shipday_api_key, en_servicio, marketplace_activo')
    .eq('id', socioId)
    .maybeSingle()
  if (!socio) return jsonResponse({ available: false, reason: 'socio_not_found' })
  if (!socio.activo) return jsonResponse({ available: false, reason: 'socio_inactivo' })
  const apiKey = (socio.shipday_api_key || '').trim()
  if (!apiKey) return jsonResponse({ available: false, reason: 'no_api_key' })

  // Llamar Shipday en directo.
  let res: Response
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 6_000)
    res = await fetch(`${SHIPDAY_API}/carriers`, {
      method: 'GET',
      headers: { 'Authorization': `Basic ${apiKey}`, 'Content-Type': 'application/json' },
      signal: ctrl.signal,
    })
    clearTimeout(t)
  } catch (_err) {
    // No bloqueamos por error de red — confiamos en lo que diga BD.
    return jsonResponse({
      available: !!socio.en_servicio,
      reason: socio.en_servicio ? 'shipday_unreachable_using_cache' : 'shipday_unreachable_offline',
      cached: true,
    })
  }

  if (!res.ok) {
    return jsonResponse({
      available: !!socio.en_servicio,
      reason: 'shipday_http_' + res.status + '_using_cache',
      cached: true,
    })
  }

  const data = await res.json().catch(() => null)
  const list: any[] = Array.isArray(data) ? data : (Array.isArray(data?.carriers) ? data.carriers : [])
  const online = list.filter((c) => c?.isActive !== false && c?.isOnShift === true).length

  // Si el estado en BD difiere, actualizamos (esto dispara los triggers
  // de propagacion a marketplace_activo y vinculaciones).
  const newOnline = online > 0
  if (socio.en_servicio !== newOnline) {
    await sb.from('socios').update({ en_servicio: newOnline }).eq('id', socio.id)
  }

  return jsonResponse({
    available: newOnline,
    online_count: online,
    socio_id: socio.id,
  })
})
