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
// (frescura 12 min / auto-offline 60 min).
//
// v305 (28-sep-2026): en iOS el plugin SÍ existe desde la build que lo registra en el puente
// (PidooBridgeViewController, AppDelegate.swift). Antes NUNCA estuvo registrado: toda llamada
// fallaba con "not implemented" y se tragaba en silencio. Por eso ahora los fallos se apuntan
// una vez por método en push_debug_logs (source 'riderApi.offlineBeacon'): que no vuelva a
// pasar desapercibido.
// Cierre del todo (Android: onTaskRemoved; iOS: applicationWillTerminate): el nativo pone
// Fuera de línea, avisa con una notificación que dice lo que ha pasado de verdad (Fuera de línea
// confirmado, o "no hemos podido desconectarte") y deja una marca que lee consumeClosedFlag() al
// reabrir la app, para NO reanudar el turno solo.

import { registerPlugin } from '@capacitor/core'
import { isNativePlatform } from './capacitor'
import { supabase, FUNCTIONS_URL } from './supabase'
import { riderPresenceToken } from './riderApi'

const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY
const OfflineBeacon = registerPlugin('OfflineBeacon')

// v305: rastro de los fallos del plugin (una vez por método y arranque, para no inundar).
// "not implemented" = el nativo de ese móvil no tiene el método (build vieja con JS nuevo, o
// el plugin sin registrar en iOS como hasta la 305). push_debug_logs admite insert anónimo.
const _fallosApuntados = new Set()
function apuntarFallo(metodo, e) {
  try {
    if (_fallosApuntados.has(metodo)) return
    _fallosApuntados.add(metodo)
    const msg = String(e?.message || e || '')
    console.warn(`[offlineBeacon] ${metodo} falló:`, msg)
    supabase.from('push_debug_logs').insert({
      source: 'riderApi.offlineBeacon',
      level: /not implemented/i.test(msg) ? 'no_implementado' : 'error',
      payload: { metodo, error: msg.slice(0, 300) },
    }).then(() => {}, () => {})
  } catch (_) {}
}

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
  } catch (e) { apuntarFallo('arm', e) }
}

// Refrescar el token guardado (llamar en el latido de primer plano, tras refrescar sesión).
export async function refreshOfflineBeaconToken() {
  if (!(await isNativePlatform())) return
  try {
    const token = await currentToken()
    if (token) await OfflineBeacon.updateToken({ token })
  } catch (e) { apuntarFallo('updateToken', e) }
}

// Desarmar: al desconectarse manualmente o en logout.
export async function disarmOfflineBeacon() {
  if (!(await isNativePlatform())) return
  try { await OfflineBeacon.disarm() } catch (e) { apuntarFallo('disarm', e) }
}

// Abrir ajustes de exención de batería (una vez, al ponerse online la primera vez).
export async function requestBatteryExemption() {
  if (!(await isNativePlatform())) return
  try { await OfflineBeacon.requestBatteryExemption() } catch (e) { apuntarFallo('requestBatteryExemption', e) }
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
// En web el plugin no existe → no-op. En iOS existe desde la 305 (latido en Swift con la
// misma llave cuando llega el ping silencioso; ver AppDelegate.swift).

// Armar al ponerse EN SERVICIO: emite/rota la llave y arranca el servicio.
export async function armPresenceBeat() {
  if (!(await isNativePlatform())) return
  try {
    const res = await riderPresenceToken('emitir')
    const presenceToken = res?.data?.presence_token
    if (!presenceToken) return
    await OfflineBeacon.armPresence({ presenceToken, functionsUrl: FUNCTIONS_URL, anonKey: ANON_KEY })
  } catch (e) { apuntarFallo('armPresence', e) }
}

// Desarmar: desconexión manual, logout, sesión muerta o dispositivo superado.
export async function disarmPresenceBeat() {
  if (!(await isNativePlatform())) return
  try { await OfflineBeacon.disarmPresence() } catch (e) { apuntarFallo('disarmPresence', e) }
}

// Estado de los requisitos del latido de fondo (permiso "siempre" + batería).
// v303: incluye `autostartSospechoso` (Xiaomi/Huawei/Oppo/Vivo... — OEMs que matan el
// proceso salvo que el usuario conceda su "Inicio automático" propietario).
// v305: en iOS devuelve las mismas claves que Android (bgLocation = "Permitir siempre").
// Devuelve null en web o si el plugin no está (build vieja).
export async function checkPresencePrereqs() {
  if (!(await isNativePlatform())) return null
  try { return await OfflineBeacon.checkPrereqs() } catch (e) { apuntarFallo('checkPrereqs', e); return null }
}

// v303: abre la pantalla de "Inicio automático" del fabricante. No es consultable por
// API, así que solo se pide UNA vez (guard en el llamante). Caso Edinson (Xiaomi): el
// sistema mató proceso + latido nativo a la hora de ponerse En línea; sin ese permiso
// ni START_STICKY ni la exención de batería lo salvan.
export async function openAutostartSettings() {
  if (!(await isNativePlatform())) return
  try { await OfflineBeacon.openAutostartSettings() } catch (e) { apuntarFallo('openAutostartSettings', e) }
}

// ─── v307 (5-oct-2026): ARREGLAR DESDE LA COMPROBACIÓN DEL MÓVIL ───
// Ver lib/comprobacionMovil.js. Cada uno abre la pantalla de Ajustes donde se arregla una
// cosa concreta. Devuelven false si el nativo no tiene el método (build vieja / iOS / web).

export async function openNotificationSettings() {
  if (!(await isNativePlatform())) return false
  try { await OfflineBeacon.openNotificationSettings(); return true } catch (e) { apuntarFallo('openNotificationSettings', e); return false }
}

export async function openPedidosChannelSettings() {
  if (!(await isNativePlatform())) return false
  try { await OfflineBeacon.openPedidosChannelSettings(); return true } catch (e) { apuntarFallo('openPedidosChannelSettings', e); return false }
}

// Sube el volumen de ALARMA (el aviso de pedidos suena a ese volumen) al 80 % del máximo.
export async function subirVolumenAlarma(fraccion = 0.8) {
  if (!(await isNativePlatform())) return null
  try { return await OfflineBeacon.subirVolumenAlarma({ fraccion }) } catch (e) { apuntarFallo('subirVolumenAlarma', e); return null }
}

export async function openAppSettings() {
  if (!(await isNativePlatform())) return false
  try { await OfflineBeacon.openAppSettings(); return true } catch (e) { apuntarFallo('openAppSettings', e); return false }
}

// ─── v305 (28-sep-2026): CIERRE DE LA APP DEL TODO ───
//
// Regla de Marlon: el socio solo queda Fuera de línea si pulsa su botón o CIERRA LA APP DEL
// TODO. Al cerrarla estando En línea, el nativo (Android onTaskRemoved / iOS
// applicationWillTerminate) le pone Fuera de línea, le avisa con una notificación y deja una
// marca. Al volver a abrir la app, RiderContext la lee aquí y NO reanuda el turno: tiene que
// pulsar En línea. Si fue el SISTEMA quien mató la app (ahorro de batería, memoria), no hay
// marca y todo sigue como estaba.
//
// Devuelve { cerrada, at, conPedido } o null (web, build sin el método, o error).
// soloLeer:true la mira sin borrarla. RiderContext SIEMPRE la lee así al arrancar y solo la borra
// (llamada sin soloLeer) cuando el Fuera de línea está confirmado en el servidor o al pulsar En
// línea: si se borrase antes y el apagado fallara, el siguiente arranque reanudaría el turno solo.
// Borrarla retira también el aviso de cierre de la bandeja del móvil.
export async function consumeClosedFlag({ soloLeer = false } = {}) {
  if (!(await isNativePlatform())) return null
  try {
    const r = await OfflineBeacon.consumeClosedFlag({ soloLeer })
    return r && typeof r === 'object' ? { cerrada: !!r.cerrada, at: r.at ?? null, conPedido: !!r.conPedido } : null
  } catch (e) {
    apuntarFallo('consumeClosedFlag', e)
    return null
  }
}

// El nativo necesita saber si hay un pedido aceptado sin entregar para que el aviso de cierre
// lo recuerde ("tienes un pedido pendiente de entregar"), aunque en ese instante no haya red.
export async function marcarPedidoEnCurso(enCurso) {
  if (!(await isNativePlatform())) return
  try { await OfflineBeacon.marcarPedidoEnCurso({ enCurso: !!enCurso }) } catch (e) { apuntarFallo('marcarPedidoEnCurso', e) }
}

// ─── v305: COBRO CON EL MÓVIL (Tap to Pay) ───
//
// Lo que el móvil ofrece para cobrar con Tap to Pay. El SDK de Stripe se cuelga en
// discoverReaders si el móvil no vale (NFC apagado, opciones de desarrollador), así que se
// mira antes. Android: { plataforma:'android', tieneNfc, nfcActivado, androidSdk,
// opcionesDesarrollador, depuracionUsb, fabricante, modelo }. iOS: { plataforma:'ios',
// disponible:false } (falta el permiso de Apple). null en web o build sin el método.
export async function tapToPayChecks() {
  if (!(await isNativePlatform())) return null
  try {
    const r = await OfflineBeacon.tapToPayChecks()
    return r && typeof r === 'object' ? r : null
  } catch (e) {
    apuntarFallo('tapToPayChecks', e)
    return null
  }
}

// Abre los ajustes de NFC del móvil (Android; en iOS no hace nada). Devuelve true si la
// llamada llegó al nativo.
export async function openNfcSettings() {
  if (!(await isNativePlatform())) return false
  try { await OfflineBeacon.openNfcSettings(); return true } catch (e) { apuntarFallo('openNfcSettings', e); return false }
}
