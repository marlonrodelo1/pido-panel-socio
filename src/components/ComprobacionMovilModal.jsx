// ComprobacionMovilModal — "Antes de ponerte En línea" (v307, 5-oct-2026).
// Lista lo que este móvil necesita para que los pedidos SUENEN y la app siga dando la
// ubicación minimizada (ver lib/comprobacionMovil.js). Cada fallo lleva su botón, que abre
// el ajuste exacto. Al volver de Ajustes se comprueba solo. "Ponerme En línea" solo se activa
// cuando todo está bien.
import { useEffect, useState } from 'react'
import { CheckCircle2, AlertCircle } from 'lucide-react'
import { colors, type } from '../lib/uiStyles'
import { confirmarAutostart } from '../lib/comprobacionMovil'

export default function ComprobacionMovilModal({ open, lista = [], comprobando, onRecheck, onContinue, onCancel, soloRevisar = false }) {
  const [abiertos, setAbiertos] = useState({}) // id → ya pulsó "arreglar" (para enseñar "Ya lo he activado")

  // Al volver de Ajustes (la app vuelve al frente) se comprueba otra vez.
  useEffect(() => {
    if (!open) return
    const alVolver = () => { if (document.visibilityState === 'visible') onRecheck?.() }
    document.addEventListener('visibilitychange', alVolver)
    return () => document.removeEventListener('visibilitychange', alVolver)
  }, [open, onRecheck])

  useEffect(() => { if (!open) setAbiertos({}) }, [open])

  if (!open) return null
  const fallos = lista.filter((c) => !c.ok)
  const todoBien = fallos.length === 0

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 4000, background: 'rgba(22,19,15,0.55)',
      backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
    }}>
      <div style={{
        width: '100%', maxWidth: 480, maxHeight: '92vh', overflowY: 'auto',
        background: colors.paper, color: colors.text, borderRadius: '20px 20px 0 0',
        padding: '22px 18px calc(18px + env(safe-area-inset-bottom, 0px))',
        boxShadow: '0 -12px 40px rgba(0,0,0,0.30)', fontFamily: type.family,
      }}>
        <h2 style={{ fontSize: 19, fontWeight: 800, margin: '0 0 6px', letterSpacing: '-0.01em' }}>
          {todoBien ? 'Tu móvil está listo' : 'Antes de ponerte En línea'}
        </h2>
        <p style={{ fontSize: 13, color: colors.textMute, lineHeight: 1.5, margin: '0 0 14px' }}>
          {todoBien
            ? 'Te sonarán los pedidos aunque tengas la app minimizada.'
            : 'Para que te suenen los pedidos con la app minimizada y no te desconecte el móvil, arregla esto. Te lleva directo al ajuste; al volver lo comprobamos solo.'}
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
          {lista.map((c) => (
            <div key={c.id} style={{
              borderRadius: 12, padding: '11px 12px',
              background: c.ok ? colors.sageSoft : colors.dangerSoft,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {c.ok
                  ? <CheckCircle2 size={18} color={colors.sage2} style={{ flexShrink: 0 }} />
                  : <AlertCircle size={18} color={colors.danger} style={{ flexShrink: 0 }} />}
                <span style={{ fontSize: 14, fontWeight: 700, color: c.ok ? colors.sage2 : colors.danger }}>{c.titulo}</span>
              </div>
              {!c.ok && (
                <>
                  <p style={{ fontSize: 12.5, color: colors.textDim, lineHeight: 1.45, margin: '6px 0 10px 26px' }}>{c.mal}</p>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginLeft: 26 }}>
                    <button
                      onClick={async () => { setAbiertos((a) => ({ ...a, [c.id]: true })); try { await c.arreglar?.() } catch (_) {} ; if (c.id === 'volumen') onRecheck?.() }}
                      style={{
                        padding: '8px 14px', borderRadius: 999, border: 'none', cursor: 'pointer',
                        background: colors.danger, color: colors.paper, fontSize: 13, fontWeight: 700, fontFamily: 'inherit',
                      }}>
                      {c.boton}
                    </button>
                    {c.confirmable && abiertos[c.id] && (
                      <button
                        onClick={() => { confirmarAutostart(); onRecheck?.() }}
                        style={{
                          padding: '8px 14px', borderRadius: 999, cursor: 'pointer',
                          border: `1px solid ${colors.border}`, background: colors.paper, color: colors.text,
                          fontSize: 13, fontWeight: 700, fontFamily: 'inherit',
                        }}>
                        Ya lo he activado
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          ))}
        </div>

        <button
          onClick={todoBien ? onContinue : onRecheck}
          disabled={comprobando}
          style={{
            width: '100%', padding: '14px 0', borderRadius: 12, border: 'none', cursor: 'pointer',
            background: todoBien ? colors.terracotta : colors.cream2,
            color: todoBien ? '#fff' : colors.text,
            fontSize: 15, fontWeight: 800, fontFamily: 'inherit', marginBottom: 8, opacity: comprobando ? 0.6 : 1,
          }}>
          {comprobando ? 'Comprobando…' : todoBien ? (soloRevisar ? 'Listo' : 'Ponerme En línea') : 'Comprobar otra vez'}
        </button>
        <button
          onClick={onCancel}
          style={{
            width: '100%', padding: '10px 0', borderRadius: 12, border: 'none', cursor: 'pointer',
            background: 'transparent', color: colors.textMute, fontSize: 14, fontWeight: 700, fontFamily: 'inherit',
          }}>
          {soloRevisar ? 'Cerrar' : 'Ahora no'}
        </button>
      </div>
    </div>
  )
}
