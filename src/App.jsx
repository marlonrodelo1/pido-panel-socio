import { useEffect, useState } from 'react'
import { SocioProvider, useSocio } from './context/SocioContext'
import { supabase } from './lib/supabase'
import { getPlugin } from './lib/capacitor'
import { RiderProvider, useRider } from './context/RiderContext'
import Login from './pages/Login'
import Landing from './pages/Landing'
import Onboarding from './pages/Onboarding'
import Dashboard from './pages/Dashboard'
import Restaurantes from './pages/Restaurantes'
import RestauranteDetalle from './pages/RestauranteDetalle'
import Pedidos from './pages/Pedidos'
import Ganancias from './pages/Ganancias'
import Configuracion from './pages/Configuracion'
import MiSuscripcion from './pages/MiSuscripcion'
import ResetPassword from './pages/ResetPassword'
import MiMarketplace from './pages/MiMarketplace'
import EliminarCuenta from './pages/EliminarCuenta'
import Soporte from './pages/Soporte'
import HeaderNav from './components/HeaderNav'
import BottomNav from './components/BottomNav'
import SeguirPedido from './pages/SeguirPedido'
import HeaderRider from './components/HeaderRider'
import BottomNavRider from './components/BottomNavRider'
import DrawerRider from './components/DrawerRider'
import { ChevronLeft } from 'lucide-react'
import ModalPedidoEntrante from './components/ModalPedidoEntrante'
import OnlineToggleFloat from './components/OnlineToggleFloat'
import RiderEsperando from './pages/rider/RiderEsperando'
import RiderPedidos from './pages/rider/RiderPedidos'
import RiderDetalleOrden from './pages/rider/RiderDetalleOrden'
import RiderChat from './pages/rider/RiderChat'
import RiderCompletadas from './pages/rider/RiderCompletadas'
import { colors } from './lib/uiStyles'

// Detección síncrona: Capacitor expone window.Capacitor en runtime nativo.
// En web (Vite dev o nginx) no existe → false sin flash.
// TEMPORAL: si la URL contiene ?rider=1, fuerza modo rider en web para
// pruebas sin APK. Quitar antes de release final.
function isNativeRuntime() {
  if (typeof window === 'undefined') return false
  try {
    if (new URLSearchParams(window.location.search).get('rider') === '1') return true
    if (localStorage.getItem('pidoo_force_rider') === '1') return true
  } catch (_) {}
  const C = window.Capacitor
  return !!(C && typeof C.isNativePlatform === 'function' && C.isNativePlatform())
}

function ShellAdmin({ section, setSection, detalleEstId, openRestaurante, closeRestaurante }) {
  // Compat: 'facturas' y 'marketplace' redirigen a 'restaurantes' (pestanas eliminadas)
  const effectiveSection = (section === 'facturas') ? 'restaurantes' : section
  const page = {
    dashboard:            <Dashboard setSection={setSection} openRestaurante={openRestaurante} />,
    restaurantes:         <Restaurantes onOpenRestaurante={openRestaurante} />,
    'restaurante-detalle': detalleEstId
      ? <RestauranteDetalle establecimiento_id={detalleEstId} onBack={closeRestaurante} />
      : <Restaurantes onOpenRestaurante={openRestaurante} />,
    pedidos:              <Pedidos />,
    configuracion:        <Configuracion />,
    suscripcion:          <MiSuscripcion />,
    marketplace:          <MiMarketplace />,
    'eliminar-cuenta':    <EliminarCuenta onBack={() => setSection('configuracion')} />,
    soporte:              <Soporte />,
  }[effectiveSection] || <Dashboard setSection={setSection} openRestaurante={openRestaurante} />

  return (
    <div className="socio-shell" style={{ background: colors.bg, minHeight: '100vh' }}>
      <aside className="socio-sidebar">
        <HeaderNav section={section} setSection={setSection} variant="sidebar" />
      </aside>

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
        .socio-shell { display: flex; flex-direction: column; min-height: 100vh; }
        .socio-sidebar { display: none; }
        .socio-topbar { display: block; position: sticky; top: 0; z-index: 30; }
        .socio-main { flex: 1; min-width: 0; }
        .socio-content { max-width: 1280px; margin: 0 auto; padding: 22px 24px calc(env(safe-area-inset-bottom) + 96px); }
        .socio-bottom { position: sticky; bottom: 0; z-index: 30; }

        @media (min-width: 900px) {
          .socio-shell { flex-direction: row; }
          .socio-sidebar {
            display: flex; flex-direction: column;
            width: 240px; min-width: 240px;
            height: 100vh; position: sticky; top: 0;
            background: ${colors.paper};
            border-right: 1px solid ${colors.border};
            overflow-y: auto;
          }
          .socio-topbar { display: none; }
          .socio-main { flex: 1; min-width: 0; min-height: 100vh; }
          .socio-content { padding: 28px 32px 40px; }
          .socio-bottom { display: none; }
        }
      `}</style>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// AdminViewRider — páginas de gestión a pantalla completa dentro
// del shell rider. Cabecera con "Volver" que regresa a la vista rider.
// Reutiliza tal cual los componentes del panel web.
// ─────────────────────────────────────────────────────────────
const ADMIN_TITLES = {
  marketplace:          'Mi marketplace',
  restaurantes:         'Restaurantes',
  'restaurante-detalle':'Restaurante',
  ganancias:            'Ganancias',
  pedidos:              'Historial',
  suscripcion:          'Mi suscripción',
  configuracion:        'Configuración',
  soporte:              'Soporte',
  'eliminar-cuenta':    'Eliminar cuenta',
}

function AdminViewRider({ view, estId, onOpenRestaurante, onCloseRestaurante, onBack }) {
  const page = {
    marketplace:          <MiMarketplace />,
    restaurantes:         <Restaurantes onOpenRestaurante={onOpenRestaurante} />,
    'restaurante-detalle': estId
      ? <RestauranteDetalle establecimiento_id={estId} onBack={onCloseRestaurante} hideBack />
      : <Restaurantes onOpenRestaurante={onOpenRestaurante} />,
    ganancias:            <Ganancias />,
    pedidos:              <Pedidos />,
    suscripcion:          <MiSuscripcion />,
    configuracion:        <Configuracion />,
    soporte:              <Soporte />,
    'eliminar-cuenta':    <EliminarCuenta onBack={onBack} />,
  }[view] || <Configuracion />

  // En restaurante-detalle el "Volver" regresa al listado (no a la vista rider)
  const headerBack = (view === 'restaurante-detalle') ? onCloseRestaurante : onBack

  return (
    <div style={{ background: colors.cream, minHeight: '100vh' }}>
      <header style={{
        position: 'sticky', top: 0, zIndex: 30,
        background: colors.paper,
        borderBottom: `1px solid ${colors.border}`,
        paddingTop: 'calc(env(safe-area-inset-top, 0px) + 10px)',
        paddingLeft: 10, paddingRight: 14, paddingBottom: 10,
        display: 'flex', alignItems: 'center', gap: 8,
        fontFamily: "'Plus Jakarta Sans', sans-serif",
      }}>
        <button
          onClick={headerBack}
          aria-label="Volver"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            height: 38, padding: '0 12px 0 8px', borderRadius: 10, border: 'none',
            background: colors.cream2, color: colors.ink,
            cursor: 'pointer', fontWeight: 700, fontSize: 13, fontFamily: 'inherit',
          }}
        >
          <ChevronLeft size={18} strokeWidth={2.2} />
          Volver
        </button>
        <div style={{
          fontSize: 15, fontWeight: 700, color: colors.ink,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {ADMIN_TITLES[view] || 'Gestión'}
        </div>
      </header>

      <div style={{
        maxWidth: 720, margin: '0 auto',
        padding: '16px 14px calc(env(safe-area-inset-bottom, 0px) + 92px)',
      }}>
        {page}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// ShellRider — la app rider nativa (Capacitor Android)
// ─────────────────────────────────────────────────────────────
function ShellRider() {
  const [tab, setTab] = useState('esperando') // esperando|pedidos|chat|completadas
  const [openDetail, setOpenDetail] = useState(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [adminView, setAdminView] = useState(null) // null = vista rider; si no, sección admin
  const [adminEstId, setAdminEstId] = useState(null)
  const { asignacionesActivas } = useRider() || {}

  const openRestaurante = (id) => {
    if (!id) return
    setAdminEstId(id)
    setAdminView('restaurante-detalle')
  }
  const closeRestaurante = () => {
    setAdminEstId(null)
    setAdminView('restaurantes')
  }

  // Pulsar una pestaña del bottom nav desde cualquier vista vuelve a la
  // vista rider correspondiente (sale de admin y cierra detalle abierto).
  const goRiderTab = (t) => {
    setAdminView(null)
    setAdminEstId(null)
    setOpenDetail(null)
    setTab(t)
  }

  // Botones internos (p. ej. "Ver suscripción" o "Eliminar cuenta" dentro de
  // Configuración) navegan vía evento global 'pidoo:goto'. Sin este listener,
  // en la app rider esos botones no hacían nada (solo ShellAdmin los escuchaba).
  useEffect(() => {
    const handler = (e) => {
      const target = e?.detail
      if (typeof target === 'string') {
        setOpenDetail(null)
        if (target === 'restaurantes') { setAdminEstId(null); setAdminView('restaurantes') }
        else setAdminView(target)
      } else if (target && typeof target === 'object' && target.section === 'restaurante-detalle' && target.id) {
        setOpenDetail(null); setAdminEstId(target.id); setAdminView('restaurante-detalle')
      }
    }
    window.addEventListener('pidoo:goto', handler)
    return () => window.removeEventListener('pidoo:goto', handler)
  }, [])

  // ── Vista admin a pantalla completa (secundaria, desde el drawer) ──
  // La barra inferior sigue visible: tocar una pestaña sale de gestión.
  if (adminView) {
    return (
      <div style={{ background: colors.cream, minHeight: '100vh', paddingBottom: 70 }}>
        <AdminViewRider
          view={adminView}
          estId={adminEstId}
          onOpenRestaurante={openRestaurante}
          onCloseRestaurante={closeRestaurante}
          onBack={() => { setAdminView(null); setAdminEstId(null) }}
        />
        <BottomNavRider
          active={tab}
          onChange={goRiderTab}
          asignacionesActivasCount={asignacionesActivas?.length || 0}
        />
        {/* Estado online visible/accionable también en gestión */}
        <OnlineToggleFloat />
        {/* El modal de pedido entrante sigue activo aunque esté en gestión */}
        <ModalPedidoEntrante />
      </div>
    )
  }

  // Si hay detalle abierto, ocupa toda la pantalla (sin bottom nav)
  if (openDetail) {
    return (
      <div style={{ background: colors.cream, minHeight: '100vh' }}>
        <RiderDetalleOrden pedido={openDetail} onBack={() => setOpenDetail(null)} />
        <OnlineToggleFloat />
        <ModalPedidoEntrante />
      </div>
    )
  }

  return (
    <div style={{ background: colors.cream, minHeight: '100vh', paddingBottom: 70 }}>
      <HeaderRider onOpenDrawer={() => setDrawerOpen(true)} />

      {tab === 'esperando'   && <RiderEsperando onOpenPedido={setOpenDetail} />}
      {tab === 'pedidos'     && <RiderPedidos onOpenPedido={setOpenDetail} />}
      {tab === 'chat'        && <RiderChat />}
      {tab === 'completadas' && <RiderCompletadas />}

      <BottomNavRider
        active={tab}
        onChange={goRiderTab}
        asignacionesActivasCount={asignacionesActivas?.length || 0}
      />

      <DrawerRider
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onNavigate={(key) => {
          setOpenDetail(null)
          if (key === 'restaurantes') { setAdminEstId(null); setAdminView('restaurantes') }
          else setAdminView(key)
        }}
      />

      <ModalPedidoEntrante />
    </div>
  )
}

function Shell() {
  const { session, socio, loading } = useSocio()
  const [adminSection, setAdminSection] = useState('dashboard')
  const [detalleEstId, setDetalleEstId] = useState(null)
  const isNative = isNativeRuntime()

  const openRestaurante = (id) => {
    if (!id) return
    setDetalleEstId(id)
    setAdminSection('restaurante-detalle')
  }
  const closeRestaurante = () => {
    setDetalleEstId(null)
    setAdminSection('restaurantes')
  }

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

  // Deep link de OAuth (Google) en la app nativa: com.pidoo.socio://login?code=...
  // En web no aplica (getPlugin('App') devuelve null); el ?code= lo intercambia
  // detectSessionInUrl del cliente Supabase al volver al origen.
  useEffect(() => {
    let handle, cancel = false
    ;(async () => {
      const CapApp = (await getPlugin('App'))?.plugin
      if (!CapApp || cancel) return
      handle = await CapApp.addListener('appUrlOpen', async ({ url }) => {
        try {
          const Browser = (await getPlugin('Browser'))?.plugin
          try { await Browser?.close() } catch (_) {}
          const parsed = new URL(url)
          const params = new URLSearchParams(
            parsed.hash ? parsed.hash.substring(1) : (parsed.search ? parsed.search.substring(1) : '')
          )
          const code = params.get('code')
          if (code) { await supabase.auth.exchangeCodeForSession(code); return }
          const at = params.get('access_token'), rt = params.get('refresh_token')
          if (at && rt) await supabase.auth.setSession({ access_token: at, refresh_token: rt })
        } catch (err) { console.error('[oauth deeplink]', err) }
      })
    })()
    return () => { cancel = true; try { handle?.remove?.() } catch (_) {} }
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
    // En APK nativa, ir directo a Login (sin landing comercial)
    if (isNative) return <Login onBack={null} />
    if (vistaPublica === 'login') return <Login onBack={irALanding} />
    return <Landing onLogin={irALogin} />
  }
  if (!socio) return <Onboarding />

  // ─── App nativa: shell de rider ───
  if (isNative) {
    return (
      <RiderProvider>
        <ShellRider />
      </RiderProvider>
    )
  }

  // ─── Web: panel admin ───
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
    if (window.location.pathname.startsWith('/reset-password')) {
      return <ResetPassword />
    }
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
