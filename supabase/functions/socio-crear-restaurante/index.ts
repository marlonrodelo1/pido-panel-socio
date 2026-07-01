import { createClient } from 'jsr:@supabase/supabase-js@2';

// socio-crear-restaurante v1
// Un SOCIO da de alta un restaurante nuevo (suyo o captado) desde socio.pidoo.es.
// Modelo "invitación por email": el socio rellena los datos básicos; el restaurante
// recibe un correo y termina el alta poniéndose su propia contraseña (Puerta A).
// La vinculación socio↔restaurante queda activa al instante (es_captador=true), pero
// el restaurante NO sale público hasta que el super-admin lo verifica (Puerta B:
// establecimientos.estado='activo'). El socio nunca conoce la contraseña del restaurante.
//
// Por RLS un socio no puede insertar en establecimientos desde el cliente: aquí usamos
// service role (salta RLS), de forma atómica con rollback. verify_jwt=false: validamos
// el token a mano (igual que el resto de funciones socio) y exigimos que el caller sea socio.

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

// Email (opcional): si RESEND_API_KEY está configurado se envía la invitación por Resend.
// Si no, se devuelve el action_link en la respuesta para reenvío/pruebas manuales.
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') || '';
const RESEND_FROM = Deno.env.get('RESEND_FROM') || 'Pidoo <no-reply@pidoo.es>';
const PANEL_URL = Deno.env.get('PANEL_RESTAURANTE_URL') || 'https://panel.pidoo.es';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TENERIFE = { lat: 28.4139, lng: -16.5474 };

// Fallback hardcoded de último recurso (coincide con defaults documentados en CLAUDE.md).
const HARDCODED_FALLBACK = {
  tarifa_base: 2.50,
  tarifa_radio_base_km: 3,
  tarifa_precio_km: 0.50,
  tarifa_maxima: 8.00,
};

async function leerDefaultsPlataforma(admin: any) {
  const claves = [
    'envio_tarifa_base',
    'envio_radio_base_km',
    'envio_precio_km_adicional',
    'envio_tarifa_maxima',
  ];
  const { data } = await admin.from('configuracion_plataforma')
    .select('clave, valor').in('clave', claves);
  const map: Record<string, string> = {};
  for (const row of data ?? []) map[row.clave] = row.valor;
  const num = (k: string, fb: number) => {
    const v = map[k];
    if (v == null) return fb;
    const n = Number(v);
    return Number.isFinite(n) ? n : fb;
  };
  return {
    tarifa_base: num('envio_tarifa_base', HARDCODED_FALLBACK.tarifa_base),
    tarifa_radio_base_km: num('envio_radio_base_km', HARDCODED_FALLBACK.tarifa_radio_base_km),
    tarifa_precio_km: num('envio_precio_km_adicional', HARDCODED_FALLBACK.tarifa_precio_km),
    tarifa_maxima: num('envio_tarifa_maxima', HARDCODED_FALLBACK.tarifa_maxima),
  };
}

function emailHtml(opts: { socioNombre: string; restauranteNombre: string; link: string }) {
  const { socioNombre, restauranteNombre, link } = opts;
  return `<!doctype html><html><body style="margin:0;background:#F7F3EC;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1A1815;">
  <div style="max-width:520px;margin:0 auto;padding:32px 24px;">
    <div style="font-size:24px;font-weight:800;letter-spacing:-0.02em;margin-bottom:8px;">Pidoo</div>
    <div style="background:#FBF8F2;border:1px solid #EFE9DD;border-radius:14px;padding:28px 24px;">
      <h1 style="font-size:20px;margin:0 0 12px;">Confirma tu restaurante en Pidoo</h1>
      <p style="font-size:15px;line-height:1.5;margin:0 0 12px;">
        <strong>${socioNombre}</strong> ha dado de alta tu restaurante
        <strong>${restauranteNombre}</strong> en Pidoo.
      </p>
      <p style="font-size:15px;line-height:1.5;margin:0 0 20px;">
        Pulsa el botón para crear tu contraseña y terminar el alta. Después podrás
        gestionar tu carta y tus pedidos desde el panel.
      </p>
      <a href="${link}" style="display:inline-block;background:#C5562C;color:#F7F3EC;text-decoration:none;font-weight:700;font-size:15px;padding:12px 22px;border-radius:10px;">
        Confirmar y crear contraseña
      </a>
      <p style="font-size:12px;color:#6b6256;line-height:1.5;margin:20px 0 0;">
        Si no esperabas este correo, puedes ignorarlo. El enlace caduca por seguridad;
        si expira, pide a ${socioNombre} que te reenvíe la invitación.
      </p>
    </div>
    <p style="font-size:12px;color:#9a9082;text-align:center;margin-top:18px;">Pidoo · pidoo.es</p>
  </div></body></html>`;
}

async function enviarInvitacion(opts: { to: string; socioNombre: string; restauranteNombre: string; link: string }) {
  if (!RESEND_API_KEY) return { sent: false, reason: 'no_resend_key' };
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: RESEND_FROM,
        to: [opts.to],
        subject: `Confirma tu restaurante "${opts.restauranteNombre}" en Pidoo`,
        html: emailHtml(opts),
      }),
    });
    if (!r.ok) {
      const txt = await r.text().catch(() => '');
      console.error('[socio-crear-restaurante] resend failed', r.status, txt);
      return { sent: false, reason: `resend_${r.status}` };
    }
    return { sent: true };
  } catch (e) {
    console.error('[socio-crear-restaurante] resend exception', e);
    return { sent: false, reason: 'resend_exception' };
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405);

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  try {
    // 1) Autenticación: el caller debe ser un socio
    const auth = req.headers.get('Authorization') || '';
    const token = auth.replace('Bearer ', '').trim();
    if (!token || token === ANON_KEY) return json({ ok: false, error: 'no_token' }, 401);

    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ ok: false, error: 'sesion_invalida' }, 401);

    const { data: socio } = await admin.from('socios')
      .select('id, limite_restaurantes, nombre_comercial, nombre')
      .eq('user_id', user.id).maybeSingle();
    if (!socio) return json({ ok: false, error: 'no_eres_socio' }, 403);

    // 2) Límite ANTES de crear nada (el trigger trg_limite_restaurantes_socio
    //    rechazaría el INSERT activo y dejaría restaurante + auth user huérfanos)
    const { count } = await admin.from('socio_establecimiento')
      .select('*', { count: 'exact', head: true })
      .eq('socio_id', socio.id).in('estado', ['pendiente', 'solicitada', 'activa']);
    const limite = socio.limite_restaurantes || 5;
    if ((count || 0) >= limite) {
      return json({ ok: false, error: 'limite_alcanzado', message: `Has alcanzado tu límite de ${limite} restaurantes. Pide al equipo Pidoo que lo amplíe.` }, 400);
    }

    // 3) Validar datos
    const body = await req.json().catch(() => ({}));
    const email = (body?.email || '').toString().trim().toLowerCase();
    const nombre = (body?.nombre || '').toString().trim();
    const direccion = (body?.direccion || '').toString().trim();
    const telefono = (body?.telefono || '').toString().trim() || null;

    if (!nombre) return json({ ok: false, error: 'nombre_requerido', message: 'El nombre del restaurante es obligatorio.' }, 400);
    if (!EMAIL_RE.test(email)) return json({ ok: false, error: 'email_invalido', message: 'El email del restaurante no es válido.' }, 400);
    if (!direccion) return json({ ok: false, error: 'direccion_requerida', message: 'La dirección es obligatoria.' }, 400);

    // Conflicto de rol con mensaje amable (la RPC puede no existir → seguimos)
    try {
      const { data: roleCheck } = await admin.rpc('check_email_role', { check_email: email });
      if (roleCheck?.exists) {
        return json({ ok: false, error: 'email_en_uso', message: `Ese email ya está registrado como ${roleCheck.role}. Usa otro email para el restaurante.` }, 400);
      }
    } catch (_) { /* createUser/generateLink detecta duplicados igualmente */ }

    const lat = typeof body?.latitud === 'number' && isFinite(body.latitud) ? body.latitud : TENERIFE.lat;
    const lng = typeof body?.longitud === 'number' && isFinite(body.longitud) ? body.longitud : TENERIFE.lng;

    // 4) Crear usuario auth SIN contraseña conocida + link de invitación.
    //    generateLink type 'invite' crea el auth user (dispara el trigger que inserta
    //    en public.usuarios con rol del metadata) y devuelve el action_link.
    const redirectTo = `${PANEL_URL}/confirmar-alta`;
    const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
      type: 'invite',
      email,
      options: { data: { rol: 'restaurante', nombre }, redirectTo },
    });
    if (linkErr || !linkData?.user) {
      const msg = (linkErr?.message || '').toLowerCase();
      if (msg.includes('already') || msg.includes('exist') || msg.includes('registered')) {
        return json({ ok: false, error: 'email_en_uso', message: 'Ese email ya tiene cuenta en Pidoo. Usa otro email para el restaurante.' }, 400);
      }
      console.error('[socio-crear-restaurante] generateLink failed', linkErr);
      return json({ ok: false, error: 'invite_failed', message: linkErr?.message || 'No se pudo crear la invitación.' }, 500);
    }
    const uid = linkData.user.id;
    const actionLink = (linkData as any)?.properties?.action_link || (linkData as any)?.action_link || null;

    // 5) Completar usuarios (el trigger ya creó la fila)
    await admin.from('usuarios').update({ rol: 'restaurante', telefono }).eq('id', uid);

    // 6) Insertar establecimiento (service role → salta RLS).
    //    estado='pendiente_verificacion' (default) → no público hasta verificación super-admin.
    const estData: Record<string, unknown> = {
      user_id: uid,
      nombre,
      tipo: (body?.tipo || 'restaurante').toString(),
      categoria_padre: (body?.categoria_padre || 'comida').toString(),
      email,
      telefono,
      direccion,
      descripcion: (body?.descripcion || '').toString().trim() || null,
      logo_url: (body?.logo_url || '').toString().trim() || null,
      latitud: lat,
      longitud: lng,
      radio_cobertura_km: typeof body?.radio_cobertura_km === 'number' ? body.radio_cobertura_km : 10,
      activo: true,
      rating: 0,
      total_resenas: 0,
      captador_socio_id: socio.id,
      alta_confirmada_at: null,
    };
    const { data: estRow, error: estErr } = await admin.from('establecimientos')
      .insert(estData).select('id, nombre').single();
    if (estErr || !estRow) {
      console.error('[socio-crear-restaurante] establecimiento insert failed, rollback', estErr);
      await admin.from('usuarios').delete().eq('id', uid).catch((e) => console.error('rollback usuarios', e));
      await admin.auth.admin.deleteUser(uid).catch((e) => console.error('rollback deleteUser', e));
      return json({ ok: false, error: 'establecimiento_insert_failed', message: estErr?.message || 'No se pudo crear el establecimiento.' }, 500);
    }

    // 7) Vincular socio↔restaurante: activa al instante, captador, tarifa congelada.
    const tarifa = await leerDefaultsPlataforma(admin);
    const ahora = new Date().toISOString();
    const { error: vincErr } = await admin.from('socio_establecimiento').insert({
      socio_id: socio.id,
      establecimiento_id: estRow.id,
      estado: 'activa',
      es_captador: true,
      solicitado_at: ahora,
      aceptado_at: ahora,
      acepta_publicacion_at: ahora,
      tarifa_base: tarifa.tarifa_base,
      tarifa_radio_base_km: tarifa.tarifa_radio_base_km,
      tarifa_precio_km: tarifa.tarifa_precio_km,
      tarifa_maxima: tarifa.tarifa_maxima,
      tarifa_aceptada_en: ahora,
    });
    if (vincErr) {
      console.error('[socio-crear-restaurante] vinculacion insert failed, rollback', vincErr);
      await admin.from('establecimientos').delete().eq('id', estRow.id).catch((e) => console.error('rollback establecimiento', e));
      await admin.from('usuarios').delete().eq('id', uid).catch((e) => console.error('rollback usuarios', e));
      await admin.auth.admin.deleteUser(uid).catch((e) => console.error('rollback deleteUser', e));
      return json({ ok: false, error: 'vinculacion_failed', message: vincErr.message }, 500);
    }

    // 8) Enviar invitación (no bloquea el alta si falla: el restaurante ya existe)
    const socioNombre = (socio.nombre_comercial || socio.nombre || 'Tu socio en Pidoo').toString();
    let emailRes: { sent: boolean; reason?: string } = { sent: false, reason: 'no_link' };
    if (actionLink) {
      emailRes = await enviarInvitacion({ to: email, socioNombre, restauranteNombre: nombre, link: actionLink });
    }

    return json({
      ok: true,
      establecimiento_id: estRow.id,
      nombre: estRow.nombre,
      restaurante_email: email,
      invitado: true,
      email_enviado: emailRes.sent,
      email_motivo: emailRes.sent ? undefined : emailRes.reason,
      action_link: emailRes.sent ? undefined : actionLink,
    });
  } catch (err: any) {
    console.error('[socio-crear-restaurante] internal_error', err);
    return json({ ok: false, error: 'internal_error', message: err?.message || String(err) }, 500);
  }
});
