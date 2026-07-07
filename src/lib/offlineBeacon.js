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
