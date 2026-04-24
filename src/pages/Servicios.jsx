import { useSocio } from '../context/SocioContext'
import { colors, ds, type } from '../lib/uiStyles'

// Ajustar con el WhatsApp real de Rogotech (formato internacional sin +)
const CONTACT_WA = '34600000000'
const CONTACT_EMAIL = 'rodelomarlon1@gmail.com'
const COMISION_PCT = 15 // % para el socio por cada cliente cerrado

function Icon({ d, size = 22, color = colors.primary }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  )
}

const ICONS = {
  bolt: 'M13 2 3 14h8l-2 8 10-12h-8z',
  globe: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z M2 12h20 M12 2a15 15 0 0 1 0 20 M12 2a15 15 0 0 0 0 20',
  phone: 'M5 2h14a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z M12 18h0',
  layout: 'M3 3h18v18H3z M3 9h18 M9 21V9',
  chat: 'M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z',
  plug: 'M9 2v6 M15 2v6 M6 8h12v4a6 6 0 0 1-12 0V8z M12 18v4',
  trophy: 'M8 21h8 M12 17v4 M7 4h10v4a5 5 0 0 1-10 0V4z M17 4h3v3a3 3 0 0 1-3 3 M7 4H4v3a3 3 0 0 0 3 3',
  arrow: 'M5 12h14 M12 5l7 7-7 7',
}

const SERVICIOS = [
  {
    icon: ICONS.bolt,
    titulo: 'Automatizaciones con IA',
    desde: 500,
    descripcion: 'Automatiza respuestas, reservas, cobros, seguimiento de clientes o cualquier proceso repetitivo con n8n + IA. Ideal para clínicas, restaurantes, tiendas y negocios de servicios.',
    tags: ['n8n', 'IA', 'WhatsApp'],
  },
  {
    icon: ICONS.globe,
    titulo: 'Páginas web profesionales',
    desde: 600,
    descripcion: 'Landing pages, webs corporativas o tiendas online. Diseño moderno, optimizadas para móvil, con tu dominio propio y panel fácil de editar.',
    tags: ['Landing', 'Corporativa', 'E-commerce'],
  },
  {
    icon: ICONS.phone,
    titulo: 'Aplicaciones móviles',
    desde: 2500,
    descripcion: 'Apps nativas iOS y Android para tu negocio. Pedidos, reservas, fidelización, gestión interna. Desde cero o integradas a tu sistema actual.',
    tags: ['iOS', 'Android', 'PWA'],
  },
  {
    icon: ICONS.layout,
    titulo: 'ERP y sistemas de gestión',
    desde: 1500,
    descripcion: 'CRM, facturación, stock, reservas, control de empleados. Todo unificado, a medida del negocio, accesible desde cualquier dispositivo.',
    tags: ['CRM', 'Stock', 'Facturación'],
  },
  {
    icon: ICONS.chat,
    titulo: 'Chatbots con IA',
    desde: 400,
    descripcion: 'Atención 24/7 en WhatsApp o web con IA real. Responde dudas, reserva citas, cierra ventas y pasa los casos complejos a un humano.',
    tags: ['WhatsApp', 'Web', 'GPT'],
  },
  {
    icon: ICONS.plug,
    titulo: 'Integraciones y APIs',
    desde: 300,
    descripcion: 'Conectamos tu negocio con Stripe, Holded, Google Workspace, Shopify, Mailchimp o cualquier herramienta que uses, para que todo se sincronice solo.',
    tags: ['Stripe', 'Holded', 'Google'],
  },
]

export default function Servicios() {
  const { socio } = useSocio()

  const recomendar = (serv) => {
    const socioNombre = socio?.nombre_comercial || socio?.nombre || 'un socio de Pidoo'
    const msg = encodeURIComponent(
      `Hola, soy cliente recomendado por ${socioNombre} (socio de Pidoo).\n\n` +
      `Me interesa el servicio de Rogotech: ${serv.titulo}.\n\n` +
      `¿Me puedes dar más información?`
    )
    window.open(`https://wa.me/${CONTACT_WA}?text=${msg}`, '_blank', 'noopener')
  }

  const yoMismo = (serv) => {
    const socioNombre = socio?.nombre_comercial || socio?.nombre || 'socio de Pidoo'
    const msg = encodeURIComponent(
      `Hola, soy ${socioNombre} y me interesa el servicio ${serv.titulo} para mi propio negocio.`
    )
    window.open(`https://wa.me/${CONTACT_WA}?text=${msg}`, '_blank', 'noopener')
  }

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h1 style={ds.h1}>Servicios Rogotech</h1>
        <p style={{ color: colors.textMute, fontSize: type.sm, marginTop: 4 }}>
          Además de Pidoo, Rogotech ofrece servicios digitales para negocios. Recomiéndalos a tus contactos y gana comisión por cada cliente cerrado.
        </p>
      </div>

      {/* Banner comisión */}
      <div style={{
        background: `linear-gradient(135deg, ${colors.primary} 0%, ${colors.primaryDark} 100%)`,
        borderRadius: 14, padding: '20px 22px', marginBottom: 22,
        color: '#fff', display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap',
        boxShadow: '0 8px 24px rgba(255,107,44,0.22)',
      }}>
        <div style={{
          width: 52, height: 52, borderRadius: 14,
          background: 'rgba(255,255,255,0.18)', display: 'grid', placeItems: 'center', flexShrink: 0,
        }}>
          <Icon d={ICONS.trophy} size={26} color="#fff" />
        </div>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontSize: type.base, fontWeight: 800, marginBottom: 4 }}>
            Gana un {COMISION_PCT}% por cada cliente que traigas
          </div>
          <div style={{ fontSize: type.sm, opacity: 0.95, lineHeight: 1.5 }}>
            Si un contacto tuyo contrata cualquier servicio de Rogotech, te llevas el {COMISION_PCT}% del precio final. Pagado en tu siguiente liquidación.
          </div>
        </div>
      </div>

      {/* Grid de servicios */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(320px,1fr))', gap: 14,
      }}>
        {SERVICIOS.map(s => (
          <div key={s.titulo} style={ds.card}>
            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', marginBottom: 10 }}>
              <div style={{
                width: 40, height: 40, borderRadius: 10,
                background: colors.primarySoft, display: 'grid', placeItems: 'center', flexShrink: 0,
              }}>
                <Icon d={s.icon} size={22} color={colors.primary} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: type.base, fontWeight: 700, color: colors.text }}>
                  {s.titulo}
                </div>
                <div style={{ fontSize: type.xs, color: colors.primary, fontWeight: 700, marginTop: 2 }}>
                  Desde {s.desde} €
                </div>
              </div>
            </div>

            <p style={{ fontSize: type.sm, color: colors.textDim, lineHeight: 1.55, margin: '0 0 12px' }}>
              {s.descripcion}
            </p>

            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
              {s.tags.map(t => (
                <span key={t} style={{
                  fontSize: type.xxs, fontWeight: 700,
                  padding: '3px 8px', borderRadius: 6,
                  background: colors.surface2, color: colors.textMute,
                  border: `1px solid ${colors.border}`,
                  letterSpacing: '0.04em',
                }}>{t}</span>
              ))}
            </div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button onClick={() => recomendar(s)} style={{ ...ds.primaryBtn, flex: 1, height: 38, fontSize: type.xs }}>
                Recomendar a un cliente
              </button>
              <button onClick={() => yoMismo(s)} style={{ ...ds.secondaryBtn, height: 38, fontSize: type.xs }}>
                Lo quiero yo
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Cómo funciona la comisión */}
      <div style={{ ...ds.card, marginTop: 22 }}>
        <h2 style={{ ...ds.h2, marginBottom: 12 }}>Cómo funciona la comisión</h2>
        <ol style={{ margin: 0, paddingLeft: 20, fontSize: type.sm, color: colors.textDim, lineHeight: 1.7 }}>
          <li><strong>Recomienda</strong> un servicio a alguien que conozcas (un restaurante, una clínica, un negocio).</li>
          <li>Al pulsar “Recomendar a un cliente” se abre WhatsApp con un mensaje prellenado que ya te identifica como referidor.</li>
          <li>Rogotech atiende la consulta, envía el presupuesto y, si se cierra la venta, te asigna la comisión del {COMISION_PCT}%.</li>
          <li>La comisión se paga en tu siguiente liquidación mensual, junto al resto de tus ingresos Pidoo.</li>
        </ol>
        <p style={{ fontSize: type.xxs, color: colors.textMute, marginTop: 14, marginBottom: 0 }}>
          ¿Dudas? Escríbenos a <a href={`mailto:${CONTACT_EMAIL}`} style={{ color: colors.primary, fontWeight: 600 }}>{CONTACT_EMAIL}</a>.
        </p>
      </div>
    </div>
  )
}
