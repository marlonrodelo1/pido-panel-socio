import { colors } from '../lib/uiStyles'

/* ──────────────────────────────────────────────────────────────────────────
 * Landing pública de socio.pidoo.es — rediseño estilo Glovo (jul 2026).
 * SOLO WEB: en la APK nativa App.jsx va directo a Login (no se muestra esto).
 * Enfoque: "monta tu propio negocio de comida a domicilio".
 * Hero naranja → cartera de restaurantes → cómo funciona → ejemplo de
 * ganancias → tu app/reparto → features → CTA. Plus Jakarta Sans.
 * ────────────────────────────────────────────────────────────────────────── */

const FONT = "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, system-ui, sans-serif"
const ORANGE = '#FF6B2C'
const ORANGE2 = '#E4671F'
const INK = '#1A1815'

const RESTAURANTES = [
  { src: '/logos/come-y-calla.jpg', name: 'Come y Calla' },
  { src: '/logos/maxpizza.webp', name: "Max's Pizza" },
  { src: '/logos/octava-isla.jpeg', name: 'Octava Isla' },
  { src: '/logos/rincon-de-fran.jpg', name: 'Rincón de Fran' },
  { src: '/logos/cafe-bar-australia.png', name: 'Café Bar Australia' },
]

function Icon({ d, size = 22, color = colors.terracotta, sw = 1.9 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  )
}
const ICONS = {
  arrow: 'M5 12h14 M12 5l7 7-7 7',
  check: 'M20 6 9 17l-5-5',
  lock: 'M5 11h14v10H5z M8 11V7a4 4 0 0 1 8 0v4',
  store: 'M3 9l1-5h16l1 5 M4 9v11h16V9 M9 20v-6h6v6',
  cpu: 'M9 3v2 M15 3v2 M9 19v2 M15 19v2 M3 9h2 M3 15h2 M19 9h2 M19 15h2 M6 6h12v12H6z M9 9h6v6H9z',
  mega: 'M3 11v2a1 1 0 0 0 1 1h2l4 4V6L6 10H4a1 1 0 0 0-1 1z M15 8a5 5 0 0 1 0 8',
  wallet: 'M3 7h18v12H3z M3 7l2-3h12l2 3 M16 13h2',
  bike: 'M5.5 21a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z M18.5 21a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z M12 17.5V14l-3-3 4-3 2 3h3',
  bolt: 'M13 2 3 14h7l-1 8 10-12h-7z',
}

function Logo({ size = 34 }) {
  return <img src="/icon.png" alt="Pidoo Socios" width={size} height={size} style={{ display: 'block', borderRadius: size * 0.22 }} />
}

/* ───────────────────────── HEADER pill flotante ───────────────────────── */
function Header({ onLogin }) {
  return (
    <div style={{ position: 'sticky', top: 14, zIndex: 50, padding: '0 16px' }}>
      <header style={{
        maxWidth: 1000, margin: '0 auto',
        background: 'rgba(251,248,242,0.85)',
        backdropFilter: 'blur(14px) saturate(180%)', WebkitBackdropFilter: 'blur(14px) saturate(180%)',
        border: `1px solid ${colors.borderStrong}`, borderRadius: 16,
        boxShadow: '0 10px 34px -14px rgba(26,24,21,0.28)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '9px 12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Logo size={32} />
            <div>
              <div style={{ fontSize: 15, fontWeight: 800, letterSpacing: '-0.02em', lineHeight: 1, color: INK }}>Pidoo Socios</div>
              <div className="pd-sub" style={{ fontSize: 11, color: colors.stone, marginTop: 2 }}>Monta tu negocio de reparto</div>
            </div>
          </div>
          <button onClick={onLogin} style={{
            padding: '0 18px', height: 40, borderRadius: 999,
            background: `linear-gradient(180deg, ${ORANGE} 0%, ${ORANGE2} 100%)`,
            color: '#fff', border: `1px solid ${ORANGE2}`,
            fontSize: 14, fontWeight: 800, cursor: 'pointer', fontFamily: FONT,
            display: 'inline-flex', alignItems: 'center', gap: 7,
            boxShadow: '0 8px 18px -8px rgba(228,103,31,0.5)',
          }}>
            <Icon d={ICONS.lock} size={15} color="#fff" /> Acceder
          </button>
        </div>
      </header>
    </div>
  )
}

/* ───────────────────────── Mockups de teléfono ───────────────────────── */
function Phone({ children, w = 264, style = {} }) {
  return (
    <div style={{ width: w, background: INK, borderRadius: 34, padding: 9, boxShadow: '0 40px 80px -30px rgba(26,24,21,0.55)', flexShrink: 0, ...style }}>
      <div style={{ background: colors.cream, borderRadius: 27, overflow: 'hidden', height: Math.round(w * 1.94), display: 'flex', flexDirection: 'column' }}>
        {children}
      </div>
    </div>
  )
}

/* Teléfono que muestra una CAPTURA REAL de la app (a sangre, tal cual). */
function ScreenshotPhone({ src, w = 232, style = {} }) {
  return (
    <div style={{ width: w, background: INK, borderRadius: 32, padding: 7, boxShadow: '0 40px 80px -30px rgba(26,24,21,0.55)', flexShrink: 0, ...style }}>
      <div style={{ borderRadius: 26, overflow: 'hidden', aspectRatio: '1080 / 2337', background: colors.cream }}>
        <img src={src} alt="Captura real de la app Pidoo Socio" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
      </div>
    </div>
  )
}

/* Capturas REALES tomadas en el móvil del socio DeltaFood (en public/socio/). */
const SHOTS = [
  { src: '/socio/captura-esperando.jpeg', label: 'Recibe pedidos en vivo' },
  { src: '/socio/captura-tienda.jpeg', label: 'Tu marketplace público' },
  { src: '/socio/captura-restaurantes.jpeg', label: 'Tus restaurantes' },
  { src: '/socio/captura-mimarketplace.jpeg', label: 'Tu tienda, tu marca' },
  { src: '/socio/captura-detalle.jpeg', label: 'Cada restaurante' },
  { src: '/socio/captura-login.jpeg', label: 'Entra en segundos' },
]

/* Datos REALES del socio DeltaFood (fotos de portada, logos y avatar bajados de
 * su marketplace real) para recrear las pantallas tal cual en los mockups. */
const DELTA = {
  name: 'deltafood',
  avatar: '/socio/deltafood-avatar.png',
  cerca: [
    { cover: '/socio/cover-dar-kebab.jpg', name: 'Dar Kebab', rating: '5.0', meta: '0,5 km · 25 min', abierto: true },
    { cover: '/socio/cover-cafe-bar-australia.jpg', name: 'Café Bar Australia', rating: '0.0', meta: '4,7 km · 33 min', abierto: false },
  ],
}

/* Campana (para la cabecera del marketplace) */
function Bell({ color }) {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 0 1-3.4 0" />
    </svg>
  )
}

/* Mockup: el marketplace público del socio — recreación del real de DeltaFood */
function MarketplacePhone(props) {
  return (
    <Phone {...props}>
      {/* Cabecera: avatar real + deltafood + campana */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '13px 13px 11px', borderBottom: `1px solid ${colors.border}`, background: colors.paper }}>
        <img src={DELTA.avatar} alt="" style={{ width: 34, height: 34, borderRadius: 999, objectFit: 'cover', flexShrink: 0 }} />
        <div style={{ fontSize: 16, fontWeight: 800, color: INK, letterSpacing: '-0.02em', flex: 1 }}>{DELTA.name}</div>
        <span style={{ width: 30, height: 30, borderRadius: 999, background: colors.cream2, display: 'grid', placeItems: 'center' }}><Bell color={colors.stone} /></span>
      </div>
      <div style={{ padding: '12px 12px 0', display: 'flex', flexDirection: 'column', gap: 9, flex: 1, overflow: 'hidden' }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: INK, letterSpacing: '-0.02em' }}>Ofertas irresistibles</div>
        {/* Banner de oferta GRATIS */}
        <div style={{ background: 'linear-gradient(100deg, #B5241C 0%, #E4671F 100%)', borderRadius: 14, padding: '13px 15px', color: '#fff', position: 'relative', overflow: 'hidden', flexShrink: 0 }}>
          <div style={{ fontSize: 18, fontWeight: 900, fontStyle: 'italic', letterSpacing: '-0.02em' }}>GRATIS</div>
          <div style={{ fontSize: 11.5, fontWeight: 600, marginTop: 2, maxWidth: 150 }}>Papas fritas pequeñas gratis</div>
          <div style={{ position: 'absolute', right: -2, bottom: -8, fontSize: 46 }}>🎁</div>
        </div>
        <div style={{ fontSize: 15, fontWeight: 800, color: INK, letterSpacing: '-0.02em', marginTop: 2 }}>Cerca de ti</div>
        {DELTA.cerca.map((r) => (
          <div key={r.name} style={{ position: 'relative', borderRadius: 14, overflow: 'hidden', height: 108, flexShrink: 0 }}>
            <img src={r.cover} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
            <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(0,0,0,0.05) 35%, rgba(0,0,0,0.74) 100%)' }} />
            <span style={{ position: 'absolute', top: 9, left: 9, fontSize: 9.5, fontWeight: 800, color: '#fff', background: r.abierto ? 'rgba(26,24,21,0.72)' : '#C5352C', borderRadius: 999, padding: '3px 9px', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 6, height: 6, borderRadius: 999, background: r.abierto ? '#4ade80' : '#fff' }} /> {r.abierto ? 'ABIERTO' : 'CERRADO'}
            </span>
            <div style={{ position: 'absolute', left: 11, bottom: 9, color: '#fff' }}>
              <div style={{ fontSize: 16, fontWeight: 800, letterSpacing: '-0.02em' }}>{r.name}</div>
              <div style={{ fontSize: 11, fontWeight: 600, opacity: 0.95, marginTop: 1 }}>★ {r.rating} · {r.meta}</div>
            </div>
          </div>
        ))}
      </div>
    </Phone>
  )
}

/* Interruptor mini (mockup) */
function Toggle({ on = true }) {
  return (
    <span style={{ width: 34, height: 20, borderRadius: 999, background: on ? colors.sage : colors.borderStrong, position: 'relative', flexShrink: 0 }}>
      <span style={{ position: 'absolute', top: 2, left: on ? 16 : 2, width: 16, height: 16, borderRadius: 999, background: '#fff' }} />
    </span>
  )
}

/* Mockup: la app de reparto — pantalla "Esperando pedidos" (real de DeltaFood) */
function RiderAppPhone(props) {
  const fuente = (label) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 0', borderTop: `1px solid ${colors.border}` }}>
      <span style={{ fontSize: 12.5, fontWeight: 800, color: INK, flex: 1 }}>{label}</span>
      <Toggle on />
    </div>
  )
  return (
    <Phone {...props}>
      {/* Cabecera rider */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 12px 10px', borderBottom: `1px solid ${colors.border}` }}>
        <span style={{ fontSize: 17, color: colors.stone, lineHeight: 1 }}>☰</span>
        <div style={{ lineHeight: 1.15 }}>
          <div style={{ fontSize: 9.5, color: colors.stone, fontWeight: 700 }}>Pidoo Socio</div>
          <div style={{ fontSize: 13, fontWeight: 800, color: INK }}>deltafood</div>
        </div>
        <span style={{ marginLeft: 'auto', fontSize: 10, fontWeight: 800, color: colors.sage2, background: colors.sageSoft, borderRadius: 999, padding: '4px 9px', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 6, height: 6, borderRadius: 999, background: colors.sage2 }} /> En línea
        </span>
      </div>
      <div style={{ padding: 11, display: 'flex', flexDirection: 'column', gap: 11, flex: 1 }}>
        {/* Esperando pedidos */}
        <div style={{ background: colors.sageSoft, borderRadius: 14, padding: '15px 12px', textAlign: 'center' }}>
          <span style={{ fontSize: 9.5, fontWeight: 800, color: colors.sage2, background: '#fff', borderRadius: 999, padding: '3px 10px', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 6, height: 6, borderRadius: 999, background: colors.sage2 }} /> En línea
          </span>
          <div style={{ fontSize: 15, fontWeight: 800, color: INK, marginTop: 9, letterSpacing: '-0.02em' }}>Esperando pedidos…</div>
          <div style={{ fontSize: 10.5, color: colors.stone, marginTop: 3 }}>Te avisaremos cuando llegue uno cerca.</div>
        </div>
        {/* Fuentes de pedidos */}
        <div>
          <div style={{ fontSize: 9.5, fontWeight: 800, color: colors.stone, letterSpacing: '0.06em', marginBottom: 3 }}>FUENTES DE PEDIDOS</div>
          {fuente('App y tienda')}
          {fuente('Mi marketplace')}
          {fuente('Pedidos telefónicos')}
        </div>
      </div>
      {/* Bottom nav */}
      <div style={{ display: 'flex', justifyContent: 'space-around', padding: '9px 0', borderTop: `1px solid ${colors.border}`, background: colors.paper }}>
        {[['Esperando', ORANGE2], ['Pedidos', colors.stone], ['Chat', colors.stone]].map(([l, c]) => (
          <span key={l} style={{ fontSize: 10, fontWeight: 800, color: c }}>{l}</span>
        ))}
      </div>
    </Phone>
  )
}

/* Panel de ingresos (mensual) */
function IngresosPanel() {
  const card = { background: colors.cream2, borderRadius: 10, padding: '10px 12px', border: `1px solid ${colors.border}` }
  return (
    <div style={{ background: colors.paper, borderRadius: 18, border: `1px solid ${colors.border}`, boxShadow: '0 20px 60px rgba(26,24,21,0.10)', padding: 18, width: '100%', maxWidth: 340, fontFamily: FONT }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <Logo size={30} />
        <div>
          <div style={{ fontSize: 13, fontWeight: 800, color: INK, lineHeight: 1 }}>Tus ingresos</div>
          <div style={{ fontSize: 11, color: colors.stone, marginTop: 2 }}>Panel del socio</div>
        </div>
      </div>
      <div style={{ ...card, marginBottom: 10 }}>
        <div style={{ fontSize: 9, fontWeight: 800, color: colors.stone, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Este mes</div>
        <div style={{ fontSize: 26, fontWeight: 800, color: INK, marginTop: 4 }}>1.284,50 €</div>
        <div style={{ fontSize: 11, color: colors.stone, marginTop: 2 }}>186 envíos</div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <div style={card}>
          <div style={{ fontSize: 9, fontWeight: 800, color: colors.stone, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Hoy</div>
          <div style={{ fontSize: 17, fontWeight: 800, color: INK, marginTop: 4 }}>48 €</div>
        </div>
        <div style={card}>
          <div style={{ fontSize: 9, fontWeight: 800, color: colors.stone, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Por cobrar</div>
          <div style={{ fontSize: 17, fontWeight: 800, color: ORANGE2, marginTop: 4 }}>312 €</div>
        </div>
      </div>
    </div>
  )
}

/* ───────────────────────── SECCIONES ───────────────────────── */
const wrap = { maxWidth: 1120, margin: '0 auto' }
const h2Style = { fontSize: 'clamp(28px, 4vw, 42px)', fontWeight: 800, letterSpacing: '-0.03em', lineHeight: 1.05, margin: '0 0 12px', color: INK, fontFamily: FONT }
const eyebrow = { fontSize: 12, fontWeight: 800, color: ORANGE2, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 10, fontFamily: FONT }

function Bullet({ children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: 15, color: colors.ink2, lineHeight: 1.5 }}>
      <span style={{ flexShrink: 0, width: 22, height: 22, borderRadius: 999, background: 'rgba(255,107,44,0.14)', color: ORANGE2, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginTop: 1 }}>
        <Icon d={ICONS.check} size={13} color={ORANGE2} sw={3} />
      </span>
      <span>{children}</span>
    </div>
  )
}

/* HERO naranja */
function Hero({ onLogin }) {
  return (
    <section style={{ background: ORANGE, position: 'relative', overflow: 'hidden' }}>
      <style>{heroCss}</style>
      <div className="pd-hero-grid" style={{ ...wrap, padding: '72px 20px 76px', display: 'grid', gridTemplateColumns: '1.05fr 0.95fr', gap: 44, alignItems: 'center' }}>
        <div>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, background: 'rgba(26,24,21,0.10)', color: INK, borderRadius: 999, padding: '7px 14px', fontSize: 12.5, fontWeight: 800, marginBottom: 20 }}>
            <span style={{ width: 6, height: 6, borderRadius: 999, background: INK }} /> Para socios · Tenerife
          </span>
          <h1 className="pd-hero-h1" style={{ fontFamily: FONT, fontWeight: 800, fontSize: 'clamp(38px, 6vw, 68px)', lineHeight: 1.0, letterSpacing: '-0.035em', color: INK, margin: '0 0 18px' }}>
            Monta tu propio negocio de reparto
          </h1>
          <p style={{ fontFamily: FONT, fontSize: 'clamp(16px, 1.9vw, 19px)', fontWeight: 600, color: INK, opacity: 0.88, lineHeight: 1.5, margin: '0 0 28px', maxWidth: 500 }}>
            Crea tu marca de comida a domicilio en Tenerife. Nosotros ponemos los
            restaurantes, la tecnología y el marketing; tú repartes y cobras.
            <b> 0 % de comisión para ti.</b>
          </p>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            <button onClick={onLogin} style={{
              padding: '0 26px', height: 52, borderRadius: 999,
              background: INK, color: '#fff', border: 'none',
              fontSize: 16, fontWeight: 800, cursor: 'pointer', fontFamily: FONT,
              display: 'inline-flex', alignItems: 'center', gap: 8,
              boxShadow: '0 12px 26px -10px rgba(26,24,21,0.5)',
            }}>
              Entrar a la plataforma <Icon d={ICONS.arrow} size={18} color="#fff" sw={2.4} />
            </button>
            <div style={{ fontSize: 13.5, fontWeight: 700, color: INK }}>
              ¿Ya eres socio?{' '}
              <button onClick={onLogin} style={{ background: 'none', border: 'none', color: INK, fontWeight: 800, textDecoration: 'underline', cursor: 'pointer', fontFamily: FONT, fontSize: 13.5, padding: 0 }}>Inicia sesión</button>
            </div>
          </div>
        </div>
        <div className="pd-hero-media" style={{ display: 'flex', justifyContent: 'center' }}>
          <ScreenshotPhone src="/socio/captura-tienda.jpeg" w={264} />
        </div>
      </div>
    </section>
  )
}

/* CARTERA de restaurantes */
function Cartera() {
  return (
    <section style={{ background: colors.cream, padding: '64px 0', borderBottom: `1px solid ${colors.border}` }}>
      <div style={{ ...wrap, padding: '0 20px', textAlign: 'center', marginBottom: 30 }}>
        <div style={eyebrow}>Cartera de restaurantes</div>
        <h2 style={h2Style}>Restaurantes listos para repartir</h2>
        <p style={{ fontSize: 16, color: colors.stone, lineHeight: 1.6, maxWidth: 560, margin: '0 auto' }}>
          Vincúlate con restaurantes reales de Tenerife y empieza a recibir sus pedidos. Cada semana entran más.
        </p>
      </div>
      <div className="pd-marquee">
        <div className="pd-marquee-track">
          {[...RESTAURANTES, ...RESTAURANTES].map((r, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, background: colors.paper, border: `1px solid ${colors.border}`, borderRadius: 16, padding: '12px 18px', boxShadow: colors.shadow, flexShrink: 0 }}>
              <img src={r.src} alt={r.name} loading="lazy" style={{ width: 46, height: 46, borderRadius: 11, objectFit: 'cover' }} />
              <span style={{ fontSize: 15, fontWeight: 800, color: colors.ink2, whiteSpace: 'nowrap' }}>{r.name}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

/* CÓMO FUNCIONA */
const PASOS = [
  { n: '1', t: 'Regístrate y crea tu marca', d: 'Cuenta con email o Google y, en un paso, eliges tu nombre comercial. Tu marketplace pidoo.es/s/tu-marca queda listo.' },
  { n: '2', t: 'Vincula restaurantes', d: 'Solicita vincularte a restaurantes Pidoo o acepta sus propuestas. Con cada uno pactas tu tarifa: base + km.' },
  { n: '3', t: 'Reparte y cobra', d: 'Cada pedido aceptado llega directo a tu app de Pidoo Socio. Tú repartes, el restaurante te paga. Sin intermediarios.' },
]
function ComoFunciona() {
  return (
    <section id="como-funciona" style={{ background: colors.cream, padding: '72px 20px' }}>
      <div style={wrap}>
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <div style={eyebrow}>Cómo funciona</div>
          <h2 style={h2Style}>Tu negocio en tres pasos</h2>
        </div>
        <div className="pd-3col" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 18 }}>
          {PASOS.map((p) => (
            <div key={p.n} style={{ background: colors.paper, borderRadius: 20, padding: 26, border: `1px solid ${colors.border}`, boxShadow: colors.shadow }}>
              <div style={{ width: 46, height: 46, borderRadius: 13, background: `linear-gradient(180deg, ${ORANGE} 0%, ${ORANGE2} 100%)`, color: '#fff', display: 'grid', placeItems: 'center', fontSize: 22, fontWeight: 800, marginBottom: 16 }}>{p.n}</div>
              <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 6, color: INK, letterSpacing: '-0.02em' }}>{p.t}</div>
              <div style={{ fontSize: 14, color: colors.stone, lineHeight: 1.55 }}>{p.d}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

/* EJEMPLO DE GANANCIAS */
function Ganancias() {
  const row = (label, value, strong) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '11px 0', borderBottom: `1px solid ${colors.border}` }}>
      <span style={{ fontSize: 14.5, color: strong ? INK : colors.ink2, fontWeight: strong ? 800 : 600 }}>{label}</span>
      <span style={{ fontSize: 15, fontWeight: 800, color: strong ? ORANGE2 : INK }}>{value}</span>
    </div>
  )
  return (
    <section id="ganancias" style={{ background: colors.surface2, padding: '76px 20px' }}>
      <div style={{ ...wrap }}>
        <div style={{ textAlign: 'center', marginBottom: 44 }}>
          <div style={eyebrow}>Tus ganancias</div>
          <h2 style={h2Style}>Mira lo que ganas por cada reparto</h2>
          <p style={{ fontSize: 16, color: colors.stone, lineHeight: 1.6, maxWidth: 580, margin: '0 auto' }}>
            Tú pactas la tarifa con cada restaurante. Un ejemplo real con tarifa 10 % + envío 3 € + 0,50 €/km adicional.
          </p>
        </div>

        <div className="pd-gan-grid" style={{ display: 'grid', gridTemplateColumns: '1.1fr 0.9fr', gap: 32, alignItems: 'center' }}>
          {/* Desglose */}
          <div style={{ background: colors.paper, border: `1px solid ${colors.border}`, borderRadius: 22, padding: 30, boxShadow: colors.shadowMd }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 800, background: 'rgba(255,107,44,0.12)', color: ORANGE2, borderRadius: 999, padding: '5px 12px' }}>Ejemplo de un pedido</span>
            </div>
            <div style={{ fontSize: 15, color: colors.stone, margin: '10px 0 18px' }}>
              Pedido de <b style={{ color: INK }}>24,00 €</b> · distancia <b style={{ color: INK }}>5 km</b>
            </div>
            {row('Envío base (primeros 3 km)', '3,00 €')}
            {row('+ 0,50 € × 2 km adicionales', '1,00 €')}
            {row('Comisión 10 % del pedido', '2,40 €')}
            {row('Propina íntegra', '2,00 €')}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 16 }}>
              <span style={{ fontSize: 16, fontWeight: 800, color: INK }}>Tu ganancia</span>
              <span style={{ fontSize: 28, fontWeight: 800, color: ORANGE2, letterSpacing: '-0.02em' }}>8,40 €</span>
            </div>
            <div style={{ marginTop: 14, background: colors.sageSoft, color: colors.sage2, borderRadius: 12, padding: '11px 14px', fontSize: 13.5, fontWeight: 700, display: 'flex', gap: 8, alignItems: 'center' }}>
              <Icon d={ICONS.check} size={16} color={colors.sage2} sw={2.6} />
              100 % para ti. Pidoo no te cobra comisión sobre lo tuyo.
            </div>
          </div>

          {/* Panel de ingresos */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 18 }}>
            <IngresosPanel />
            <div style={{ fontSize: 13.5, color: colors.stone, textAlign: 'center', maxWidth: 300 }}>
              Multiplica por decenas de pedidos al día y así se ve tu mes en el panel del socio.
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

/* TU APP / REPARTE — foto de repartidor + mockup app */
function Reparte() {
  return (
    <section style={{ background: colors.cream, padding: '76px 20px' }}>
      <div className="pd-rep-grid" style={{ ...wrap, display: 'grid', gridTemplateColumns: '0.95fr 1.05fr', gap: 44, alignItems: 'center' }}>
        <div className="pd-rep-media" style={{ position: 'relative' }}>
          <div style={{ borderRadius: 26, overflow: 'hidden', boxShadow: '0 40px 80px -34px rgba(26,24,21,0.6)', aspectRatio: '4 / 5', background: INK }}>
            <img src="/rider-pidoo.jpg" alt="Repartidor de Pidoo" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
          </div>
          <div style={{ position: 'absolute', right: -10, bottom: 22 }}>
            <ScreenshotPhone src="/socio/captura-esperando.jpeg" w={208} />
          </div>
        </div>
        <div>
          <div style={eyebrow}>Tu app de reparto</div>
          <h2 style={h2Style}>Todo tu negocio, en tu móvil</h2>
          <p style={{ fontSize: 16.5, color: colors.ink2, lineHeight: 1.6, margin: '0 0 22px', maxWidth: 480 }}>
            Repartes desde la propia app de <b>Pidoo Socio</b> — sin apps de terceros. El pedido llega directo, navegas y entregas. Todo transparente.
          </p>
          <div style={{ display: 'grid', gap: 13 }}>
            <Bullet>Pedidos en tiempo real, directos a tu app</Bullet>
            <Bullet>Tu marketplace público: <b>pidoo.es/s/tu-marca</b></Bullet>
            <Bullet>Facturas legales en PDF a cada restaurante</Bullet>
            <Bullet>Sigues siendo autónomo — tú eres tu propio jefe</Bullet>
          </div>
        </div>
      </div>
    </section>
  )
}

/* GALERÍA — capturas REALES de la app en varios teléfonos (slider) */
function GaleriaApp() {
  return (
    <section id="galeria" style={{ background: colors.surface2, padding: '72px 0 40px' }}>
      <div style={{ ...wrap, padding: '0 20px', textAlign: 'center', marginBottom: 34 }}>
        <div style={eyebrow}>La app por dentro</div>
        <h2 style={h2Style}>Así se ve Pidoo Socio</h2>
        <p style={{ fontSize: 16, color: colors.stone, lineHeight: 1.6, maxWidth: 560, margin: '0 auto' }}>
          Capturas reales de la app: recibes pedidos, gestionas tu tienda y cobras, todo desde el móvil.
        </p>
      </div>
      <div className="pd-slider" style={{ display: 'flex', gap: 22, overflowX: 'auto', padding: '8px 20px 20px', scrollSnapType: 'x mandatory' }}>
        {SHOTS.map((s) => (
          <div key={s.src} style={{ scrollSnapAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, flexShrink: 0 }}>
            <ScreenshotPhone src={s.src} w={232} />
            <span style={{ fontSize: 13.5, fontWeight: 800, color: colors.ink2 }}>{s.label}</span>
          </div>
        ))}
      </div>
      <div style={{ textAlign: 'center', fontSize: 12.5, fontWeight: 700, color: colors.stone, marginTop: 2 }}>‹ desliza para ver todas ›</div>
    </section>
  )
}

/* QUÉ TE DAMOS (features) */
const FEATURES = [
  { icon: ICONS.store, t: 'Restaurantes listos', d: 'Te conectamos con restaurantes reales de Tenerife. Solo tienes que vincularte y empezar.' },
  { icon: ICONS.cpu, t: 'La tecnología, hecha', d: 'App de reparto, marketplace público, tracking en vivo y facturación automática. Todo montado.' },
  { icon: ICONS.mega, t: 'Marketing para captar', d: 'Material de marketing y tu propia URL para atraer clientes a tu marca.' },
  { icon: ICONS.wallet, t: '0 % de comisión para ti', d: 'Lo que cobras es 100 % tuyo: envío íntegro + 10 % + propina. Pidoo no toca tu dinero.' },
]
function Features() {
  return (
    <section style={{ background: colors.cream, padding: '10px 20px 76px' }}>
      <div style={wrap}>
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <div style={eyebrow}>Qué te damos</div>
          <h2 style={h2Style}>Tú pones las ganas; nosotros, el resto</h2>
        </div>
        <div className="pd-4col" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
          {FEATURES.map((f) => (
            <div key={f.t} style={{ background: colors.paper, borderRadius: 18, padding: 22, border: `1px solid ${colors.border}`, boxShadow: colors.shadow }}>
              <div style={{ width: 46, height: 46, borderRadius: 12, background: 'rgba(255,107,44,0.12)', display: 'grid', placeItems: 'center', marginBottom: 14 }}>
                <Icon d={f.icon} size={22} color={ORANGE2} />
              </div>
              <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 6, color: INK }}>{f.t}</div>
              <div style={{ fontSize: 13.5, color: colors.stone, lineHeight: 1.55 }}>{f.d}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

/* CTA FINAL */
function CtaFinal({ onLogin }) {
  return (
    <section style={{ background: colors.cream, padding: '0 20px 72px' }}>
      <div style={{ ...wrap }}>
        <div style={{ background: `linear-gradient(135deg, ${ORANGE} 0%, ${ORANGE2} 100%)`, borderRadius: 28, padding: '56px 28px', textAlign: 'center', color: '#fff', boxShadow: '0 30px 70px -30px rgba(228,103,31,0.55)' }}>
          <h2 style={{ fontSize: 'clamp(28px, 4vw, 44px)', fontWeight: 800, letterSpacing: '-0.03em', lineHeight: 1.05, margin: '0 0 12px' }}>Empieza tu negocio hoy</h2>
          <p style={{ fontSize: 16.5, opacity: 0.95, margin: '0 auto 26px', maxWidth: 500 }}>Regístrate gratis. Sin permanencia. Lo que ganas es 100 % tuyo.</p>
          <button onClick={onLogin} style={{ padding: '0 30px', height: 54, borderRadius: 999, border: 'none', background: INK, color: '#fff', fontSize: 16, fontWeight: 800, cursor: 'pointer', fontFamily: FONT, display: 'inline-flex', alignItems: 'center', gap: 8, boxShadow: '0 12px 26px -10px rgba(26,24,21,0.5)' }}>
            Entrar a la plataforma <Icon d={ICONS.arrow} size={18} color="#fff" sw={2.4} />
          </button>
        </div>
      </div>
    </section>
  )
}

function Footer() {
  return (
    <footer style={{ borderTop: `1px solid ${colors.border}`, padding: '24px 20px', background: colors.paper }}>
      <div style={{ ...wrap, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, fontSize: 12.5, color: colors.stone }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Logo size={22} />
          <span>Pidoo Socios · Tenerife</span>
        </div>
        <div style={{ display: 'flex', gap: 16 }}>
          <a href="https://pidoo.es/terminos" style={{ color: colors.stone, textDecoration: 'none' }}>Términos</a>
          <a href="https://pidoo.es/privacidad" style={{ color: colors.stone, textDecoration: 'none' }}>Privacidad</a>
          <a href="https://pidoo.es" style={{ color: colors.stone, textDecoration: 'none' }}>pidoo.es</a>
        </div>
      </div>
    </footer>
  )
}

/* ───────────────────────── ROOT ───────────────────────── */
export default function Landing({ onLogin }) {
  return (
    <div style={{ minHeight: '100vh', background: colors.cream, color: INK, fontFamily: FONT }}>
      <Header onLogin={onLogin} />
      <Hero onLogin={onLogin} />
      <Cartera />
      <ComoFunciona />
      <Ganancias />
      <Reparte />
      <GaleriaApp />
      <Features />
      <CtaFinal onLogin={onLogin} />
      <Footer />
    </div>
  )
}

const heroCss = `
.pd-marquee { position: relative; width: 100%; overflow: hidden; -webkit-mask-image: linear-gradient(90deg, transparent, #000 6%, #000 94%, transparent); mask-image: linear-gradient(90deg, transparent, #000 6%, #000 94%, transparent); }
.pd-marquee-track { display: flex; gap: 16px; width: max-content; padding: 0 8px; animation: pd-marquee 26s linear infinite; }
.pd-marquee:hover .pd-marquee-track { animation-play-state: paused; }
@keyframes pd-marquee { from { transform: translateX(0); } to { transform: translateX(calc(-50% - 8px)); } }
.pd-slider { scrollbar-width: none; -ms-overflow-style: none; }
.pd-slider::-webkit-scrollbar { display: none; }
@media (prefers-reduced-motion: reduce) { .pd-marquee-track { animation: none; } }
@media (max-width: 900px) {
  .pd-hero-grid { grid-template-columns: 1fr !important; gap: 36px !important; padding: 48px 20px 56px !important; }
  .pd-hero-media { order: -1; }
  .pd-gan-grid, .pd-rep-grid { grid-template-columns: 1fr !important; gap: 30px !important; }
  .pd-rep-media { order: -1; max-width: 420px; margin: 0 auto; width: 100%; }
  .pd-3col { grid-template-columns: 1fr !important; }
  .pd-4col { grid-template-columns: repeat(2, 1fr) !important; }
}
@media (max-width: 560px) {
  .pd-4col { grid-template-columns: 1fr !important; }
  .pd-sub { display: none; }
}
`
