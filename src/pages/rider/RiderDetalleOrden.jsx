// Detalle de un pedido asignado al rider. Replica la pantalla "Detalles de
// orden" de la captura: estado, recolectar (origen + tel), entrega (destino +
// tel), desglose economico y CTA segun estado.

import { useEffect, useState } from 'react'
import { colors, type, ds } from '../../lib/uiStyles'
import { supabase } from '../../lib/supabase'
import { useRider } from '../../context/RiderContext'

function fmtFecha(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true })
}

function openMaps(lat, lng) {
  if (typeof window === 'undefined' || !lat || !lng) return
  const ua = navigator.userAgent || ''
  const isIOS = /iPad|iPhone|iPod/.test(ua)
  const url = isIOS ? `maps:?daddr=${lat},${lng}` : `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`
  window.open(url, '_blank')
}

export default function RiderDetalleOrden({ asignacionId, onBack }) {
  const { asignaciones, pickup, deliver, failDeliver } = useRider()
  const [extra, setExtra] = useState(null)
  const [busy, setBusy] = useState(false)
  const [showFailModal, setShowFailModal] = useState(false)
  const [failMotivo, setFailMotivo] = useState('')

  const asig = asignaciones.find((a) => a.id === asignacionId)

  useEffect(() => {
    if (!asig?.pedido_id) return
    let cancel = false
    ;(async () => {
      const { data } = await supabase
        .from('pedidos')
        .select('subtotal, coste_envio, propina, descuento, total, codigo, created_at')
        .eq('id', asig.pedido_id)
        .maybeSingle()
      if (!cancel) setExtra(data || null)
    })()
    return () => { cancel = true }
  }, [asig?.pedido_id])

  if (!asig) {
    return (
      <div style={{ padding: 30, textAlign: 'center', color: colors.textMute }}>
        <div style={{ fontSize: type.base, fontWeight: 600, color: colors.text }}>Pedido no disponible</div>
        <button onClick={onBack} style={{ ...ds.secondaryBtn, marginTop: 16 }}>Volver</button>
      </div>
    )
  }

  const ped = asig.pedidos
  const est = ped?.establecimientos
  const recogido = !!asig.recogido_at

  const stateBadge = recogido
    ? { label: 'Recolectado', bg: colors.statePrepSoft, color: colors.statePrep }
    : { label: 'Iniciada', bg: colors.statePrepSoft, color: colors.statePrep }

  const handlePickup = async () => {
    if (busy) return
    setBusy(true)
    try {
      await pickup(asig.id)
    } catch (e) {
      alert('Error: ' + (e?.message || 'desconocido'))
    } finally {
      setBusy(false)
    }
  }

  const handleComplete = async () => {
    if (busy) return
    setBusy(true)
    try {
      await deliver(asig.id, null)
      onBack?.()
    } catch (e) {
      alert('Error: ' + (e?.message || 'desconocido'))
    } finally {
      setBusy(false)
    }
  }

  const handleFailConfirm = async () => {
    const motivo = failMotivo.trim()
    if (!motivo) {
      alert('Indica un motivo para la entrega fallida.')
      return
    }
    if (busy) return
    setBusy(true)
    try {
      await failDeliver(asig.id, motivo)
      setShowFailModal(false)
      setFailMotivo('')
      onBack?.()
    } catch (e) {
      alert('Error: ' + (e?.message || 'desconocido'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderBottom: `1px solid ${colors.border}`, background: colors.surface }}>
        <button onClick={onBack} style={{ background: 'transparent', border: 'none', color: colors.text, cursor: 'pointer', padding: 6 }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>
        </button>
        <div style={{ flex: 1, fontSize: type.base, fontWeight: 700, textAlign: 'center' }}>Detalles de orden</div>
        <div style={{ width: 22 }} />
      </div>

      <div style={{ padding: '14px 14px 90px' }}>
        {/* Cabecera con codigo + total + badge + boton navegar */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 6 }}>
          <div>
            <div style={{ fontSize: type.xxs, color: colors.textMute, fontWeight: 600 }}>Orden #</div>
            <div style={{ fontSize: type.lg, fontWeight: 800, color: colors.text }}>
              {ped?.codigo} <span style={{ fontSize: type.sm, color: colors.textMute, fontWeight: 600 }}>(€{Number(extra?.total || ped?.total || 0).toFixed(2)})</span>
            </div>
          </div>
          <span style={{ ...ds.badge, background: stateBadge.bg, color: stateBadge.color }}>
            {stateBadge.label}
          </span>
        </div>
        <div style={{ fontSize: type.xs, color: colors.textMute, marginBottom: 14 }}>
          Tiempo de colocación: {fmtFecha(extra?.created_at || ped?.created_at)}
        </div>

        <div style={{ height: 1, background: colors.border, marginBottom: 14 }} />

        {/* Recolectar */}
        <div style={{ display: 'flex', gap: 12, marginBottom: 18 }}>
          <span style={{ marginTop: 4, width: 14, height: 14, borderRadius: 7, border: `2px solid ${colors.text}`, flexShrink: 0 }} />
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ fontSize: type.xs, color: colors.textMute, fontWeight: 600 }}>Recolectar</span>
              <span style={{ fontSize: type.xs, color: colors.textMute }}>—</span>
            </div>
            <div style={{ fontSize: type.base, fontWeight: 700, color: colors.text, marginBottom: 4 }}>
              {est?.nombre || '—'}
            </div>
            <div style={{ fontSize: type.xs, color: colors.textMute, marginBottom: 8 }}>
              {est?.direccion || '—'}
            </div>
            <div style={{ display: 'flex', gap: 12 }}>
              {est?.telefono && (
                <a href={`tel:${est.telefono}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: colors.text, fontSize: type.sm, textDecoration: 'none' }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.13.96.37 1.9.72 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.91.35 1.85.59 2.81.72A2 2 0 0122 16.92z"/></svg>
                  {est.telefono}
                </a>
              )}
              {est?.latitud && est?.longitud && (
                <button onClick={() => openMaps(est.latitud, est.longitud)} style={{ background: 'transparent', border: 'none', color: colors.primary, fontSize: type.sm, fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg>
                  Navegar
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Entrega */}
        <div style={{ display: 'flex', gap: 12, marginBottom: 22 }}>
          <span style={{ marginTop: 4, width: 14, height: 18, background: colors.primary, borderRadius: '50% 50% 50% 0', transform: 'rotate(-45deg)', flexShrink: 0 }} />
          <div style={{ flex: 1 }}>
            <span style={{ fontSize: type.xs, color: colors.textMute, fontWeight: 600 }}>Entrega</span>
            <div style={{ fontSize: type.base, fontWeight: 700, color: colors.text, marginTop: 4 }}>
              {ped?.direccion_entrega || '—'}
            </div>
            {ped?.lat_entrega && ped?.lng_entrega && (
              <button onClick={() => openMaps(ped.lat_entrega, ped.lng_entrega)} style={{ marginTop: 8, background: 'transparent', border: 'none', color: colors.primary, fontSize: type.sm, fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6, padding: 0 }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg>
                Navegar
              </button>
            )}
          </div>
        </div>

        <div style={{ height: 1, background: colors.border, marginBottom: 14 }} />

        {/* Desglose economico */}
        <div style={{ fontSize: type.sm, color: colors.text, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Row label="Cargos por envío" value={`€${Number(extra?.coste_envio || 0).toFixed(2)}`} />
          <Row label="Propina de entrega" value={`€${Number(extra?.propina || 0).toFixed(2)}`} />
          {extra?.descuento > 0 && <Row label="Descuento" value={`€${Number(extra.descuento).toFixed(2)}`} color={colors.danger} />}
          <div style={{ height: 1, background: colors.border, margin: '6px 0' }} />
          <Row label="Total" value={`€${Number(extra?.total || ped?.total || 0).toFixed(2)}`} bold />
        </div>
      </div>

      {/* CTA fijo abajo */}
      <div style={{ position: 'fixed', bottom: 'calc(70px + env(safe-area-inset-bottom))', left: 0, right: 0, padding: '0 14px', zIndex: 5 }}>
        {!recogido ? (
          <button onClick={handlePickup} disabled={busy} style={{
            ...ds.primaryBtn, width: '100%', height: 48, fontSize: type.base,
            boxShadow: colors.shadowMd,
          }}>
            {busy ? 'Procesando…' : 'Marcar como recogido →'}
          </button>
        ) : (
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={() => setShowFailModal(true)} disabled={busy} style={{
              flex: 1, height: 48, fontSize: type.base, fontWeight: 700,
              background: '#fff', color: colors.danger,
              border: `1.5px solid ${colors.danger}`, borderRadius: 12,
              cursor: 'pointer', boxShadow: colors.shadowMd,
            }}>
              Entrega fallida
            </button>
            <button onClick={handleComplete} disabled={busy} style={{
              flex: 1, height: 48, fontSize: type.base, fontWeight: 700,
              background: colors.primary, color: '#fff', border: 'none',
              borderRadius: 12, cursor: 'pointer', boxShadow: colors.shadowMd,
            }}>
              {busy ? 'Procesando…' : 'Entrega completada'}
            </button>
          </div>
        )}
      </div>

      {showFailModal && (
        <div
          onClick={() => !busy && setShowFailModal(false)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
            display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
            zIndex: 50,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: colors.surface, borderRadius: '16px 16px 0 0',
              width: '100%', maxWidth: 520, padding: 20,
              paddingBottom: 'calc(20px + env(safe-area-inset-bottom))',
            }}
          >
            <div style={{ fontSize: type.lg, fontWeight: 800, color: colors.text, marginBottom: 6 }}>
              Marcar entrega como fallida
            </div>
            <div style={{ fontSize: type.sm, color: colors.textMute, marginBottom: 14 }}>
              Indica el motivo. Esta accion cierra el pedido como fallido y no
              se reasigna a otro rider.
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
              {['Cliente no aparece', 'Direccion incorrecta', 'No contesta al telefono', 'Comercio cerrado', 'Producto deteriorado'].map((m) => (
                <button
                  key={m}
                  onClick={() => setFailMotivo(m)}
                  style={{
                    background: failMotivo === m ? colors.primary : colors.surface2,
                    color:      failMotivo === m ? '#fff' : colors.text,
                    border: `1px solid ${failMotivo === m ? colors.primary : colors.border}`,
                    padding: '6px 12px', borderRadius: 999,
                    fontSize: type.xs, fontWeight: 600, cursor: 'pointer',
                  }}
                >{m}</button>
              ))}
            </div>

            <textarea
              value={failMotivo}
              onChange={(e) => setFailMotivo(e.target.value)}
              placeholder="Motivo de la entrega fallida"
              rows={3}
              style={{
                width: '100%', boxSizing: 'border-box',
                background: colors.bg, color: colors.text,
                border: `1px solid ${colors.border}`, borderRadius: 10,
                padding: 12, fontSize: type.sm, resize: 'vertical',
                marginBottom: 14, fontFamily: 'inherit',
              }}
            />

            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setShowFailModal(false)} disabled={busy} style={{
                ...ds.secondaryBtn, flex: 1, height: 44,
              }}>Cancelar</button>
              <button onClick={handleFailConfirm} disabled={busy || !failMotivo.trim()} style={{
                flex: 1, height: 44, fontSize: type.sm, fontWeight: 700,
                background: colors.danger, color: '#fff', border: 'none',
                borderRadius: 10, cursor: busy || !failMotivo.trim() ? 'not-allowed' : 'pointer',
                opacity: busy || !failMotivo.trim() ? 0.6 : 1,
              }}>
                {busy ? 'Enviando…' : 'Confirmar fallo'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Row({ label, value, bold, color }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
      <span style={{ color: color || colors.text, fontWeight: bold ? 800 : 400, fontSize: bold ? type.base : type.sm }}>{label}:</span>
      <span style={{ color: color || colors.text, fontWeight: bold ? 800 : 600, fontSize: bold ? type.base : type.sm }}>{value}</span>
    </div>
  )
}
