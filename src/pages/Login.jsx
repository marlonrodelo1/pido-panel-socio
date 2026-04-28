import { useEffect, useState } from 'react'
import { useSocio } from '../context/SocioContext'
import { loginEmail, registerEmail, resetPassword } from '../lib/auth'
import GoogleButton from '../components/GoogleButton'

function ErrorBox({ msg }) {
  if (!msg) return null
  return (
    <div style={{
      color: 'var(--c-primary)', fontSize: 12, marginBottom: 12, textAlign: 'center',
      background: 'var(--c-primary-light)', padding: '10px 14px', borderRadius: 8,
      border: '1px solid var(--c-primary-soft)',
    }}>{msg}</div>
  )
}

function Field({ label, ...props }) {
  return (
    <div style={{ marginBottom: 12 }}>
      {label && (
        <label style={{
          fontSize: 11, fontWeight: 700, color: 'var(--c-muted)',
          textTransform: 'uppercase', letterSpacing: '0.05em',
          marginBottom: 6, display: 'block',
        }}>{label}</label>
      )}
      <input {...props} style={{
        width: '100%', padding: '13px 14px', borderRadius: 8,
        border: '1px solid var(--c-border)',
        fontSize: 14, fontFamily: 'inherit',
        background: 'var(--c-surface)', color: 'var(--c-text)', outline: 'none',
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

  // Si venimos de eliminar cuenta, mostramos mensaje informativo
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
    if (msg.includes('Password should be')) return 'Contraseña muy corta (mínimo 8).'
    if (msg.includes('Email rate limit')) return 'Demasiados intentos. Espera unos minutos.'
    return msg
  }

  const handle = async () => {
    setError(null); setAuthError?.(null); setLoading(true)
    try {
      if (modo === 'login') await loginEmail(email, password)
      else if (modo === 'registro') {
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
      minHeight: '100vh', background: 'var(--c-bg)',
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center',
      padding: 'calc(env(safe-area-inset-top) + 32px) 20px 32px',
      position: 'relative',
    }}>
      {onBack && (
        <button onClick={onBack} style={{
          position: 'absolute', top: 'calc(env(safe-area-inset-top) + 18px)', left: 18,
          background: 'none', border: 'none', cursor: 'pointer',
          color: 'var(--c-muted)', fontSize: 13, fontWeight: 600,
          padding: '8px 12px', borderRadius: 8, fontFamily: 'inherit',
          display: 'inline-flex', alignItems: 'center', gap: 6,
        }}>← Volver</button>
      )}
      <div style={{ width: '100%', maxWidth: 380 }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <img
            src="/icon.png"
            alt="Pidoo go"
            width={120}
            height={120}
            style={{
              display: 'block',
              margin: '0 auto',
              borderRadius: 28,
              boxShadow: '0 8px 24px rgba(255,107,44,0.30)',
            }}
          />
        </div>

        <div style={{ background: 'var(--c-surface)', borderRadius: 16, padding: '28px 24px', border: '1px solid var(--c-border)' }}>
          {modo === 'reset' ? (
            resetSent ? (
              <>
                <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Email enviado</h2>
                <p style={{ fontSize: 13, color: 'var(--c-muted)', marginBottom: 16 }}>
                  Revisa tu bandeja y sigue el enlace para restablecer la contraseña.
                </p>
                <button onClick={() => { setModo('login'); setResetSent(false) }} style={{
                  width: '100%', padding: '13px 0', borderRadius: 8, border: 'none',
                  background: 'linear-gradient(135deg,#FF6B2C,#E85A1F)',
                  color: '#fff', fontWeight: 700, cursor: 'pointer',
                }}>Volver al login</button>
              </>
            ) : (
              <>
                <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>Recuperar acceso</h2>
                <p style={{ fontSize: 12, color: 'var(--c-muted)', marginBottom: 16 }}>
                  Te enviaremos un enlace a tu email.
                </p>
                <Field type="email" placeholder="Tu email" value={email} onChange={e => setEmail(e.target.value)} />
                <ErrorBox msg={error} />
                <button onClick={handle} disabled={loading} style={{
                  width: '100%', padding: '13px 0', borderRadius: 8, border: 'none',
                  background: 'linear-gradient(135deg,#FF6B2C,#E85A1F)',
                  color: '#fff', fontWeight: 700, cursor: 'pointer',
                  opacity: loading ? 0.6 : 1, marginBottom: 8,
                }}>{loading ? 'Enviando...' : 'Enviar enlace'}</button>
                <button onClick={() => setModo('login')} style={{
                  width: '100%', padding: '10px 0', background: 'none', border: 'none',
                  color: 'var(--c-muted)', fontSize: 12, cursor: 'pointer',
                }}>← Volver</button>
              </>
            )
          ) : (
            <>
              <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>
                {modo === 'login' ? 'Bienvenido de nuevo' : 'Crea tu cuenta de socio'}
              </h2>
              <p style={{ fontSize: 13, color: 'var(--c-muted)', marginBottom: 20 }}>
                {modo === 'login' ? 'Accede a tu panel de socio Pidoo.' : 'Empieza a construir tu mini-marketplace.'}
              </p>

              <div style={{ display: 'flex', background: 'var(--c-surface2)', borderRadius: 8, padding: 3, marginBottom: 20, gap: 3 }}>
                {['login', 'registro'].map(m => (
                  <button key={m} onClick={() => { setModo(m); setError(null) }} style={{
                    flex: 1, padding: '9px 0', borderRadius: 6, border: 'none',
                    background: modo === m ? 'linear-gradient(135deg,#FF6B2C,#E85A1F)' : 'transparent',
                    color: modo === m ? '#fff' : 'var(--c-muted)',
                    fontSize: 13, fontWeight: 700, cursor: 'pointer',
                  }}>{m === 'login' ? 'Iniciar sesión' : 'Registrarse'}</button>
                ))}
              </div>

              <Field type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} />
              <Field type="password" placeholder="Contraseña" value={password} onChange={e => setPassword(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handle()} />

              <ErrorBox msg={error} />

              <button onClick={handle} disabled={loading} style={{
                width: '100%', padding: '13px 0', borderRadius: 8, border: 'none',
                background: 'linear-gradient(135deg,#FF6B2C,#E85A1F)',
                color: '#fff', fontWeight: 700, cursor: 'pointer',
                opacity: loading ? 0.6 : 1, marginBottom: 10,
              }}>{loading ? 'Procesando...' : (modo === 'login' ? 'Iniciar sesión →' : 'Crear cuenta →')}</button>

              {modo === 'login' && (
                <button onClick={() => { setModo('reset'); setError(null) }} style={{
                  width: '100%', padding: '6px 0', background: 'none', border: 'none',
                  color: 'var(--c-muted)', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                }}>¿Olvidaste tu contraseña?</button>
              )}

              <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '16px 0' }}>
                <div style={{ flex: 1, height: 1, background: 'var(--c-border)' }} />
                <span style={{ fontSize: 11, color: 'var(--c-muted)', fontWeight: 600 }}>o</span>
                <div style={{ flex: 1, height: 1, background: 'var(--c-border)' }} />
              </div>

              <GoogleButton />
            </>
          )}
        </div>
      </div>
    </div>
  )
}
