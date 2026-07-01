// stripe-webhook-subscriptions v3
// Webhook de Stripe para suscripciones. Distingue por metadata.tipo:
//   - 'multirider' -> tabla socios (columnas multirider, legacy)
//   - 'socio'      -> suscripciones_socio + socios.marketplace_activo (plan marketplace 39 EUR)
//   - resto        -> suscripciones_tienda + establecimientos.plan_pro (restaurante)

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

async function verifyStripeSignature(payload: string, sigHeader: string, secret: string): Promise<boolean> {
  const parts = Object.fromEntries(sigHeader.split(',').map(p => p.split('=')))
  const ts = parts.t
  const v1 = parts.v1
  if (!ts || !v1) return false
  const signed = `${ts}.${payload}`
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  )
  const sigBuf = await crypto.subtle.sign('HMAC', key, enc.encode(signed))
  const hex = Array.from(new Uint8Array(sigBuf)).map(b => b.toString(16).padStart(2, '0')).join('')
  if (hex.length !== v1.length) return false
  let diff = 0
  for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ v1.charCodeAt(i)
  return diff === 0
}

async function callEnviarPush(supabaseUrl: string, serviceKey: string, payload: unknown) {
  try {
    await fetch(`${supabaseUrl}/functions/v1/enviar_push`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${serviceKey}` },
      body: JSON.stringify(payload),
    })
  } catch (e) {
    console.error('enviar_push failed:', e)
  }
}

async function stripeAPI(method: string, endpoint: string): Promise<any> {
  const secretKey = Deno.env.get('STRIPE_SECRET_KEY')
  if (!secretKey) throw new Error('STRIPE_SECRET_KEY not configured')
  const basicAuth = btoa(`${secretKey}:`)
  const res = await fetch(`https://api.stripe.com/v1${endpoint}`, {
    method,
    headers: { 'Authorization': `Basic ${basicAuth}` },
  })
  return await res.json()
}

async function getSubscriptionMetadata(subId: string): Promise<Record<string, string>> {
  if (!subId) return {}
  try {
    const sub = await stripeAPI('GET', `/subscriptions/${subId}`)
    return sub.metadata || {}
  } catch (_) {
    return {}
  }
}

serve(async (req: Request) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })

  const secret = Deno.env.get('STRIPE_WEBHOOK_SECRET_SUBSCRIPTIONS')
  if (!secret) return new Response('Missing webhook secret', { status: 500 })

  const sig = req.headers.get('stripe-signature')
  if (!sig) return new Response('Missing signature', { status: 400 })

  const body = await req.text()
  const valid = await verifyStripeSignature(body, sig, secret)
  if (!valid) return new Response('Invalid signature', { status: 400 })

  const event = JSON.parse(body)
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const supabase = createClient(supabaseUrl, serviceKey)

  // Idempotencia
  const { data: insertedEvent, error: insertErr } = await supabase.from('stripe_webhook_events')
    .insert({ event_id: event.id, tipo: event.type, raw: event })
    .select('event_id').maybeSingle()
  if (insertErr) {
    if (insertErr.code === '23505') return new Response('already processed', { status: 200 })
    console.error('stripe_webhook_events insert error', insertErr)
  }
  if (!insertedEvent) {
    return new Response('already processed', { status: 200 })
  }

  try {
    const obj = event.data?.object
    if (!obj) return new Response('ok', { status: 200 })

    let metadata: Record<string, string> = obj.metadata || obj.subscription_details?.metadata || {}
    const subId = obj.subscription || obj.id
    if ((!metadata || !metadata.tipo) && subId && typeof subId === 'string' && subId.startsWith('sub_')) {
      metadata = await getSubscriptionMetadata(subId)
    }
    const isMultirider = metadata?.tipo === 'multirider'
    const isSocio = metadata?.tipo === 'socio'
    const socioIdMeta = metadata?.socio_id || null

    // =====================================================================
    // ============= RAMA MULTI-RIDER (socios, legacy) =====================
    // =====================================================================
    if (isMultirider) {
      const findSocio = async () => {
        if (socioIdMeta) {
          const { data } = await supabase.from('socios').select('id, user_id, nombre_comercial, marketplace_activo').eq('id', socioIdMeta).maybeSingle()
          if (data) return data
        }
        if (subId) {
          const { data } = await supabase.from('socios').select('id, user_id, nombre_comercial, marketplace_activo').eq('stripe_subscription_multirider_id', subId).maybeSingle()
          return data
        }
        return null
      }

      if (event.type === 'invoice.payment_succeeded' || event.type === 'invoice.paid') {
        const socio = await findSocio()
        if (socio) {
          const nextPaymentTs = obj.period_end ? new Date(obj.period_end * 1000).toISOString() : null
          await supabase.from('socios').update({
            multirider_estado: 'al_dia',
            facturacion_multirider_activa: true,
            marketplace_activo: true,
            multirider_proximo_pago: nextPaymentTs,
          }).eq('id', socio.id)
        }
      }
      else if (event.type === 'invoice.payment_failed') {
        const socio = await findSocio()
        if (socio) {
          const attempt = obj.attempt_count || 1
          let nuevoEstado = 'reintento1'
          if (attempt >= 3) nuevoEstado = 'impago'
          else if (attempt === 2) nuevoEstado = 'reintento2'

          const patch: Record<string, unknown> = { multirider_estado: nuevoEstado }
          if (attempt >= 3) {
            patch.marketplace_activo = false
          }
          await supabase.from('socios').update(patch).eq('id', socio.id)

          if (attempt >= 3 && socio.user_id) {
            await callEnviarPush(supabaseUrl, serviceKey, {
              user_id: socio.user_id,
              titulo: 'Pago fallido — marketplace desactivado',
              mensaje: 'No hemos podido cobrar tu plan multi-rider 39EUR/mes. Regulariza el pago para reactivar tu marketplace.',
            })
          }
        }
      }
      else if (event.type === 'customer.subscription.deleted') {
        const socio = await findSocio()
        if (socio) {
          await supabase.from('socios').update({
            facturacion_multirider_activa: false,
            stripe_subscription_multirider_id: null,
            multirider_estado: 'al_dia',
            multirider_proximo_pago: null,
          }).eq('id', socio.id)
        }
      }
      else if (event.type === 'customer.subscription.updated') {
        const socio = await findSocio()
        if (socio) {
          const nextPaymentTs = obj.current_period_end ? new Date(obj.current_period_end * 1000).toISOString() : null
          const patch: Record<string, unknown> = { multirider_proximo_pago: nextPaymentTs }
          if (obj.status === 'active') patch.multirider_estado = 'al_dia'
          if (obj.status === 'past_due') patch.multirider_estado = 'reintento1'
          if (obj.status === 'unpaid') patch.multirider_estado = 'impago'
          await supabase.from('socios').update(patch).eq('id', socio.id)
        }
      }

      return new Response(JSON.stringify({ received: true, branch: 'multirider' }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      })
    }

    // =====================================================================
    // ============= RAMA SOCIO (suscripcion marketplace 39 EUR) ===========
    // =====================================================================
    if (isSocio) {
      const subIdStr = typeof subId === 'string' && subId.startsWith('sub_') ? subId : null
      const findSocio = async () => {
        if (socioIdMeta) {
          const { data } = await supabase.from('socios').select('id, user_id, slug').eq('id', socioIdMeta).maybeSingle()
          if (data) return data
        }
        if (subIdStr) {
          const { data: s } = await supabase.from('suscripciones_socio').select('socio_id').eq('stripe_subscription_id', subIdStr).maybeSingle()
          if (s?.socio_id) {
            const { data } = await supabase.from('socios').select('id, user_id, slug').eq('id', s.socio_id).maybeSingle()
            return data
          }
        }
        return null
      }

      if (event.type === 'invoice.payment_succeeded' || event.type === 'invoice.paid') {
        const socio = await findSocio()
        if (socio) {
          const nextPaymentTs = obj.period_end ? new Date(obj.period_end * 1000).toISOString() : null
          const patch: Record<string, unknown> = {
            estado: 'active', intentos_fallidos: 0,
            fecha_proximo_pago: nextPaymentTs, ultima_factura_stripe_id: obj.id,
            updated_at: new Date().toISOString(),
          }
          if (subIdStr) patch.stripe_subscription_id = subIdStr
          await supabase.from('suscripciones_socio').update(patch).eq('socio_id', socio.id)
          await supabase.from('socios').update({ marketplace_activo: true }).eq('id', socio.id)
        }
      }
      else if (event.type === 'invoice.payment_failed') {
        const socio = await findSocio()
        if (socio) {
          const { data: sus } = await supabase.from('suscripciones_socio').select('intentos_fallidos').eq('socio_id', socio.id).maybeSingle()
          const nuevos = (sus?.intentos_fallidos || 0) + 1
          const nuevoEstado = nuevos >= 3 ? 'unpaid' : 'past_due'
          await supabase.from('suscripciones_socio').update({ intentos_fallidos: nuevos, estado: nuevoEstado, updated_at: new Date().toISOString() }).eq('socio_id', socio.id)
          if (nuevos >= 3) {
            await supabase.from('socios').update({ marketplace_activo: false }).eq('id', socio.id)
            if (socio.user_id) {
              await callEnviarPush(supabaseUrl, serviceKey, {
                user_id: socio.user_id,
                titulo: 'Pago fallido — marketplace desactivado',
                mensaje: 'No hemos podido cobrar tu suscripcion de 39EUR/mes. Regulariza el pago para reactivar tu marketplace.',
              })
            }
          }
        }
      }
      else if (event.type === 'customer.subscription.deleted') {
        const socio = await findSocio()
        if (socio) {
          await supabase.from('suscripciones_socio').update({ estado: 'canceled', updated_at: new Date().toISOString() }).eq('socio_id', socio.id)
          await supabase.from('socios').update({ marketplace_activo: false }).eq('id', socio.id)
        }
      }
      else if (event.type === 'customer.subscription.created' || event.type === 'customer.subscription.updated') {
        const socio = await findSocio()
        if (socio) {
          const nextPaymentTs = obj.current_period_end ? new Date(obj.current_period_end * 1000).toISOString() : null
          const patch: Record<string, unknown> = { fecha_proximo_pago: nextPaymentTs, updated_at: new Date().toISOString() }
          if (typeof obj.id === 'string' && obj.id.startsWith('sub_')) patch.stripe_subscription_id = obj.id
          let encender = false
          if (obj.status === 'active' || obj.status === 'trialing') { patch.estado = 'active'; encender = true }
          else if (obj.status === 'past_due') patch.estado = 'past_due'
          else if (obj.status === 'unpaid') patch.estado = 'unpaid'
          else if (obj.status === 'canceled') patch.estado = 'canceled'
          await supabase.from('suscripciones_socio').update(patch).eq('socio_id', socio.id)
          if (encender) await supabase.from('socios').update({ marketplace_activo: true }).eq('id', socio.id)
          else if (obj.status === 'canceled' || obj.status === 'unpaid') await supabase.from('socios').update({ marketplace_activo: false }).eq('id', socio.id)
        }
      }

      return new Response(JSON.stringify({ received: true, branch: 'socio' }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      })
    }

    // =====================================================================
    // ============= RAMA TIENDA (restaurante) =============================
    // =====================================================================
    if (event.type === 'invoice.payment_succeeded') {
      if (!subId) return new Response('ok', { status: 200 })
      const nextPaymentTs = obj.period_end ? new Date(obj.period_end * 1000).toISOString() : null
      await supabase.from('suscripciones_tienda').update({
        intentos_fallidos: 0,
        estado: 'active',
        fecha_proximo_pago: nextPaymentTs,
        ultima_factura_stripe_id: obj.id,
      }).eq('stripe_subscription_id', subId)
      const { data: susc } = await supabase.from('suscripciones_tienda').select('establecimiento_id').eq('stripe_subscription_id', subId).maybeSingle()
      if (susc?.establecimiento_id) {
        await supabase.from('establecimientos').update({
          plan_pro: true,
          plan_pro_activado_en: new Date().toISOString(),
        }).eq('id', susc.establecimiento_id)
      }
    }
    else if (event.type === 'invoice.payment_failed') {
      if (!subId) return new Response('ok', { status: 200 })
      const { data: susc } = await supabase.from('suscripciones_tienda')
        .select('id, establecimiento_id, intentos_fallidos').eq('stripe_subscription_id', subId).maybeSingle()
      if (susc) {
        const nuevos = (susc.intentos_fallidos || 0) + 1
        const nuevoEstado = nuevos >= 3 ? 'unpaid' : 'past_due'
        await supabase.from('suscripciones_tienda').update({
          intentos_fallidos: nuevos,
          estado: nuevoEstado,
        }).eq('id', susc.id)
        if (nuevos >= 3) {
          await supabase.from('establecimientos').update({ plan_pro: false }).eq('id', susc.establecimiento_id)
          const { data: est } = await supabase.from('establecimientos').select('user_id, nombre').eq('id', susc.establecimiento_id).maybeSingle()
          if (est?.user_id) {
            await callEnviarPush(supabaseUrl, serviceKey, {
              user_id: est.user_id,
              titulo: 'Pago fallido — plan tienda pública desactivado',
              mensaje: `No hemos podido cobrar tu suscripción. Actualiza tu método de pago en el panel.`,
            })
          }
        }
      }
    }
    else if (event.type === 'customer.subscription.deleted') {
      const { data: susc } = await supabase.from('suscripciones_tienda')
        .select('establecimiento_id').eq('stripe_subscription_id', subId).maybeSingle()
      await supabase.from('suscripciones_tienda').update({ estado: 'canceled' }).eq('stripe_subscription_id', subId)
      if (susc?.establecimiento_id) {
        await supabase.from('establecimientos').update({ plan_pro: false }).eq('id', susc.establecimiento_id)
      }
    }
    else if (event.type === 'customer.subscription.updated') {
      const nextPaymentTs = obj.current_period_end ? new Date(obj.current_period_end * 1000).toISOString() : null
      const patch: Record<string, unknown> = { fecha_proximo_pago: nextPaymentTs }
      if (obj.status === 'active') patch.estado = 'active'
      else if (obj.status === 'past_due') patch.estado = 'past_due'
      else if (obj.status === 'unpaid') patch.estado = 'unpaid'
      else if (obj.status === 'canceled') patch.estado = 'canceled'
      await supabase.from('suscripciones_tienda').update(patch).eq('stripe_subscription_id', subId)
    }

    return new Response(JSON.stringify({ received: true, branch: 'tienda' }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('webhook handler error:', err)
    return new Response('handler error', { status: 500 })
  }
})
