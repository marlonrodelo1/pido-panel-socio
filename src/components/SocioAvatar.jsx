import { useState } from 'react'
import { colors } from '../lib/uiStyles'

/**
 * Avatar del socio reutilizable.
 * - Si hay logo_url y carga bien → muestra <img>.
 * - Si no hay logo o falla la carga → div con la inicial del nombre_comercial sobre color_primario.
 *
 * Props:
 *   logo_url, nombre_comercial, color_primario, size (default 32), radius (default 8)
 */
export default function SocioAvatar({
  logo_url,
  nombre_comercial,
  color_primario,
  size = 32,
  radius = 8,
}) {
  const [imgError, setImgError] = useState(false)
  const hex = (color_primario && /^#([0-9A-Fa-f]{3}){1,2}$/.test(color_primario))
    ? color_primario
    : colors.primary

  const inicial = (nombre_comercial || 'M').trim().charAt(0).toUpperCase()
  const showImg = !!logo_url && !imgError

  if (showImg) {
    return (
      <img
        src={logo_url}
        alt={nombre_comercial || 'Logo'}
        onError={() => setImgError(true)}
        style={{
          width: size, height: size, borderRadius: radius,
          objectFit: 'cover',
          border: `1px solid ${colors.border}`,
          background: colors.surface,
          flexShrink: 0,
        }}
      />
    )
  }

  return (
    <div style={{
      width: size, height: size, borderRadius: radius,
      background: `linear-gradient(135deg, ${hex} 0%, ${shade(hex, -12)} 100%)`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: '#fff', fontWeight: 800, fontSize: Math.round(size * 0.44),
      letterSpacing: '-0.5px',
      flexShrink: 0,
    }}>
      {inicial}
    </div>
  )
}

// Oscurece/aclara un hex en pct (negativo = oscurece). Sin dependencias.
function shade(hex, pct) {
  let h = hex.replace('#', '')
  if (h.length === 3) h = h.split('').map(c => c + c).join('')
  const num = parseInt(h, 16)
  const amt = Math.round(2.55 * pct)
  let r = (num >> 16) + amt
  let g = ((num >> 8) & 0x00ff) + amt
  let b = (num & 0x0000ff) + amt
  r = Math.max(0, Math.min(255, r))
  g = Math.max(0, Math.min(255, g))
  b = Math.max(0, Math.min(255, b))
  return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)
}
