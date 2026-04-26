// Push notifications nativas para panel-socio (Android FCM + iOS APNs via Firebase).
// Adaptado de pido-app/src/lib/pushNotifications.js. Usa la misma tabla
// push_subscriptions con user_type='socio'.

import { Capacitor } from '@capacitor/core'
import { supabase } from './supabase'

async function debugLog(event, details) {
  try {
    await supabase.from('push_debug_logs').insert({
      platform: Capacitor.getPlatform(),
      event: 'socio:' + event,
      details: details ? JSON.stringify(details).slice(0, 2000) : null,
    })
  } catch (_) {}
}

export async function registerSocioNativePush(userId, onNotification) {
  if (!Capacitor.isNativePlatform()) return null
  if (!userId) return null

  await debugLog('register_start', { user_id: userId })

  try {
    const { PushNotifications } = await import('@capacitor/push-notifications')

    // Crea el canal 'pedidos' con prioridad alta + sonido + vibracion
    try {
      await PushNotifications.createChannel({
        id: 'pedidos',
        name: 'Pedidos nuevos',
        description: 'Avisos de pedidos para repartir',
        importance: 5, // IMPORTANCE_HIGH (heads-up + sound)
        sound: 'default',
        vibration: true,
        lights: true,
        visibility: 1, // Public
      })
    } catch (_) {}

    async function linkOrphanFcmToUser() {
      const { data, error } = await supabase.rpc('claim_orphan_push_tokens', { p_user_type: 'socio' })
      if (error) await debugLog('claim_rpc_error', { message: error.message })
      else await debugLog('claim_rpc_ok', { claimed: data })
    }

    async function upsertAndroidToken(fcmToken) {
      try {
        await supabase.from('push_subscriptions').upsert({
          endpoint: `fcm:${fcmToken}`,
          p256dh: '',
          auth: '',
          fcm_token: fcmToken,
          user_type: 'socio',
          user_id: userId,
        }, { onConflict: 'endpoint' })
        await debugLog('token_saved', { source: 'android_fcm' })
      } catch (err) {
        await debugLog('token_save_error', { message: err?.message || String(err) })
      }
    }

    PushNotifications.addListener('registration', async (t) => {
      await debugLog('plugin_registration', { value_preview: (t.value || '').slice(0, 24) + '...' })
      if (Capacitor.getPlatform() === 'ios') {
        setTimeout(() => { linkOrphanFcmToUser() }, 1500)
        setTimeout(() => { linkOrphanFcmToUser() }, 5000)
      } else {
        await upsertAndroidToken(t.value)
      }
    })

    PushNotifications.addListener('registrationError', async (err) => {
      await debugLog('plugin_registration_error', { error: err?.error || String(err) })
    })

    PushNotifications.addListener('pushNotificationReceived', async (notification) => {
      // 1) Sonido inmediato via Web Audio API (no depende de canales Android)
      try {
        const Ctx = (typeof window !== 'undefined') && (window.AudioContext || window.webkitAudioContext)
        if (Ctx) {
          const ctx = new Ctx()
          for (let i = 0; i < 3; i++) {
            setTimeout(() => {
              try {
                const osc = ctx.createOscillator(); const gain = ctx.createGain()
                osc.type = 'sine'; osc.frequency.value = 880
                gain.gain.setValueAtTime(0, ctx.currentTime)
                gain.gain.linearRampToValueAtTime(0.5, ctx.currentTime + 0.02)
                gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.4)
                osc.connect(gain).connect(ctx.destination)
                osc.start(); osc.stop(ctx.currentTime + 0.5)
              } catch (_) {}
            }, i * 600)
          }
        }
      } catch (_) {}

      // 2) Vibracion
      try { if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate([400, 200, 400, 200, 400, 200, 400]) } catch (_) {}

      // 3) LocalNotification visual (sin channelId, deja que use default)
      try {
        const { LocalNotifications } = await import('@capacitor/local-notifications')
        try { await LocalNotifications.requestPermissions() } catch (_) {}
        await LocalNotifications.schedule({
          notifications: [{
            id: Math.floor(Math.random() * 100000),
            title: notification.title || 'Pidoo',
            body: notification.body || '',
            sound: null, // ya sonamos con WebAudio arriba
            ongoing: false,
            autoCancel: true,
            extra: notification.data || {},
          }],
        })
      } catch (e) { console.warn('[push] local notif fail', e?.message) }

      if (onNotification) onNotification(notification, false)
    })

    PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
      if (onNotification) onNotification(action.notification, true)
    })

    const perm = await PushNotifications.requestPermissions().catch(() => ({ receive: 'denied' }))
    await debugLog('permission', { receive: perm?.receive })
    if (perm.receive !== 'granted') return null

    try {
      await PushNotifications.register()
    } catch (err) {
      await debugLog('register_error', { message: err?.message || String(err) })
      return null
    }

    if (Capacitor.getPlatform() === 'ios') {
      setTimeout(() => { linkOrphanFcmToUser() }, 3000)
      setTimeout(() => { linkOrphanFcmToUser() }, 8000)
    }
  } catch (err) {
    await debugLog('plugin_init_error', { message: err?.message || String(err) })
  }
}

export async function unregisterSocioNativePush() {
  if (!Capacitor.isNativePlatform()) return
  try {
    const { PushNotifications } = await import('@capacitor/push-notifications')
    await PushNotifications.removeAllListeners()
  } catch (_) {}
}
