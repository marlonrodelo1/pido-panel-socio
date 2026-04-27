// Chat 1:1 rider <-> soporte. RLS deja al socio leer/escribir solo su hilo.

import { useEffect, useRef, useState } from 'react'
import { colors, type, ds } from '../../lib/uiStyles'
import { supabase } from '../../lib/supabase'
import { useSocio } from '../../context/SocioContext'

export default function RiderChat() {
  const { socio } = useSocio()
  const [msgs, setMsgs] = useState([])
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const scrollRef = useRef(null)

  useEffect(() => {
    if (!socio?.id) return
    let cancel = false
    ;(async () => {
      const { data } = await supabase
        .from('rider_support_messages')
        .select('id, remitente, mensaje, created_at, leido')
        .eq('socio_id', socio.id)
        .order('created_at', { ascending: true })
      if (!cancel) setMsgs(data || [])
    })()
    const ch = supabase.channel('rider-chat-' + socio.id)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'rider_support_messages', filter: `socio_id=eq.${socio.id}` },
        (payload) => setMsgs((prev) => [...prev, payload.new]))
      .subscribe()
    return () => { cancel = true; try { supabase.removeChannel(ch) } catch (_) {} }
  }, [socio?.id])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 99999 })
  }, [msgs.length])

  const send = async (e) => {
    e?.preventDefault?.()
    const t = text.trim()
    if (!t || !socio?.id || sending) return
    setSending(true)
    try {
      await supabase.from('rider_support_messages').insert({
        socio_id: socio.id, remitente: 'rider', mensaje: t,
      })
      setText('')
    } catch (err) {
      alert('Error al enviar: ' + (err?.message || ''))
    } finally {
      setSending(false)
    }
  }

  // Altura del BottomNavRider (~70px) que el form debe esquivar.
  // La lista de mensajes ocupa el resto del viewport y deja espacio para el form fijo abajo.
  const NAV_H = 70
  const FORM_H = 60 // altura aprox del form (input 38 + padding 10*2 + border 1)

  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      // Restamos: header rider (safe-area-top + 56) + bottom nav (70 + safe-area-bottom)
      minHeight: 'calc(100vh - 56px - env(safe-area-inset-top) - 70px - env(safe-area-inset-bottom))',
      paddingBottom: FORM_H + 4, // espacio para que los últimos mensajes no queden tapados por el form fixed
    }}>
      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: '14px 14px 8px' }}>
        {msgs.length === 0 && (
          <div style={{ textAlign: 'center', color: colors.textMute, fontSize: type.xs, marginTop: 40 }}>
            Sin mensajes aún. Escríbele a soporte cuando lo necesites.
          </div>
        )}
        {msgs.map((m) => {
          const mine = m.remitente === 'rider'
          return (
            <div key={m.id} style={{ display: 'flex', justifyContent: mine ? 'flex-end' : 'flex-start', marginBottom: 8 }}>
              <div style={{
                maxWidth: '80%', padding: '8px 12px', borderRadius: 14,
                background: mine ? colors.primary : colors.surface2,
                color: mine ? '#fff' : colors.text,
                border: mine ? 'none' : `1px solid ${colors.border}`,
                fontSize: type.sm, lineHeight: 1.35,
              }}>
                {m.mensaje}
                <div style={{ fontSize: 10, opacity: 0.65, marginTop: 4, textAlign: 'right' }}>
                  {new Date(m.created_at).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>
            </div>
          )
        })}
      </div>
      {/* Form fijo justo encima del BottomNavRider — esquiva safe-area inferior */}
      <form onSubmit={send} style={{
        position: 'fixed',
        left: 0, right: 0,
        bottom: `calc(${NAV_H}px + env(safe-area-inset-bottom))`,
        zIndex: 18, // por debajo del nav (z 20) y header (z 15) — visible siempre
        display: 'flex', gap: 8,
        padding: '10px 12px',
        borderTop: `1px solid ${colors.border}`,
        background: colors.surface,
      }}>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Escribe a soporte…" style={{ ...ds.input, flex: 1 }} />
        <button type="submit" disabled={sending || !text.trim()} style={{ ...ds.primaryBtn }}>
          Enviar
        </button>
      </form>
    </div>
  )
}
