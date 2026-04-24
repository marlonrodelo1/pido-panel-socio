import { useEffect, useRef, useState } from 'react'
import { useSocio } from '../context/SocioContext'
import { supabase, FUNCTIONS_URL } from '../lib/supabase'
import { colors, ds, type } from '../lib/uiStyles'

function slugify(s) {
  return (s || '').toLowerCase().trim()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
}

const STEPS = [
  { id: 1, label: 'Datos' },
  { id: 2, label: 'Marketplace' },
  { id: 3, label: 'Redes' },
]

function Stepper({ current }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, marginBottom: 28, flexWrap: 'wrap' }}>
      {STEPS.map((s, idx) => {
        const done = current > s.id
        const isCurrent = current === s.id
        const circleColor = done ? colors.stateOk : isCurrent ? colors.primary : colors.border
        const labelColor = done || isCurrent ? colors.text : colors.textMute
        return (
          <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{
              width: 26, height: 26, borderRadius: '50%',
              background: done ? colors.stateOk : isCurrent ? colors.primary : colors.surface,
              border: `1.5px solid ${circleColor}`,
              color: done || isCurrent ? '#fff' : colors.textMute,
              display: 'grid', placeItems: 'center',
              fontSize: 12, fontWeight: 700,
            }}>
              {done ? '✓' : s.id}
            </div>
            <div style={{ fontSize: type.xs, fontWeight: 600, color: labelColor }}>{s.label}</div>
            {idx < STEPS.length - 1 && (
              <div style={{ width: 28, height: 1, background: done ? colors.stateOk : colors.border, marginLeft: 4 }} />
            )}
          </div>
        )
      })}
    </div>
  )
}

export default function Onboarding() {
  const { user, refreshSocio, logout } = useSocio()
  const [step, setStep] = useState(1)
  const logoInputRef = useRef(null)
  const bannerInputRef = useRef(null)

  const [form, setForm] = useState({
    // Paso 1
    nombre: user?.user_metadata?.full_name || '',
    telefono: '',
    // Paso 2
    nombre_comercial: '',
    slug: '',
    descripcion: '',
    logo_url: '',
    banner_url: '',
    color_primario: '#FF6B2C',
    // Paso 3 (todo opcional salvo términos)
    instagram: '',
    tiktok: '',
    web: '',
    acepta_terminos: false,
  })

  const [slugCheck, setSlugCheck] = useState({ state: 'idle', disponible: null, error: null })
  const [uploading, setUploading] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [showCancel, setShowCancel] = useState(false)
  const debSlugRef = useRef(null)

  useEffect(() => {
    if (!form.nombre_comercial) return
    setForm(f => f.slug ? f : { ...f, slug: slugify(f.nombre_comercial) })
  }, [form.nombre_comercial])

  useEffect(() => {
    if (!form.slug || form.slug.length < 3) { setSlugCheck({ state: 'idle', disponible: null }); return }
    clearTimeout(debSlugRef.current)
    setSlugCheck({ state: 'checking', disponible: null })
    debSlugRef.current = setTimeout(async () => {
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
    return () => clearTimeout(debSlugRef.current)
  }, [form.slug])

  const uploadImage = async (file, kind) => {
    if (!file || !user?.id) return
    setUploading(kind); setError(null)
    try {
      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase()
      const path = `${user.id}/${kind}-${Date.now()}.${ext}`
      const { error: upErr } = await supabase.storage
        .from('socios-media')
        .upload(path, file, { cacheControl: '3600', upsert: true, contentType: file.type })
      if (upErr) throw upErr
      const { data: pub } = supabase.storage.from('socios-media').getPublicUrl(path)
      const publicUrl = pub.publicUrl
      setForm(f => ({ ...f, [kind === 'logo' ? 'logo_url' : 'banner_url']: publicUrl }))
    } catch (e) {
      setError(`Error subiendo ${kind}: ${e.message}`)
    } finally {
      setUploading(null)
    }
  }

  const canNext = () => {
    if (step === 1) return !!form.nombre.trim() && !!form.telefono.trim()
    if (step === 2) {
      return !!form.nombre_comercial.trim()
        && !!form.slug
        && form.slug.length >= 3
        && slugCheck.disponible !== false
        && slugCheck.state !== 'checking'
    }
    if (step === 3) return !!form.acepta_terminos
    return false
  }

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
        telefono: form.telefono || null,
        nombre_comercial: form.nombre_comercial,
        slug: form.slug,
        descripcion: form.descripcion || null,
        logo_url: form.logo_url || null,
        banner_url: form.banner_url || null,
        color_primario: form.color_primario || '#FF6B2C',
        redes: {
          instagram: form.instagram || null,
          tiktok: form.tiktok || null,
          web: form.web || null,
        },
        activo: true,
        marketplace_activo: true,
        limite_restaurantes: 5,
      }
      const { error: insertErr } = await supabase.from('socios').upsert(payload, { onConflict: 'user_id' })
      if (insertErr) throw insertErr

      await supabase.from('usuarios').upsert({ id: user.id, email: user.email, rol: 'socio' }, { onConflict: 'id' })

      await refreshSocio()
    } catch (e) {
      setError(e.message)
    } finally { setSaving(false) }
  }

  const saltarYFinalizar = async () => {
    if (!form.acepta_terminos) {
      setError('Debes aceptar los términos para poder registrarte.')
      return
    }
    await submit()
  }

  const cancelar = async () => {
    try {
      await logout?.()
    } catch {
      await supabase.auth.signOut()
    }
  }

  const slugHint = () => {
    if (!form.slug) return null
    if (form.slug.length < 3) return { color: colors.textMute, msg: 'Mínimo 3 caracteres' }
    if (slugCheck.state === 'checking') return { color: colors.textMute, msg: 'Comprobando...' }
    if (slugCheck.state === 'ready' && slugCheck.disponible) return { color: colors.stateOk, msg: '✓ Disponible' }
    if (slugCheck.state === 'ready' && !slugCheck.disponible) return { color: colors.danger, msg: slugCheck.error || 'No disponible' }
    if (slugCheck.state === 'error') return { color: colors.danger, msg: slugCheck.error }
    return null
  }
  const hint = slugHint()

  return (
    <div style={{ minHeight: '100vh', background: colors.bg, padding: '32px 16px', position: 'relative' }}>
      {/* Botón cancelar arriba derecha */}
      <button
        onClick={() => setShowCancel(true)}
        style={{
          position: 'absolute', top: 16, right: 16,
          background: 'transparent', border: `1px solid ${colors.border}`,
          color: colors.textMute, fontSize: 12, fontWeight: 600,
          padding: '8px 14px', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit',
        }}
      >
        Cancelar
      </button>

      <div style={{ maxWidth: 620, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 22 }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: colors.primary, letterSpacing: '0.12em', textTransform: 'uppercase' }}>Bienvenido a Pidoo Socios</div>
          <h1 style={{ ...ds.h1, marginTop: 6 }}>Configura tu marketplace</h1>
        </div>

        <Stepper current={step} />

        <div style={{ ...ds.card, padding: '22px 24px' }}>

          {step === 1 && (
            <>
              <h2 style={ds.h2}>Tus datos</h2>
              <p style={{ color: colors.textMute, fontSize: type.xs, marginTop: -6, marginBottom: 16 }}>
                Cuéntanos quién está al mando del marketplace.
              </p>
              <div style={{ marginBottom: 14 }}>
                <label style={ds.label}>Nombre completo *</label>
                <input value={form.nombre} onChange={e => setForm({ ...form, nombre: e.target.value })}
                  placeholder="Ej: Marlon Rodelo" style={ds.input} />
              </div>
              <div style={{ marginBottom: 14 }}>
                <label style={ds.label}>Teléfono *</label>
                <input value={form.telefono} onChange={e => setForm({ ...form, telefono: e.target.value })}
                  placeholder="+34 600 000 000" style={ds.input} />
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <h2 style={ds.h2}>Tu marketplace</h2>
              <p style={{ color: colors.textMute, fontSize: type.xs, marginTop: -6, marginBottom: 16 }}>
                Personaliza tu tienda pública.
              </p>
              <div style={{ marginBottom: 14 }}>
                <label style={ds.label}>Nombre comercial *</label>
                <input value={form.nombre_comercial} onChange={e => setForm({ ...form, nombre_comercial: e.target.value })}
                  placeholder="Agora Express" style={ds.input} />
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
                <textarea
                  value={form.descripcion}
                  onChange={e => setForm({ ...form, descripcion: e.target.value.slice(0, 300) })}
                  placeholder="Cuenta de qué va tu marketplace…" rows={3}
                  style={{ ...ds.input, height: 'auto', padding: '10px 12px', resize: 'vertical', fontFamily: "'Inter', sans-serif" }}
                />
                <div style={{ fontSize: type.xxs, color: colors.textMute, marginTop: 4, textAlign: 'right' }}>
                  {form.descripcion.length}/300
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
                <div>
                  <label style={ds.label}>Logo</label>
                  <input ref={logoInputRef} type="file" accept="image/*" style={{ display: 'none' }}
                    onChange={e => uploadImage(e.target.files?.[0], 'logo')} />
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    {form.logo_url ? (
                      <img src={form.logo_url} alt="logo" style={{ width: 48, height: 48, borderRadius: 10, objectFit: 'cover', border: `1px solid ${colors.border}` }} />
                    ) : (
                      <div style={{ width: 48, height: 48, borderRadius: 10, background: colors.surface2, border: `1px dashed ${colors.border}`, display: 'grid', placeItems: 'center', color: colors.textMute, fontSize: 10 }}>Sin logo</div>
                    )}
                    <button type="button" onClick={() => logoInputRef.current?.click()} disabled={uploading === 'logo'} style={{ ...ds.secondaryBtn, opacity: uploading === 'logo' ? 0.6 : 1 }}>
                      {uploading === 'logo' ? 'Subiendo…' : (form.logo_url ? 'Cambiar' : 'Subir')}
                    </button>
                  </div>
                </div>
                <div>
                  <label style={ds.label}>Portada</label>
                  <input ref={bannerInputRef} type="file" accept="image/*" style={{ display: 'none' }}
                    onChange={e => uploadImage(e.target.files?.[0], 'banner')} />
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    {form.banner_url ? (
                      <img src={form.banner_url} alt="portada" style={{ width: 84, height: 48, borderRadius: 10, objectFit: 'cover', border: `1px solid ${colors.border}` }} />
                    ) : (
                      <div style={{ width: 84, height: 48, borderRadius: 10, background: colors.surface2, border: `1px dashed ${colors.border}`, display: 'grid', placeItems: 'center', color: colors.textMute, fontSize: 10 }}>Sin portada</div>
                    )}
                    <button type="button" onClick={() => bannerInputRef.current?.click()} disabled={uploading === 'banner'} style={{ ...ds.secondaryBtn, opacity: uploading === 'banner' ? 0.6 : 1 }}>
                      {uploading === 'banner' ? 'Subiendo…' : (form.banner_url ? 'Cambiar' : 'Subir')}
                    </button>
                  </div>
                </div>
              </div>

              <div style={{ marginBottom: 14 }}>
                <label style={ds.label}>Color primario</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <input type="color" value={form.color_primario}
                    onChange={e => setForm({ ...form, color_primario: e.target.value })}
                    style={{ width: 52, height: 38, borderRadius: 8, border: `1px solid ${colors.border}`, padding: 3, cursor: 'pointer', background: colors.surface }} />
                  <input value={form.color_primario}
                    onChange={e => setForm({ ...form, color_primario: e.target.value })}
                    style={{ ...ds.input, maxWidth: 120 }} />
                </div>
              </div>
            </>
          )}

          {step === 3 && (
            <>
              <h2 style={ds.h2}>Redes y términos</h2>
              <p style={{ color: colors.textMute, fontSize: type.xs, marginTop: -6, marginBottom: 16 }}>
                Las redes son opcionales. Puedes completarlas ahora o dejarlas para después desde tu panel.
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
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
              </div>
              <div style={{ marginBottom: 14 }}>
                <label style={ds.label}>Web</label>
                <input value={form.web} onChange={e => setForm({ ...form, web: e.target.value })}
                  placeholder="https://…" style={ds.input} />
              </div>

              <label style={{
                display: 'flex', alignItems: 'flex-start', gap: 10,
                padding: '12px 14px', borderRadius: 10,
                border: `1px solid ${form.acepta_terminos ? colors.primary : colors.border}`,
                background: form.acepta_terminos ? colors.primarySoft : colors.surface2,
                cursor: 'pointer', marginTop: 4,
              }}>
                <input
                  type="checkbox"
                  checked={form.acepta_terminos}
                  onChange={e => setForm({ ...form, acepta_terminos: e.target.checked })}
                  style={{ marginTop: 2, cursor: 'pointer' }}
                />
                <span style={{ fontSize: type.xs, color: colors.text, lineHeight: 1.5 }}>
                  Acepto los <a href="https://pidoo.es/terminos" target="_blank" rel="noreferrer" style={{ color: colors.primary, fontWeight: 600 }}>términos</a> y la <a href="https://pidoo.es/privacidad" target="_blank" rel="noreferrer" style={{ color: colors.primary, fontWeight: 600 }}>política de Pidoo</a> para socios. *
                </span>
              </label>
            </>
          )}

          {error && (
            <div style={{
              background: colors.dangerSoft, color: colors.danger,
              padding: '10px 12px', borderRadius: 8, fontSize: type.xs,
              marginTop: 14, border: `1px solid ${colors.danger}`,
            }}>{error}</div>
          )}

          {/* Botones navegación */}
          <div style={{ display: 'flex', gap: 10, marginTop: 22, flexWrap: 'wrap' }}>
            {step > 1 && (
              <button
                onClick={() => setStep(s => Math.max(1, s - 1))}
                disabled={saving}
                style={{ ...ds.secondaryBtn, flex: '0 0 auto', height: 44, padding: '0 18px' }}
              >
                Atrás
              </button>
            )}
            {step < 3 && (
              <button
                onClick={() => setStep(s => Math.min(3, s + 1))}
                disabled={!canNext()}
                style={{
                  ...ds.primaryBtn, flex: 1, height: 44,
                  opacity: canNext() ? 1 : 0.55,
                }}
              >
                Siguiente →
              </button>
            )}
            {step === 3 && (
              <button
                onClick={saltarYFinalizar}
                disabled={saving || !form.acepta_terminos}
                style={{
                  ...ds.primaryBtn, flex: 1, height: 44,
                  opacity: (saving || !form.acepta_terminos) ? 0.6 : 1,
                }}
              >
                {saving ? 'Creando tu marketplace…' : '✓ Finalizar registro'}
              </button>
            )}
          </div>

          {step === 3 && (
            <p style={{ fontSize: type.xxs, color: colors.textMute, textAlign: 'center', marginTop: 12 }}>
              Puedes dejar las redes vacías y completarlas después desde tu panel.
            </p>
          )}
        </div>
      </div>

      {showCancel && (
        <div onClick={() => setShowCancel(false)} style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 200,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
        }}>
          <div onClick={e => e.stopPropagation()} style={{
            background: colors.surface, borderRadius: 16, padding: 24, maxWidth: 380, width: '100%',
            boxShadow: '0 20px 60px rgba(0,0,0,0.22)',
          }}>
            <h3 style={{ ...ds.h2, marginBottom: 8 }}>¿Cancelar el registro?</h3>
            <p style={{ fontSize: type.sm, color: colors.textMute, lineHeight: 1.55, marginTop: 0, marginBottom: 18 }}>
              Se cerrará tu sesión y volverás a la página principal. Tu cuenta no se creará todavía;
              podrás registrarte de nuevo cuando quieras.
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={() => setShowCancel(false)} style={ds.secondaryBtn}>
                Seguir con el registro
              </button>
              <button onClick={cancelar} style={ds.dangerBtn}>
                Cancelar y salir
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
