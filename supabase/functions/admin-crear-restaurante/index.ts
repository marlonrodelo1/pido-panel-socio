import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

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

// Un paso de rollback NUNCA debe tumbar el rollback entero ni tapar el error
// original que lo provoco.
//
// POR QUE EXISTE ESTA FUNCION (bug real, 15 ago 2026): aqui habia
//   await admin.from('usuarios').delete().eq('id', newUserId).catch(...)
// y `.catch()` NO EXISTE en el builder de supabase-js: `.from().delete().eq()`
// devuelve un PostgrestFilterBuilder, que es un *thenable* (solo implementa
// `then`), no una Promise. Comprobado ejecutandolo: `typeof builder.catch` es
// `undefined` y llamarlo lanza `TypeError: ...catch is not a function` de forma
// SINCRONA, asi que el rollback moria en su primera linea y dejaba el usuario
// auth huerfano; al reintentar con el mismo email saltaba `email_ya_existe`.
// Mismo fallo que mordio el 13 ago en otro sitio: `.insert().catch()`.
//
// Ademas se lee el `{ error }`: sin `.throwOnError()`, supabase-js no rechaza
// cuando el borrado falla, solo lo devuelve, y un rollback que no lo mira no se
// entera de que no ha borrado nada.
async function pasoRollback(etiqueta: string, fn: () => unknown) {
  try {
    const res = await (fn() as Promise<{ error?: unknown } | unknown>);
    const err = (res as { error?: unknown } | null)?.error;
    if (err) console.error(`[admin-crear-restaurante] rollback ${etiqueta} devolvio error`, err);
  } catch (e) {
    console.error(`[admin-crear-restaurante] rollback ${etiqueta} lanzo excepcion`, e);
  }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function generarPassword(length = 12): string {
  const mayus = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const minus = 'abcdefghijkmnpqrstuvwxyz';
  const nums = '23456789';
  const all = mayus + minus + nums;
  const arr = new Uint32Array(length);
  crypto.getRandomValues(arr);
  const chars: string[] = [];
  chars.push(mayus[arr[0] % mayus.length]);
  chars.push(minus[arr[1] % minus.length]);
  chars.push(nums[arr[2] % nums.length]);
  for (let i = 3; i < length; i++) chars.push(all[arr[i] % all.length]);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = Math.floor((arr[i % arr.length] / 0xffffffff) * (i + 1));
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  try {
    const auth = req.headers.get('Authorization') || '';
    const token = auth.replace('Bearer ', '').trim();
    if (!token) return json({ error: 'no_token' }, 401);

    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: 'sesion_invalida' }, 401);

    const { data: callerRow } = await admin.from('usuarios')
      .select('rol').eq('id', user.id).maybeSingle();
    const callerRol = callerRow?.rol;
    if (callerRol !== 'admin' && callerRol !== 'superadmin') {
      return json({ error: 'forbidden', reason: 'requiere_admin_o_superadmin' }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const establecimientoIn = body?.establecimiento || {};
    const duenoIn = body?.dueno || {};

    const emailDueno = (duenoIn.email || '').toString().trim().toLowerCase();
    if (!emailDueno || !EMAIL_RE.test(emailDueno)) {
      return json({ error: 'email_invalido', message: 'Email del dueño inválido' }, 400);
    }
    if (!establecimientoIn.nombre || !establecimientoIn.nombre.toString().trim()) {
      return json({ error: 'nombre_requerido', message: 'Nombre del restaurante requerido' }, 400);
    }

    // Comprobar duplicados en auth.users y en public.usuarios (huerfanos posibles)
    const { data: existing, error: listErr } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
    if (listErr) return json({ error: 'list_users_failed', message: listErr.message }, 500);
    const yaExisteAuth = existing?.users?.find(u => (u.email || '').toLowerCase() === emailDueno);
    if (yaExisteAuth) {
      return json({ error: 'email_ya_existe', message: 'Ese email ya tiene cuenta en Pidoo. Usa otro email o vincula manualmente la cuenta existente al restaurante.' }, 400);
    }
    const { data: orphan } = await admin.from('usuarios').select('id').ilike('email', emailDueno).maybeSingle();
    if (orphan?.id) {
      return json({ error: 'usuarios_huerfano', message: `Hay un registro previo con ese email en public.usuarios (id=${orphan.id}) sin cuenta auth. Borra esa fila o usa otro email.` }, 400);
    }

    let passwordTemporal = (duenoIn.password || '').toString();
    if (!passwordTemporal) {
      passwordTemporal = generarPassword(12);
    } else if (passwordTemporal.length < 8) {
      return json({ error: 'password_invalida', message: 'La contraseña debe tener al menos 8 caracteres' }, 400);
    }

    const nombreDueno = (duenoIn.nombre || '').toString().trim() || establecimientoIn.nombre.toString().trim();
    const apellidoDueno = (duenoIn.apellido || '').toString().trim() || null;
    const telefonoDueno = (duenoIn.telefono || establecimientoIn.telefono || '').toString().trim() || null;

    // createUser dispara el trigger handle_new_user que ya inserta en public.usuarios
    // con rol del user_metadata. Pasamos rol='restaurante' en metadata.
    const { data: createRes, error: createErr } = await admin.auth.admin.createUser({
      email: emailDueno,
      password: passwordTemporal,
      email_confirm: true,
      user_metadata: { rol: 'restaurante', nombre: nombreDueno },
    });
    if (createErr || !createRes?.user) {
      console.error('[admin-crear-restaurante] createUser failed', createErr);
      return json({ error: 'create_user_failed', message: createErr?.message || 'No se pudo crear el usuario' }, 500);
    }
    const newUserId = createRes.user.id;

    // El trigger ya creo la fila en usuarios. Solo completamos apellido y telefono.
    const { error: usuariosErr } = await admin.from('usuarios')
      .update({ apellido: apellidoDueno, telefono: telefonoDueno, rol: 'restaurante' })
      .eq('id', newUserId);
    if (usuariosErr) {
      console.error('[admin-crear-restaurante] usuarios update failed, rolling back auth user', usuariosErr);
      await pasoRollback('deleteUser', () => admin.auth.admin.deleteUser(newUserId));
      return json({ error: 'usuarios_update_failed', message: usuariosErr.message }, 500);
    }

    const estData: Record<string, unknown> = {
      nombre: establecimientoIn.nombre.toString().trim(),
      tipo: establecimientoIn.tipo || 'restaurante',
      categoria_padre: establecimientoIn.categoria_padre || 'comida',
      telefono: establecimientoIn.telefono || null,
      direccion: establecimientoIn.direccion || null,
      latitud: typeof establecimientoIn.latitud === 'number' ? establecimientoIn.latitud : 28.4148,
      longitud: typeof establecimientoIn.longitud === 'number' ? establecimientoIn.longitud : -16.5477,
      radio_cobertura_km: establecimientoIn.radio_cobertura_km ?? 5,
      logo_url: establecimientoIn.logo_url || null,
      banner_url: establecimientoIn.banner_url || null,
      descripcion: establecimientoIn.descripcion || null,
      email: emailDueno,
      activo: true,
      rating: 0,
      total_resenas: 0,
      user_id: newUserId,
    };

    const { data: estRow, error: estErr } = await admin.from('establecimientos').insert(estData).select().single();

    if (estErr || !estRow) {
      console.error('[admin-crear-restaurante] establecimiento insert failed, rolling back', estErr);
      await pasoRollback('usuarios', () => admin.from('usuarios').delete().eq('id', newUserId));
      await pasoRollback('deleteUser', () => admin.auth.admin.deleteUser(newUserId));
      return json({ error: 'establecimiento_insert_failed', message: estErr?.message || 'No se pudo crear el establecimiento' }, 500);
    }

    return json({
      success: true,
      dueno: { id: newUserId, email: emailDueno, password_temporal: passwordTemporal },
      establecimiento: { id: estRow.id, nombre: estRow.nombre },
    });
  } catch (err: any) {
    console.error('[admin-crear-restaurante] internal_error', err);
    return json({ error: 'internal_error', message: err?.message || String(err) }, 500);
  }
});
