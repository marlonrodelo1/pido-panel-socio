import { createClient } from 'jsr:@supabase/supabase-js@2';

// aprobar-vinculacion-socio v8 (2 jul 2026)
// v8: UPDATE condicional por estado (guard anti doble-aprobacion/doble-rechazo desde
// 2 dispositivos): aceptar/rechazar solo sobre estado pendiente ('pendiente'|'solicitada'
// legacy), desvincular sobre 'activa'|'pendiente'|'solicitada'. Si 0 filas -> 409
// ya_procesada sin log de auditoria ni notificacion duplicada.

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

    const { vinculacion_id, accion, motivo } = await req.json();
    if (!vinculacion_id || !['aceptar','rechazar','desvincular'].includes(accion)) {
      return json({ error: 'vinculacion_id + accion (aceptar|rechazar|desvincular) requeridos' }, 400);
    }

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    const { data: vinc } = await admin.from('socio_establecimiento')
      .select('id, socio_id, establecimiento_id, estado, tarifa_pendiente, tarifa_base, tarifa_radio_base_km, tarifa_precio_km, tarifa_maxima, socios(nombre_comercial, user_id)')
      .eq('id', vinculacion_id).maybeSingle();
    if (!vinc) return json({ error: 'vinculacion no encontrada' }, 404);

    const { data: est } = await admin.from('establecimientos')
      .select('id, nombre, user_id').eq('id', vinc.establecimiento_id).maybeSingle();
    if (!est) return json({ error: 'establecimiento no encontrado' }, 404);

    const { data: rol } = await admin.from('usuarios').select('rol').eq('id', user.id).maybeSingle();
    const isSuperadmin = rol?.rol === 'superadmin' || rol?.rol === 'admin';
    if (est.user_id !== user.id && !isSuperadmin) {
      return json({ error: 'sin permiso sobre este establecimiento' }, 403);
    }

    const ahora = new Date().toISOString();
    const nuevoEstado = accion === 'aceptar' ? 'activa' : 'rechazada';
    const update: any = { estado: nuevoEstado, updated_at: ahora };

    if (accion === 'aceptar') {
      update.aceptado_at = ahora;
      // Snapshot de tarifa: usa la tarifa_pendiente que el socio acepto al solicitar
      const tp = vinc.tarifa_pendiente as any;
      if (tp) {
        update.tarifa_base = tp.tarifa_base ?? null;
        update.tarifa_radio_base_km = tp.tarifa_radio_base_km ?? null;
        update.tarifa_precio_km = tp.tarifa_precio_km ?? null;
        update.tarifa_maxima = tp.tarifa_maxima ?? null;
        update.tarifa_aceptada_en = ahora;
      }
      update.tarifa_pendiente = null;
      update.tarifa_pendiente_at = null;
      update.tarifa_pendiente_origen = null;
      update.tarifa_pendiente_expira_en = null;
    }
    if ((accion === 'rechazar' || accion === 'desvincular') && motivo) update.motivo_rechazo = motivo;

    // Guard de concurrencia: solo procesa si la fila sigue en un estado procesable.
    // 'solicitada' es el valor legacy de pendiente (el frontend trata ambos como pendientes).
    const estadosPermitidos = accion === 'desvincular'
      ? ['activa', 'pendiente', 'solicitada']
      : ['pendiente', 'solicitada'];
    const { data: updRows, error } = await admin.from('socio_establecimiento')
      .update(update)
      .eq('id', vinculacion_id)
      .in('estado', estadosPermitidos)
      .select('id');
    if (error) throw error;
    if (!updRows || updRows.length === 0) {
      return json({ error: 'ya_procesada' }, 409);
    }

    if (accion === 'aceptar' && vinc.tarifa_pendiente) {
      await admin.from('socio_establecimiento_tarifa_log').insert({
        socio_id: vinc.socio_id,
        establecimiento_id: vinc.establecimiento_id,
        evento: 'aceptada',
        origen: 'restaurante',
        tarifa_anterior: null,
        tarifa_nueva: vinc.tarifa_pendiente,
        motivo: 'Restaurante aprobo la vinculacion: tarifa propuesta queda congelada en el par socio<->restaurante.',
        created_by: user.id,
      });
    } else if (accion === 'rechazar') {
      await admin.from('socio_establecimiento_tarifa_log').insert({
        socio_id: vinc.socio_id,
        establecimiento_id: vinc.establecimiento_id,
        evento: 'rechazada',
        origen: 'restaurante',
        tarifa_anterior: null,
        tarifa_nueva: vinc.tarifa_pendiente,
        motivo: motivo || 'Restaurante rechazo la solicitud.',
        created_by: user.id,
      });
    }

    // Notificar al socio
    const socioUserId = (vinc.socios as any)?.user_id;
    if (socioUserId) {
      let titulo = '';
      let cuerpo = '';
      if (accion === 'aceptar') { titulo = 'Vinculacion aprobada'; cuerpo = `${est.nombre} ha aceptado tu solicitud. Ya aparece en tu marketplace.`; }
      else if (accion === 'rechazar') { titulo = 'Solicitud rechazada'; cuerpo = `${est.nombre} ha rechazado tu solicitud${motivo ? ': ' + motivo : '.'}`; }
      else if (accion === 'desvincular') { titulo = 'Vinculacion eliminada'; cuerpo = `${est.nombre} ha desvinculado tu marketplace${motivo ? ': ' + motivo : '.'}`; }
      await admin.from('notificaciones').insert({
        user_id: socioUserId,
        titulo,
        cuerpo,
        url: '/restaurantes',
        leida: false,
      });
    }

    return json({ ok: true, estado: nuevoEstado });
  } catch (err: any) {
    console.error('[aprobar-vinculacion-socio]', err);
    return json({ error: err.message }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}
