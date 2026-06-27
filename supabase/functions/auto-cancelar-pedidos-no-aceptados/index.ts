import { createClient } from 'jsr:@supabase/supabase-js@2';

// auto-cancelar-pedidos-no-aceptados v1
// Cron (cada 2 min): cancela pedidos PAGADOS que el restaurante no aceptó a tiempo.
// Decision Marlon (27 jun 2026): timeout 10 min → auto-cancelar + reembolsar (tarjeta) + avisar al cliente.
// Objetivo: que el cliente no se quede esperando indefinidamente ni pierda el dinero.
//
// Candidatos: estado='nuevo' (pagado, esperando que el restaurante acepte),
//   aceptado_at IS NULL, cancelado_at IS NULL, created_at < now()-N min.
// Tarjeta -> reembolso Stripe inline (la función crear_reembolso_stripe exige JWT superadmin,
//   por eso aquí reembolsamos directo con STRIPE_SECRET_KEY). Efectivo -> solo cancelar.
// Auth: header x-cron-secret == CRON_SECRET (mismo patrón que liquidacion-semanal).

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRET = Deno.env.get('CRON_SECRET') || '';
const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY') || '';
const TIMEOUT_MIN = Number(Deno.env.get('AUTO_CANCEL_MINUTOS') || '10');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
function json(b: unknown, s = 200) {
  return new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

async function refundStripe(paymentIntentId: string, amount: number) {
  if (!STRIPE_SECRET_KEY) throw new Error('STRIPE_SECRET_KEY no configurada');
  const basicAuth = btoa(`${STRIPE_SECRET_KEY}:`);
  const params = new URLSearchParams();
  params.append('payment_intent', paymentIntentId);
  if (amount) params.append('amount', Math.round(amount * 100).toString());
  const r = await fetch('https://api.stripe.com/v1/refunds', {
    method: 'POST',
    headers: { Authorization: `Basic ${basicAuth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
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
    // Auth: cron-secret
    const secret = req.headers.get('x-cron-secret') || '';
    if (!CRON_SECRET || secret !== CRON_SECRET) return json({ error: 'no_autorizado' }, 401);

    const limite = new Date(Date.now() - TIMEOUT_MIN * 60_000).toISOString();

    // Candidatos: pagados (estado='nuevo'), sin aceptar, no cancelados, viejos
    const { data: candidatos, error: selErr } = await admin.from('pedidos')
      .select('id, codigo, usuario_id, metodo_pago, total, stripe_payment_id, stripe_refund_id')
      .eq('estado', 'nuevo')
      .is('aceptado_at', null)
      .is('cancelado_at', null)
      .lt('created_at', limite)
      .limit(50);
    if (selErr) return json({ error: 'select_failed', message: selErr.message }, 500);

    const ahora = new Date().toISOString();
    let cancelados = 0, reembolsados = 0;
    const errores: any[] = [];

    for (const p of candidatos || []) {
      try {
        let refundId: string | null = null;
        // Reembolso solo si fue tarjeta, tiene payment intent y no se reembolsó ya
        if (p.metodo_pago === 'tarjeta' && p.stripe_payment_id && !p.stripe_refund_id) {
          const refund = await refundStripe(p.stripe_payment_id, Number(p.total) || 0);
          refundId = refund?.id || null;
          reembolsados++;
        }

        const upd: Record<string, unknown> = {
          estado: 'cancelado',
          cancelado_at: ahora,
          motivo_cancelacion: 'Auto-cancelado: el restaurante no aceptó el pedido a tiempo',
        };
        if (refundId) {
          upd.stripe_refund_id = refundId;
          upd.monto_reembolsado = Number(p.total) || 0;
          upd.reembolsado_at = ahora;
        }
        const { error: updErr } = await admin.from('pedidos').update(upd).eq('id', p.id);
        if (updErr) throw new Error(`update: ${updErr.message}`);

        // Avisar al cliente (notificación in-app; las apps leen esta tabla)
        if (p.usuario_id) {
          const desc = refundId
            ? `Tu pedido ${p.codigo} se canceló porque el restaurante no respondió a tiempo. Te hemos reembolsado ${(Number(p.total) || 0).toFixed(2)} €.`
            : `Tu pedido ${p.codigo} se canceló porque el restaurante no respondió a tiempo.`;
          await admin.from('notificaciones').insert({
            usuario_id: p.usuario_id,
            titulo: 'Pedido cancelado',
            descripcion: desc,
            tipo: 'pedido_cancelado',
            data: { pedido_id: p.id, codigo: p.codigo, motivo: 'restaurante_no_acepto', reembolsado: !!refundId },
          }).catch((e) => console.error('[auto-cancelar] notif', e));
        }
        cancelados++;
      } catch (e) {
        console.error('[auto-cancelar] pedido', p.id, e);
        errores.push({ pedido_id: p.id, error: String((e as Error)?.message ?? e) });
      }
    }

    return json({ ok: true, timeout_min: TIMEOUT_MIN, encontrados: candidatos?.length || 0, cancelados, reembolsados, errores });
  } catch (err: any) {
    console.error('[auto-cancelar-pedidos-no-aceptados]', err);
    return json({ error: 'internal_error', message: err?.message || String(err) }, 500);
  }
});
