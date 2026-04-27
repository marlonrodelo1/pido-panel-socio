// generar-balances-socio v3 — protegida por CRON_SECRET (X-Cron-Secret).
// Cron pg_cron jobid=10 lunes 02:30.

import { createClient } from 'jsr:@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'content-type, x-cron-secret, authorization' };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  // Auth: CRON_SECRET o JWT de superadmin
  const cronSecret = Deno.env.get('CRON_SECRET');
  const headerSecret = req.headers.get('X-Cron-Secret');
  const authHeader = req.headers.get('Authorization');
  let autorizado = false;
  if (cronSecret && headerSecret && headerSecret === cronSecret) autorizado = true;
  else if (authHeader) {
    try {
      const sUser = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authHeader } } });
      const { data: u } = await sUser.auth.getUser();
      if (u?.user) {
        const { data: usuario } = await supabase.from('usuarios').select('rol').eq('id', u.user.id).maybeSingle();
        if (usuario?.rol === 'superadmin') autorizado = true;
      }
    } catch (_) {}
  }
  if (!autorizado) return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { ...CORS, 'Content-Type': 'application/json' } });

  try {
    const hoy = new Date();
    const finSemana = new Date(hoy); finSemana.setUTCHours(0,0,0,0);
    const inicioSemana = new Date(finSemana); inicioSemana.setUTCDate(finSemana.getUTCDate() - 7);
    const periodo_inicio = inicioSemana.toISOString().slice(0, 10);
    const periodo_fin = finSemana.toISOString().slice(0, 10);

    const { data: socios } = await supabase.from('socios').select('id, nombre_comercial').eq('activo', true);
    const resultados: any[] = [];

    for (const socio of socios || []) {
      const { data: pedidosSemana } = await supabase
        .from('pedidos')
        .select('id, metodo_pago, total, coste_envio, propina, subtotal')
        .eq('socio_id', socio.id)
        .eq('estado', 'entregado')
        .gte('entregado_at', periodo_inicio + 'T00:00:00Z')
        .lt('entregado_at', periodo_fin + 'T00:00:00Z');

      const pedidoIds = (pedidosSemana || []).map(p => p.id);
      let comisiones_tarjeta = 0, envios_tarjeta = 0, propinas_tarjeta = 0, total_efectivo_recaudado = 0, total_pagar_socio = 0;

      if (pedidoIds.length > 0) {
        const { data: earnings } = await supabase
          .from('rider_earnings').select('pedido_id, comision_rider_sobre_subtotal, coste_envio, propina, neto_rider').in('pedido_id', pedidoIds);
        const earningsMap = new Map((earnings || []).map((e: any) => [e.pedido_id, e]));
        for (const p of pedidosSemana || []) {
          const e = earningsMap.get(p.id);
          if (!e) continue;
          if (p.metodo_pago === 'tarjeta') {
            comisiones_tarjeta += Number(e.comision_rider_sobre_subtotal || 0);
            envios_tarjeta += Number(e.coste_envio || 0);
            propinas_tarjeta += Number(e.propina || 0);
            total_pagar_socio += Number(e.neto_rider || 0);
          } else if (p.metodo_pago === 'efectivo') {
            total_efectivo_recaudado += Number(p.total || 0);
          }
        }
      }

      const { data: existente } = await supabase.from('balances_socio').select('id').eq('socio_id', socio.id).eq('periodo_inicio', periodo_inicio).eq('periodo_fin', periodo_fin).maybeSingle();
      if (existente) {
        await supabase.from('balances_socio').update({
          comisiones_tarjeta, envios_tarjeta, propinas_tarjeta,
          total_pagar_socio, total_efectivo_recaudado,
          estado: 'pendiente',
        }).eq('id', existente.id);
        resultados.push({ socio: socio.nombre_comercial, actualizado: true, total_pagar_socio });
      } else if (pedidoIds.length > 0) {
        await supabase.from('balances_socio').insert({
          socio_id: socio.id, periodo_inicio, periodo_fin,
          comisiones_tarjeta, envios_tarjeta, propinas_tarjeta,
          total_pagar_socio, total_efectivo_recaudado,
          estado: 'pendiente',
        });
        resultados.push({ socio: socio.nombre_comercial, creado: true, total_pagar_socio });
      }
    }

    return new Response(JSON.stringify({ ok: true, periodo: `${periodo_inicio} -> ${periodo_fin}`, procesados: resultados.length, resultados }), { headers: { ...CORS, 'Content-Type': 'application/json' } });
  } catch (err: any) {
    console.error('[generar-balances-socio]', err);
    return new Response(JSON.stringify({ ok: false, error: err.message }), { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }
});
