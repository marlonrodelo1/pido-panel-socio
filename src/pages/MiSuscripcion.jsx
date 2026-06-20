import { useEffect, useState } from 'react'
import { useSocio } from '../context/SocioContext'
import { colors, ds, type } from '../lib/uiStyles'
import { supabase, FUNCTIONS_URL } from '../lib/supabase'

// Plan Pidoo del socio: 30 €/mes con 7 días de prueba.
// Usa Stripe Checkout (hosted) — el panel socio no tiene Stripe Elements.
// La edge function crear-suscripcion-socio aplica los 7 días de prueba.

const ESTADOS = {
  active:   { label: 'Activa',         color: colors.stateOk,      bg: colors.stateOkSoft },
  trialing: { label: 'Periodo gratis', color: colors.info,         bg: colors.infoSoft },
  pending:  { label: 'Procesando',     color: colors.statePrep,    bg: colors.statePrepSoft },
  past_due: { label: 'Pago pendiente', color: colors.danger,       bg: colors.dangerSoft },
  unpaid:   { label: 'Impagada',       color: colors.danger,       bg: colors.dangerSoft },
  canceled: { label: 'Cancelada',      color: colors.stateNeutral, bg: colors.stateNeutralSoft },
}

export default function MiSuscripcion() {
  const { socio } = useSocio()
  const [sub, setSub] = useState(null)
  const [loading, setLoading] = useState(true)
  const [yendo, setYendo] = useState(false)
  const [err, setErr] = useState(null)

  useEffect(() => {
    if (!socio?.id) return
    load()
    const ch = supabase
      .channel(`sub-socio-${socio.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'suscripciones_socio', filter: `socio_id=eq.${socio.id}` }, load)
      .subscribe()
    return () => supabase.removeChannel(ch)
  }, [socio?.id])

  async function load() {
    const { data } = await supabase
      .from('suscripciones_socio')
      .select('*')
      .eq('socio_id', socio.id)
      .maybeSingle()
    setSub(data || null)
    setLoading(false)
  }

  async function suscribir() {
    setYendo(true); setErr(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(`${FUNCTIONS_URL}/crear-suscripcion-socio`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
        body: JSON.stringify({ socio_id: socio.id, plan: 'mensual' }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'No se pudo iniciar la suscripción')
      if (json.url) { window.location.href = json.url; return }
      throw new Error('Respuesta inesperada del servidor')
    } catch (e) { setErr(e.message); setYendo(false) }
  }

  const estado = sub?.estado || 'none'
  const activa = ['active', 'trialing'].includes(estado)
  const info = ESTADOS[estado]

  return (
    <div style={{ maxWidth: 640 }}>
      <h1 style={ds.h1}>Mi suscripción</h1>
      <p style={{ color: colors.textMute, fontSize: type.sm, marginTop: 4, marginBottom: 22 }}>
        Tu plan de la plataforma Pidoo para tener tu propio marketplace de restaurantes.
      </p>

      {/* Banner aviso 7 días — solo si NO hay plan activo/trial */}
      {!loading && !activa && <Banner7Dias />}

      {loading ? (
        <div style={{ color: colors.textMute, fontSize: type.sm }}>Cargando…</div>
      ) : (
        <>
          {activa ? (
            // ─── Plan activo: tarjeta de estado ───
            <>
              <div style={{ ...ds.card, padding: 22, marginBottom: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <div style={{ ...ds.label, margin: 0 }}>Estado del plan</div>
                  {info && (
                    <span style={{
                      fontSize: type.xxs, fontWeight: 700, padding: '3px 9px', borderRadius: 6,
                      letterSpacing: '0.04em', textTransform: 'uppercase',
                      background: info.bg, color: info.color,
                    }}>{info.label}</span>
                  )}
                </div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                  <span style={{ fontFamily: type.mono, fontSize: 32, fontWeight: 800, color: colors.ink }}>30</span>
                  <span style={{ fontSize: 18, color: colors.ink, fontWeight: 700 }}>€</span>
                  <span style={{ color: colors.stone, fontSize: 14 }}>/mes</span>
                </div>
                <div style={{ fontSize: type.sm, color: colors.stone, marginTop: 6 }}>
                  7 días de prueba al empezar · Cancela cuando quieras.
                </div>
                {sub?.fecha_proximo_pago && (
                  <div style={{ fontSize: type.sm, color: colors.stone, marginTop: 8 }}>
                    Próximo cobro:{' '}
                    <b style={{ color: colors.ink }}>
                      {new Date(sub.fecha_proximo_pago).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' })}
                    </b>
                  </div>
                )}
              </div>

              {(estado === 'past_due' || estado === 'unpaid') && (
                <div style={{
                  padding: 14, borderRadius: 12, marginBottom: 14,
                  background: colors.dangerSoft, color: colors.dangerText,
                  fontSize: type.sm, lineHeight: 1.5,
                }}>
                  <b>Pago pendiente.</b> No hemos podido cobrar tu suscripción; tu marketplace puede quedar desactivado. Regulariza el pago para reactivarlo.
                </div>
              )}

              <div style={{ ...ds.card, padding: 18 }}>
                <div style={{ fontSize: type.sm, color: colors.text, fontWeight: 700, marginBottom: 4 }}>Tu plan está activo</div>
                <div style={{ fontSize: type.sm, color: colors.stone, lineHeight: 1.5 }}>
                  Tu marketplace público está disponible en{' '}
                  <b style={{ color: colors.ink }}>pidoo.es/s/{socio?.slug}</b>.
                </div>
              </div>
            </>
          ) : (
            // ─── Sin plan: plan único 30 €/mes + activar ───
            <>
              <div style={{ ...ds.card, padding: 22, marginBottom: 16 }}>
                <div style={{
                  fontSize: type.xxs, fontWeight: 700, color: colors.textMute,
                  letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 8,
                }}>Plan Pidoo</div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                  <span style={{ fontFamily: type.mono, fontSize: 34, fontWeight: 800, color: colors.ink }}>30</span>
                  <span style={{ fontSize: 18, color: colors.ink, fontWeight: 700 }}>€</span>
                  <span style={{ color: colors.stone, fontSize: 14 }}>/mes</span>
                </div>
                <div style={{ fontSize: type.sm, color: colors.stone, marginTop: 10, lineHeight: 1.5 }}>
                  Tu propio marketplace público en{' '}
                  <b style={{ color: colors.ink }}>pidoo.es/s/{socio?.slug}</b>.
                </div>
                <div style={{ fontSize: type.sm, color: colors.stone, marginTop: 4 }}>
                  7 días de prueba al empezar · Cancela cuando quieras.
                </div>
              </div>

              {(estado === 'past_due' || estado === 'unpaid') && (
                <div style={{
                  padding: 14, borderRadius: 12, marginBottom: 14,
                  background: colors.dangerSoft, color: colors.dangerText,
                  fontSize: type.sm, lineHeight: 1.5,
                }}>
                  <b>Pago pendiente.</b> No hemos podido cobrar tu suscripción; tu marketplace puede quedar desactivado. Regulariza el pago para reactivarlo.
                </div>
              )}

              {err && (
                <div style={{ padding: 12, borderRadius: 8, background: colors.dangerSoft, color: colors.danger, fontSize: type.sm, marginBottom: 14 }}>
                  {err}
                </div>
              )}

              <button
                onClick={suscribir}
                disabled={yendo}
                style={{ ...ds.primaryBtn, height: 48, padding: '0 26px', fontSize: type.base, opacity: yendo ? 0.6 : 1 }}
              >
                {yendo ? 'Redirigiendo a Stripe…' : 'Activar plan · 30 €/mes (7 días gratis)'}
              </button>
            </>
          )}
        </>
      )}
    </div>
  )
}

// ─────────────────────── Sub-componentes ───────────────────────

function Banner7Dias() {
  return (
    <div style={{
      background: colors.warningSoft, color: colors.warning,
      border: `1px solid ${colors.warning}`,
      borderRadius: 12, padding: '12px 14px', marginBottom: 16,
      fontSize: type.sm, lineHeight: 1.5, fontWeight: 600,
      display: 'flex', alignItems: 'center', gap: 10,
    }}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
      <span>
        Tienes 7 días para añadir tu tarjeta y mantener tu marketplace activo. Si no, se pausará.
      </span>
    </div>
  )
}
