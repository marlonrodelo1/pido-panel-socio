import { useEffect, useState } from 'react'
import { useSocio } from '../context/SocioContext'
import { supabase } from '../lib/supabase'
import { colors, ds, type } from '../lib/uiStyles'
import StatCard from '../components/StatCard'

export default function Facturas() {
  const { socio } = useSocio()
  const [balance, setBalance] = useState(null)
  const [facturas, setFacturas] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!socio?.id) return
    ;(async () => {
      setLoading(true)
      const [bal, fac] = await Promise.all([
        supabase.from('balances_socio').select('*').eq('socio_id', socio.id).maybeSingle(),
        supabase.from('rider_facturas_semanales').select('*')
          .eq('socio_id', socio.id).order('semana_inicio', { ascending: false }).limit(52),
      ])
      setBalance(bal.data || null)
      setFacturas(fac.data || [])
      setLoading(false)
    })()
  }, [socio])

  return (
    <div>
      <h1 style={ds.h1}>Facturas</h1>
      <p style={{ color: colors.textMute, fontSize: type.sm, marginTop: 4, marginBottom: 18 }}>
        Tus liquidaciones semanales se generan cada lunes.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 14, marginBottom: 20 }}>
        <StatCard label="Pendiente" value={loading ? '…' : `${Number(balance?.pendiente || 0).toFixed(2)} €`} sub="Liquidación próxima" />
        <StatCard label="Pagado total" value={loading ? '…' : `${Number(balance?.pagado_total || 0).toFixed(2)} €`} />
        <StatCard label="Pedidos esta semana" value={loading ? '…' : balance?.pedidos_semana || 0} />
      </div>

      <div style={{ ...ds.card, padding: 0, overflow: 'hidden' }}>
        <div style={{
          display: 'grid', gridTemplateColumns: '140px 1fr 120px 100px 120px',
          padding: '10px 14px', gap: 8,
          fontSize: type.xxs, fontWeight: 700, color: colors.textMute,
          textTransform: 'uppercase', letterSpacing: '0.06em',
          borderBottom: `1px solid ${colors.border}`, background: colors.elev2,
        }}>
          <div>Semana</div>
          <div>Concepto</div>
          <div>Pedidos</div>
          <div>Total</div>
          <div></div>
        </div>
        {facturas.length === 0 ? (
          <div style={{ padding: 20, color: colors.textMute, fontSize: type.sm, textAlign: 'center' }}>
            Aún no hay facturas.
          </div>
        ) : facturas.map(f => (
          <div key={f.id} style={{
            display: 'grid', gridTemplateColumns: '140px 1fr 120px 100px 120px',
            padding: '10px 14px', gap: 8,
            fontSize: type.sm, borderBottom: `1px solid ${colors.border}`,
            alignItems: 'center', color: colors.textDim,
          }}>
            <div style={{ fontWeight: 600, color: colors.text }}>
              {new Date(f.semana_inicio).toLocaleDateString('es-ES')}
            </div>
            <div>Liquidación semanal</div>
            <div>{f.total_pedidos || 0}</div>
            <div style={{ fontWeight: 600, color: colors.text }}>{Number(f.total || 0).toFixed(2)} €</div>
            <div>
              <button disabled style={{ ...ds.secondaryBtn, height: 30, fontSize: type.xs, opacity: 0.5, cursor: 'not-allowed' }}>
                PDF próximamente
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
