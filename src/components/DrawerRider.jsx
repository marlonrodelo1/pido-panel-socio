// Drawer lateral del modo reparto: logo socio + items + Salir de linea

import { colors, type, ds } from '../lib/uiStyles'
import { useSocio } from '../context/SocioContext'
import { useRider } from '../context/RiderContext'

export default function DrawerRider({ open, onClose, onNavigate }) {
  const { socio, logout } = useSocio()
  const { online, goOffline, goOnline } = useRider()

  if (!open) return null

  const initials = (socio?.nombre || socio?.nombre_comercial || '?').split(' ').map(s => s[0]).join('').slice(0, 2).toUpperCase()

  const item = (label, icon, onClick, opts = {}) => (
    <button onClick={onClick} style={{
      width: '100%', display: 'flex', alignItems: 'center', gap: 14,
      padding: '14px 18px', background: 'transparent', border: 'none',
      borderBottom: `1px solid ${colors.border}`,
      fontSize: type.sm, color: opts.color || colors.text, cursor: 'pointer',
      fontFamily: "'Inter', system-ui, sans-serif",
    }}>
      <span style={{ color: opts.color || colors.textMute, display: 'inline-flex' }}>{icon}</span>
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
        <header style={{ padding: 'calc(env(safe-area-inset-top) + 20px) 18px 16px', borderBottom: `1px solid ${colors.border}`, display: 'flex', alignItems: 'center', gap: 12 }}>
          {socio?.logo_url ? (
            <img
              src={socio.logo_url}
              alt={socio?.nombre_comercial || socio?.nombre || 'logo'}
              style={{
                width: 48, height: 48, borderRadius: 24,
                objectFit: 'cover', display: 'block',
                background: colors.primarySoft,
              }}
            />
          ) : (
            <div style={{
              width: 48, height: 48, borderRadius: 24,
              background: colors.primarySoft, color: colors.primary,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: type.base, fontWeight: 700,
            }}>{initials}</div>
          )}
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
          {item('Órdenes completadas', <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><path d="M9 12l2 2 4-4"/></svg>, () => onNavigate?.('rider-completadas'))}
          {item('Compartir mi marketplace', <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>, () => onNavigate?.('compartir-marketplace'))}
          {item('Comunidad Pidoo', <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>, () => onNavigate?.('comunidad'))}
          {item('Abrir panel admin (web)', <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>, () => onNavigate?.('panel-admin-web'))}
          {item('Soporte (Telegram)', <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.5 4.5L2.5 12l6 2 2 6 4-4 5 4 2-15.5z"/><path d="M8.5 14l9.5-7.5"/></svg>, () => onNavigate?.('soporte-telegram'))}
          {item('Eliminar cuenta', <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/></svg>, () => onNavigate?.('eliminar-cuenta'), { color: colors.danger })}
          {item('Cerrar sesión', <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>, () => { onClose?.(); logout() })}
        </nav>

        <div style={{ padding: '14px 18px calc(14px + env(safe-area-inset-bottom))' }}>
          {online ? (
            <button onClick={() => goOffline()} style={{
              ...ds.dangerBtn, width: '100%', height: 48, fontSize: type.base,
              background: colors.danger, color: '#fff', border: `1px solid ${colors.danger}`,
            }}>
              Salir de línea
            </button>
          ) : (
            <button onClick={() => goOnline()} style={{
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
