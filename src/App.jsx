import { useEffect, useState } from 'react'
import { SocioProvider, useSocio } from './context/SocioContext'
import Login from './pages/Login'
import Landing from './pages/Landing'
import Onboarding from './pages/Onboarding'
import Dashboard from './pages/Dashboard'
import Restaurantes from './pages/Restaurantes'
import RestauranteDetalle from './pages/RestauranteDetalle'
import Pedidos from './pages/Pedidos'
import Configuracion from './pages/Configuracion'
import EliminarCuenta from './pages/EliminarCuenta'
import Soporte from './pages/Soporte'
import HeaderNav from './components/HeaderNav'
import BottomNav from './components/BottomNav'
import SeguirPedido from './pages/SeguirPedido'
import { colors } from './lib/uiStyles'

function ShellAdmin({ section, setSection, detalleEstId, openRestaurante, closeRestaurante }) {
  // Compat: 'facturas' y 'marketplace' redirigen a 'restaurantes' (pestanas eliminadas)
  const effectiveSection = (section === 'facturas' || section === 'marketplace') ? 'restaurantes' : section
  const page = {
    dashboard:            <Dashboard setSection={setSection} openRestaurante={openRestaurante} />,
    restaurantes:         <Restaurantes onOpenRestaurante={openRestaurante} />,
    'restaurante-detalle': detalleEstId
      ? <RestauranteDetalle establecimiento_id={detalleEstId} onBack={closeRestaurante} />
      : <Restaurantes onOpenRestaurante={openRestaurante} />,
    pedidos:              <Pedidos />,
    configuracion:        <Configuracion />,
    'eliminar-cuenta':    <EliminarCuenta onBack={() => setSection('configuracion')} />,
    soporte:              <Soporte />,
  }[effectiveSection] || <Dashboard setSection={setSection} openRestaurante={openRestaurante} />

  return (
    <div className="socio-shell" style={{ background: colors.bg, minHeight: '100vh' }}>
      {/* Sidebar fija desktop */}
      <aside className="socio-sidebar">
        <HeaderNav section={section} setSection={setSection} variant="sidebar" />
      </aside>

      {/* Mobile topbar — logo + campana */}
      <div className="socio-topbar">
        <HeaderNav section={section} setSection={setSection} variant="mobile" />
      </div>

      <main className="socio-main">
        <div className="socio-content">
          {page}
        </div>
      </main>

      <div className="socio-bottom">
        <BottomNav section={section} setSection={setSection} />
      </div>

      <style>{`
        .socio-shell {
          display: flex;
          flex-direction: column;
          min-height: 100vh;
        }
        .socio-sidebar {
          display: none;
        }
        .socio-topbar {
          display: block;
          position: sticky;
          top: 0;
          z-index: 30;
        }
        .socio-main {
          flex: 1;
          min-width: 0;
        }
        .socio-content {
          max-width: 1280px;
          margin: 0 auto;
          padding: 22px 24px calc(env(safe-area-inset-bottom) + 96px);
        }
        .socio-bottom {
          position: sticky;
          bottom: 0;
          z-index: 30;
        }

        @media (min-width: 900px) {
          .socio-shell {
            flex-direction: row;
          }
          .socio-sidebar {
            display: flex;
            flex-direction: column;
            width: 240px;
            min-width: 240px;
            height: 100vh;
            position: sticky;
            top: 0;
            background: ${colors.paper};
            border-right: 1px solid ${colors.border};
            overflow-y: auto;
          }
          .socio-topbar {
            display: none;
          }
          .socio-main {
            flex: 1;
            min-width: 0;
            min-height: 100vh;
          }
          .socio-content {
            padding: 28px 32px 40px;
          }
          .socio-bottom {
            display: none;
          }
        }
      `}</style>
    </div>
  )
}

function Shell() {
  const { session, socio, loading } = useSocio()
  const [adminSection, setAdminSection] = useState('dashboard')
  const [detalleEstId, setDetalleEstId] = useState(null)

  const openRestaurante = (id) => {
    if (!id) return
    setDetalleEstId(id)
    setAdminSection('restaurante-detalle')
  }
  const closeRestaurante = () => {
    setDetalleEstId(null)
    setAdminSection('restaurantes')
  }

  // Listener global para navegacion entre secciones via window event.
  useEffect(() => {
    const handler = (e) => {
      const target = e?.detail
      if (typeof target === 'string') {
        setAdminSection((target === 'facturas' || target === 'marketplace') ? 'restaurantes' : target)
      } else if (target && typeof target === 'object' && target.section === 'restaurante-detalle' && target.id) {
        openRestaurante(target.id)
      }
    }
    window.addEventListener('pidoo:goto', handler)
    return () => window.removeEventListener('pidoo:goto', handler)
  }, [])

  const [vistaPublica, setVistaPublica] = useState(
    typeof window !== 'undefined' && window.location.pathname.startsWith('/login') ? 'login' : 'landing'
  )

  useEffect(() => {
    if (typeof window === 'undefined') return
    const onPop = () => setVistaPublica(window.location.pathname.startsWith('/login') ? 'login' : 'landing')
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const irALogin = () => {
    setVistaPublica('login')
    if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
      window.history.pushState({}, '', '/login')
    }
  }
  const irALanding = () => {
    setVistaPublica('landing')
    if (typeof window !== 'undefined' && window.location.pathname !== '/') {
      window.history.pushState({}, '', '/')
    }
  }

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: colors.bg, color: colors.textMute }}>
        Cargando…
      </div>
    )
  }
  if (!session) {
    if (vistaPublica === 'login') return <Login onBack={irALanding} />
    return <Landing onLogin={irALogin} />
  }
  if (!socio) return <Onboarding />

  return (
    <ShellAdmin
      section={adminSection}
      setSection={setAdminSection}
      detalleEstId={detalleEstId}
      openRestaurante={openRestaurante}
      closeRestaurante={closeRestaurante}
    />
  )
}

export default function App() {
  // Tracking publico /seguir/<codigo> sin auth ni providers
  if (typeof window !== 'undefined') {
    const m = window.location.pathname.match(/^\/seguir\/([^/]+)/)
    if (m) {
      return <SeguirPedido codigo={decodeURIComponent(m[1])} />
    }
  }
  return (
    <SocioProvider>
      <Shell />
    </SocioProvider>
  )
}
