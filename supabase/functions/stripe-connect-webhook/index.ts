import Stripe from 'npm:stripe@14.0.0';
import { createClient } from 'jsr:@supabase/supabase-js@2';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { apiVersion: '2023-10-16' });
const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);
const WEBHOOK_SECRET = Deno.env.get('STRIPE_WEBHOOK_SECRET_CONNECT')!;

Deno.serve(async (req) => {
  const body = await req.text();
  const sig = req.headers.get('stripe-signature') || '';
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, sig, WEBHOOK_SECRET);
  } catch (err) {
    console.error('[connect-webhook] firma invalida', err);
    return new Response('bad signature', { status: 400 });
  }

  try {
    if (event.type === 'account.updated') {
      const acc = event.data.object as Stripe.Account;
      const estId = acc.metadata?.establecimiento_id;
      if (!estId) return new Response('ok (sin metadata)', { status: 200 });

      const onboardingCompleto = !!(acc.details_submitted && acc.charges_enabled && acc.payouts_enabled);
      const status = onboardingCompleto ? 'activa' : (acc.details_submitted ? 'pendiente' : 'onboarding');

      await supabase
        .from('establecimientos')
        .update({
          stripe_connect_status: status,
          stripe_connect_onboarded_at: onboardingCompleto ? new Date().toISOString() : null,
        })
        .eq('id', estId);
    }

    if (event.type === 'transfer.updated' || event.type === 'transfer.reversed') {
      const tr = event.data.object as Stripe.Transfer;
      const reversed = (tr as any).reversed === true;
      const amountReversed = (tr as any).amount_reversed || 0;
      let status: string | null = null;
      let errorMsg: string | null = null;

      if (event.type === 'transfer.reversed' || reversed) {
        status = 'reversed';
        errorMsg = `reversed (amount_reversed: ${amountReversed})`;
      } else if ((tr as any).failure_message) {
        status = 'failed';
        errorMsg = (tr as any).failure_message;
      } else {
        status = 'updated';
      }

      await supabase
        .from('facturas_semanales')
        .update({
          stripe_transfer_status: status,
          error_mensaje: errorMsg,
        })
        .eq('stripe_transfer_id', tr.id);
    }

    return new Response('ok', { status: 200 });
  } catch (err) {
    console.error('[connect-webhook] proceso', err);
    return new Response('err', { status: 500 });
  }
});
