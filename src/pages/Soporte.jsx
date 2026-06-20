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
  const { socio } = useSocio()
  const [motivo, setMotivo] = useState(MOTIVOS[0])
  const [mensaje, setMensaje] = useState('')
  const [sending, setSending] = useState(false)
  const [ok, setOk] = useState(false)
  const [err, setErr] = useState(null)

  const enviar = async () => {
    if (!mensaje.trim()) return
    if (!socio?.id) { setErr('Tu cuenta aún no está lista. Recarga e inténtalo de nuevo.'); return }
    setSending(true); setErr(null); setOk(false)
    try {
      // Mismo buzón que el Chat del rider (rider_support_messages); el motivo
      // se antepone al texto para que el equipo lo vea en la conversación.
      const { error } = await supabase.from('rider_support_messages').insert({
        socio_id: socio.id,
        remitente: 'rider',
        mensaje: `[${motivo}] ${mensaje.trim()}`,
      })
      if (error) throw error
      setMensaje(''); setOk(true); setTimeout(() => setOk(false), 3500)
    } catch (e) {
      console.error('[Soporte] insert error:', e)
      setErr(e.message || 'No se pudo enviar. Escríbenos a soporte@pidoo.es')
    } finally { setSending(false) }
  }

  return (
    <div style={{ maxWidth: 640 }}>
      <h1 style={ds.h1}>Soporte</h1>
      <p style={{ color: colors.textMute, fontSize: type.sm, marginTop: 4, marginBottom: 22 }}>
        ¿Necesitas ayuda? Cuéntanos y te respondemos lo antes posible.
      </p>

      <div style={{ ...ds.card, padding: 22 }}>
        <div style={{ marginBottom: 14 }}>
          <label style={ds.label}>Motivo</label>
          <select value={motivo} onChange={e => setMotivo(e.target.value)}
            style={{
              ...ds.input, appearance: 'none', WebkitAppearance: 'none', cursor: 'pointer',
              paddingRight: 38,
              backgroundImage: `url("data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#6B6356" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>')}")`,
              backgroundRepeat: 'no-repeat', backgroundPosition: 'right 14px center',
            }}>
            {MOTIVOS.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>

        <div style={{ marginBottom: 16 }}>
          <label style={ds.label}>Mensaje</label>
          <textarea value={mensaje} onChange={e => setMensaje(e.target.value)} rows={6}
            placeholder="Cuéntanos qué ocurre…"
            style={{
              ...ds.input,
              height: 'auto', padding: '12px 14px',
              fontFamily: type.family, resize: 'vertical',
            }} />
        </div>

        {err && (
          <div style={{
            background: colors.dangerSoft, color: colors.danger,
            padding: '10px 12px', borderRadius: 10,
            marginBottom: 12, fontSize: type.xs, fontWeight: 600,
          }}>{err}</div>
        )}
        {ok && (
          <div style={{
            background: colors.sageSoft, color: colors.sage2,
            padding: '10px 12px', borderRadius: 10,
            marginBottom: 12, fontSize: type.xs, fontWeight: 600,
          }}>Enviado. Te responderemos por email.</div>
        )}

        <button onClick={enviar} disabled={sending || !mensaje.trim()}
          style={{ ...ds.glossyBtn, opacity: (sending || !mensaje.trim()) ? 0.55 : 1 }}>
          {sending ? 'Enviando…' : 'Enviar mensaje'}
        </button>

        <div style={{
          marginTop: 16, paddingTop: 14, borderTop: `1px solid ${colors.border}`,
          fontSize: type.xs, color: colors.textMute,
        }}>
          También puedes escribirnos a <strong style={{ color: colors.text }}>soporte@pidoo.es</strong>.
        </div>
      </div>
    </div>
  )
}
