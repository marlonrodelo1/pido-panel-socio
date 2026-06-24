// crear_pago_stripe v28 — SIN split por pedido (modelo de liquidacion semanal unica)
//
// MODELO (19 jun 2026):
//   - El cliente paga el TOTAL = subtotal + envio + propina al PaymentIntent, a la cuenta de Pidoo.
//   - NO hay reparto por pedido (ni application_fee ni transfer_data).
//   - El 10% de comision Pido + el 90% al restaurante + envio/propina al socio se calculan
//     en la LIQUIDACION SEMANAL de los lunes, NO aqui.
//   - Pidoo absorbe las fees de Stripe (salen de su 10%).
//   - Se mantiene la revalidacion de radio (Haversine) y de socio disponible para delivery.
//
// v28 (24 jun): gate de delivery ALINEADO con el dispatcher create-shipday-order v42.
//   - YA NO exige shipday_api_key (el dispatcher propio no usa Shipday).
//   - Permite el pago si EXISTE >=1 socio vinculado activo y en_servicio (no solo el primero).
//   - Si el pedido viene del marketplace de un socio (origen_pedido='marketplace_socio'
//     + socio_id), comprueba SOLO ese socio (misma regla 1 del dispatcher).

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const ALLOWED_ORIGINS: string[] = [
  'https://pidoo.es','https://panel.pidoo.es','https://admin.pidoo.es','https://socio.pidoo.es',
  'http://localhost:5173','http://localhost:5174','http://localhost:5175','http://localhost:5176','http://localhost:5177',
  'https://localhost','capacitor://localhost','http://localhost'
]
const SUBDOMAIN_REGEX = /^https:\/\/([a-z0-9-]+\.)?pidoo\.es$/
function isOriginAllowed(origin: string | null): boolean {
  if (!origin) return true
  if (ALLOWED_ORIGINS.includes(origin)) return true
  if (SUBDOMAIN_REGEX.test(origin)) return true
  return false
}
function getCorsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin')
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, idempotency-key',
  }
  if (isOriginAllowed(origin)) { headers['Access-Control-Allow-Origin'] = origin || '*'; headers['Vary'] = 'Origin' }
  return headers
}

interface PaymentRequest {
  amount?: number
  currency?: string
  pedido_codigo: string
  customer_email: string
  user_id: string
  action?: string
  payment_method_id?: string
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371
  const toRad = (d: number) => d * Math.PI / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng/2)**2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))
}

async function callStripeAPI(method: string, endpoint: string, data: unknown): Promise<any> {
  const secretKey = Deno.env.get('STRIPE_SECRET_KEY')
  if (!secretKey) throw new Error('STRIPE_SECRET_KEY not configured')
  const basicAuth = btoa(`${secretKey}:`)
  const response = await fetch(`https://api.stripe.com/v1${endpoint}`, {
    method,
    headers: { 'Authorization': `Basic ${basicAuth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: data instanceof FormData ? data : new URLSearchParams(data as Record<string, string>).toString(),
  })
  const result = await response.json()
  if (!response.ok) throw new Error(result.error?.message || result.message || 'Stripe API error')
  return result
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { status: 200, headers: getCorsHeaders(req) })
  const CORS = getCorsHeaders(req)

  try {
    const body = (await req.json()) as PaymentRequest
    if (body.action === 'list_cards') return Response.json({ cards: [] }, { status: 200, headers: CORS })
    if (body.action === 'pay_saved') return Response.json({ error: 'Saved card payments not yet implemented' }, { status: 400, headers: CORS })

    const { currency = 'eur', pedido_codigo, customer_email, user_id } = body
    if (!pedido_codigo || !customer_email || !user_id) {
      return Response.json({ error: 'Missing required fields' }, { status: 400, headers: CORS })
    }

    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

    const { data: pedido, error: pedErr } = await supabase
      .from('pedidos')
      .select('id, codigo, total, subtotal, coste_envio, propina, metodo_pago, estado, modo_entrega, establecimiento_id, usuario_id, lat_entrega, lng_entrega, origen_pedido, socio_id')
      .eq('codigo', pedido_codigo)
      .maybeSingle()
    if (pedErr || !pedido) return Response.json({ error: 'Pedido no encontrado' }, { status: 404, headers: CORS })

    if (pedido.usuario_id && pedido.usuario_id !== user_id) {
      return Response.json({ error: 'Pedido no corresponde al usuario' }, { status: 403, headers: CORS })
    }

    const authHeader = req.headers.get('Authorization') || ''
    const jwt = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null
    if (jwt) {
      try {
        const userClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
          global: { headers: { Authorization: `Bearer ${jwt}` } }
        })
        const { data: { user } } = await userClient.auth.getUser()
        if (user && user.id && pedido.usuario_id && user.id !== pedido.usuario_id) {
          return Response.json({ error: 'JWT no corresponde al pedido' }, { status: 403, headers: CORS })
        }
      } catch (_) { /* JWT invalido — seguimos con user_id validado arriba */ }
    }

    const ESTADOS_PAGABLES = ['nuevo', 'pendiente_pago', 'pending_payment']
    if (pedido.estado && !ESTADOS_PAGABLES.includes(pedido.estado)) {
      return Response.json({ error: `Pedido en estado '${pedido.estado}' no se puede cobrar` }, { status: 409, headers: CORS })
    }

    const totalDB = typeof pedido.total === 'number' ? pedido.total : null
    if (!totalDB || totalDB <= 0) {
      return Response.json({ error: 'Total del pedido invalido' }, { status: 400, headers: CORS })
    }

    const { data: est } = await supabase
      .from('establecimientos')
      .select('latitud, longitud, radio_cobertura_km')
      .eq('id', pedido.establecimiento_id)
      .maybeSingle()

    if (!est) {
      return Response.json({ error: 'Establecimiento no encontrado' }, { status: 404, headers: CORS })
    }

    if (pedido.modo_entrega === 'delivery') {
      let cliLat: number | null = (pedido as any).lat_entrega ?? null
      let cliLng: number | null = (pedido as any).lng_entrega ?? null
      if (cliLat == null || cliLng == null) {
        const { data: usr } = await supabase
          .from('usuarios').select('latitud, longitud').eq('id', pedido.usuario_id).maybeSingle()
        cliLat = (usr as any)?.latitud ?? null
        cliLng = (usr as any)?.longitud ?? null
      }

      if (est.latitud == null || est.longitud == null || est.radio_cobertura_km == null || cliLat == null || cliLng == null) {
        return Response.json({ error: 'Ubicacion del cliente o restaurante no disponible' }, { status: 400, headers: CORS })
      }

      const distanciaKm = haversineKm(est.latitud, est.longitud, cliLat, cliLng)
      const radioMax = est.radio_cobertura_km + 0.5
      if (distanciaKm > radioMax) {
        return Response.json({ error: 'Fuera del radio de cobertura del restaurante' }, { status: 400, headers: CORS })
      }

      // Disponibilidad de reparto ALINEADA con create-shipday-order v42:
      //  - Si el pedido viene del marketplace de un socio -> comprobar SOLO ese socio.
      //  - Si no -> basta con que CUALQUIER socio vinculado activo este en_servicio.
      //  - NO se exige shipday_api_key (el dispatcher propio no usa Shipday).
      const esMarketplaceSocio = (pedido as any).origen_pedido === 'marketplace_socio' && !!(pedido as any).socio_id
      let hayOnline = false
      if (esMarketplaceSocio) {
        const { data: s } = await supabase
          .from('socios').select('activo, en_servicio').eq('id', (pedido as any).socio_id).maybeSingle()
        hayOnline = !!s && (s as any).activo === true && (s as any).en_servicio === true
      } else {
        const { data: vincs } = await supabase
          .from('socio_establecimiento')
          .select('socios!inner(activo, en_servicio)')
          .eq('establecimiento_id', pedido.establecimiento_id)
          .eq('estado', 'activa')
        hayOnline = (vincs || []).some((v: any) => v.socios?.activo === true && v.socios?.en_servicio === true)
      }
      if (!hayOnline) {
        return Response.json(
          { error: 'No hay repartidores disponibles en este momento. Vuelve a intentarlo en unos minutos o elige Recogida.', code: 'socio_offline' },
          { status: 409, headers: CORS },
        )
      }
    }

    const params = new URLSearchParams()
    params.append('amount', Math.round(totalDB * 100).toString())
    params.append('currency', currency.toLowerCase())
    params.append('automatic_payment_methods[enabled]', 'true')
    params.append('description', `Pedido ${pedido_codigo}`)
    params.append('metadata[pedido_codigo]', pedido_codigo)
    params.append('metadata[pedido_id]', String(pedido.id))
    params.append('metadata[user_id]', user_id)
    params.append('metadata[establecimiento_id]', String(pedido.establecimiento_id))
    params.append('receipt_email', customer_email)
    params.append('statement_descriptor_suffix', 'PIDOO')

    // Sin split por pedido: el cobro va integro a la cuenta de Pidoo.
    // El 10% comision + 90% restaurante + envio/propina al socio se liquidan los lunes.

    const result = await callStripeAPI('POST', '/payment_intents', params.toString())
    if (!result.client_secret || !result.id) throw new Error('Invalid Stripe response')

    return Response.json(
      {
        clientSecret: result.client_secret,
        paymentIntentId: result.id,
        amount_cents: Math.round(totalDB * 100),
        routing: 'platform',
      },
      { status: 200, headers: CORS }
    )
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Internal server error'
    console.error('Stripe error:', msg)
    return Response.json({ error: msg }, { status: 400, headers: CORS })
  }
})
