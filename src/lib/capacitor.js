// capacitor.js — wrapper para uso opcional de Capacitor desde código React.
//
// Permite que la app funcione en web (sin Capacitor) sin romperse. Las funciones
// que requieren Capacitor devuelven null o no-op en web. Lazy import para que el
// bundle Vite no peseé los plugins cuando no se usan.

let _Capacitor = null
let _pluginsCache = {}

async function ensureCapacitor() {
  if (_Capacitor) return _Capacitor
  try {
    const mod = await import('@capacitor/core')
    _Capacitor = mod.Capacitor
    return _Capacitor
  } catch (_) {
    return null
  }
}

/**
 * Devuelve true solo dentro de la app nativa (Capacitor Android/iOS).
 * En web (Vite dev / nginx), devuelve false. Es la pieza clave del dual shell.
 */
export async function isNativePlatform() {
  const C = await ensureCapacitor()
  return !!(C && C.isNativePlatform && C.isNativePlatform())
}

/**
 * Detección síncrona (asume que ya se cargó Capacitor). Para condicionales en
 * render. Si no está cargado todavía, devuelve false (web fallback).
 */
export function isNativeSync() {
  return !!(_Capacitor && _Capacitor.isNativePlatform && _Capacitor.isNativePlatform())
}

/**
 * Devuelve la plataforma: 'web' | 'android' | 'ios'.
 */
export async function getPlatform() {
  const C = await ensureCapacitor()
  if (!C) return 'web'
  return C.getPlatform ? C.getPlatform() : 'web'
}

/**
 * Identificador estable del dispositivo, para "un solo dispositivo activo por
 * socio". En nativo usa @capacitor/device (Device.getId()); en web (o si el plugin
 * no está) cae a un UUID persistido en localStorage. Cacheado en memoria.
 */
let _deviceId = null
export async function getDeviceId() {
  if (_deviceId) return _deviceId
  // Id estable por instalación, persistido en localStorage. Suficiente para "un solo
  // dispositivo activo por socio" (no requiere plugin nativo; en iOS el identifierForVendor
  // también se resetea al reinstalar, así que un UUID persistido es equivalente).
  try {
    let id = localStorage.getItem('pidoo_device_id')
    if (!id) {
      id = (globalThis.crypto?.randomUUID?.() || ('dev-' + Math.random().toString(36).slice(2) + '-' + Date.now().toString(36)))
      localStorage.setItem('pidoo_device_id', id)
    }
    _deviceId = id
    return _deviceId
  } catch (_) {
    return null
  }
}

/**
 * Lazy import de un plugin específico. Cachea para no reimportar.
 * Devuelve null si Capacitor no está disponible o el plugin no se importa.
 */
export async function getPlugin(name) {
  // IMPORTANTE: devolvemos { plugin } (NO el proxy directo). Un proxy de plugin
  // Capacitor responde a CUALQUIER propiedad (incluido `.then`) con una función,
  // así que es "thenable": si una función async lo devuelve, o se hace
  // `await proxy`, el motor de promesas intenta asimilarlo y llama a
  // `proxy.then(resolve, reject)` → Capacitor responde "X.then() is not
  // implemented on android" y el await se queda colgado para siempre (y lanza un
  // unhandledrejection que el try/catch del caller no atrapa). Por eso envolvemos
  // el proxy en un objeto plano y el caller hace `(await getPlugin('X'))?.plugin`.
  if (_pluginsCache[name]) return { plugin: _pluginsCache[name] }
  if (!(await isNativePlatform())) return null
  try {
    let mod
    switch (name) {
      case 'PushNotifications':
        mod = await import('@capacitor/push-notifications')
        _pluginsCache[name] = mod.PushNotifications
        break
      case 'Geolocation':
        mod = await import('@capacitor/geolocation')
        _pluginsCache[name] = mod.Geolocation
        break
      case 'StatusBar':
        mod = await import('@capacitor/status-bar')
        _pluginsCache[name] = mod.StatusBar
        break
      case 'App':
        mod = await import('@capacitor/app')
        _pluginsCache[name] = mod.App
        break
      case 'Browser':
        mod = await import('@capacitor/browser')
        _pluginsCache[name] = mod.Browser
        break
      case 'Clipboard':
        mod = await import('@capacitor/clipboard')
        _pluginsCache[name] = mod.Clipboard
        break
      case 'Haptics':
        mod = await import('@capacitor/haptics')
        _pluginsCache[name] = mod.Haptics
        break
      case 'SplashScreen':
        mod = await import('@capacitor/splash-screen')
        _pluginsCache[name] = mod.SplashScreen
        break
      default:
        return null
    }
    return { plugin: _pluginsCache[name] }
  } catch (e) {
    console.warn(`[capacitor] No se pudo cargar plugin ${name}:`, e?.message)
    return null
  }
}

/**
 * Configura status bar overlay + estilo claro al arrancar la app nativa.
 * Llamar desde main.jsx tras montar React.
 */
export async function setupStatusBar() {
  const SB = (await getPlugin('StatusBar'))?.plugin
  if (!SB) return
  try {
    await SB.setOverlaysWebView({ overlay: true })
    // OJO: en Capacitor 'Light' = iconos OSCUROS (para fondos claros) y 'Dark' =
    // iconos claros. El socio tiene fondo claro (#FAFAF7), así que va 'LIGHT' para
    // que la hora/wifi/batería se vean (con 'DARK' salían blancos = invisibles).
    await SB.setStyle({ style: 'LIGHT' })
    await SB.setBackgroundColor({ color: '#FAFAF7' })
  } catch (e) {
    console.warn('[capacitor] StatusBar setup failed:', e?.message)
  }
}

/**
 * Oculta el splash screen tras N ms. Llamar tras login resuelto.
 */
export async function hideSplash() {
  const SS = (await getPlugin('SplashScreen'))?.plugin
  if (!SS) return
  try { await SS.hide({ fadeOutDuration: 200 }) } catch (_) {}
}
