import { useEffect, useState } from 'react'
import { useSocio } from '../context/SocioContext'
import { colors, ds, type } from '../lib/uiStyles'
import { supabase, FUNCTIONS_URL } from '../lib/supabase'

export default function Configuracion() {
  const { socio, updateSocio, logout } = useSocio()
  const [form, setForm] = useState({
    nombre: socio?.nombre || '',
    telefono: socio?.telefono || '',
    razon_social: socio?.razon_social || '',
    nif: socio?.nif || '',
    direccion_fiscal: socio?.direccion_fiscal || '',
    codigo_postal: socio?.codigo_postal || '',
    ciudad: socio?.ciudad || '',
    provincia: socio?.provincia || '',
    pais: socio?.pais || 'España',
    iban: socio?.iban || '',
    iva_pct: socio?.iva_pct ?? 21,
  })
  const [saving, setSaving] = useState(false)
  const [ok, setOk] = useState(false)
  const [err, setErr] = useState(null)

  useEffect(() => {
    if (!socio) return
    setForm({
      nombre: socio.nombre || '',
      telefono: socio.telefono || '',
      razon_social: socio.razon_social || '',
      nif: socio.nif || '',
      direccion_fiscal: socio.direccion_fiscal || '',
      codigo_postal: socio.codigo_postal || '',
      ciudad: socio.ciudad || '',
      provincia: socio.provincia || '',
      pais: socio.pais || 'España',
      iban: socio.iban || '',
      iva_pct: socio.iva_pct ?? 21,
    })
  }, [socio])

  const fiscalCompleto = !!(socio?.razon_social && socio?.nif && socio?.direccion_fiscal && socio?.codigo_postal && socio?.ciudad && socio?.iban)

  const save = async () => {
    setSaving(true); setErr(null); setOk(false)
    try {
      await updateSocio({
        nombre: form.nombre,
        telefono: form.telefono || null,
        razon_social: form.razon_social || null,
        nif: form.nif ? form.nif.trim().toUpperCase() : null,
        direccion_fiscal: form.direccion_fiscal || null,
        codigo_postal: form.codigo_postal || null,
        ciudad: form.ciudad || null,
        provincia: form.provincia || null,
        pais: form.pais || 'España',
        iban: form.iban ? form.iban.replace(/\s+/g, '').toUpperCase() : null,
        iva_pct: form.iva_pct === '' || form.iva_pct == null ? 21 : Number(form.iva_pct),
      })
      setOk(true); setTimeout(() => setOk(false), 2500)
    } catch (e) { setErr(e.message) }
    finally { setSaving(false) }
  }

  return (
    <div style={{ maxWidth: 800 }}>
      <h1 style={ds.h1}>Configuración</h1>
      <p style={{ color: colors.textMute, fontSize: type.sm, marginTop: 4, marginBottom: 22 }}>
        Datos personales y fiscales.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* Mi suscripción Pidoo — acceso accesible también en móvil */}
        <SuscripcionAccesoCard />

        {/* Datos personales */}
        <Card>
          <h2 style={{ ...ds.h2, marginBottom: 14 }}>Datos personales</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 12 }}>
            <Field label="Nombre completo">
              <input value={form.nombre} onChange={e => setForm({ ...form, nombre: e.target.value })} style={ds.input} />
            </Field>
            <Field label="Teléfono">
              <input value={form.telefono} onChange={e => setForm({ ...form, telefono: e.target.value })}
                placeholder="+34 600 000 000" style={ds.input} />
            </Field>
          </div>
        </Card>

        {/* Datos fiscales */}
        <Card>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
            <h2 style={{ ...ds.h2, margin: 0 }}>Datos fiscales</h2>
            <ChipDot tone={fiscalCompleto ? 'sage' : 'danger'}>
              {fiscalCompleto ? 'Completos' : 'Incompletos'}
            </ChipDot>
          </div>
          <p style={{ fontSize: type.xs, color: colors.textMute, marginBottom: 14, lineHeight: 1.5 }}>
            Estos datos aparecerán en las facturas que emitas a los restaurantes.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 12 }}>
            <Field label="Razón social / nombre fiscal">
              <input value={form.razon_social} onChange={e => setForm({ ...form, razon_social: e.target.value })}
                placeholder="Ej. Juan Pérez García" style={ds.input} />
            </Field>
            <Field label="NIF / DNI">
              <input value={form.nif} onChange={e => setForm({ ...form, nif: e.target.value })}
                placeholder="12345678Z" style={ds.input} />
            </Field>
            <Field label="Dirección fiscal" full>
              <input value={form.direccion_fiscal} onChange={e => setForm({ ...form, direccion_fiscal: e.target.value })}
                placeholder="Calle, número, piso" style={ds.input} />
            </Field>
            <Field label="Código postal">
              <input value={form.codigo_postal} onChange={e => setForm({ ...form, codigo_postal: e.target.value })}
                placeholder="38001" style={ds.input} />
            </Field>
            <Field label="Ciudad">
              <input value={form.ciudad} onChange={e => setForm({ ...form, ciudad: e.target.value })}
                placeholder="Santa Cruz de Tenerife" style={ds.input} />
            </Field>
            <Field label="Provincia">
              <input value={form.provincia} onChange={e => setForm({ ...form, provincia: e.target.value })}
                placeholder="Santa Cruz de Tenerife" style={ds.input} />
            </Field>
            <Field label="País">
              <input value={form.pais} onChange={e => setForm({ ...form, pais: e.target.value })} style={ds.input} />
            </Field>
            <Field label="IBAN" full>
              <input value={form.iban} onChange={e => setForm({ ...form, iban: e.target.value })}
                placeholder="ES00 0000 0000 0000 0000 0000"
                style={{ ...ds.input, fontFamily: type.mono }} />
            </Field>
            <Field label="IVA aplicable (%)">
              <input type="number" min="0" max="21" step="0.01"
                value={form.iva_pct}
                onChange={e => setForm({ ...form, iva_pct: e.target.value })}
                style={ds.input} />
            </Field>
          </div>
          <div style={{
            marginTop: 12, padding: '10px 12px',
            background: colors.surface2, borderRadius: 10,
            fontSize: type.xs, color: colors.textMute,
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
            Canarias 0% · Península 21% · Ceuta y Melilla IPSI.
          </div>
        </Card>

        {/* Facturación Pidoo */}
        <FacturacionPidooCard socio={socio} />

        {err && (
          <div style={{
            background: colors.dangerSoft, color: colors.danger,
            padding: '10px 14px', borderRadius: 10,
            fontSize: type.xs, fontWeight: 600,
          }}>{err}</div>
        )}
        {ok && (
          <div style={{
            background: colors.sageSoft, color: colors.sage2,
            padding: '10px 14px', borderRadius: 10,
            fontSize: type.xs, fontWeight: 600,
          }}>Cambios guardados.</div>
        )}

        {/* Acciones */}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <button onClick={logout} style={{
            ...ds.dangerBtn,
            background: colors.dangerSoft, border: `1px solid ${colors.dangerSoft}`,
            color: colors.danger,
            display: 'inline-flex', alignItems: 'center', gap: 8,
          }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
            Cerrar sesión
          </button>
          <div style={{ flex: 1 }}/>
          <button onClick={save} disabled={saving} style={{ ...ds.glossyBtn, opacity: saving ? 0.6 : 1 }}>
            {saving ? 'Guardando…' : 'Guardar cambios'}
          </button>
        </div>

        {/* Zona peligrosa */}
        <div style={{
          marginTop: 8, padding: 18,
          borderRadius: 14, background: colors.dangerSoft,
        }}>
          <div style={{
            fontSize: 11, fontWeight: 800, color: colors.danger,
            textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8,
          }}>Zona peligrosa</div>
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            gap: 12, flexWrap: 'wrap',
          }}>
            <div style={{ fontSize: type.sm, color: colors.danger }}>
              Esto borrará tu cuenta y todos los datos asociados.
            </div>
            <button
              onClick={() => { try { window.dispatchEvent(new CustomEvent('pidoo:goto', { detail: 'eliminar-cuenta' })) } catch (_) {} }}
              style={{ ...ds.dangerBtn, background: 'transparent' }}
            >
              Eliminar cuenta
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────── Sub-components ───────────────────────

function Card({ children, style }) {
  return <div style={{ ...ds.card, padding: 20, ...style }}>{children}</div>
}

// Acceso a la página de suscripción. En desktop existe en el menú lateral,
// pero en móvil (BottomNav) no hay entrada → este botón da acceso desde Ajustes.
function SuscripcionAccesoCard() {
  const irASuscripcion = () => {
    try { window.dispatchEvent(new CustomEvent('pidoo:goto', { detail: 'suscripcion' })) } catch (_) {}
  }
  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{
          width: 44, height: 44, borderRadius: 11,
          background: colors.terracottaSoft, color: colors.terracotta,
          display: 'grid', placeItems: 'center', flexShrink: 0,
        }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ ...ds.h2, margin: 0 }}>Mi suscripción</div>
          <div style={{ fontSize: type.xs, color: colors.textMute, marginTop: 2 }}>
            Tu plan Pidoo para tener tu marketplace público.
          </div>
        </div>
        <button onClick={irASuscripcion} style={{ ...ds.secondaryBtn, whiteSpace: 'nowrap' }}>
          Ver suscripción
        </button>
      </div>
    </Card>
  )
}

function Field({ label, children, full }) {
  return (
    <div style={full ? { gridColumn: '1 / -1' } : undefined}>
      <label style={ds.label}>{label}</label>
      {children}
    </div>
  )
}

function ChipDot({ tone, children }) {
  const m = {
    sage:    { bg: colors.sageSoft,    color: colors.sage2,    dot: colors.sage2 },
    danger:  { bg: colors.dangerSoft,  color: colors.danger,   dot: colors.danger },
    warning: { bg: colors.warningSoft, color: colors.warning,  dot: colors.warning },
  }[tone] || { bg: colors.surface2, color: colors.textDim, dot: colors.textMute }
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      fontSize: 11, fontWeight: 700,
      padding: '4px 10px', borderRadius: 999,
      background: m.bg, color: m.color,
      letterSpacing: '0.02em',
    }}>
      <span style={{ width: 6, height: 6, borderRadius: 3, background: m.dot }}/>
      {children}
    </span>
  )
}

// ─────────────── Facturación Pidoo ───────────────
function FacturacionPidooCard({ socio }) {
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)

  if (!socio) return null

  const n = socio.n_riders_actual ?? 1
  const activa = !!socio.facturacion_multirider_activa
  const estado = socio.multirider_estado || 'al_dia'
  const proximoPago = socio.multirider_proximo_pago

  const fmtFecha = (iso) => {
    if (!iso) return '—'
    try { return new Date(iso).toLocaleDateString('es-ES', { day: '2-digit', month: 'long', year: 'numeric' }) }
    catch { return '—' }
  }

  const pagarAhora = async () => {
    setBusy(true); setMsg(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const r = await fetch(`${FUNCTIONS_URL}/gestionar-facturacion-socio-multirider`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token || ''}`,
          'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({ socio_id: socio.id, accion: 'crear' }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Error')
      setMsg(j.client_secret
        ? 'Para regularizar el pago, contacta a soporte (próximamente: Stripe Checkout integrado).'
        : 'Suscripción reactivada.')
    } catch (e) {
      setMsg(e.message || 'Error')
    } finally {
      setBusy(false)
    }
  }

  // ─── Impago ───
  if (activa && estado === 'impago') {
    return (
      <Card style={{ background: colors.dangerSoft, borderColor: colors.danger }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
          <div style={{
            width: 44, height: 44, borderRadius: 11,
            background: colors.danger, color: '#fff',
            display: 'grid', placeItems: 'center',
          }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ ...ds.h2, margin: 0, color: colors.danger }}>Suscripción multi-rider impagada</div>
            <div style={{ fontSize: type.xs, color: colors.danger, marginTop: 2 }}>
              Tienes {n} rider{n === 1 ? '' : 's'} activo{n === 1 ? '' : 's'}.
            </div>
          </div>
        </div>
        <p style={{ fontSize: type.sm, color: colors.text, lineHeight: 1.5, marginBottom: 12 }}>
          No hemos podido cobrar tu plan multi-rider de <strong>39 €/mes</strong>. Tu marketplace está
          desactivado y no recibirás pedidos hasta que regularices el pago.
        </p>
        <button onClick={pagarAhora} disabled={busy} style={{
          ...ds.glossyBtn,
          background: colors.danger, borderColor: colors.danger,
          opacity: busy ? 0.6 : 1,
        }}>
          {busy ? 'Procesando…' : 'Pagar ahora'}
        </button>
        {msg && <div style={{ fontSize: type.xs, color: colors.textDim, marginTop: 10 }}>{msg}</div>}
      </Card>
    )
  }

  // ─── 1 rider, sin plan ───
  if (n <= 1 && !activa) {
    return (
      <Card>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
          <div style={{
            width: 44, height: 44, borderRadius: 11,
            background: colors.terracottaSoft, color: colors.terracotta,
            display: 'grid', placeItems: 'center',
          }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ ...ds.h2, margin: 0 }}>Mi facturación Pidoo</div>
            <div style={{ fontSize: type.xs, color: colors.textMute, marginTop: 2 }}>Plan multi-rider · primer rider gratis</div>
          </div>
          <ChipDot tone="sage">Sin coste</ChipDot>
        </div>
        <p style={{ fontSize: type.sm, color: colors.textDim, lineHeight: 1.5 }}>
          Ahora tienes <strong style={{ color: colors.text }}>1 rider</strong> en tu cuenta → no pagas plan multi-rider.
        </p>
        <p style={{ fontSize: type.xs, color: colors.textMute, marginTop: 6 }}>
          Si añades 2 o más riders, se aplicará automáticamente el plan multi-rider de <strong>39 €/mes</strong>.
        </p>
      </Card>
    )
  }

  // ─── Activa al día ───
  if (activa && (estado === 'al_dia' || estado === 'reintento1' || estado === 'reintento2')) {
    return (
      <Card>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
          <div style={{
            width: 44, height: 44, borderRadius: 11,
            background: colors.terracottaSoft, color: colors.terracotta,
            display: 'grid', placeItems: 'center',
          }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ ...ds.h2, margin: 0 }}>Mi facturación Pidoo</div>
            <div style={{ fontSize: type.xs, color: colors.textMute, marginTop: 2 }}>
              Plan multi-rider · {n} rider{n === 1 ? '' : 's'}
            </div>
          </div>
          <ChipDot tone="sage">Activa</ChipDot>
        </div>
        <div style={{
          background: colors.surface2, borderRadius: 10, padding: 14,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
        }}>
          <div>
            <div style={{
              fontSize: 11, fontWeight: 700, color: colors.textMute,
              letterSpacing: '0.04em', textTransform: 'uppercase',
            }}>Próximo cargo</div>
            <div style={{
              fontSize: 22, fontWeight: 800, color: colors.text, marginTop: 2,
              letterSpacing: '-0.4px',
            }}>39,00 €</div>
            <div style={{ fontSize: type.xs, color: colors.textMute, marginTop: 2 }}>
              {fmtFecha(proximoPago)}
            </div>
          </div>
        </div>
        {(estado === 'reintento1' || estado === 'reintento2') && (
          <div style={{
            fontSize: type.xs, color: colors.warning, marginTop: 10,
            padding: '8px 10px', background: colors.warningSoft, borderRadius: 8, fontWeight: 600,
          }}>
            Stripe está reintentando el cobro (intento {estado === 'reintento2' ? '2' : '1'} de 3). Verifica tu método de pago.
          </div>
        )}
      </Card>
    )
  }

  // ─── 2+ riders pero aún no activa ───
  if (n >= 2 && !activa) {
    return (
      <Card>
        <h2 style={ds.h2}>Mi facturación Pidoo</h2>
        <p style={{ fontSize: type.sm, color: colors.textDim, lineHeight: 1.5 }}>
          Tienes <strong style={{ color: colors.text }}>{n} riders</strong>. El plan multi-rider de <strong>39 €/mes</strong> se activará en las próximas horas tras la sincronización.
        </p>
      </Card>
    )
  }

  return null
}
