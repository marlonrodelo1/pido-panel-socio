import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getCorsHeaders, handleCorsPreflightRequest } from './_shared/cors.ts'

// calcular_envio v18 — modelo 19-jun-2026:
//   El RESTAURANTE fija el envio que paga el cliente, y es el MISMO en su tienda
//   publica (pidoo.es/<slug>) y en la tienda del socio (pidoo.es/s/<slug>).
//   v18: gating server-side. Si establecimientos.tiene_delivery=false (no hay
//   socios activos), se devuelve { error: 'delivery_disabled' } 400 ANTES de
//   calcular tarifa. El cliente debe caer a solo recogida.

function calcularDistancia(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return handleCorsPreflightRequest(req)
  const CORS = getCorsHeaders(req)
  try {
    const { establecimiento_id, lat_cliente, lng_cliente } = await req.json()
    if (!establecimiento_id || lat_cliente === undefined || lng_cliente === undefined) {
      return Response.json({ error: 'Missing required parameters' }, { status: 400, headers: CORS })
    }
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

    const { data: establecimiento, error: estError } = await supabase
      .from('establecimientos').select('latitud, longitud, radio_cobertura_km, tarifa_envio_fija, tiene_delivery')
      .eq('id', establecimiento_id).single()
    if (estError || !establecimiento) return Response.json({ error: 'Establecimiento no encontrado' }, { status: 404, headers: CORS })

    // Gating server-side: sin delivery activo (no hay socios activos) -> solo recogida.
    if (establecimiento.tiene_delivery === false) {
      return Response.json({ error: 'delivery_disabled', delivery_disabled: true }, { status: 400, headers: CORS })
    }

    const distancia_km = calcularDistancia(establecimiento.latitud, establecimiento.longitud, lat_cliente, lng_cliente)

    const radioCobertura = establecimiento.radio_cobertura_km ?? 15
    if (distancia_km > radioCobertura) {
      return Response.json({ error: `La direccion esta fuera del area de reparto (${Math.round(distancia_km)} km, maximo ${radioCobertura} km)`, fuera_de_radio: true, distancia_km: Math.round(distancia_km * 100) / 100 }, { status: 400, headers: CORS })
    }

    const tarifaFija = establecimiento.tarifa_envio_fija != null ? Number(establecimiento.tarifa_envio_fija) : null
    if (tarifaFija != null && tarifaFija >= 0) {
      return Response.json({
        success: true,
        envio: Math.round(tarifaFija * 100) / 100,
        distancia_km: Math.round(distancia_km * 100) / 100,
        tarifa_fija: true,
        fuente_tarifa: 'restaurante_fija',
      }, { status: 200, headers: CORS })
    }

    const { data: cfgRows } = await supabase
      .from('configuracion_plataforma').select('clave, valor')
      .in('clave', ['envio_tarifa_base','envio_radio_base_km','envio_precio_km_adicional','envio_tarifa_maxima','override_tarifa_permitido'])
    const cfg: Record<string, string> = {}
    for (const r of (cfgRows || [])) cfg[r.clave] = r.valor
    let tarifaBase = parseFloat(cfg['envio_tarifa_base'] || '2.50')
    let radioBase = parseFloat(cfg['envio_radio_base_km'] || '2')
    let precioKm = parseFloat(cfg['envio_precio_km_adicional'] || '0.50')
    let tarifaMax = parseFloat(cfg['envio_tarifa_maxima'] || '15.00')
    const overrideTarifaPermitido = (cfg['override_tarifa_permitido'] || 'false') === 'true'
    let fuenteTarifa: string = 'plataforma_default'

    if (overrideTarifaPermitido) {
      const { data: cfgRest } = await supabase
        .from('restaurante_config_delivery')
        .select('tarifa_base, tarifa_radio_base_km, tarifa_precio_km, tarifa_maxima, override_activo')
        .eq('establecimiento_id', establecimiento_id).maybeSingle()
      if (cfgRest?.override_activo && cfgRest.tarifa_base != null) {
        tarifaBase = Number(cfgRest.tarifa_base)
        if (cfgRest.tarifa_radio_base_km != null) radioBase = Number(cfgRest.tarifa_radio_base_km)
        if (cfgRest.tarifa_precio_km != null) precioKm = Number(cfgRest.tarifa_precio_km)
        if (cfgRest.tarifa_maxima != null) tarifaMax = Number(cfgRest.tarifa_maxima)
        fuenteTarifa = 'restaurante_global'
      }
    }

    const extraKm = Math.max(0, distancia_km - radioBase)
    const envio = Math.min(tarifaMax, Math.max(tarifaBase, tarifaBase + extraKm * precioKm))

    return Response.json({
      success: true,
      envio: Math.round(envio * 100) / 100,
      distancia_km: Math.round(distancia_km * 100) / 100,
      fuente_tarifa: fuenteTarifa,
    }, { status: 200, headers: CORS })
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Internal server error'
    return Response.json({ error: msg }, { status: 500, headers: CORS })
  }
})
