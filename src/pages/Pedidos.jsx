import { useEffect, useState } from 'react'
import { useSocio } from '../context/SocioContext'
import { supabase } from '../lib/supabase'
import { colors, ds, type, stateBadge } from '../lib/uiStyles'

export default function Pedidos() {
  const { socio } = useSocio()
  const [pedidos, setPedidos] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!socio?.id) return
    ;(async () => {
      setLoading(true)
      const { data } = await supabase
        .from('pedidos')
        .select('id, codigo, estado, metodo_pago, total, comision_generada, created_at, establecimiento:establecimientos(nombre)')
        .eq('socio_id', socio.id)
        .order('created_at', { ascending: false })
        .limit(100)
      setPedidos(data || [])
      setLoading(false)
    })()
  }, [socio])

  return (
    <div>
      <h1 style={ds.h1}>Pedidos</h1>
      <p style={{ color: colors.textMute, fontSize: type.sm, marginTop: 4, marginBottom: 18 }}>
        Todos los pedidos realizados a través de tu marketplace.
      </p>

      {loading ? (
        <div style={{ color: colors.textMute, padding: 20 }}>Cargando…</div>
      ) : pedidos.length === 0 ? (
        <div style={{ ...ds.card, textAlign: 'center', padding: 28 }}>
          <div style={{ fontSize: type.base, fontWeight: 600 }}>Todavía no tienes pedidos</div>
          <div style={{ fontSize: type.sm, color: colors.textMute, marginTop: 4 }}>
            Activa tu marketplace y vincula restaurantes para empezar a recibirlos.
          </div>
        </div>
      ) : (
        <div style={{ ...ds.card, padding: 0, overflow: 'hidden' }}>
          <div style={{
            display: 'grid', gridTemplateColumns: '100px 1fr 120px 90px 100px 100px 120px',
            padding: '10px 14px', gap: 8,
            fontSize: type.xxs, fontWeight: 700, color: colors.textMute,
            textTransform: 'uppercase', letterSpacing: '0.06em',
            borderBottom: `1px solid ${colors.border}`, background: colors.elev2,
          }}>
            <div>Código</div>
            <div>Restaurante</div>
            <div>Estado</div>
            <div>Pago</div>
            <div>Total</div>
            <div>Comisión</div>
            <div>Fecha</div>
          </div>
          {pedidos.map(p => {
            const b = stateBadge(p.estado)
            return (
              <div key={p.id} style={{
                display: 'grid', gridTemplateColumns: '100px 1fr 120px 90px 100px 100px 120px',
                padding: '10px 14px', gap: 8,
                fontSize: type.sm, color: colors.textDim,
                borderBottom: `1px solid ${colors.border}`,
                alignItems: 'center',
              }}>
                <div style={{ fontWeight: 600, color: colors.text }}>{p.codigo}</div>
                <div>{p.establecimiento?.nombre || '—'}</div>
                <div><span style={{ ...b }}>{b._label}</span></div>
                <div style={{ fontSize: type.xxs, textTransform: 'uppercase', color: colors.textMute }}>{p.metodo_pago || '—'}</div>
                <div>{Number(p.total || 0).toFixed(2)} €</div>
                <div style={{ color: colors.primary, fontWeight: 600 }}>{Number(p.comision_generada || 0).toFixed(2)} €</div>
                <div style={{ color: colors.textMute }}>{new Date(p.created_at).toLocaleDateString('es-ES')}</div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
