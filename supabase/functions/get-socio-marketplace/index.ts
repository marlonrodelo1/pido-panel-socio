// get-socio-marketplace v6 — filtro por radio del marketplace.
//
// La tienda publica del socio queda abierta solo si socios.en_servicio = true
// y socios.activo = true y socios.marketplace_activo = true.
//
// Si el cliente envia lat/lng en query string, ademas filtramos los
// restaurantes vinculados que esten a > socios.radio_marketplace_km de su
// ubicacion. Si no hay lat/lng o el socio no tiene radio definido, no se
// filtra (se devuelven todos los vinculados activos).

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

    // Lat/lng del cliente (opcional). Si vienen, aplicamos filtro de radio.
    const cliLat = parseFloat(url.searchParams.get('lat') || '')
    const cliLng = parseFloat(url.searchParams.get('lng') || '')
    const tieneUbicacion = Number.isFinite(cliLat) && Number.isFinite(cliLng)

    const { data: socio, error } = await supabase
      .from('socios')
      .select('id, nombre, nombre_comercial, slug, logo_url, banner_url, descripcion, redes, color_primario, rating, total_resenas, marketplace_activo, activo, en_servicio, radio_marketplace_km')
      .eq('slug', slug)
      .maybeSingle()
    if (error) throw error
    if (!socio) return json({ error: 'socio no encontrado' }, 404)

    const tiendaCerrada = socio.activo === false || socio.marketplace_activo === false || socio.en_servicio !== true

    if (tiendaCerrada) {
      return json({
        socio: { ...socio, rider_online: !!socio.en_servicio },
        restaurantes: [],
        tienda_cerrada: true,
        razon: !socio.activo ? 'desactivado' : (!socio.marketplace_activo ? 'marketplace_pausado' : 'rider_offline'),
      })
    }

    const { data: vinculaciones } = await supabase
      .from('socio_establecimiento')
      .select('establecimiento_id, destacado, orden_destacado')
      .eq('socio_id', socio.id)
      .eq('estado', 'activa')

    const ids = (vinculaciones || []).map((v) => v.establecimiento_id)
    let restaurantes: any[] = []
    if (ids.length > 0) {
      const { data: rests } = await supabase
        .from('establecimientos')
        .select('id, nombre, tipo, categoria, logo_url, banner_url, slug, rating, total_resenas, direccion, latitud, longitud, activo, estado, horario, tiene_delivery, radio_cobertura_km')
        .in('id', ids)
        .eq('activo', true)
        .eq('estado', 'activo')
      const vincMap = new Map((vinculaciones || []).map((v) => [v.establecimiento_id, v]))
      let listado = (rests || []).map((r) => ({ ...r, destacado: vincMap.get(r.id)?.destacado || false, orden_destacado: vincMap.get(r.id)?.orden_destacado || 999 }))

      // Filtro por radio del marketplace del socio (si tenemos ubicacion).
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
      socio: { ...socio, rider_online: true },
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
