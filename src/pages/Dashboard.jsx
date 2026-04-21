import { useEffect, useState } from 'react'
import { useSocio } from '../context/SocioContext'
import { supabase } from '../lib/supabase'
import { colors, ds, type } from '../lib/uiStyles'
import StatCard from '../components/StatCard'

function startOfDayISO() {
  const d = new Date(); d.setHours(0, 0, 0, 0); return d.toISOString()
}
function startOfWeekISO() {
  const d = new Date(); const day = (d.getDay() + 6) % 7
  d.setDate(d.getDate() - day); d.setHours(0, 0, 0, 0); return d.toISOString()
}

export default function Dashboard({ setSection }) {
  const { socio } = useSocio()
  const [stats, setStats] = useState({ hoy: 0, semana: 0, ganancias: 0, restaurantes: 0 })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!socio?.id) return
    ;(async () => {
      setLoading(true)
      try {
        const hoyISO = startOfDayISO()
        const semanaISO = startOfWeekISO()

        const [{ count: hoy }, { count: semana }, { count: rest }, bal] = await Promise.all([
          supabase.from('pedidos').select('id', { count: 'exact', head: true })
            .eq('socio_id', socio.id).gte('created_at', hoyISO),
          supabase.from('pedidos').select('id', { count: 'exact', head: true })
            .eq('socio_id', socio.id).gte('created_at', semanaISO),
          supabase.from('socio_establecimiento').select('id', { count: 'exact', head: true })
            .eq('socio_id', socio.id).eq('estado', 'activa'),
          supabase.from('balances_socio').select('pendiente').eq('socio_id', socio.id).maybeSingle(),
        ])

        setStats({
          hoy: hoy || 0,
          semana: semana || 0,
          restaurantes: rest || 0,
          ganancias: bal.data?.pendiente ?? 0,
        })
      } catch (e) { console.error(e) }
      setLoading(false)
    })()
  }, [socio])

  const marketplaceUrl = `https://pidoo.es/s/${socio?.slug}`

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 22 }}>
        <div>
          <h1 style={ds.h1}>Resumen</h1>
          <p style={{ color: colors.textMute, fontSize: type.sm, marginTop: 4 }}>
            {socio?.marketplace_activo ? 'Tu marketplace está activo.' : 'Tu marketplace está desactivado. Actívalo cuando quieras recibir tráfico.'}
          </p>
        </div>
        <a href={marketplaceUrl} target="_blank" rel="noreferrer"
          style={{ ...ds.secondaryBtn, textDecoration: 'none' }}>
          Abrir mi marketplace ↗
        </a>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 14, marginBottom: 24 }}>
        <StatCard label="Pedidos hoy" value={loading ? '…' : stats.hoy} />
        <StatCard label="Pedidos semana" value={loading ? '…' : stats.semana} />
        <StatCard label="Ganancias pendientes" value={loading ? '…' : `${Number(stats.ganancias).toFixed(2)} €`} sub="Se liquidan semanalmente" />
        <StatCard label="Restaurantes activos" value={loading ? '…' : stats.restaurantes} sub={`Límite: ${socio?.limite_restaurantes ?? 5}`} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 14 }}>
        <div style={ds.card}>
          <div style={{ fontSize: type.xxs, fontWeight: 700, color: colors.textMute, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 6 }}>Tu tienda</div>
          <div style={{ fontSize: type.sm, color: colors.textDim, marginBottom: 10 }}>{marketplaceUrl}</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => { navigator.clipboard?.writeText(marketplaceUrl) }} style={ds.secondaryBtn}>Copiar URL</button>
            <button onClick={() => setSection?.('marketplace')} style={ds.primaryBtn}>Gestionar</button>
          </div>
        </div>

        <div style={ds.card}>
          <div style={{ fontSize: type.xxs, fontWeight: 700, color: colors.textMute, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 6 }}>Tus restaurantes</div>
          <div style={{ fontSize: type.sm, color: colors.textDim, marginBottom: 10 }}>
            Vincula restaurantes para que aparezcan en tu marketplace.
          </div>
          <button onClick={() => setSection?.('restaurantes')} style={ds.primaryBtn}>Buscar restaurantes</button>
        </div>

        <div style={ds.card}>
          <div style={{ fontSize: type.xxs, fontWeight: 700, color: colors.textMute, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 6 }}>Cobros</div>
          <div style={{ fontSize: type.sm, color: colors.textDim, marginBottom: 10 }}>
            Liquidaciones cada lunes. Próxima factura en tu sección de Facturas.
          </div>
          <button onClick={() => setSection?.('facturas')} style={ds.secondaryBtn}>Ver facturas</button>
        </div>
      </div>
    </div>
  )
}
