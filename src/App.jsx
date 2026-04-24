import { useEffect, useState } from 'react'
import { SocioProvider, useSocio } from './context/SocioContext'
import Login from './pages/Login'
import Landing from './pages/Landing'
import Onboarding from './pages/Onboarding'
import Dashboard from './pages/Dashboard'
import MiMarketplace from './pages/MiMarketplace'
import Restaurantes from './pages/Restaurantes'
import Pedidos from './pages/Pedidos'
import Facturas from './pages/Facturas'
import Servicios from './pages/Servicios'
import Configuracion from './pages/Configuracion'
import Soporte from './pages/Soporte'
import HeaderNav from './components/HeaderNav'
import BottomNav from './components/BottomNav'
import { colors } from './lib/uiStyles'

function Shell() {
  const { session, socio, loading } = useSocio()
  const [section, setSection] = useState('dashboard')
  const [vistaPublica, setVistaPublica] = useState(
    typeof window !== 'undefined' && window.location.pathname.startsWith('/login')
      ? 'login'
      : 'landing'
  )

  useEffect(() => {
    if (typeof window === 'undefined') return
    const onPop = () => {
      setVistaPublica(window.location.pathname.startsWith('/login') ? 'login' : 'landing')
    }
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
      <div style={{
        minHeight: '100vh', display: 'flex', alignItems: 'center',
        justifyContent: 'center', background: colors.bg, color: colors.textMute,
      }}>
        Cargando…
      </div>
    )
  }

  if (!session) {
    if (vistaPublica === 'login') return <Login onBack={irALanding} />
    return <Landing onLogin={irALogin} />
  }
  if (!socio) return <Onboarding />

  const page = {
    dashboard:     <Dashboard setSection={setSection} />,
    marketplace:   <MiMarketplace />,
    restaurantes:  <Restaurantes />,
    pedidos:       <Pedidos />,
    facturas:      <Facturas />,
    servicios:     <Servicios />,
    configuracion: <Configuracion />,
    soporte:       <Soporte />,
  }[section] || <Dashboard setSection={setSection} />

  return (
    <div style={{ minHeight: '100vh', background: colors.bg, paddingBottom: 80 }}>
      <HeaderNav section={section} setSection={setSection} />
      <main style={{ maxWidth: 1280, margin: '0 auto', padding: '24px 20px' }}>
        {page}
      </main>
      <BottomNav section={section} setSection={setSection} />
    </div>
  )
}

export default function App() {
  return (
    <SocioProvider>
      <Shell />
    </SocioProvider>
  )
}
