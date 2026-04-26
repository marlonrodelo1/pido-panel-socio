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
      // Siempre mostrar LocalNotification visible (aunque la app este en foreground,
      // Android no la pinta automaticamente. Lo forzamos).
      try {
        const { LocalNotifications } = await import('@capacitor/local-notifications')
        await LocalNotifications.schedule({
          notifications: [{
            id: Math.floor(Math.random() * 100000),
            title: notification.title || 'Pidoo',
            body: notification.body || '',
            sound: null,
            extra: notification.data || {},
            smallIcon: 'ic_stat_icon_config_sample',
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
