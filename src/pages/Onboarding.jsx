import { useState } from 'react'
import { useSocio } from '../context/SocioContext'
import { supabase } from '../lib/supabase'
import { colors, ds, type } from '../lib/uiStyles'

export default function Onboarding() {
  const { user, refreshSocio } = useSocio()

  const [nombre, setNombre] = useState(user?.user_metadata?.full_name || '')
  const [telefono, setTelefono] = useState('')
  const [acepta, setAcepta] = useState(false)
  const [estado, setEstado] = useState('idle')
  const [error, setError] = useState(null)

  const nombreOk = nombre.trim().length >= 2
  const telOk = (telefono.match(/\d/g) || []).length >= 6
  const puedeCrear = nombreOk && telOk && acepta && estado !== 'creando'

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
      const { error: insertErr } = await supabase.from('socios').upsert({
        user_id: user.id,
        nombre: nombre.trim(),
        telefono: telefono.trim(),
        email: user.email,
        activo: true,
        marketplace_activo: false,
      }, { onConflict: 'user_id' })
      if (insertErr) throw insertErr

      const { error: usrErr } = await supabase.from('usuarios').upsert({
        id: user.id,
        email: user.email,
        nombre: nombre.trim(),
        rol: 'socio',
      }, { onConflict: 'id' })
      if (usrErr) throw usrErr

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
          Solo necesitamos 2 datos para empezar.
        </p>

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
