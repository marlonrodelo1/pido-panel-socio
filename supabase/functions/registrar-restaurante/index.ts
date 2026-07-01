import { createClient } from 'jsr:@supabase/supabase-js@2';

// Auto-registro PUBLICO de restaurantes.
// Reemplaza el flujo cliente (signUp + insert) que fallaba por RLS:
// con confirmacion de email activada, signUp no devuelve sesion -> auth.uid()
// null -> el INSERT en establecimientos viola la policy 'auth.uid() = user_id'.
// Aqui usamos service role: creamos el usuario con email_confirm=true (puede
// entrar al instante) y el establecimiento saltando RLS, de forma atomica con
// rollback. verify_jwt=false porque el usuario aun no tiene sesion.

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

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
const PASS_RE = /^(?=.*[A-Z])(?=.*\d).{8,}$/;
const TENERIFE = { lat: 28.4139, lng: -16.5474 };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ ok: false, message: 'Metodo no permitido' }, 405);

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  try {
    const body = await req.json().catch(() => ({}));
    const email = (body?.email || '').toString().trim().toLowerCase();
    const password = (body?.password || '').toString();
    const nombre = (body?.nombre || '').toString().trim();
    const direccion = (body?.direccion || '').toString().trim();

    if (!nombre) return json({ ok: false, message: 'El nombre del negocio es obligatorio.' });
    if (!EMAIL_RE.test(email)) return json({ ok: false, message: 'El email no es valido.' });
    if (!PASS_RE.test(password)) return json({ ok: false, message: 'La contrasena debe tener al menos 8 caracteres, 1 mayuscula y 1 numero.' });
    if (!direccion) return json({ ok: false, message: 'La direccion es obligatoria.' });

    // Conflicto de rol (cliente/socio/etc) con mensaje amable
    try {
      const { data: roleCheck } = await admin.rpc('check_email_role', { check_email: email });
      if (roleCheck?.exists) {
        return json({ ok: false, message: `Este email ya esta registrado como ${roleCheck.role}. Inicia sesion o usa otro email.` });
      }
    } catch (_) { /* si la RPC no existe, seguimos: createUser detecta duplicados */ }

    const lat = typeof body?.latitud === 'number' && isFinite(body.latitud) ? body.latitud : TENERIFE.lat;
    const lng = typeof body?.longitud === 'number' && isFinite(body.longitud) ? body.longitud : TENERIFE.lng;

    // 1) Crear usuario auth (email_confirm=true -> puede entrar ya). El trigger
    //    on_auth_user_created inserta la fila en public.usuarios con el rol del metadata.
    const { data: createRes, error: createErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { rol: 'restaurante', nombre },
    });
    if (createErr || !createRes?.user) {
      const msg = (createErr?.message || '').toLowerCase();
      if (msg.includes('already') || msg.includes('exist') || msg.includes('registered')) {
        return json({ ok: false, message: 'Ese email ya tiene cuenta en Pidoo. Inicia sesion.' });
      }
      console.error('[registrar-restaurante] createUser failed', createErr);
      return json({ ok: false, message: createErr?.message || 'No se pudo crear el usuario.' }, 500);
    }
    const uid = createRes.user.id;

    // 2) Asegurar rol + telefono en usuarios (el trigger ya creo la fila)
    const telefono = (body?.telefono || '').toString().trim() || null;
    await admin.from('usuarios').update({ rol: 'restaurante', telefono }).eq('id', uid);

    // 3) Insertar establecimiento (service role -> salta RLS)
    const estData: Record<string, unknown> = {
      user_id: uid,
      nombre,
      tipo: (body?.tipo || 'restaurante').toString(),
      categoria_padre: (body?.categoria_padre || 'comida').toString(),
      email,
      telefono,
      direccion,
      descripcion: (body?.descripcion || '').toString().trim() || null,
      activo: true,
      rating: 0,
      total_resenas: 0,
      latitud: lat,
      longitud: lng,
      radio_cobertura_km: 10,
    };
    const { data: estRow, error: estErr } = await admin.from('establecimientos').insert(estData).select('id, nombre').single();

    if (estErr || !estRow) {
      // Rollback real: borrar usuarios + auth user (evita cuentas a medias)
      console.error('[registrar-restaurante] establecimiento insert failed, rollback', estErr);
      await admin.from('usuarios').delete().eq('id', uid).catch((e) => console.error('rollback usuarios', e));
      await admin.auth.admin.deleteUser(uid).catch((e) => console.error('rollback deleteUser', e));
      return json({ ok: false, message: estErr?.message || 'No se pudo crear el establecimiento.' }, 500);
    }

    return json({ ok: true, user_id: uid, establecimiento_id: estRow.id, nombre: estRow.nombre });
  } catch (err: any) {
    console.error('[registrar-restaurante] internal_error', err);
    return json({ ok: false, message: err?.message || 'Error interno.' }, 500);
  }
});
