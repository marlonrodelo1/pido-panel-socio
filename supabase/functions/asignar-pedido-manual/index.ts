// asignar-pedido-manual v3 — escape hatch del super-admin SIN Shipday.
// Asigna un pedido a un rider concreto via dispatcher propio Pidoo.
// v3: setea socio_id en la asignacion Y en el pedido (IMPRESCINDIBLE: el realtime del
//   app socio filtra por socio_id y rider-accept-order valida asig.socio_id === auth.socioId;
//   sin esto la asignacion manual quedaba huerfana y el socio nunca la recibia ni podia aceptar).

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { status: 200, headers: CORS })

  try {
    const authHeader = req.headers.get('Authorization') || ''
    const jwt = authHeader.replace(/^Bearer\s+/i, '').trim()
    if (!jwt) return Response.json({ error: 'Missing Authorization' }, { status: 401, headers: CORS })

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!

    const supabaseAuth = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: `Bearer ${jwt}` } } })
    const { data: userData, error: userErr } = await supabaseAuth.auth.getUser(jwt)
    if (userErr || !userData?.user) return Response.json({ error: 'Invalid JWT' }, { status: 401, headers: CORS })
    const callerUid = userData.user.id

    const supabase = createClient(supabaseUrl, serviceKey)
    const { data: rolRow } = await supabase.from('usuarios').select('rol').eq('id', callerUid).maybeSingle()
    if (rolRow?.rol !== 'admin' && rolRow?.rol !== 'superadmin') {
      return Response.json({ error: 'Forbidden: requiere rol admin o superadmin' }, { status: 403, headers: CORS })
    }

    const body = await req.json().catch(() => ({}))
    const { pedido_id, rider_account_id, motivo } = body || {}
    if (!pedido_id || !rider_account_id) {
      return Response.json({ error: 'pedido_id y rider_account_id son requeridos' }, { status: 400, headers: CORS })
    }

    const { data: pedido } = await supabase.from('pedidos')
      .select('id, codigo, establecimiento_id, intento_asignacion, estado, modo_entrega, establecimientos(latitud, longitud, nombre)')
      .eq('id', pedido_id).single()
    if (!pedido) return Response.json({ error: 'Pedido no encontrado' }, { status: 404, headers: CORS })
    if (pedido.estado === 'entregado' || pedido.estado === 'cancelado') {
      return Response.json({ error: `No se puede reasignar un pedido en estado ${pedido.estado}` }, { status: 400, headers: CORS })
    }

    const { data: nuevoRider } = await supabase.from('rider_accounts')
      .select('id, nombre, socio_id, activa, estado, socios!inner(id, user_id, latitud_actual, longitud_actual, nombre)')
      .eq('id', rider_account_id).single()
    if (!nuevoRider) return Response.json({ error: 'Rider no encontrado' }, { status: 404, headers: CORS })
    if (!nuevoRider.activa || nuevoRider.estado !== 'activa') return Response.json({ error: 'El rider no esta activo' }, { status: 400, headers: CORS })

    // socio_id del rider (= socios.id). Imprescindible para el realtime del socio y rider-accept-order.
    const socioId = (nuevoRider as any).socio_id || ((nuevoRider as any).socios?.id ?? null)

    // Cancelar asignaciones previas abiertas
    await supabase.from('pedido_asignaciones')
      .update({ estado: 'cancelado_manual', resolved_at: new Date().toISOString() })
      .eq('pedido_id', pedido_id)
      .in('estado', ['esperando_aceptacion', 'aceptado'])
      .is('resolved_at', null)

    const { data: prevAsign } = await supabase.from('pedido_asignaciones').select('intento').eq('pedido_id', pedido_id)
    const prevIntentoMax = (prevAsign || []).reduce((m: number, a: any) => Math.max(m, a.intento || 0), 0)
    const nuevoIntento = Math.max((pedido.intento_asignacion || 0) + 1, prevIntentoMax + 1)

    // Distancia rider -> restaurante (haversine)
    const est = pedido.establecimientos as any
    const s = (nuevoRider as any).socios
    let distancia: number | null = null
    if (est?.latitud && est?.longitud && s?.latitud_actual && s?.longitud_actual) {
      const R = 6371000
      const toRad = (d: number) => d * Math.PI / 180
      const dLat = toRad(s.latitud_actual - est.latitud)
      const dLng = toRad(s.longitud_actual - est.longitud)
      const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(est.latitud)) * Math.cos(toRad(s.latitud_actual)) * Math.sin(dLng / 2) ** 2
      distancia = Math.round(2 * R * Math.asin(Math.sqrt(a)))
    }

    const ts = new Date().toISOString()
    const { data: asignacion } = await supabase.from('pedido_asignaciones').insert({
      pedido_id,
      rider_account_id: nuevoRider.id,
      socio_id: socioId,
      intento: nuevoIntento,
      distancia_metros: distancia,
      estado: 'esperando_aceptacion',
      asignado_por_admin: callerUid,
      motivo_asignacion_manual: motivo || null,
    }).select().single()

    await supabase.from('pedidos').update({
      shipday_tracking_url: `https://socio.pidoo.es/seguir/${pedido.codigo}`,
      shipday_status: 'created',
      rider_account_id: nuevoRider.id,
      socio_id: socioId,
      intento_asignacion: nuevoIntento,
      assigned_at: ts
    }).eq('id', pedido_id)

    // Push al rider
    try {
      await fetch(`${supabaseUrl}/functions/v1/enviar_push`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceKey}` },
        body: JSON.stringify({ user_ids: [s?.user_id], title: `Nuevo pedido (manual) · ${est?.nombre || ''}`, body: `#${pedido.codigo}`, data: { tipo: 'asignacion_manual', pedido_id, asignacion_id: asignacion?.id } }),
      })
    } catch (_) {}

    return Response.json({ success: true, intento: nuevoIntento, distancia_metros: distancia, rider: { id: nuevoRider.id, nombre: nuevoRider.nombre } }, { status: 200, headers: CORS })
  } catch (error: unknown) {
    return Response.json({ error: error instanceof Error ? error.message : 'Internal server error' }, { status: 500, headers: CORS })
  }
})
