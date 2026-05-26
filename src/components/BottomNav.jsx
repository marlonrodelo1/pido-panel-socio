import { colors, type } from '../lib/uiStyles'

const ICONS = {
  dashboard:     <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12 12 3l9 9"/><path d="M5 10v10h14V10"/></svg>,
  restaurantes:  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 2v7a2 2 0 0 0 2 2h0a2 2 0 0 0 2-2V2"/><path d="M5 12v10"/><path d="M19 2v20"/><path d="M19 12h-5a3 3 0 0 1 3-3V2"/></svg>,
  pedidos:       <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 11H5a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2h-4"/><path d="M9 11V6a3 3 0 1 1 6 0v5"/></svg>,
  configuracion: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h0a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v0a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>,
  soporte:       <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12" y2="17.01"/></svg>,
}

const ITEMS = [
  { id: 'dashboard',     label: 'Inicio' },
  { id: 'restaurantes',  label: 'Rest.' },
  { id: 'pedidos',       label: 'Pedidos' },
  { id: 'configuracion', label: 'Ajustes' },
  { id: 'soporte',       label: 'Ayuda' },
]

export default function BottomNav({ section, setSection }) {
  // 'restaurante-detalle', 'facturas' y 'marketplace' resaltan 'restaurantes'
  let activeId = section
  if (section === 'restaurante-detalle' || section === 'facturas' || section === 'marketplace') activeId = 'restaurantes'
  if (section === 'eliminar-cuenta') activeId = 'configuracion'

  return (
    <nav style={{
      background: colors.paper,
      borderTop: `1px solid ${colors.border}`,
      display: 'flex',
      padding: '6px 0 calc(env(safe-area-inset-bottom) + 6px)',
      boxShadow: '0 -1px 8px rgba(26,24,21,0.05)',
    }}>
      {ITEMS.map(it => {
        const active = activeId === it.id
        return (
          <button key={it.id} onClick={() => setSection(it.id)} style={{
            flex: 1, display: 'flex', flexDirection: 'column',
            alignItems: 'center', gap: 4,
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: active ? colors.terracotta : colors.textMute,
            fontSize: type.xxs, fontWeight: 700,
            padding: '6px 0',
            fontFamily: type.family,
          }}>
            {ICONS[it.id]}
            {it.label}
          </button>
        )
      })}
    </nav>
  )
}
