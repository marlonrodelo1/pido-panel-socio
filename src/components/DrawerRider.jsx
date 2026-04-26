// Drawer lateral del modo reparto: perfil + acciones + Salir de linea

import { colors, type, ds } from '../lib/uiStyles'
import { useSocio } from '../context/SocioContext'
import { useRider } from '../context/RiderContext'

export default function DrawerRider({ open, onClose, onNavigate }) {
  const { socio, logout } = useSocio()
  const { online, goOffline, goOnline } = useRider()

  if (!open) return null

  const initials = (socio?.nombre || socio?.nombre_comercial || '?').split(' ').map(s => s[0]).join('').slice(0, 2).toUpperCase()

  const item = (label, icon, onClick) => (
    <button onClick={onClick} style={{
      width: '100%', display: 'flex', alignItems: 'center', gap: 14,
      padding: '14px 18px', background: 'transparent', border: 'none',
      borderBottom: `1px solid ${colors.border}`,
      fontSize: type.sm, color: colors.text, cursor: 'pointer',
      fontFamily: "'Inter', system-ui, sans-serif",
    }}>
      <span style={{ color: colors.textMute, display: 'inline-flex' }}>{icon}</span>
      {label}
    </button>
  )

  return (
    <>
      <div onClick={onClose} style={{
        position: 'fixed', inset: 0, background: 'rgba(15,15,15,0.45)', zIndex: 40,
      }} />
      <aside style={{
        position: 'fixed', top: 0, left: 0, bottom: 0, width: '85%', maxWidth: 360, zIndex: 50,
        background: colors.surface, display: 'flex', flexDirection: 'column',
      }}>
        <header style={{ padding: '20px 18px 16px', borderBottom: `1px solid ${colors.border}`, display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            width: 48, height: 48, borderRadius: 24,
            background: colors.primarySoft, color: colors.primary,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: type.base, fontWeight: 700,
          }}>{initials}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: type.sm, fontWeight: 700, color: colors.text }}>
              {socio?.nombre || '—'}
            </div>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
              <span style={{
                width: 8, height: 8, borderRadius: 4,
                background: online ? colors.stateOk : colors.textFaint,
              }} />
              <span style={{ fontSize: type.xxs, color: colors.textMute, fontWeight: 600 }}>
                {online ? 'En linea' : 'Fuera de linea'}
              </span>
            </div>
          </div>
        </header>

        <nav style={{ flex: 1 }}>
          {item('Ordenes completadas', <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><path d="M9 12l2 2 4-4"/></svg>, () => onNavigate?.('rider-completadas'))}
          {item('Ajustes', <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>, () => onNavigate?.('rider-ajustes'))}
          {item('Cambiar a modo admin', <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>, () => onNavigate?.('admin'))}
          {item('Cerrar sesion', <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>, () => { onClose?.(); logout() })}
        </nav>

        <div style={{ padding: '14px 18px calc(14px + env(safe-area-inset-bottom))' }}>
          {online ? (
            <button onClick={async () => { await goOffline(); onClose?.() }} style={{
              ...ds.dangerBtn, width: '100%', height: 48, fontSize: type.base,
              background: colors.danger, color: '#fff', border: `1px solid ${colors.danger}`,
            }}>
              Salir de linea
            </button>
          ) : (
            <button onClick={async () => { await goOnline(); onClose?.() }} style={{
              ...ds.primaryBtn, width: '100%', height: 48, fontSize: type.base,
            }}>
              Conectarme
            </button>
          )}
        </div>
      </aside>
    </>
  )
}
