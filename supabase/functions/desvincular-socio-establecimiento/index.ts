import { createClient } from 'jsr:@supabase/supabase-js@2';

// desvincular-socio-establecimiento v3
// El SOCIO (o un superadmin) cancela la vinculación con un restaurante.
// ANTES de borrar la vinculación, LIBERA los pedidos activos no entregados de ese
// socio en ese establecimiento (para que no queden huérfanos) y avisa al restaurante
// de qué pedidos requieren reasignación. Luego borra socio_establecimiento (service
// role, salta RLS) y NOTIFICA al restaurante de la desvinculación (notificaciones +
// push dirigido al restaurante).
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

// Estados de pedido que se consideran "vivos" (aún no entregados ni cancelados).
const ESTADOS_CERRADOS = ['entregado', 'cancelado'];
// Estados de asignación todavía abiertos que hay que cerrar al liberar.
const ASIGNACIONES_ABIERTAS = ['esperando_aceptacion', 'aceptado'];

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

    if (socioUserId !== user.id && !isSuperadmin) {
      return json({ error: 'sin permiso sobre esta vinculacion' }, 403);
    }

    const { data: est } = await admin.from('establecimientos')
      .select('user_id, nombre').eq('id', vinc.establecimiento_id).maybeSingle();

    const socioNombre = (vinc.socios as any)?.nombre_comercial || (vinc.socios as any)?.nombre || 'Un repartidor';

    // ── 1. LIBERAR pedidos activos del socio en este establecimiento ──────────
    let pedidosLiberados: { id: string; codigo: string }[] = [];
    try {
      const { data: activos } = await admin.from('pedidos')
        .select('id, codigo, estado')
        .eq('socio_id', vinc.socio_id)
        .eq('establecimiento_id', vinc.establecimiento_id)
        .not('estado', 'in', `(${ESTADOS_CERRADOS.join(',')})`);

      pedidosLiberados = (activos || []).map((p: any) => ({ id: p.id, codigo: p.codigo }));

      if (pedidosLiberados.length) {
        const ids = pedidosLiberados.map((p) => p.id);

        const { error: relErr } = await admin.from('pedidos').update({
          socio_id: null,
          rider_account_id: null,
          shipday_status: 'no_rider',
          assigned_at: null,
        }).in('id', ids);
        if (relErr) console.error('[desvincular] liberar pedidos', relErr);

        try {
          await admin.from('pedido_asignaciones').update({
            estado: 'cancelado_manual',
            motivo_rechazo: 'socio_desvinculado',
            resolved_at: new Date().toISOString(),
          })
            .in('pedido_id', ids)
            .eq('socio_id', vinc.socio_id)
            .in('estado', ASIGNACIONES_ABIERTAS);
        } catch (e) { console.error('[desvincular] cerrar asignaciones', e); }
      }
    } catch (e) {
      console.error('[desvincular] liberacion pedidos', e);
    }

    // ── 2. Borrar la vinculación ──────────────────────────────────────────────
    const { error: delErr } = await admin.from('socio_establecimiento').delete().eq('id', socio_establecimiento_id);
    if (delErr) throw delErr;

    // ── 3. Avisar al restaurante de los pedidos que necesitan reasignación ─────
    if (est?.user_id && pedidosLiberados.length) {
      const codigos = pedidosLiberados.map((p) => p.codigo).join(', ');
      try {
        await admin.from('notificaciones').insert({
          usuario_id: est.user_id,
          establecimiento_id: vinc.establecimiento_id,
          titulo: 'Pedidos pendientes de reasignar',
          descripcion: `${socioNombre} se ha desvinculado y los pedidos ${codigos} se han quedado sin repartidor. Reasígnalos a otro socio.`,
          tipo: 'pedidos_sin_rider',
          data: { url: '/socios-riders', pedido_ids: pedidosLiberados.map((p) => p.id), codigos: pedidosLiberados.map((p) => p.codigo) },
          leida: false,
        });
      } catch (e) { console.error('[desvincular] notificacion pedidos', e); }

      try {
        await fetch(`${SUPABASE_URL}/functions/v1/enviar_push`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SERVICE_KEY}` },
          body: JSON.stringify({
            target_type: 'restaurante',
            target_id: vinc.establecimiento_id,
            title: 'Pedidos sin repartidor',
            body: `${socioNombre} se ha desvinculado. Reasigna los pedidos ${codigos}.`,
            data: { url: '/socios-riders' },
          }),
        });
      } catch (e) { console.error('[desvincular] push pedidos', e); }
    }

    // ── 4. Notificar al restaurante de la desvinculación (lógica existente) ────
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

    return json({ ok: true, pedidos_liberados: pedidosLiberados.length });
  } catch (err: any) {
    console.error('[desvincular-socio-establecimiento]', err);
    return json({ error: err.message }, 500);
  }
});
