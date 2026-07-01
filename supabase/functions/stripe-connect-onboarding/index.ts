import Stripe from 'npm:stripe@14.0.0';
import { createClient } from 'jsr:@supabase/supabase-js@2';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { apiVersion: '2023-10-16' });
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const authHeader = req.headers.get('Authorization') || '';
    const token = authHeader.replace('Bearer ', '').trim();
    if (!token) return json({ error: 'no token' }, 401);

    // 1. Validar usuario con su JWT
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) return json({ error: 'sesion invalida' }, 401);

    const { establecimiento_id, return_url, refresh_url } = await req.json();
    if (!establecimiento_id) return json({ error: 'establecimiento_id requerido' }, 400);

    // 2. Verificar con service role que el user es dueno del establecimiento o superadmin
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: est, error: eErr } = await admin
      .from('establecimientos')
      .select('id, nombre, email, user_id, stripe_connect_account_id')
      .eq('id', establecimiento_id)
      .single();
    if (eErr || !est) return json({ error: 'establecimiento no encontrado' }, 404);

    const { data: rolRow } = await admin.from('usuarios').select('rol').eq('id', user.id).maybeSingle();
    const isSuperadmin = rolRow?.rol === 'superadmin' || rolRow?.rol === 'admin';
    if (est.user_id !== user.id && !isSuperadmin) {
      return json({ error: 'sin permiso sobre este establecimiento' }, 403);
    }

    // 3. Crear cuenta Stripe si no existe
    let accountId = est.stripe_connect_account_id;
    if (!accountId) {
      const account = await stripe.accounts.create({
        type: 'express',
        country: 'ES',
        email: est.email || user.email || undefined,
        business_type: 'company',
        capabilities: { transfers: { requested: true } },
        business_profile: {
          name: est.nombre,
          product_description: 'Restaurante marketplace Pidoo',
        },
        metadata: { establecimiento_id: est.id },
      });
      accountId = account.id;
      await admin.from('establecimientos').update({
        stripe_connect_account_id: accountId,
        stripe_connect_status: 'onboarding',
      }).eq('id', establecimiento_id);
    }

    // 4. Generar link de onboarding
    const link = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: refresh_url || 'https://panel.pidoo.es/finanzas?refresh=1',
      return_url: return_url || 'https://panel.pidoo.es/finanzas?onboarded=1',
      type: 'account_onboarding',
    });

    return json({ url: link.url, account_id: accountId });
  } catch (err) {
    console.error('[stripe-connect-onboarding]', err);
    return json({ error: err.message }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}
