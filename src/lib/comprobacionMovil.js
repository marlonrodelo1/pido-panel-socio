// comprobacionMovil.js — ¿Está este móvil preparado para recibir pedidos? (v307, 5-oct-2026)
//
// POR QUÉ: a Edinson (Deli Santana, Xiaomi, Android 16) no le sonaban los pedidos con la app
// minimizada. El servidor los mandaba y Google los aceptaba (34 de 34 en 3 días): el fallo
// estaba en su móvil y la app no lo veía. Además, la regla de Marlon es que, En línea y con la
// app minimizada, el móvil siga dando su ubicación: eso exige "Permitir siempre", batería sin
// restricciones y, en Xiaomi/Huawei/Oppo/Vivo..., el "Inicio automático".
//
// Antes de ponerse En línea, la app comprueba todo lo que se puede comprobar de verdad y no
// deja ponerse En línea hasta que esté bien. Lo que no se puede consultar (Inicio automático)
// se le pide confirmar al socio una vez en este móvil.
//
// Solo Android: en iPhone y en la web devuelve [] (nada que comprobar desde aquí).

import { checkPresencePrereqs, openNotificationSettings, openPedidosChannelSettings,
  subirVolumenAlarma, requestBatteryExemption, openAutostartSettings, openAppSettings } from './offlineBeacon'
import { openLocationSettings } from './riderGeo'

export const CLAVE_AUTOSTART_OK = 'pidoo_autostart_ok'

// Importancia HIGH en Android (NotificationManager.IMPORTANCE_HIGH): la que hace que el aviso
// suene y salga como ventana emergente. Por debajo, llega mudo o escondido.
const IMPORTANCIA_ALTA = 4
// El aviso de pedido suena al volumen de ALARMA (canal USAGE_ALARM, MainActivity.java).
const VOLUMEN_MINIMO = 0.4

function autostartConfirmado() {
  try { return window.localStorage.getItem(CLAVE_AUTOSTART_OK) === '1' } catch (_) { return false }
}
export function confirmarAutostart() {
  try { window.localStorage.setItem(CLAVE_AUTOSTART_OK, '1') } catch (_) {}
}

// Convierte la respuesta del nativo en la lista de comprobaciones que se le enseña al socio.
// Una clave que no venga (build nativa vieja) cuenta como bien: nunca se bloquea por no saber.
export function evaluarMovil(pre) {
  if (!pre || typeof pre !== 'object') return []
  const lista = []

  lista.push({
    id: 'notificaciones',
    ok: pre.notificaciones !== false,
    titulo: 'Notificaciones activadas',
    corto: 'notificaciones desactivadas',
    mal: 'Las notificaciones de Pidoo Socio están desactivadas: no te llegará ningún aviso de pedido.',
    boton: 'Activar notificaciones',
    arreglar: openNotificationSettings,
  })

  const imp = typeof pre.canalImportancia === 'number' ? pre.canalImportancia : -1
  lista.push({
    id: 'canal',
    // -1 = el canal todavía no existe (se crea al abrir la app): no hay nada que arreglar.
    ok: imp < 0 || (imp >= IMPORTANCIA_ALTA && pre.canalSonido !== false),
    titulo: 'Aviso de pedidos con sonido',
    corto: 'aviso de pedidos en silencio',
    mal: 'El aviso «Pedidos entrantes» está en silencio o escondido. Ábrelo y activa el sonido y la ventana emergente.',
    boton: 'Activar el sonido',
    arreglar: openPedidosChannelSettings,
  })

  const vol = Number(pre.volumenAlarma)
  const max = Number(pre.volumenAlarmaMax)
  lista.push({
    id: 'volumen',
    ok: !(max > 0) || !Number.isFinite(vol) || vol / max >= VOLUMEN_MINIMO,
    titulo: 'Volumen de alarma alto',
    corto: 'volumen de alarma bajo',
    mal: 'Los pedidos suenan al volumen de ALARMA del móvil y lo tienes muy bajo.',
    boton: 'Subir el volumen',
    arreglar: () => subirVolumenAlarma(0.8),
  })

  lista.push({
    id: 'bateria',
    ok: pre.batteryExempt !== false,
    titulo: 'Batería sin restricciones',
    corto: 'batería con restricciones',
    mal: 'El ahorro de batería puede cerrar la app en segundo plano. Elige «Sin restricciones» para Pidoo Socio.',
    boton: 'Quitar la restricción',
    arreglar: requestBatteryExemption,
  })

  lista.push({
    id: 'ubicacion',
    ok: pre.bgLocation !== false,
    titulo: 'Ubicación «Permitir siempre»',
    corto: 'ubicación sin «Permitir siempre»',
    mal: 'Con la app minimizada necesitamos tu ubicación para darte pedidos. En Permisos → Ubicación, elige «Permitir siempre».',
    boton: 'Abrir permisos',
    // Abre la ficha de la app (BackgroundGeolocation.openSettings); si no está, la de Ajustes.
    arreglar: async () => { try { await openLocationSettings() } catch (_) { await openAppSettings() } },
  })

  if (pre.autostartSospechoso === true) {
    lista.push({
      id: 'autostart',
      ok: autostartConfirmado(),
      confirmable: true,
      titulo: 'Inicio automático activado',
      corto: 'Inicio automático sin confirmar',
      mal: `En los móviles ${pre.fabricante || 'como el tuyo'} hay que activar el «Inicio automático» de Pidoo Socio. Si no, el móvil cierra la app a los pocos minutos de guardarla y no te llegan pedidos.`,
      boton: 'Abrir Inicio automático',
      arreglar: openAutostartSettings,
    })
  }
  return lista
}

// Comprueba el móvil ahora mismo. Devuelve { lista, fallos } ([] en iPhone/web).
export async function comprobarMovil() {
  const pre = await checkPresencePrereqs()
  // En iPhone checkPrereqs devuelve otras claves (sin notificaciones/canal): solo Android.
  if (!pre || pre.notificaciones === undefined) return { lista: [], fallos: [], pre }
  const lista = evaluarMovil(pre)
  return { lista, fallos: lista.filter((c) => !c.ok), pre }
}
