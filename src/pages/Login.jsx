import { useEffect, useState } from 'react'
import { useSocio } from '../context/SocioContext'
import { loginEmail, registerEmail, resetPassword, loginGoogle } from '../lib/auth'
import { colors, ds, type } from '../lib/uiStyles'

function ErrorBox({ msg }) {
  if (!msg) return null
  return (
    <div style={{
      color: colors.danger, fontSize: type.xs, marginBottom: 12,
      background: colors.dangerSoft, padding: '10px 14px', borderRadius: 10,
      fontWeight: 600, textAlign: 'center',
    }}>{msg}</div>
  )
}

function Field({ label, ...props }) {
  return (
    <div style={{ marginBottom: 12 }}>
      {label && <label style={ds.label}>{label}</label>}
      <input {...props} style={{
        width: '100%', padding: '13px 14px', borderRadius: 10,
        border: `1px solid ${colors.border}`,
        fontSize: 14, fontFamily: type.family,
        background: colors.paper, color: colors.text, outline: 'none',
        boxSizing: 'border-box',
      }} />
    </div>
  )
}

export default function Login({ onBack }) {
  const { authError, setAuthError } = useSocio()
  const [modo, setModo] = useState('login')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(authError)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [resetSent, setResetSent] = useState(false)
  const [aceptaTerminos, setAceptaTerminos] = useState(false)

  useEffect(() => {
    try {
      if (localStorage.getItem('pidoo_cuenta_eliminada') === '1') {
        setError('Tu cuenta ha sido eliminada correctamente.')
        localStorage.removeItem('pidoo_cuenta_eliminada')
      }
    } catch (_) {}
  }, [])

  function translate(msg) {
    if (!msg) return 'Error desconocido'
    if (msg.includes('Invalid login credentials')) return 'Email o contraseña incorrectos'
    if (msg.includes('User already registered')) return 'Este email ya existe. Inicia sesión.'
    if (msg.includes('Password should be')) return 'La contraseña debe tener al menos 8 caracteres, 1 mayúscula y 1 número.'
    if (msg.includes('Email rate limit')) return 'Demasiados intentos. Espera unos minutos.'
    return msg
  }

  const handle = async () => {
    setError(null); setAuthError?.(null); setLoading(true)
    try {
      if (modo === 'login') await loginEmail(email, password)
      else if (modo === 'registro') {
        if (!aceptaTerminos) {
          throw new Error('Debes aceptar los términos y la política de privacidad para registrarte')
        }
        if (!/^(?=.*[A-Z])(?=.*\d).{8,}$/.test(password)) {
          throw new Error('La contraseña debe tener al menos 8 caracteres, 1 mayúscula y 1 número')
        }
        await registerEmail(email, password)
      } else if (modo === 'reset') {
        await resetPassword(email); setResetSent(true)
      }
    } catch (e) {
      setError(translate(e.message))
    } finally { setLoading(false) }
  }

  const handleGoogle = async () => {
    if (modo === 'registro' && !aceptaTerminos) {
      setError('Debes aceptar los términos y la política de privacidad para registrarte')
      return
    }
    setError(null); setAuthError?.(null); setLoading(true)
    try {
      await loginGoogle()
      // Web: signInWithOAuth redirige (la página se recarga → este componente muere).
      // Nativo: loginGoogle abre el navegador externo y resuelve YA; el login real
      // vuelve por el deep link (appUrlOpen) y re-renderiza la app. Reseteamos loading
      // para que, si el usuario cierra el navegador sin completar, no quede el botón
      // en "Procesando…" para siempre.
      setLoading(false)
    } catch (e) {
      setError('No se pudo conectar con Google: ' + (e.message || ''))
      setLoading(false)
    }
  }

  return (
    <div style={{
      minHeight: '100vh', background: colors.cream, fontFamily: type.family,
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      padding: 'calc(env(safe-area-inset-top) + 32px) 20px 32px',
      position: 'relative',
    }}>
      {onBack && (
        <button onClick={onBack} style={{
          position: 'absolute', top: 'calc(env(safe-area-inset-top) + 18px)', left: 18,
          background: 'none', border: 'none', cursor: 'pointer',
          color: colors.textMute, fontSize: 13, fontWeight: 600,
          padding: '8px 12px', borderRadius: 8, fontFamily: type.family,
          display: 'inline-flex', alignItems: 'center', gap: 6,
        }}>← Volver</button>
      )}

      <div style={{ width: '100%', maxWidth: 380 }}>
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <img src="/icon.png" alt="Pidoo Socios" width={108} height={108}
            style={{
              display: 'block', margin: '0 auto', borderRadius: 26,
              boxShadow: '0 12px 28px rgba(197,86,44,0.22)',
            }} />
        </div>

        <div style={{
          background: colors.paper, borderRadius: 16, padding: '28px 24px',
          border: `1px solid ${colors.border}`,
          boxShadow: colors.shadowMd,
        }}>
          {modo === 'reset' ? (
            resetSent ? (
              <>
                <h2 style={{ ...ds.h2, marginBottom: 8 }}>Email enviado</h2>
                <p style={{ fontSize: type.sm, color: colors.textMute, marginBottom: 18 }}>
                  Revisa tu bandeja y sigue el enlace para restablecer la contraseña.
                </p>
                <button onClick={() => { setModo('login'); setResetSent(false) }}
                  style={{ ...ds.glossyBtn, width: '100%', height: 44 }}>
                  Volver al login
                </button>
              </>
            ) : (
              <>
                <h2 style={{ ...ds.h2, marginBottom: 4 }}>Recuperar acceso</h2>
                <p style={{ fontSize: type.xs, color: colors.textMute, marginBottom: 18 }}>
                  Te enviaremos un enlace a tu email.
                </p>
                <Field type="email" placeholder="Tu email" value={email} onChange={e => setEmail(e.target.value)} />
                <ErrorBox msg={error} />
                <button onClick={handle} disabled={loading}
                  style={{ ...ds.glossyBtn, width: '100%', height: 44, opacity: loading ? 0.6 : 1, marginBottom: 8 }}>
                  {loading ? 'Enviando…' : 'Enviar enlace'}
                </button>
                <button onClick={() => setModo('login')} style={{
                  width: '100%', padding: '10px 0', background: 'none', border: 'none',
                  color: colors.textMute, fontSize: 12, cursor: 'pointer', fontFamily: type.family,
                }}>← Volver</button>
              </>
            )
          ) : (
            <>
              <h2 style={{ ...ds.h2, marginBottom: 4 }}>
                {modo === 'login' ? 'Bienvenido de nuevo' : 'Crea tu cuenta de socio'}
              </h2>
              <p style={{ fontSize: type.sm, color: colors.textMute, marginBottom: 20 }}>
                {modo === 'login' ? 'Accede a tu panel de socio Pidoo.' : 'Empieza a recibir pedidos hoy.'}
              </p>

              {/* Segmented tabs */}
              <div style={{
                display: 'flex', background: colors.surface2,
                borderRadius: 999, padding: 3, marginBottom: 20, gap: 3,
              }}>
                {[
                  { id: 'login', l: 'Iniciar sesión' },
                  { id: 'registro', l: 'Registrarse' },
                ].map(m => {
                  const active = modo === m.id
                  return (
                    <button key={m.id} onClick={() => { setModo(m.id); setError(null) }} style={{
                      flex: 1, padding: '10px 0', borderRadius: 999, border: 'none',
                      background: active ? `linear-gradient(180deg, ${colors.ink2} 0%, ${colors.ink} 100%)` : 'transparent',
                      color: active ? colors.cream : colors.textMute,
                      fontSize: 13, fontWeight: 700, cursor: 'pointer',
                      fontFamily: type.family,
                      boxShadow: active ? colors.shadowGlossy : 'none',
                    }}>{m.l}</button>
                  )
                })}
              </div>

              <Field type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} />
              <Field type="password" placeholder="Contraseña" value={password} onChange={e => setPassword(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handle()} />

              {modo === 'registro' && (
                <label style={{ display: 'flex', alignItems: 'flex-start', gap: 9, margin: '2px 0 14px', cursor: 'pointer' }}>
                  <input type="checkbox" checked={aceptaTerminos} onChange={e => setAceptaTerminos(e.target.checked)}
                    style={{ marginTop: 2, width: 16, height: 16, accentColor: colors.terracotta, flexShrink: 0, cursor: 'pointer' }} />
                  <span style={{ fontSize: 12, color: colors.textMute, lineHeight: 1.45 }}>
                    Acepto los <a href="https://pidoo.es/terminos" target="_blank" rel="noreferrer" style={{ color: colors.terracotta, fontWeight: 700 }}>términos y condiciones</a>
                    {' '}y la <a href="https://pidoo.es/privacidad" target="_blank" rel="noreferrer" style={{ color: colors.terracotta, fontWeight: 700 }}>política de privacidad</a>.
                  </span>
                </label>
              )}

              <ErrorBox msg={error} />

              <button onClick={handle} disabled={loading || (modo === 'registro' && !aceptaTerminos)}
                style={{ ...ds.glossyBtn, width: '100%', height: 46, opacity: (loading || (modo === 'registro' && !aceptaTerminos)) ? 0.6 : 1, marginBottom: 10 }}>
                {loading ? 'Procesando…' : (modo === 'login' ? 'Iniciar sesión' : 'Crear cuenta')}
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
              </button>

              {/* Separador */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '14px 0' }}>
                <div style={{ flex: 1, height: 1, background: colors.border }} />
                <span style={{ fontSize: 11, color: colors.textMute, fontWeight: 600 }}>o</span>
                <div style={{ flex: 1, height: 1, background: colors.border }} />
              </div>

              {/* Google */}
              <button onClick={handleGoogle} disabled={loading || (modo === 'registro' && !aceptaTerminos)} style={{
                width: '100%', height: 46, borderRadius: 10,
                border: `1px solid ${colors.border}`, background: colors.paper, color: colors.text,
                fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: type.family,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
                opacity: (loading || (modo === 'registro' && !aceptaTerminos)) ? 0.6 : 1,
              }}>
                <svg width="18" height="18" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
                Continuar con Google
              </button>

              {modo === 'login' && (
                <button onClick={() => { setModo('reset'); setError(null) }} style={{
                  width: '100%', padding: '6px 0', background: 'none', border: 'none',
                  color: colors.textMute, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                  fontFamily: type.family,
                }}>¿Olvidaste tu contraseña?</button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
