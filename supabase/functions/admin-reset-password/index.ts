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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  let performedBy: string | null = null;
  let targetUserId: string | null = null;
  let targetRole: string | null = null;
  let mode: string | null = null;

  try {
    const auth = req.headers.get('Authorization') || '';
    const token = auth.replace('Bearer ', '').trim();
    if (!token) return json({ error: 'no_token' }, 401);

    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: 'sesion_invalida' }, 401);
    performedBy = user.id;

    const { data: callerRow } = await admin.from('usuarios')
      .select('rol').eq('id', user.id).maybeSingle();
    const callerRol = callerRow?.rol;
    if (callerRol !== 'admin' && callerRol !== 'superadmin') {
      return json({ error: 'forbidden', reason: 'requiere_admin_o_superadmin' }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const { user_id, mode: bodyMode, new_password } = body || {};
    targetUserId = user_id;
    mode = bodyMode;

    if (!user_id || typeof user_id !== 'string') return json({ error: 'user_id requerido' }, 400);
    if (!['set_password', 'send_recovery_email'].includes(bodyMode || '')) {
      return json({ error: 'mode invalido' }, 400);
    }

    const { data: targetRow } = await admin.from('usuarios')
      .select('id, email, rol, nombre').eq('id', user_id).maybeSingle();

    let targetEmail = targetRow?.email;
    targetRole = targetRow?.rol || null;

    const { data: authUserRes } = await admin.auth.admin.getUserById(user_id);
    if (!authUserRes?.user) {
      await logAttempt(admin, performedBy!, user_id, targetRole, bodyMode!, false, 'auth_user_no_existe');
      return json({ error: 'auth_user_no_existe', reason: 'el_usuario_no_tiene_cuenta_de_acceso' }, 404);
    }
    if (!targetEmail) targetEmail = authUserRes.user.email;

    if (callerRol === 'admin' && (targetRole === 'admin' || targetRole === 'superadmin')) {
      await logAttempt(admin, performedBy!, user_id, targetRole, bodyMode!, false, 'admin_no_puede_modificar_admin_o_superadmin');
      return json({ error: 'forbidden', reason: 'admin_no_puede_modificar_admin_o_superadmin' }, 403);
    }

    if (bodyMode === 'set_password') {
      if (!new_password || typeof new_password !== 'string' || new_password.length < 8) {
        await logAttempt(admin, performedBy!, user_id, targetRole, bodyMode!, false, 'password_invalida_min_8');
        return json({ error: 'password_invalida', reason: 'minimo_8_caracteres' }, 400);
      }
      const { error: updErr } = await admin.auth.admin.updateUserById(user_id, {
        password: new_password,
      });
      if (updErr) {
        await logAttempt(admin, performedBy!, user_id, targetRole, bodyMode!, false, updErr.message);
        return json({ error: 'update_failed', message: updErr.message }, 500);
      }
      await logAttempt(admin, performedBy!, user_id, targetRole, bodyMode!, true, null);
      return json({ success: true, mode: 'set_password' });
    }

    if (!targetEmail) {
      await logAttempt(admin, performedBy!, user_id, targetRole, bodyMode!, false, 'usuario_sin_email');
      return json({ error: 'usuario_sin_email' }, 400);
    }
    const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
      type: 'recovery',
      email: targetEmail,
    });
    if (linkErr) {
      await logAttempt(admin, performedBy!, user_id, targetRole, bodyMode!, false, linkErr.message);
      return json({ error: 'generate_link_failed', message: linkErr.message }, 500);
    }
    const actionLink = (linkData as any)?.properties?.action_link || (linkData as any)?.action_link || null;
    await logAttempt(admin, performedBy!, user_id, targetRole, bodyMode!, true, null);
    return json({
      success: true,
      mode: 'send_recovery_email',
      action_link: actionLink,
      email: targetEmail,
    });
  } catch (err: any) {
    console.error('[admin-reset-password]', err);
    if (performedBy && targetUserId && mode) {
      await logAttempt(admin, performedBy, targetUserId, targetRole, mode, false, err?.message || String(err));
    }
    return json({ error: 'internal_error', message: err?.message || String(err) }, 500);
  }
});

async function logAttempt(
  admin: ReturnType<typeof createClient>,
  performedBy: string,
  targetUserId: string,
  targetRole: string | null,
  mode: string,
  success: boolean,
  errorMessage: string | null,
) {
  try {
    await admin.from('admin_password_resets').insert({
      performed_by: performedBy,
      target_user_id: targetUserId,
      target_role: targetRole,
      mode,
      success,
      error_message: errorMessage,
    });
  } catch (e) {
    console.error('[admin-reset-password] log_failed', e);
  }
}
