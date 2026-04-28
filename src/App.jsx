import { useEffect, useState } from 'react'
import { Capacitor } from '@capacitor/core'
import { Browser } from '@capacitor/browser'
import { Share } from '@capacitor/share'
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
const URL_MARKETPLACE_BASE = 'https://pidoo.es/s/'

function marketplaceConfigCompleta(socio) {
  if (!socio) return false
  // Minimo para compartir: slug (URL) + nombre comercial + logo.
  // La descripcion es opcional aunque recomendable.
  const need = [socio.slug, socio.nombre_comercial, socio.logo_url]
  return need.every(v => typeof v === 'string' && v.trim().length > 0)
}

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
  const [marketplaceModal, setMarketplaceModal] = useState(null)

  // Al montar el shell rider en nativo, pedimos permiso de ubicacion una vez
  // (foreground). Asi el dialogo del sistema sale al entrar al modo rider,
  // sin esperar a que el usuario pulse "Conectarme". Para el background
  // location seguimos esperando a goOnline.
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!Capacitor.isNativePlatform?.()) return
    let cancelled = false
    ;(async () => {
      try {
        const { ensureLocationPermission } = await import('./lib/riderGeo')
        await ensureLocationPermission()
      } catch (_) {}
      if (cancelled) return
    })()
    return () => { cancelled = true }
  }, [])

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
    if (id === 'compartir-marketplace') {
      setDrawerOpen(false)
      if (!marketplaceConfigCompleta(socio)) {
        setMarketplaceModal({ tipo: 'incompleto' })
        return
      }
      const url = URL_MARKETPLACE_BASE + socio.slug
      const nombre = socio.nombre_comercial || 'mi marketplace'
      try {
        const can = await Share.canShare()
        if (can?.value) {
          await Share.share({
            title: nombre + ' · Pidoo',
            text: 'Pide en ' + nombre + ' a través de Pidoo:',
            url,
            dialogTitle: 'Compartir mi marketplace',
          })
          return
        }
      } catch (_) {}
      try { await Browser.open({ url }) } catch {}
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
      {marketplaceModal?.tipo === 'incompleto' && (
        <MarketplaceIncompletoModal
          onAbrirConfig={async () => {
            try { await Browser.open({ url: URL_PANEL_ADMIN_WEB }) } catch {}
            setMarketplaceModal(null)
          }}
          onCerrar={() => setMarketplaceModal(null)}
        />
      )}
    </div>
  )
}

function MarketplaceIncompletoModal({ onAbrirConfig, onCerrar }) {
  return (
    <div onClick={onCerrar} style={{
      position: 'fixed', inset: 0, background: 'rgba(15,15,15,0.55)', zIndex: 60,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: '#FFFFFF', borderRadius: 18, maxWidth: 380, width: '100%',
        padding: 24, boxShadow: '0 20px 50px rgba(0,0,0,0.25)',
      }}>
        <div style={{
          width: 56, height: 56, borderRadius: 28, background: colors.primarySoft,
          color: colors.primary, display: 'flex', alignItems: 'center', justifyContent: 'center',
          marginBottom: 14,
        }}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
        </div>
        <div style={{ fontSize: 18, fontWeight: 800, color: colors.text, marginBottom: 6 }}>
          Termina de configurar tu marketplace
        </div>
        <div style={{ fontSize: 14, color: colors.textMute, lineHeight: 1.45, marginBottom: 18 }}>
          Para compartir tu sitio antes tienes que completar el logo, banner, slug, nombre comercial y descripción.
          Hazlo desde el panel admin en <strong>socio.pidoo.es</strong>. Una vez listo, podrás compartirlo desde aquí.
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={onCerrar} style={{
            flex: 1, height: 46, background: '#F5F5F5', color: colors.text,
            border: '1px solid ' + colors.border, borderRadius: 10, fontWeight: 700,
            fontSize: 14, cursor: 'pointer',
          }}>Cancelar</button>
          <button onClick={onAbrirConfig} style={{
            flex: 1, height: 46, background: colors.primary, color: '#fff',
            border: 'none', borderRadius: 10, fontWeight: 800,
            fontSize: 14, cursor: 'pointer',
          }}>Abrir configuración</button>
        </div>
      </div>
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
    // En APK/IPA siempre Login directo (Landing es solo para socio.pidoo.es web).
    if (isNative) return <Login onBack={null} />
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
