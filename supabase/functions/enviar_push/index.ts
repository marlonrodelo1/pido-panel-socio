// enviar_push v29 — multi-proyecto FCM.
//  - cliente: proyecto por defecto (pidoo-push, via env FIREBASE_*).
//  - socio y restaurante: proyecto pidoo-socio, credencial leida de la tabla
//    fcm_proyectos (user_type='socio', RLS solo service role). Ambas apps
//    (com.pidoo.socio y com.pidoo.restaurante) estan en el proyecto pidoo-socio.
//    Si no hay credencial, cae al default.
// Mantiene el payload reforzado (android/apns/webpush) de v25/v27.

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'
import { encode as base64url } from 'https://deno.land/std@0.177.0/encoding/base64url.ts'

const CORS_BASE: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-api-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
function getCorsHeaders(_req: Request) { return { ...CORS_BASE, 'Content-Type': 'application/json' } }
function handleCorsPreflightRequest(_req: Request) { return new Response('ok', { headers: CORS_BASE }) }

type Creds = { project_id: string; client_email: string; private_key: string }

const DEFAULT_CREDS: Creds = {
  project_id: Deno.env.get('FIREBASE_PROJECT_ID') || 'pidoo-push',
  client_email: Deno.env.get('FIREBASE_CLIENT_EMAIL') || 'firebase-adminsdk-fbsvc@pidoo-push.iam.gserviceaccount.com',
  private_key: Deno.env.get('FIREBASE_PRIVATE_KEY') || '',
}

// cache de access_token por client_email (se limpia cada invocacion)
const tokenCache = new Map<string, string>()

async function getAccessToken(creds: Creds): Promise<string> {
  const cached = tokenCache.get(creds.client_email)
  if (cached) return cached
  const now = Math.floor(Date.now() / 1000)
  const header = { alg: 'RS256', typ: 'JWT' }
  const payload = { iss: creds.client_email, sub: creds.client_email, aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600, scope: 'https://www.googleapis.com/auth/firebase.messaging' }
  const headerB64 = base64url(new TextEncoder().encode(JSON.stringify(header)))
  const payloadB64 = base64url(new TextEncoder().encode(JSON.stringify(payload)))
  const unsignedToken = `${headerB64}.${payloadB64}`
  const pemContent = creds.private_key.replace(/-----BEGIN PRIVATE KEY-----/g, '').replace(/-----END PRIVATE KEY-----/g, '').replace(/\\n/g, '').replace(/\n/g, '').replace(/\s/g, '')
  const binaryKey = Uint8Array.from(atob(pemContent), c => c.charCodeAt(0))
  const cryptoKey = await crypto.subtle.importKey('pkcs8', binaryKey, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'])
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey, new TextEncoder().encode(unsignedToken))
  const jwt = `${unsignedToken}.${base64url(new Uint8Array(signature))}`
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}` })
  const tokenData = await tokenRes.json()
  if (!tokenData.access_token) throw new Error('Failed to get FCM access token for ' + creds.project_id)
  tokenCache.set(creds.client_email, tokenData.access_token)
  return tokenData.access_token
}

function stringifyData(data: any): Record<string, string> {
  const out: Record<string, string> = {}
  if (!data || typeof data !== 'object') return out
  for (const k of Object.keys(data)) {
    const v = data[k]
    if (v === null || v === undefined) continue
    if (typeof v === 'string') out[k] = v
    else if (typeof v === 'number' || typeof v === 'boolean') out[k] = String(v)
    else out[k] = JSON.stringify(v)
  }
  return out
}

async function sendFCM(fcmToken: string, title: string, body: string, data: Record<string, string>, creds: Creds): Promise<{ ok: boolean; status: number; error?: string; unregistered?: boolean }> {
  const accessToken = await getAccessToken(creds)
  const message = {
    token: fcmToken,
    notification: { title, body },
    data,
    android: {
      priority: 'high',
      notification: {
        sound: 'default', channel_id: 'pedidos', default_sound: true, default_vibrate_timings: false,
        vibrate_timings: ['0s', '0.5s', '0.2s', '0.5s', '0.2s', '0.5s', '0.2s', '0.5s'],
        notification_priority: 'PRIORITY_MAX', visibility: 'PUBLIC',
      },
    },
    apns: {
      headers: { 'apns-priority': '10', 'apns-push-type': 'alert' },
      payload: { aps: { alert: { title, body }, sound: 'default', badge: 1, 'content-available': 1, 'mutable-content': 1, 'interruption-level': 'time-sensitive' } },
    },
    webpush: {
      notification: { title, body, icon: '/favicon.png', requireInteraction: true, vibrate: [500, 200, 500, 200, 500] },
      headers: { Urgency: 'high' },
    },
  }
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${creds.project_id}/messages:send`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
  })
  if (res.ok) return { ok: true, status: res.status }
  const errBody = await res.text()
  const unregistered = errBody.includes('UNREGISTERED') || errBody.includes('NOT_FOUND') || res.status === 404
  return { ok: false, status: res.status, error: errBody, unregistered }
}

async function dbgLog(supabase: any, event: string, details: any) {
  try { await supabase.from('push_debug_logs').insert({ platform: 'edge', event: 'enviar_push:' + event, details: details ? JSON.stringify(details).slice(0, 1500) : null }) } catch (_) {}
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return handleCorsPreflightRequest(req)
  const CORS = getCorsHeaders(req)
  tokenCache.clear()
  try {
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return new Response(JSON.stringify({ error: 'No autorizado' }), { status: 401, headers: CORS })
    const token = authHeader.replace('Bearer ', '')
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    if (token !== serviceRoleKey) {
      return new Response(JSON.stringify({ error: 'No autorizado' }), { status: 401, headers: CORS })
    }

    // Credencial FCM de pidoo-socio (apps socio y restaurante). Si no existe, usa default.
    let socioCreds: Creds | null = null
    try {
      const { data: row } = await supabase.from('fcm_proyectos').select('project_id, client_email, private_key').eq('user_type', 'socio').maybeSingle()
      if (row && row.private_key) socioCreds = { project_id: row.project_id, client_email: row.client_email, private_key: row.private_key }
    } catch (_) {}

    const reqBody = await req.json()
    const { target_type, target_id, title, body, data, user_ids } = reqBody
    const safeData = stringifyData(data)
    await dbgLog(supabase, 'received', { user_ids, target_type, target_id, title })
    if (target_type === 'cliente' && target_id) {
      try { await supabase.rpc('claim_orphan_push_tokens_for', { p_user_id: target_id, p_user_type: 'cliente' }) } catch (_) {}
    }
    let query = supabase.from('push_subscriptions').select('*').not('fcm_token', 'is', null).neq('fcm_token', 'DEBUG').like('endpoint', 'fcm:%')
    if (Array.isArray(user_ids) && user_ids.length > 0) query = query.in('user_id', user_ids)
    else if (target_type === 'cliente' && target_id) query = query.eq('user_id', target_id).eq('user_type', 'cliente')
    else if (target_type === 'restaurante' && target_id) query = query.eq('establecimiento_id', target_id).eq('user_type', 'restaurante')
    else if (target_type === 'socio' && target_id) query = query.eq('user_id', target_id).eq('user_type', 'socio')
    else if (target_type === 'cliente') query = query.eq('user_type', 'cliente').not('user_id', 'is', null)
    else if (target_type === 'restaurante') query = query.eq('user_type', 'restaurante').not('establecimiento_id', 'is', null)
    else query = query.in('user_type', ['cliente', 'restaurante', 'socio']).or('user_id.not.is.null,establecimiento_id.not.is.null')
    const { data: subs, error: subsErr } = await query
    if (subsErr) return new Response(JSON.stringify({ error: subsErr.message }), { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } })
    if (!subs || subs.length === 0) { await dbgLog(supabase, 'no_subs', { user_ids, target_type, target_id }); return new Response(JSON.stringify({ sent: 0, total: 0 }), { headers: { ...CORS, 'Content-Type': 'application/json' } }) }
    const uniq = new Map<string, any>()
    for (const s of subs) { if (s.fcm_token && !uniq.has(s.fcm_token)) uniq.set(s.fcm_token, s) }
    const uniqueSubs = Array.from(uniq.values())
    const results = await Promise.all(
      uniqueSubs.map(async (sub) => {
        const creds = ((sub.user_type === 'socio' || sub.user_type === 'restaurante') && socioCreds) ? socioCreds : DEFAULT_CREDS
        try {
          const r = await sendFCM(sub.fcm_token, title, body, safeData, creds)
          if (r.ok) await dbgLog(supabase, 'fcm_ok', { token: sub.fcm_token.slice(0, 16), proj: creds.project_id })
          else await dbgLog(supabase, 'fcm_fail', { token: sub.fcm_token.slice(0, 16), proj: creds.project_id, status: r.status, error: (r.error || '').slice(0, 600) })
          return { id: sub.id, ok: r.ok, unregistered: r.unregistered }
        } catch (e) {
          await dbgLog(supabase, 'fcm_exception', { msg: (e as any).message || String(e) })
          return { id: sub.id, ok: false, unregistered: false }
        }
      })
    )
    const sent = results.filter(r => r.ok).length
    const toDelete = results.filter(r => r.unregistered).map(r => r.id)
    if (toDelete.length > 0) await supabase.from('push_subscriptions').delete().in('id', toDelete)
    return new Response(JSON.stringify({ sent, total: uniqueSubs.length, deleted_invalid: toDelete.length }), { headers: { ...CORS, 'Content-Type': 'application/json' } })
  } catch (error) {
    return new Response(JSON.stringify({ error: (error as any).message }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } })
  }
})
