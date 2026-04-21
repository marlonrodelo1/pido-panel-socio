import { useEffect, useRef, useState } from 'react'
import { useSocio } from '../context/SocioContext'
import { supabase, FUNCTIONS_URL } from '../lib/supabase'
import { colors, ds, type } from '../lib/uiStyles'

function slugify(s) {
  return (s || '').toLowerCase().trim()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
}

export default function Onboarding() {
  const { user, refreshSocio } = useSocio()
  const [step, setStep] = useState(0)
  const [form, setForm] = useState({
    nombre: user?.user_metadata?.full_name || '',
    nombre_comercial: '',
    slug: '',
    descripcion: '',
    logo_url: '',
    banner_url: '',
    instagram: '',
    tiktok: '',
    web: '',
  })
  const [slugCheck, setSlugCheck] = useState({ state: 'idle', disponible: null, error: null })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const debRef = useRef(null)

  useEffect(() => {
    if (form.slug && !form.nombre_comercial) return
    if (!form.nombre_comercial) return
    setForm(f => f.slug ? f : { ...f, slug: slugify(f.nombre_comercial) })
  }, [form.nombre_comercial])

  useEffect(() => {
    if (!form.slug || form.slug.length < 3) { setSlugCheck({ state: 'idle', disponible: null }); return }
    clearTimeout(debRef.current)
    setSlugCheck({ state: 'checking', disponible: null })
    debRef.current = setTimeout(async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        const r = await fetch(`${FUNCTIONS_URL}/reserve-socio-slug`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session?.access_token}`,
          },
          body: JSON.stringify({ slug: form.slug, check_only: true }),
        })
        const data = await r.json()
        setSlugCheck({ state: 'ready', disponible: data.disponible, error: data.error })
      } catch (e) {
        setSlugCheck({ state: 'error', disponible: null, error: e.message })
      }
    }, 500)
    return () => clearTimeout(debRef.current)
  }, [form.slug])

  const submit = async () => {
    setError(null); setSaving(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()

      const reserve = await fetch(`${FUNCTIONS_URL}/reserve-socio-slug`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({ slug: form.slug }),
      })
      const reserveData = await reserve.json()
      if (!reserveData.disponible && !reserveData.ok) {
        throw new Error(reserveData.error || 'El slug no está disponible')
      }

      const payload = {
        user_id: user.id,
        nombre: form.nombre || user.email,
        nombre_comercial: form.nombre_comercial,
        slug: form.slug,
        descripcion: form.descripcion || null,
        logo_url: form.logo_url || null,
        banner_url: form.banner_url || null,
        redes: {
          instagram: form.instagram || null,
          tiktok: form.tiktok || null,
          web: form.web || null,
        },
        activo: false,
        marketplace_activo: false,
      }
      const { error: insertErr } = await supabase.from('socios').upsert(payload, { onConflict: 'user_id' })
      if (insertErr) throw insertErr

      await supabase.from('usuarios').upsert({ id: user.id, email: user.email, rol: 'socio' }, { onConflict: 'id' })

      await refreshSocio()
    } catch (e) {
      setError(e.message)
    } finally { setSaving(false) }
  }

  const slugHint = () => {
    if (!form.slug) return null
    if (form.slug.length < 3) return { color: colors.textMute, msg: 'Mínimo 3 caracteres' }
    if (slugCheck.state === 'checking') return { color: colors.textMute, msg: 'Comprobando...' }
    if (slugCheck.state === 'ready' && slugCheck.disponible) return { color: colors.stateOk, msg: 'Disponible' }
    if (slugCheck.state === 'ready' && !slugCheck.disponible) return { color: colors.danger, msg: slugCheck.error || 'No disponible' }
    if (slugCheck.state === 'error') return { color: colors.danger, msg: slugCheck.error }
    return null
  }
  const hint = slugHint()

  return (
    <div style={{ minHeight: '100vh', background: colors.bg, padding: '40px 20px' }}>
      <div style={{ maxWidth: 600, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: colors.primary, letterSpacing: '0.12em', textTransform: 'uppercase' }}>Bienvenido a Pidoo Socios</div>
          <h1 style={{ ...ds.h1, marginTop: 6 }}>Configura tu marketplace</h1>
          <p style={{ color: colors.textMute, fontSize: type.sm, marginTop: 6 }}>
            Elige tu URL pública y personaliza tu tienda.
          </p>
        </div>

        <div style={{ ...ds.card, padding: '22px 24px' }}>
          <div style={{ marginBottom: 14 }}>
            <label style={ds.label}>Nombre comercial *</label>
            <input value={form.nombre_comercial} onChange={e => setForm({ ...form, nombre_comercial: e.target.value })}
              placeholder="Ej: Socio del Norte" style={ds.input} />
          </div>

          <div style={{ marginBottom: 14 }}>
            <label style={ds.label}>URL pública *</label>
            <div style={{ display: 'flex', alignItems: 'stretch', gap: 0 }}>
              <span style={{
                display: 'inline-flex', alignItems: 'center', padding: '0 12px',
                background: colors.surface2, border: `1px solid ${colors.border}`,
                borderRight: 'none', borderRadius: '8px 0 0 8px',
                fontSize: type.sm, color: colors.textMute,
              }}>pidoo.es/s/</span>
              <input value={form.slug} onChange={e => setForm({ ...form, slug: slugify(e.target.value) })}
                placeholder="mi-tienda" style={{ ...ds.input, borderRadius: '0 8px 8px 0' }} />
            </div>
            {hint && <div style={{ fontSize: type.xs, color: hint.color, marginTop: 6, fontWeight: 600 }}>{hint.msg}</div>}
          </div>

          <div style={{ marginBottom: 14 }}>
            <label style={ds.label}>Descripción</label>
            <textarea value={form.descripcion} onChange={e => setForm({ ...form, descripcion: e.target.value })}
              placeholder="Cuenta de qué va tu marketplace…" rows={3}
              style={{ ...ds.input, height: 'auto', padding: '10px 12px', resize: 'vertical', fontFamily: "'Inter', sans-serif" }} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
            <div>
              <label style={ds.label}>Logo URL</label>
              <input value={form.logo_url} onChange={e => setForm({ ...form, logo_url: e.target.value })}
                placeholder="https://…" style={ds.input} />
            </div>
            <div>
              <label style={ds.label}>Portada URL</label>
              <input value={form.banner_url} onChange={e => setForm({ ...form, banner_url: e.target.value })}
                placeholder="https://…" style={ds.input} />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 18 }}>
            <div>
              <label style={ds.label}>Instagram</label>
              <input value={form.instagram} onChange={e => setForm({ ...form, instagram: e.target.value })}
                placeholder="@usuario" style={ds.input} />
            </div>
            <div>
              <label style={ds.label}>TikTok</label>
              <input value={form.tiktok} onChange={e => setForm({ ...form, tiktok: e.target.value })}
                placeholder="@usuario" style={ds.input} />
            </div>
            <div>
              <label style={ds.label}>Web</label>
              <input value={form.web} onChange={e => setForm({ ...form, web: e.target.value })}
                placeholder="https://…" style={ds.input} />
            </div>
          </div>

          {error && (
            <div style={{
              background: colors.dangerSoft, color: colors.danger,
              padding: '10px 12px', borderRadius: 8, fontSize: type.xs,
              marginBottom: 12, border: `1px solid ${colors.danger}`,
            }}>{error}</div>
          )}

          <button
            onClick={submit}
            disabled={saving || !form.nombre_comercial || !form.slug || slugCheck.disponible === false}
            style={{
              ...ds.primaryBtn, width: '100%', height: 44,
              opacity: (saving || !form.nombre_comercial || !form.slug || slugCheck.disponible === false) ? 0.6 : 1,
            }}>
            {saving ? 'Creando tu marketplace…' : 'Crear mi marketplace →'}
          </button>
        </div>
      </div>
    </div>
  )
}
