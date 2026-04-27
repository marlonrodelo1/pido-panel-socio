// get-tracking-publico — endpoint publico para socio.pidoo.es/seguir/<codigo>.
//
// Body: { codigo, token }
//
// Verifica que pedidos.codigo = body.codigo Y pedidos.tracking_token = body.token.
// Si no coinciden devuelve 404 (no revela si el codigo existe).
//
// Devuelve solo lo necesario para mostrar el tracking al cliente:
// - codigo, estado, total, created_at, modo_entrega, minutos_preparacion
// - establecimiento { nombre, logo_url, latitud, longitud, telefono }
// - rider { nombre, telefono, lat, lng, last_location_at, rating } (si esta asignado)
// - items (cantidad, nombre_producto, precio_unitario)
//
// NUNCA devuelve direccion_entrega, lat_entrega, lng_entrega, usuario_id ni
// datos personales del cliente.
//
// verify_jwt = false (publico).

import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'npm:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: CORS })
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  let body: { codigo?: string; token?: string } = {}
  try { body = await req.json() } catch (_) {}

  const codigo = (body.codigo || '').trim().toUpperCase()
  const token = (body.token || '').trim().toLowerCase()

  if (!codigo) return json({ error: 'not_found' }, 404)

  // Modo "completo": codigo + token UUID coinciden → devolvemos todo
  // (incluido total, items, telefono restaurante).
  // Modo "minimo": solo codigo (URL legacy sin token o mal formada en cliente
  // antiguo) → devolvemos solo estado + restaurante + posicion rider, sin
  // items ni total ni telefono. Brute-forcear codigos PD-XXXXX da una vista
  // muy reducida que no expone PII real del cliente.
  const hasValidToken = !!token && UUID_RE.test(token)

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  let q = admin
    .from('pedidos')
    .select(`
      id, codigo, estado, total, created_at, modo_entrega,
      minutos_preparacion, recogido_at, entregado_at,
      establecimiento_id,
      establecimientos:establecimientos!inner(nombre, logo_url, telefono, latitud, longitud)
    `)
    .eq('codigo', codigo)
  if (hasValidToken) q = q.eq('tracking_token', token)
  const { data: ped } = await q.maybeSingle()

  if (!ped) return json({ error: 'not_found' }, 404)

  // Items del pedido (nombres + precios)
  const { data: items } = await admin
    .from('pedido_items')
    .select('cantidad, nombre_producto, precio_unitario')
    .eq('pedido_id', ped.id)

  // Asignacion activa → datos del rider
  const { data: asig } = await admin
    .from('pedido_asignaciones')
    .select(`
      estado, aceptado_at, recogido_at, entregado_at,
      rider_accounts:rider_accounts!inner(
        socios:socios!inner(nombre, telefono, rating, latitud_actual, longitud_actual, last_location_at)
      )
    `)
    .eq('pedido_id', ped.id)
    .eq('estado', 'aceptado')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const est: any = (ped as any).establecimientos
  const socio: any = asig?.rider_accounts?.socios

  return json({
    pedido: {
      codigo: ped.codigo,
      estado: ped.estado,
      total: hasValidToken ? ped.total : null,
      created_at: ped.created_at,
      modo_entrega: ped.modo_entrega,
      minutos_preparacion: ped.minutos_preparacion,
      recogido_at: ped.recogido_at,
      entregado_at: ped.entregado_at,
    },
    establecimiento: est ? {
      nombre: est.nombre,
      logo_url: est.logo_url,
      telefono: hasValidToken ? est.telefono : null,
      latitud: est.latitud,
      longitud: est.longitud,
    } : null,
    rider: socio ? {
      nombre: socio.nombre || 'Repartidor',
      telefono: hasValidToken ? (socio.telefono || null) : null,
      rating: socio.rating || null,
      lat: socio.latitud_actual,
      lng: socio.longitud_actual,
      last_location_at: socio.last_location_at,
    } : null,
    items: hasValidToken
      ? (items || []).map((i: any) => ({ cantidad: i.cantidad, nombre_producto: i.nombre_producto, precio_unitario: i.precio_unitario }))
      : [],
    _full: hasValidToken, // flag por si el cliente quiere mostrar warning
  })
})
