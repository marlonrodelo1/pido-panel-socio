// presencia-ping-silencioso — despierta la app del socio que lleva rato sin dar señal.
//
// POR QUE EXISTE (14 ago 2026)
// En iOS el latido lo manda el JavaScript de la app. Cuando el sistema mata la app por
// memoria, no queda nadie mandandolo: el socio deja de recibir pedidos a los 12 min y a
// los 60 el cron lo pone Fuera de linea. Caso real de Marlon: En linea a las 14:12, ultima
// señal a la 01:09 con el movil quieto, y silencio hasta que abrio la app por la mañana.
//
// Un aviso SILENCIOSO (content-available) despierta la app aunque iOS la haya matado, y NO
// si el usuario la cerro a mano — que es exactamente la regla que pidio Marlon. Al
// despertar, el codigo nativo (AppDelegate.swift) pide UNA posicion y late contra
// rider-heartbeat con la llave de presencia.
//
// NO se toca enviar_push a proposito: por ahi pasan TODOS los avisos de la plataforma
// (incluidos los pedidos) y un fallo alli seria peor que el problema que se arregla.
//
// LIMITE HONESTO: Apple raciona los avisos silenciosos, no hay garantia de entrega
// inmediata. Convierte "muerto hasta que la abra por la mañana" en "revive cada pocos
// minutos". No es un latido de 60 s.
//
// NOTA: hoy no se guarda la plataforma de cada socio, asi que el ping va tambien a los
// Android. Alli es inofensivo (el mensaje no lleva loop_sound, asi que PidooMessagingService
// lo ignora) y ademas casi nunca aplica, porque su latido nativo mantiene la señal fresca.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
// std 0.177 a proposito: en 0.210+ este modulo pasó a exportar `encodeBase64Url` y el
// import de `encode` tumba el arranque de la funcion (BOOT_ERROR, sin traza util).
// enviar_push usa esta misma version desde hace meses.
import { encode as base64url } from 'https://deno.land/std@0.177.0/encoding/base64url.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

// Minutos de silencio a partir de los cuales se intenta despertar. Por debajo de la
// ventana de frescura del dispatcher (12 min) para llegar ANTES de que deje de recibir
// pedidos, no despues.
const SILENCIO_MIN = 4
// No repetir el ping antes de esto (por socio).
const REPETIR_CADA_MIN = 3
const MAX_POR_PASADA = 30

type Creds = { project_id: string; client_email: string; private_key: string }

async function getAccessToken(creds: Creds): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const header = { alg: 'RS256', typ: 'JWT' }
  const payload = {
    iss: creds.client_email, sub: creds.client_email,
    aud: 'https://oauth2.googleapis.com/token',
    iat: now, exp: now + 3600,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
  }
  const unsigned = `${base64url(new TextEncoder().encode(JSON.stringify(header)))}.${base64url(new TextEncoder().encode(JSON.stringify(payload)))}`
  const pem = creds.private_key
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\\n/g, '').replace(/\n/g, '').replace(/\s/g, '')
  const bin = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0))
  const key = await crypto.subtle.importKey('pkcs8', bin, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned))
  const jwt = `${unsigned}.${base64url(new Uint8Array(sig))}`
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  })
  const json = await res.json()
  if (!json.access_token) throw new Error('sin access_token FCM para ' + creds.project_id)
  return json.access_token
}

// Mensaje SIN bloque `notification`: si lo llevara, iOS lo pintaria en pantalla y ademas
// dejaria de ser un aviso de fondo. apns-push-type=background + priority 5 es lo que exige
// Apple para los silenciosos; mandarlo con priority 10 hace que APNs los descarte.
async function enviarPingSilencioso(fcmToken: string, creds: Creds, accessToken: string) {
  const message = {
    token: fcmToken,
    data: { tipo: 'presence_ping' },
    android: { priority: 'normal' },
    apns: {
      headers: { 'apns-priority': '5', 'apns-push-type': 'background' },
      payload: { aps: { 'content-available': 1 } },
    },
  }
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${creds.project_id}/messages:send`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
  })
  return { ok: res.ok, status: res.status, body: res.ok ? '' : (await res.text()).slice(0, 300) }
}

serve(async () => {
  const sb = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } })
  try {
    const { data: socios, error } = await sb.rpc('socios_para_ping_presencia', {
      p_silencio_min: SILENCIO_MIN,
      p_repetir_min: REPETIR_CADA_MIN,
      p_max: MAX_POR_PASADA,
    })
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 })
    if (!socios?.length) return new Response(JSON.stringify({ ok: true, pingados: 0 }), { headers: { 'Content-Type': 'application/json' } })

    const { data: fila } = await sb.from('fcm_proyectos')
      .select('project_id, client_email, private_key').eq('user_type', 'socio').maybeSingle()
    if (!fila?.private_key) {
      return new Response(JSON.stringify({ error: 'sin credencial FCM de socio' }), { status: 500 })
    }
    const creds: Creds = fila as Creds
    const accessToken = await getAccessToken(creds)

    let pingados = 0
    const fallos: string[] = []
    for (const s of socios as any[]) {
      // Token mas reciente del socio (single-device, igual criterio que enviar_push v35).
      const { data: subs } = await sb.from('push_subscriptions')
        .select('fcm_token, created_at')
        .eq('user_id', s.user_id).eq('user_type', 'socio')
        .not('fcm_token', 'is', null).neq('fcm_token', 'DEBUG')
        .order('created_at', { ascending: false }).limit(1)
      const token = subs?.[0]?.fcm_token
      if (!token) continue
      try {
        const r = await enviarPingSilencioso(token, creds, accessToken)
        if (r.ok) {
          pingados += 1
          await sb.from('socios').update({ last_presence_ping_at: new Date().toISOString() }).eq('id', s.id)
        } else {
          fallos.push(`${s.id}:${r.status}`)
        }
      } catch (e) {
        fallos.push(`${s.id}:exc`)
      }
    }
    return new Response(JSON.stringify({ ok: true, pingados, candidatos: socios.length, fallos }), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as any).message }), { status: 500 })
  }
})
