import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'No autorizado' }), { status: 401, headers: corsHeaders })
    }
    const { data: { user }, error: authError } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''))
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Token invalido' }), { status: 401, headers: corsHeaders })
    }

    const { pedido_id } = await req.json()
    if (!pedido_id) throw new Error('pedido_id es requerido')

    const { data: pedido, error: pedidoError } = await supabase
      .from('pedidos')
      .select('*')
      .eq('id', pedido_id)
      .single()

    if (pedidoError || !pedido) throw new Error('Pedido no encontrado')
    if (pedido.estado !== 'entregado') throw new Error('El pedido no esta entregado')

    const { data: existing } = await supabase.from('comisiones').select('id').eq('pedido_id', pedido_id).maybeSingle()
    if (existing) {
      return new Response(
        JSON.stringify({ success: true, message: 'Comision ya existente', comision: existing }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const { data: configRows } = await supabase
      .from('configuracion_plataforma')
      .select('clave, valor')
      .in('clave', ['comision_plataforma', 'comision_pidoo_pct'])

    const config: Record<string, number> = {}
    for (const row of (configRows || [])) {
      config[row.clave] = parseFloat(row.valor)
    }

    // Porcentaje efectivo:
    // 1) override por pedido si existe
    // 2) 0 si origen = tienda_publica (plan 39EUR/mes cubre la comision)
    // 3) comision_pidoo_pct de configuracion (default 10)
    const pctBase = (config.comision_pidoo_pct ?? config.comision_plataforma ?? 10)
    const pctEfectivo = pedido.comision_pidoo_pct_override != null
      ? Number(pedido.comision_pidoo_pct_override)
      : (pedido.origen_pedido === 'tienda_publica' ? 0 : pctBase)
    const pctPlataforma = pctEfectivo / 100
    const esReparto = (pedido.coste_envio || 0) > 0
    const tipo = esReparto ? 'reparto' : 'recogida'
    const subtotal = pedido.subtotal || 0

    const comision_plataforma = subtotal * pctPlataforma

    const { data: comision, error: comError } = await supabase
      .from('comisiones')
      .insert({
        pedido_id: pedido.id,
        establecimiento_id: pedido.establecimiento_id,
        total_pedido: subtotal,
        comision_plataforma,
        comision_socio: 0,
        tipo,
      })
      .select()
      .single()

    if (comError) throw comError

    if (pedido.metodo_pago === 'tarjeta') {
      await supabase.from('movimientos_cuenta').insert({
        tipo: 'entrada_tarjeta',
        pedido_id: pedido.id,
        establecimiento_id: pedido.establecimiento_id,
        monto: pedido.total,
        descripcion: `Pago tarjeta pedido ${pedido.codigo}`,
        referencia: pedido.codigo,
      })
    } else if (pedido.metodo_pago === 'efectivo') {
      await supabase.from('movimientos_cuenta').insert({
        tipo: 'entrada_efectivo',
        pedido_id: pedido.id,
        establecimiento_id: pedido.establecimiento_id,
        monto: pedido.total,
        descripcion: `Cobro efectivo pedido ${pedido.codigo}`,
        referencia: pedido.codigo,
      })
    }

    return new Response(
      JSON.stringify({ success: true, comision, pct_aplicado: pctEfectivo, origen: pedido.origen_pedido || 'listado' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
