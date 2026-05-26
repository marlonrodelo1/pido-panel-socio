// RiderCompletadas — Histórico de entregas del rider (hoy, ayer, semana).
import { useEffect, useState } from 'react'
import { CheckCircle2, XCircle } from 'lucide-react'
import { useSocio } from '../../context/SocioContext'
import { supabase } from '../../lib/supabase'
import { colors } from '../../lib/uiStyles'

export default function RiderCompletadas() {
  const { socio } = useSocio() || {}
  const [pedidos, setPedidos] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!socio?.id) return
    let cancel = false
    ;(async () => {
      setLoading(true)
      const desde = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
      const { data } = await supabase
        .from('pedidos')
        .select('id, codigo, estado, total, modo_entrega, entregado_at, cancelado_at, created_at')
        .eq('socio_id', socio.id)
        .in('estado', ['entregado', 'cancelado', 'fallido'])
        .gte('created_at', desde)
        .order('created_at', { ascending: false })
        .limit(50)
      if (!cancel) {
        setPedidos(data || [])
        setLoading(false)
      }
    })()
    return () => { cancel = true }
  }, [socio?.id])

  // Agrupar por día (hoy, ayer, antes)
  const grupos = agruparPorDia(pedidos)

  return (
    <div style={{
      padding: '16px 16px calc(80px + env(safe-area-inset-bottom, 0px))',
      fontFamily: "'Plus Jakarta Sans', sans-serif",
    }}>
      <h1 style={{
        fontSize: 22, fontWeight: 800, color: colors.ink,
        margin: '4px 0 14px', letterSpacing: '-0.02em',
      }}>Completadas (7 días)</h1>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 30, color: colors.stone, fontSize: 13 }}>Cargando…</div>
      ) : pedidos.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 30, color: colors.stone, fontSize: 13 }}>
          Aún no hay entregas completadas.
        </div>
      ) : (
        grupos.map((g, gi) => (
          <div key={gi} style={{ marginBottom: 16 }}>
            <div style={{
              fontSize: 11, fontWeight: 700, color: colors.stone,
              textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8,
            }}>
              {g.label} ({g.items.length})
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {g.items.map(p => {
                const entregado = p.estado === 'entregado'
                return (
                  <div key={p.id} style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    padding: 12, borderRadius: 12,
                    background: colors.paper, border: `1px solid ${colors.border}`,
                  }}>
                    <div style={{ color: entregado ? colors.sage2 : colors.danger }}>
                      {entregado
                        ? <CheckCircle2 size={20} strokeWidth={2.2} />
                        : <XCircle size={20} strokeWidth={2.2} />}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontSize: 13, fontWeight: 800, color: colors.ink,
                        fontFamily: 'ui-monospace, monospace',
                      }}>{p.codigo}</div>
                      <div style={{ fontSize: 11, color: colors.stone, marginTop: 2 }}>
                        {entregado ? 'Entregado' : 'No entregado'} · {fmtHora(p.entregado_at || p.cancelado_at || p.created_at)}
                      </div>
                    </div>
                    <div style={{
                      fontSize: 13, fontWeight: 700, color: colors.ink,
                      fontFamily: 'ui-monospace, monospace',
                    }}>{Number(p.total || 0).toFixed(2)}€</div>
                  </div>
                )
              })}
            </div>
          </div>
        ))
      )}
    </div>
  )
}

function agruparPorDia(pedidos) {
  const hoy = new Date()
  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const tHoy = startOfDay(hoy)
  const tAyer = tHoy - 24 * 60 * 60 * 1000

  const grupos = { hoy: [], ayer: [], antes: [] }
  for (const p of pedidos) {
    const t = new Date(p.entregado_at || p.cancelado_at || p.created_at).getTime()
    if (t >= tHoy) grupos.hoy.push(p)
    else if (t >= tAyer) grupos.ayer.push(p)
    else grupos.antes.push(p)
  }

  return [
    { label: 'Hoy',   items: grupos.hoy },
    { label: 'Ayer',  items: grupos.ayer },
    { label: 'Antes', items: grupos.antes },
  ].filter(g => g.items.length > 0)
}

function fmtHora(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
}
