import { useSocio } from '../context/SocioContext'
import { colors, type } from '../lib/uiStyles'

const NAV = [
  { id: 'dashboard',     label: 'Dashboard' },
  { id: 'marketplace',   label: 'Mi marketplace' },
  { id: 'restaurantes',  label: 'Restaurantes' },
  { id: 'pedidos',       label: 'Pedidos' },
  { id: 'facturas',      label: 'Facturas' },
  { id: 'configuracion', label: 'Configuración' },
  { id: 'soporte',       label: 'Soporte' },
]

export default function HeaderNav({ section, setSection }) {
  const { socio, logout } = useSocio()
  return (
    <header style={{
      position: 'sticky', top: 0, zIndex: 20,
      background: colors.surface,
      borderBottom: `1px solid ${colors.border}`,
      boxShadow: colors.shadow,
    }}>
      <div style={{
        maxWidth: 1280, margin: '0 auto',
        padding: '12px 20px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 32, height: 32, borderRadius: 8,
            background: `linear-gradient(135deg, ${colors.primary} 0%, ${colors.primaryDark} 100%)`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#fff', fontWeight: 800, fontSize: 14,
          }}>S</div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 800, color: colors.text, letterSpacing: '-0.2px' }}>Pidoo Socios</div>
            <div style={{ fontSize: 11, color: colors.textMute }}>
              {socio?.nombre_comercial || socio?.nombre || 'Mi cuenta'}
            </div>
          </div>
        </div>

        <nav style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }} className="socio-nav-desktop">
          {NAV.map(n => {
            const active = section === n.id
            return (
              <button key={n.id} onClick={() => setSection(n.id)} style={{
                padding: '8px 12px', borderRadius: 8,
                border: active ? `1px solid ${colors.primaryBorder}` : '1px solid transparent',
                background: active ? colors.primarySoft : 'transparent',
                color: active ? colors.primary : colors.textDim,
                fontSize: type.sm, fontWeight: 600, cursor: 'pointer',
              }}>{n.label}</button>
            )
          })}
        </nav>

        <button onClick={logout} style={{
          padding: '8px 12px', borderRadius: 8,
          border: `1px solid ${colors.border}`, background: colors.surface,
          color: colors.textDim, fontSize: type.xs, fontWeight: 600, cursor: 'pointer',
        }}>Salir</button>
      </div>

      <style>{`
        @media (max-width: 900px) {
          .socio-nav-desktop { display: none !important; }
        }
      `}</style>
    </header>
  )
}

export { NAV }
