// pushNative.js — Registro FCM + LocalNotifications nativas + canal de pedidos.
//
// Estrategia:
//   - Al loguear el socio, registrar token FCM y guardarlo en push_subscriptions
//     con user_type='socio'.
//   - Listener al recibir push con la app abierta: disparar evento custom
//     'pidoo-push-received' para que el ModalPedidoEntrante reaccione.
//   - Listener al pulsar push (app cerrada): evento 'pidoo-push-tapped' para
//     navegar a la pantalla del pedido.
//   - Crear channel "pedidos" con IMPORTANCE_HIGH para que suene y vibre aunque
//     el rider esté en otra app.
//
// Web: webPush.js (existente) maneja VAPID. Este módulo solo cubre nativo.

import { getPlugin, isNativePlatform, getPlatform } from './capacitor'
import { supabase } from './supabase'

let registered = false

/**
 * Registra el token FCM en push_subscriptions. Idempotente por user_id+token.
 */
export async function registerSocioPushNative(userId) {
  if (registered) return { ok: true, already: true }
  if (!(await isNativePlatform())) return { ok: false, reason: 'web' }
  const Push = (await getPlugin('PushNotifications'))?.plugin
  if (!Push) return { ok: false, reason: 'no_plugin' }

  // Limpiar listeners previos ANTES de registrar. Sin esto, tras un ciclo
  // logout→login (mismo dispositivo, otro usuario) quedaban vivos los listeners del
  // usuario anterior con su userId capturado en el closure; al rotar FCM el token,
  // ambos listeners insertaban la fila → el token del dispositivo quedaba asociado
  // al usuario equivocado y sus pedidos sonaban en el teléfono de otro.
  try { await Push.removeAllListeners() } catch (_) {}

  try {
    const perm = await Push.checkPermissions()
    let granted = perm.receive === 'granted'
    if (!granted) {
      const req = await Push.requestPermissions()
      granted = req.receive === 'granted'
    }
    if (!granted) return { ok: false, reason: 'denied' }
  } catch (e) {
    return { ok: false, reason: 'perm_error', error: e?.message }
  }

  // Crear canal Android "pedidos" con prioridad MAX (vibra + sonido sistema)
  try {
    await Push.createChannel?.({
      id: 'pedidos',
      name: 'Pedidos entrantes',
      description: 'Notificaciones de nuevos pedidos asignados',
      importance: 5, // MAX
      visibility: 1, // PUBLIC
      vibration: true,
      lights: true,
      sound: 'default',
    })
  } catch (_) { /* iOS no soporta channels, ignorar */ }

  return await new Promise((resolve) => {
    let resolved = false
    const finish = (val) => { if (!resolved) { resolved = true; resolve(val) } }

    Push.addListener('registration', async (token) => {
      registered = true
      const platform = await getPlatform()

      // iOS: el evento 'registration' del plugin devuelve el token APNs (hex),
      // NO un token FCM. El token FCM real lo obtiene el AppDelegate nativo
      // (FirebaseMessaging) y lo guarda como huérfano (user_id=null,
      // user_type='socio'). Aquí solo lo enlazamos al usuario con la RPC
      // SECURITY DEFINER, igual que hace la app cliente. Guardar token.value
      // como fcm_token en iOS mete basura APNs que FCM no puede entregar.
      if (platform === 'ios') {
        // El AppDelegate (FirebaseMessaging) guarda el token FCM como huérfano
        // (user_id=null) cuando iOS lo entrega, lo que puede tardar unos segundos.
        // Reintentamos el claim en escalera hasta que enganche (devuelve nº de tokens
        // enlazados > 0) o se agoten los intentos. Antes solo probaba a 1.5s y 5s: a
        // veces el token aún no existía -> quedaba huérfano y el push no llegaba.
        let claimed = false
        const claim = async () => {
          if (claimed) return
          try {
            const { data, error } = await supabase.rpc('claim_orphan_push_tokens', { p_user_type: 'socio' })
            if (error) { console.warn('[pushNative] claim_orphan failed:', error.message); return }
            if ((data || 0) > 0) { claimed = true; console.log('[pushNative] claimed orphan tokens:', data) }
          } catch (e) { console.warn('[pushNative] claim exception:', e?.message) }
        }
        for (const ms of [1500, 4000, 8000, 15000, 25000]) setTimeout(claim, ms)
        finish({ ok: true, ios: true })
        return
      }

      // Android: token.value ES el token FCM directamente.
      const fcmToken = token?.value || token
      console.log('[pushNative] FCM token:', fcmToken?.slice(0, 20) + '…')
      try {
        // enviar_push v28 enruta al socio por user_id y exige endpoint LIKE 'fcm:%'.
        // La tabla no tiene unique constraint (solo PK id) → no se puede usar
        // onConflict. Hacemos delete del token previo + insert idempotente.
        const endpoint = 'fcm:' + fcmToken
        const row = {
          user_id: userId,
          user_type: 'socio',
          endpoint,
          fcm_token: fcmToken,
          p256dh: '',
          auth: '',
        }
        await supabase
          .from('push_subscriptions')
          .delete()
          .eq('user_type', 'socio')
          .eq('fcm_token', fcmToken)
        const { error } = await supabase.from('push_subscriptions').insert(row)
        if (error) console.warn('[pushNative] insert push_subscriptions failed:', error.message)
      } catch (e) {
        console.warn('[pushNative] upsert push_subscriptions failed:', e?.message)
      }
      finish({ ok: true, token: fcmToken })
    })

    Push.addListener('registrationError', (err) => {
      console.warn('[pushNative] registrationError:', err)
      finish({ ok: false, reason: 'registration_error', error: err?.error })
    })

    Push.addListener('pushNotificationReceived', (notification) => {
      console.log('[pushNative] push received (foreground):', notification)
      try {
        window.dispatchEvent(new CustomEvent('pidoo-push-received', { detail: notification }))
      } catch (_) {}
    })

    Push.addListener('pushNotificationActionPerformed', (action) => {
      console.log('[pushNative] push tapped:', action)
      try {
        window.dispatchEvent(new CustomEvent('pidoo-push-tapped', { detail: action }))
      } catch (_) {}
    })

    Push.register().catch((e) => {
      console.warn('[pushNative] Push.register failed:', e?.message)
      finish({ ok: false, reason: 'register_failed', error: e?.message })
    })

    // Failsafe timeout 5s
    setTimeout(() => finish({ ok: false, reason: 'timeout' }), 5000)
  })
}

/**
 * Borra el token FCM del usuario al cerrar sesión.
 */
export async function unregisterSocioPushNative(userId) {
  // Quitar los listeners del usuario que sale, para que un refresh de token posterior
  // no re-asocie el dispositivo a su userId (closure) tras que entre otro usuario.
  try {
    const Push = (await getPlugin('PushNotifications'))?.plugin
    if (Push) await Push.removeAllListeners()
  } catch (_) {}
  try {
    await supabase
      .from('push_subscriptions')
      .delete()
      .eq('user_id', userId)
      .eq('user_type', 'socio')
  } catch (e) {
    console.warn('[pushNative] unregister failed:', e?.message)
  }
  registered = false
}

/**
 * Listener custom para que React reaccione a pushes recibidos. Devuelve unsubscribe.
 */
export function onPushReceived(callback) {
  const handler = (e) => callback(e.detail)
  window.addEventListener('pidoo-push-received', handler)
  return () => window.removeEventListener('pidoo-push-received', handler)
}

export function onPushTapped(callback) {
  const handler = (e) => callback(e.detail)
  window.addEventListener('pidoo-push-tapped', handler)
  return () => window.removeEventListener('pidoo-push-tapped', handler)
}
