import { useState, useRef, useEffect } from 'react'
import { useSocio } from '../context/SocioContext'
import { colors, type } from '../lib/uiStyles'
import SocioAvatar from './SocioAvatar'

const NAV = [
  { id: 'dashboard',     label: 'Inicio',         icon: 'home' },
  { id: 'restaurantes',  label: 'Restaurantes',   icon: 'utensils' },
  { id: 'marketplace',   label: 'Mi marketplace', icon: 'store' },
  { id: 'pedidos',       label: 'Pedidos',        icon: 'package' },
  { id: 'configuracion', label: 'Configuración',  icon: 'settings' },
]

const NAV_SECONDARY = [
  { id: 'suscripcion',   label: 'Mi suscripción', icon: 'card' },
  { id: 'soporte',       label: 'Soporte',        icon: 'help' },
]

const ICONS = {
  home:     <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12 12 3l9 9"/><path d="M5 10v10h14V10"/></svg>,
  utensils: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 2v7a2 2 0 0 0 2 2h0a2 2 0 0 0 2-2V2"/><path d="M5 12v10"/><path d="M19 2v20"/><path d="M19 12h-5a3 3 0 0 1 3-3V2"/></svg>,
  package:  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 11H5a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2h-4"/><path d="M9 11V6a3 3 0 1 1 6 0v5"/></svg>,
  settings: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h0a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v0a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>,
  help:     <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12" y2="17.01"/></svg>,
  card:     <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>,
  store:    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9 4 4h16l1 5"/><path d="M4 9v11h16V9"/><path d="M9 20v-6h6v6"/></svg>,
  bell:     <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>,
  logout:   <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>,
}

function effectiveSection(section) {
  if (section === 'restaurante-detalle' || section === 'facturas') return 'restaurantes'
  if (section === 'eliminar-cuenta') return 'configuracion'
  return section
}

export default function HeaderNav({ section, setSection, variant = 'sidebar' }) {
  const { socio, logout, pedidosNuevosSocio, dismissNuevo, dismissAllNuevos } = useSocio()
  const [openBell, setOpenBell] = useState(false)
  const bellRef = useRef(null)
  const count = pedidosNuevosSocio?.length || 0
  const active = effectiveSection(section)

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

  const Bell = (
    <div ref={bellRef} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpenBell(o => !o)}
        aria-label="Notificaciones"
        style={{
          width: 36, height: 36, borderRadius: 8,
          border: `1px solid ${colors.border}`, background: colors.paper,
          color: colors.textDim, cursor: 'pointer',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          position: 'relative',
        }}
      >
        {ICONS.bell}
        {count > 0 && (
          <span style={{
            position: 'absolute', top: -4, right: -4,
            minWidth: 18, height: 18, padding: '0 4px',
            borderRadius: 9, background: colors.terracotta, color: '#fff',
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
          background: colors.paper, border: `1px solid ${colors.border}`,
          borderRadius: 12, boxShadow: colors.shadowLg,
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
  )

  // ───────────── Variante mobile ─────────────
  if (variant === 'mobile') {
    return (
      <header style={{
        background: colors.paper,
        borderBottom: `1px solid ${colors.border}`,
        padding: '12px 18px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <SocioAvatar
            logo_url={socio?.logo_url}
            nombre_comercial={socio?.nombre_comercial || socio?.nombre}
            color_primario={socio?.color_primario || colors.terracotta}
            size={34} radius={9}
          />
          <div style={{ minWidth: 0 }}>
            <div style={{
              fontSize: 14, fontWeight: 700, color: colors.text,
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 200,
            }}>
              {socio?.nombre_comercial || socio?.nombre || 'Pidoo Socios'}
            </div>
            <div style={{
              fontSize: 10, color: colors.textMute, fontWeight: 700,
              letterSpacing: '0.08em', textTransform: 'uppercase',
            }}>Socio</div>
          </div>
        </div>
        {Bell}
      </header>
    )
  }

  // ───────────── Variante sidebar (desktop) ─────────────
  return (
    <>
      {/* Marca + identidad */}
      <div style={{
        padding: '22px 18px 18px',
        borderBottom: `1px solid ${colors.border}`,
        display: 'flex', flexDirection: 'column', gap: 14,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <img src="/icon.png" alt="Pidoo" width={34} height={34}
               style={{ borderRadius: 9, display: 'block' }} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: colors.text, letterSpacing: '-0.2px' }}>
              Pidoo Socios
            </div>
            <div style={{ fontSize: 10, fontWeight: 700, color: colors.textMute, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              Panel del repartidor
            </div>
          </div>
        </div>

        {/* Bloque con nombre del socio + bell */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '8px 10px', borderRadius: 10,
          background: colors.surface2, border: `1px solid ${colors.border}`,
        }}>
          <SocioAvatar
            logo_url={socio?.logo_url}
            nombre_comercial={socio?.nombre_comercial || socio?.nombre}
            color_primario={socio?.color_primario || colors.terracotta}
            size={32} radius={8}
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontSize: 13, fontWeight: 700, color: colors.text,
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>
              {socio?.nombre_comercial || socio?.nombre || 'Socio'}
            </div>
            <div style={{ fontSize: 11, color: colors.textMute }}>
              {socio?.email || 'Pidoo'}
            </div>
          </div>
          {Bell}
        </div>
      </div>

      {/* Nav principal */}
      <nav style={{ flex: 1, padding: '16px 12px', display: 'flex', flexDirection: 'column', gap: 2 }}>
        {NAV.map(n => {
          const a = active === n.id
          return (
            <button key={n.id} onClick={() => setSection(n.id)} style={navBtnStyle(a)}>
              <span style={{
                display: 'inline-flex',
                color: a ? colors.terracotta : colors.textMute,
              }}>{ICONS[n.icon]}</span>
              {n.label}
            </button>
          )
        })}

        <div style={{ height: 1, background: colors.border, margin: '14px 6px' }} />

        {NAV_SECONDARY.map(n => {
          const a = active === n.id
          return (
            <button key={n.id} onClick={() => setSection(n.id)} style={navBtnStyle(a)}>
              <span style={{
                display: 'inline-flex',
                color: a ? colors.terracotta : colors.textMute,
              }}>{ICONS[n.icon]}</span>
              {n.label}
            </button>
          )
        })}
      </nav>

      {/* Footer: logout */}
      <div style={{ padding: 14, borderTop: `1px solid ${colors.border}` }}>
        <button onClick={logout} style={{
          width: '100%', padding: '10px 12px', borderRadius: 8,
          border: `1px solid ${colors.border}`, background: colors.paper,
          color: colors.textDim, fontSize: type.sm, fontWeight: 600, cursor: 'pointer',
          fontFamily: type.family,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        }}>
          {ICONS.logout} Cerrar sesión
        </button>
      </div>
    </>
  )
}

function navBtnStyle(active) {
  return {
    padding: '10px 12px', borderRadius: 9, border: 'none',
    background: active ? colors.surface2 : 'transparent',
    color: active ? colors.text : colors.textDim,
    fontSize: type.sm, fontWeight: active ? 700 : 600,
    cursor: 'pointer', fontFamily: type.family,
    display: 'inline-flex', alignItems: 'center', gap: 11,
    textAlign: 'left', width: '100%',
    transition: 'background 0.15s',
  }
}

export { NAV }
