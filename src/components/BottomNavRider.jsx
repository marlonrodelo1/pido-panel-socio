// BottomNavRider — Nav inferior fija con 3 tabs principales: Pedidos, Esperando, Chat.
import { ClipboardList, Compass, MessageCircle } from 'lucide-react'
import { colors } from '../lib/uiStyles'

const TABS = [
  { id: 'esperando', Icon: Compass, label: 'Esperando' },
  { id: 'pedidos',   Icon: ClipboardList, label: 'Pedidos' },
  { id: 'chat',      Icon: MessageCircle, label: 'Chat' },
]

export default function BottomNavRider({ active, onChange, asignacionesActivasCount = 0 }) {
  return (
    <nav style={{
      position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 30,
      background: colors.paper,
      borderTop: `1px solid ${colors.border}`,
      paddingTop: 8, paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 8px)',
      paddingLeft: 8, paddingRight: 8,
      display: 'flex', justifyContent: 'space-around',
      fontFamily: "'Plus Jakarta Sans', sans-serif",
    }}>
      {TABS.map(({ id, Icon, label }) => {
        const isActive = active === id
        const showBadge = id === 'pedidos' && asignacionesActivasCount > 0
        return (
          <button
            key={id}
            onClick={() => onChange(id)}
            style={{
              flex: 1, maxWidth: 96, padding: '6px 8px',
              border: 'none', background: 'transparent',
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
              color: isActive ? colors.terracotta : colors.stone,
              cursor: 'pointer', fontFamily: 'inherit',
              position: 'relative',
            }}
            aria-label={label}
          >
            <Icon size={20} strokeWidth={isActive ? 2.5 : 2} />
            <span style={{ fontSize: 10.5, fontWeight: isActive ? 700 : 600 }}>{label}</span>
            {showBadge && (
              <span style={{
                position: 'absolute', top: 2, right: '32%',
                minWidth: 16, height: 16, padding: '0 4px',
                background: colors.terracotta, color: '#fff',
                borderRadius: 999, fontSize: 9, fontWeight: 800,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>{asignacionesActivasCount}</span>
            )}
          </button>
        )
      })}
    </nav>
  )
}
