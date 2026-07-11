// get-tracking-publico v8 (11-jul-2026): FIX embed ambiguo. Desde que v51 del
// dispatcher añadió pedidos.socio_responsable_id (2ª FK hacia socios, 10-jul),
// el embed `socios:socios(...)` era ambiguo para PostgREST y la query fallaba
// → not_found para TODOS los pedidos (tracking del cliente roto). Se fija la
// relación explícita `socios!pedidos_socio_id_fkey`.
import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'npm:@supabase/supabase-js@2'
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Content-Type': 'application/json' }
function json(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: CORS }) }
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)
  let body: { codigo?: string; token?: string } = {}
  try { body = await req.json() } catch (_) {}
  const codigo = (body.codigo || '').trim().toUpperCase()
  const token = (body.token || '').trim().toLowerCase()
  if (!codigo) return json({ error: 'not_found' }, 404)
  const hasValidToken = !!token && UUID_RE.test(token)
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false, autoRefreshToken: false } })
  let q = admin.from('pedidos').select(`id, codigo, estado, total, created_at, modo_entrega, minutos_preparacion, recogido_at, entregado_at, establecimiento_id, socio_id, lat_entrega, lng_entrega, establecimientos:establecimientos!inner(nombre, logo_url, telefono, latitud, longitud), socios:socios!pedidos_socio_id_fkey(id, nombre, nombre_comercial, slug, logo_url, color_primario, telefono, rating, latitud_actual, longitud_actual, last_location_at)`).eq('codigo', codigo)
  if (hasValidToken) q = q.eq('tracking_token', token)
  const { data: ped } = await q.maybeSingle()
  if (!ped) return json({ error: 'not_found' }, 404)
  const { data: items } = await admin.from('pedido_items').select('cantidad, nombre_producto, precio_unitario').eq('pedido_id', ped.id)
  // Fallback: si pedidos.socio_id no esta seteado, buscar via pedido_asignaciones aceptada.
  let socio: any = (ped as any).socios || null
  if (!socio) {
    const { data: asig } = await admin
      .from('pedido_asignaciones')
      .select(`rider_accounts:rider_accounts!inner(socios:socios!inner(id, nombre, nombre_comercial, slug, logo_url, color_primario, telefono, rating, latitud_actual, longitud_actual, last_location_at))`)
      .eq('pedido_id', ped.id)
      .eq('estado', 'aceptado')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    socio = (asig as any)?.rider_accounts?.socios || null
  }
  const est: any = (ped as any).establecimientos
  const esDelivery = (ped as any).modo_entrega === 'delivery'
  // Solo exponemos lat/lng de entrega si hay token valido (privacidad cliente).
  const entrega = (hasValidToken && esDelivery && (ped as any).lat_entrega != null && (ped as any).lng_entrega != null)
    ? { lat: Number((ped as any).lat_entrega), lng: Number((ped as any).lng_entrega) }
    : null
  return json({
    pedido: { codigo: ped.codigo, estado: ped.estado, total: hasValidToken ? ped.total : null, created_at: ped.created_at, modo_entrega: ped.modo_entrega, minutos_preparacion: ped.minutos_preparacion, recogido_at: ped.recogido_at, entregado_at: ped.entregado_at },
    establecimiento: est ? { nombre: est.nombre, logo_url: est.logo_url, telefono: hasValidToken ? est.telefono : null, latitud: est.latitud, longitud: est.longitud } : null,
    socio: socio ? { id: socio.id, nombre_comercial: socio.nombre_comercial || socio.nombre || 'Repartidor', slug: socio.slug || null, logo_url: socio.logo_url || null, color_primario: socio.color_primario || null } : null,
    rider: socio ? { nombre: socio.nombre || socio.nombre_comercial || 'Repartidor', logo_url: socio.logo_url || null, telefono: hasValidToken ? (socio.telefono || null) : null, rating: socio.rating || null, lat: hasValidToken ? socio.latitud_actual : null, lng: hasValidToken ? socio.longitud_actual : null, last_location_at: hasValidToken ? socio.last_location_at : null } : null,
    entrega,
    items: hasValidToken ? (items || []).map((i: any) => ({ cantidad: i.cantidad, nombre_producto: i.nombre_producto, precio_unitario: i.precio_unitario })) : [],
    _full: hasValidToken,
  })
})
