// RiderChat — Chat con soporte para el rider (tabla rider_support_messages).
import { useEffect, useRef, useState } from 'react'
import { Send } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useSocio } from '../../context/SocioContext'
import { colors } from '../../lib/uiStyles'

export default function RiderChat() {
  const { socio, user } = useSocio() || {}
  const [mensajes, setMensajes] = useState([])
  const [texto, setTexto] = useState('')
  const [enviando, setEnviando] = useState(false)
  const bottomRef = useRef(null)
  const lastSendRef = useRef(0)

  useEffect(() => {
    if (!socio?.id) return
    let cancel = false
    ;(async () => {
      const { data } = await supabase
        .from('rider_support_messages')
        .select('id, socio_id, autor, texto, created_at')
        .eq('socio_id', socio.id)
        .order('created_at', { ascending: true })
        .limit(200)
      if (!cancel) setMensajes(data || [])
    })()
    const ch = supabase
      .channel('rider-chat-' + socio.id)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'rider_support_messages',
        filter: `socio_id=eq.${socio.id}`,
      }, (payload) => {
        setMensajes((prev) => prev.find(m => m.id === payload.new.id) ? prev : [...prev, payload.new])
      })
      .subscribe()
    return () => { cancel = true; supabase.removeChannel(ch) }
  }, [socio?.id])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [mensajes.length])

  async function enviar(e) {
    e?.preventDefault()
    const t = texto.trim()
    if (!t || enviando || !socio?.id) return
    // throttle 2s
    if (Date.now() - lastSendRef.current < 2000) return
    lastSendRef.current = Date.now()
    setEnviando(true)
    const optimistic = { id: 'opt-' + Date.now(), socio_id: socio.id, autor: 'rider', texto: t, created_at: new Date().toISOString() }
    setMensajes(prev => [...prev, optimistic])
    setTexto('')
    const { error } = await supabase.from('rider_support_messages').insert({
      socio_id: socio.id, autor: 'rider', texto: t,
    })
    setEnviando(false)
    if (error) {
      setMensajes(prev => prev.filter(m => m.id !== optimistic.id))
      setTexto(t)
      alert('No se pudo enviar el mensaje. Inténtalo de nuevo.')
    }
  }

  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      height: 'calc(100vh - 64px - env(safe-area-inset-bottom, 0px) - 64px)',
      fontFamily: "'Plus Jakarta Sans', sans-serif",
    }}>
      <div style={{ padding: '14px 16px', borderBottom: `1px solid ${colors.border}` }}>
        <h1 style={{ fontSize: 18, fontWeight: 800, color: colors.ink, margin: 0 }}>Soporte</h1>
        <div style={{ fontSize: 12, color: colors.stone, marginTop: 2 }}>
          Escríbenos cualquier duda o incidencia.
        </div>
      </div>

      <div style={{
        flex: 1, overflowY: 'auto', padding: '12px 14px',
        display: 'flex', flexDirection: 'column', gap: 7,
      }}>
        {mensajes.length === 0 && (
          <div style={{ textAlign: 'center', color: colors.stone, fontSize: 12, padding: 30 }}>
            Aún no hay mensajes. Escribe el primero abajo.
          </div>
        )}
        {mensajes.map((m) => {
          const mio = m.autor === 'rider'
          return (
            <div key={m.id} style={{
              alignSelf: mio ? 'flex-end' : 'flex-start',
              maxWidth: '78%',
              padding: '8px 12px',
              borderRadius: 14,
              background: mio ? colors.terracotta : colors.cream2,
              color: mio ? '#fff' : colors.ink,
              fontSize: 13, lineHeight: 1.35,
              wordBreak: 'break-word',
            }}>
              {m.texto}
            </div>
          )
        })}
        <div ref={bottomRef} />
      </div>

      <form onSubmit={enviar} style={{
        padding: 12, borderTop: `1px solid ${colors.border}`,
        display: 'flex', gap: 8,
      }}>
        <input
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="Escribe un mensaje…"
          style={{
            flex: 1, padding: '10px 14px', borderRadius: 999,
            background: colors.cream2, border: 'none',
            fontSize: 14, color: colors.ink, fontFamily: 'inherit',
            outline: 'none',
          }}
        />
        <button
          type="submit"
          disabled={!texto.trim() || enviando}
          aria-label="Enviar"
          style={{
            width: 40, height: 40, borderRadius: '50%', border: 'none',
            background: colors.terracotta, color: '#fff',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', opacity: !texto.trim() || enviando ? 0.45 : 1,
          }}
        >
          <Send size={16} strokeWidth={2.4} />
        </button>
      </form>
    </div>
  )
}
