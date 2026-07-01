import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const RESERVED = ['admin','panel','socios','socio','app','api','www','pidoo','login','signup','eliminar-cuenta','privacidad','terminos','come-y-calla','s','r'];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const auth = req.headers.get('Authorization') || '';
    const token = auth.replace('Bearer ', '').trim();
    if (!token) return json({ error: 'no token' }, 401);

    const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: `Bearer ${token}` } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: 'sesion invalida' }, 401);

    const { slug, check_only } = await req.json();
    if (!slug) return json({ error: 'slug requerido' }, 400);

    const clean = String(slug).toLowerCase().trim().replace(/[^a-z0-9-]/g, '-').replace(/-+/g,'-').replace(/^-|-$/g,'');
    if (clean.length < 3 || clean.length > 40) return json({ error: 'slug debe tener 3-40 caracteres', disponible: false }, 400);
    if (RESERVED.includes(clean)) return json({ error: 'slug reservado', disponible: false }, 400);

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: existing } = await admin.from('socios').select('id, user_id').eq('slug', clean).maybeSingle();
    if (existing && existing.user_id !== user.id) {
      return json({ disponible: false, slug: clean, motivo: 'ocupado' });
    }
    if (check_only) return json({ disponible: true, slug: clean });

    const { data: socio } = await admin.from('socios').select('id').eq('user_id', user.id).maybeSingle();
    if (!socio) return json({ error: 'no eres socio' }, 403);

    const { error } = await admin.from('socios').update({ slug: clean }).eq('id', socio.id);
    if (error) throw error;

    return json({ ok: true, slug: clean });
  } catch (err: any) {
    console.error('[reserve-socio-slug]', err);
    return json({ error: err.message }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}
