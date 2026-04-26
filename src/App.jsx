import { useEffect, useState } from 'react'
import { Capacitor } from '@capacitor/core'
import { SocioProvider, useSocio } from './context/SocioContext'
import { RiderProvider, useRider } from './context/RiderContext'
import Login from './pages/Login'
import Landing from './pages/Landing'
import Onboarding from './pages/Onboarding'
import Dashboard from './pages/Dashboard'
import MiMarketplace from './pages/MiMarketplace'
import Restaurantes from './pages/Restaurantes'
import Pedidos from './pages/Pedidos'
import Facturas from './pages/Facturas'
import Configuracion from './pages/Configuracion'
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
import { colors, type } from './lib/uiStyles'

const MODE_KEY = 'pidoo-socio-mode'

const RIDER_TITLES = {
  'rider-pedidos':     'Pedidos',
  'rider-esperando':   'Órdenes en espera',
  'rider-chat':        'Soporte',
  'rider-completadas': 'Órdenes completadas',
  'rider-detalle':     'Detalles de orden',
}

function ShellAdmin({ section, setSection, switchToRider, riderAvailable }) {
  const page = {
    dashboard:     <Dashboard setSection={setSection} />,
    marketplace:   <MiMarketplace />,
    restaurantes:  <Restaurantes />,
    pedidos:       <Pedidos />,
    facturas:      <Facturas />,
    configuracion: <Configuracion />,
    soporte:       <Soporte />,
  }[section] || <Dashboard setSection={setSection} />

  return (
    <div style={{ minHeight: '100vh', background: colors.bg, paddingBottom: 80 }}>
      <HeaderNav section={section} setSection={setSection} />
      {riderAvailable && (
        <div style={{ maxWidth: 1280, margin: '0 auto', padding: '14px 20px 0' }}>
          <button onClick={switchToRider} style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            background: colors.primary, color: '#fff', border: 'none',
            padding: '8px 14px', borderRadius: 8, fontWeight: 700,
            fontSize: type.xs, cursor: 'pointer',
          }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg>
            Modo reparto
          </button>
        </div>
      )}
      <main style={{ maxWidth: 1280, margin: '0 auto', padding: '14px 20px 0' }}>
        {page}
      </main>
      <BottomNav section={section} setSection={setSection} />
    </div>
  )
}

function ShellRider({ switchToAdmin }) {
  const [section, setSection] = useState('rider-pedidos')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [detalleId, setDetalleId] = useState(null)

  const handleNavigate = (id) => {
    setDrawerOpen(false)
    if (id === 'admin') { switchToAdmin(); return }
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
      default:                  return <RiderPedidos onOpenDetalle={openDetalle} />
    }
  })()

  return (
    <div style={{ minHeight: '100vh', background: colors.bg, paddingBottom: 70 }}>
      <HeaderRider title={RIDER_TITLES[section] || ''} onMenu={() => setDrawerOpen(true)} onModeSwitch={switchToAdmin} />
      <main>{page}</main>
      <BottomNavRider section={section} setSection={(s) => { setDetalleId(null); setSection(s) }} />
      <DrawerRider open={drawerOpen} onClose={() => setDrawerOpen(false)} onNavigate={handleNavigate} />
    </div>
  )
}

function Shell() {
  const { session, socio, loading } = useSocio()
  const { pendingNew, accept, reject, dismissPending, asignaciones } = useRider()
  const [adminSection, setAdminSection] = useState('dashboard')
  // En APK/IPA nativa siempre arrancamos en Login (la landing es solo
  // para la web socio.pidoo.es).
  const isNative = typeof window !== 'undefined' && Capacitor.isNativePlatform?.()
  const [vistaPublica, setVistaPublica] = useState(
    isNative ? 'login'
      : (typeof window !== 'undefined' && window.location.pathname.startsWith('/login') ? 'login' : 'landing')
  )
  const [mode, setMode] = useState(() => {
    if (typeof window === 'undefined') return 'admin'
    return localStorage.getItem(MODE_KEY) || 'admin'
  })
  const [riderAvailable, setRiderAvailable] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    localStorage.setItem(MODE_KEY, mode)
  }, [mode])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const onPop = () => setVistaPublica(window.location.pathname.startsWith('/login') ? 'login' : 'landing')
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  useEffect(() => {
    let cancel = false
    ;(async () => {
      if (!socio?.id) { setRiderAvailable(false); return }
      const { supabase } = await import('./lib/supabase')
      const { data } = await supabase
        .from('rider_accounts')
        .select('id')
        .eq('socio_id', socio.id)
        .eq('estado', 'activa')
        .eq('activa', true)
        .limit(1)
        .maybeSingle()
      if (!cancel) setRiderAvailable(!!data)
    })()
    return () => { cancel = true }
  }, [socio?.id])

  // Auto-switch a modo rider cuando llega asignacion pendiente o hay activa.
  // OJO: estos useEffect deben estar ANTES de cualquier early return (loading,
  // !session, !socio) para no violar las reglas de hooks de React.
  useEffect(() => {
    if (pendingNew && mode !== 'rider' && riderAvailable) {
      setMode('rider')
    }
  }, [pendingNew, mode, riderAvailable])

  const hayActivasNoEntregadas = (asignaciones || []).some((a) => !a.entregado_at)
  useEffect(() => {
    if (hayActivasNoEntregadas && mode !== 'rider' && riderAvailable) {
      setMode('rider')
    }
  }, [hayActivasNoEntregadas, mode, riderAvailable])

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
      onAccept={async (id) => { await accept(id); setMode('rider') }}
      onReject={async (id, motivo) => { await reject(id, motivo) }}
      onClose={dismissPending}
    />
  ) : null

  if (mode === 'rider' && riderAvailable) {
    return <>
      <ShellRider switchToAdmin={() => setMode('admin')} />
      {modalEntrante}
    </>
  }
  return <>
    <ShellAdmin
      section={adminSection}
      setSection={setAdminSection}
      switchToRider={() => setMode('rider')}
      riderAvailable={riderAvailable}
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
