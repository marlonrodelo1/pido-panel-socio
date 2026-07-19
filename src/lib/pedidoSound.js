// pedidoSound — audio del pedido entrante (chime en bucle dentro del modal).
//
// ⚠️ HISTORIA IMPORTANTE (19-jul-2026) — NO REINTRODUCIR EL "DESBLOQUEO" ⚠️
//
// Durante la noche del 18-19 jul se intentó tres veces "pre-desbloquear" el autoplay
// reproduciendo este mismo audio en el primer gesto del usuario:
//   1) muted = true  → play() → pause()
//   2) volume = 0.01 → play() → pause()   ← iOS IGNORA volume (es de solo lectura)
//   3) idem + guard síncrono
// En WKWebView (iPhone) NINGUNA de las dos silencia realmente la reproducción, así que el
// resultado fue que el CHIME DE PEDIDO SONABA al abrir la app y al teclear en el login
// (cada toque disparaba el unlock), sin que hubiera ningún pedido. Confirmado con datos:
// 0 pushes y 0 asignaciones pendientes en el momento en que sonaba.
//
// Modelo actual, deliberadamente simple:
//   - El AVISO REAL de un pedido nuevo es la NOTIFICACIÓN NATIVA (canal Android
//     'pedidos_alarma_v1' con USAGE_ALARM / APNs con pedido_rider.caf). Eso suena SIEMPRE,
//     con la app cerrada, en segundo plano o abierta, y no depende del WebView.
//   - Este audio HTML es solo el refuerzo mientras el modal está en pantalla.
//     ModalPedidoEntrante reintenta play() cada 800 ms y se engancha al primer toque del
//     rider, así que en cuanto interactúa (que es lo que hace al ver el pedido) suena.
//   - Sin pedido en pantalla, este módulo NUNCA reproduce nada. Esa es la garantía.

let audio = null

export function getPedidoAudio() {
  if (!audio) {
    try {
      // Mismo fichero que res/raw/pedido_rider.mp3 (loop largo estilo Glovo).
      audio = new Audio('/sounds/pedido-rider-long.mp3')
      audio.loop = true
      audio.volume = 1.0
      audio.preload = 'auto'
      audio.setAttribute('playsinline', '')
    } catch (_) { audio = null }
  }
  return audio
}

// Se mantiene exportada por compatibilidad con los imports existentes, pero es un NO-OP
// a propósito: cualquier reproducción "preventiva" acaba sonando en iOS. Ver cabecera.
export function installPedidoSoundUnlock() { /* no-op deliberado */ }
