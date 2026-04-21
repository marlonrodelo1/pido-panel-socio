import { useEffect, useState } from 'react'
import { useSocio } from '../context/SocioContext'
import { colors, ds, type } from '../lib/uiStyles'

export default function Configuracion() {
  const { socio, updateSocio, logout } = useSocio()
  const [form, setForm] = useState({
    nombre: socio?.nombre || '',
    telefono: socio?.telefono || '',
    shipday_api_key: socio?.shipday_api_key || '',
  })
  const [saving, setSaving] = useState(false)
  const [ok, setOk] = useState(false)
  const [err, setErr] = useState(null)

  useEffect(() => {
    if (!socio) return
    setForm({
      nombre: socio.nombre || '',
      telefono: socio.telefono || '',
      shipday_api_key: socio.shipday_api_key || '',
    })
  }, [socio])

  const save = async () => {
    setSaving(true); setErr(null); setOk(false)
    try {
      await updateSocio({
        nombre: form.nombre,
        telefono: form.telefono || null,
        shipday_api_key: form.shipday_api_key || null,
      })
      setOk(true); setTimeout(() => setOk(false), 2500)
    } catch (e) { setErr(e.message) }
    finally { setSaving(false) }
  }

  return (
    <div>
      <h1 style={ds.h1}>Configuración</h1>
      <p style={{ color: colors.textMute, fontSize: type.sm, marginTop: 4, marginBottom: 18 }}>
        Datos de cuenta y opciones del marketplace.
      </p>

      <div style={{ ...ds.card, marginBottom: 16 }}>
        <h2 style={ds.h2}>Identidad de tienda</h2>
        <div style={{ fontSize: type.sm, color: colors.textDim, marginBottom: 10 }}>
          Slug: <strong style={{ color: colors.text }}>{socio?.slug}</strong> (no se puede cambiar desde aquí).
        </div>
        <div style={{ fontSize: type.sm, color: colors.textDim }}>
          Límite de restaurantes: <strong style={{ color: colors.text }}>{socio?.limite_restaurantes ?? 5}</strong> (solo editable por administración).
        </div>
      </div>

      <div style={{ ...ds.card, marginBottom: 16 }}>
        <h2 style={ds.h2}>Datos personales</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 14 }}>
          <div>
            <label style={ds.label}>Nombre</label>
            <input value={form.nombre} onChange={e => setForm({ ...form, nombre: e.target.value })} style={ds.input} />
          </div>
          <div>
            <label style={ds.label}>Teléfono</label>
            <input value={form.telefono} onChange={e => setForm({ ...form, telefono: e.target.value })}
              placeholder="+34 600 000 000" style={ds.input} />
          </div>
        </div>
      </div>

      <div style={{ ...ds.card, marginBottom: 16 }}>
        <h2 style={ds.h2}>Integración Shipday (rider)</h2>
        <p style={{ fontSize: type.xs, color: colors.textMute, marginBottom: 10 }}>
          Si eres rider además de socio, vincula aquí tu cuenta Shipday.
        </p>
        <label style={ds.label}>API Key de Shipday</label>
        <input value={form.shipday_api_key} onChange={e => setForm({ ...form, shipday_api_key: e.target.value })}
          placeholder="Pega aquí tu API key…" style={ds.input} />
      </div>

      {err && <div style={{ background: colors.dangerSoft, color: colors.danger, padding: '10px 12px', borderRadius: 8, marginBottom: 10, fontSize: type.xs }}>{err}</div>}
      {ok && <div style={{ background: colors.stateOkSoft, color: colors.stateOk, padding: '10px 12px', borderRadius: 8, marginBottom: 10, fontSize: type.xs }}>Cambios guardados.</div>}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button onClick={save} disabled={saving} style={{ ...ds.primaryBtn, opacity: saving ? 0.6 : 1 }}>
          {saving ? 'Guardando…' : 'Guardar cambios'}
        </button>
        <button onClick={logout} style={ds.dangerBtn}>Cerrar sesión</button>
      </div>
    </div>
  )
}
