// dispatch-order — dispatcher propio de Pidoo (Shipday eliminado).
//
// Body: { pedido_id }
// 1. Lee pedido + establecimiento (lat/lng).
// 2. Busca socios online del establecimiento, ranquea por score y crea
//    fila en pedido_asignaciones + push DIRECTO al socio elegido.
//
// IMPORTANTE: el push se envia DIRECTO a FCM desde aqui (sin pasar por la
// edge function enviar_push) porque el gateway de Supabase rechaza con 401
// "UNAUTHORIZED_INVALID_JWT_FORMAT" cuando una edge function llama a otra
// con service_role / anon key (formato no-JWT).

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { encode as base64url } from 'https://deno.land/std@0.177.0/encoding/base64url.ts'

const CORS_BASE: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-api-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
function preflight(req: Request) { if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_BASE }); return null }
function jsonResponse(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: { ...CORS_BASE, 'Content-Type': 'application/json' } }) }
function adminClient() { return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } }) }
function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLng/2)**2
  return Math.round(2 * R * Math.asin(Math.sqrt(a)))
}

const CARGA_PESO_METROS = 1500
const VENTANA_GPS_MINUTOS = 3
const FIREBASE_PROJECT_ID = Deno.env.get('FIREBASE_PROJECT_ID') || 'pidoo-push'
const FIREBASE_CLIENT_EMAIL = Deno.env.get('FIREBASE_CLIENT_EMAIL') || 'firebase-adminsdk-fbsvc@pidoo-push.iam.gserviceaccount.com'
const FIREBASE_PRIVATE_KEY = Deno.env.get('FIREBASE_PRIVATE_KEY') || ''
let cachedAccessToken: string | null = null

async function getAccessToken(): Promise<string> {
  if (cachedAccessToken) return cachedAccessToken
  const now = Math.floor(Date.now() / 1000)
  const header = { alg: 'RS256', typ: 'JWT' }
  const payload = { iss: FIREBASE_CLIENT_EMAIL, sub: FIREBASE_CLIENT_EMAIL, aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600, scope: 'https://www.googleapis.com/auth/firebase.messaging' }
  const headerB64 = base64url(new TextEncoder().encode(JSON.stringify(header)))
  const payloadB64 = base64url(new TextEncoder().encode(JSON.stringify(payload)))
  const unsignedToken = `${headerB64}.${payloadB64}`
  const pemContent = FIREBASE_PRIVATE_KEY.replace(/-----BEGIN PRIVATE KEY-----/g, '').replace(/-----END PRIVATE KEY-----/g, '').replace(/\\\\n/g, '').replace(/\\n/g, '').replace(/\s/g, '')
  const binaryKey = Uint8Array.from(atob(pemContent), c => c.charCodeAt(0))
  const cryptoKey = await crypto.subtle.importKey('pkcs8', binaryKey, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'])
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey, new TextEncoder().encode(unsignedToken))
  const jwt = `${unsignedToken}.${base64url(new Uint8Array(signature))}`
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}` })
  const tokenData = await tokenRes.json()
  if (!tokenData.access_token) throw new Error('Failed to get FCM access token: ' + JSON.stringify(tokenData))
  cachedAccessToken = tokenData.access_token
  return cachedAccessToken!
}

async function sendFCMDirect(fcmToken: string, title: string, body: string, data: Record<string, string>) {
  const accessToken = await getAccessToken()
  const message = {
    token: fcmToken,
    notification: { title, body },
    data,
    android: {
      priority: 'high',
      notification: {
        sound: 'default',
        channel_id: 'pedidos',
        default_sound: true,
        vibrate_timings: ['0s', '0.5s', '0.2s', '0.5s', '0.2s', '0.5s'],
        notification_priority: 'PRIORITY_MAX',
        visibility: 'PUBLIC',
      },
    },
    apns: {
      headers: { 'apns-priority': '10', 'apns-push-type': 'alert' },
      payload: { aps: { alert: { title, body }, sound: 'default', badge: 1, 'mutable-content': 1, 'interruption-level': 'time-sensitive' } },
    },
  }
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/messages:send`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
  })
  if (res.ok) return { ok: true, status: res.status }
  const errBody = await res.text()
  return { ok: false, status: res.status, error: errBody.slice(0, 400) }
}

serve(async (req) => {
  const pre = preflight(req)
  if (pre) return pre
  if (req.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405)

  let body: { pedido_id?: string } = {}
  try { body = await req.json() } catch (_) {}
  if (!body.pedido_id) return jsonResponse({ error: 'pedido_id_required' }, 400)

  const sb = adminClient()
  const dbg = async (event: string, details: any) => {
    try {
      await sb.from('push_debug_logs').insert({ platform: 'edge', event: 'dispatch:' + event, details: details ? JSON.stringify(details).slice(0, 1500) : null })
    } catch (_) {}
  }
  await dbg('start', { pedido_id: body.pedido_id })

  const { data: pedido, error: pedErr } = await sb
    .from('pedidos')
    .select('id, codigo, establecimiento_id, lat_entrega, lng_entrega, intento_asignacion, modo_entrega, estado, tracking_token')
    .eq('id', body.pedido_id)
    .maybeSingle()
  if (pedErr || !pedido) { await dbg('pedido_not_found', { err: pedErr?.message }); return jsonResponse({ error: 'pedido_not_found' }, 404) }
  if (pedido.modo_entrega !== 'delivery') return jsonResponse({ error: 'pedido_no_delivery' }, 400)

  const { data: est } = await sb
    .from('establecimientos')
    .select('id, latitud, longitud, nombre')
    .eq('id', pedido.establecimiento_id)
    .maybeSingle()
  if (!est) return jsonResponse({ error: 'establecimiento_not_found' }, 404)

  const { data: vinculos } = await sb
    .from('restaurante_riders')
    .select('rider_account_id, prioridad, rider_accounts!inner(id, socio_id, activa, estado, socios!inner(id, en_servicio, latitud_actual, longitud_actual, last_location_at, user_id, nombre))')
    .eq('establecimiento_id', est.id)
    .eq('rider_accounts.activa', true)
    .eq('rider_accounts.estado', 'activa')

  const ahora = Date.now()
  type Cand = { socio_id: string; rider_account_id: string; nombre: string; user_id: string; prioridad: number; distancia: number }
  const candidatos: Cand[] = []
  for (const v of (vinculos || []) as any[]) {
    const ra = v.rider_accounts
    const s = ra?.socios
    if (!s?.en_servicio) continue
    if (s.latitud_actual == null || s.longitud_actual == null) continue
    if (s.last_location_at) {
      const edad = (ahora - new Date(s.last_location_at).getTime()) / 60000
      if (edad > VENTANA_GPS_MINUTOS) continue
    }
    candidatos.push({ socio_id: s.id, rider_account_id: ra.id, nombre: s.nombre, user_id: s.user_id, prioridad: v.prioridad ?? 100, distancia: haversineMeters(est.latitud, est.longitud, s.latitud_actual, s.longitud_actual) })
  }

  await dbg('candidatos', { count: candidatos.length, names: candidatos.map(c => c.nombre) })

  if (candidatos.length === 0) {
    await sb.from('pedidos').update({ shipday_status: 'no_rider' }).eq('id', pedido.id)
    return jsonResponse({ error: 'no_riders_online', candidatos: 0 }, 200)
  }

  const riderIds = candidatos.map((c) => c.rider_account_id)
  const { data: activos } = await sb
    .from('pedido_asignaciones')
    .select('rider_account_id, estado')
    .in('rider_account_id', riderIds)
    .in('estado', ['esperando_aceptacion', 'aceptado'])
  const activosByRider: Record<string, number> = {}
  ;(activos || []).forEach((a: any) => { activosByRider[a.rider_account_id] = (activosByRider[a.rider_account_id] || 0) + 1 })

  const { data: intentadosRows } = await sb.from('pedido_asignaciones').select('rider_account_id').eq('pedido_id', pedido.id)
  const yaIntentados = new Set((intentadosRows || []).map((r: any) => r.rider_account_id))
  const restantes = candidatos.filter((c) => !yaIntentados.has(c.rider_account_id))
  if (restantes.length === 0) { await sb.from('pedidos').update({ shipday_status: 'no_rider' }).eq('id', pedido.id); return jsonResponse({ error: 'all_riders_attempted' }, 200) }

  restantes.sort((a, b) => {
    const sa = (activosByRider[a.rider_account_id] || 0) * CARGA_PESO_METROS + a.distancia
    const sb_ = (activosByRider[b.rider_account_id] || 0) * CARGA_PESO_METROS + b.distancia
    if (sa !== sb_) return sa - sb_
    return b.prioridad - a.prioridad
  })

  const elegido = restantes[0]
  const intento = (pedido.intento_asignacion || 0) + 1
  const { data: asignacion, error: asignErr } = await sb
    .from('pedido_asignaciones')
    .insert({ pedido_id: pedido.id, rider_account_id: elegido.rider_account_id, intento, distancia_metros: elegido.distancia, estado: 'esperando_aceptacion' })
    .select().single()
  if (asignErr) { await dbg('insert_failed', { err: asignErr.message }); return jsonResponse({ error: 'insert_failed', detail: asignErr.message }, 500) }

  // La columna `shipday_tracking_url` (legacy) ahora se rellena con la URL
  // del tracking propio en socio.pidoo.es, incluyendo el tracking_token (UUID
  // secreto) como query string para evitar que un atacante con solo el codigo
  // (PD-XXXXX, bruteforce-able) pueda ver datos del pedido.
  const trackingUrl = pedido.tracking_token
    ? `https://socio.pidoo.es/seguir/${pedido.codigo}?t=${pedido.tracking_token}`
    : `https://socio.pidoo.es/seguir/${pedido.codigo}` // fallback legacy (rompera 404)
  await sb.from('pedidos').update({
    rider_account_id: elegido.rider_account_id,
    intento_asignacion: intento,
    assigned_at: new Date().toISOString(),
    shipday_status: 'created',
    shipday_tracking_url: trackingUrl,
  }).eq('id', pedido.id)
  await dbg('elegido', { user_id: elegido.user_id, asignacion_id: asignacion.id, codigo: pedido.codigo })

  // Push DIRECTO via FCM (sin pasar por enviar_push, que falla por JWT entre edge fn)
  const { data: subs } = await sb
    .from('push_subscriptions')
    .select('id, fcm_token')
    .eq('user_id', elegido.user_id)
    .eq('user_type', 'socio')
    .not('fcm_token', 'is', null)
    .neq('fcm_token', 'DEBUG')

  await dbg('subs_found', { count: (subs || []).length })
  if (!subs || subs.length === 0) {
    return jsonResponse({ ok: true, asignacion_id: asignacion.id, push_ok: false, reason: 'no_push_subs' })
  }

  const title = `Nuevo pedido · ${est.nombre}`
  const pushBody = `#${pedido.codigo} · ${(elegido.distancia / 1000).toFixed(1)} km`
  const dataPayload: Record<string, string> = { tipo: 'nueva_asignacion', pedido_id: pedido.id, asignacion_id: asignacion.id }

  const seen = new Set<string>()
  let sent = 0, failed = 0
  const toDelete: string[] = []
  for (const sub of subs) {
    if (seen.has(sub.fcm_token)) continue
    seen.add(sub.fcm_token)
    const r = await sendFCMDirect(sub.fcm_token, title, pushBody, dataPayload)
    if (r.ok) { sent++; await dbg('fcm_ok', { token: sub.fcm_token.slice(0,16) }) }
    else {
      failed++; await dbg('fcm_fail', { token: sub.fcm_token.slice(0,16), status: r.status, error: r.error })
      if (r.status === 404 || (r.error || '').includes('UNREGISTERED') || (r.error || '').includes('NOT_FOUND')) toDelete.push(sub.id)
    }
  }
  if (toDelete.length > 0) await sb.from('push_subscriptions').delete().in('id', toDelete)

  return jsonResponse({ ok: true, asignacion_id: asignacion.id, push_sent: sent, push_failed: failed })
})
