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
// NOTA Android: tras ~5 min en background, Android throttlea las peticiones HTTP
// hechas desde el WebView. `rider-update-location` se invoca desde el WebView
// (supabase-js). Si se observan huecos de ubicación con la app cerrada mucho
// tiempo, migrar el POST a CapacitorHttp (nativo).
// Ref: https://github.com/capacitor-community/background-geolocation/issues/14
// TODO: exponer también la captura de ubicación nativa al hilo del watcher para
// evitar el throttling del WebView a los 5 min.

import { registerPlugin } from '@capacitor/core'
import { getPlugin, isNativePlatform } from './capacitor'
import { riderUpdateLocation } from './riderApi'

// ─── Config ───
const ACTIVE_INTERVAL_MS = 15_000   // 15s en foreground (fallback polling)
const IDLE_INTERVAL_MS   = 60_000   // 60s en background (fallback polling)
const POS_OPTS = { enableHighAccuracy: true, timeout: 6_000, maximumAge: 30_000 }
const DISTANCE_FILTER_M = 30        // metros mínimos entre actualizaciones (watcher nativo)

const BG_NOTIF_TITLE = 'Pidoo en servicio'
const BG_NOTIF_MESSAGE = 'Compartiendo tu ubicación para asignarte pedidos.'

// Plugin nativo. registerPlugin es seguro en web: devuelve un proxy cuyas
// llamadas rechazan en plataforma no soportada (las capturamos abajo).
const BackgroundGeolocation = registerPlugin('BackgroundGeolocation')

// ─── Estado del módulo ───
let onUpdateCb = null          // callback opcional al recibir nueva posición
let watcherId = null           // id del watcher nativo activo (background-geolocation)
let usingNativeWatcher = false // true si el watcher nativo está corriendo

// Estado del fallback polling
let timer = null
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

  // Intentar watcher nativo (no bloqueante). Si falla, fallback a polling.
  startNativeWatcher().then((ok) => {
    if (!ok) startPolling()
  })
}

/**
 * Detiene el tracking (nativo y/o polling) y limpia callbacks.
 */
export function stopTracking() {
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
}

// ──────────────────────────────────────────────────────────────
// Watcher nativo (background-geolocation)
// ──────────────────────────────────────────────────────────────

/**
 * Arranca el watcher nativo con foreground service.
 * Devuelve true si se montó, false si no está disponible (→ usar polling).
 */
async function startNativeWatcher() {
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
        distanceFilter: DISTANCE_FILTER_M,
      },
      (location, error) => {
        if (error) {
          if (error.code === 'NOT_AUTHORIZED') {
            console.warn('[riderGeo] background location NOT_AUTHORIZED')
            try { BackgroundGeolocation.openSettings() } catch (_) {}
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
        }
        // Persistir en la edge (best-effort, no await en el callback).
        try {
          riderUpdateLocation(pos)
        } catch (_) {}
        if (typeof onUpdateCb === 'function') onUpdateCb(pos)
      },
    )
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
  if (timer) return
  intervalMs = ACTIVE_INTERVAL_MS
  // Captura inmediata + arranca el loop.
  captureAndPush()
  scheduleNext()
  // Listener pausar/reanudar cuando la app va a background.
  bindLifecycle()
}

function stopPolling() {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
}

function scheduleNext() {
  if (timer) clearTimeout(timer)
  timer = setTimeout(async () => {
    timer = null
    await captureAndPush()
    // Si seguimos activos (no se llamó stop), reagenda.
    if (onUpdateCb !== null) {
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
