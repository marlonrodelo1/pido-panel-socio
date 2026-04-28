import { useEffect, useState } from 'react'
import { Capacitor } from '@capacitor/core'
import { Browser } from '@capacitor/browser'
import { SocioProvider, useSocio } from './context/SocioContext'
import { RiderProvider, useRider } from './context/RiderContext'
import Login from './pages/Login'
import Landing from './pages/Landing'
import Onboarding from './pages/Onboarding'
import Dashboard from './pages/Dashboard'
import MiMarketplace from './pages/MiMarketplace'
import Restaurantes from './pages/Restaurantes'
import RestauranteDetalle from './pages/RestauranteDetalle'
import Pedidos from './pages/Pedidos'
import Configuracion from './pages/Configuracion'
import EliminarCuenta from './pages/EliminarCuenta'
import Soporte from './pages/Soporte'
import HeaderNav from './components/HeaderNav'
import BottomNav from './components/BottomNav'
import HeaderRider from './components/HeaderRider'
import BottomNavRider from './components/BottomNavRider'
import DrawerRider from './components/DrawerRider'
import ModalPedidoEntrante from './components/ModalPedidoEntrante'
import RiderPedidos from './pages/rider/RiderPedidos'
import RiderEsperando from './pages/rider/RiderEsperando'
import RiderChat from './pages/rider/RiderChat'
import RiderDetalleOrden from './pages/rider/RiderDetalleOrden'
import RiderCompletadas from './pages/rider/RiderCompletadas'
import SeguirPedido from './pages/SeguirPedido'
import { colors } from './lib/uiStyles'

const URL_COMUNIDAD = 'https://www.skool.com/pidoo-comunity-5303/about'
const URL_PANEL_ADMIN_WEB = 'https://socio.pidoo.es'
const URL_SOPORTE_TELEGRAM = 'https://t.me/Royrogo_bot'

const RIDER_TITLES = {
  'rider-pedidos':     'Pedidos',
  'rider-esperando':   'Órdenes en espera',
  'rider-chat':        'Soporte',
  'rider-completadas': 'Órdenes completadas',
  'rider-detalle':     'Detalles de orden',
  'rider-eliminar-cuenta': 'Eliminar cuenta',
}

function ShellAdmin({ section, setSection, detalleEstId, openRestaurante, closeRestaurante }) {
  // Compat: 'facturas' redirige a 'restaurantes' (la pestaña fue eliminada)
  const effectiveSection = section === 'facturas' ? 'restaurantes' : section
  const page = {
    dashboard:            <Dashboard setSection={setSection} openRestaurante={openRestaurante} />,
    marketplace:          <MiMarketplace />,
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
    <div style={{ minHeight: '100vh', background: colors.bg, paddingBottom: 80 }}>
      <HeaderNav section={section} setSection={setSection} />
      <main style={{ maxWidth: 1280, margin: '0 auto', padding: '14px 20px 0' }}>
        {page}
      </main>
      <BottomNav section={section} setSection={setSection} />
    </div>
  )
}

function ShellRider() {
  const { socio } = useSocio()
  const [section, setSection] = useState('rider-pedidos')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [detalleId, setDetalleId] = useState(null)

  const handleNavigate = async (id) => {
    if (id === 'comunidad') {
      try { await Browser.open({ url: URL_COMUNIDAD }) } catch {}
      setDrawerOpen(false)
      return
    }
    if (id === 'panel-admin-web') {
      try { await Browser.open({ url: URL_PANEL_ADMIN_WEB }) } catch {}
      setDrawerOpen(false)
      return
    }
    if (id === 'soporte-telegram') {
      try { await Browser.open({ url: URL_SOPORTE_TELEGRAM }) } catch {}
      setDrawerOpen(false)
      return
    }
    if (id === 'eliminar-cuenta') {
      setDetalleId(null)
      setSection('rider-eliminar-cuenta')
      setDrawerOpen(false)
      return
    }
    setDrawerOpen(false)
    setDetalleId(null)
    setSection(id)
  }

  const openDetalle = (asignacionId) => {
    setDetalleId(asignacionId)
    setSection('rider-detalle')
  }

  const closeDetalle = () => {
    setDetalleId(null)
    setSection('rider-pedidos')
  }

  const page = (() => {
    if (section === 'rider-detalle' && detalleId) {
      return <RiderDetalleOrden asignacionId={detalleId} onBack={closeDetalle} />
    }
    switch (section) {
      case 'rider-pedidos':     return <RiderPedidos onOpenDetalle={openDetalle} />
      case 'rider-esperando':   return <RiderEsperando onGoPedidos={() => setSection('rider-pedidos')} />
      case 'rider-chat':        return <RiderChat />
      case 'rider-completadas': return <RiderCompletadas onBack={() => setSection('rider-pedidos')} />
      case 'rider-eliminar-cuenta': return <EliminarCuenta onBack={() => setSection('rider-pedidos')} />
      default:                  return <RiderPedidos onOpenDetalle={openDetalle} />
    }
  })()

  return (
    <div style={{ minHeight: '100vh', background: colors.bg, paddingBottom: 70 }}>
      <HeaderRider title={RIDER_TITLES[section] || ''} onMenu={() => setDrawerOpen(true)} />
      <main>{page}</main>
      <BottomNavRider section={section} setSection={(s) => { setDetalleId(null); setSection(s) }} />
      <DrawerRider open={drawerOpen} onClose={() => setDrawerOpen(false)} onNavigate={handleNavigate} />
    </div>
  )
}

function Shell() {
  const { session, socio, loading } = useSocio()
  const { pendingNew, accept, reject, dismissPending } = useRider()
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
  // Permite a cualquier componente cambiar de pestana sin pasar setSection por props.
  useEffect(() => {
    const handler = (e) => {
      const target = e?.detail
      if (typeof target === 'string') {
        // Compat: 'facturas' redirige a 'restaurantes'
        setAdminSection(target === 'facturas' ? 'restaurantes' : target)
      } else if (target && typeof target === 'object' && target.section === 'restaurante-detalle' && target.id) {
        openRestaurante(target.id)
      }
    }
    window.addEventListener('pidoo:goto', handler)
    return () => window.removeEventListener('pidoo:goto', handler)
  }, [])
  // En APK/IPA nativa siempre arrancamos en Login (la landing es solo
  // para la web socio.pidoo.es).
  const isNative = typeof window !== 'undefined' && Capacitor.isNativePlatform?.()
  const [vistaPublica, setVistaPublica] = useState(
    isNative ? 'login'
      : (typeof window !== 'undefined' && window.location.pathname.startsWith('/login') ? 'login' : 'landing')
  )
  // En APK/IPA siempre modo rider (sin acceso al admin desde la app).
  // En web (socio.pidoo.es) siempre modo admin.
  const mode = isNative ? 'rider' : 'admin'

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

  // Modal de pedido entrante a nivel global (visible en cualquier modo)
  const modalEntrante = pendingNew ? (
    <ModalPedidoEntrante
      asignacion={pendingNew}
      onAccept={async (id) => { await accept(id) }}
      onReject={async (id, motivo) => { await reject(id, motivo) }}
      onClose={dismissPending}
    />
  ) : null

  if (mode === 'rider') {
    return <>
      <ShellRider />
      {modalEntrante}
    </>
  }
  return <>
    <ShellAdmin
      section={adminSection}
      setSection={setAdminSection}
      detalleEstId={detalleEstId}
      openRestaurante={openRestaurante}
      closeRestaurante={closeRestaurante}
    />
    {modalEntrante}
  </>
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
      <RiderProvider>
        <Shell />
      </RiderProvider>
    </SocioProvider>
  )
}
