// EliminarCuenta — pantalla de borrado de cuenta del socio.

import { useState } from 'react'
import { useSocio } from '../context/SocioContext'
import { supabase, FUNCTIONS_URL } from '../lib/supabase'
import { colors, ds, type } from '../lib/uiStyles'

export default function EliminarCuenta({ onBack }) {
  const { user, socio, logout } = useSocio()
  const [paso, setPaso] = useState(1)
  const [password, setPassword] = useState('')
  const [confirmText, setConfirmText] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const eliminar = async () => {
    setError(null)
    if (!password) { setError('Introduce tu contraseña actual'); return }
    if (confirmText.trim().toUpperCase() !== 'ELIMINAR') {
      setError('Escribe ELIMINAR para confirmar')
      return
    }

    setLoading(true)
    try {
      const { error: authErr } = await supabase.auth.signInWithPassword({
        email: user.email, password,
      })
      if (authErr) throw new Error('Contraseña incorrecta')

      const { data: { session } } = await supabase.auth.getSession()
      const r = await fetch(`${FUNCTIONS_URL}/eliminar_cuenta_socio`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token || ''}`,
          'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({ socio_id: socio?.id }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || 'No se pudo eliminar la cuenta')

      try { await logout() } catch (_) {}
      try { localStorage.setItem('pidoo_cuenta_eliminada', '1') } catch (_) {}
      try { sessionStorage.clear() } catch (_) {}
      window.location.replace('/login')
    } catch (e) {
      setError(e.message || 'Error al eliminar la cuenta')
      setLoading(false)
    }
  }

  return (
    <div style={{ maxWidth: 600, margin: '0 auto' }}>
      <button onClick={onBack} style={{
        ...ds.secondaryBtn, marginBottom: 14,
        display: 'inline-flex', alignItems: 'center', gap: 6,
      }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>
        Volver
      </button>

      {/* Header danger */}
      <div style={{
        ...ds.card, padding: 20, marginBottom: 14,
        background: colors.dangerSoft, borderColor: colors.danger,
      }}>
        <h2 style={{ ...ds.h2, color: colors.danger, marginBottom: 8 }}>
          Eliminar cuenta de socio
        </h2>
        <p style={{ fontSize: type.sm, color: colors.text, lineHeight: 1.5, margin: 0 }}>
          Esta acción es <strong>irreversible</strong>. No podrás recuperar tu cuenta ni los datos asociados.
        </p>
      </div>

      {/* Qué pasa */}
      <div style={{ ...ds.card, padding: 20, marginBottom: 14 }}>
        <h2 style={ds.h2}>Qué pasará al eliminar tu cuenta</h2>
        <ul style={{ fontSize: type.sm, color: colors.textDim, lineHeight: 1.7, paddingLeft: 18, margin: 0 }}>
          <li>Tu cuenta de acceso se borrará por completo (email + contraseña).</li>
          <li>Dejarás de recibir pedidos como repartidor en Pidoo.</li>
          <li>Si tienes una suscripción activa (39 €/mes), se cancelará en Stripe.</li>
          <li>Se eliminarán tus tokens de notificaciones y datos personales (nombre, teléfono, IBAN, datos fiscales…).</li>
        </ul>
        <h2 style={{ ...ds.h2, marginTop: 18 }}>Qué se conserva (obligación legal)</h2>
        <ul style={{ fontSize: type.sm, color: colors.textDim, lineHeight: 1.7, paddingLeft: 18, margin: 0 }}>
          <li>Histórico de pedidos completados y balances semanales (mín. 6 años — art. 30 Código de Comercio).</li>
          <li>Movimientos contables anonimizados.</li>
        </ul>
      </div>

      {paso === 1 ? (
        <button onClick={() => setPaso(2)} style={{
          ...ds.dangerBtn, width: '100%', height: 46,
          background: colors.danger, color: '#fff',
          border: `1px solid ${colors.danger}`,
        }}>
          Continuar con la eliminación
        </button>
      ) : (
        <div style={{ ...ds.card, padding: 20 }}>
          <h2 style={ds.h2}>Confirma con tu contraseña</h2>

          <div style={{ marginBottom: 12 }}>
            <label style={ds.label}>Email</label>
            <input value={user?.email || ''} readOnly
              style={{ ...ds.input, background: colors.surface2, color: colors.textMute }} />
          </div>
          <div style={{ marginBottom: 12 }}>
            <label style={ds.label}>Contraseña actual</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password" style={ds.input} />
          </div>
          <div style={{ marginBottom: 14 }}>
            <label style={ds.label}>
              Escribe <strong style={{ color: colors.danger }}>ELIMINAR</strong> para confirmar
            </label>
            <input value={confirmText} onChange={(e) => setConfirmText(e.target.value)}
              placeholder="ELIMINAR" style={ds.input} />
          </div>

          {error && (
            <div style={{
              background: colors.dangerSoft, color: colors.danger,
              padding: '10px 12px', borderRadius: 10,
              marginBottom: 12, fontSize: type.xs, fontWeight: 600,
            }}>{error}</div>
          )}

          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={() => setPaso(1)} disabled={loading}
              style={{ ...ds.secondaryBtn, flex: 1, height: 44, opacity: loading ? 0.6 : 1 }}>
              Cancelar
            </button>
            <button onClick={eliminar} disabled={loading}
              style={{
                ...ds.dangerBtn, flex: 2, height: 44,
                background: colors.danger, color: '#fff',
                border: `1px solid ${colors.danger}`,
                opacity: loading ? 0.6 : 1,
              }}>
              {loading ? 'Eliminando…' : 'Eliminar permanentemente'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
