// HeaderRider — Header sticky con toggle online/offline + drawer trigger.
import { Menu, Wifi, WifiOff } from 'lucide-react'
import { useState } from 'react'
import { useRider } from '../context/RiderContext'
import { colors } from '../lib/uiStyles'

export default function HeaderRider({ onOpenDrawer }) {
  const { isOnline, setOnline, socio } = useRider() || {}
  const [busy, setBusy] = useState(false)

  async function toggle() {
    if (busy) return
    setBusy(true)
    try { await setOnline(!isOnline) } finally { setBusy(false) }
  }

  const nombre = socio?.nombre_comercial || socio?.nombre || 'Rider'

  return (
    <header style={{
      position: 'relative', zIndex: 30, flexShrink: 0,
      background: colors.paper,
      borderBottom: `1px solid ${colors.border}`,
      paddingTop: 'calc(env(safe-area-inset-top, 0px) + 10px)',
      paddingLeft: 14, paddingRight: 14, paddingBottom: 10,
      display: 'flex', alignItems: 'center', gap: 12,
      fontFamily: "'Plus Jakarta Sans', sans-serif",
    }}>
      <button
        onClick={onOpenDrawer}
        aria-label="Menú"
        style={{
          width: 38, height: 38, borderRadius: 10, border: 'none',
          background: colors.cream2, color: colors.ink,
          cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        <Menu size={18} strokeWidth={2.2} />
      </button>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, color: colors.stone, fontWeight: 600 }}>Pidoo Socio</div>
        <div style={{
          fontSize: 15, fontWeight: 700, color: colors.ink,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{nombre}</div>
      </div>

      <button
        onClick={toggle}
        disabled={busy}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 7,
          padding: '8px 13px', borderRadius: 999, border: 'none',
          background: isOnline ? colors.sageSoft : colors.cream2,
          color: isOnline ? colors.sage2 : colors.stone,
          fontWeight: 700, fontSize: 12, cursor: busy ? 'wait' : 'pointer',
          opacity: busy ? 0.65 : 1, fontFamily: 'inherit',
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
    </header>
  )
}
