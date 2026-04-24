import { useState, useRef, useEffect } from 'react'
import { useSocio } from '../context/SocioContext'
import { colors, type } from '../lib/uiStyles'

const NAV = [
  { id: 'dashboard',     label: 'Dashboard' },
  { id: 'marketplace',   label: 'Mi marketplace' },
  { id: 'restaurantes',  label: 'Restaurantes' },
  { id: 'pedidos',       label: 'Pedidos' },
  { id: 'facturas',      label: 'Facturas' },
  { id: 'servicios',     label: 'Servicios' },
  { id: 'configuracion', label: 'Configuración' },
  { id: 'soporte',       label: 'Soporte' },
]

export default function HeaderNav({ section, setSection }) {
  const { socio, logout, pedidosNuevosSocio, dismissNuevo, dismissAllNuevos } = useSocio()
  const [openBell, setOpenBell] = useState(false)
  const bellRef = useRef(null)
  const count = pedidosNuevosSocio?.length || 0

  useEffect(() => {
    function onClick(e) {
      if (bellRef.current && !bellRef.current.contains(e.target)) setOpenBell(false)
    }
    if (openBell) document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [openBell])

  function onPickPedido(p) {
    dismissNuevo(p.id)
    setOpenBell(false)
    setSection('pedidos')
  }

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

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div ref={bellRef} style={{ position: 'relative' }}>
            <button
              onClick={() => setOpenBell(o => !o)}
              aria-label="Notificaciones"
              style={{
                width: 38, height: 38, borderRadius: 8,
                border: `1px solid ${colors.border}`, background: colors.surface,
                color: colors.textDim, cursor: 'pointer',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                position: 'relative',
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
                <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
              </svg>
              {count > 0 && (
                <span style={{
                  position: 'absolute', top: -4, right: -4,
                  minWidth: 18, height: 18, padding: '0 4px',
                  borderRadius: 9, background: colors.primary, color: '#fff',
                  fontSize: 10, fontWeight: 800,
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  boxShadow: colors.shadow,
                }}>{count > 9 ? '9+' : count}</span>
              )}
            </button>
            {openBell && (
              <div style={{
                position: 'absolute', top: 44, right: 0,
                width: 300, maxWidth: 'calc(100vw - 24px)',
                background: colors.surface, border: `1px solid ${colors.border}`,
                borderRadius: 10, boxShadow: colors.shadowLg,
                overflow: 'hidden', zIndex: 50,
              }}>
                <div style={{
                  padding: '10px 12px', borderBottom: `1px solid ${colors.border}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                }}>
                  <div style={{ fontSize: type.sm, fontWeight: 700, color: colors.text }}>Notificaciones</div>
                  {count > 0 && (
                    <button onClick={dismissAllNuevos} style={{
                      border: 'none', background: 'transparent',
                      fontSize: type.xxs, fontWeight: 600, color: colors.textMute, cursor: 'pointer',
                    }}>Marcar todas</button>
                  )}
                </div>
                <div style={{ maxHeight: 320, overflowY: 'auto' }}>
                  {count === 0 ? (
                    <div style={{ padding: 18, textAlign: 'center', color: colors.textMute, fontSize: type.sm }}>
                      Sin notificaciones
                    </div>
                  ) : (
                    pedidosNuevosSocio.slice(0, 5).map(p => (
                      <button key={p.id} onClick={() => onPickPedido(p)} style={{
                        width: '100%', textAlign: 'left',
                        padding: '10px 12px', border: 'none',
                        background: 'transparent', cursor: 'pointer',
                        borderBottom: `1px solid ${colors.border}`,
                      }}>
                        <div style={{ fontSize: type.sm, fontWeight: 700, color: colors.text }}>
                          Nuevo pedido · {p.codigo || '—'}
                        </div>
                        <div style={{ fontSize: type.xxs, color: colors.textMute, marginTop: 2 }}>
                          Total: {Number(p.total || 0).toFixed(2)} € · {new Date(p.created_at || Date.now()).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>

          <button onClick={logout} style={{
            padding: '8px 12px', borderRadius: 8,
            border: `1px solid ${colors.border}`, background: colors.surface,
            color: colors.textDim, fontSize: type.xs, fontWeight: 600, cursor: 'pointer',
          }}>Salir</button>
        </div>
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
