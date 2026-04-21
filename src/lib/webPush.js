// Registro de Web Push nativo (sin Firebase) para panel socio
// Guarda la subscription en push_subscriptions con plataforma='web_socio'
import { supabase } from './supabase'

const VAPID_KEY = import.meta.env.VITE_FIREBASE_VAPID_KEY

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const arr = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; ++i) arr[i] = raw.charCodeAt(i)
  return arr
}

function arrayBufferToBase64(buf) {
  const bytes = new Uint8Array(buf)
  let binary = ''
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

/**
 * Registra Web Push para el socio logueado.
 * Devuelve { ok: boolean, reason?: string }
 */
export async function registerSocioPush(userId) {
  if (!userId) return { ok: false, reason: 'no-user' }
  if (!VAPID_KEY) return { ok: false, reason: 'no-vapid' }
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    return { ok: false, reason: 'unsupported' }
  }

  try {
    if (Notification.permission === 'denied') return { ok: false, reason: 'denied' }
    if (Notification.permission !== 'granted') {
      const p = await Notification.requestPermission()
      if (p !== 'granted') return { ok: false, reason: 'permission-' + p }
    }

    const reg = await navigator.serviceWorker.register('/sw.js')
    await navigator.serviceWorker.ready

    let sub = await reg.pushManager.getSubscription()
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_KEY),
      })
    }

    const json = sub.toJSON ? sub.toJSON() : {}
    const endpoint = sub.endpoint
    const p256dh = json.keys?.p256dh || arrayBufferToBase64(sub.getKey ? sub.getKey('p256dh') : new ArrayBuffer(0))
    const auth = json.keys?.auth || arrayBufferToBase64(sub.getKey ? sub.getKey('auth') : new ArrayBuffer(0))

    const row = {
      endpoint,
      web_push_endpoint: endpoint,
      web_push_p256dh: p256dh,
      web_push_auth: auth,
      p256dh,
      auth,
      user_id: userId,
      user_type: 'socio',
      plataforma: 'web_socio',
    }

    const { error } = await supabase.from('push_subscriptions').upsert(row, { onConflict: 'endpoint' })
    if (error) {
      console.warn('[webPush] upsert error', error.message)
      return { ok: false, reason: 'upsert-' + error.message }
    }
    return { ok: true }
  } catch (err) {
    console.warn('[webPush] error', err)
    return { ok: false, reason: 'error-' + (err.message || err) }
  }
}

export async function unregisterSocioPush(userId) {
  if (!userId) return
  try {
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.getRegistration()
      const sub = reg && (await reg.pushManager.getSubscription())
      if (sub) await sub.unsubscribe().catch(() => {})
    }
    await supabase.from('push_subscriptions').delete().eq('user_id', userId).eq('plataforma', 'web_socio')
  } catch (err) {
    console.warn('[webPush] unregister error', err)
  }
}
