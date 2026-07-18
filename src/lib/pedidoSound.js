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
let unlocking = false
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
  // Guard SINCRONO: un solo toque dispara pointerdown Y click (y touchend). Como play()
  // es asincrono, sin este guard entraban 2-3 llamadas antes de que `unlocked` pasara a
  // true y el chime sonaba varias veces al abrir la app. (Visto en iPhone, 19-jul-2026.)
  if (unlocked || unlocking) return
  const a = getPedidoAudio()
  if (!a) return
  unlocking = true
  try {
    // MUTED, no volumen bajo: en iOS `audio.volume` es de SOLO LECTURA (WebKit ignora
    // la asignacion), asi que el truco de "reproducir a 0.01" sonaba a TODO VOLUMEN nada
    // mas abrir la app. `muted` si se respeta. Si iOS no acepta el gesto muteado como
    // desbloqueo, no pasa nada: el modal reintenta play() cada 800 ms y al primer toque
    // del rider suena igual.
    a.muted = true
    const p = a.play()
    const restaurar = () => {
      try { a.pause(); a.currentTime = 0; a.muted = false } catch (_) {}
      unlocking = false
    }
    if (p && typeof p.then === 'function') {
      p.then(() => { restaurar(); unlocked = true }).catch(() => { restaurar() })
    } else {
      restaurar()
    }
  } catch (_) {
    try { a.muted = false } catch (_) {}
    unlocking = false
  }
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
