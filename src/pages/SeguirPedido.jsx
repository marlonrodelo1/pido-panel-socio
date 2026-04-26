// Pagina publica /seguir/<codigo> con Google Maps + rider en tiempo real.

import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { loadGoogleMaps } from '../lib/googleMaps'

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

export default function SeguirPedido({ codigo }) {
  const [pedido, setPedido] = useState(null)
  const [rider, setRider] = useState(null)
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [accItems, setAccItems] = useState(false)
  const mapRef = useRef(null)
  const mapDivRef = useRef(null)
  const markersRef = useRef({})

  useEffect(() => {
    if (!codigo) return
    let cancel = false

    async function load() {
      const { data: ped, error: pedErr } = await supabase
        .from('pedidos')
        .select('id, codigo, estado, total, direccion_entrega, lat_entrega, lng_entrega, modo_entrega, recogido_at, entregado_at, minutos_preparacion, establecimiento_id, establecimientos(nombre, telefono, direccion, latitud, longitud)')
        .eq('codigo', (codigo || '').toUpperCase())
        .maybeSingle()
      if (cancel) return
      if (pedErr || !ped) { setError('Pedido no encontrado'); setLoading(false); return }
      setPedido(ped)

      const { data: pedItems } = await supabase
        .from('pedido_items')
        .select('nombre_producto, cantidad, precio_unitario')
        .eq('pedido_id', ped.id)
      if (!cancel) setItems(pedItems || [])

      const { data: asig } = await supabase
        .from('pedido_asignaciones')
        .select('estado, aceptado_at, recogido_at, entregado_at, rider_accounts!inner(socios!inner(id, nombre, telefono, rating, latitud_actual, longitud_actual, last_location_at))')
        .eq('pedido_id', ped.id)
        .in('estado', ['aceptado'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (!cancel) {
        const s = asig?.rider_accounts?.socios
        if (s) {
          setRider({
            id: s.id,
            nombre: s.nombre || 'Repartidor',
            telefono: s.telefono || null,
            rating: s.rating || null,
            lat: s.latitud_actual,
            lng: s.longitud_actual,
          })
        } else { setRider(null) }
      }
      setLoading(false)
    }

    load()
    const id = setInterval(load, 8000)
    const ch = supabase.channel('seguir-' + codigo)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'pedidos', filter: `codigo=eq.${(codigo || '').toUpperCase()}` },
        (payload) => setPedido((prev) => prev ? { ...prev, ...payload.new } : prev))
      .subscribe()
    return () => { cancel = true; clearInterval(id); try { supabase.removeChannel(ch) } catch (_) {} }
  }, [codigo])

  // Google Maps init
  useEffect(() => {
    if (!pedido?.establecimientos) return
    let cancel = false
    loadGoogleMaps().then((maps) => {
      if (cancel || !mapDivRef.current || mapRef.current) return
      const restLat = pedido.establecimientos.latitud
      const restLng = pedido.establecimientos.longitud
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

      markersRef.current.rest = new maps.Marker({
        position: { lat: restLat, lng: restLng },
        map, title: pedido.establecimientos.nombre || 'Restaurante',
        icon: {
          path: maps.SymbolPath.CIRCLE,
          fillColor: '#FF6B2C', fillOpacity: 1, strokeColor: '#fff', strokeWeight: 3, scale: 12,
        },
        label: { text: '🍽', fontSize: '14px' },
      })

      if (pedido.lat_entrega && pedido.lng_entrega) {
        markersRef.current.cli = new maps.Marker({
          position: { lat: pedido.lat_entrega, lng: pedido.lng_entrega },
          map, title: 'Entrega',
          icon: {
            path: maps.SymbolPath.CIRCLE,
            fillColor: '#1F1F1E', fillOpacity: 1, strokeColor: '#fff', strokeWeight: 3, scale: 12,
          },
          label: { text: '🏠', fontSize: '14px' },
        })
      }
    }).catch((e) => console.warn('[seguir] gmaps load fail', e?.message))
    return () => { cancel = true }
  }, [pedido?.establecimientos?.latitud, pedido?.establecimientos?.longitud, pedido?.lat_entrega])

  // Update rider marker
  useEffect(() => {
    if (!mapRef.current || !rider?.lat || !rider?.lng || !window.google?.maps) return
    const maps = window.google.maps
    const pos = { lat: rider.lat, lng: rider.lng }
    if (!markersRef.current.rider) {
      markersRef.current.rider = new maps.Marker({
        position: pos, map: mapRef.current, title: rider.nombre,
        icon: {
          path: maps.SymbolPath.CIRCLE,
          fillColor: '#16A34A', fillOpacity: 1, strokeColor: '#fff', strokeWeight: 4, scale: 14,
        },
        label: { text: '🛵', fontSize: '16px' },
        zIndex: 999,
      })
    } else {
      markersRef.current.rider.setPosition(pos)
    }
    try {
      const bounds = new maps.LatLngBounds()
      Object.values(markersRef.current).forEach((m) => bounds.extend(m.getPosition()))
      mapRef.current.fitBounds(bounds, 70)
    } catch (_) {}
  }, [rider?.lat, rider?.lng])

  if (loading) return <Layout><Centered>Cargando…</Centered></Layout>
  if (error || !pedido) return <Layout><Centered>{error || 'Pedido no encontrado'}</Centered></Layout>

  const step = estadoToStep(pedido.estado)
  const est = pedido.establecimientos
  const esTerminado = pedido.estado === 'entregado' || pedido.estado === 'cancelado'

  return (
    <Layout>
      <header style={S.header}>
        <img src="/favicon.svg" alt="Pidoo" style={{ width: 28, height: 28 }} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: '#1F1F1E' }}>Pidoo</div>
          <div style={{ fontSize: 11, color: '#777' }}>Pedido #{pedido.codigo}</div>
        </div>
        <button onClick={() => window.location.reload()} title="Refrescar" style={S.iconBtn}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg>
        </button>
      </header>

      <div style={{ position: 'relative', height: 320, background: '#E8E6E0' }}>
        <div ref={mapDivRef} style={{ position: 'absolute', inset: 0 }} />
      </div>

      <div style={{ padding: '18px 20px 10px' }}>
        <div style={{ fontSize: 22, fontWeight: 800, color: '#1F1F1E' }}>
          {esTerminado ? '¡Pedido entregado!' : pedido.estado === 'recogido' || pedido.estado === 'en_camino' ? 'Tu pedido está en camino' : 'Repartidor asignado'}
        </div>
        {!esTerminado && pedido.minutos_preparacion && (pedido.estado === 'preparando' || pedido.estado === 'listo') && (
          <div style={{ fontSize: 13, color: '#777', marginTop: 4 }}>Llegada estimada en ~{pedido.minutos_preparacion} min</div>
        )}
      </div>

      <div style={S.stepper}>
        {STEPS.map((s, i) => {
          const active = i <= step
          return (
            <div key={s.id} style={{ flex: 1, textAlign: 'center' }}>
              <div style={{ height: 4, borderRadius: 2, background: active ? '#FF6B2C' : '#E8E6E0', marginBottom: 8 }} />
              <div style={{ fontSize: 11, fontWeight: 700, color: active ? '#1F1F1E' : '#A8A6A0', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{s.label}</div>
            </div>
          )
        })}
      </div>

      {rider && (
        <div style={S.card}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={S.avatar}>{(rider.nombre || '?').slice(0, 1).toUpperCase()}</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 11, color: '#777', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 700 }}>Tu repartidor</div>
              <div style={{ fontSize: 15, fontWeight: 800, color: '#1F1F1E' }}>{rider.nombre}</div>
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
        <div style={{ fontSize: 14, fontWeight: 700, color: '#1F1F1E' }}>{est?.nombre}</div>
        <div style={{ fontSize: 12, color: '#777', marginTop: 2 }}>{est?.direccion}</div>
        {est?.telefono && (
          <a href={`tel:${est.telefono}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 8, fontSize: 12, fontWeight: 700, color: '#FF6B2C' }}>📞 {est.telefono}</a>
        )}
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
}
