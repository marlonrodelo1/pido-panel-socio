// Helpers para crear iconos de Google Maps:
// - Emoji dentro de circulo coloreado.
// - Imagen redonda (logo de restaurante) con borde.

function emojiToDataUrl(emoji, bg = '#FF6B2C', size = 56) {
  const canvas = document.createElement('canvas')
  canvas.width = size; canvas.height = size
  const ctx = canvas.getContext('2d')
  // Sombra
  ctx.shadowColor = 'rgba(0,0,0,0.3)'
  ctx.shadowBlur = 6
  ctx.shadowOffsetY = 2
  // Circulo
  ctx.beginPath()
  ctx.arc(size / 2, size / 2, size / 2 - 4, 0, 2 * Math.PI)
  ctx.fillStyle = bg
  ctx.fill()
  // Borde blanco
  ctx.shadowColor = 'transparent'
  ctx.lineWidth = 3
  ctx.strokeStyle = '#fff'
  ctx.stroke()
  // Emoji
  ctx.font = `${Math.round(size * 0.55)}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(emoji, size / 2, size / 2 + 2)
  return canvas.toDataURL('image/png')
}

export function emojiIcon(emoji, bg = '#FF6B2C') {
  if (typeof window === 'undefined' || !window.google?.maps) return undefined
  const url = emojiToDataUrl(emoji, bg, 64)
  return {
    url,
    scaledSize: new window.google.maps.Size(40, 40),
    anchor: new window.google.maps.Point(20, 20),
  }
}

// Icono de imagen redonda (logo restaurante) con borde naranja.
// Carga la imagen, la dibuja en canvas circular y devuelve dataURL.
export async function imageRoundIcon(imageUrl, borderColor = '#FF6B2C', size = 64) {
  if (typeof window === 'undefined' || !window.google?.maps) return undefined
  return new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas')
        canvas.width = size; canvas.height = size
        const ctx = canvas.getContext('2d')
        // Sombra
        ctx.shadowColor = 'rgba(0,0,0,0.3)'
        ctx.shadowBlur = 6
        ctx.shadowOffsetY = 2
        // Borde
        ctx.beginPath()
        ctx.arc(size / 2, size / 2, size / 2 - 2, 0, 2 * Math.PI)
        ctx.fillStyle = borderColor
        ctx.fill()
        // Recorte circular para la imagen
        ctx.shadowColor = 'transparent'
        ctx.save()
        ctx.beginPath()
        ctx.arc(size / 2, size / 2, size / 2 - 5, 0, 2 * Math.PI)
        ctx.clip()
        ctx.drawImage(img, 5, 5, size - 10, size - 10)
        ctx.restore()
        const url = canvas.toDataURL('image/png')
        resolve({
          url,
          scaledSize: new window.google.maps.Size(44, 44),
          anchor: new window.google.maps.Point(22, 22),
        })
      } catch (_) {
        resolve(emojiIcon('🍽️', borderColor))
      }
    }
    img.onerror = () => resolve(emojiIcon('🍽️', borderColor))
    img.src = imageUrl
  })
}
