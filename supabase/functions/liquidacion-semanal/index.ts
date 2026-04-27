// liquidacion-semanal v4 — protegida por CRON_SECRET (header X-Cron-Secret).
// Llamada por cron pg_cron jobid=9 cada lunes 03:00.

import Stripe from 'npm:stripe@14.0.0';
import { createClient } from 'jsr:@supabase/supabase-js@2';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { apiVersion: '2023-10-16' });
const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

const UMBRAL_MINIMO = 1.00;

Deno.serve(async (req) => {
  // Auth: solo el cron con CRON_SECRET, o un superadmin con JWT
  const cronSecret = Deno.env.get('CRON_SECRET');
  const headerSecret = req.headers.get('X-Cron-Secret');
  const authHeader = req.headers.get('Authorization');

  let autorizado = false;
  if (cronSecret && headerSecret && headerSecret === cronSecret) {
    autorizado = true;
  } else if (authHeader) {
    // Permitir invocación manual desde super-admin si pasa JWT y es superadmin
    try {
      const supaUser = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_ANON_KEY')!,
        { global: { headers: { Authorization: authHeader } } }
      );
      const { data: u } = await supaUser.auth.getUser();
      if (u?.user) {
        const { data: usuario } = await supabase.from('usuarios').select('rol').eq('id', u.user.id).maybeSingle();
        if (usuario?.rol === 'superadmin') autorizado = true;
      }
    } catch (_) {/* fall through */}
  }
  if (!autorizado) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }

  try {
    const url = new URL(req.url);
    const forzarId = url.searchParams.get('establecimiento_id');
    const dryRun = url.searchParams.get('dry_run') === '1';

    let q = supabase
      .from('establecimientos')
      .select('id, nombre, stripe_connect_account_id, stripe_connect_status, balance_card_acumulado, deuda_cash_acumulada, cash_bloqueado_por_deuda, limite_deuda_cash');
    if (forzarId) q = q.eq('id', forzarId);
    else q = q.eq('stripe_connect_status', 'activa');
    const { data: ests, error } = await q;
    if (error) throw error;

    const resultados: any[] = [];
    const hoy = new Date();
    const periodo_fin = hoy.toISOString().slice(0, 10);
    const inicioSemana = new Date(hoy);
    inicioSemana.setDate(hoy.getDate() - 7);
    const periodo_inicio = inicioSemana.toISOString().slice(0, 10);

    for (const est of ests || []) {
      const saldoRest = Number(est.balance_card_acumulado || 0);
      const deuda = Number(est.deuda_cash_acumulada || 0);
      const neto = +(saldoRest - deuda).toFixed(2);

      const { count: pedCard } = await supabase
        .from('pedidos').select('*', { count: 'exact', head: true })
        .eq('establecimiento_id', est.id).eq('estado', 'entregado').eq('metodo_pago', 'tarjeta')
        .gte('entregado_at', periodo_inicio);
      const { count: pedCash } = await supabase
        .from('pedidos').select('*', { count: 'exact', head: true })
        .eq('establecimiento_id', est.id).eq('estado', 'entregado').eq('metodo_pago', 'efectivo')
        .gte('entregado_at', periodo_inicio);

      if (dryRun) {
        resultados.push({ est_id: est.id, nombre: est.nombre, saldoRest, deuda, neto, accion: 'dry_run' });
        continue;
      }

      if (neto < UMBRAL_MINIMO && neto > -UMBRAL_MINIMO) {
        resultados.push({ est_id: est.id, neto, accion: 'skip_minimo' });
        continue;
      }

      let transferId: string | null = null;
      let transferStatus: string | null = null;
      let errorMsg: string | null = null;

      if (neto > 0) {
        if (!est.stripe_connect_account_id) {
          errorMsg = 'sin_cuenta_connect';
          transferStatus = 'bloqueado';
        } else {
          try {
            const transfer = await stripe.transfers.create({
              amount: Math.round(neto * 100),
              currency: 'eur',
              destination: est.stripe_connect_account_id,
              description: `Liquidación semanal Pidoo ${periodo_inicio} a ${periodo_fin}`,
              metadata: { establecimiento_id: est.id, periodo_inicio, periodo_fin },
            });
            transferId = transfer.id;
            transferStatus = 'created';
          } catch (e: any) {
            errorMsg = e.message;
            transferStatus = 'failed';
          }
        }
      } else {
        transferStatus = 'rollover_deuda';
      }

      await supabase.from('facturas_semanales').insert({
        establecimiento_id: est.id,
        periodo_inicio,
        periodo_fin,
        pedidos_tarjeta: pedCard || 0,
        ventas_tarjeta: saldoRest,
        a_favor_restaurante: saldoRest,
        pedidos_efectivo: pedCash || 0,
        ventas_efectivo: 0,
        debe_restaurante: deuda,
        balance_neto: neto,
        comision_plataforma: deuda,
        estado: transferStatus,
        stripe_transfer_id: transferId,
        stripe_transfer_status: transferStatus,
        pagado_at: transferId ? new Date().toISOString() : null,
        error_mensaje: errorMsg,
        deuda_previa: deuda,
        deuda_arrastrada: neto < 0 ? Math.abs(neto) : 0,
      });

      const nuevaDeudaCash = neto < 0 ? Math.abs(neto) : 0;
      const { data: estConLimite } = await supabase.from('establecimientos').select('limite_deuda_cash').eq('id', est.id).single();
      const limite = Number(estConLimite?.limite_deuda_cash || 150);
      await supabase.from('establecimientos').update({
        balance_card_acumulado: 0,
        deuda_cash_acumulada: nuevaDeudaCash,
        cash_bloqueado_por_deuda: nuevaDeudaCash >= limite,
        ultima_liquidacion_at: new Date().toISOString(),
      }).eq('id', est.id);

      resultados.push({ est_id: est.id, nombre: est.nombre, saldoRest, deuda, neto, transferId, transferStatus, errorMsg });
    }

    return new Response(JSON.stringify({ ok: true, resultados }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    console.error('[liquidacion-semanal]', err);
    return new Response(JSON.stringify({ ok: false, error: err.message }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
});
