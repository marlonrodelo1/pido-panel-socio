// Wrapper de Geolocation profesional para riders en produccion.
//
// En NATIVO (Android/iOS) usa @capacitor-community/background-geolocation:
//   - Foreground service con notificacion persistente
//     "Pidoo - Recibiendo pedidos" mientras el rider esta online.
//   - Sigue enviando coordenadas con la pantalla bloqueada y el movil en
//     el bolsillo (Android 10+ requiere permiso "todo el tiempo").
//   - Reporta cada vez que el dispositivo se mueve >= distanceFilter.
//
// En WEB usa el polling tradicional con @capacitor/geolocation /
// navigator.geolocation cada 15s (activo) / 60s (idle).
//
// La API publica (makeRiderTracker, getCurrentPosition, ensureLocationPermission)
// se mantiene compatible con RiderContext: NO romper signatures.

import { Capacitor } from '@capacitor/core'

const isNative = () => Capacitor.getPlatform() !== 'web'

// --- carga perezosa de plugins ---

let CapacitorGeolocation = null
async function getCapPlugin() {
  if (CapacitorGeolocation) return CapacitorGeolocation
  if (Capacitor.getPlatform() === 'web') return null
  const mod = await import('@capacitor/geolocation')
  CapacitorGeolocation = mod.Geolocation
  return CapacitorGeolocation
}

let BgGeo = null
async function getBgGeo() {
  if (BgGeo) return BgGeo
  if (!isNative()) return null
  try {
    const mod = await import(/* @vite-ignore */ '@capacitor-community/background-geolocation')
    // El plugin exporta `BackgroundGeolocation` con metodos estaticos.
    BgGeo = mod.BackgroundGeolocation || mod.default || mod
    return BgGeo
  } catch (e) {
    console.warn('[riderGeo] background-geolocation no instalado, fallback a polling:', e?.message)
    return null
  }
}

// --- permisos ---

// Helper interno para loguear pasos del flujo de permisos a push_debug_logs.
// Asi podemos diagnosticar en produccion por que no aparece el dialogo de
// Android. No bloquea si la inserta falla.
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

// Pide permiso "while in use" minimo. Devuelve true/false.
// En Capacitor 8 la API es requestPermissions({ permissions?: ['location' | 'coarseLocation'] }).
// Sin opciones, pide todos. Con opciones, solo los indicados.
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
    // Si el usuario los denego antes ('denied' o 'prompt-with-rationale'),
    // intentar pedirlos igualmente. Android puede mostrar el dialogo o
    // ignorarlo segun el estado. Logueamos el resultado para diagnosticar.
    const req = await cap.requestPermissions({ permissions: ['location', 'coarseLocation'] })
    dbgLogPerm('request_result', req)
    return req.location === 'granted' || req.coarseLocation === 'granted'
  } catch (e) {
    dbgLogPerm('error', { msg: e?.message, name: e?.name })
    return false
  }
}

// Pide permiso "todo el tiempo" (background). En Android 10+ esto abre el
// dialogo del sistema con la opcion "Permitir todo el tiempo". Si el usuario
// la rechaza pero acepta "Solo mientras se usa la app", devolvemos false
// pero ensureLocationPermission seguira siendo true.
//
// Devuelve { foreground: bool, background: bool, error?: string }.
export async function ensureBackgroundLocationPermission() {
  const fg = await ensureLocationPermission()
  if (!fg) return { foreground: false, background: false }
  if (!isNative()) return { foreground: true, background: true }

  const cap = await getCapPlugin()
  if (!cap) return { foreground: true, background: false }

  try {
    // @capacitor/geolocation tambien expone alias 'location' / 'coarseLocation'.
    // En Android 10+, una vez aceptado el "while in use" basta con que el
    // usuario abra ajustes y lo cambie a "todo el tiempo". El plugin
    // background-geolocation puede solicitarlo via openSettings.
    const perm = await cap.checkPermissions()
    // Algunos forks exponen `coarseLocation` y `location`, otros `coarse` y
    // `precise`. Tratamos ambos.
    const granted = perm.location === 'granted' || perm.coarseLocation === 'granted'
    return { foreground: granted, background: granted }
  } catch (e) {
    return { foreground: true, background: false, error: e?.message }
  }
}

// --- one-shot getCurrentPosition ---

export async function getCurrentPosition() {
  const cap = await getCapPlugin()
  if (cap) {
    const granted = await ensureLocationPermission()
    if (!granted) throw new Error('permission_denied')
    const pos = await cap.getCurrentPosition({ enableHighAccuracy: false, timeout: 6000, maximumAge: 30000 })
    return { lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy }
  }
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) return reject(new Error('no_geolocation'))
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy }),
      (err) => reject(err),
      { enableHighAccuracy: false, timeout: 6000, maximumAge: 30000 },
    )
  })
}

// --- tracker ---

// Cadencias web (ms)
const CADENCE_ACTIVE_MS = 15000
const CADENCE_IDLE_MS   = 60000

// Distancia minima (m) para que el plugin nativo emita actualizacion.
const DISTANCE_ACTIVE_M = 10
const DISTANCE_IDLE_M   = 50

// Throttle para no spammear updateLocation desde el callback nativo:
// el plugin puede emitir muy seguido si el rider va andando, asi que
// limitamos a 1 update cada N ms segun activo/idle.
const THROTTLE_ACTIVE_MS = 10000
const THROTTLE_IDLE_MS   = 45000

const NOTIF_TITLE = 'Pidoo - Recibiendo pedidos'
const NOTIF_TEXT  = 'Tienes la ubicacion activada para recibir pedidos cerca.'

export function makeRiderTracker({ onTick, onError, onStatusChange } = {}) {
  // estado compartido
  let stopped = false
  let activeMode = false
  let lastEmitTs = 0

  // estado web
  let webTimer = null

  // estado nativo
  let watcherId = null
  let bgGeoPlugin = null
  let restartingForActivity = false

  function notifyStatus(s) { try { onStatusChange?.(s) } catch (_) {} }

  function shouldEmit() {
    const now = Date.now()
    const min = activeMode ? THROTTLE_ACTIVE_MS : THROTTLE_IDLE_MS
    if (now - lastEmitTs < min) return false
    lastEmitTs = now
    return true
  }

  // ---- web fallback ----

  function cadenceWeb() {
    return activeMode ? CADENCE_ACTIVE_MS : CADENCE_IDLE_MS
  }

  async function tickWeb() {
    if (stopped) return
    try {
      const pos = await getCurrentPosition()
      onTick?.(pos)
    } catch (e) {
      onError?.(e)
    }
    if (!stopped) webTimer = setTimeout(tickWeb, cadenceWeb())
  }

  function startWeb() {
    if (webTimer || stopped) return
    notifyStatus({ kind: 'web-polling', ok: true })
    tickWeb()
  }

  function stopWeb() {
    if (webTimer) { clearTimeout(webTimer); webTimer = null }
  }

  // ---- nativo (background-geolocation) ----

  function watcherOptions() {
    return {
      backgroundTitle: NOTIF_TITLE,
      backgroundMessage: NOTIF_TEXT,
      requestPermissions: true,
      stale: false,
      // En activo emitimos cada 10m, en idle cada 50m. El plugin SIEMPRE
      // emite la primera lectura cuando arranca, asi que aunque el rider
      // este parado tendremos al menos el "pulso" inicial.
      distanceFilter: activeMode ? DISTANCE_ACTIVE_M : DISTANCE_IDLE_M,
    }
  }

  async function startNative() {
    if (watcherId || stopped) return
    const plugin = await getBgGeo()
    if (!plugin) {
      // Plugin nativo no disponible (no instalado todavia o build viejo) -
      // caemos a polling en foreground.
      notifyStatus({ kind: 'native-fallback-web', ok: true, reason: 'plugin_unavailable' })
      startWeb()
      return
    }
    bgGeoPlugin = plugin

    try {
      const id = await plugin.addWatcher(
        watcherOptions(),
        (location, err) => {
          if (err) {
            // Errores del plugin: usuario denego permiso, GPS apagado, etc.
            // err.code: 'NOT_AUTHORIZED' | 'PERMISSION_DENIED' | otros.
            notifyStatus({ kind: 'native-error', ok: false, code: err.code, message: err.message })
            onError?.(new Error(err.message || err.code || 'bg_geo_error'))
            // Si fue un error de permiso, no reintentamos: dejamos que la
            // UI le pida al rider que reintente.
            return
          }
          if (stopped) return
          // location: { latitude, longitude, accuracy, altitude, speed, ... }
          if (!shouldEmit()) return
          try {
            onTick?.({
              lat: location.latitude,
              lng: location.longitude,
              acc: location.accuracy,
            })
          } catch (e) {
            onError?.(e)
          }
        },
      )
      watcherId = id
      notifyStatus({ kind: 'native-watcher', ok: true, id })
    } catch (e) {
      // No pudimos arrancar el watcher (plugin existe pero algo fallo,
      // p.ej. usuario denego). Caemos a polling web como ultimo recurso
      // para que al menos en foreground siga moviendose el GPS.
      console.warn('[riderGeo] addWatcher fail, fallback web:', e?.message)
      notifyStatus({ kind: 'native-fallback-web', ok: false, reason: e?.message })
      onError?.(e)
      startWeb()
    }
  }

  async function stopNative() {
    if (!watcherId || !bgGeoPlugin) return
    try { await bgGeoPlugin.removeWatcher({ id: watcherId }) } catch (_) {}
    watcherId = null
    bgGeoPlugin = null
    notifyStatus({ kind: 'native-stopped', ok: true })
  }

  async function restartNativeForActivityChange() {
    // Recreamos el watcher con nuevo distanceFilter cuando cambia
    // active/idle. Evitamos re-entradas concurrentes.
    if (restartingForActivity) return
    restartingForActivity = true
    try {
      await stopNative()
      if (!stopped) await startNative()
    } finally {
      restartingForActivity = false
    }
  }

  // ---- API publica ----

  return {
    start() {
      if (stopped) return
      if (isNative()) {
        startNative()
      } else {
        startWeb()
      }
    },
    stop() {
      stopped = true
      stopWeb()
      stopNative()
    },
    setActive(b) {
      const next = !!b
      if (next === activeMode) return
      activeMode = next
      if (isNative()) {
        // Recrear watcher para aplicar nuevo distanceFilter.
        if (watcherId) restartNativeForActivityChange()
      }
      // En web el siguiente tick ya leera la nueva cadencia.
    },
  }
}
