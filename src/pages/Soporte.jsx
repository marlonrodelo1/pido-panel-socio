import { useState } from 'react'
import { useSocio } from '../context/SocioContext'
import { supabase } from '../lib/supabase'
import { colors, ds, type } from '../lib/uiStyles'

const MOTIVOS = [
  'Problema técnico',
  'Problema con un pedido',
  'Pago / facturación',
  'Vinculación con restaurante',
  'Otro',
]

export default function Soporte() {
  const { socio, user } = useSocio()
  const [motivo, setMotivo] = useState(MOTIVOS[0])
  const [mensaje, setMensaje] = useState('')
  const [sending, setSending] = useState(false)
  const [ok, setOk] = useState(false)
  const [err, setErr] = useState(null)

  const enviar = async () => {
    if (!mensaje.trim()) return
    setSending(true); setErr(null); setOk(false)
    try {
      const { error } = await supabase.from('soporte').insert({
        user_id: user.id,
        socio_id: socio?.id || null,
        motivo,
        mensaje: mensaje.trim(),
        canal: 'panel-socio',
      })
      if (error) throw error
      setMensaje(''); setOk(true); setTimeout(() => setOk(false), 3500)
    } catch (e) {
      setErr(e.message || 'No se pudo enviar. Escríbenos a soporte@pidoo.es')
    } finally { setSending(false) }
  }

  return (
    <div>
      <h1 style={ds.h1}>Soporte</h1>
      <p style={{ color: colors.textMute, fontSize: type.sm, marginTop: 4, marginBottom: 18 }}>
        ¿Necesitas ayuda? Cuéntanos y te respondemos lo antes posible.
      </p>

      <div style={{ ...ds.card, maxWidth: 620 }}>
        <div style={{ marginBottom: 14 }}>
          <label style={ds.label}>Motivo</label>
          <select value={motivo} onChange={e => setMotivo(e.target.value)}
            style={{
              ...ds.input, appearance: 'none', WebkitAppearance: 'none', cursor: 'pointer',
              paddingRight: 36,
              backgroundImage: `url("data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#6B6B68" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>')}")`,
              backgroundRepeat: 'no-repeat', backgroundPosition: 'right 12px center',
            }}>
            {MOTIVOS.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={ds.label}>Mensaje</label>
          <textarea value={mensaje} onChange={e => setMensaje(e.target.value)} rows={6}
            placeholder="Cuéntanos qué ocurre…"
            style={{ ...ds.input, height: 'auto', padding: '10px 12px', fontFamily: "'Inter', sans-serif", resize: 'vertical' }} />
        </div>

        {err && <div style={{ background: colors.dangerSoft, color: colors.danger, padding: '10px 12px', borderRadius: 8, marginBottom: 10, fontSize: type.xs }}>{err}</div>}
        {ok && <div style={{ background: colors.stateOkSoft, color: colors.stateOk, padding: '10px 12px', borderRadius: 8, marginBottom: 10, fontSize: type.xs }}>Enviado. Te responderemos por email.</div>}

        <button onClick={enviar} disabled={sending || !mensaje.trim()}
          style={{ ...ds.primaryBtn, opacity: (sending || !mensaje.trim()) ? 0.6 : 1 }}>
          {sending ? 'Enviando…' : 'Enviar mensaje'}
        </button>

        <div style={{ marginTop: 14, fontSize: type.xs, color: colors.textMute }}>
          También puedes escribirnos a <strong style={{ color: colors.text }}>soporte@pidoo.es</strong>.
        </div>
      </div>
    </div>
  )
}
