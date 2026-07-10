// pedidoSound — audio del pedido entrante compartido + desbloqueo de autoplay.
//
// iOS (WKWebView) bloquea audio.play() sin un gesto del usuario: el modal de pedido
// entrante aparece SOLO (realtime/push), así que su sonido se quedaba mudo. Truco
// estándar: al primer toque del usuario en la app (cualquiera), reproducimos el audio
// en silencio y lo pausamos → el elemento queda "desbloqueado" y el modal ya puede
// sonar sin gesto. En Android no hace falta (Capacitor permite autoplay) pero no daña.
//
// OJO: el interruptor lateral de silencio del iPhone TAMBIÉN silencia este audio
// (WKWebView usa la sesión de audio ambient). Igual que una llamada silenciada.

let audio = null
let unlocked = false
let installed = false

export function getPedidoAudio() {
  if (!audio) {
    try {
      audio = new Audio('/sounds/pedido-rider.mp3')
      audio.loop = true
      audio.volume = 0.85
    } catch (_) { audio = null }
  }
  return audio
}

function unlock() {
  if (unlocked) return
  const a = getPedidoAudio()
  if (!a) return
  try {
    a.muted = true
    const p = a.play()
    if (p && typeof p.then === 'function') {
      p.then(() => {
        a.pause()
        a.currentTime = 0
        a.muted = false
        unlocked = true
      }).catch(() => { a.muted = false })
    }
  } catch (_) { try { a.muted = false } catch (_) {} }
}

export function installPedidoSoundUnlock() {
  if (installed || typeof window === 'undefined') return
  installed = true
  const handler = () => {
    unlock()
    if (unlocked) {
      window.removeEventListener('touchend', handler)
      window.removeEventListener('click', handler)
    }
  }
  window.addEventListener('touchend', handler, { passive: true })
  window.addEventListener('click', handler)
}
