import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY') || '';

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

const ESTADOS_ACTIVOS = ['nuevo', 'aceptado', 'preparando', 'listo', 'recogido', 'en_camino'];
const ESTADOS_TERMINALES = ['entregado', 'cancelado', 'rechazado', 'fallido'];

async function stripeDelete(path: string): Promise<{ ok: boolean; status: number; body: any }> {
  if (!STRIPE_SECRET_KEY) return { ok: false, status: 0, body: { error: 'no_stripe_key' } };
  const resp = await fetch(`https://api.stripe.com/v1${path}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}` },
  });
  const body = await resp.json().catch(() => ({}));
  return { ok: resp.ok, status: resp.status, body };
}

function normalize(s: string | null | undefined): string {
  return (s || '').toString().trim().toLowerCase();
}

type EliminacionResumen = Record<string, unknown>;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ success: false, error: 'method_not_allowed' }, 405);

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  try {
    // 1. Auth: solo superadmin
    const auth = req.headers.get('Authorization') || '';
    const token = auth.replace('Bearer ', '').trim();
    if (!token) return json({ success: false, error: 'no_token' }, 401);

    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ success: false, error: 'sesion_invalida' }, 401);

    const { data: callerRow } = await admin.from('usuarios')
      .select('rol, email').eq('id', user.id).maybeSingle();
    if (callerRow?.rol !== 'superadmin') {
      return json({
        success: false,
        error: 'forbidden',
        message: 'Solo el superadmin puede borrar definitivamente. El rol admin no tiene este permiso por seguridad.',
      }, 403);
    }

    // 2. Body
    const body = await req.json().catch(() => ({}));
    const tipo = body?.tipo;
    const id = body?.id;
    const opciones = body?.opciones || {};
    const incluirDueno = !!opciones?.incluir_dueno;
    const confirmacion = (opciones?.confirmacion || '').toString();
    const skipConfirm = !!opciones?._skip_confirmacion; // uso interno cuando cascadea

    if (!['usuario', 'establecimiento', 'socio'].includes(tipo)) {
      return json({ success: false, error: 'tipo_invalido' }, 400);
    }
    if (!id || typeof id !== 'string') {
      return json({ success: false, error: 'id_invalido' }, 400);
    }

    const resultado = await ejecutarEliminacion(admin, tipo, id, {
      incluirDueno, confirmacion, skipConfirm,
      caller: { id: user.id, email: callerRow?.email || user.email || null },
    });

    return json(resultado, resultado.success ? 200 : (resultado.status || 400));
  } catch (err: any) {
    console.error('[admin-eliminar-entidad] internal_error', err);
    return json({ success: false, error: 'internal_error', message: err?.message || String(err) }, 500);
  }
});

type CallerInfo = { id: string; email: string | null };

async function ejecutarEliminacion(
  admin: ReturnType<typeof createClient>,
  tipo: string,
  id: string,
  ctx: { incluirDueno: boolean; confirmacion: string; skipConfirm: boolean; caller: CallerInfo },
): Promise<{ success: boolean; resumen?: EliminacionResumen; error?: string; message?: string; detalles?: any; status?: number }> {
  if (tipo === 'usuario') return await borrarUsuario(admin, id, ctx);
  if (tipo === 'establecimiento') return await borrarEstablecimiento(admin, id, ctx);
  if (tipo === 'socio') return await borrarSocio(admin, id, ctx);
  return { success: false, error: 'tipo_invalido', status: 400 };
}

// ────────────────────────────────────────────────────────────────────────────
// USUARIO (cliente)
// ────────────────────────────────────────────────────────────────────────────
async function borrarUsuario(
  admin: ReturnType<typeof createClient>,
  userId: string,
  ctx: { confirmacion: string; skipConfirm: boolean; caller: CallerInfo },
): Promise<any> {
  const { data: u } = await admin.from('usuarios').select('id, nombre, apellido, email, rol').eq('id', userId).maybeSingle();
  if (!u) return { success: false, error: 'no_encontrado', message: 'Usuario no existe', status: 404 };

  if (u.rol && u.rol !== 'cliente') {
    return {
      success: false,
      error: 'rol_invalido',
      message: `No se puede borrar este usuario por aquí: tiene rol "${u.rol}". Usa los flujos específicos (eliminar establecimiento o socio).`,
      status: 400,
    };
  }

  // Confirmación: email exacto
  if (!ctx.skipConfirm) {
    if (normalize(ctx.confirmacion) !== normalize(u.email)) {
      return { success: false, error: 'confirmacion_invalida', message: 'El email de confirmación no coincide.', status: 400 };
    }
  }

  // Pedidos activos -> bloquear
  const { data: activos } = await admin.from('pedidos')
    .select('id, codigo, estado').eq('usuario_id', userId).in('estado', ESTADOS_ACTIVOS);
  if (activos && activos.length > 0) {
    return {
      success: false,
      error: 'pedidos_activos',
      message: `El usuario tiene ${activos.length} pedido(s) en curso. Espera a que terminen o cancélalos antes de eliminar.`,
      detalles: activos,
      status: 409,
    };
  }

  const resumen: EliminacionResumen = {
    tipo: 'usuario',
    id: userId,
    email: u.email,
    nombre: `${u.nombre || ''} ${u.apellido || ''}`.trim() || null,
  };

  // Pedidos pasados -> anonimizar
  const { data: pasados, error: ePas } = await admin.from('pedidos')
    .update({ usuario_id: null }).eq('usuario_id', userId).select('id');
  if (ePas) return { success: false, error: 'anon_pedidos_failed', message: ePas.message, status: 500 };
  resumen.pedidos_pasados_anonimizados = pasados?.length || 0;

  // Direcciones (CASCADE igualmente, pero contamos)
  const { count: nDir } = await admin.from('direcciones_usuario').select('id', { count: 'exact', head: true }).eq('usuario_id', userId);
  resumen.direcciones_borradas = nDir || 0;

  // Notificaciones (FK NO ACTION) -> SET NULL manual
  const { data: notifAct } = await admin.from('notificaciones').update({ usuario_id: null }).eq('usuario_id', userId).select('id');
  resumen.notificaciones_anonimizadas = notifAct?.length || 0;

  // Reseñas (FK NO ACTION) -> SET NULL
  const { data: resAct } = await admin.from('resenas').update({ usuario_id: null }).eq('usuario_id', userId).select('id');
  resumen.resenas_anonimizadas = resAct?.length || 0;

  // Push subscriptions (no FK directa por user_id en tabla push_subscriptions actual)
  const { error: ePush } = await admin.from('push_subscriptions').delete().eq('user_id', userId);
  if (ePush) console.warn('push_subscriptions delete', ePush);

  // Auditar antes de borrar
  await admin.from('admin_eliminaciones').insert({
    tipo: 'usuario', target_id: userId, target_email: u.email, target_nombre: resumen.nombre as string,
    resumen, performed_by: ctx.caller.id, performed_by_email: ctx.caller.email,
  });

  // Borrar fila usuarios (CASCADE de direcciones_usuario actuará)
  const { error: eUsu } = await admin.from('usuarios').delete().eq('id', userId);
  if (eUsu) return { success: false, error: 'usuarios_delete_failed', message: eUsu.message, status: 500 };

  // Borrar auth user
  const { error: eAuth } = await admin.auth.admin.deleteUser(userId);
  if (eAuth) {
    console.warn('[admin-eliminar-entidad] auth.deleteUser failed (no bloquea)', eAuth);
    resumen.auth_delete_warning = eAuth.message;
  } else {
    resumen.auth_user_borrado = true;
  }

  return { success: true, resumen };
}

// ────────────────────────────────────────────────────────────────────────────
// ESTABLECIMIENTO
// ────────────────────────────────────────────────────────────────────────────
async function borrarEstablecimiento(
  admin: ReturnType<typeof createClient>,
  estId: string,
  ctx: { incluirDueno: boolean; confirmacion: string; skipConfirm: boolean; caller: CallerInfo },
): Promise<any> {
  const { data: est } = await admin.from('establecimientos')
    .select('id, nombre, email, user_id, stripe_subscription_multirider_id, stripe_customer_id')
    .eq('id', estId).maybeSingle();
  if (!est) return { success: false, error: 'no_encontrado', message: 'Establecimiento no existe', status: 404 };

  if (!ctx.skipConfirm) {
    if (normalize(ctx.confirmacion) !== normalize(est.nombre)) {
      return { success: false, error: 'confirmacion_invalida', message: 'El nombre de confirmación no coincide.', status: 400 };
    }
  }

  // Pedidos activos -> bloquear
  const { data: activos } = await admin.from('pedidos')
    .select('id, codigo, estado').eq('establecimiento_id', estId).in('estado', ESTADOS_ACTIVOS);
  if (activos && activos.length > 0) {
    return {
      success: false,
      error: 'pedidos_activos',
      message: `El restaurante tiene ${activos.length} pedido(s) en curso. Espera a que terminen o cancélalos antes de eliminar.`,
      detalles: activos,
      status: 409,
    };
  }

  const resumen: EliminacionResumen = {
    tipo: 'establecimiento',
    id: estId,
    nombre: est.nombre,
    email: est.email,
    incluir_dueno: ctx.incluirDueno,
  };

  // Cancelar suscripción multirider si existe
  if (est.stripe_subscription_multirider_id) {
    try {
      const r = await stripeDelete(`/subscriptions/${est.stripe_subscription_multirider_id}`);
      resumen.stripe_subscription_cancelada = r.ok;
      if (!r.ok) resumen.stripe_subscription_error = r.body?.error?.message || 'no_ok';
    } catch (e: any) {
      console.warn('stripe sub cancel', e);
      resumen.stripe_subscription_error = e?.message || String(e);
    }
  }

  // Pedidos pasados -> SET NULL establecimiento_id
  const { data: pasados } = await admin.from('pedidos')
    .update({ establecimiento_id: null }).eq('establecimiento_id', estId).select('id');
  resumen.pedidos_pasados_anonimizados = pasados?.length || 0;

  // Borrar dependencias en orden seguro
  // Nota: muchas tienen ON DELETE CASCADE pero las contamos antes para auditoría
  const counts: Record<string, number> = {};
  const tablasCascade = [
    { tabla: 'pedido_asignaciones', via: null }, // depende de pedidos.cascade ya operó
    { tabla: 'restaurante_riders', via: 'establecimiento_id' },
    { tabla: 'restaurante_config_delivery', via: 'establecimiento_id' },
    { tabla: 'producto_extras', via: null },
    { tabla: 'extras_opciones', via: null },
    { tabla: 'grupos_extras', via: 'establecimiento_id' },
    { tabla: 'productos', via: 'establecimiento_id' },
    { tabla: 'categorias', via: 'establecimiento_id' },
    { tabla: 'establecimiento_categorias', via: 'establecimiento_id' },
    { tabla: 'promociones', via: 'establecimiento_id' },
    { tabla: 'drivers_status', via: 'establecimiento_id' },
    { tabla: 'notificaciones', via: 'establecimiento_id' },
    { tabla: 'socio_establecimiento', via: 'establecimiento_id' },
    { tabla: 'suscripciones_tienda', via: 'establecimiento_id' },
  ];

  // Tablas con FK NO ACTION/RESTRICT que necesitan DELETE manual
  const tablasManual = [
    'balances_restaurante',
    'comisiones',
    'facturas_semanales',
    'movimientos_cuenta',
    'mensajes',
    'resenas',
    'facturas_socio_restaurante',
  ];

  for (const tabla of tablasManual) {
    const { data, error } = await admin.from(tabla).delete().eq('establecimiento_id', estId).select('id');
    if (error) {
      console.warn(`delete ${tabla} failed`, error);
      counts[tabla] = -1;
    } else {
      counts[tabla] = data?.length || 0;
    }
  }

  // Conteos previos cascade (informativos)
  for (const t of tablasCascade) {
    if (!t.via) continue;
    const { count } = await admin.from(t.tabla).select('id', { count: 'exact', head: true }).eq(t.via, estId);
    counts[t.tabla] = count || 0;
  }

  resumen.tablas_borradas = counts;

  // rider_unico_id en establecimientos -> ya quedará desligado al borrar
  // captador_socio_id en establecimientos NO ACTION (referencia FROM otros estab)
  // Borrar establecimiento -> dispara CASCADEs definidos en BD
  await admin.from('admin_eliminaciones').insert({
    tipo: 'establecimiento', target_id: estId, target_email: est.email, target_nombre: est.nombre,
    resumen, performed_by: ctx.caller.id, performed_by_email: ctx.caller.email,
  });

  const { error: eEst } = await admin.from('establecimientos').delete().eq('id', estId);
  if (eEst) {
    return { success: false, error: 'establecimiento_delete_failed', message: eEst.message, status: 500, detalles: counts };
  }

  // Si pedido borrar también al dueño
  if (ctx.incluirDueno && est.user_id) {
    // El dueño tiene rol 'restaurante' -> usamos lógica directa similar a usuario pero saltando check rol
    const subRes = await borrarUsuarioForzado(admin, est.user_id, ctx.caller);
    resumen.dueno_eliminado = subRes;
  }

  return { success: true, resumen };
}

// Variante interna: borra el dueño aunque rol != 'cliente' (cuando cascadeamos desde establecimiento/socio)
async function borrarUsuarioForzado(
  admin: ReturnType<typeof createClient>,
  userId: string,
  caller: CallerInfo,
): Promise<any> {
  const { data: u } = await admin.from('usuarios').select('id, nombre, apellido, email, rol').eq('id', userId).maybeSingle();
  if (!u) return { ok: false, error: 'no_encontrado' };

  // Solo seguimos si NO tiene aún establecimientos/socios vivos
  const { count: estVivos } = await admin.from('establecimientos').select('id', { count: 'exact', head: true }).eq('user_id', userId);
  const { count: socioVivo } = await admin.from('socios').select('id', { count: 'exact', head: true }).eq('user_id', userId);
  if ((estVivos || 0) > 0 || (socioVivo || 0) > 0) {
    return { ok: false, error: 'tiene_entidades_vivas', estVivos, socioVivo };
  }

  // Anonimizar pedidos pasados
  await admin.from('pedidos').update({ usuario_id: null }).eq('usuario_id', userId);
  await admin.from('notificaciones').update({ usuario_id: null }).eq('usuario_id', userId);
  await admin.from('resenas').update({ usuario_id: null }).eq('usuario_id', userId);
  await admin.from('push_subscriptions').delete().eq('user_id', userId);

  await admin.from('admin_eliminaciones').insert({
    tipo: 'usuario', target_id: userId, target_email: u.email,
    target_nombre: `${u.nombre || ''} ${u.apellido || ''}`.trim() || null,
    resumen: { cascade_desde: true, rol_origen: u.rol },
    performed_by: caller.id, performed_by_email: caller.email,
  });

  await admin.from('usuarios').delete().eq('id', userId);
  const { error: eAuth } = await admin.auth.admin.deleteUser(userId);
  return { ok: true, email: u.email, auth_borrado: !eAuth, auth_error: eAuth?.message };
}

// ────────────────────────────────────────────────────────────────────────────
// SOCIO
// ────────────────────────────────────────────────────────────────────────────
async function borrarSocio(
  admin: ReturnType<typeof createClient>,
  socioId: string,
  ctx: { confirmacion: string; skipConfirm: boolean; caller: CallerInfo },
): Promise<any> {
  const { data: s } = await admin.from('socios')
    .select('id, nombre, nombre_comercial, email, user_id, slug, stripe_customer_id, stripe_subscription_multirider_id')
    .eq('id', socioId).maybeSingle();
  if (!s) return { success: false, error: 'no_encontrado', message: 'Socio no existe', status: 404 };

  const labelConf = s.nombre_comercial || s.nombre || s.slug || s.email;
  if (!ctx.skipConfirm) {
    if (normalize(ctx.confirmacion) !== normalize(labelConf)) {
      return { success: false, error: 'confirmacion_invalida', message: 'El nombre de confirmación no coincide.', status: 400 };
    }
  }

  // Balances impagados -> bloquear
  const { data: balPend } = await admin.from('balances_socio')
    .select('id, periodo_inicio, periodo_fin, total_pagar_socio')
    .eq('socio_id', socioId).eq('estado', 'pendiente');
  if (balPend && balPend.length > 0) {
    const total = balPend.reduce((acc, b: any) => acc + Number(b.total_pagar_socio || 0), 0);
    return {
      success: false,
      error: 'balances_pendientes',
      message: `El socio tiene ${balPend.length} balance(s) pendiente(s) por ${total.toFixed(2)} €. Liquida o marca pagado antes de eliminar.`,
      detalles: balPend,
      status: 409,
    };
  }

  // Riders del socio (por socio_id)
  const { data: riders } = await admin.from('rider_accounts').select('id').eq('socio_id', socioId);
  const riderIds = (riders || []).map((r: any) => r.id);

  // Pedidos activos donde el socio es rider (rider_account_id ∈ riderIds) o socio_id
  const filtros: any[] = [{ key: 'socio_id', val: socioId }];
  if (riderIds.length > 0) filtros.push({ key: 'rider_account_id', val: riderIds });

  for (const f of filtros) {
    let q = admin.from('pedidos').select('id, codigo, estado').in('estado', ESTADOS_ACTIVOS);
    q = Array.isArray(f.val) ? q.in(f.key, f.val) : q.eq(f.key, f.val);
    const { data: act } = await q;
    if (act && act.length > 0) {
      return {
        success: false,
        error: 'pedidos_activos',
        message: `El socio tiene ${act.length} pedido(s) en curso (${f.key}). Espera o cancélalos antes de eliminar.`,
        detalles: act,
        status: 409,
      };
    }
  }

  const resumen: EliminacionResumen = {
    tipo: 'socio',
    id: socioId,
    nombre: s.nombre_comercial || s.nombre,
    email: s.email,
    slug: s.slug,
    n_riders_socio: riderIds.length,
  };

  // Cancelar Stripe subscription multirider y luego customer (cancela el resto de subs)
  if (s.stripe_subscription_multirider_id) {
    const r = await stripeDelete(`/subscriptions/${s.stripe_subscription_multirider_id}`);
    resumen.stripe_subscription_cancelada = r.ok;
    if (!r.ok) resumen.stripe_subscription_error = r.body?.error?.message || 'no_ok';
  }
  if (s.stripe_customer_id) {
    const r = await stripeDelete(`/customers/${s.stripe_customer_id}`);
    resumen.stripe_customer_borrado = r.ok;
    if (!r.ok) resumen.stripe_customer_error = r.body?.error?.message || 'no_ok';
  }

  // Pedidos pasados: SET NULL socio_id
  const { data: pasSocio } = await admin.from('pedidos').update({ socio_id: null }).eq('socio_id', socioId).select('id');
  resumen.pedidos_pasados_socio_anonimizados = pasSocio?.length || 0;

  // Pedidos pasados con rider_account_id de este socio: ya tienen ON DELETE SET NULL en rider_account_id, así que no hace falta tocar

  // captador_socio_id en establecimientos: FK NO ACTION -> SET NULL manual
  const { data: capt } = await admin.from('establecimientos')
    .update({ captador_socio_id: null }).eq('captador_socio_id', socioId).select('id');
  resumen.establecimientos_descaptados = capt?.length || 0;

  // facturas_socio_restaurante (FK RESTRICT) -> borrar
  const { data: facSR } = await admin.from('facturas_socio_restaurante').delete().eq('socio_id', socioId).select('id');
  resumen.facturas_socio_restaurante_borradas = facSR?.length || 0;

  // balances_socio (FK NO ACTION) -> borrar (ya hemos confirmado que no hay pendientes)
  const { data: balDel } = await admin.from('balances_socio').delete().eq('socio_id', socioId).select('id');
  resumen.balances_borrados = balDel?.length || 0;

  // socio_establecimiento (CASCADE) -> sólo contamos
  const { count: nSE } = await admin.from('socio_establecimiento').select('id', { count: 'exact', head: true }).eq('socio_id', socioId);
  resumen.vinculaciones_borradas = nSE || 0;

  // resenas_socio CASCADE
  const { count: nRS } = await admin.from('resenas_socio').select('id', { count: 'exact', head: true }).eq('socio_id', socioId);
  resumen.resenas_socio_borradas = nRS || 0;

  // socio_riders_snapshots CASCADE
  const { count: nSn } = await admin.from('socio_riders_snapshots').select('id', { count: 'exact', head: true }).eq('socio_id', socioId);
  resumen.snapshots_borrados = nSn || 0;

  // Riders del socio: limpiar earnings/facturas y borrar las cuentas
  if (riderIds.length > 0) {
    // rider_earnings: FK pedido CASCADE; FK rider SET NULL. Limpiamos los del socio
    const { data: re } = await admin.from('rider_earnings').delete().in('rider_account_id', riderIds).select('id');
    resumen.rider_earnings_borrados = re?.length || 0;

    const { data: rfs } = await admin.from('rider_facturas_semanales').delete().in('rider_account_id', riderIds).select('id');
    resumen.rider_facturas_borradas = rfs?.length || 0;

    // rider_status, restaurante_riders, pedido_asignaciones tienen CASCADE/SET NULL automáticos
    // Borrar las rider_accounts (esto disparará cascades restantes)
    const { data: ra, error: eRa } = await admin.from('rider_accounts').delete().in('id', riderIds).select('id');
    if (eRa) console.warn('rider_accounts delete', eRa);
    resumen.rider_accounts_borradas = ra?.length || 0;
  }

  // Auditar antes de borrar
  await admin.from('admin_eliminaciones').insert({
    tipo: 'socio', target_id: socioId, target_email: s.email,
    target_nombre: (s.nombre_comercial || s.nombre || null) as string,
    resumen, performed_by: ctx.caller.id, performed_by_email: ctx.caller.email,
  });

  // Borrar socio
  const { error: eSoc } = await admin.from('socios').delete().eq('id', socioId);
  if (eSoc) return { success: false, error: 'socio_delete_failed', message: eSoc.message, status: 500, detalles: resumen };

  // Borrar usuario asociado si existe
  if (s.user_id) {
    const subRes = await borrarUsuarioForzado(admin, s.user_id, ctx.caller);
    resumen.usuario_eliminado = subRes;
  }

  return { success: true, resumen };
}
