import { createClient } from 'jsr:@supabase/supabase-js@2';

// admin-system-health v1
// Devuelve metricas de salud de la infraestructura para el super-admin.
// Auth: solo usuarios con rol 'superadmin'.
// Los datos (cron.*, pg_*) se obtienen via RPC SECURITY DEFINER admin_system_health().

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  try {
    // 1. Auth: validar que el caller es superadmin
    const auth = req.headers.get('Authorization') || '';
    const token = auth.replace('Bearer ', '').trim();
    if (!token) return json({ error: 'no_token' }, 401);

    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) return json({ error: 'sesion_invalida' }, 401);

    const { data: callerRow } = await admin
      .from('usuarios')
      .select('rol')
      .eq('id', user.id)
      .maybeSingle();

    if (callerRow?.rol !== 'superadmin') {
      return json({ error: 'forbidden', message: 'Solo el superadmin puede ver la salud del sistema.' }, 403);
    }

    // 2. Obtener metricas via RPC SECURITY DEFINER
    const { data, error } = await admin.rpc('admin_system_health');
    if (error) {
      console.error('[admin-system-health] rpc error', error);
      return json({ error: 'rpc_failed', message: error.message }, 500);
    }

    return json(data ?? {}, 200);
  } catch (err: any) {
    console.error('[admin-system-health] internal_error', err);
    return json({ error: 'internal_error', message: err?.message || String(err) }, 500);
  }
});
