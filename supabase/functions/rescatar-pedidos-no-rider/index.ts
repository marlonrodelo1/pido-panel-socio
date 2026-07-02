import { createClient } from 'jsr:@supabase/supabase-js@2';

// rescatar-pedidos-no-rider v1 (2 jul 2026)
// Cron (cada 5 min): rescata pedidos PAGADOS que quedaron sin repartidor (limbo).
//
// CONTEXTO: cuando el dispatcher agota los 3 intentos de asignacion, reassign-pedido-v2
// marca shipday_status='no_rider' + push al superadmin... y nada mas. El cliente ya pago
// y el pedido queda colgado para siempre. Esta funcion cierra ese hueco.
// Politica (elegida por Marlon, 30 jun): cancelar + reembolso automatico + aviso al cliente.
//
// FILTRO: modo_entrega='delivery' AND shipday_status='no_rider'
//   AND estado IN ('nuevo','preparando','listo')   <- NO toca recogido/en_camino (ya hay rider)
//   AND stripe_refund_id IS NULL
//   AND ultimo intento de asignacion (assigned_at, o created_at si nunca se asigno)
//       anterior a now() - RESCATE_NO_RIDER_MIN (default 10 min)
//   La ventana de espera da margen a que el superadmin (que ya recibio push de no_rider)
//   reasigne a mano antes de que se cancele.
//
// SEGURIDAD ANTI-DOBLE-REEMBOLSO:
//   1. El refund Stripe SIEMPRE lleva Idempotency-Key 'refund-<pedido_id>': aunque esta
//      funcion se ejecute dos veces sobre el mismo pedido, Stripe devuelve el MISMO refund.
//   2. El UPDATE a 'cancelado' es condicional (WHERE estado IN (...)): una segunda pasada
//      o una accion simultanea del restaurante no lo pisa.
//   3. Orden refund->persistir: si persistir falla, la siguiente pasada repite el refund
//      (idempotente, mismo refund) y reintenta persistir. Nunca se pierde un reembolso.
//
// Auth: x-cron-secret == CRON_SECRET.

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRET = Deno.env.get('CRON_SECRET') || '';
const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY') || '';
const RESCATE_MIN = Number(Deno.env.get('RESCATE_NO_RIDER_MIN') || '10');

const ESTADOS_RESCATABLES = ['nuevo', 'preparando', 'listo'];

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

async function pushCliente(usuario_id, title, body, data) {
  if (!usuario_id) return;
  try {
    await fetch(`${SUPABASE_URL}/functions/v1/enviar_push`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SERVICE_KEY}` },
      body: JSON.stringify({ target_type: 'cliente', target_id: usuario_id, title, body, data }),
    });
  } catch (_) { /* best-effort */ }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  try {
    const secret = req.headers.get('x-cron-secret') || '';
    if (!CRON_SECRET || secret !== CRON_SECRET) return json({ error: 'no_autorizado' }, 401);

    const limite = new Date(Date.now() - RESCATE_MIN * 60000).toISOString();
    const { data: limbo, error: selErr } = await admin.from('pedidos')
      .select('id, codigo, usuario_id, establecimiento_id, metodo_pago, total, estado, stripe_payment_id, stripe_refund_id, assigned_at, created_at')
      .eq('modo_entrega', 'delivery')
      .eq('shipday_status', 'no_rider')
      .in('estado', ESTADOS_RESCATABLES)
      .is('stripe_refund_id', null)
      .or(`assigned_at.lt.${limite},and(assigned_at.is.null,created_at.lt.${limite})`)
      .limit(25);
    if (selErr) return json({ error: 'select_failed', message: selErr.message }, 500);

    const ahora = new Date().toISOString();
    let cancelados = 0, reembolsados = 0;
    const errores = [];

    for (const p of limbo || []) {
      try {
        let refundId = null;

        // 1) Reembolso primero (idempotente): si luego falla persistir, la proxima pasada
        //    repite este refund con la MISMA key y Stripe devuelve el mismo objeto.
        if (p.stripe_payment_id) {
          let status = null;
          try { status = await getPaymentIntentStatus(p.stripe_payment_id); } catch (e) { console.error('[rescate] pi', p.id, e); }
          if (status === 'succeeded') {
            const refund = await refundStripe(p.stripe_payment_id, Number(p.total) || 0, `refund-${p.id}`);
            refundId = refund?.id || null;
          }
        }

        // 2) Cancelacion CONDICIONAL: solo si sigue en un estado rescatable.
        const upd = {
          estado: 'cancelado',
          cancelado_at: ahora,
          motivo_cancelacion: refundId
            ? 'Sin repartidor disponible: pedido cancelado y reembolsado automáticamente'
            : 'Sin repartidor disponible: pedido cancelado automáticamente',
        };
        if (refundId) { upd.stripe_refund_id = refundId; upd.monto_reembolsado = Number(p.total) || 0; upd.reembolsado_at = ahora; }
        const { data: rows, error: updErr } = await admin.from('pedidos')
          .update(upd)
          .eq('id', p.id)
          .in('estado', ESTADOS_RESCATABLES)
          .select('id');
        if (updErr) throw new Error(`update: ${updErr.message}`);
        if (!rows || rows.length === 0) {
          // Alguien lo movio mientras tanto (reasignacion manual, otro cron). No tocar.
          // Si hubo refund, la fila conserva stripe_refund_id=null pero el refund existe en
          // Stripe con key refund-<id>; la siguiente pasada NO lo re-emite (misma key) y
          // como el pedido ya no esta en estado rescatable, queda para revision manual.
          if (refundId) errores.push({ pedido_id: p.id, error: 'refund_emitido_pero_pedido_cambio_de_estado', refund_id: refundId });
          continue;
        }

        // 3) Avisos (best-effort, no bloquean).
        const importe = (Number(p.total) || 0).toFixed(2);
        if (p.usuario_id) {
          await admin.from('notificaciones').insert({
            usuario_id: p.usuario_id,
            titulo: refundId ? 'Pedido cancelado y reembolsado' : 'Pedido cancelado',
            descripcion: refundId
              ? `Lo sentimos: ningún repartidor pudo aceptar tu pedido ${p.codigo}. Te hemos reembolsado ${importe} €.`
              : `Lo sentimos: ningún repartidor pudo aceptar tu pedido ${p.codigo}. No se te ha cobrado nada.`,
            tipo: 'pedido_cancelado',
            data: { pedido_id: p.id, codigo: p.codigo, motivo: 'no_rider', reembolsado: !!refundId },
          }).catch((e) => console.error('[rescate] notif cliente', e));
          await pushCliente(
            p.usuario_id,
            refundId ? 'Pedido cancelado y reembolsado' : 'Pedido cancelado',
            refundId
              ? `Ningún repartidor pudo aceptar tu pedido ${p.codigo}. Te hemos reembolsado ${importe} €.`
              : `Ningún repartidor pudo aceptar tu pedido ${p.codigo}.`,
            { tipo: 'pedido_cancelado', pedido_id: p.id, codigo: p.codigo },
          );
        }
        if (p.establecimiento_id) {
          await admin.from('notificaciones').insert({
            establecimiento_id: p.establecimiento_id,
            titulo: `Pedido ${p.codigo} cancelado: sin repartidor`,
            descripcion: `No se encontró repartidor para el pedido ${p.codigo}. Se canceló${refundId ? ' y se reembolsó al cliente' : ''} automáticamente. No lo prepares.`,
            tipo: 'pedido_cancelado',
            data: { pedido_id: p.id, codigo: p.codigo, motivo: 'no_rider' },
          }).catch((e) => console.error('[rescate] notif restaurante', e));
        }

        cancelados++;
        if (refundId) reembolsados++;
      } catch (e) {
        console.error('[rescate] pedido', p.id, e);
        errores.push({ pedido_id: p.id, error: String(e?.message ?? e) });
      }
    }

    return json({ ok: true, ventana_min: RESCATE_MIN, encontrados: limbo?.length || 0, cancelados, reembolsados, errores });
  } catch (err) {
    console.error('[rescatar-pedidos-no-rider]', err);
    return json({ error: 'internal_error', message: err?.message || String(err) }, 500);
  }
});
