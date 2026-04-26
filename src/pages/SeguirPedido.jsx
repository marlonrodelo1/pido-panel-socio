// Pagina publica de seguimiento de pedido por codigo. Vive en
// socio.pidoo.es/seguir/<codigo>. La APK del cliente carga esta URL en su
// iframe (donde antes iba Shipday), asi que no hace falta actualizar la
// app publicada en stores.

import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const STEPS = [
  { id: 'aceptado', label: 'Aceptado', icon: '✓' },
  { id: 'preparando', label: 'Preparando', icon: '🍳' },
  { id: 'listo', label: 'Listo', icon: '📦' },
  { id: 'en_camino', label: 'En camino', icon: '🛵' },
  { id: 'entregado', label: 'Entregado', icon: '🎉' },
]

function estadoToStep(estado) {
  if (estado === 'aceptado') return 0
  if (estado === 'preparando') return 1
  if (estado === 'listo') return 2
  if (estado === 'recogido' || estado === 'en_camino') return 3
  if (estado === 'entregado') return 4
  return 0
}

export default function SeguirPedido({ codigo }) {
  const [pedido, setPedido] = useState(null)
  const [rider, setRider] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!codigo) return
    let cancel = false

    async function load() {
      const { data: ped, error: pedErr } = await supabase
        .from('pedidos')
        .select('id, codigo, estado, total, direccion_entrega, modo_entrega, recogido_at, entregado_at, minutos_preparacion, establecimiento_id, establecimientos(nombre, telefono)')
        .eq('codigo', (codigo || '').toUpperCase())
        .maybeSingle()
      if (cancel) return
      if (pedErr || !ped) { setError('Pedido no encontrado'); setLoading(false); return }
      setPedido(ped)

      const { data: asig } = await supabase
        .from('pedido_asignaciones')
        .select('estado, aceptado_at, recogido_at, entregado_at, rider_accounts!inner(socio_id, socios!inner(nombre, telefono, rating))')
        .eq('pedido_id', ped.id)
        .in('estado', ['aceptado'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (cancel) return
      if (asig) {
        const s = asig.rider_accounts?.socios
        setRider({
          nombre: s?.nombre || 'Repartidor',
          telefono: s?.telefono || null,
          rating: s?.rating || null,
        })
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

  if (loading) {
    return (
      <div style={S.wrap}>
        <div style={S.card}>
          <div style={{ textAlign: 'center', padding: 40, color: '#777' }}>Cargando…</div>
        </div>
      </div>
    )
  }

  if (error || !pedido) {
    return (
      <div style={S.wrap}>
        <div style={S.card}>
          <div style={{ textAlign: 'center', padding: 40 }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>🔍</div>
            <div style={{ fontWeight: 700, fontSize: 16 }}>{error || 'Pedido no encontrado'}</div>
            <div style={{ fontSize: 13, color: '#777', marginTop: 6 }}>Verifica el código del pedido.</div>
          </div>
        </div>
      </div>
    )
  }

  const step = estadoToStep(pedido.estado)
  const est = pedido.establecimientos
  const esTerminado = pedido.estado === 'entregado' || pedido.estado === 'cancelado'

  return (
    <div style={S.wrap}>
      <div style={S.card}>
        <div style={S.header}>
          <img src="/favicon.svg" alt="Pidoo" style={{ width: 28, height: 28 }} />
          <div>
            <div style={{ fontSize: 14, fontWeight: 800, color: '#1F1F1E' }}>Pidoo</div>
            <div style={{ fontSize: 11, color: '#777' }}>Seguimiento del pedido</div>
          </div>
        </div>

        <div style={{ padding: '20px 24px 8px' }}>
          <div style={{ fontSize: 12, color: '#777', letterSpacing: '0.04em', textTransform: 'uppercase', fontWeight: 700 }}>
            Pedido #{pedido.codigo}
          </div>
          <div style={{ fontSize: 18, fontWeight: 800, color: '#1F1F1E', marginTop: 4 }}>
            {est?.nombre}
          </div>
          {pedido.minutos_preparacion && pedido.estado === 'preparando' && (
            <div style={{ fontSize: 12, color: '#FF6B2C', marginTop: 4, fontWeight: 700 }}>
              Llegará en ~{pedido.minutos_preparacion} min
            </div>
          )}
        </div>

        <div style={S.stepper}>
          {STEPS.map((s, i) => {
            const active = i <= step
            const current = i === step && !esTerminado
            return (
              <div key={s.id} style={{ flex: 1, position: 'relative' }}>
                <div style={{
                  width: 36, height: 36, borderRadius: 18, margin: '0 auto',
                  background: active ? '#FF6B2C' : '#EEE',
                  color: active ? '#fff' : '#999',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontWeight: 700, fontSize: 14,
                  boxShadow: current ? '0 0 0 6px rgba(255,107,44,0.18)' : 'none',
                  transition: 'all 0.3s',
                }}>{s.icon}</div>
                <div style={{ fontSize: 10, fontWeight: 700, textAlign: 'center', marginTop: 6, color: active ? '#1F1F1E' : '#999', letterSpacing: '0.02em', textTransform: 'uppercase' }}>
                  {s.label}
                </div>
                {i < STEPS.length - 1 && (
                  <div style={{ position: 'absolute', top: 18, left: '60%', right: '-40%', height: 2, background: i < step ? '#FF6B2C' : '#EEE' }} />
                )}
              </div>
            )
          })}
        </div>

        {pedido.modo_entrega === 'delivery' && (
          <div style={S.section}>
            {rider ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 44, height: 44, borderRadius: 22, background: 'rgba(255,107,44,0.15)', color: '#FF6B2C', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 }}>
                  {(rider.nombre || '?').slice(0, 1).toUpperCase()}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, color: '#777', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 700 }}>Tu repartidor</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#1F1F1E' }}>{rider.nombre}</div>
                  {rider.rating > 0 && <div style={{ fontSize: 11, color: '#777' }}>⭐ {Number(rider.rating).toFixed(1)}</div>}
                </div>
                {rider.telefono && (
                  <a href={`tel:${rider.telefono}`} style={{
                    width: 40, height: 40, borderRadius: 20, background: '#FF6B2C', color: '#fff',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', textDecoration: 'none',
                  }}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.13.96.37 1.9.72 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.91.35 1.85.59 2.81.72A2 2 0 0122 16.92z"/></svg>
                  </a>
                )}
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: '12px 0' }}>
                <div style={{ fontSize: 24, marginBottom: 6 }}>🛵</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#1F1F1E' }}>Buscando repartidor…</div>
                <div style={{ fontSize: 11, color: '#777', marginTop: 2 }}>Te avisaremos cuando uno acepte tu pedido</div>
              </div>
            )}
          </div>
        )}

        <div style={S.footer}>
          <div>
            <div style={{ fontSize: 11, color: '#777', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 700 }}>Total</div>
            <div style={{ fontSize: 18, fontWeight: 800, color: '#1F1F1E' }}>€{Number(pedido.total || 0).toFixed(2)}</div>
          </div>
          {est?.telefono && (
            <a href={`tel:${est.telefono}`} style={{
              padding: '10px 16px', borderRadius: 8, border: '1px solid #E8E6E0',
              background: '#fff', color: '#1F1F1E', fontSize: 12, fontWeight: 700,
              textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6,
            }}>
              📞 Restaurante
            </a>
          )}
        </div>
      </div>
      <div style={{ textAlign: 'center', fontSize: 11, color: '#999', marginTop: 14 }}>
        Hecho con 🛵 por <strong style={{ color: '#FF6B2C' }}>Pidoo</strong>
      </div>
    </div>
  )
}

const S = {
  wrap: {
    minHeight: '100vh', background: '#FAFAF7',
    padding: '20px 14px', fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
    display: 'flex', flexDirection: 'column', alignItems: 'center',
  },
  card: {
    width: '100%', maxWidth: 500,
    background: '#fff', borderRadius: 18,
    boxShadow: '0 4px 16px rgba(15,15,15,0.06)',
    overflow: 'hidden',
  },
  header: {
    padding: '16px 24px', borderBottom: '1px solid #EEE',
    display: 'flex', alignItems: 'center', gap: 10,
  },
  stepper: {
    display: 'flex', alignItems: 'flex-start', gap: 4,
    padding: '20px 18px 24px',
  },
  section: {
    margin: '0 18px 16px',
    padding: 14, borderRadius: 12,
    background: '#FAFAF7', border: '1px solid #EEE',
  },
  footer: {
    padding: '14px 18px',
    borderTop: '1px solid #EEE',
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
  },
}
