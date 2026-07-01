// solicitar-vinculacion-socio v5 (28 abr 2026)
// Cambio: cuando el restaurante NO tiene fila en restaurante_config_delivery,
// en vez de snapshottear NULLs (que dejan al socio expuesto a cambios silenciosos
// en configuracion_plataforma), leemos los defaults de configuracion_plataforma
// y congelamos esos valores en la vinculacion. Cierra el agujero "opcion B".

import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Fallback hardcoded de ULTIMO recurso si configuracion_plataforma tampoco tiene
// las claves esperadas. Coincide con los defaults documentados en el CLAUDE.md.
const HARDCODED_FALLBACK = {
  tarifa_base: 2.50,
  tarifa_radio_base_km: 3,
  tarifa_precio_km: 0.50,
  tarifa_maxima: 8.00,
};

function tarifaEqual(a: any, b: any): boolean {
  const norm = (x: any) => x == null ? null : Number(x);
  return (
    norm(a?.tarifa_base) === norm(b?.tarifa_base) &&
    norm(a?.tarifa_radio_base_km) === norm(b?.tarifa_radio_base_km) &&
    norm(a?.tarifa_precio_km) === norm(b?.tarifa_precio_km) &&
    norm(a?.tarifa_maxima) === norm(b?.tarifa_maxima)
  );
}

async function leerDefaultsPlataforma(admin: any) {
  // configuracion_plataforma es un store key/value (clave text, valor text).
  // Claves usadas: envio_tarifa_base, envio_radio_base_km,
  // envio_precio_km_adicional, envio_tarifa_maxima.
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
    const { establecimiento_id, acepta_tarifa, tarifa_snapshot } = body;
    if (!establecimiento_id) return json({ error: 'establecimiento_id requerido' }, 400);
    if (acepta_tarifa !== true) return json({ error: 'Debes aceptar la tarifa propuesta para solicitar la vinculacion' }, 400);

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    const { data: socio } = await admin.from('socios').select('id, limite_restaurantes').eq('user_id', user.id).maybeSingle();
    if (!socio) return json({ error: 'no eres socio' }, 403);

    const { count } = await admin.from('socio_establecimiento').select('*', { count: 'exact', head: true })
      .eq('socio_id', socio.id).in('estado', ['pendiente', 'solicitada', 'activa']);
    if ((count || 0) >= (socio.limite_restaurantes || 5)) {
      return json({ error: `Limite de ${socio.limite_restaurantes || 5} restaurantes alcanzado` }, 400);
    }

    const { data: existing } = await admin.from('socio_establecimiento')
      .select('id, estado').eq('socio_id', socio.id).eq('establecimiento_id', establecimiento_id).maybeSingle();
    if (existing) {
      return json({ error: 'Ya existe solicitud', estado: existing.estado }, 409);
    }

    // Tarifa actual del restaurante
    const { data: cfgRest } = await admin.from('restaurante_config_delivery')
      .select('tarifa_base, tarifa_radio_base_km, tarifa_precio_km, tarifa_maxima')
      .eq('establecimiento_id', establecimiento_id).maybeSingle();

    let tarifaActual: any;
    let origenSnapshot: 'restaurante' | 'plataforma_default';

    if (cfgRest && (cfgRest.tarifa_base != null || cfgRest.tarifa_radio_base_km != null ||
                    cfgRest.tarifa_precio_km != null || cfgRest.tarifa_maxima != null)) {
      // Restaurante tiene config propia: snapshot directo
      tarifaActual = {
        tarifa_base: cfgRest.tarifa_base ?? null,
        tarifa_radio_base_km: cfgRest.tarifa_radio_base_km ?? null,
        tarifa_precio_km: cfgRest.tarifa_precio_km ?? null,
        tarifa_maxima: cfgRest.tarifa_maxima ?? null,
      };
      origenSnapshot = 'restaurante';
    } else {
      // Sin config propia: congelamos los defaults de plataforma para evitar
      // que un cambio futuro en configuracion_plataforma altere la tarifa del socio.
      tarifaActual = await leerDefaultsPlataforma(admin);
      origenSnapshot = 'plataforma_default';
    }

    // Race-check: si el socio mando snapshot, debe coincidir
    if (tarifa_snapshot && !tarifaEqual(tarifa_snapshot, tarifaActual)) {
      return json({
        error: 'La tarifa cambio mientras decidias. Revisala y vuelve a confirmar.',
        tarifa_actual: tarifaActual,
      }, 409);
    }

    const ahora = new Date().toISOString();
    const expira = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    const { data, error } = await admin.from('socio_establecimiento').insert({
      socio_id: socio.id,
      establecimiento_id,
      estado: 'pendiente',
      solicitado_at: ahora,
      tarifa_pendiente: tarifaActual,
      tarifa_pendiente_at: ahora,
      tarifa_pendiente_origen: 'restaurante',
      tarifa_pendiente_expira_en: expira,
    }).select().single();
    if (error) throw error;

    await admin.from('socio_establecimiento_tarifa_log').insert({
      socio_id: socio.id,
      establecimiento_id,
      evento: 'propuesta_creada',
      origen: 'restaurante',
      tarifa_nueva: tarifaActual,
      motivo: origenSnapshot === 'plataforma_default'
        ? 'Propuesta inicial: el restaurante no tiene config propia, snapshot de defaults de plataforma (cierre opcion B).'
        : 'Propuesta inicial al solicitar vinculacion. El socio acepto la tarifa actual del restaurante.',
      created_by: user.id,
    });

    return json({ ok: true, vinculacion: data, tarifa_propuesta: tarifaActual, origen_snapshot: origenSnapshot });
  } catch (err: any) {
    console.error('[solicitar-vinculacion-socio]', err);
    return json({ error: err.message }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}
