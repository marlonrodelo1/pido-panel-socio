// Header del modo reparto: hamburguesa (drawer) + titulo central + boton de modo

import { colors, type } from '../lib/uiStyles'

export default function HeaderRider({ title, onMenu, onModeSwitch }) {
  return (
    <header style={{
      position: 'sticky', top: 0, zIndex: 15,
      background: colors.surface,
      borderBottom: `1px solid ${colors.border}`,
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      height: 56, padding: '0 14px',
    }}>
      <button onClick={onMenu} style={{
        background: 'transparent', border: 'none', cursor: 'pointer',
        padding: 6, color: colors.text,
      }}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
      </button>
      <div style={{ fontSize: type.base, fontWeight: 700, color: colors.text }}>{title}</div>
      <button onClick={onModeSwitch} title="Cambiar a modo admin" style={{
        background: 'transparent', border: 'none', cursor: 'pointer',
        padding: 6, color: colors.textMute,
      }}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/></svg>
      </button>
    </header>
  )
}
