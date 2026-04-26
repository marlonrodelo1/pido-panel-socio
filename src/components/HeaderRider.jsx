// Header del modo reparto: hamburguesa + titulo central + toggle online + boton modo

import { colors, type } from '../lib/uiStyles'
import { useRider } from '../context/RiderContext'

export default function HeaderRider({ title, onMenu, onModeSwitch }) {
  const { online, goOnline, goOffline } = useRider()

  return (
    <header style={{
      position: 'sticky', top: 0, zIndex: 15,
      background: colors.surface,
      borderBottom: `1px solid ${colors.border}`,
      display: 'flex', alignItems: 'center', gap: 8,
      padding: 'calc(env(safe-area-inset-top) + 4px) 12px 4px',
      minHeight: 'calc(56px + env(safe-area-inset-top))',
    }}>
      <button onClick={onMenu} style={{
        background: 'transparent', border: 'none', cursor: 'pointer',
        padding: 6, color: colors.text, flexShrink: 0,
      }}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
      </button>

      <div style={{ flex: 1, fontSize: type.base, fontWeight: 700, color: colors.text, textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</div>

      {/* Toggle online directo (visible siempre) */}
      <button
        onClick={() => online ? goOffline() : goOnline()}
        title={online ? 'En linea — pulsa para salir' : 'Fuera de linea — pulsa para conectar'}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          background: online ? colors.stateOkSoft : colors.stateNeutralSoft,
          color: online ? colors.stateOk : colors.textMute,
          border: `1px solid ${online ? colors.stateOk : colors.border}`,
          borderRadius: 999, padding: '5px 10px',
          fontSize: type.xxs, fontWeight: 800, letterSpacing: '0.04em',
          textTransform: 'uppercase', cursor: 'pointer', flexShrink: 0,
        }}>
        <span style={{ width: 8, height: 8, borderRadius: 4, background: online ? colors.stateOk : colors.textFaint }} />
        {online ? 'En línea' : 'Offline'}
      </button>

      <button onClick={onModeSwitch} title="Cambiar a modo admin" style={{
        background: 'transparent', border: 'none', cursor: 'pointer',
        padding: 6, color: colors.textMute, flexShrink: 0,
      }}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/></svg>
      </button>
    </header>
  )
}
