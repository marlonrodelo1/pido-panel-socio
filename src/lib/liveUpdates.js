// liveUpdates.js — Actualizaciones OTA (Capgo capacitor-updater).
//
// Qué hace: la app puede recibir versiones nuevas de la CAPA WEB (pantallas, lógica, textos)
// por internet, sin pasar por Google Play / App Store. Con `autoUpdate: true`
// (capacitor.config.ts), Capgo descarga la version nueva en segundo plano y la aplica al
// reabrir la app.
//
// notifyAppReady(): OBLIGATORIO. Confirma que ESTA version arrancó bien. Si no se llama,
// Capgo asume que el bundle esta roto y REVIERTE al anterior tras un timeout (red de
// seguridad anti-brick). Por eso se llama en el arranque, una vez montada la app.
//
// No-op en web (solo aplica en la app nativa).

import { isNativePlatform } from './capacitor'

export async function initLiveUpdates() {
  if (!(await isNativePlatform())) return
  try {
    const { CapacitorUpdater } = await import('@capgo/capacitor-updater')
    await CapacitorUpdater.notifyAppReady()
    console.log('[liveUpdates] notifyAppReady OK (bundle marcado como bueno)')
  } catch (e) {
    console.warn('[liveUpdates] notifyAppReady fallo:', e?.message)
  }
}
