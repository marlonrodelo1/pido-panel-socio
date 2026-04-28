import { useState } from 'react'
import { useSocio } from '../context/SocioContext'
import { supabase } from '../lib/supabase'
import { colors, ds, type } from '../lib/uiStyles'
import { Capacitor } from '@capacitor/core'
import { Browser } from '@capacitor/browser'

export default function Onboarding() {
  const { user, refreshSocio } = useSocio()

  const [nombre, setNombre] = useState(user?.user_metadata?.full_name || '')
  const [telefono, setTelefono] = useState('')
  const [acepta, setAcepta] = useState(false)
  const [estado, setEstado] = useState('idle') // idle | creando | creado
  const [error, setError] = useState(null)

  const nombreOk = nombre.trim().length >= 2
  const telOk = (telefono.match(/\d/g) || []).length >= 6
  const puedeEnviar = nombreOk && telOk && acepta && estado !== 'creando'

  const cerrarSesion = async () => {
    try { await supabase.auth.signOut() } catch (_) {}
    setTimeout(() => {
      try { if (typeof window !== 'undefined') window.location.reload() } catch (_) {}
    }, 600)
  }

  const submit = async () => {
    if (!puedeEnviar) return
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

  const irAMarketplace = () => {
    if (Capacitor.isNativePlatform()) {
      try { Browser.open({ url: 'https://socio.pidoo.es' }) } catch (_) {}
    } else {
      try { window.dispatchEvent(new CustomEvent('pidoo:goto', { detail: 'marketplace' })) } catch (_) {}
    }
  }

  const empezarRepartir = () => {
    try { window.dispatchEvent(new CustomEvent('pidoo:goto', { detail: 'rider' })) } catch (_) {}
  }

  // Pantalla de éxito
  if (estado === 'creado') {
    const native = Capacitor.isNativePlatform()
    return (
      <div style={pageStyle}>
        <div style={{ maxWidth: 480, margin: '0 auto' }}>
          <div style={{ ...ds.card, padding: '32px 24px', textAlign: 'center' }}>
            <div style={{
              width: 64, height: 64, borderRadius: '50%',
              background: colors.stateOkSoft, color: colors.stateOk,
              display: 'grid', placeItems: 'center', margin: '0 auto 18px',
              fontSize: 32, fontWeight: 700,
            }}>✓</div>
            <h1 style={{ ...ds.h1, marginBottom: 10 }}>¡Cuenta creada!</h1>
            <p style={{
              fontSize: type.sm, color: colors.textDim,
              lineHeight: 1.6, marginTop: 0, marginBottom: 22,
            }}>
              Ya puedes empezar a recibir pedidos. Para <strong>abrir tu marketplace público</strong>{' '}
              (<code style={{
                background: colors.surface2, padding: '1px 6px', borderRadius: 4,
                fontSize: type.xs, color: colors.text,
              }}>pidoo.es/s/tu-slug</code>) configura tu marca en{' '}
              <strong>socio.pidoo.es</strong>: logo, banner, descripción y redes sociales.
            </p>

            {native ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <button onClick={irAMarketplace} style={{ ...ds.secondaryBtn, height: 44 }}>
                  Abrir configuración (web)
                </button>
                <button onClick={empezarRepartir} style={{ ...ds.primaryBtn, height: 44 }}>
                  Empezar a repartir
                </button>
              </div>
            ) : (
              <button onClick={irAMarketplace} style={{ ...ds.primaryBtn, height: 44, width: '100%' }}>
                Configurar mi marketplace
              </button>
            )}
          </div>
        </div>
      </div>
    )
  }

  // Form principal
  return (
    <div style={pageStyle}>
      <button
        onClick={cerrarSesion}
        style={{
          position: 'absolute', top: 'calc(env(safe-area-inset-top) + 16px)', right: 16,
          background: 'transparent', border: `1px solid ${colors.border}`,
          color: colors.textMute, fontSize: 12, fontWeight: 600,
          padding: '8px 14px', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit',
        }}
      >
        Cerrar sesión
      </button>

      <div style={{ maxWidth: 480, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 22 }}>
          <div style={{
            fontSize: 11, fontWeight: 800, color: colors.primary,
            letterSpacing: '0.12em', textTransform: 'uppercase',
          }}>Bienvenido a Pidoo Socios</div>
          <h1 style={{ ...ds.h1, marginTop: 8 }}>Crea tu cuenta de socio Pidoo</h1>
          <p style={{
            fontSize: type.sm, color: colors.textMute,
            marginTop: 8, marginBottom: 0, lineHeight: 1.55,
          }}>
            Solo necesitamos 2 datos para empezar. Lo demás lo configuras cuando quieras.
          </p>
        </div>

        <div style={{ ...ds.card, padding: '22px 24px' }}>
          {error && (
            <div style={{
              background: colors.dangerSoft, color: colors.danger,
              padding: '10px 12px', borderRadius: 8, fontSize: type.xs,
              marginBottom: 16, border: `1px solid ${colors.danger}`,
            }}>{error}</div>
          )}

          <div style={{ marginBottom: 14 }}>
            <label style={ds.label}>Nombre completo *</label>
            <input
              value={nombre}
              onChange={e => setNombre(e.target.value)}
              placeholder="Ej: Marlon Rodelo"
              style={ds.input}
              autoComplete="name"
            />
          </div>

          <div style={{ marginBottom: 16 }}>
            <label style={ds.label}>Teléfono *</label>
            <input
              value={telefono}
              onChange={e => setTelefono(e.target.value)}
              placeholder="+34 600 000 000"
              style={ds.input}
              inputMode="tel"
              autoComplete="tel"
            />
          </div>

          <label style={{
            display: 'flex', alignItems: 'flex-start', gap: 10,
            padding: '12px 14px', borderRadius: 10,
            border: `1px solid ${acepta ? colors.primary : colors.border}`,
            background: acepta ? colors.primarySoft : colors.surface2,
            cursor: 'pointer', marginBottom: 18,
          }}>
            <input
              type="checkbox"
              checked={acepta}
              onChange={e => setAcepta(e.target.checked)}
              style={{ marginTop: 2, cursor: 'pointer' }}
            />
            <span style={{ fontSize: type.xs, color: colors.text, lineHeight: 1.5 }}>
              Acepto los{' '}
              <a href="https://pidoo.es/terminos" target="_blank" rel="noreferrer"
                 style={{ color: colors.primary, fontWeight: 600 }}>términos</a>
              {' '}y la{' '}
              <a href="https://pidoo.es/privacidad" target="_blank" rel="noreferrer"
                 style={{ color: colors.primary, fontWeight: 600 }}>política de privacidad</a>.
            </span>
          </label>

          <button
            onClick={submit}
            disabled={!puedeEnviar}
            style={{
              ...ds.primaryBtn, width: '100%', height: 46,
              opacity: puedeEnviar ? 1 : 0.55,
              cursor: puedeEnviar ? 'pointer' : 'not-allowed',
            }}
          >
            {estado === 'creando' ? 'Creando tu cuenta…' : 'Crear mi cuenta'}
          </button>
        </div>
      </div>
    </div>
  )
}

const pageStyle = {
  minHeight: '100vh',
  background: colors.bg,
  padding: 'calc(env(safe-area-inset-top) + 32px) 16px 32px',
  position: 'relative',
}
