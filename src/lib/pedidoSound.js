// pedidoSound — audio del pedido entrante compartido + desbloqueo de autoplay.
//
// iOS (WKWebView) bloquea audio.play() sin un gesto del usuario: el modal de pedido
// entrante aparece SOLO (realtime/push), así que su sonido se quedaba mudo. Truco
// estándar: al primer toque del usuario en la app (cualquiera), reproducimos el audio
// a volumen casi cero y lo pausamos → el elemento queda "desbloqueado" y el modal ya
// puede sonar sin gesto.
//
// 18-jul-2026 (Marlon: "cuando llega el pedido no suena, en Uber hace una bulla"):
//  - Se usaba el fichero CORTO (~7 s) mientras el canal nativo usa el LARGO. Unificado.
//  - Volumen 0.85 → 1.0: esto es un timbre de trabajo, no una notificación cualquiera.
//  - El desbloqueo hacía play() MUTEADO; WebKit NO acepta eso como gesto válido (y
//    además provocaba una carrera: el pause() del unlock llegaba tarde y paraba el
//    sonido del modal). Ahora se reproduce AUDIBLE a 0.01 y se pausa, que es el patrón
//    que iOS sí acepta, y no se toca nunca `muted`.
//
// OJO: el interruptor lateral de silencio del iPhone TAMBIÉN silencia este audio
// (WKWebView usa la sesión de audio ambient). Y en Android sale por el stream de
// MULTIMEDIA, no por el de alarma: por eso el aviso fuerte de verdad lo da el canal
// de notificación nativo (MainActivity, USAGE_ALARM), no esta capa.

let audio = null
let unlocked = false
let installed = false

export function getPedidoAudio() {
  if (!audio) {
    try {
      // El mismo fichero que res/raw/pedido_rider.mp3 (loop largo estilo Glovo).
      audio = new Audio('/sounds/pedido-rider-long.mp3')
      audio.loop = true
      audio.volume = 1.0
      audio.preload = 'auto'
      audio.setAttribute('playsinline', '')
    } catch (_) { audio = null }
  }
  return audio
}

function unlock() {
  if (unlocked) return
  const a = getPedidoAudio()
  if (!a) return
  try {
    const vol = a.volume
    a.volume = 0.01
    const p = a.play()
    if (p && typeof p.then === 'function') {
      p.then(() => {
        a.pause()
        a.currentTime = 0
        a.volume = vol
        unlocked = true
      }).catch(() => { a.volume = vol })
    }
  } catch (_) { try { a.volume = 1.0 } catch (_) {} }
}

export function installPedidoSoundUnlock() {
  if (installed || typeof window === 'undefined') return
  installed = true
  const handler = () => {
    unlock()
    if (unlocked) {
      window.removeEventListener('touchend', handler)
      window.removeEventListener('click', handler)
      window.removeEventListener('pointerdown', handler)
      window.removeEventListener('keydown', handler)
    }
  }
  window.addEventListener('touchend', handler, { passive: true })
  window.addEventListener('click', handler)
  window.addEventListener('pointerdown', handler, { passive: true })
  window.addEventListener('keydown', handler)
}
