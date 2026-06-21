import { colors, type } from '../lib/uiStyles'

const FONT = "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, system-ui, sans-serif"

function Icon({ d, size = 22, color = colors.terracotta }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  )
}

const ICONS = {
  truck: 'M1 3h15v13H1z M16 8h4l3 3v5h-7z M5.5 21a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z M18.5 21a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  utensils: 'M4 3v7a2 2 0 0 0 2 2h0a2 2 0 0 0 2-2V3 M6 12v9 M18 3c-2 0-4 2-4 5v5h4v7',
  box: 'M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z M3.27 6.96 12 12.01l8.73-5.05 M12 22.08V12',
  chart: 'M3 3v18h18 M7 14l4-4 4 4 6-6',
  receipt: 'M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z M8 7h8 M8 11h8 M8 15h5',
  shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
  arrow: 'M5 12h14 M12 5l7 7-7 7',
  check: 'M20 6 9 17l-5-5',
  lock: 'M5 11h14v10H5z M8 11V7a4 4 0 0 1 8 0v4',
}

const features = [
  {
    icon: ICONS.utensils,
    title: 'Vincúlate con restaurantes Pidoo',
    text: 'Solicita vinculación o acepta propuestas. Cada restaurante pacta contigo la tarifa que cobras: base + km + adicionales.',
  },
  {
    icon: ICONS.box,
    title: 'Recibe pedidos en tiempo real',
    text: 'Cuando el restaurante acepta un pedido, Pidoo te lo asigna directo en la app. Notificaciones al instante y tracking en directo.',
  },
  {
    icon: ICONS.chart,
    title: 'Ingresos claros, sin sorpresas',
    text: 'Lo que ganas por cada envío: coste de envío íntegro + propina íntegra. Pidoo no toca tu dinero ni te cobra comisión.',
  },
  {
    icon: ICONS.receipt,
    title: 'Facturación automática',
    text: 'Emite facturas legales en PDF a cada restaurante con un solo clic. Numeración correlativa, IVA y datos fiscales listos.',
  },
  {
    icon: ICONS.shield,
    title: 'Tú eres autónomo',
    text: 'Sigues siendo tu propio jefe. Pidoo es solo la plataforma que te conecta con los restaurantes. Sin contrato laboral, sin imposiciones.',
  },
  {
    icon: ICONS.truck,
    title: 'Tu app de reparto: Pidoo Socio',
    text: 'Reparte directamente desde la app de Pidoo Socio en tu móvil. Recibes el pedido, navegas y entregas. Todo el flujo es transparente.',
  },
]

const pasos = [
  { n: '1', titulo: 'Regístrate', texto: 'Crea tu cuenta con email o Google. En un paso eliges tu nombre comercial y se genera tu marketplace.' },
  { n: '2', titulo: 'Vincúlate con restaurantes', texto: 'Busca restaurantes en Pidoo, solicita vincularte o acepta propuestas que te lleguen.' },
  { n: '3', titulo: 'Empieza a repartir', texto: 'Cada pedido aceptado llega directo a tu app de Pidoo Socio. Tú repartes, el restaurante te paga directo. Sin intermediarios.' },
]

function Logo({ size = 34 }) {
  return (
    <img
      src="/icon.png"
      alt="Pidoo Socios"
      width={size}
      height={size}
      style={{ display: 'block', borderRadius: size * 0.22 }}
    />
  )
}

function PanelMockup() {
  return (
    <div style={{
      background: colors.paper, borderRadius: 18,
      border: `1px solid ${colors.border}`,
      boxShadow: '0 20px 60px rgba(26,24,21,0.10)',
      padding: 16, width: '100%', maxWidth: 340,
      fontFamily: FONT,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
        <Logo size={32} />
        <div>
          <div style={{ fontSize: 13, fontWeight: 800, color: colors.ink, lineHeight: 1 }}>Pidoo Socios</div>
          <div style={{ fontSize: 11, color: colors.stone, marginTop: 2 }}>Panel del repartidor</div>
        </div>
      </div>
      <div style={{ fontSize: 10, fontWeight: 700, color: colors.stone, letterSpacing: '0.08em', marginBottom: 8 }}>INGRESOS</div>
      <div style={{ ...card(), marginBottom: 10 }}>
        <div style={{ fontSize: 9, fontWeight: 700, color: colors.stone, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Este mes</div>
        <div style={{ fontSize: 24, fontWeight: 800, color: colors.ink, marginTop: 4 }}>1.284,50 €</div>
        <div style={{ fontSize: 11, color: colors.stone, marginTop: 2 }}>186 envíos</div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <div style={card()}>
          <div style={{ fontSize: 9, fontWeight: 700, color: colors.stone, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Hoy</div>
          <div style={{ fontSize: 17, fontWeight: 800, color: colors.ink, marginTop: 4 }}>48 €</div>
        </div>
        <div style={card()}>
          <div style={{ fontSize: 9, fontWeight: 700, color: colors.stone, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Por cobrar</div>
          <div style={{ fontSize: 17, fontWeight: 800, color: colors.terracotta, marginTop: 4 }}>312 €</div>
        </div>
      </div>
    </div>
  )
}

function card() {
  return {
    background: colors.cream2, borderRadius: 10, padding: '10px 12px',
    border: `1px solid ${colors.border}`,
  }
}

export default function Landing({ onLogin }) {
  const CTA = (label, style = {}) => (
    <button onClick={onLogin} style={{
      padding: '0 24px', height: 46, borderRadius: 10,
      background: `linear-gradient(180deg, ${colors.ink2} 0%, ${colors.ink} 100%)`,
      color: colors.cream, border: '1px solid #000',
      fontSize: 15, fontWeight: 700, cursor: 'pointer', fontFamily: FONT,
      display: 'inline-flex', alignItems: 'center', gap: 8,
      boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.10), 0 1px 2px rgba(26,24,21,0.20)',
      ...style,
    }}>{label}<Icon d={ICONS.arrow} size={18} color={colors.cream} /></button>
  )

  return (
    <div style={{ minHeight: '100vh', background: colors.cream, color: colors.ink, fontFamily: FONT }}>
      {/* TOP BAR */}
      <header style={{
        position: 'sticky', top: 0, zIndex: 20,
        background: 'rgba(247,243,236,0.85)',
        backdropFilter: 'blur(10px)',
        borderBottom: `1px solid ${colors.border}`,
      }}>
        <div style={{
          maxWidth: 1200, margin: '0 auto', padding: '14px 20px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Logo size={36} />
            <div>
              <div style={{ fontSize: 16, fontWeight: 800, letterSpacing: '-0.02em', lineHeight: 1 }}>Pidoo Socios</div>
              <div style={{ fontSize: 11, color: colors.stone, marginTop: 2 }}>Panel del repartidor autónomo</div>
            </div>
          </div>
          <button onClick={onLogin} style={{
            padding: '0 18px', height: 38, borderRadius: 9,
            border: `1px solid ${colors.border}`, background: colors.paper,
            color: colors.ink, fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: FONT,
            display: 'inline-flex', alignItems: 'center', gap: 6,
          }}>
            <Icon d={ICONS.lock} size={15} color={colors.stone} />
            Acceder
          </button>
        </div>
      </header>

      {/* HERO */}
      <section style={{ padding: '56px 20px 40px', maxWidth: 1200, margin: '0 auto' }}>
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
          gap: 48, alignItems: 'center',
        }}>
          <div>
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '6px 12px', borderRadius: 999,
              background: colors.terracottaSoft, color: colors.terracotta,
              fontSize: 12, fontWeight: 700, letterSpacing: '0.02em',
              marginBottom: 18,
            }}>
              <span style={{
                width: 6, height: 6, borderRadius: 999, background: colors.terracotta,
              }} />
              Para repartidores autónomos
            </div>
            <h1 style={{
              fontSize: 'clamp(34px, 5vw, 54px)', fontWeight: 800,
              letterSpacing: '-0.03em', lineHeight: 1.05, margin: 0, marginBottom: 20,
            }}>
              Reparte para restaurantes Pidoo
            </h1>
            <p style={{
              fontSize: 17, color: colors.ink2, lineHeight: 1.55,
              margin: 0, marginBottom: 28, maxWidth: 520,
            }}>
              Eres autónomo. Te vinculas con restaurantes Pidoo, pactas tu tarifa con cada uno, y repartes desde la app de Pidoo Socio. El restaurante te paga directo. Pidoo es la plataforma que os conecta — cero comisiones para ti.
            </p>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
              {CTA('Entrar a la plataforma')}
              <div style={{ fontSize: 12, color: colors.stone }}>
                Ya eres socio? <button onClick={onLogin} style={{
                  background: 'none', border: 'none', color: colors.terracotta,
                  fontWeight: 700, cursor: 'pointer', fontFamily: FONT, fontSize: 12, padding: 0,
                }}>Inicia sesión</button>
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <PanelMockup />
          </div>
        </div>
      </section>

      {/* BULLETS RAPIDOS */}
      <section style={{ padding: '20px 20px 40px', maxWidth: 1200, margin: '0 auto' }}>
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 14,
        }}>
          {[
            { t: '0% comisión', d: 'Cobras el coste del envío íntegro + propina íntegra. Pidoo no se queda nada de lo tuyo.' },
            { t: 'Tarifa pactada con cada restaurante', d: 'Tú y el restaurante acordáis base, km y adicionales. Sin imposiciones.' },
            { t: 'Tu app de reparto: Pidoo Socio', d: 'Repartes desde la propia app de Pidoo Socio. Sin apps de terceros.' },
          ].map(b => (
            <div key={b.t} style={{
              background: colors.paper, padding: 18,
              borderRadius: 14, border: `1px solid ${colors.border}`,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                <div style={{
                  width: 26, height: 26, borderRadius: 7,
                  background: colors.sageSoft, display: 'grid', placeItems: 'center',
                }}>
                  <Icon d={ICONS.check} size={15} color={colors.sage2} />
                </div>
                <div style={{ fontSize: 14, fontWeight: 700 }}>{b.t}</div>
              </div>
              <div style={{ fontSize: 13, color: colors.stone, lineHeight: 1.5 }}>{b.d}</div>
            </div>
          ))}
        </div>
      </section>

      {/* FEATURES */}
      <section style={{ padding: '40px 20px 40px', maxWidth: 1200, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 36 }}>
          <div style={{
            fontSize: 12, fontWeight: 700, color: colors.terracotta,
            letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8,
          }}>
            Funcionalidades
          </div>
          <h2 style={{
            fontSize: 'clamp(26px, 3.5vw, 36px)', fontWeight: 800,
            letterSpacing: '-0.02em', lineHeight: 1.15, margin: 0, marginBottom: 10,
          }}>
            Todo lo que necesitas en un sitio
          </h2>
          <p style={{ fontSize: 15, color: colors.stone, maxWidth: 560, margin: '0 auto' }}>
            Desde que te vinculas con un restaurante hasta que cobras tu factura, Pidoo Socios te acompaña en cada paso.
          </p>
        </div>
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16,
        }}>
          {features.map(f => (
            <div key={f.title} style={{
              background: colors.paper, borderRadius: 14, padding: 20,
              border: `1px solid ${colors.border}`,
              transition: 'transform 0.15s ease, box-shadow 0.15s ease',
            }}>
              <div style={{
                width: 42, height: 42, borderRadius: 10,
                background: colors.terracottaSoft, display: 'grid', placeItems: 'center',
                marginBottom: 14,
              }}>
                <Icon d={f.icon} size={22} color={colors.terracotta} />
              </div>
              <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>{f.title}</div>
              <div style={{ fontSize: 13, color: colors.stone, lineHeight: 1.55 }}>{f.text}</div>
            </div>
          ))}
        </div>
      </section>

      {/* COMO FUNCIONA */}
      <section style={{ padding: '40px 20px 40px', maxWidth: 1200, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 36 }}>
          <div style={{
            fontSize: 12, fontWeight: 700, color: colors.terracotta,
            letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8,
          }}>
            Cómo funciona
          </div>
          <h2 style={{
            fontSize: 'clamp(26px, 3.5vw, 36px)', fontWeight: 800,
            letterSpacing: '-0.02em', lineHeight: 1.15, margin: 0,
          }}>
            Empieza en tres pasos
          </h2>
        </div>
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16,
        }}>
          {pasos.map(p => (
            <div key={p.n} style={{
              background: colors.paper, borderRadius: 14, padding: 22,
              border: `1px solid ${colors.border}`, position: 'relative',
            }}>
              <div style={{
                width: 44, height: 44, borderRadius: 12,
                background: colors.terracotta, color: colors.cream,
                display: 'grid', placeItems: 'center',
                fontSize: 22, fontWeight: 800, marginBottom: 14,
              }}>{p.n}</div>
              <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>{p.titulo}</div>
              <div style={{ fontSize: 13, color: colors.stone, lineHeight: 1.55 }}>{p.texto}</div>
            </div>
          ))}
        </div>
      </section>

      {/* CTA FINAL */}
      <section style={{ padding: '40px 20px 60px', maxWidth: 1200, margin: '0 auto' }}>
        <div style={{
          background: `linear-gradient(135deg, ${colors.terracotta} 0%, ${colors.terracotta2} 100%)`,
          borderRadius: 20, padding: '48px 28px',
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          textAlign: 'center', color: colors.cream,
          boxShadow: '0 20px 50px rgba(197,86,44,0.22)',
        }}>
          <h2 style={{
            fontSize: 'clamp(26px, 3.5vw, 38px)', fontWeight: 800,
            letterSpacing: '-0.02em', lineHeight: 1.15, margin: 0, marginBottom: 10,
          }}>
            Empieza a repartir hoy
          </h2>
          <p style={{ fontSize: 15, opacity: 0.95, margin: 0, marginBottom: 24, maxWidth: 520 }}>
            Regístrate gratis. Cero comisiones para ti. Lo que cobras es 100% tuyo.
          </p>
          <button onClick={onLogin} style={{
            padding: '0 28px', height: 48, borderRadius: 11,
            border: 'none', background: colors.cream, color: colors.terracotta,
            fontSize: 15, fontWeight: 800, cursor: 'pointer', fontFamily: FONT,
            display: 'inline-flex', alignItems: 'center', gap: 8,
          }}>
            Acceder a Pidoo Socios
            <Icon d={ICONS.arrow} size={18} color={colors.terracotta} />
          </button>
        </div>
      </section>

      {/* FOOTER */}
      <footer style={{
        borderTop: `1px solid ${colors.border}`,
        padding: '22px 20px',
        background: colors.paper,
      }}>
        <div style={{
          maxWidth: 1200, margin: '0 auto',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          flexWrap: 'wrap', gap: 12, fontSize: 12, color: colors.stone,
        }}>
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
    </div>
  )
}
