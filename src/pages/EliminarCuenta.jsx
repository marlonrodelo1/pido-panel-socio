// EliminarCuenta — pantalla de borrado de cuenta del socio.
// Cumple requisito Google Play / App Store (Data Safety: cuenta eliminable
// desde la propia app sin pasar por web). Patrón análogo al de pido-panel-restaurante.

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
        email: user.email,
        password,
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
    <div style={{ maxWidth: 560, margin: '0 auto', paddingBottom: 80 }}>
      <button
        onClick={onBack}
        style={{
          display: 'flex', alignItems: 'center', gap: 6, background: 'none',
          border: 'none', color: colors.text, fontSize: type.sm, fontWeight: 600,
          cursor: 'pointer', padding: 0, marginBottom: 16,
        }}
      >
        ← Volver
      </button>

      <div style={{
        ...ds.card, marginBottom: 14,
        background: colors.dangerSoft, borderColor: 'rgba(220,38,38,0.25)',
      }}>
        <h2 style={{ ...ds.h2, color: colors.danger, marginBottom: 8 }}>
          Eliminar cuenta de socio
        </h2>
        <p style={{ fontSize: type.sm, color: colors.text, lineHeight: 1.5, margin: 0 }}>
          Esta acción es <strong>irreversible</strong>. No podrás recuperar tu cuenta ni los datos asociados.
        </p>
      </div>

      <div style={{ ...ds.card, marginBottom: 14 }}>
        <h2 style={ds.h2}>Qué pasará al eliminar tu cuenta</h2>
        <ul style={{ fontSize: type.sm, color: colors.textDim, lineHeight: 1.7, paddingLeft: 18, margin: 0 }}>
          <li>Tu cuenta de acceso se borrará por completo (email + contraseña).</li>
          <li>Tu marketplace (`socio.pidoo.es/s/{socio?.slug || '…'}`) se desactivará.</li>
          <li>Dejarás de recibir pedidos como repartidor en Pidoo.</li>
          <li>Si tienes una suscripción activa de Pidoo (39 €/mes), se cancelará en Stripe.</li>
          <li>Se eliminarán los tokens de notificaciones y tus datos personales (nombre, teléfono, IBAN, datos fiscales, redes…).</li>
        </ul>
        <h2 style={{ ...ds.h2, marginTop: 14 }}>Qué se conserva (obligación legal)</h2>
        <ul style={{ fontSize: type.sm, color: colors.textDim, lineHeight: 1.7, paddingLeft: 18, margin: 0 }}>
          <li>Histórico de pedidos completados y balances semanales (mín. 6 años — art. 30 Código de Comercio).</li>
          <li>Movimientos contables anonimizados.</li>
        </ul>
      </div>

      {paso === 1 && (
        <button
          onClick={() => setPaso(2)}
          style={{
            ...ds.primaryBtn,
            width: '100%', height: 44,
            background: colors.danger, borderColor: colors.danger,
          }}
        >
          Continuar con la eliminación
        </button>
      )}

      {paso === 2 && (
        <div style={ds.card}>
          <h2 style={ds.h2}>Confirma con tu contraseña</h2>

          <div style={{ marginBottom: 12 }}>
            <label style={ds.label}>Email</label>
            <input
              value={user?.email || ''}
              readOnly
              style={{ ...ds.input, background: colors.surface2, color: colors.textMute }}
            />
          </div>
          <div style={{ marginBottom: 12 }}>
            <label style={ds.label}>Contraseña actual</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              style={ds.input}
            />
          </div>
          <div style={{ marginBottom: 14 }}>
            <label style={ds.label}>
              Escribe <strong style={{ color: colors.danger }}>ELIMINAR</strong> para confirmar
            </label>
            <input
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="ELIMINAR"
              style={ds.input}
            />
          </div>

          {error && (
            <div style={{
              background: colors.dangerSoft, color: colors.danger,
              padding: '10px 12px', borderRadius: 8, marginBottom: 12,
              fontSize: type.xs, fontWeight: 600,
            }}>
              {error}
            </div>
          )}

          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => setPaso(1)}
              disabled={loading}
              style={{ ...ds.secondaryBtn, flex: 1, height: 44, opacity: loading ? 0.6 : 1 }}
            >
              Cancelar
            </button>
            <button
              onClick={eliminar}
              disabled={loading}
              style={{
                ...ds.primaryBtn,
                flex: 2, height: 44,
                background: colors.danger, borderColor: colors.danger,
                opacity: loading ? 0.6 : 1,
              }}
            >
              {loading ? 'Eliminando…' : 'Eliminar permanentemente'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
