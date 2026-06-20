import { createClient } from 'jsr:@supabase/supabase-js@2';

// desvincular-socio-establecimiento v1
// El SOCIO (o un superadmin) cancela la vinculación con un restaurante.
// Borra la fila socio_establecimiento (service role, salta RLS) y NOTIFICA al
// restaurante (inserta en notificaciones + push best-effort).
// verify_jwt=false: validamos el token a mano (igual que el resto de edges del flujo).

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const token = (req.headers.get('Authorization') || '').replace('Bearer ', '').trim();
    if (!token) return json({ error: 'no token' }, 401);

    const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: `Bearer ${token}` } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: 'sesion invalida' }, 401);

    const { socio_establecimiento_id } = await req.json();
    if (!socio_establecimiento_id) return json({ error: 'socio_establecimiento_id requerido' }, 400);

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    const { data: vinc } = await admin.from('socio_establecimiento')
      .select('id, socio_id, establecimiento_id, socios(user_id, nombre, nombre_comercial)')
      .eq('id', socio_establecimiento_id).maybeSingle();
    if (!vinc) return json({ error: 'vinculacion no encontrada' }, 404);

    const socioUserId = (vinc.socios as any)?.user_id ?? null;
    const { data: rol } = await admin.from('usuarios').select('rol').eq('id', user.id).maybeSingle();
    const isSuperadmin = rol?.rol === 'superadmin' || rol?.rol === 'admin';

    // Solo el dueño del socio (o superadmin) puede desvincular.
    if (socioUserId !== user.id && !isSuperadmin) {
      return json({ error: 'sin permiso sobre esta vinculacion' }, 403);
    }

    const { data: est } = await admin.from('establecimientos')
      .select('user_id, nombre').eq('id', vinc.establecimiento_id).maybeSingle();

    // Borrar la vinculación.
    const { error: delErr } = await admin.from('socio_establecimiento').delete().eq('id', socio_establecimiento_id);
    if (delErr) throw delErr;

    // Notificar al restaurante.
    const socioNombre = (vinc.socios as any)?.nombre_comercial || (vinc.socios as any)?.nombre || 'Un repartidor';
    if (est?.user_id) {
      try {
        await admin.from('notificaciones').insert({
          usuario_id: est.user_id,
          titulo: 'Un repartidor se ha desvinculado',
          descripcion: `${socioNombre} ha cancelado la vinculacion con tu restaurante y ya no repartira tus pedidos.`,
          tipo: 'desvinculacion',
          data: { url: '/socios-riders' },
          leida: false,
        });
      } catch (e) { console.error('[desvincular] notificacion', e); }

      try {
        await fetch(`${SUPABASE_URL}/functions/v1/enviar_push`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SERVICE_KEY}` },
          body: JSON.stringify({
            target_type: 'restaurante',
            target_id: vinc.establecimiento_id,
            title: 'Repartidor desvinculado',
            body: `${socioNombre} ha cancelado la vinculacion con tu restaurante.`,
            data: { url: '/socios-riders' },
          }),
        });
      } catch (e) { console.error('[desvincular] push', e); }
    }

    return json({ ok: true });
  } catch (err: any) {
    console.error('[desvincular-socio-establecimiento]', err);
    return json({ error: err.message }, 500);
  }
});
