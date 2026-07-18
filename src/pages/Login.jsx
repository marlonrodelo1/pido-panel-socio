import { useEffect, useState } from 'react'
import { useSocio } from '../context/SocioContext'
import { loginEmail, registerEmail, resetPassword } from '../lib/auth'
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

  // Alto del viewport VISIBLE. En iOS (WKWebView) el teclado no reduce ni 100vh ni
  // 100dvh: el formulario se quedaba debajo del teclado y la pantalla se arrastraba.
  // visualViewport sí refleja el hueco real que deja el teclado. JS puro, sin plugin.
  const [altoVisible, setAltoVisible] = useState('100dvh')
  useEffect(() => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null
    if (!vv) return
    const ajustar = () => setAltoVisible(`${Math.round(vv.height)}px`)
    ajustar()
    vv.addEventListener('resize', ajustar)
    vv.addEventListener('scroll', ajustar)
    return () => {
      vv.removeEventListener('resize', ajustar)
      vv.removeEventListener('scroll', ajustar)
    }
  }, [])

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

  return (
    <div style={{
      // Altura del viewport REALMENTE visible (ver useEffect de visualViewport arriba).
      // En iOS/WKWebView ni 100vh ni 100dvh se encogen al abrir el teclado: el formulario
      // quedaba detrás del teclado y la pantalla se podía arrastrar de más. visualViewport
      // sí reporta el alto real, y es JS puro (sin plugin nativo).
      height: altoVisible, minHeight: altoVisible,
      background: colors.cream, fontFamily: type.family,
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      padding: 'calc(env(safe-area-inset-top) + 32px) 20px 32px',
      position: 'relative', overflow: 'hidden',
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
