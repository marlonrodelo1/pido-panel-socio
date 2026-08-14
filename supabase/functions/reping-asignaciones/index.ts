// reping-asignaciones — reenvia el aviso a los socios con una asignacion pendiente de
// aceptar. Varios pases por invocacion para cubrir el minuto entero, ya que pg_cron solo
// admite resolucion 1 min.
//
// Solo asignaciones con estado='esperando_aceptacion' creadas hace mas de 10s y menos de
// 180s (timeout total). Despues de eso reassign-pedido-v2 las pasa al siguiente rider.
//
// v5 (2 jul 2026): limite de 100 filas en la query de asignaciones (antes sin limite).
// v6 (4 jul 2026, auditoria): el segundo pase (+30s) se ejecuta en 2º plano con
// EdgeRuntime.waitUntil. Antes el handler esperaba los 30s dentro de la respuesta: cada
// invocacion tardaba ~31s, el pg_net del cron la cortaba a los 5s y un worker quedaba
// bloqueado medio minuto de cada minuto.
// v7 (14 ago 2026, peticion de Marlon: "que suene repetido"): la cadencia deja de estar a
// fuego. Se lee de configuracion_plataforma.reping_asignacion_seg (20s por defecto, antes
// 30) y se dan todos los pases que quepan en el minuto. En iPhone es lo mas parecido a una
// alarma en bucle que permite APNs: no se puede repetir un sonido desde una app dormida,
// asi que la repeticion la pone el servidor. En Android el bucle real lo hace
// PedidoAlarmService (150s).
// v8 (14 ago 2026): AGRUPAR LOS AVISOS. Con 20s de cadencia se apilaban ~8 notificaciones
// por pedido y el centro de notificaciones quedaba inundado (lo vio Marlon en su iPhone).
// Ahora cada aviso lleva `apns-collapse-id` (iOS) y `notification.tag` (Android) con el id
// del pedido: SUENA las 8 veces igual, pero SUSTITUYE al anterior en pantalla y solo queda
// uno, el mas reciente.
//   Por eso este pase manda el mensaje a FCM directamente en vez de pasar por enviar_push:
//   esa funcion es por donde salen TODOS los avisos de la plataforma (pedidos incluidos) y
//   no se toca para anadir una cabecera. El sonido/canal se replica igual que alli para el
//   socio: canal nativo `pedidos_alarma_v1` en Android y `pedido_rider.caf` en iOS.
//   HONESTO: el PRIMER aviso (el que manda el dispatcher al asignar) sigue saliendo por
//   enviar_push sin etiqueta, asi que quedan DOS notificaciones, no una: la inicial y la
//   que se va actualizando. Bajar a una exigiria tocar el dispatcher.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
// std 0.177 a proposito: en 0.210+ este modulo paso a exportar `encodeBase64Url` y el
// import de `encode` tumba el arranque de la funcion (BOOT_ERROR, sin traza util).
import { encode as base64url } from 'https://deno.land/std@0.177.0/encoding/base64url.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const INTERVALO_DEFECTO_SEG = 20
const MIN_SEG = 10   // por debajo de esto son avisos encima de avisos
const MAX_SEG = 60
const VENTANA_MS = 60_000  // el cron vuelve a llamar dentro de un minuto

type Creds = { project_id: string; client_email: string; private_key: string }

let credsCache: Creds | null = null
let tokenCache: string | null = null

async function getAccessToken(creds: Creds): Promise<string> {
  if (tokenCache) return tokenCache
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
  if (!json.access_token) throw new Error('sin access_token FCM')
  tokenCache = json.access_token
  return json.access_token
}

async function credenciales(sb: any): Promise<Creds | null> {
  if (credsCache) return credsCache
  const { data } = await sb.from('fcm_proyectos')
    .select('project_id, client_email, private_key').eq('user_type', 'socio').maybeSingle()
  if (!data?.private_key) return null
  credsCache = data as Creds
  return credsCache
}

// Mismo sonido y canal que enviar_push usa para el socio; lo unico que se anade es la
// etiqueta de agrupacion.
async function enviarAvisoAgrupado(
  fcmToken: string, creds: Creds, accessToken: string,
  titulo: string, cuerpo: string, collapseId: string, data: Record<string, string>,
) {
  const message = {
    token: fcmToken,
    notification: { title: titulo, body: cuerpo },
    data,
    android: {
      priority: 'high',
      collapse_key: collapseId,
      notification: {
        sound: 'pedido_rider',
        channel_id: 'pedidos_alarma_v1',
        tag: collapseId,
        default_vibrate_timings: false,
        vibrate_timings: ['0s', '0.5s', '0.2s', '0.5s', '0.2s', '0.5s', '0.2s', '0.5s'],
        notification_priority: 'PRIORITY_MAX',
        visibility: 'PUBLIC',
      },
    },
    apns: {
      headers: {
        'apns-priority': '10',
        'apns-push-type': 'alert',
        // La pieza clave: mismo id -> el aviso nuevo SUSTITUYE al anterior en pantalla.
        // Tope de Apple: 64 bytes.
        'apns-collapse-id': collapseId.slice(0, 64),
      },
      payload: {
        aps: {
          alert: { title: titulo, body: cuerpo },
          sound: 'pedido_rider.caf',
          badge: 1,
          'mutable-content': 1,
          'interruption-level': 'time-sensitive',
        },
      },
    },
  }
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${creds.project_id}/messages:send`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
  })
  return res.ok
}

async function leerIntervaloSeg(sb: any): Promise<number> {
  try {
    const { data } = await sb.from('configuracion_plataforma')
      .select('valor').eq('clave', 'reping_asignacion_seg').maybeSingle()
    const n = Number(data?.valor)
    if (!Number.isFinite(n)) return INTERVALO_DEFECTO_SEG
    return Math.min(MAX_SEG, Math.max(MIN_SEG, Math.round(n)))
  } catch (_) {
    return INTERVALO_DEFECTO_SEG
  }
}

// v9 dejo de pasar por enviar_push (para poder anadir la cabecera de agrupacion) y con ello
// se perdio el rastro de los envios, que antes quedaba en push_debug_logs. Sin traza no se
// puede responder a "acepte el pedido y me seguia llegando el aviso". Solo se escribe
// cuando hay asignaciones vivas, asi que no genera ruido.
async function traza(sb: any, event: string, details: string) {
  try {
    await sb.from('push_debug_logs').insert({ platform: 'edge', event, details: details.slice(0, 500) })
  } catch (_) {}
}

async function repingPass(sb: any) {
  const ahora = new Date()
  const desde = new Date(ahora.getTime() - 180_000).toISOString()
  const hasta = new Date(ahora.getTime() - 10_000).toISOString()

  const { data: asigs } = await sb
    .from('pedido_asignaciones')
    .select('id, pedido_id, distancia_metros, rider_account_id, rider_accounts!inner(socio_id, socios!inner(user_id, nombre)), pedidos!inner(codigo, establecimientos!inner(nombre))')
    .eq('estado', 'esperando_aceptacion')
    .gte('created_at', desde)
    .lte('created_at', hasta)
    .limit(100)

  if (!asigs?.length) return 0

  const creds = await credenciales(sb)
  if (!creds) return 0
  const accessToken = await getAccessToken(creds)

  let count = 0
  for (const a of asigs as any[]) {
    const userId = a.rider_accounts?.socios?.user_id
    if (!userId) continue

    // Token mas reciente del socio (single-device, mismo criterio que enviar_push v35).
    const { data: subs } = await sb.from('push_subscriptions')
      .select('fcm_token, created_at')
      .eq('user_id', userId).eq('user_type', 'socio')
      .not('fcm_token', 'is', null).neq('fcm_token', 'DEBUG')
      .order('created_at', { ascending: false }).limit(1)
    const token = subs?.[0]?.fcm_token
    if (!token) continue

    const km = a.distancia_metros != null ? ` · ${(a.distancia_metros / 1000).toFixed(1)} km` : ''
    const titulo = `Pedido pendiente · ${a.pedidos?.establecimientos?.nombre || ''}`
    const cuerpo = `#${a.pedidos?.codigo}${km} — acepta o se reasignará`
    try {
      const ok = await enviarAvisoAgrupado(token, creds, accessToken, titulo, cuerpo, `pedido-${a.pedido_id}`, {
        tipo: 'reping_asignacion',
        pedido_id: String(a.pedido_id),
        asignacion_id: String(a.id),
        urgente: 'true',
      })
      if (ok) count += 1
      await traza(sb, ok ? 'reping:enviado' : 'reping:fallo',
        `${a.pedidos?.codigo} asig=${a.id} socio=${userId}`)
    } catch (_) {}
  }
  return count
}

serve(async () => {
  const sb = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } })
  const intervaloSeg = await leerIntervaloSeg(sb)
  const first = await repingPass(sb)

  // Pases restantes del minuto, en 2º plano (waitUntil) para no bloquear la respuesta ni
  // provocar el timeout de pg_net del cron.
  const retrasos: number[] = []
  for (let t = intervaloSeg * 1000; t < VENTANA_MS; t += intervaloSeg * 1000) retrasos.push(t)
  try {
    for (const ms of retrasos) {
      ;(globalThis as any).EdgeRuntime?.waitUntil?.(
        new Promise((resolve) => setTimeout(() => repingPass(sb).then(resolve).catch(() => resolve(0)), ms))
      )
    }
  } catch (_) {}

  return new Response(JSON.stringify({
    ok: true, first, intervalo_seg: intervaloSeg, pases_programados: retrasos.length,
  }), { headers: { 'Content-Type': 'application/json' } })
})
