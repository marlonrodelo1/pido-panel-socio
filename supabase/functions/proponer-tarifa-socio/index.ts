import { createClient } from 'jsr:@supabase/supabase-js@2';

// proponer-tarifa-socio v4 — BIDIRECCIONAL (modelo 19-jun: por defecto propone el SOCIO).
// Incluye comision_pct (% del pedido que cobra el socio; default 10, editable).

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
    const auth = req.headers.get('Authorization') || '';
    const token = auth.replace('Bearer ', '').trim();
    if (!token) return json({ error: 'no token' }, 401);

    const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: `Bearer ${token}` } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: 'sesion invalida' }, 401);

    const body = await req.json();
    const { socio_establecimiento_id, tarifa_base, tarifa_radio_base_km, tarifa_precio_km, tarifa_maxima, motivo } = body;
    if (!socio_establecimiento_id) return json({ error: 'socio_establecimiento_id requerido' }, 400);
    if (tarifa_base == null || tarifa_radio_base_km == null || tarifa_precio_km == null) {
      return json({ error: 'tarifa_base, tarifa_radio_base_km y tarifa_precio_km son obligatorios' }, 400);
    }
    const tb = Number(tarifa_base);
    const trb = Number(tarifa_radio_base_km);
    const tpk = Number(tarifa_precio_km);
    const tm = tarifa_maxima == null ? null : Number(tarifa_maxima);
    if ([tb, trb, tpk].some((v) => !Number.isFinite(v) || v < 0) || (tm !== null && (!Number.isFinite(tm) || tm < 0))) {
      return json({ error: 'tarifas deben ser numeros >= 0' }, 400);
    }
    const cp = body.comision_pct == null ? 10 : Number(body.comision_pct);
    if (!Number.isFinite(cp) || cp < 0 || cp > 100) {
      return json({ error: 'comision_pct debe estar entre 0 y 100' }, 400);
    }

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    const { data: vinc } = await admin.from('socio_establecimiento')
      .select('id, socio_id, establecimiento_id, estado, tarifa_base, tarifa_radio_base_km, tarifa_precio_km, tarifa_maxima, comision_pct, socios(user_id)')
      .eq('id', socio_establecimiento_id).maybeSingle();
    if (!vinc) return json({ error: 'vinculacion no encontrada' }, 404);
    if (vinc.estado !== 'activa') return json({ error: 'la vinculacion debe estar activa para proponer cambios de tarifa' }, 400);

    const { data: est } = await admin.from('establecimientos').select('id, nombre, user_id').eq('id', vinc.establecimiento_id).maybeSingle();
    if (!est) return json({ error: 'establecimiento no encontrado' }, 404);
    const socioUserId = (vinc.socios as any)?.user_id ?? null;

    const { data: rol } = await admin.from('usuarios').select('rol').eq('id', user.id).maybeSingle();
    const isSuperadmin = rol?.rol === 'superadmin' || rol?.rol === 'admin';
    const esRestaurante = est.user_id === user.id;
    const esSocio = socioUserId === user.id;
    if (!esRestaurante && !esSocio && !isSuperadmin) {
      return json({ error: 'sin permiso sobre esta vinculacion' }, 403);
    }

    let origen: 'socio' | 'restaurante' = esSocio ? 'socio' : esRestaurante ? 'restaurante' : (body.origen === 'restaurante' ? 'restaurante' : 'socio');

    const ahora = new Date().toISOString();
    const expira = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const nuevaTarifa = { tarifa_base: tb, tarifa_radio_base_km: trb, tarifa_precio_km: tpk, tarifa_maxima: tm, comision_pct: cp };

    const { data: updated, error } = await admin.from('socio_establecimiento')
      .update({
        tarifa_pendiente: nuevaTarifa,
        tarifa_pendiente_at: ahora,
        tarifa_pendiente_origen: origen,
        tarifa_pendiente_expira_en: expira,
        updated_at: ahora,
      })
      .eq('id', socio_establecimiento_id)
      .select()
      .single();
    if (error) throw error;

    const tarifaAnterior = {
      tarifa_base: vinc.tarifa_base,
      tarifa_radio_base_km: vinc.tarifa_radio_base_km,
      tarifa_precio_km: vinc.tarifa_precio_km,
      tarifa_maxima: vinc.tarifa_maxima,
      comision_pct: vinc.comision_pct,
    };

    await admin.from('socio_establecimiento_tarifa_log').insert({
      socio_id: vinc.socio_id,
      establecimiento_id: vinc.establecimiento_id,
      evento: 'propuesta_creada',
      origen,
      tarifa_anterior: tarifaAnterior,
      tarifa_nueva: nuevaTarifa,
      motivo: motivo || (origen === 'socio' ? 'El repartidor propone una tarifa.' : 'El restaurante propone una tarifa.'),
      created_by: user.id,
    });

    const destinatario = origen === 'socio' ? est.user_id : socioUserId;
    const quienPropone = origen === 'socio' ? 'Tu repartidor' : est.nombre;
    if (destinatario) {
      await admin.from('notificaciones').insert({
        user_id: destinatario,
        titulo: 'Nueva propuesta de tarifa de reparto',
        cuerpo: `${quienPropone} propone una nueva tarifa de reparto. Tienes 7 dias para aceptarla o rechazarla; si no, se aplicara automaticamente.`,
        url: origen === 'socio' ? '/socios-riders' : '/restaurantes',
        leida: false,
      });
    }

    return json({ ok: true, origen, vinculacion: updated, tarifa_anterior: tarifaAnterior, tarifa_propuesta: nuevaTarifa, expira_en: expira });
  } catch (err: any) {
    console.error('[proponer-tarifa-socio]', err);
    return json({ error: err.message }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}
