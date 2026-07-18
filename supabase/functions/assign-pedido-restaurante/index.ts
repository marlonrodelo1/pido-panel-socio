// assign-pedido-restaurante v4 — el RESTAURANTE (dueño del establecimiento)
// asigna un pedido delivery a UNO de sus socios vinculados (caso multi-socio).
// v4 (18-jul-2026): AUTONOMIA DEL SOCIO — el forzado del restaurante respeta:
//   - socio_establecimiento.reparto_activo (el socio pauso ese restaurante) -> 409 socio_pauso_restaurante
//   - fuentes del socio (acepta_marketplace/acepta_telefonicos/acepta_app segun
//     pedidos.origen_pedido) -> 409 socio_no_acepta_fuente
// Elige el rider mas cercano ONLINE de ese socio. Mismo flujo que el dispatcher:
// pedido_asignaciones (con socio_id) + pedidos.socio_id + push al socio.
// verify_jwt=true: ademas validamos que el caller es dueno del establecimiento.
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }
function haversine(aLat: number, aLng: number, bLat: number, bLng: number) {
  const R = 6371000, toRad = (d: number) => d * Math.PI / 180
  const dLat = toRad(bLat - aLat), dLng = toRad(bLng - aLng)
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2
  return Math.round(2 * R * Math.asin(Math.sqrt(x)))
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  try {
    const url = Deno.env.get('SUPABASE_URL')!
    const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const anon = Deno.env.get('SUPABASE_ANON_KEY')!
    const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim()
    if (!jwt) return Response.json({ error: 'missing_auth' }, { status: 401, headers: CORS })
    const authClient = createClient(url, anon, { global: { headers: { Authorization: `Bearer ${jwt}` } } })
    const { data: { user } } = await authClient.auth.getUser(jwt)
    if (!user) return Response.json({ error: 'invalid_jwt' }, { status: 401, headers: CORS })

    const { pedido_id, socio_id, motivo } = await req.json().catch(() => ({}))
    if (!pedido_id || !socio_id) return Response.json({ error: 'pedido_id y socio_id requeridos' }, { status: 400, headers: CORS })

    const sb = createClient(url, service)

    const { data: pedido } = await sb.from('pedidos')
      .select('id, codigo, estado, modo_entrega, origen_pedido, socio_id, establecimiento_id, intento_asignacion, establecimientos(id, nombre, latitud, longitud, user_id)')
      .eq('id', pedido_id).maybeSingle()
    if (!pedido) return Response.json({ error: 'pedido_no_encontrado' }, { status: 404, headers: CORS })
    if (pedido.modo_entrega !== 'delivery') return Response.json({ error: 'pedido_no_delivery' }, { status: 400, headers: CORS })
    if (pedido.estado === 'entregado' || pedido.estado === 'cancelado') return Response.json({ error: `pedido_${pedido.estado}` }, { status: 400, headers: CORS })
    const est: any = (pedido as any).establecimientos

    // Ownership: dueno del establecimiento o admin/superadmin
    const { data: rolRow } = await sb.from('usuarios').select('rol').eq('id', user.id).maybeSingle()
    const isAdmin = rolRow?.rol === 'admin' || rolRow?.rol === 'superadmin'
    if (est?.user_id !== user.id && !isAdmin) return Response.json({ error: 'forbidden' }, { status: 403, headers: CORS })

    // Marketplace propio: un pedido originado en el marketplace de un socio SOLO puede
    // (re)asignarse a ese mismo socio dueño; no puede moverse al marketplace de otro socio.
    if ((pedido as any).origen_pedido === 'marketplace_socio' && (pedido as any).socio_id && socio_id !== (pedido as any).socio_id) {
      return Response.json({ error: 'marketplace_propio', mensaje: 'Este pedido pertenece al marketplace de otro socio y no puede reasignarse.' }, { status: 403, headers: CORS })
    }

    // El socio debe estar vinculado y activo a este establecimiento.
    // v4: y NO haber pausado el reparto de este restaurante.
    const { data: vinc } = await sb.from('socio_establecimiento')
      .select('id, reparto_activo').eq('establecimiento_id', pedido.establecimiento_id).eq('socio_id', socio_id).eq('estado', 'activa').maybeSingle()
    if (!vinc) return Response.json({ error: 'socio_no_vinculado' }, { status: 403, headers: CORS })
    if (vinc.reparto_activo === false) {
      return Response.json({ error: 'socio_pauso_restaurante', mensaje: 'El repartidor ha pausado los pedidos de este restaurante desde su app.' }, { status: 409, headers: CORS })
    }

    // Riders de ese socio (v4: + flags de fuentes)
    const { data: riders } = await sb.from('rider_accounts')
      .select('id, nombre, socio_id, activa, estado, socios!inner(id, user_id, nombre, en_servicio, latitud_actual, longitud_actual, acepta_marketplace, acepta_telefonicos, acepta_app)')
      .eq('socio_id', socio_id).eq('activa', true).eq('estado', 'activa')

    // v4: el socio decide de que fuentes acepta pedidos. El forzado del restaurante
    // no puede saltarse esa preferencia.
    const origen = (pedido as any).origen_pedido
    const aceptaFuente = (s: any) => {
      if (origen === 'marketplace_socio') return s?.acepta_marketplace !== false
      if (origen === 'telefonico') return s?.acepta_telefonicos !== false
      return s?.acepta_app !== false
    }
    const socioFlags: any = (riders || [])[0]?.socios
    if (socioFlags && !aceptaFuente(socioFlags)) {
      const fuente = origen === 'telefonico' ? 'pedidos telefónicos' : (origen === 'marketplace_socio' ? 'pedidos de su marketplace' : 'pedidos de la app')
      return Response.json({ error: 'socio_no_acepta_fuente', mensaje: `El repartidor ha desactivado los ${fuente} desde su app.` }, { status: 409, headers: CORS })
    }

    // Excluir ya intentados
    const { data: prev } = await sb.from('pedido_asignaciones').select('rider_account_id, intento').eq('pedido_id', pedido_id)
    const tried = new Set((prev || []).map((p: any) => p.rider_account_id))
    const maxPrev = (prev || []).reduce((m: number, p: any) => Math.max(m, p.intento || 0), 0)

    const candidatos = (riders || [])
      .filter((r: any) => r.socios?.en_servicio === true && !tried.has(r.id))
      .map((r: any) => {
        const s = r.socios
        const dist = (est?.latitud && est?.longitud && s?.latitud_actual && s?.longitud_actual)
          ? haversine(est.latitud, est.longitud, s.latitud_actual, s.longitud_actual) : null
        return { rider: r, socio: s, dist }
      })
      .sort((a, b) => (a.dist ?? Infinity) - (b.dist ?? Infinity))

    if (!candidatos.length) return Response.json({ ok: false, reason: 'socio_sin_rider_online' }, { status: 200, headers: CORS })

    const elegido = candidatos[0]
    const intento = Math.max((pedido.intento_asignacion || 0), maxPrev) + 1
    const ts = new Date().toISOString()

    // Cancelar asignaciones abiertas previas
    await sb.from('pedido_asignaciones')
      .update({ estado: 'cancelado_manual', resolved_at: ts })
      .eq('pedido_id', pedido_id).in('estado', ['esperando_aceptacion', 'aceptado']).is('resolved_at', null)

    const { data: asignacion, error: aErr } = await sb.from('pedido_asignaciones').insert({
      pedido_id, rider_account_id: elegido.rider.id, socio_id: elegido.socio.id,
      intento, distancia_metros: elegido.dist, estado: 'esperando_aceptacion',
      asignado_por_admin: user.id, motivo_asignacion_manual: motivo || 'Asignado por el restaurante',
    }).select('id').single()
    if (aErr) return Response.json({ error: 'asignacion_insert_failed', detail: aErr.message }, { status: 500, headers: CORS })

    // UPDATE condicional del pedido: no pisar un pedido ya recogido/en_camino/entregado/cancelado.
    const { data: pedUpd } = await sb.from('pedidos').update({
      shipday_status: 'created',
      shipday_tracking_url: `https://socio.pidoo.es/seguir/${pedido.codigo}`,
      rider_account_id: elegido.rider.id,
      socio_id: elegido.socio.id,
      intento_asignacion: intento,
      assigned_at: ts,
    }).eq('id', pedido_id).not('estado', 'in', '(recogido,en_camino,entregado,cancelado)').select('id')
    if (!pedUpd || pedUpd.length === 0) return Response.json({ error: 'pedido_estado_no_asignable', estado: pedido.estado }, { status: 409, headers: CORS })

    try {
      const prefijoTel = origen === 'telefonico' ? 'Telefónico (solo envío, sin comisión) · ' : ''
      await fetch(`${url}/functions/v1/enviar_push`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${service}` },
        body: JSON.stringify({ user_ids: [elegido.socio.user_id], title: `Nuevo pedido · ${est?.nombre || ''}`, body: `${prefijoTel}#${pedido.codigo}${elegido.dist != null ? ` · ${(elegido.dist / 1000).toFixed(1)} km` : ''} — acepta antes de 3 min`, data: { tipo: 'nueva_asignacion', pedido_id, asignacion_id: asignacion?.id, urgente: true, telefonico: origen === 'telefonico' } }),
      })
    } catch (_) {}

    return Response.json({ ok: true, pedido_id, rider_account_id: elegido.rider.id, socio_id: elegido.socio.id, intento, distancia_metros: elegido.dist }, { status: 200, headers: CORS })
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'error' }, { status: 500, headers: CORS })
  }
})
