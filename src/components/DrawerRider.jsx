// DrawerRider — Side drawer con foto + nombre + menú + link admin web + logout.
import { X, ExternalLink, LifeBuoy, LogOut, User } from 'lucide-react'
import { useSocio } from '../context/SocioContext'
import { getPlugin } from '../lib/capacitor'
import { colors } from '../lib/uiStyles'

export default function DrawerRider({ open, onClose, onChange }) {
  const { socio, logout } = useSocio() || {}

  if (!open) return null

  async function abrirAdminWeb() {
    const Browser = await getPlugin('Browser')
    const url = 'https://socio.pidoo.es'
    if (Browser) {
      try { await Browser.open({ url }) } catch (_) { window.open(url, '_blank') }
    } else {
      window.open(url, '_blank')
    }
    onClose?.()
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 80,
        background: 'rgba(26,24,21,0.55)',
        animation: 'fadeIn 0.18s ease',
        fontFamily: "'Plus Jakarta Sans', sans-serif",
      }}
    >
      <aside
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'absolute', top: 0, left: 0, bottom: 0,
          width: 'min(82vw, 320px)',
          background: colors.paper,
          paddingTop: 'calc(env(safe-area-inset-top, 0px) + 20px)',
          paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 16px)',
          paddingLeft: 18, paddingRight: 18,
          display: 'flex', flexDirection: 'column', gap: 14,
          animation: 'slideRight 0.22s ease',
          boxShadow: '6px 0 24px rgba(26,24,21,0.18)',
        }}
      >
        <style>{`@keyframes slideRight { from { transform: translateX(-100%); } to { transform: translateX(0); } }`}</style>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 42, height: 42, borderRadius: '50%',
              background: colors.terracottaSoft, color: colors.terracotta,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontWeight: 800, fontSize: 16, overflow: 'hidden',
            }}>
              {socio?.logo_url
                ? <img src={socio.logo_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                : (socio?.nombre_comercial?.[0] || socio?.nombre?.[0] || 'R').toUpperCase()
              }
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: colors.ink }}>
                {socio?.nombre_comercial || socio?.nombre || 'Rider'}
              </div>
              <div style={{ fontSize: 11, color: colors.stone }}>Pidoo Socio</div>
            </div>
          </div>
          <button onClick={onClose} aria-label="Cerrar" style={{
            width: 32, height: 32, borderRadius: 8, border: 'none',
            background: colors.cream2, color: colors.ink, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <X size={16} strokeWidth={2.2} />
          </button>
        </div>

        <div style={{ height: 1, background: colors.border, marginTop: 4 }} />

        <button onClick={() => { onChange?.('chat'); onClose?.() }} style={menuBtnStyle}>
          <LifeBuoy size={16} strokeWidth={2.2} />
          <span>Soporte rider</span>
        </button>

        <button onClick={abrirAdminWeb} style={menuBtnStyle}>
          <User size={16} strokeWidth={2.2} />
          <span>Abrir panel admin</span>
          <ExternalLink size={12} style={{ marginLeft: 'auto', color: colors.stone2 }} />
        </button>

        <div style={{ flex: 1 }} />

        <button
          onClick={async () => { await logout?.(); onClose?.() }}
          style={{ ...menuBtnStyle, color: colors.danger, background: 'transparent' }}
        >
          <LogOut size={16} strokeWidth={2.2} />
          <span>Cerrar sesión</span>
        </button>
      </aside>
    </div>
  )
}

const menuBtnStyle = {
  display: 'flex', alignItems: 'center', gap: 10,
  padding: '11px 12px', borderRadius: 10,
  background: colors.cream2,
  color: colors.ink, fontSize: 14, fontWeight: 600,
  border: 'none', cursor: 'pointer', textAlign: 'left',
  fontFamily: 'inherit', width: '100%',
}
