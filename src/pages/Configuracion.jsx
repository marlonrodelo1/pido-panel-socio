import { useEffect, useState } from 'react'
import { useSocio } from '../context/SocioContext'
import { colors, ds, type } from '../lib/uiStyles'

export default function Configuracion() {
  const { socio, updateSocio, logout } = useSocio()
  const [form, setForm] = useState({
    nombre: socio?.nombre || '',
    telefono: socio?.telefono || '',
  })
  const [saving, setSaving] = useState(false)
  const [ok, setOk] = useState(false)
  const [err, setErr] = useState(null)

  useEffect(() => {
    if (!socio) return
    setForm({
      nombre: socio.nombre || '',
      telefono: socio.telefono || '',
    })
  }, [socio])

  const save = async () => {
    setSaving(true); setErr(null); setOk(false)
    try {
      await updateSocio({
        nombre: form.nombre,
        telefono: form.telefono || null,
      })
      setOk(true); setTimeout(() => setOk(false), 2500)
    } catch (e) { setErr(e.message) }
    finally { setSaving(false) }
  }

  return (
    <div style={{ maxWidth: 800 }}>
      <h1 style={ds.h1}>Configuración</h1>
      <p style={{ color: colors.textMute, fontSize: type.sm, marginTop: 4, marginBottom: 22 }}>
        Datos personales.
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
