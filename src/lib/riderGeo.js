// Wrapper de Geolocation para riders.
//
// SIMPLIFICADO (28-abr-2026): se elimino la rama nativa con
// @capacitor-community/background-geolocation porque (a) Play Store exigia
// formularios + video por FOREGROUND_SERVICE_LOCATION y ACCESS_BACKGROUND_LOCATION,
// y (b) en produccion el plugin no reportaba con la app cerrada (ver memoria
// 27-abr). Ahora la estrategia es polling foreground en NATIVO y WEB usando
// @capacitor/geolocation / navigator.geolocation. La ventana de 480 min en
// dispatch-order ya tolera GPS no-fresh.
//
// La API publica (makeRiderTracker, getCurrentPosition, ensureLocationPermission,
// ensureBackgroundLocationPermission) se mantiene compatible con RiderContext.

import { Capacitor } from '@capacitor/core'

const isNative = () => Capacitor.getPlatform() !== 'web'

// --- carga perezosa del plugin ---

let CapacitorGeolocation = null
async function getCapPlugin() {
  if (CapacitorGeolocation) return CapacitorGeolocation
  if (Capacitor.getPlatform() === 'web') return null
  const mod = await import('@capacitor/geolocation')
  CapacitorGeolocation = mod.Geolocation
  return CapacitorGeolocation
}

// --- permisos ---

async function dbgLogPerm(event, details) {
  try {
    const { supabase } = await import('./supabase')
    await supabase.from('push_debug_logs').insert({
      platform: 'rider-app',
      event: 'perm:' + event,
      details: details ? JSON.stringify(details).slice(0, 1500) : null,
    })
  } catch (_) {}
}

export async function ensureLocationPermission() {
  const cap = await getCapPlugin()
  if (!cap) {
    dbgLogPerm('skip_no_plugin', { platform: Capacitor.getPlatform() })
    return true
  }
  try {
    const perm = await cap.checkPermissions()
    dbgLogPerm('check', perm)
    if (perm.location === 'granted' || perm.coarseLocation === 'granted') {
      return true
    }
    const req = await cap.requestPermissions({ permissions: ['location', 'coarseLocation'] })
    dbgLogPerm('request_result', req)
    return req.location === 'granted' || req.coarseLocation === 'granted'
  } catch (e) {
    dbgLogPerm('error', { msg: e?.message, name: e?.name })
    return false
  }
}

// Alias de ensureLocationPermission. El concepto "background" ya no aplica:
// solo pedimos permiso "while in use". Devolvemos el mismo bool en ambos
// campos para que el codigo consumidor (RiderContext) no muestre warnings
// falsos sobre "permitir todo el tiempo".
export async function ensureBackgroundLocationPermission() {
  const granted = await ensureLocationPermission()
  return { foreground: granted, background: granted }
}

// --- one-shot getCurrentPosition ---

export async function getCurrentPosition() {
  const cap = await getCapPlugin()
  if (cap) {
    const granted = await ensureLocationPermission()
    if (!granted) throw new Error('permission_denied')
    try {
      const pos = await cap.getCurrentPosition({
        enableHighAccuracy: true,
        timeout: 20000,
        maximumAge: 60000,
      })
      return { lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy }
    } catch (e1) {
      return await new Promise((resolve, reject) => {
        let watcherId = null
        const stopAt = Date.now() + 25000
        ;(async () => {
          try {
            watcherId = await cap.watchPosition(
              { enableHighAccuracy: true, timeout: 25000 },
              (position, err) => {
                if (err) {
                  if (Date.now() >= stopAt && watcherId) {
                    try { cap.clearWatch({ id: watcherId }) } catch (_) {}
                    reject(err)
                  }
                  return
                }
                if (!position?.coords) return
                if (watcherId) try { cap.clearWatch({ id: watcherId }) } catch (_) {}
                resolve({ lat: position.coords.latitude, lng: position.coords.longitude, acc: position.coords.accuracy })
              },
            )
          } catch (e2) {
            reject(e2)
          }
        })()
        setTimeout(() => {
          if (watcherId) try { cap.clearWatch({ id: watcherId }) } catch (_) {}
          reject(e1 || new Error('gps_timeout'))
        }, 26000)
      })
    }
  }
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) return reject(new Error('no_geolocation'))
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy }),
      (err) => reject(err),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 60000 },
    )
  })
}

// --- tracker (polling unificado nativo + web) ---

const CADENCE_ACTIVE_MS = 15000
const CADENCE_IDLE_MS   = 60000

export function makeRiderTracker({ onTick, onError, onStatusChange } = {}) {
  let stopped = false
  let activeMode = false
  let timer = null

  function notifyStatus(s) { try { onStatusChange?.(s) } catch (_) {} }
  function cadence() { return activeMode ? CADENCE_ACTIVE_MS : CADENCE_IDLE_MS }

  async function tick() {
    if (stopped) return
    try {
      const pos = await getCurrentPosition()
      onTick?.(pos)
    } catch (e) {
      onError?.(e)
    }
    if (!stopped) timer = setTimeout(tick, cadence())
  }

  return {
    start() {
      if (timer || stopped) return
      notifyStatus({ kind: isNative() ? 'native-polling' : 'web-polling', ok: true })
      tick()
    },
    stop() {
      stopped = true
      if (timer) { clearTimeout(timer); timer = null }
    },
    setActive(b) {
      const next = !!b
      if (next === activeMode) return
      activeMode = next
      // El siguiente tick ya leera la nueva cadencia.
    },
  }
}
