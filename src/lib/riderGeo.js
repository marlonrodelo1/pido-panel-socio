// riderGeo.js — Captura GPS y manda a edge function rider-update-location.
//
// Estrategia MVP (sin foreground service):
//   - Polling cada 15s mientras la app está en foreground y rider está online.
//   - Polling cada 60s cuando la app pasa a background (mientras Android lo permita).
//   - timeout 6s + maximumAge 30s en getCurrentPosition.
//   - Si el SO mata el proceso (Android Doze), el GPS deja de actualizar; la
//     ventana de 60min en dispatch-order absorbe desconexiones cortas.
//
// El polling se controla con start()/stop() — el RiderContext lo invoca cuando
// el toggle "En línea" cambia.

import { getPlugin } from './capacitor'
import { riderUpdateLocation } from './riderApi'

const ACTIVE_INTERVAL_MS = 15_000   // 15s en foreground
const IDLE_INTERVAL_MS   = 60_000   // 60s en background
const POS_OPTS = { enableHighAccuracy: true, timeout: 6_000, maximumAge: 30_000 }

let timer = null
let intervalMs = ACTIVE_INTERVAL_MS
let onUpdateCb = null  // callback opcional al recibir nueva posición

/**
 * Solicita permiso de ubicación. Idempotente.
 * Devuelve true si concedido, false si denegado.
 */
export async function requestLocationPermission() {
  const Geo = await getPlugin('Geolocation')
  if (!Geo) {
    // En web, navigator.geolocation requiere usuario haga la petición desde un
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
 * Captura UNA posición. Resuelve con { latitud, longitud, accuracy } o null.
 */
export async function getCurrentPosition() {
  const Geo = await getPlugin('Geolocation')
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

/**
 * Arranca el polling. Idempotente: si ya está corriendo, no relanza.
 * @param {object} opts
 * @param {(pos:{latitud,longitud,accuracy}) => void} opts.onUpdate
 */
export function startTracking(opts = {}) {
  if (timer) return
  onUpdateCb = opts.onUpdate || null
  intervalMs = ACTIVE_INTERVAL_MS
  // Captura inmediata + arranca el loop.
  captureAndPush()
  scheduleNext()
  // Listener pausar/reanudar cuando app va a background
  bindLifecycle()
}

/**
 * Detiene polling y limpia callbacks.
 */
export function stopTracking() {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  onUpdateCb = null
}

function scheduleNext() {
  if (timer) clearTimeout(timer)
  timer = setTimeout(async () => {
    timer = null
    await captureAndPush()
    if (onUpdateCb !== null || timer === null) {
      // Si seguimos activos (no se llamó stop), reagenda.
      scheduleNext()
    }
  }, intervalMs)
}

let lifecycleBound = false
async function bindLifecycle() {
  if (lifecycleBound) return
  const App = await getPlugin('App')
  if (!App) return
  App.addListener('appStateChange', (state) => {
    intervalMs = state.isActive ? ACTIVE_INTERVAL_MS : IDLE_INTERVAL_MS
    // si hay timer activo, reagendar con nuevo intervalo
    if (timer) scheduleNext()
  })
  lifecycleBound = true
}
