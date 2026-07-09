import { createClient } from 'jsr:@supabase/supabase-js@2';

// reconciliar-reembolsos v1 (9 jul 2026)
// Cron (cada 5 min, via cron_dispatcher_5min): RED DE SEGURIDAD UNIVERSAL de reembolsos.
// Barre pedidos YA CANCELADOS (o fallidos) pagados con TARJETA cuyo reembolso nunca
// llegó a emitirse — p.ej. el refund fire-and-forget del panel restaurante falló
// (rechazarPedido / cancelarPedidoActivo / autoCancelarPedido) o cualquier otro camino
// que cancele sin devolver. Cierra TODOS los casos "cliente cobrado sin devolución".
//
// FILTRO: metodo_pago='tarjeta' AND estado IN ('cancelado','fallido')
//   AND stripe_payment_id IS NOT NULL AND stripe_refund_id IS NULL
//   AND (cancelado_at, o created_at si nulo) < now() - RECONCILIAR_MIN
//   (margen para que el refund inmediato del panel/manual persista antes de barrer).
//
// ANTI-DOBLE-REEMBOLSO (3 capas):
//   1) GET /v1/refunds?payment_intent= → si YA existe un refund vivo en Stripe
//      (p.ej. crear_reembolso_stripe lo emitió pero su UPDATE en BD falló y quedó
//      stripe_refund_id NULL), NO se crea otro: se BACKFILLEA la BD con ese refund.
//   2) POST /v1/refunds con Idempotency-Key 'refund-<pedido_id>' (la misma key que
//      usan auto-cancelar/rescatar/recuperar → un reintento devuelve el MISMO refund).
//   3) UPDATE condicional .is('stripe_refund_id', null) → si otro actor persistió
//      entre medias, 0 filas y no se pisa nada.
//
// Solo reembolsa si el PaymentIntent está 'succeeded' (cobro real). NO cambia estado
// ni motivo_cancelacion (el pedido ya estaba cancelado). Notifica al cliente SOLO si
// el refund lo creó esta función (el backfill es reparación silenciosa de BD).
// Auth: x-cron-secret == CRON_SECRET (fail-closed si la env está vacía).

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRET = Deno.env.get('CRON_SECRET') || '';
const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY') || '';
const RECONCILIAR_MIN = Number(Deno.env.get('RECONCILIAR_REEMBOLSOS_MIN') || '10');

const ESTADOS_OBJETIVO = ['cancelado', 'fallido'];

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
function json(b, s = 200) {
  return new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

function stripeAuth() { return btoa(`${STRIPE_SECRET_KEY}:`); }

async function getPaymentIntentStatus(id) {
  if (!STRIPE_SECRET_KEY) return null;
  const r = await fetch(`https://api.stripe.com/v1/payment_intents/${id}`, {
    headers: { Authorization: `Basic ${stripeAuth()}` },
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j?.error?.message || 'pi_fetch_failed');
  return j?.status || null;
}

// Refund ya existente para este PaymentIntent (pending o succeeded cuentan como vivos;
// failed/canceled NO — en ese caso hay que emitir uno nuevo).
async function getExistingRefund(paymentIntentId) {
  const r = await fetch(`https://api.stripe.com/v1/refunds?payment_intent=${paymentIntentId}&limit=10`, {
    headers: { Authorization: `Basic ${stripeAuth()}` },
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j?.error?.message || 'refund_list_failed');
  return (j?.data || []).find((x) => x?.status === 'succeeded' || x?.status === 'pending') || null;
}

async function refundStripe(paymentIntentId, amount, idemKey) {
  const params = new URLSearchParams();
  params.append('payment_intent', paymentIntentId);
  if (amount) params.append('amount', Math.round(amount * 100).toString());
  const headers = { Authorization: `Basic ${stripeAuth()}`, 'Content-Type': 'application/x-www-form-urlencoded' };
  if (idemKey) headers['Idempotency-Key'] = idemKey;
  const r = await fetch('https://api.stripe.com/v1/refunds', {
    method: 'POST',
    headers,
    body: params.toString(),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j?.error?.message || 'refund_failed');
  return j;
}

async function enviarPush(payload) {
  try {
    await fetch(`${SUPABASE_URL}/functions/v1/enviar_push`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SERVICE_KEY}` },
      body: JSON.stringify(payload),
    });
  } catch (_) { /* best-effort */ }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  try {
    const secret = req.headers.get('x-cron-secret') || '';
    if (!CRON_SECRET || secret !== CRON_SECRET) return json({ error: 'no_autorizado' }, 401);

    const limite = new Date(Date.now() - RECONCILIAR_MIN * 60000).toISOString();
    const { data: pendientes, error: selErr } = await admin.from('pedidos')
      .select('id, codigo, usuario_id, establecimiento_id, total, estado, stripe_payment_id, cancelado_at, created_at')
      .eq('metodo_pago', 'tarjeta')
      .in('estado', ESTADOS_OBJETIVO)
      .not('stripe_payment_id', 'is', null)
      .is('stripe_refund_id', null)
      .or(`cancelado_at.lt.${limite},and(cancelado_at.is.null,created_at.lt.${limite})`)
      .limit(25);
    if (selErr) return json({ error: 'select_failed', message: selErr.message }, 500);

    const ahora = new Date().toISOString();
    let reembolsados = 0, backfilleados = 0;
    const omitidos = [];
    const errores = [];

    for (const p of pendientes || []) {
      try {
        // 1) ¿Ya existe un refund vivo en Stripe? → solo backfill, no crear otro.
        let refund = await getExistingRefund(p.stripe_payment_id);
        let creado = false;

        if (!refund) {
          // 2) Solo reembolsar cobros reales.
          const status = await getPaymentIntentStatus(p.stripe_payment_id);
          if (status !== 'succeeded') {
            omitidos.push({ pedido_id: p.id, codigo: p.codigo, motivo: `pi_status_${status || 'desconocido'}` });
            continue;
          }
          refund = await refundStripe(p.stripe_payment_id, Number(p.total) || 0, `refund-${p.id}`);
          creado = true;
        }
        if (!refund?.id) throw new Error('refund_sin_id');

        // 3) Persistir condicional (no pisar si otro actor lo grabó entre medias).
        const monto = refund.amount != null ? refund.amount / 100 : (Number(p.total) || 0);
        const { data: rows, error: updErr } = await admin.from('pedidos')
          .update({ stripe_refund_id: refund.id, monto_reembolsado: monto, reembolsado_at: ahora })
          .eq('id', p.id)
          .is('stripe_refund_id', null)
          .select('id');
        if (updErr) throw new Error(`update: ${updErr.message}`);
        if (!rows || rows.length === 0) continue; // ya persistido por otro actor

        if (creado) reembolsados++; else backfilleados++;

        // 4) Avisar al cliente SOLO si el refund lo emitimos aquí.
        if (creado && p.usuario_id) {
          const importe = monto.toFixed(2);
          const { error: nErr } = await admin.from('notificaciones').insert({
            usuario_id: p.usuario_id,
            titulo: 'Reembolso emitido',
            descripcion: `Te hemos reembolsado ${importe} € del pedido ${p.codigo}. Lo verás en tu cuenta en 5-10 días hábiles.`,
            tipo: 'pedido_reembolsado',
            data: { pedido_id: p.id, codigo: p.codigo, monto, via: 'reconciliacion' },
          });
          if (nErr) console.error('[reconciliar] notif cliente', nErr.message);
          await enviarPush({
            target_type: 'cliente', target_id: p.usuario_id,
            title: 'Reembolso emitido',
            body: `Te hemos reembolsado ${importe} € del pedido ${p.codigo}.`,
            data: { tipo: 'pedido_reembolsado', pedido_id: p.id, codigo: p.codigo },
          });
        }
      } catch (e) {
        console.error('[reconciliar] pedido', p.id, e);
        errores.push({ pedido_id: p.id, codigo: p.codigo, error: String(e?.message ?? e) });
      }
    }

    return json({
      ok: true,
      ventana_min: RECONCILIAR_MIN,
      encontrados: pendientes?.length || 0,
      reembolsados,
      backfilleados,
      omitidos,
      errores,
    });
  } catch (err) {
    console.error('[reconciliar-reembolsos]', err);
    return json({ error: 'internal_error', message: err?.message || String(err) }, 500);
  }
});
