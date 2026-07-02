import { createClient } from 'jsr:@supabase/supabase-js@2';

// responder-tarifa-pendiente v6 (2 jul 2026) — responde el CONTRARIO al que propuso.
// Aplica tambien comision_pct al aceptar.
// v6: eliminado fallback inseguro cuando tarifa_pendiente_origen es null (permitia al
// proponente auto-aceptar su propia tarifa); ahora 409 origen_propuesta_inconsistente.
// Superadmin sigue pudiendo responder siempre.

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

    const { socio_establecimiento_id, accion, motivo } = await req.json();
    if (!socio_establecimiento_id || !['aceptar', 'rechazar'].includes(accion)) {
      return json({ error: 'socio_establecimiento_id + accion (aceptar|rechazar) requeridos' }, 400);
    }

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    const { data: vinc } = await admin.from('socio_establecimiento')
      .select('id, socio_id, establecimiento_id, estado, tarifa_base, tarifa_radio_base_km, tarifa_precio_km, tarifa_maxima, comision_pct, tarifa_pendiente, tarifa_pendiente_origen, socios(user_id)')
      .eq('id', socio_establecimiento_id).maybeSingle();
    if (!vinc) return json({ error: 'vinculacion no encontrada' }, 404);
    if (!vinc.tarifa_pendiente) return json({ error: 'no hay tarifa pendiente para esta vinculacion' }, 400);

    const { data: est } = await admin.from('establecimientos').select('user_id, nombre').eq('id', vinc.establecimiento_id).maybeSingle();
    const socioUserId = (vinc.socios as any)?.user_id ?? null;
    const { data: rol } = await admin.from('usuarios').select('rol').eq('id', user.id).maybeSingle();
    const isSuperadmin = rol?.rol === 'superadmin' || rol?.rol === 'admin';

    const origen = vinc.tarifa_pendiente_origen as ('socio' | 'restaurante' | null);
    const esRestaurante = est?.user_id === user.id;
    const esSocio = socioUserId === user.id;
    if (!isSuperadmin && origen !== 'socio' && origen !== 'restaurante') {
      return json({ error: 'origen_propuesta_inconsistente' }, 409);
    }
    const debeResponderRestaurante = origen === 'socio';
    const debeResponderSocio = origen === 'restaurante';
    const autorizado = isSuperadmin
      || (debeResponderRestaurante && esRestaurante)
      || (debeResponderSocio && esSocio);
    if (!autorizado) {
      return json({ error: 'esta propuesta la debe responder la otra parte' }, 403);
    }

    const ahora = new Date().toISOString();
    const tp = vinc.tarifa_pendiente as any;
    const tarifaAnterior = {
      tarifa_base: vinc.tarifa_base,
      tarifa_radio_base_km: vinc.tarifa_radio_base_km,
      tarifa_precio_km: vinc.tarifa_precio_km,
      tarifa_maxima: vinc.tarifa_maxima,
      comision_pct: vinc.comision_pct,
    };
    const quienResponde = esRestaurante ? 'restaurante' : esSocio ? 'socio' : 'admin';
    const proponenteUserId = origen === 'socio' ? socioUserId : est?.user_id ?? null;

    if (accion === 'aceptar') {
      const update: any = {
        tarifa_base: tp.tarifa_base ?? null,
        tarifa_radio_base_km: tp.tarifa_radio_base_km ?? null,
        tarifa_precio_km: tp.tarifa_precio_km ?? null,
        tarifa_maxima: tp.tarifa_maxima ?? null,
        comision_pct: tp.comision_pct ?? vinc.comision_pct ?? 10,
        tarifa_aceptada_en: ahora,
        tarifa_pendiente: null,
        tarifa_pendiente_at: null,
        tarifa_pendiente_origen: null,
        tarifa_pendiente_expira_en: null,
        updated_at: ahora,
      };
      const { error } = await admin.from('socio_establecimiento').update(update).eq('id', socio_establecimiento_id);
      if (error) throw error;

      await admin.from('socio_establecimiento_tarifa_log').insert({
        socio_id: vinc.socio_id,
        establecimiento_id: vinc.establecimiento_id,
        evento: 'aceptada',
        origen: quienResponde,
        tarifa_anterior: tarifaAnterior,
        tarifa_nueva: tp,
        motivo: motivo || 'Propuesta aceptada.',
        created_by: user.id,
      });

      if (proponenteUserId) {
        await admin.from('notificaciones').insert({
          user_id: proponenteUserId,
          titulo: 'Propuesta de tarifa aceptada',
          cuerpo: 'Tu propuesta de tarifa de reparto ha sido aceptada y ya esta activa.',
          url: origen === 'socio' ? '/restaurantes' : '/socios-riders',
          leida: false,
        });
      }

      return json({ ok: true, accion: 'aceptada', tarifa_aplicada: tp });
    } else {
      const { error } = await admin.from('socio_establecimiento').update({
        tarifa_pendiente: null,
        tarifa_pendiente_at: null,
        tarifa_pendiente_origen: null,
        tarifa_pendiente_expira_en: null,
        updated_at: ahora,
      }).eq('id', socio_establecimiento_id);
      if (error) throw error;

      await admin.from('socio_establecimiento_tarifa_log').insert({
        socio_id: vinc.socio_id,
        establecimiento_id: vinc.establecimiento_id,
        evento: 'rechazada',
        origen: quienResponde,
        tarifa_anterior: tarifaAnterior,
        tarifa_nueva: tp,
        motivo: motivo || 'Propuesta rechazada.',
        created_by: user.id,
      });

      if (proponenteUserId) {
        await admin.from('notificaciones').insert({
          user_id: proponenteUserId,
          titulo: 'Propuesta de tarifa rechazada',
          cuerpo: 'Tu propuesta de tarifa de reparto ha sido rechazada. Se mantiene la tarifa anterior.',
          url: origen === 'socio' ? '/restaurantes' : '/socios-riders',
          leida: false,
        });
      }

      return json({ ok: true, accion: 'rechazada', tarifa_actual: tarifaAnterior });
    }
  } catch (err: any) {
    console.error('[responder-tarifa-pendiente]', err);
    return json({ error: err.message }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}
