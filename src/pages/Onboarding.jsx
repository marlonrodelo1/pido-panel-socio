import { useEffect, useState } from 'react'
import { useSocio } from '../context/SocioContext'
import { supabase, FUNCTIONS_URL } from '../lib/supabase'
import { colors, ds, type } from '../lib/uiStyles'

export default function Onboarding() {
  const { user, refreshSocio } = useSocio()

  const [nombreComercial, setNombreComercial] = useState('')
  const [nombre, setNombre] = useState(user?.user_metadata?.full_name || '')
  const [telefono, setTelefono] = useState('')
  const [acepta, setAcepta] = useState(false)
  const [estado, setEstado] = useState('idle')
  const [error, setError] = useState(null)
  const [slugStatus, setSlugStatus] = useState('idle') // idle|short|checking|ok|taken|invalid

  // Mismo slugify que la edge function reserve-socio-slug (debe coincidir).
  const slugify = (s) => String(s || '').toLowerCase().trim()
    .replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
  const slug = slugify(nombreComercial)

  // Comprobación de disponibilidad de la URL en vivo (debounce 450ms).
  // RLS impide comprobar slugs de otros socios desde el cliente, por eso
  // se usa la edge function (service role) con check_only.
  useEffect(() => {
    if (slug.length === 0) { setSlugStatus('idle'); return }
    if (slug.length < 3) { setSlugStatus('short'); return }
    setSlugStatus('checking')
    let cancel = false
    const t = setTimeout(async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        const res = await fetch(`${FUNCTIONS_URL}/reserve-socio-slug`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token || ''}` },
          body: JSON.stringify({ slug, check_only: true }),
        })
        const j = await res.json().catch(() => ({}))
        if (cancel) return
        if (res.ok && j.disponible) setSlugStatus('ok')
        else if (j.disponible === false) setSlugStatus('taken')
        else setSlugStatus('invalid')
      } catch { if (!cancel) setSlugStatus('invalid') }
    }, 450)
    return () => { cancel = true; clearTimeout(t) }
  }, [slug])

  const comercialOk = nombreComercial.trim().length >= 2 && slugStatus === 'ok'
  const nombreOk = nombre.trim().length >= 2
  const telOk = (telefono.match(/\d/g) || []).length >= 6
  const puedeCrear = comercialOk && nombreOk && telOk && acepta && estado !== 'creando'

  const slugMsg = {
    short: 'Mínimo 3 caracteres',
    checking: 'Comprobando disponibilidad…',
    ok: `Disponible: pidoo.es/s/${slug}`,
    taken: 'Esa URL ya está en uso, prueba otro nombre',
    invalid: 'Nombre no válido para la URL',
  }[slugStatus] || ''

  const cerrarSesion = async () => {
    try { await supabase.auth.signOut() } catch (_) {}
    setTimeout(() => {
      try { if (typeof window !== 'undefined') window.location.reload() } catch (_) {}
    }, 600)
  }

  const submit = async () => {
    if (!puedeCrear) return
    setError(null); setEstado('creando')
    try {
      // 1) Crea el socio (sin slug todavía; lo reserva el paso 3 de forma atómica
      //    contra colisiones). nombre_comercial + marketplace activo desde el alta.
      const { error: insertErr } = await supabase.from('socios').upsert({
        user_id: user.id,
        nombre: nombre.trim(),
        nombre_comercial: nombreComercial.trim(),
        telefono: telefono.trim(),
        email: user.email,
        activo: true,
        marketplace_activo: true,
      }, { onConflict: 'user_id' })
      if (insertErr) throw insertErr

      // 2) Marca el rol del usuario.
      const { error: usrErr } = await supabase.from('usuarios').upsert({
        id: user.id,
        email: user.email,
        nombre: nombre.trim(),
        rol: 'socio',
      }, { onConflict: 'id' })
      if (usrErr) throw usrErr

      // 3) Reserva el slug único (escribe socios.slug) → genera la URL pública
      //    pidoo.es/s/<slug>. La edge function valida unicidad con service role.
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(`${FUNCTIONS_URL}/reserve-socio-slug`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token || ''}` },
        body: JSON.stringify({ slug }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j.ok) {
        throw new Error(j.motivo === 'ocupado'
          ? 'Esa URL acaba de ocuparse, prueba otro nombre comercial.'
          : (j.error || 'No se pudo generar la URL de tu marketplace'))
      }

      await refreshSocio()
      setEstado('creado')
    } catch (e) {
      setError(e.message || 'No se pudo crear la cuenta')
      setEstado('idle')
    }
  }

  const irARestaurantes = () => {
    try { window.dispatchEvent(new CustomEvent('pidoo:goto', { detail: 'restaurantes' })) } catch (_) {}
  }

  // ────── Pantalla de éxito ──────
  if (estado === 'creado') {
    return (
      <PageWrap>
        <Card>
          <div style={{ textAlign: 'center', padding: '12px 0 8px' }}>
            <div style={{
              width: 72, height: 72, borderRadius: '50%',
              background: colors.sageSoft, color: colors.sage2,
              display: 'grid', placeItems: 'center', margin: '0 auto 18px',
              fontSize: 36, fontWeight: 700,
            }}>
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
            </div>
            <h1 style={{ ...ds.h1, marginBottom: 10 }}>Tu cuenta está activa</h1>
            <p style={{ fontSize: type.sm, color: colors.textDim, lineHeight: 1.6, marginBottom: 22 }}>
              Ahora puedes buscar restaurantes con los que trabajar y empezar a recibir pedidos.
            </p>
            <button onClick={irARestaurantes} style={{ ...ds.glossyBtn, height: 44, width: '100%' }}>
              Ver restaurantes disponibles
            </button>
          </div>
        </Card>
      </PageWrap>
    )
  }

  // ────── Form (único paso) ──────
  return (
    <PageWrap>
      <button onClick={cerrarSesion} style={{
        position: 'absolute', top: 'calc(env(safe-area-inset-top) + 16px)', right: 16,
        background: 'transparent', border: `1px solid ${colors.border}`,
        color: colors.textMute, fontSize: 12, fontWeight: 600,
        padding: '8px 14px', borderRadius: 8, cursor: 'pointer', fontFamily: type.family,
      }}>Cerrar sesión</button>

      <Card>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <img src="/icon.png" alt="Pidoo" width={38} height={38} style={{ borderRadius: 10 }} />
        </div>

        <h1 style={{ ...ds.h2, margin: 0 }}>Bienvenido socio repartidor</h1>
        <p style={{ fontSize: type.sm, color: colors.textMute, marginTop: 6, marginBottom: 22, lineHeight: 1.5 }}>
          Crea tu cuenta y tu marketplace en un paso. El resto lo configuras después.
        </p>

        <label style={ds.label}>Nombre comercial (tu marca)</label>
        <input value={nombreComercial} onChange={e => setNombreComercial(e.target.value)}
          placeholder="Ej: Agora Express"
          style={{ ...ds.input, height: 44, marginBottom: 6 }} autoComplete="organization" />
        <div style={{
          fontSize: type.xs, fontWeight: 600, marginBottom: 16, minHeight: 16,
          color: slugStatus === 'ok' ? (colors.stateOk || colors.sage2)
            : (slugStatus === 'taken' || slugStatus === 'invalid') ? colors.danger
            : colors.textMute,
        }}>
          {slugMsg || 'Será tu URL pública: pidoo.es/s/tu-marca'}
        </div>

        <label style={ds.label}>Nombre completo</label>
        <input value={nombre} onChange={e => setNombre(e.target.value)}
          placeholder="Ej: Marlon Rodelo"
          style={{ ...ds.input, height: 44, marginBottom: 14 }} autoComplete="name" />

        <label style={ds.label}>Teléfono</label>
        <input value={telefono} onChange={e => setTelefono(e.target.value)}
          placeholder="+34 600 000 000"
          style={{ ...ds.input, height: 44, marginBottom: 18 }}
          inputMode="tel" autoComplete="tel" />

        <label style={{
          display: 'flex', alignItems: 'flex-start', gap: 10,
          padding: '10px 0', cursor: 'pointer', marginBottom: 22,
        }}>
          <input type="checkbox" checked={acepta} onChange={e => setAcepta(e.target.checked)}
            style={{ marginTop: 3, accentColor: colors.terracotta }} />
          <span style={{ fontSize: type.sm, color: colors.textDim, lineHeight: 1.5 }}>
            Acepto los <a href="https://pidoo.es/terminos" target="_blank" rel="noreferrer"
               style={{ color: colors.terracotta, fontWeight: 700 }}>términos</a>
            {' '}y la <a href="https://pidoo.es/privacidad" target="_blank" rel="noreferrer"
               style={{ color: colors.terracotta, fontWeight: 700 }}>política de privacidad</a>.
          </span>
        </label>

        {error && (
          <div style={{
            background: colors.dangerSoft, color: colors.danger,
            padding: '10px 12px', borderRadius: 10, fontSize: type.xs,
            marginBottom: 14, fontWeight: 600,
          }}>{error}</div>
        )}

        <button onClick={submit} disabled={!puedeCrear}
          style={{
            ...ds.glossyBtn, width: '100%', height: 46,
            opacity: puedeCrear ? 1 : 0.55,
          }}>
          {estado === 'creando' ? 'Creando…' : 'Crear mi cuenta'}
        </button>
      </Card>
    </PageWrap>
  )
}

function PageWrap({ children }) {
  return (
    <div style={{
      minHeight: '100vh', background: colors.cream,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 'calc(env(safe-area-inset-top) + 28px) 16px 28px',
      position: 'relative', fontFamily: type.family,
    }}>
      {children}
    </div>
  )
}

function Card({ children }) {
  return (
    <div style={{
      width: '100%', maxWidth: 520,
      background: colors.paper, borderRadius: 16,
      border: `1px solid ${colors.border}`,
      boxShadow: colors.shadowMd,
      padding: 28,
    }}>{children}</div>
  )
}
