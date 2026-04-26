import { colors, type } from '../lib/uiStyles'

const ICONS = {
  pedidos:  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 11H5a2 2 0 00-2 2v7a2 2 0 002 2h14a2 2 0 002-2v-7a2 2 0 00-2-2h-4"/><path d="M9 11V6a3 3 0 116 0v5"/></svg>,
  esperando:<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/></svg>,
  chat:     <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>,
}

const ITEMS = [
  { id: 'rider-pedidos',   label: 'Pedidos',   icon: 'pedidos' },
  { id: 'rider-esperando', label: 'Esperando', icon: 'esperando' },
  { id: 'rider-chat',      label: 'Chat',      icon: 'chat' },
]

export default function BottomNavRider({ section, setSection }) {
  return (
    <nav style={{
      position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 20,
      background: colors.surface,
      borderTop: `1px solid ${colors.border}`,
      display: 'flex',
      padding: '6px 0 calc(6px + env(safe-area-inset-bottom))',
    }}>
      {ITEMS.map(it => {
        const active = section === it.id || (it.id === 'rider-pedidos' && section === 'rider-detalle')
        return (
          <button key={it.id} onClick={() => setSection(it.id)} style={{
            flex: 1, display: 'flex', flexDirection: 'column',
            alignItems: 'center', gap: 4,
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: active ? colors.primary : colors.textMute,
            fontSize: type.xxs, fontWeight: 700,
            padding: '6px 0',
          }}>
            {ICONS[it.icon]}
            {it.label}
          </button>
        )
      })}
    </nav>
  )
}
