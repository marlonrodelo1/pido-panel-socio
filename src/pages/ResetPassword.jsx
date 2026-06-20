import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { colors, ds, type } from '../lib/uiStyles'

// Página de restablecer contraseña. El email de recuperación redirige aquí
// (/reset-password) con un token en el hash; el cliente Supabase
// (detectSessionInUrl) lo procesa y crea una sesión de recuperación.
export default function ResetPassword() {
  const [estado, setEstado] = useState('cargando') // cargando | listo | invalido | hecho
  const [pwd, setPwd] = useState('')
  const [pwd2, setPwd2] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    let resuelto = false
    const ok = () => { if (!resuelto) { resuelto = true; setEstado('listo') } }
    supabase.auth.getSession().then(({ data }) => { if (data?.session) ok() }).catch(() => {})
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => { if (session) ok() })
    const t = setTimeout(() => { if (!resuelto) setEstado('invalido') }, 3500)
    return () => { clearTimeout(t); sub?.subscription?.unsubscribe?.() }
  }, [])

  const guardar = async () => {
    setError(null)
    if (!/^(?=.*[A-Z])(?=.*\d).{8,}$/.test(pwd)) {
      setError('La contraseña debe tener al menos 8 caracteres, 1 mayúscula y 1 número'); return
    }
    if (pwd !== pwd2) { setError('Las contraseñas no coinciden'); return }
    setLoading(true)
    try {
      const { error } = await supabase.auth.updateUser({ password: pwd })
      if (error) throw error
      setEstado('hecho')
    } catch (e) {
      setError(e.message || 'No se pudo actualizar la contraseña')
    } finally { setLoading(false) }
  }

  return (
    <div style={{
      minHeight: '100vh', background: colors.cream, fontFamily: type.family,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 'calc(env(safe-area-inset-top) + 32px) 20px 32px',
    }}>
      <div style={{
        width: '100%', maxWidth: 380,
        background: colors.paper, borderRadius: 16, padding: '28px 24px',
        border: `1px solid ${colors.border}`, boxShadow: colors.shadowMd,
      }}>
        <div style={{ textAlign: 'center', marginBottom: 22 }}>
          <img src="/icon.png" alt="Pidoo" width={72} height={72}
            style={{ borderRadius: 18, boxShadow: '0 10px 24px rgba(197,86,44,0.2)' }} />
        </div>

        {estado === 'cargando' && (
          <p style={{ textAlign: 'center', color: colors.textMute, fontSize: type.sm }}>Verificando enlace…</p>
        )}

        {estado === 'invalido' && (
          <>
            <h2 style={{ ...ds.h2, marginBottom: 8 }}>Enlace no válido</h2>
            <p style={{ fontSize: type.sm, color: colors.textMute, marginBottom: 18, lineHeight: 1.5 }}>
              Este enlace de recuperación ha caducado o ya se usó. Solicita uno nuevo desde el login.
            </p>
            <button onClick={() => { window.location.href = '/login' }}
              style={{ ...ds.glossyBtn, width: '100%', height: 44 }}>Ir al login</button>
          </>
        )}

        {estado === 'hecho' && (
          <>
            <h2 style={{ ...ds.h2, marginBottom: 8 }}>Contraseña actualizada</h2>
            <p style={{ fontSize: type.sm, color: colors.textMute, marginBottom: 18, lineHeight: 1.5 }}>
              Ya puedes entrar con tu nueva contraseña.
            </p>
            <button onClick={() => { window.location.href = '/' }}
              style={{ ...ds.glossyBtn, width: '100%', height: 44 }}>Entrar</button>
          </>
        )}

        {estado === 'listo' && (
          <>
            <h2 style={{ ...ds.h2, marginBottom: 4 }}>Nueva contraseña</h2>
            <p style={{ fontSize: type.xs, color: colors.textMute, marginBottom: 18 }}>
              Mínimo 8 caracteres, una mayúscula y un número.
            </p>
            <input type="password" placeholder="Nueva contraseña" value={pwd}
              onChange={e => setPwd(e.target.value)}
              style={{ ...ds.input, marginBottom: 12 }} />
            <input type="password" placeholder="Repite la contraseña" value={pwd2}
              onChange={e => setPwd2(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && guardar()}
              style={{ ...ds.input, marginBottom: 12 }} />
            {error && (
              <div style={{
                color: colors.danger, fontSize: type.xs, marginBottom: 12,
                background: colors.dangerSoft, padding: '10px 14px', borderRadius: 10, fontWeight: 600,
              }}>{error}</div>
            )}
            <button onClick={guardar} disabled={loading}
              style={{ ...ds.glossyBtn, width: '100%', height: 46, opacity: loading ? 0.6 : 1 }}>
              {loading ? 'Guardando…' : 'Guardar contraseña'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
