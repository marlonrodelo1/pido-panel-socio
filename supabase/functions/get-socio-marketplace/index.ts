// get-socio-marketplace v21 — v12 (autonomia socio + offline no cierra tienda) +
// v13 (22-jul-2026): splash_titulo / splash_subtitulo para el branding personalizable
// de la portada de la tienda del socio (white-label) +
// v15 (1-ago-2026): los restaurantes CERRADOS ya no se ocultan. Se devuelven igual
// (con 'activo' y 'horario' en el select) para que el cliente los pinte en gris con
// el cartel "Cerrado" en vez de hacerlos desaparecer del marketplace del socio.
// Lo que SIGUE fuera es lo no verificado: .eq('estado','activo').
//
// v16 (14-ago-2026): ESTE ENDPOINT ES PUBLICO Y DEVOLVIA DATOS PERSONALES.
//   El objeto `socio` se spreadea entero a la respuesta, asi que la tienda publica
//   /s/<slug> estaba publicando el NOMBRE REAL del socio y la hora de su ULTIMA
//   LOCALIZACION a cualquiera que llamara al endpoint. Es la misma categoria de dato
//   que se cerro el mismo dia en la tabla `socios` (migracion
//   `socios_anon_sin_datos_personales`, que revoco nombre/email/telefono/GPS a `anon`);
//   dejarlo abierto aqui habria hecho inutil aquello.
//   - `nombre` sale del SELECT: no lo necesita nadie.
//   - `last_location_at` SE MANTIENE en el select porque con el se calcula
//     `senalFresca`, pero se saca de la respuesta antes de devolverla.
//   Comprobado que el frontend no usa ninguno de los dos: en todo pido-app/src no hay
//   una sola referencia a `socio.nombre` ni a `last_location_at`. La tienda pinta
//   `nombre_comercial` (TiendaSocio.jsx:229, 267) y la disponibilidad de reparto la lee
//   de `rider_online`, que se sigue calculando y devolviendo igual.
//
// v20 (17-sep-2026): LA FRESCURA YA NO ES UN 12 FIJO. Se lee en cada llamada de
//   configuracion_plataforma.presencia_socio_frescura_min: 0 = sin gate (rider_online
//   manda el interruptor En linea), N = minutos de silencio tolerados. Si la clave falta
//   o no es un numero se cae al 12 historico. Misma fuente que socio_senal_vigente() en
//   BD, check-socio-availability-now v18, crear-pedido-telefonico v9 y create-shipday-order v63.
//
// v21 (5-oct-2026): EL RESTAURANTE QUE EL SOCIO PAUSA SALE DE SU MARKETPLACE. Antes
//   (reparto_activo = false) seguia en la lista con solo recogida. Marlon: apagar un
//   restaurante en su ficha = no recibir sus pedidos por ninguna via Y que no salga en el
//   marketplace del socio. Se quito a la vez la tarjeta "Fuentes de pedidos" de la app del
//   socio (acepta_* quedan todas a true en BD).
//
// La tienda publica del socio queda ABIERTA si socios.activo = true y
// socios.marketplace_activo = true. El estado en_servicio (online/offline) NO
// cierra la tienda: si el socio esta offline, la tienda sigue abierta pero en
// modo SOLO RECOGIDA. rider_online indica si hay reparto a domicilio (senal vigente
// segun la clave de arriba + acepta_marketplace + reparto_activo por restaurante).

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

const FRESH_MIN_FALLBACK = 12
// null = sin gate (clave a 0). Numero = milisegundos de silencio tolerados.
async function frescuraMs(): Promise<number | null> {
  try {
    const { data } = await supabase.from('configuracion_plataforma').select('valor').eq('clave', 'presencia_socio_frescura_min').maybeSingle()
    const raw = String(data?.valor ?? '').trim()
    if (!/^\d+$/.test(raw)) return FRESH_MIN_FALLBACK * 60 * 1000
    const n = Number(raw)
    return n === 0 ? null : n * 60 * 1000
  } catch (_) { return FRESH_MIN_FALLBACK * 60 * 1000 }
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

    const cliLat = parseFloat(url.searchParams.get('lat') || '')
    const cliLng = parseFloat(url.searchParams.get('lng') || '')
    const tieneUbicacion = Number.isFinite(cliLat) && Number.isFinite(cliLng)

    const { data: socio, error } = await supabase
      .from('socios')
      .select('id, nombre_comercial, slug, logo_url, banner_url, descripcion, splash_titulo, splash_subtitulo, redes, color_primario, rating, total_resenas, marketplace_activo, activo, en_servicio, radio_marketplace_km, acepta_marketplace, last_location_at')
      .eq('slug', slug)
      .maybeSingle()
    if (error) throw error
    if (!socio) return json({ error: 'socio no encontrado' }, 404)

    // v16: `last_location_at` se usa aqui dentro para la frescura de la senal, pero NO
    // sale a la respuesta: es dato de localizacion de una persona identificada.
    const { last_location_at: _ultimaSenal, ...socioPublico } = socio as Record<string, unknown>

    const tiendaCerrada = socio.activo === false || socio.marketplace_activo === false

    if (tiendaCerrada) {
      return json({
        socio: { ...socioPublico, rider_online: false },
        restaurantes: [],
        tienda_cerrada: true,
        razon: !socio.activo ? 'desactivado' : 'marketplace_pausado',
      })
    }

    // v20: umbral desde la base de datos; null = sin gate.
    const freshMs = await frescuraMs()
    const tsSenal = socio.last_location_at ? new Date(socio.last_location_at).getTime() : NaN
    const senalFresca = freshMs == null ? true : (Number.isFinite(tsSenal) && (Date.now() - tsSenal) <= freshMs)
    const aceptaMarketplace = socio.acepta_marketplace !== false
    const socioDisponible = !!socio.en_servicio && senalFresca && aceptaMarketplace

    const { data: vinculaciones } = await supabase
      .from('socio_establecimiento')
      .select('establecimiento_id, destacado, orden_destacado, reparto_activo')
      .eq('socio_id', socio.id)
      .eq('estado', 'activa')

    // v21: los restaurantes que el socio ha pausado no salen en su marketplace.
    const ids = (vinculaciones || []).filter((v) => v.reparto_activo !== false).map((v) => v.establecimiento_id)
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
      socio: { ...socioPublico, rider_online: socioDisponible },
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
