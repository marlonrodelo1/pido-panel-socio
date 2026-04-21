import { useEffect, useState } from 'react'
import { useSocio } from '../context/SocioContext'
import { colors, ds, type } from '../lib/uiStyles'

export default function MiMarketplace() {
  const { socio, updateSocio } = useSocio()
  const [form, setForm] = useState({
    nombre_comercial: socio?.nombre_comercial || '',
    descripcion: socio?.descripcion || '',
    logo_url: socio?.logo_url || '',
    banner_url: socio?.banner_url || '',
    color_primario: socio?.color_primario || '#FF6B2C',
    instagram: socio?.redes?.instagram || '',
    tiktok: socio?.redes?.tiktok || '',
    web: socio?.redes?.web || '',
  })
  const [saving, setSaving] = useState(false)
  const [ok, setOk] = useState(false)
  const [err, setErr] = useState(null)

  useEffect(() => {
    if (!socio) return
    setForm({
      nombre_comercial: socio.nombre_comercial || '',
      descripcion: socio.descripcion || '',
      logo_url: socio.logo_url || '',
      banner_url: socio.banner_url || '',
      color_primario: socio.color_primario || '#FF6B2C',
      instagram: socio.redes?.instagram || '',
      tiktok: socio.redes?.tiktok || '',
      web: socio.redes?.web || '',
    })
  }, [socio])

  const url = `https://pidoo.es/s/${socio?.slug}`

  const save = async () => {
    setSaving(true); setErr(null); setOk(false)
    try {
      await updateSocio({
        nombre_comercial: form.nombre_comercial,
        descripcion: form.descripcion,
        logo_url: form.logo_url || null,
        banner_url: form.banner_url || null,
        color_primario: form.color_primario,
        redes: {
          instagram: form.instagram || null,
          tiktok: form.tiktok || null,
          web: form.web || null,
        },
      })
      setOk(true); setTimeout(() => setOk(false), 2500)
    } catch (e) { setErr(e.message) }
    finally { setSaving(false) }
  }

  const toggleActivo = async () => {
    try {
      await updateSocio({ marketplace_activo: !socio.marketplace_activo })
    } catch (e) { alert(e.message) }
  }

  return (
    <div>
      <h1 style={ds.h1}>Mi marketplace</h1>
      <p style={{ color: colors.textMute, fontSize: type.sm, marginTop: 4, marginBottom: 20 }}>
        Así verán tus clientes tu tienda pública.
      </p>

      <div style={{ ...ds.card, marginBottom: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div style={{ fontSize: type.xxs, fontWeight: 700, color: colors.textMute, letterSpacing: '0.06em', textTransform: 'uppercase' }}>URL pública</div>
          <div style={{ fontSize: type.base, fontWeight: 600, color: colors.text }}>{url}</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => navigator.clipboard?.writeText(url)} style={ds.secondaryBtn}>Copiar</button>
          <a href={url} target="_blank" rel="noreferrer" style={{ ...ds.secondaryBtn, textDecoration: 'none' }}>Ver tienda ↗</a>
          <button onClick={toggleActivo}
            style={socio?.marketplace_activo ? { ...ds.dangerBtn } : { ...ds.primaryBtn }}>
            {socio?.marketplace_activo ? 'Desactivar' : 'Activar tienda'}
          </button>
        </div>
      </div>

      <div style={{ ...ds.card, marginBottom: 16 }}>
        <h2 style={ds.h2}>Branding</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: 14 }}>
          <div>
            <label style={ds.label}>Nombre comercial</label>
            <input value={form.nombre_comercial} onChange={e => setForm({ ...form, nombre_comercial: e.target.value })} style={ds.input} />
          </div>
          <div>
            <label style={ds.label}>Color primario</label>
            <input type="color" value={form.color_primario} onChange={e => setForm({ ...form, color_primario: e.target.value })}
              style={{ ...ds.input, padding: 4, cursor: 'pointer' }} />
          </div>
          <div>
            <label style={ds.label}>Logo URL</label>
            <input value={form.logo_url} onChange={e => setForm({ ...form, logo_url: e.target.value })} placeholder="https://…" style={ds.input} />
          </div>
          <div>
            <label style={ds.label}>Portada URL</label>
            <input value={form.banner_url} onChange={e => setForm({ ...form, banner_url: e.target.value })} placeholder="https://…" style={ds.input} />
          </div>
        </div>
        <div style={{ marginTop: 14 }}>
          <label style={ds.label}>Descripción</label>
          <textarea value={form.descripcion} onChange={e => setForm({ ...form, descripcion: e.target.value })}
            rows={3} style={{ ...ds.input, height: 'auto', padding: '10px 12px', fontFamily: "'Inter', sans-serif", resize: 'vertical' }} />
        </div>
      </div>

      <div style={{ ...ds.card, marginBottom: 16 }}>
        <h2 style={ds.h2}>Redes sociales</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 14 }}>
          <div>
            <label style={ds.label}>Instagram</label>
            <input value={form.instagram} onChange={e => setForm({ ...form, instagram: e.target.value })} placeholder="@usuario" style={ds.input} />
          </div>
          <div>
            <label style={ds.label}>TikTok</label>
            <input value={form.tiktok} onChange={e => setForm({ ...form, tiktok: e.target.value })} placeholder="@usuario" style={ds.input} />
          </div>
          <div>
            <label style={ds.label}>Web</label>
            <input value={form.web} onChange={e => setForm({ ...form, web: e.target.value })} placeholder="https://…" style={ds.input} />
          </div>
        </div>
      </div>

      {err && <div style={{ background: colors.dangerSoft, color: colors.danger, padding: '10px 12px', borderRadius: 8, marginBottom: 10, fontSize: type.xs }}>{err}</div>}
      {ok && <div style={{ background: colors.stateOkSoft, color: colors.stateOk, padding: '10px 12px', borderRadius: 8, marginBottom: 10, fontSize: type.xs }}>Cambios guardados.</div>}

      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={save} disabled={saving} style={{ ...ds.primaryBtn, opacity: saving ? 0.6 : 1 }}>
          {saving ? 'Guardando…' : 'Guardar cambios'}
        </button>
      </div>
    </div>
  )
}
