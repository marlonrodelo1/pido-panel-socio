import { colors, type } from '../lib/uiStyles'

const ICONS = {
  dashboard:     <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="9"/><rect x="14" y="3" width="7" height="5"/><rect x="14" y="12" width="7" height="9"/><rect x="3" y="16" width="7" height="5"/></svg>,
  marketplace:   <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3h18l-2 7H5L3 3z"/><circle cx="9" cy="20" r="1"/><circle cx="17" cy="20" r="1"/></svg>,
  restaurantes:  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 002-2V2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 00-5 5v6c0 1.1.9 2 2 2h3zm0 0v7"/></svg>,
  pedidos:       <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 11H5a2 2 0 00-2 2v7a2 2 0 002 2h14a2 2 0 002-2v-7a2 2 0 00-2-2h-4"/><path d="M9 11V6a3 3 0 116 0v5"/></svg>,
  configuracion: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>,
}

const ITEMS = [
  { id: 'dashboard',     label: 'Inicio' },
  { id: 'marketplace',   label: 'Tienda' },
  { id: 'restaurantes',  label: 'Rest.' },
  { id: 'pedidos',       label: 'Pedidos' },
  { id: 'configuracion', label: 'Ajustes' },
]

export default function BottomNav({ section, setSection }) {
  // 'restaurante-detalle' y 'facturas' resaltan la pestaña 'restaurantes'
  const activeId = (section === 'restaurante-detalle' || section === 'facturas') ? 'restaurantes' : section
  return (
    <>
      <nav className="socio-bottom-nav" style={{
        // El padding-bottom con safe-area lo aplica .app-shell-bottom (App.jsx).
        background: colors.surface,
        borderTop: `1px solid ${colors.border}`,
        display: 'none',
        padding: '6px 0',
      }}>
        {ITEMS.map(it => {
          const active = activeId === it.id
          return (
            <button key={it.id} onClick={() => setSection(it.id)} style={{
              flex: 1, display: 'flex', flexDirection: 'column',
              alignItems: 'center', gap: 4,
              background: 'transparent', border: 'none', cursor: 'pointer',
              color: active ? colors.primary : colors.textMute,
              fontSize: type.xxs, fontWeight: 700,
              padding: '6px 0',
            }}>
              {ICONS[it.id]}
              {it.label}
            </button>
          )
        })}
      </nav>
      <style>{`
        @media (max-width: 900px) {
          .socio-bottom-nav { display: flex !important; }
        }
      `}</style>
    </>
  )
}
