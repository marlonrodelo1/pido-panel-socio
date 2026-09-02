// offlineBeacon.js — Puente JS al plugin nativo OfflineBeacon (solo Android por ahora).
//
// Objetivo (Parte B): cuando el socio CIERRA la app del todo (swipe desde recientes), el
// servicio nativo llama a `rider-offline` al instante -> offline inmediato -> su restaurante
// a solo recogida, sin esperar al gate de frescura (12 min).
//
// Cómo: al ponerse EN SERVICIO guardamos el access_token en almacenamiento nativo (arm). El
// servicio nativo lo usa si detecta el cierre. Refrescamos el token mientras la app vive
// (la sesión Supabase rota cada ~1h). Al desconectarse / logout, disarm.
//
// Nota honesta: es best-effort. Si el token guardado caducó (app mucho tiempo en segundo
// plano) o el OEM mata el proceso sin avisar, el beacon no sale y actúa la red de seguridad
// (frescura 12 min / auto-offline 60 min). En iOS no hay evento de cierre fiable -> allí no
// aplica; se queda solo la red de seguridad.

import { registerPlugin } from '@capacitor/core'
import { isNativePlatform } from './capacitor'
import { supabase, FUNCTIONS_URL } from './supabase'
import { riderPresenceToken } from './riderApi'

const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY
const OfflineBeacon = registerPlugin('OfflineBeacon')

async function currentToken() {
  const { data: { session } } = await supabase.auth.getSession()
  return session?.access_token || null
}

// Armar el beacon al ponerse online. Guarda el token actual + arranca el servicio nativo.
export async function armOfflineBeacon() {
  if (!(await isNativePlatform())) return
  try {
    const token = await currentToken()
    if (!token) return
    await OfflineBeacon.arm({ token, functionsUrl: FUNCTIONS_URL, anonKey: ANON_KEY })
  } catch (_) {}
}

// Refrescar el token guardado (llamar en el latido de primer plano, tras refrescar sesión).
export async function refreshOfflineBeaconToken() {
  if (!(await isNativePlatform())) return
  try {
    const token = await currentToken()
    if (token) await OfflineBeacon.updateToken({ token })
  } catch (_) {}
}

// Desarmar: al desconectarse manualmente o en logout.
export async function disarmOfflineBeacon() {
  if (!(await isNativePlatform())) return
  try { await OfflineBeacon.disarm() } catch (_) {}
}

// Abrir ajustes de exención de batería (una vez, al ponerse online la primera vez).
export async function requestBatteryExemption() {
  if (!(await isNativePlatform())) return
  try { await OfflineBeacon.requestBatteryExemption() } catch (_) {}
}

// ─── v300: LATIDO NATIVO DE PRESENCIA (PresenceBeatService) ───
//
// El latido de JS (timer de RiderContext + callback del watcher) muere cuando Android
// congela el WebView en segundo plano → el socio quedaba "En línea" pero mudo y el
// cliente veía "no hay repartidores" (caso Edinson/Misael, 2-ago). El servicio nativo
// late cada 60s EN JAVA con una LLAVE DE PRESENCIA que no caduca con la sesión.
// Solo se para al pulsar "Salir de línea", al cerrar la app del todo (onTaskRemoved,
// que además manda el offline con la llave — ya no muere por JWT caducado) o al ser
// superado por otro dispositivo (la llave rota → 401 → el servicio se apaga solo).
// En iOS/web el plugin no existe → no-op silencioso (allí sigue el watcher + red de
// seguridad de siempre).

// Armar al ponerse EN SERVICIO: emite/rota la llave y arranca el servicio.
export async function armPresenceBeat() {
  if (!(await isNativePlatform())) return
  try {
    const res = await riderPresenceToken('emitir')
    const presenceToken = res?.data?.presence_token
    if (!presenceToken) return
    await OfflineBeacon.armPresence({ presenceToken, functionsUrl: FUNCTIONS_URL, anonKey: ANON_KEY })
  } catch (_) {}
}

// Desarmar: desconexión manual, logout, sesión muerta o dispositivo superado.
export async function disarmPresenceBeat() {
  if (!(await isNativePlatform())) return
  try { await OfflineBeacon.disarmPresence() } catch (_) {}
}

// Estado de los requisitos del latido de fondo (permiso "siempre" + batería).
// v303: incluye `autostartSospechoso` (Xiaomi/Huawei/Oppo/Vivo... — OEMs que matan el
// proceso salvo que el usuario conceda su "Inicio automático" propietario).
// Devuelve null en web/iOS o si el plugin no está (APK vieja con bundle OTA nuevo).
export async function checkPresencePrereqs() {
  if (!(await isNativePlatform())) return null
  try { return await OfflineBeacon.checkPrereqs() } catch (_) { return null }
}

// v303: abre la pantalla de "Inicio automático" del fabricante. No es consultable por
// API, así que solo se pide UNA vez (guard en el llamante). Caso Edinson (Xiaomi): el
// sistema mató proceso + latido nativo a la hora de ponerse En línea; sin ese permiso
// ni START_STICKY ni la exención de batería lo salvan.
export async function openAutostartSettings() {
  if (!(await isNativePlatform())) return
  try { await OfflineBeacon.openAutostartSettings() } catch (_) {}
}
