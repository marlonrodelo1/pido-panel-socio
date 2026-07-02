import { createClient } from 'jsr:@supabase/supabase-js@2';

// recuperar-pagos-huerfanos v2
// Cron (cada 5 min): resuelve pedidos atascados en 'pendiente_pago'.
// - Con payment_intent y Stripe='succeeded' -> reembolsar + cancelar + avisar.
// - Sin pago / sin payment_intent -> cancelar (sin dinero).
// Auth: x-cron-secret == CRON_SECRET.
// v2 (2 jul 2026): Idempotency-Key en el refund Stripe (refund-<pedido_id>) —
//   dos pasadas del cron sobre el mismo pedido ya no pueden duplicar el reembolso.

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRET = Deno.env.get('CRON_SECRET') || '';
const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY') || '';
const TIMEOUT_MIN = Number(Deno.env.get('RECUPERAR_HUERFANOS_MIN') || '20');

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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  try {
    const secret = req.headers.get('x-cron-secret') || '';
    if (!CRON_SECRET || secret !== CRON_SECRET) return json({ error: 'no_autorizado' }, 401);

    const limite = new Date(Date.now() - TIMEOUT_MIN * 60000).toISOString();
    const { data: huerfanos, error: selErr } = await admin.from('pedidos')
      .select('id, codigo, usuario_id, metodo_pago, total, stripe_payment_id, stripe_refund_id')
      .eq('estado', 'pendiente_pago')
      .lt('created_at', limite)
      .limit(50);
    if (selErr) return json({ error: 'select_failed', message: selErr.message }, 500);

    const ahora = new Date().toISOString();
    let cancelados = 0, reembolsados = 0;
    const errores = [];

    for (const p of huerfanos || []) {
      try {
        let refundId = null;
        let pago = false;

        if (p.stripe_payment_id && !p.stripe_refund_id) {
          let status = null;
          try { status = await getPaymentIntentStatus(p.stripe_payment_id); } catch (e) { console.error('[recuperar] pi', p.id, e); }
          if (status === 'succeeded') {
            pago = true;
            const refund = await refundStripe(p.stripe_payment_id, Number(p.total) || 0, `refund-${p.id}`);
            refundId = refund?.id || null;
            reembolsados++;
          }
        }

        const upd = {
          estado: 'cancelado',
          cancelado_at: ahora,
          motivo_cancelacion: pago
            ? 'Pago no procesado a tiempo: reembolsado automáticamente'
            : 'Pedido sin completar el pago (cancelado automáticamente)',
        };
        if (refundId) { upd.stripe_refund_id = refundId; upd.monto_reembolsado = Number(p.total) || 0; upd.reembolsado_at = ahora; }
        const { error: updErr } = await admin.from('pedidos').update(upd).eq('id', p.id);
        if (updErr) throw new Error(`update: ${updErr.message}`);

        if (refundId && p.usuario_id) {
          await admin.from('notificaciones').insert({
            usuario_id: p.usuario_id,
            titulo: 'Pedido cancelado y reembolsado',
            descripcion: `No pudimos procesar tu pedido ${p.codigo} a tiempo. Te hemos reembolsado ${(Number(p.total) || 0).toFixed(2)} €.`,
            tipo: 'pedido_cancelado',
            data: { pedido_id: p.id, codigo: p.codigo, motivo: 'pago_huerfano', reembolsado: true },
          }).catch((e) => console.error('[recuperar] notif', e));
        }
        cancelados++;
      } catch (e) {
        console.error('[recuperar] pedido', p.id, e);
        errores.push({ pedido_id: p.id, error: String(e?.message ?? e) });
      }
    }

    return json({ ok: true, timeout_min: TIMEOUT_MIN, encontrados: huerfanos?.length || 0, cancelados, reembolsados, errores });
  } catch (err) {
    console.error('[recuperar-pagos-huerfanos]', err);
    return json({ error: 'internal_error', message: err?.message || String(err) }, 500);
  }
});
