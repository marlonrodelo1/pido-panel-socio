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

    const { data: configRows } = await supabase
      .from('configuracion_plataforma')
      .select('clave, valor')
      .in('clave', ['comision_plataforma', 'comision_socio_reparto', 'comision_socio_recogida'])

    const config: Record<string, number> = {}
    for (const row of (configRows || [])) {
      config[row.clave] = parseFloat(row.valor)
    }

    const pctPlataforma = (config.comision_plataforma ?? 10) / 100
    const pctSocioReparto = (config.comision_socio_reparto ?? 10) / 100
    const pctSocioRecogida = (config.comision_socio_recogida ?? 5) / 100

    const hoy = new Date()
    const diaSemana = hoy.getDay() || 7
    const lunesPasado = new Date(hoy)
    lunesPasado.setDate(hoy.getDate() - diaSemana - 6)
    lunesPasado.setHours(0, 0, 0, 0)

    const domingoPasado = new Date(lunesPasado)
    domingoPasado.setDate(lunesPasado.getDate() + 6)
    domingoPasado.setHours(23, 59, 59, 999)

    const semanaInicio = lunesPasado.toISOString().split('T')[0]
    const semanaFin = domingoPasado.toISOString().split('T')[0]

    const { data: pedidos } = await supabase
      .from('pedidos')
      .select('*, comisiones(*)')
      .gte('created_at', lunesPasado.toISOString())
      .lte('created_at', domingoPasado.toISOString())

    if (!pedidos || pedidos.length === 0) {
      return new Response(
        JSON.stringify({ message: 'No hay pedidos en la semana', informes: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const grupos: Record<string, any[]> = {}
    for (const pedido of pedidos) {
      if (!pedido.socio_id || !pedido.establecimiento_id) continue
      const key = `${pedido.socio_id}__${pedido.establecimiento_id}`
      if (!grupos[key]) grupos[key] = []
      grupos[key].push(pedido)
    }

    let informesCreados = 0

    for (const [key, pedidosGrupo] of Object.entries(grupos)) {
      const [socioId, estId] = key.split('__')
      const entregados = pedidosGrupo.filter(p => p.estado === 'entregado')
      const cancelados = pedidosGrupo.filter(p => p.estado === 'cancelado')
      const fallidos = pedidosGrupo.filter(p => p.estado === 'fallido')
      const pedidosTarjeta = entregados.filter(p => p.metodo_pago === 'tarjeta')
      const pedidosEfectivo = entregados.filter(p => p.metodo_pago === 'efectivo')
      const totalVentas = entregados.reduce((s, p) => s + (p.subtotal || 0), 0)
      const ventasTarjeta = pedidosTarjeta.reduce((s, p) => s + (p.subtotal || 0), 0)
      const ventasEfectivo = pedidosEfectivo.reduce((s, p) => s + (p.subtotal || 0), 0)
      const comisiones = entregados.flatMap(p => p.comisiones || [])
      const totalComisiones = comisiones.reduce((s, c) => s + (c.comision_socio || 0), 0)
      const totalEnvios = comisiones.reduce((s, c) => s + (c.envio_socio || 0), 0)
      const totalPropinas = comisiones.reduce((s, c) => s + (c.propina_socio || 0), 0)

      await supabase.from('facturas_semanales').insert({
        socio_id: socioId, establecimiento_id: estId,
        semana_inicio: semanaInicio, semana_fin: semanaFin,
        total_pedidos: pedidosGrupo.length, pedidos_entregados: entregados.length,
        pedidos_cancelados: cancelados.length, pedidos_fallidos: fallidos.length,
        pedidos_tarjeta: pedidosTarjeta.length, pedidos_efectivo: pedidosEfectivo.length,
        total_ventas: totalVentas, ventas_tarjeta: ventasTarjeta, ventas_efectivo: ventasEfectivo,
        total_comisiones: totalComisiones, total_envios: totalEnvios, total_propinas: totalPropinas,
        total_ganado: totalComisiones + totalEnvios + totalPropinas,
      })
      informesCreados++
    }

    const restGrupos: Record<string, any[]> = {}
    for (const pedido of pedidos.filter(p => p.estado === 'entregado')) {
      if (!pedido.establecimiento_id) continue
      if (!restGrupos[pedido.establecimiento_id]) restGrupos[pedido.establecimiento_id] = []
      restGrupos[pedido.establecimiento_id].push(pedido)
    }

    for (const [estId, pedidosEst] of Object.entries(restGrupos)) {
      const tarjeta = pedidosEst.filter(p => p.metodo_pago === 'tarjeta')
      const efectivo = pedidosEst.filter(p => p.metodo_pago === 'efectivo')
      const ventasTarjeta = tarjeta.reduce((s, p) => s + (p.subtotal || 0), 0)
      const ventasEfectivo = efectivo.reduce((s, p) => s + (p.subtotal || 0), 0)
      const aFavor = ventasTarjeta * (1 - pctPlataforma)
      const debe = ventasEfectivo * pctPlataforma

      await supabase.from('balances_restaurante').insert({
        establecimiento_id: estId, periodo_inicio: semanaInicio, periodo_fin: semanaFin,
        pedidos_tarjeta: tarjeta.length, ventas_tarjeta: ventasTarjeta, a_favor_restaurante: aFavor,
        pedidos_efectivo: efectivo.length, ventas_efectivo: ventasEfectivo, debe_restaurante: debe,
        balance_neto: aFavor - debe, comision_plataforma: (ventasTarjeta + ventasEfectivo) * pctPlataforma,
      })
    }

    const socioGrupos: Record<string, any[]> = {}
    for (const pedido of pedidos.filter(p => p.estado === 'entregado')) {
      if (!pedido.socio_id) continue
      if (!socioGrupos[pedido.socio_id]) socioGrupos[pedido.socio_id] = []
      socioGrupos[pedido.socio_id].push(pedido)
    }

    for (const [socioId, pedidosSocio] of Object.entries(socioGrupos)) {
      const tarjeta = pedidosSocio.filter(p => p.metodo_pago === 'tarjeta')
      const efectivo = pedidosSocio.filter(p => p.metodo_pago === 'efectivo')
      const comisionesTarjeta = tarjeta.reduce((s, p) => {
        const esReparto = (p.coste_envio || 0) > 0
        return s + (p.subtotal || 0) * (esReparto ? pctSocioReparto : pctSocioRecogida)
      }, 0)
      const enviosTarjeta = tarjeta.reduce((s, p) => s + (p.coste_envio || 0), 0)
      const propinasTarjeta = tarjeta.reduce((s, p) => s + (p.propina || 0), 0)
      const efectivoRecaudado = efectivo.reduce((s, p) => s + (p.total || 0), 0)

      await supabase.from('balances_socio').insert({
        socio_id: socioId, periodo_inicio: semanaInicio, periodo_fin: semanaFin,
        comisiones_tarjeta: comisionesTarjeta, envios_tarjeta: enviosTarjeta,
        propinas_tarjeta: propinasTarjeta, total_pagar_socio: comisionesTarjeta + enviosTarjeta + propinasTarjeta,
        total_efectivo_recaudado: efectivoRecaudado,
      })
    }

    return new Response(
      JSON.stringify({ success: true, informes: informesCreados, semana: `${semanaInicio} - ${semanaFin}` }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})