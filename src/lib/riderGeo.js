// riderGeo.js — Captura GPS del rider y la manda a la edge `rider-update-location`.
//
// ESTRATEGIA (junio 2026):
//   - NATIVO (Android/iOS): usa @capacitor-community/background-geolocation con un
//     foreground service. El watcher entrega posiciones incluso con la app en
//     background o la pantalla apagada (resiste Android Doze). En Android se
//     muestra una notificación persistente "Pidoo en servicio" mientras el rider
//     está online (requisito del foreground service de localización).
//   - WEB / fallback: si el plugin nativo no está disponible (navegador o el
//     plugin no se pudo cargar), cae al polling JS clásico con
//     navigator.geolocation / @capacitor/geolocation (el comportamiento anterior).
//
// API pública (NO cambiar — la consume RiderContext.jsx):
//   - requestLocationPermission(): Promise<boolean>
//   - getCurrentPosition(): Promise<{latitud,longitud,accuracy}|null>
//   - startTracking({ onUpdate }): void   (idempotente)
//   - stopTracking(): void
//   - captureAndPush(): Promise<pos|null> (uso externo opcional)
//
// KEEPALIVE EN BACKGROUND (julio 2026): con la app minimizada el SO congela los
// timers de JS del WebView, así que el latido setInterval de RiderContext muere y
// el cron `auto-offline` (12 min sin señal) apagaba al socio QUIETO con la app de
// fondo. El único código que sí se ejecuta en background es el callback del
// watcher nativo (evento nativo→JS, no timer). Por eso el watcher va con
// distanceFilter:0 (el SO entrega fixes aunque no te muevas) y es el propio
// callback quien decide cuándo postear: al moverse ≥30m (máx 1 cada 10s, como
// antes) o, sin movimiento, al menos 1 vez por minuto como latido de presencia.
// `rider-update-location` estampa last_location_at, así que ese POST ES el latido.
// Ref: https://github.com/capacitor-community/background-geolocation/issues/14

import { registerPlugin } from '@capacitor/core'
import { getPlugin, isNativePlatform } from './capacitor'
import { riderUpdateLocation } from './riderApi'

// ─── Config ───
const ACTIVE_INTERVAL_MS = 15_000   // 15s en foreground (fallback polling)
const IDLE_INTERVAL_MS   = 60_000   // 60s en background (fallback polling)
const POS_OPTS = { enableHighAccuracy: true, timeout: 12_000, maximumAge: 30_000 }
// distanceFilter del watcher NATIVO a 0: el SO entrega fixes continuamente aunque
// el rider esté quieto. Es lo que mantiene vivo el callback JS en background (los
// timers del WebView se congelan al minimizar). El filtrado real de "cuándo
// postear" se hace en JS con las dos constantes de abajo.
const NATIVE_DISTANCE_FILTER_M = 0
const MOVE_THRESHOLD_M = 30         // metros mínimos para postear por movimiento (antes distanceFilter)
const MIN_PUSH_INTERVAL_MS = 10_000 // mínimo entre POSTs de ubicación (evita spamear la edge en movimiento)
const KEEPALIVE_INTERVAL_MS = 60_000 // sin movimiento, postear igualmente cada 60s (latido de presencia)

const BG_NOTIF_TITLE = 'Pidoo en servicio'
const BG_NOTIF_MESSAGE = 'Compartiendo tu ubicación para asignarte pedidos.'

// Plugin nativo. registerPlugin es seguro en web: devuelve un proxy cuyas
// llamadas rechazan en plataforma no soportada (las capturamos abajo).
const BackgroundGeolocation = registerPlugin('BackgroundGeolocation')

// ─── Estado del módulo ───
let onUpdateCb = null          // callback opcional al recibir nueva posición
let onErrorCb = null           // callback opcional al fallar el watcher (permiso/GPS)
let watcherId = null           // id del watcher nativo activo (background-geolocation)
let usingNativeWatcher = false // true si el watcher nativo está corriendo

// Token de generación: se incrementa en cada stopTracking(). Cualquier arranque de
// watcher/polling en vuelo (addWatcher es async) comprueba su token al resolver; si
// ya no es el vigente, significa que hubo un stop mientras arrancaba → aborta y
// limpia. Evita el watcher huérfano (tracking activo estando offline/deslogueado).
let startToken = 0
let lastPushAt = 0             // timestamp del último POST de ubicación (throttle)
let lastPushedPos = null       // última posición POSTEADA (para el umbral de movimiento en JS)

// Distancia Haversine en metros entre dos posiciones {latitud, longitud}.
function distanceMeters(a, b) {
  const R = 6371000
  const toRad = (d) => (d * Math.PI) / 180
  const dLat = toRad(b.latitud - a.latitud)
  const dLng = toRad(b.longitud - a.longitud)
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.latitud)) * Math.cos(toRad(b.latitud)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(s))
}

// Estado del fallback polling
let timer = null
let pollingActive = false      // señal de vida explícita del loop de polling
let intervalMs = ACTIVE_INTERVAL_MS

// ──────────────────────────────────────────────────────────────
// Permisos
// ──────────────────────────────────────────────────────────────

/**
 * Solicita permiso de ubicación. Idempotente.
 * Devuelve true si concedido, false si denegado.
 *
 * El watcher nativo de background-geolocation pide los permisos él mismo
 * (requestPermissions:true), incluido el de "siempre"/background, así que aquí
 * solo verificamos/pedimos el permiso de primer plano para no bloquear el toggle
 * online en caso de denegación dura.
 */
export async function requestLocationPermission() {
  const Geo = (await getPlugin('Geolocation'))?.plugin
  if (!Geo) {
    // En web, navigator.geolocation requiere que el usuario lo dispare desde un
    // gesto. Devolvemos true y dejamos que getCurrentPosition lo pida luego.
    return true
  }
  try {
    const perm = await Geo.checkPermissions()
    if (perm.location === 'granted') return true
    const req = await Geo.requestPermissions({ permissions: ['location'] })
    return req.location === 'granted'
  } catch (e) {
    console.warn('[riderGeo] permission error:', e?.message)
    return false
  }
}

/**
 * Abre los ajustes del sistema para que el usuario conceda el permiso de
 * ubicación manualmente (tras haberlo denegado con "no volver a preguntar").
 * Usa BackgroundGeolocation.openSettings(). Best-effort: no-op en web.
 */
export async function openLocationSettings() {
  try {
    await BackgroundGeolocation.openSettings()
  } catch (e) {
    console.warn('[riderGeo] openSettings no disponible:', e?.message)
  }
}

// ──────────────────────────────────────────────────────────────
// Posición puntual
// ──────────────────────────────────────────────────────────────

/**
 * Captura UNA posición. Resuelve con { latitud, longitud, accuracy } o null.
 * Usa @capacitor/geolocation en nativo y navigator.geolocation en web.
 */
export async function getCurrentPosition() {
  const Geo = (await getPlugin('Geolocation'))?.plugin
  try {
    if (Geo) {
      const pos = await Geo.getCurrentPosition(POS_OPTS)
      return {
        latitud: pos.coords.latitude,
        longitud: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
      }
    }
    // Web fallback
    if (typeof navigator !== 'undefined' && navigator.geolocation) {
      return await new Promise((res) => {
        navigator.geolocation.getCurrentPosition(
          (pos) => res({
            latitud: pos.coords.latitude,
            longitud: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
          }),
          () => res(null),
          POS_OPTS,
        )
      })
    }
  } catch (e) {
    console.warn('[riderGeo] getCurrentPosition failed:', e?.message)
  }
  return null
}

/**
 * Captura una vez y envía a la edge. Función pura para uso externo.
 */
export async function captureAndPush() {
  const pos = await getCurrentPosition()
  if (!pos) return null
  await riderUpdateLocation(pos)
  if (typeof onUpdateCb === 'function') onUpdateCb(pos)
  return pos
}

// ──────────────────────────────────────────────────────────────
// Tracking (start / stop)
// ──────────────────────────────────────────────────────────────

/**
 * Arranca el tracking. Idempotente: si ya está corriendo, no relanza.
 * Intenta el watcher nativo en background; si no es posible, cae al polling.
 * @param {object} opts
 * @param {(pos:{latitud,longitud,accuracy}) => void} opts.onUpdate
 */
export function startTracking(opts = {}) {
  if (usingNativeWatcher || timer) return  // ya activo
  onUpdateCb = opts.onUpdate || null
  onErrorCb = opts.onError || null
  // Sesión de tracking nueva: postear el primer fix de inmediato (sin arrastrar
  // throttle/posición de la sesión anterior).
  lastPushAt = 0
  lastPushedPos = null
  const myToken = startToken

  // Intentar watcher nativo (no bloqueante). Si falla, fallback a polling.
  startNativeWatcher(myToken).then((ok) => {
    // Si hubo un stopTracking() mientras arrancaba, el token cambió → no montar nada.
    if (myToken !== startToken) return
    if (!ok) startPolling()
  })
}

/**
 * Detiene el tracking (nativo y/o polling) y limpia callbacks.
 * Incrementa el token de generación para invalidar cualquier arranque en vuelo.
 */
export function stopTracking() {
  startToken++              // invalida watchers/polling que estén arrancando
  pollingActive = false
  // Parar watcher nativo
  if (watcherId) {
    const id = watcherId
    watcherId = null
    usingNativeWatcher = false
    try {
      BackgroundGeolocation.removeWatcher({ id }).catch((e) =>
        console.warn('[riderGeo] removeWatcher error:', e?.message))
    } catch (_) {}
  }
  // Parar polling
  stopPolling()
  onUpdateCb = null
  onErrorCb = null
}

// ──────────────────────────────────────────────────────────────
// Watcher nativo (background-geolocation)
// ──────────────────────────────────────────────────────────────

/**
 * Arranca el watcher nativo con foreground service.
 * Devuelve true si se montó, false si no está disponible (→ usar polling).
 */
async function startNativeWatcher(myToken) {
  // Solo en plataforma nativa
  if (!(await isNativePlatform())) return false

  try {
    const id = await BackgroundGeolocation.addWatcher(
      {
        // backgroundMessage definido → updates también en background.
        backgroundMessage: BG_NOTIF_MESSAGE,
        backgroundTitle: BG_NOTIF_TITLE,
        requestPermissions: true,
        stale: false,
        distanceFilter: NATIVE_DISTANCE_FILTER_M,
      },
      (location, error) => {
        if (error) {
          if (error.code === 'NOT_AUTHORIZED') {
            // Permiso denegado o ubicación del sistema desactivada: el watcher está
            // "muerto" aunque su id exista. Avisamos a RiderContext (banner) en vez
            // de abrir Ajustes automáticamente (que abría la app de Ajustes "sola").
            console.warn('[riderGeo] background location NOT_AUTHORIZED')
            usingNativeWatcher = false
            if (typeof onErrorCb === 'function') onErrorCb({ code: 'NOT_AUTHORIZED' })
          } else {
            console.warn('[riderGeo] watcher error:', error?.message || error)
          }
          return
        }
        if (!location) return
        const pos = {
          latitud: location.latitude,
          longitud: location.longitude,
          accuracy: location.accuracy,
          // Timestamp del fix (ms). Permite a la edge descartar updates fuera de orden
          // y a la lógica de asignación medir la frescura real de la posición.
          timestamp: location.time || null,
        }
        // Con distanceFilter:0 el SO dispara este callback cada pocos segundos,
        // haya o no movimiento. Decidimos aquí cuándo postear:
        //   - MOVIMIENTO: se movió ≥MOVE_THRESHOLD_M desde el último POST, con un
        //     mínimo de MIN_PUSH_INTERVAL_MS entre POSTs (mismo comportamiento de
        //     siempre; el umbral de 30m que antes hacía el distanceFilter nativo).
        //   - KEEPALIVE: sin movimiento, posteamos igualmente cada
        //     KEEPALIVE_INTERVAL_MS. `rider-update-location` estampa
        //     last_location_at, así que este POST es el latido que evita que el
        //     cron auto-offline apague a un socio quieto con la app minimizada
        //     (los timers JS del WebView se congelan en background; este callback
        //     es evento nativo→JS y sí sigue ejecutándose).
        const now = Date.now()
        const sinceLastPush = now - lastPushAt
        const movedEnough =
          !lastPushedPos || distanceMeters(lastPushedPos, pos) >= MOVE_THRESHOLD_M
        const shouldPush =
          (movedEnough && sinceLastPush >= MIN_PUSH_INTERVAL_MS) ||
          sinceLastPush >= KEEPALIVE_INTERVAL_MS
        if (shouldPush) {
          lastPushAt = now
          lastPushedPos = pos
          try { riderUpdateLocation(pos) } catch (_) {}
        }
        if (typeof onUpdateCb === 'function') onUpdateCb(pos)
      },
    )
    // Si hubo stopTracking() mientras addWatcher estaba en vuelo, el token cambió:
    // removemos el watcher recién creado de inmediato para no dejarlo huérfano.
    if (myToken !== startToken) {
      try { BackgroundGeolocation.removeWatcher({ id }).catch(() => {}) } catch (_) {}
      return true // "montado" desde el punto de vista del caller, pero ya limpiado
    }
    watcherId = id
    usingNativeWatcher = true
    console.log('[riderGeo] native background watcher iniciado:', id)
    return true
  } catch (e) {
    console.warn('[riderGeo] no se pudo iniciar watcher nativo, fallback a polling:', e?.message)
    return false
  }
}

// ──────────────────────────────────────────────────────────────
// Fallback: polling JS clásico
// ──────────────────────────────────────────────────────────────

function startPolling() {
  if (timer || pollingActive) return
  pollingActive = true
  intervalMs = ACTIVE_INTERVAL_MS
  // Captura inmediata + arranca el loop.
  captureAndPush()
  scheduleNext()
  // Listener pausar/reanudar cuando la app va a background.
  bindLifecycle()
}

function stopPolling() {
  pollingActive = false
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
}

function scheduleNext() {
  if (timer) clearTimeout(timer)
  timer = setTimeout(async () => {
    timer = null
    if (!pollingActive) return   // se llamó stopTracking mientras esperábamos
    await captureAndPush()
    // Si seguimos activos (no se llamó stop), reagenda.
    if (pollingActive) {
      scheduleNext()
    }
  }, intervalMs)
}

let lifecycleBound = false
async function bindLifecycle() {
  if (lifecycleBound) return
  const App = (await getPlugin('App'))?.plugin
  if (!App) return
  App.addListener('appStateChange', (state) => {
    intervalMs = state.isActive ? ACTIVE_INTERVAL_MS : IDLE_INTERVAL_MS
    // si hay timer activo, reagendar con nuevo intervalo
    if (timer) scheduleNext()
  })
  lifecycleBound = true
}
