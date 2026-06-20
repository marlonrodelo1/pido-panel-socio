// OnlineToggleFloat — Toggle online/offline flotante para las pantallas que NO
// muestran HeaderRider (vista de gestión admin y detalle de pedido a pantalla
// completa). Misma lógica y estilo que el toggle de HeaderRider, pero fixed
// arriba a la derecha para que el estado en línea esté SIEMPRE visible y sea
// accionable desde cualquier pantalla de la app rider.
import { useState } from 'react'
import { useRider } from '../context/RiderContext'
import { colors } from '../lib/uiStyles'

export default function OnlineToggleFloat() {
  const rider = useRider()
  const [busy, setBusy] = useState(false)
  if (!rider) return null
  const { isOnline, setOnline } = rider

  async function toggle() {
    if (busy) return
    setBusy(true)
    try { await setOnline(!isOnline) } finally { setBusy(false) }
  }

  return (
    <button
      onClick={toggle}
      disabled={busy}
      aria-label={isOnline ? 'En línea' : 'Offline'}
      style={{
        position: 'fixed',
        top: 'calc(env(safe-area-inset-top, 0px) + 12px)',
        right: 12,
        zIndex: 60,
        display: 'inline-flex', alignItems: 'center', gap: 7,
        padding: '8px 13px', borderRadius: 999, border: 'none',
        background: isOnline ? colors.sageSoft : colors.cream2,
        color: isOnline ? colors.sage2 : colors.stone,
        fontWeight: 700, fontSize: 12, cursor: busy ? 'wait' : 'pointer',
        opacity: busy ? 0.65 : 1,
        fontFamily: "'Plus Jakarta Sans', sans-serif",
        boxShadow: '0 2px 8px rgba(26,24,21,0.12)',
        transition: 'background .15s',
      }}
    >
      <span style={{
        width: 8, height: 8, borderRadius: '50%',
        background: isOnline ? colors.sage : colors.stone2,
        boxShadow: isOnline ? '0 0 0 3px rgba(139,157,122,0.30)' : 'none',
      }} />
      {isOnline ? 'En línea' : 'Offline'}
    </button>
  )
}
