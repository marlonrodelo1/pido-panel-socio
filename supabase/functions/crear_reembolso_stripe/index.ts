// crear_reembolso_stripe v12 — verify_jwt + superadmin check.
// Antes era public sin auth: cualquiera podía emitir reembolsos.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, idempotency-key',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

interface StripeRefundResponse {
  id?: string
  amount?: number
  status?: string
  error?: { message: string }
}

async function crearReembolsoStripe(paymentIntentId: string, amount?: number): Promise<StripeRefundResponse> {
  const secretKey = Deno.env.get('STRIPE_SECRET_KEY')
  if (!secretKey) throw new Error('STRIPE_SECRET_KEY not configured')

  const basicAuth = btoa(`${secretKey}:`)
  const params = new URLSearchParams()
  params.append('payment_intent', paymentIntentId)
  if (amount) params.append('amount', Math.round(amount * 100).toString())

  const response = await fetch('https://api.stripe.com/v1/refunds', {
    method: 'POST',
    headers: { Authorization: `Basic ${basicAuth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  })
  const result = await response.json()
  if (!response.ok) throw new Error(result.error?.message || 'Failed to create refund')
  return result as StripeRefundResponse
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    // Cliente con el JWT del invocante para validar identidad
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return Response.json({ error: 'no_auth' }, { status: 401, headers: CORS })

    const supabaseUser = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    )

    const { data: userData, error: userErr } = await supabaseUser.auth.getUser()
    if (userErr || !userData?.user) {
      return Response.json({ error: 'invalid_auth' }, { status: 401, headers: CORS })
    }
    const userId = userData.user.id

    // Cliente con service role para hacer el chequeo de rol y operaciones admin
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const { data: usuario, error: rolErr } = await supabaseAdmin
      .from('usuarios')
      .select('rol')
      .eq('id', userId)
      .maybeSingle()
    if (rolErr || !usuario || usuario.rol !== 'superadmin') {
      return Response.json({ error: 'forbidden_no_superadmin' }, { status: 403, headers: CORS })
    }

    const { pedido_id } = await req.json()
    if (!pedido_id) return Response.json({ error: 'Missing pedido_id' }, { status: 400, headers: CORS })

    const { data: pedido, error: pedidoError } = await supabaseAdmin
      .from('pedidos')
      .select('id, stripe_payment_id, total, stripe_refund_id')
      .eq('id', pedido_id)
      .single()
    if (pedidoError || !pedido) return Response.json({ error: 'Pedido no encontrado' }, { status: 404, headers: CORS })

    if (pedido.stripe_refund_id) {
      return Response.json({ error: 'Ya reembolsado', already_refunded: true }, { status: 400, headers: CORS })
    }
    if (!pedido.stripe_payment_id) {
      return Response.json({ error: 'Pedido sin payment_id' }, { status: 400, headers: CORS })
    }

    const refund = await crearReembolsoStripe(pedido.stripe_payment_id, pedido.total)
    if (!refund.id) throw new Error('No refund ID returned from Stripe')

    const { error: updateError } = await supabaseAdmin
      .from('pedidos')
      .update({
        stripe_refund_id: refund.id,
        monto_reembolsado: pedido.total,
        reembolsado_at: new Date().toISOString(),
      })
      .eq('id', pedido_id)

    if (updateError) {
      return Response.json(
        { success: true, refund_id: refund.id, monto_reembolsado: pedido.total, warning: 'DB update failed' },
        { status: 200, headers: CORS }
      )
    }

    return Response.json(
      { success: true, refund_id: refund.id, monto_reembolsado: pedido.total },
      { status: 200, headers: CORS }
    )
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Internal server error'
    console.error('[crear_reembolso_stripe]', msg)
    return Response.json({ error: msg }, { status: 400, headers: CORS })
  }
})
