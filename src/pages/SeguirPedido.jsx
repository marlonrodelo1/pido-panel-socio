// Pagina publica /seguir/<codigo>?t=<token> con Google Maps + rider en tiempo real.
//
// SEGURIDAD: consulta exclusivamente la edge function get-tracking-publico
// con un token UUID v4 que se pasa por query string. Sin token valido o con
// codigo inexistente la edge devuelve 404 -> mostramos "Enlace no valido".

import { useEffect, useRef, useState } from 'react'
import { loadGoogleMaps } from '../lib/googleMaps'
import { emojiIcon, imageRoundIcon } from '../lib/mapMarkers'
import { colors, type } from '../lib/uiStyles'

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

  // Init Google Maps con marker del restaurante
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
          ? await imageRoundIcon(est.logo_url, colors.terracotta)
          : emojiIcon('🍽️', colors.terracotta)
        if (cancel) return
        markersRef.current.rest = new maps.Marker({
          position: { lat: restLat, lng: restLng },
          map, title: est.nombre || 'Restaurante',
          icon: restIcon, zIndex: 100,
        })
      })()
    }).catch((e) => console.warn('[seguir] gmaps load fail', e?.message))
    return () => { cancel = true }
  }, [data?.establecimiento?.latitud, data?.establecimiento?.longitud])

  // Marker entrega
  useEffect(() => {
    const entrega = data?.entrega
    if (!mapRef.current || !entrega?.lat || !entrega?.lng || !window.google?.maps) return
    const maps = window.google.maps
    const pos = { lat: entrega.lat, lng: entrega.lng }
    if (!markersRef.current.entrega) {
      markersRef.current.entrega = new maps.Marker({
        position: pos, map: mapRef.current, title: 'Entrega',
        icon: emojiIcon('🏠', colors.ink), zIndex: 90,
      })
    } else {
      markersRef.current.entrega.setPosition(pos)
    }
  }, [data?.entrega?.lat, data?.entrega?.lng])

  // Marker rider
  useEffect(() => {
    const rider = data?.rider
    const socio = data?.socio
    if (!mapRef.current || !rider?.lat || !rider?.lng || !window.google?.maps) return
    const maps = window.google.maps
    const pos = { lat: rider.lat, lng: rider.lng }
    const color = socio?.color_primario || colors.sage
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
        if (logoUrl && !markersRef.current.riderIconLogoSet) {
          markersRef.current.rider.setIcon(icon)
          markersRef.current.riderIconLogoSet = true
        }
      }
    })()

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
  const colorMarca = socio?.color_primario || colors.terracotta
  const initialSocio = (socio?.nombre_comercial || rider?.nombre || 'P').trim()[0].toUpperCase()

  return (
    <Layout>
      <header style={S.header}>
        <img src="/icon.png" alt="Pidoo" style={{ width: 28, height: 28, borderRadius: 8 }} />
        <div style={{ width: 1, height: 22, background: colors.border }} />
        <span style={{
          fontFamily: type.mono, fontSize: 12, color: colors.textMute,
          fontWeight: 600, flex: 1, textAlign: 'right',
        }}>{pedido.codigo}</span>
      </header>

      {/* Banner socio que reparte */}
      {socio && (
        <div style={{
          margin: '12px 14px 0', padding: '12px 14px', borderRadius: 12,
          background: colors.terracottaSoft, border: `1px solid ${colors.terracotta}`,
          display: 'flex', alignItems: 'center', gap: 12,
        }}>
          {socio?.logo_url ? (
            <img src={socio.logo_url} alt={socio.nombre_comercial}
              style={{ width: 38, height: 38, borderRadius: 19, objectFit: 'cover', border: `2px solid ${colorMarca}` }} />
          ) : (
            <div style={{
              width: 38, height: 38, borderRadius: 19, background: colors.terracotta,
              color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontWeight: 800, fontSize: 13,
            }}>{initialSocio}</div>
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontSize: 10, color: colors.terracotta2, fontWeight: 800,
              letterSpacing: '0.06em', textTransform: 'uppercase',
            }}>Reparte</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: colors.text }}>
              {socio.nombre_comercial || rider?.nombre || 'Pidoo'} · vía Pidoo
            </div>
          </div>
        </div>
      )}

      {/* Mapa */}
      <div style={{ position: 'relative', height: 300, background: colors.cream2, marginTop: 14 }}>
        <div ref={mapDivRef} style={{ position: 'absolute', inset: 0 }} />
        <div style={S.mapLegend}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 8, height: 8, borderRadius: 4, background: colors.terracotta }} /> Rest.
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 8, height: 8, borderRadius: 4, background: colorMarca }} /> Rider
          </span>
          {data?.entrega && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 8, height: 8, borderRadius: 4, background: colors.ink }} /> Tú
            </span>
          )}
        </div>
      </div>

      <div style={{ padding: '20px 18px 0' }}>
        <div style={{ fontSize: 22, fontWeight: 800, color: colors.text, letterSpacing: '-0.3px' }}>{titulo}</div>
        {!esTerminado && pedido.minutos_preparacion && ['preparando','listo','aceptado'].includes(pedido.estado) && (
          <div style={{ fontSize: 13, color: colors.textMute, marginTop: 6 }}>
            Estimación: <b style={{ color: colors.text }}>{pedido.minutos_preparacion} min</b>
          </div>
        )}
      </div>

      {/* Stepper */}
      <div style={{ ...S.card, padding: '14px 16px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 6 }}>
          {STEPS.map((s, i) => {
            const done = i <= step
            const current = i === step && !esTerminado
            return (
              <div key={s.id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                <div style={{
                  width: '100%', height: 4, borderRadius: 999,
                  background: done ? colors.sage : colors.cream2,
                }} />
                <div style={{
                  fontSize: 11, fontWeight: 600, textAlign: 'center',
                  color: current ? colors.terracotta : done ? colors.sage2 : colors.textMute,
                  textTransform: 'uppercase', letterSpacing: '0.04em',
                }}>{s.label}</div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Rider */}
      {rider && (
        <div style={{ ...S.card, display: 'flex', alignItems: 'center', gap: 12 }}>
          {socio?.logo_url ? (
            <img src={socio.logo_url} alt={socio.nombre_comercial || rider.nombre}
              style={{ width: 44, height: 44, borderRadius: 22, objectFit: 'cover', border: `2px solid ${colorMarca}` }} />
          ) : (
            <div style={{
              width: 44, height: 44, borderRadius: 22, background: colors.terracotta,
              color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontWeight: 800, fontSize: 14,
            }}>{(rider.nombre || '?').slice(0, 1).toUpperCase()}</div>
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: colors.text }}>{rider.nombre}</div>
            {rider.rating > 0 && (
              <div style={{ display: 'flex', gap: 2, alignItems: 'center', marginTop: 2 }}>
                {[1,2,3,4,5].map(i => (
                  <svg key={i} width="11" height="11" viewBox="0 0 24 24"
                    fill={i <= Math.round(rider.rating) ? colors.warning : 'transparent'}
                    stroke={colors.warning} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
                  </svg>
                ))}
                <span style={{ fontSize: 11, color: colors.textMute, marginLeft: 4 }}>{Number(rider.rating).toFixed(1)}</span>
              </div>
            )}
          </div>
          {rider.telefono && (
            <a href={`tel:${rider.telefono}`} style={{
              padding: '9px 14px', borderRadius: 999, background: colors.sage,
              color: '#fff', fontWeight: 700, fontSize: 13, textDecoration: 'none',
              display: 'inline-flex', alignItems: 'center', gap: 6,
            }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.37 1.9.72 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.35 1.85.59 2.81.72A2 2 0 0 1 22 16.92z"/>
              </svg>
              Llamar
            </a>
          )}
        </div>
      )}

      {/* Pedido (accordion) */}
      <div style={{ ...S.card, padding: 0, overflow: 'hidden' }}>
        <button onClick={() => setAccItems(!accItems)} style={{
          width: '100%', padding: '14px 16px', background: colors.paper, border: 'none', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          fontSize: 14, fontWeight: 700, color: colors.text, textAlign: 'left', fontFamily: type.family,
        }}>
          <span>Pedido #{pedido.codigo} ({items.length} artículo{items.length === 1 ? '' : 's'})</span>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            style={{ transform: accItems ? 'rotate(180deg)' : 'rotate(0)', transition: 'transform 0.2s', color: colors.textMute }}>
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </button>
        {accItems && (
          <div style={{ padding: '4px 16px 14px' }}>
            {items.map((it, i) => (
              <div key={i} style={{
                display: 'flex', justifyContent: 'space-between',
                padding: '7px 0', fontSize: 13, color: colors.text,
                borderBottom: i < items.length - 1 ? `1px solid ${colors.border}` : 'none',
              }}>
                <span>{it.cantidad}× {it.nombre_producto}</span>
                <span style={{ color: colors.textMute, fontVariantNumeric: 'tabular-nums' }}>
                  {Number(it.precio_unitario || 0).toFixed(2)} €
                </span>
              </div>
            ))}
            <div style={{
              display: 'flex', justifyContent: 'space-between',
              padding: '12px 0 0', fontSize: 14, fontWeight: 800, color: colors.text,
            }}>
              <span>Total</span>
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>{Number(pedido.total || 0).toFixed(2)} €</span>
            </div>
          </div>
        )}
      </div>

      {/* Restaurante */}
      <div style={S.card}>
        <div style={{
          fontSize: 11, color: colors.textMute, textTransform: 'uppercase',
          letterSpacing: '0.04em', fontWeight: 700, marginBottom: 6,
        }}>Restaurante</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {est?.logo_url && (
            <img src={est.logo_url} alt={est.nombre}
              style={{ width: 38, height: 38, borderRadius: 19, objectFit: 'cover', border: `2px solid ${colors.terracotta}` }} />
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: colors.text }}>{est?.nombre}</div>
            {est?.telefono && (
              <a href={`tel:${est.telefono}`} style={{
                display: 'inline-flex', alignItems: 'center', gap: 5, marginTop: 4,
                fontSize: 12, fontWeight: 700, color: colors.terracotta, textDecoration: 'none',
              }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.37 1.9.72 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.35 1.85.59 2.81.72A2 2 0 0 1 22 16.92z"/></svg>
                {est.telefono}
              </a>
            )}
          </div>
        </div>
      </div>

      <div style={{
        textAlign: 'center', fontSize: 11, color: colors.textFaint,
        padding: '18px 16px 28px',
      }}>
        Hecho con cariño por <strong style={{ color: colors.terracotta }}>Pidoo</strong>
      </div>
    </Layout>
  )
}

function Layout({ children }) {
  return (
    <div style={{ minHeight: '100vh', background: colors.cream, fontFamily: type.family }}>
      <div style={{
        maxWidth: 480, margin: '0 auto', background: colors.paper,
        minHeight: '100vh', boxShadow: '0 0 0 1px ' + colors.border,
      }}>
        {children}
      </div>
    </div>
  )
}
function Centered({ children }) {
  return <div style={{ padding: 60, textAlign: 'center', color: colors.textMute, fontFamily: type.family }}>{children}</div>
}

const S = {
  header: {
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '14px 18px', borderBottom: `1px solid ${colors.border}`,
    position: 'sticky', top: 0, background: colors.paper, zIndex: 5,
  },
  card: {
    margin: '12px 14px', padding: '14px 16px',
    background: colors.paper, borderRadius: 12, border: `1px solid ${colors.border}`,
    boxShadow: colors.shadow,
  },
  mapLegend: {
    position: 'absolute', left: 10, bottom: 10,
    background: colors.paper, borderRadius: 8,
    padding: '6px 10px',
    display: 'flex', gap: 10, fontSize: 11, fontWeight: 600,
    color: colors.text, boxShadow: colors.shadow,
  },
}
