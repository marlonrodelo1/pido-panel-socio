// get-socio-marketplace v15 — v12 (autonomia socio + offline no cierra tienda) +
// v13 (22-jul-2026): splash_titulo / splash_subtitulo para el branding personalizable
// de la portada de la tienda del socio (white-label) +
// v15 (1-ago-2026): los restaurantes CERRADOS ya no se ocultan. Se devuelven igual
// (con 'activo' y 'horario' en el select) para que el cliente los pinte en gris con
// el cartel "Cerrado" en vez de hacerlos desaparecer del marketplace del socio.
// Lo que SIGUE fuera es lo no verificado: .eq('estado','activo').
//
// ⚠️ ESTE ARCHIVO ES LA COPIA FIEL DE LO DESPLEGADO (v15). Antes de tocarlo, baja la
// version viva con get_edge_function: esta copia llego a estar en v10 mientras
// produccion iba por v14, y desplegarla habria revertido el branding white-label,
// la autonomia del socio y la frescura de senal de 12 min.
//
// La tienda publica del socio queda ABIERTA si socios.activo = true y
// socios.marketplace_activo = true. El estado en_servicio (online/offline) NO
// cierra la tienda: si el socio esta offline, la tienda sigue abierta pero en
// modo SOLO RECOGIDA. rider_online indica si hay reparto a domicilio (frescura de
// senal <=12min + acepta_marketplace + reparto_activo por restaurante).

import { createClient } from 'jsr:@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}

const FRESH_MS = 12 * 60 * 1000

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371
  const toRad = (d: number) => d * Math.PI / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng/2)**2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  try {
    const url = new URL(req.url)
    const slug = url.searchParams.get('slug') || (await req.json().catch(() => ({}))).slug
    if (!slug) return json({ error: 'slug requerido' }, 400)

    const cliLat = parseFloat(url.searchParams.get('lat') || '')
    const cliLng = parseFloat(url.searchParams.get('lng') || '')
    const tieneUbicacion = Number.isFinite(cliLat) && Number.isFinite(cliLng)

    const { data: socio, error } = await supabase
      .from('socios')
      .select('id, nombre, nombre_comercial, slug, logo_url, banner_url, descripcion, splash_titulo, splash_subtitulo, redes, color_primario, rating, total_resenas, marketplace_activo, activo, en_servicio, radio_marketplace_km, acepta_marketplace, last_location_at')
      .eq('slug', slug)
      .maybeSingle()
    if (error) throw error
    if (!socio) return json({ error: 'socio no encontrado' }, 404)

    const tiendaCerrada = socio.activo === false || socio.marketplace_activo === false

    if (tiendaCerrada) {
      return json({
        socio: { ...socio, rider_online: false },
        restaurantes: [],
        tienda_cerrada: true,
        razon: !socio.activo ? 'desactivado' : 'marketplace_pausado',
      })
    }

    const tsSenal = socio.last_location_at ? new Date(socio.last_location_at).getTime() : NaN
    const senalFresca = Number.isFinite(tsSenal) && (Date.now() - tsSenal) <= FRESH_MS
    const aceptaMarketplace = socio.acepta_marketplace !== false
    const socioDisponible = !!socio.en_servicio && senalFresca && aceptaMarketplace

    const { data: vinculaciones } = await supabase
      .from('socio_establecimiento')
      .select('establecimiento_id, destacado, orden_destacado, reparto_activo')
      .eq('socio_id', socio.id)
      .eq('estado', 'activa')

    const ids = (vinculaciones || []).map((v) => v.establecimiento_id)
    let restaurantes: any[] = []
    if (ids.length > 0) {
      const { data: rests } = await supabase
        .from('establecimientos')
        .select('id, nombre, tipo, categoria, logo_url, banner_url, slug, rating, total_resenas, direccion, latitud, longitud, activo, estado, horario, tiene_delivery, radio_cobertura_km')
        .in('id', ids)
        // v15: sin .eq('activo', true). El cerrado se devuelve y el cliente lo pinta en
        // gris con "Cerrado" (estaAbierto() ya lee 'activo' y 'horario', que van en el
        // select). Ocultarlo aqui hacia imposible mostrarlo cerrado en la tienda del socio.
        .eq('estado', 'activo')
      const vincMap = new Map((vinculaciones || []).map((v) => [v.establecimiento_id, v]))
      let listado = (rests || []).map((r) => {
        const vinc = vincMap.get(r.id)
        const repartoActivo = vinc?.reparto_activo !== false
        return {
          ...r,
          tiene_delivery: socioDisponible && repartoActivo && !!r.tiene_delivery,
          destacado: vinc?.destacado || false,
          orden_destacado: vinc?.orden_destacado || 999,
        }
      })

      const radioKm = Number(socio.radio_marketplace_km) > 0 ? Number(socio.radio_marketplace_km) : null
      if (tieneUbicacion && radioKm) {
        listado = listado.filter((r) => {
          if (r.latitud == null || r.longitud == null) return true
          return haversineKm(cliLat, cliLng, r.latitud, r.longitud) <= radioKm
        })
      }

      listado.sort((a, b) => (b.destacado ? 1 : 0) - (a.destacado ? 1 : 0) || (a.orden_destacado - b.orden_destacado))
      restaurantes = listado
    }

    return json({
      socio: { ...socio, rider_online: socioDisponible },
      restaurantes,
      tienda_cerrada: false,
    })
  } catch (err: any) {
    console.error('[get-socio-marketplace]', err)
    return json({ error: err.message }, 500)
  }
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}
