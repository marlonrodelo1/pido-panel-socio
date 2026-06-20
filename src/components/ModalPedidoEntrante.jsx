// ModalPedidoEntrante — Overlay full-screen cuando llega una asignación pendiente.
// Countdown 180s, sonido + vibración, botones Aceptar / Rechazar.
import { useEffect, useRef, useState } from 'react'
import { Bike, MapPin, Clock } from 'lucide-react'
import { useRider } from '../context/RiderContext'
import { riderAcceptOrder, riderRejectOrder } from '../lib/riderApi'
import { colors } from '../lib/uiStyles'

const COUNTDOWN_SECONDS = 180

export default function ModalPedidoEntrante() {
  const { asignacionPendiente, dismissPendiente } = useRider() || {}
  const [secondsLeft, setSecondsLeft] = useState(COUNTDOWN_SECONDS)
  const [busy, setBusy] = useState(null) // 'accept' | 'reject' | null
  const audioRef = useRef(null)
  const intervalRef = useRef(null)

  useEffect(() => {
    if (!asignacionPendiente) return
    setSecondsLeft(COUNTDOWN_SECONDS)
    setBusy(null)

    // Sonido loop
    try {
      audioRef.current = new Audio('/sounds/pedido-rider.mp3')
      audioRef.current.loop = true
      audioRef.current.volume = 0.85
      audioRef.current.play().catch(() => { /* user gesture pendiente */ })
    } catch (_) {}

    // Vibración rítmica
    try {
      if (navigator.vibrate) navigator.vibrate([300, 200, 300, 200, 600])
    } catch (_) {}

    // Countdown
    intervalRef.current = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          handleTimeout()
          return 0
        }
        return s - 1
      })
    }, 1000)

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
      try { audioRef.current?.pause() } catch (_) {}
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asignacionPendiente?.id])

  if (!asignacionPendiente) return null

  const pedido = asignacionPendiente.pedidos || {}
  const est = pedido.establecimientos || {}
  const total = Number(pedido.total || 0)

  const mins = Math.floor(secondsLeft / 60)
  const secs = secondsLeft % 60
  const timeStr = `${mins}:${String(secs).padStart(2, '0')}`

  async function handleAccept() {
    if (busy) return
    setBusy('accept')
    try {
      const res = await riderAcceptOrder(asignacionPendiente.id)
      if (!res.ok) console.error('rider-accept fallo:', res.error)
    } finally {
      dismissPendiente?.()
    }
  }

  async function handleReject() {
    if (busy) return
    setBusy('reject')
    try { await riderRejectOrder(asignacionPendiente.id, 'rider_rechaza') }
    finally { dismissPendiente?.() }
  }

  function handleTimeout() {
    dismissPendiente?.()
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 100,
      background: 'rgba(26,24,21,0.92)', backdropFilter: 'blur(6px)',
      display: 'flex', flexDirection: 'column',
      paddingTop: 'calc(env(safe-area-inset-top, 0px) + 24px)',
      paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 18px)',
      paddingLeft: 18, paddingRight: 18,
      fontFamily: "'Plus Jakarta Sans', sans-serif",
      animation: 'fadeIn 0.18s ease',
    }}>
      <div style={{ textAlign: 'center', marginBottom: 22 }}>
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 7,
          background: 'rgba(255,255,255,0.10)', color: '#fff',
          padding: '6px 14px', borderRadius: 999,
          fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
        }}>
          <Bike size={13} /> Nuevo pedido asignado
        </div>
      </div>

      <div style={{
        background: colors.paper, borderRadius: 22,
        padding: 24, marginBottom: 16,
        flex: 1, display: 'flex', flexDirection: 'column', gap: 16,
        animation: 'slideUp 0.25s ease',
      }}>
        <style>{`@keyframes slideUp { from { transform: translateY(20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }`}</style>

        <div>
          <div style={{
            fontSize: 11, color: colors.stone, fontWeight: 700,
            letterSpacing: '0.06em', textTransform: 'uppercase',
          }}>Restaurante</div>
          <div style={{ fontSize: 19, fontWeight: 800, color: colors.ink, marginTop: 2 }}>
            {est.nombre || 'Restaurante'}
          </div>
          {est.direccion && (
            <div style={{
              display: 'flex', alignItems: 'flex-start', gap: 5,
              fontSize: 12, color: colors.stone, marginTop: 4,
            }}>
              <MapPin size={12} strokeWidth={2.2} style={{ flexShrink: 0, marginTop: 1 }} />
              <span>{est.direccion}</span>
            </div>
          )}
        </div>

        <div style={{ height: 1, background: colors.border }} />

        <div>
          <div style={{
            fontSize: 11, color: colors.stone, fontWeight: 700,
            letterSpacing: '0.06em', textTransform: 'uppercase',
          }}>Entregar en</div>
          <div style={{
            display: 'flex', alignItems: 'flex-start', gap: 5,
            fontSize: 14, color: colors.ink, marginTop: 4, fontWeight: 600,
          }}>
            <MapPin size={14} strokeWidth={2.2} style={{ flexShrink: 0, marginTop: 2, color: colors.terracotta }} />
            <span>{pedido.direccion_entrega || '—'}</span>
          </div>
        </div>

        <div style={{ height: 1, background: colors.border }} />

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <div style={{ fontSize: 12, color: colors.stone }}>Total del pedido</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: colors.terracotta }}>
            {total.toFixed(2).replace('.', ',')} €
          </div>
        </div>
      </div>

      {/* Countdown */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
        color: '#fff', marginBottom: 14,
      }}>
        <Clock size={14} strokeWidth={2.4} />
        <span style={{ fontSize: 13, fontFamily: 'ui-monospace, monospace', fontWeight: 700 }}>
          {timeStr}
        </span>
        <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.65)' }}> · responde antes</span>
      </div>

      <div style={{ display: 'flex', gap: 10 }}>
        <button
          onClick={handleReject}
          disabled={busy === 'accept'}
          style={{
            flex: 1, padding: '14px', borderRadius: 14, border: 'none',
            background: 'rgba(255,255,255,0.10)', color: '#fff',
            fontWeight: 700, fontSize: 14, cursor: 'pointer', fontFamily: 'inherit',
            opacity: busy ? 0.6 : 1,
          }}
        >
          {busy === 'reject' ? 'Rechazando…' : 'Rechazar'}
        </button>
        <button
          onClick={handleAccept}
          disabled={busy === 'reject'}
          style={{
            flex: 2, padding: '14px', borderRadius: 14, border: 'none',
            background: `linear-gradient(180deg, ${colors.terracotta} 0%, ${colors.terracotta2} 100%)`,
            color: '#fff', fontWeight: 800, fontSize: 15, cursor: 'pointer', fontFamily: 'inherit',
            boxShadow: '0 8px 20px rgba(197,86,44,0.40), inset 0 1px 0 rgba(255,255,255,0.18)',
            opacity: busy ? 0.6 : 1,
          }}
        >
          {busy === 'accept' ? 'Aceptando…' : 'Aceptar pedido'}
        </button>
      </div>
    </div>
  )
}
