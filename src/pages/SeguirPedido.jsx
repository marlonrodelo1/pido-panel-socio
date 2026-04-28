// Pagina publica /seguir/<codigo>?t=<token> con Google Maps + rider en tiempo real.
//
// SEGURIDAD: consulta exclusivamente la edge function get-tracking-publico
// con un token UUID v4 que se pasa por query string. Sin token valido o con
// codigo inexistente la edge devuelve 404 -> mostramos "Enlace no valido".
//
// Cliente ve en el mapa: restaurante (logo del establecimiento), rider (logo
// del socio = la marca que reparte) y, si hay token valido y es delivery, el
// punto de entrega. Marca y color del socio aparecen en header y card.

import { useEffect, useRef, useState } from 'react'
import { loadGoogleMaps } from '../lib/googleMaps'
import { emojiIcon, imageRoundIcon } from '../lib/mapMarkers'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const ANON = import.meta.env.VITE_SUPABASE_ANON_KEY

const STEPS = [
  { id: 'aceptado', label: 'Aceptado' },
  { id: 'preparando', label: 'Preparando' },
  { id: 'en_ruta', label: 'En camino' },
  { id: 'entregado', label: 'Entregado' },
]

function estadoToStep(estado) {
  if (estado === 'aceptado') return 0
  if (estado === 'preparando' || estado === 'listo') return 1
  if (estado === 'recogido' || estado === 'en_camino') return 2
  if (estado === 'entregado') return 3
  return 0
}

function estadoTitulo(estado, modo) {
  if (estado === 'entregado') return modo === 'recogida' ? 'Pedido recogido' : '¡Pedido entregado!'
  if (estado === 'cancelado') return 'Pedido cancelado'
  if (estado === 'recogido' || estado === 'en_camino') return 'Tu pedido va de camino'
  if (estado === 'listo') return modo === 'recogida' ? 'Listo para recoger' : 'Listo, esperando rider'
  if (estado === 'preparando') return 'Preparando tu pedido'
  return 'Pedido recibido'
}

function getTrackingTokenFromUrl() {
  if (typeof window === 'undefined') return ''
  try {
    const url = new URL(window.location.href)
    return (url.searchParams.get('t') || '').trim()
  } catch { return '' }
}

export default function SeguirPedido({ codigo }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [accItems, setAccItems] = useState(false)
  const mapRef = useRef(null)
  const mapDivRef = useRef(null)
  const markersRef = useRef({})
  const polylineRef = useRef(null)
  const lastFitKeyRef = useRef('')
  const tokenRef = useRef(getTrackingTokenFromUrl())

  useEffect(() => {
    if (!codigo) return
    let cancel = false

    async function load() {
      try {
        const r = await fetch(`${SUPABASE_URL}/functions/v1/get-tracking-publico`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': ANON,
            'Authorization': `Bearer ${ANON}`,
          },
          body: JSON.stringify({ codigo, token: tokenRef.current }),
        })
        if (cancel) return
        if (r.status === 404) {
          setError('Enlace de seguimiento no válido')
          setLoading(false)
          return
        }
        const j = await r.json().catch(() => ({}))
        if (!r.ok) {
          setError(j.error || 'No se pudo cargar el pedido')
          setLoading(false)
          return
        }
        setData(j)
        setError(null)
        setLoading(false)
      } catch (e) {
        if (cancel) return
        setError('No se pudo cargar el pedido')
        setLoading(false)
      }
    }

    load()
    const id = setInterval(load, 15000)
    return () => { cancel = true; clearInterval(id) }
  }, [codigo])

  // Init Google Maps con marker del restaurante (y entrega si hay)
  useEffect(() => {
    const est = data?.establecimiento
    if (!est) return
    let cancel = false
    loadGoogleMaps().then((maps) => {
      if (cancel || !mapDivRef.current || mapRef.current) return
      const restLat = est.latitud
      const restLng = est.longitud
      if (restLat == null || restLng == null) return
      const map = new maps.Map(mapDivRef.current, {
        center: { lat: restLat, lng: restLng },
        zoom: 14,
        disableDefaultUI: true,
        zoomControl: true,
        clickableIcons: false,
        styles: [{ featureType: 'poi', elementType: 'labels', stylers: [{ visibility: 'off' }] }],
      })
      mapRef.current = map

      ;(async () => {
        const restIcon = est.logo_url
          ? await imageRoundIcon(est.logo_url, '#FF6B2C')
          : emojiIcon('🍽️', '#FF6B2C')
        if (cancel) return
        markersRef.current.rest = new maps.Marker({
          position: { lat: restLat, lng: restLng },
          map, title: est.nombre || 'Restaurante',
          icon: restIcon,
          zIndex: 100,
        })
      })()
    }).catch((e) => console.warn('[seguir] gmaps load fail', e?.message))
    return () => { cancel = true }
  }, [data?.establecimiento?.latitud, data?.establecimiento?.longitud])

  // Marker entrega (cliente) - solo si edge devolvio coords (token valido + delivery)
  useEffect(() => {
    const entrega = data?.entrega
    if (!mapRef.current || !entrega?.lat || !entrega?.lng || !window.google?.maps) return
    const maps = window.google.maps
    const pos = { lat: entrega.lat, lng: entrega.lng }
    if (!markersRef.current.entrega) {
      markersRef.current.entrega = new maps.Marker({
        position: pos, map: mapRef.current, title: 'Entrega',
        icon: emojiIcon('🏠', '#1F1F1E'),
        zIndex: 90,
      })
    } else {
      markersRef.current.entrega.setPosition(pos)
    }
  }, [data?.entrega?.lat, data?.entrega?.lng])

  // Marker rider con logo del socio (foto redonda) o emoji moto.
  useEffect(() => {
    const rider = data?.rider
    const socio = data?.socio
    if (!mapRef.current || !rider?.lat || !rider?.lng || !window.google?.maps) return
    const maps = window.google.maps
    const pos = { lat: rider.lat, lng: rider.lng }
    const color = socio?.color_primario || '#16A34A'
    const logoUrl = socio?.logo_url || rider?.logo_url || null

    let cancelled = false
    ;(async () => {
      const icon = logoUrl
        ? await imageRoundIcon(logoUrl, color)
        : emojiIcon('🛵', color)
      if (cancelled) return
      if (!markersRef.current.rider) {
        markersRef.current.rider = new maps.Marker({
          position: pos, map: mapRef.current, title: rider.nombre || 'Repartidor',
          icon, zIndex: 999,
        })
      } else {
        markersRef.current.rider.setPosition(pos)
        // Solo recambiamos icono si no esta puesto aun el del logo (evitamos parpadeo).
        if (logoUrl && !markersRef.current.riderIconLogoSet) {
          markersRef.current.rider.setIcon(icon)
          markersRef.current.riderIconLogoSet = true
        }
      }
    })()

    // FitBounds combinando markers presentes (rest + rider + entrega).
    try {
      const m = markersRef.current
      const points = [m.rest, m.rider, m.entrega].filter(Boolean).map((mk) => mk.getPosition()).filter(Boolean)
      const fitKey = points.map((p) => `${p.lat().toFixed(5)},${p.lng().toFixed(5)}`).join('|')
      if (points.length >= 2 && fitKey !== lastFitKeyRef.current) {
        const bounds = new maps.LatLngBounds()
        points.forEach((p) => bounds.extend(p))
        mapRef.current.fitBounds(bounds, 80)
        lastFitKeyRef.current = fitKey
      }

      // Polyline punteada uniendo restaurante -> rider -> entrega.
      if (points.length >= 2) {
        if (polylineRef.current) polylineRef.current.setMap(null)
        polylineRef.current = new maps.Polyline({
          path: points,
          map: mapRef.current,
          strokeOpacity: 0,
          icons: [{ icon: { path: 'M 0,-1 0,1', strokeOpacity: 0.6, scale: 3, strokeColor: color }, offset: '0', repeat: '12px' }],
          zIndex: 50,
        })
      }
    } catch (_) {}

    return () => { cancelled = true }
  }, [data?.rider?.lat, data?.rider?.lng, data?.socio?.logo_url, data?.socio?.color_primario, data?.entrega?.lat, data?.entrega?.lng])

  if (loading) return <Layout><Centered>Cargando…</Centered></Layout>
  if (error) return <Layout><Centered>{error}</Centered></Layout>
  if (!data?.pedido) return <Layout><Centered>Pedido no encontrado</Centered></Layout>

  const pedido = data.pedido
  const est = data.establecimiento
  const rider = data.rider
  const socio = data.socio
  const items = data.items || []

  const step = estadoToStep(pedido.estado)
  const esTerminado = pedido.estado === 'entregado' || pedido.estado === 'cancelado'
  const titulo = estadoTitulo(pedido.estado, pedido.modo_entrega)
  const colorMarca = socio?.color_primario || '#FF6B2C'

  return (
    <Layout>
      <header style={S.header}>
        <img src="/icon.png" alt="Pidoo" style={{ width: 28, height: 28, borderRadius: 6 }} />
        <div style={{ width: 1, height: 22, background: '#EEE' }} />
        {socio?.logo_url ? (
          <img src={socio.logo_url} alt={socio.nombre_comercial || 'Socio'}
            style={{ width: 26, height: 26, borderRadius: 13, objectFit: 'cover', border: `2px solid ${colorMarca}` }}
            onError={(e) => { e.currentTarget.style.display = 'none' }} />
        ) : (
          <div style={{ width: 26, height: 26, borderRadius: 13, background: colorMarca, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800 }}>
            {(socio?.nombre_comercial || 'P').slice(0,1).toUpperCase()}
          </div>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: '#1F1F1E', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {socio?.nombre_comercial || 'Pidoo'}
          </div>
          <div style={{ fontSize: 11, color: '#777' }}>Pedido #{pedido.codigo}</div>
        </div>
        <button onClick={() => window.location.reload()} title="Refrescar" style={S.iconBtn}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg>
        </button>
      </header>

      <div style={{ position: 'relative', height: 340, background: '#E8E6E0' }}>
        <div ref={mapDivRef} style={{ position: 'absolute', inset: 0 }} />
        <div style={S.mapLegend}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 10, height: 10, borderRadius: 5, background: '#FF6B2C' }} /> Restaurante
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 10, height: 10, borderRadius: 5, background: colorMarca }} /> Rider
          </span>
          {data?.entrega && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 10, height: 10, borderRadius: 5, background: '#1F1F1E' }} /> Entrega
            </span>
          )}
        </div>
      </div>

      <div style={{ padding: '18px 20px 10px' }}>
        <div style={{ fontSize: 22, fontWeight: 800, color: '#1F1F1E' }}>{titulo}</div>
        {!esTerminado && pedido.minutos_preparacion && (pedido.estado === 'preparando' || pedido.estado === 'listo' || pedido.estado === 'aceptado') && (
          <div style={{ fontSize: 13, color: '#777', marginTop: 4 }}>Llegada estimada en ~{pedido.minutos_preparacion} min</div>
        )}
      </div>

      <div style={S.stepper}>
        {STEPS.map((s, i) => {
          const active = i <= step
          return (
            <div key={s.id} style={{ flex: 1, textAlign: 'center' }}>
              <div style={{ height: 4, borderRadius: 2, background: active ? colorMarca : '#E8E6E0', marginBottom: 8 }} />
              <div style={{ fontSize: 11, fontWeight: 700, color: active ? '#1F1F1E' : '#A8A6A0', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{s.label}</div>
            </div>
          )
        })}
      </div>

      {rider && (
        <div style={S.card}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {socio?.logo_url ? (
              <img src={socio.logo_url} alt={socio.nombre_comercial || rider.nombre}
                style={{ width: 48, height: 48, borderRadius: 24, objectFit: 'cover', border: `2px solid ${colorMarca}` }} />
            ) : (
              <div style={{ ...S.avatar, background: `${colorMarca}26`, color: colorMarca }}>{(rider.nombre || '?').slice(0, 1).toUpperCase()}</div>
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 11, color: '#777', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 700 }}>
                {socio?.nombre_comercial ? `Reparte ${socio.nombre_comercial}` : 'Tu repartidor'}
              </div>
              <div style={{ fontSize: 15, fontWeight: 800, color: '#1F1F1E', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{rider.nombre}</div>
              {rider.rating > 0 && <div style={{ fontSize: 11, color: '#777' }}>⭐ {Number(rider.rating).toFixed(1)}</div>}
            </div>
            {rider.telefono && (
              <a href={`tel:${rider.telefono}`} style={S.callBtn} title="Llamar">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.13.96.37 1.9.72 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.91.35 1.85.59 2.81.72A2 2 0 0122 16.92z"/></svg>
              </a>
            )}
          </div>
        </div>
      )}

      <div style={{ ...S.card, padding: 0, overflow: 'hidden' }}>
        <button onClick={() => setAccItems(!accItems)} style={S.accordionHead}>
          <span>Pedido #{pedido.codigo} ({items.length} artículo{items.length === 1 ? '' : 's'})</span>
          <span style={{ transform: accItems ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}>▾</span>
        </button>
        {accItems && (
          <div style={{ padding: '6px 18px 16px' }}>
            {items.map((it, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', fontSize: 13, color: '#1F1F1E', borderBottom: i < items.length - 1 ? '1px solid #EEE' : 'none' }}>
                <span>{it.cantidad}× {it.nombre_producto}</span>
                <span style={{ color: '#777' }}>{Number(it.precio_unitario || 0).toFixed(2)} €</span>
              </div>
            ))}
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 0 0', fontSize: 14, fontWeight: 800, color: '#1F1F1E' }}>
              <span>Total</span><span>{Number(pedido.total || 0).toFixed(2)} €</span>
            </div>
          </div>
        )}
      </div>

      <div style={S.card}>
        <div style={{ fontSize: 11, color: '#777', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 700, marginBottom: 4 }}>Restaurante</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {est?.logo_url && (
            <img src={est.logo_url} alt={est.nombre} style={{ width: 36, height: 36, borderRadius: 18, objectFit: 'cover', border: '2px solid #FF6B2C' }} />
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#1F1F1E' }}>{est?.nombre}</div>
            {est?.telefono && (
              <a href={`tel:${est.telefono}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 4, fontSize: 12, fontWeight: 700, color: '#FF6B2C' }}>📞 {est.telefono}</a>
            )}
          </div>
        </div>
      </div>

      <div style={{ textAlign: 'center', fontSize: 11, color: '#999', padding: 16 }}>
        Hecho con 🛵 por <strong style={{ color: '#FF6B2C' }}>Pidoo</strong>
      </div>
    </Layout>
  )
}

function Layout({ children }) {
  return (
    <div style={{ minHeight: '100vh', background: '#FAFAF7', fontFamily: "'Inter', system-ui, -apple-system, sans-serif" }}>
      <div style={{ maxWidth: 480, margin: '0 auto', background: '#fff', minHeight: '100vh', boxShadow: '0 0 0 1px #EEE' }}>
        {children}
      </div>
    </div>
  )
}
function Centered({ children }) { return <div style={{ padding: 60, textAlign: 'center', color: '#777' }}>{children}</div> }

const S = {
  header: { display: 'flex', alignItems: 'center', gap: 10, padding: '14px 18px', borderBottom: '1px solid #EEE', position: 'sticky', top: 0, background: '#fff', zIndex: 5 },
  iconBtn: { width: 36, height: 36, borderRadius: 18, background: '#F4F2EC', border: 'none', cursor: 'pointer', color: '#1F1F1E', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  stepper: { display: 'flex', gap: 6, padding: '8px 18px 16px' },
  card: { margin: '12px 14px', padding: '14px 18px', background: '#fff', borderRadius: 12, border: '1px solid #EEE', boxShadow: '0 1px 2px rgba(15,15,15,0.04)' },
  avatar: { width: 48, height: 48, borderRadius: 24, background: 'rgba(255,107,44,0.15)', color: '#FF6B2C', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 18 },
  callBtn: { width: 44, height: 44, borderRadius: 22, background: '#16A34A', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', textDecoration: 'none', boxShadow: '0 2px 6px rgba(22,163,74,0.4)' },
  accordionHead: { width: '100%', padding: '14px 18px', background: '#fff', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 13, fontWeight: 700, color: '#1F1F1E', textAlign: 'left' },
  mapLegend: { position: 'absolute', left: 10, bottom: 10, background: 'rgba(255,255,255,0.95)', borderRadius: 8, padding: '6px 10px', display: 'flex', gap: 12, fontSize: 11, fontWeight: 600, color: '#1F1F1E', boxShadow: '0 1px 3px rgba(0,0,0,0.15)' },
}
