// Modal full-screen con countdown 45s para aceptar/rechazar un pedido nuevo.
// Si se agota el tiempo o el rider rechaza, la edge function reassign-pedido-v2
// se encarga de pasarlo al siguiente.

import { useEffect, useRef, useState } from 'react'
import { colors, type, ds } from '../lib/uiStyles'

const COUNTDOWN_S = 180 // 3 minutos para aceptar

export default function ModalPedidoEntrante({ asignacion, onAccept, onReject, onClose }) {
  const [secs, setSecs] = useState(COUNTDOWN_S)
  const [busy, setBusy] = useState(false)
  const audioRef = useRef(null)

  useEffect(() => {
    setSecs(COUNTDOWN_S)
    const id = setInterval(() => setSecs((s) => Math.max(0, s - 1)), 1000)

    // Sonido: 1) intenta /sounds/pedido-rider.mp3, 2) fallback a beep WebAudio.
    let stopBeep = null
    try {
      const a = new Audio('/sounds/pedido-rider.mp3')
      a.loop = true
      a.play().then(() => { audioRef.current = a })
        .catch(() => { stopBeep = startWebAudioBeep() })
    } catch (_) {
      stopBeep = startWebAudioBeep()
    }

    return () => {
      clearInterval(id)
      try { audioRef.current?.pause() } catch (_) {}
      audioRef.current = null
      try { stopBeep?.() } catch (_) {}
    }
  }, [asignacion?.id])

  function startWebAudioBeep() {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext
      if (!Ctx) return null
      const ctx = new Ctx()
      let stopped = false
      const tick = () => {
        if (stopped) return
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.type = 'sine'
        osc.frequency.value = 880
        gain.gain.setValueAtTime(0, ctx.currentTime)
        gain.gain.linearRampToValueAtTime(0.3, ctx.currentTime + 0.02)
        gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.25)
        osc.connect(gain).connect(ctx.destination)
        osc.start()
        osc.stop(ctx.currentTime + 0.3)
        setTimeout(tick, 1200)
      }
      tick()
      return () => { stopped = true; try { ctx.close() } catch (_) {} }
    } catch (_) {
      return null
    }
  }

  if (!asignacion) return null

  const ped = asignacion.pedidos
  const est = ped?.establecimientos
  const distKm = (asignacion.distancia_metros / 1000).toFixed(1)

  const handleAccept = async () => {
    if (busy) return
    setBusy(true)
    try { await onAccept?.(asignacion.id) } finally { setBusy(false) }
  }

  const handleReject = async () => {
    if (busy) return
    setBusy(true)
    try { await onReject?.(asignacion.id, 'manual') } finally { setBusy(false) }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: 'rgba(15,15,15,0.55)',
      display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
    }}>
      <div style={{
        background: colors.surface, width: '100%', maxWidth: 560,
        borderTopLeftRadius: 20, borderTopRightRadius: 20,
        padding: '20px 20px calc(20px + env(safe-area-inset-bottom))',
        boxShadow: colors.shadowLg,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <span style={{ ...ds.badge, background: colors.primarySoft, color: colors.primary, border: `1px solid ${colors.primaryBorder}` }}>
            Nuevo pedido
          </span>
          <span style={{ fontSize: type.lg, fontWeight: 800, color: secs <= 30 ? colors.danger : colors.text }}>
            {secs >= 60 ? `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}` : `${secs}s`}
          </span>
        </div>

        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: type.xl, fontWeight: 800, color: colors.text }}>
            {est?.nombre || '—'}
          </div>
          <div style={{ fontSize: type.xs, color: colors.textMute, marginTop: 4 }}>
            #{ped?.codigo} · {distKm} km · {ped?.modo_entrega}
          </div>
        </div>

        <div style={{ ...ds.card, marginBottom: 14, padding: 14 }}>
          <div style={{ fontSize: type.xxs, fontWeight: 700, color: colors.textMute, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
            Recoger en
          </div>
          <div style={{ fontSize: type.sm, color: colors.text, fontWeight: 600 }}>
            {est?.nombre}
          </div>
          <div style={{ fontSize: type.xs, color: colors.textMute, marginTop: 2 }}>
            {est?.direccion}
          </div>
        </div>

        <div style={{ ...ds.card, marginBottom: 18, padding: 14 }}>
          <div style={{ fontSize: type.xxs, fontWeight: 700, color: colors.textMute, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
            Entregar en
          </div>
          <div style={{ fontSize: type.sm, color: colors.text, fontWeight: 600 }}>
            {ped?.direccion_entrega || '—'}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={handleReject} disabled={busy} style={{
            ...ds.dangerBtn, flex: 1, height: 48, fontSize: type.base,
          }}>
            Rechazar
          </button>
          <button onClick={handleAccept} disabled={busy} style={{
            ...ds.primaryBtn, flex: 2, height: 48, fontSize: type.base,
          }}>
            Aceptar pedido
          </button>
        </div>
      </div>
    </div>
  )
}
