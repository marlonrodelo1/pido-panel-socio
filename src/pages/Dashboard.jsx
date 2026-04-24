import { useEffect, useState } from 'react'
import { useSocio } from '../context/SocioContext'
import { supabase } from '../lib/supabase'
import { colors, ds, type } from '../lib/uiStyles'
import StatCard from '../components/StatCard'

function startOfDay() { const d = new Date(); d.setHours(0, 0, 0, 0); return d }
function startOfWeek() {
  const d = startOfDay(); const day = (d.getDay() + 6) % 7
  d.setDate(d.getDate() - day); return d
}
function startOfMonth() {
  const d = startOfDay(); d.setDate(1); return d
}
function endOfToday() {
  const d = startOfDay(); d.setDate(d.getDate() + 1); return d
}
function euro(v) { return `${Number(v || 0).toFixed(2)} €` }

export default function Dashboard({ setSection }) {
  const { socio } = useSocio()
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState({
    pedidosHoy: 0, pedidosSemana: 0, pedidosMes: 0,
    ingresosHoy: 0, ingresosSemana: 0, ingresosMes: 0,
    porCobrar: 0, pedidosPorCobrar: 0,
    restaurantesActivos: 0,
  })
  const [topRestaurantes, setTopRestaurantes] = useState([])

  const fiscalCompleto = !!(socio?.razon_social && socio?.nif && socio?.direccion_fiscal && socio?.codigo_postal && socio?.ciudad)

  useEffect(() => {
    if (!socio?.id) return
    ;(async () => {
      setLoading(true)
      try {
        const hoy = startOfDay()
        const semana = startOfWeek()
        const mes = startOfMonth()
        const fin = endOfToday()

        const [ph, ps, pm, rest, ingHoy, ingSem, ingMes, porCobrar] = await Promise.all([
          supabase.from('pedidos').select('id', { count: 'exact', head: true })
            .eq('socio_id', socio.id).gte('created_at', hoy.toISOString()),
          supabase.from('pedidos').select('id', { count: 'exact', head: true })
            .eq('socio_id', socio.id).gte('created_at', semana.toISOString()),
          supabase.from('pedidos').select('id', { count: 'exact', head: true })
            .eq('socio_id', socio.id).gte('created_at', mes.toISOString()),
          supabase.from('socio_establecimiento').select('id', { count: 'exact', head: true })
            .eq('socio_id', socio.id).eq('estado', 'activa'),
          supabase.rpc('get_ingresos_socio_rango', { p_desde: hoy.toISOString(), p_hasta: fin.toISOString() }),
          supabase.rpc('get_ingresos_socio_rango', { p_desde: semana.toISOString(), p_hasta: fin.toISOString() }),
          supabase.rpc('get_ingresos_socio_rango', { p_desde: mes.toISOString(), p_hasta: fin.toISOString() }),
          supabase.rpc('get_por_cobrar_socio'),
        ])

        const ingRow = (data) => (Array.isArray(data?.data) && data.data[0]) || data?.data || {}
        const ingHoyRow = ingRow(ingHoy)
        const ingSemRow = ingRow(ingSem)
        const ingMesRow = ingRow(ingMes)

        const pcRows = porCobrar?.data || []
        const totalPorCobrar = pcRows.reduce((s, r) => s + Number(r.total_neto || 0), 0)
        const pedidosPorCobrar = pcRows.reduce((s, r) => s + Number(r.pedidos_count || 0), 0)

        setStats({
          pedidosHoy: ph.count || 0,
          pedidosSemana: ps.count || 0,
          pedidosMes: pm.count || 0,
          ingresosHoy: Number(ingHoyRow.total_neto || 0),
          ingresosSemana: Number(ingSemRow.total_neto || 0),
          ingresosMes: Number(ingMesRow.total_neto || 0),
          porCobrar: totalPorCobrar,
          pedidosPorCobrar,
          restaurantesActivos: rest.count || 0,
        })
        setTopRestaurantes(pcRows.slice(0, 5))
      } catch (e) { console.error(e) }
      setLoading(false)
    })()
  }, [socio])

  const marketplaceUrl = `https://pidoo.es/s/${socio?.slug}`

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 22, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h1 style={ds.h1}>Resumen</h1>
          <p style={{ color: colors.textMute, fontSize: type.sm, marginTop: 4 }}>
            {socio?.marketplace_activo
              ? 'Tu marketplace está activo.'
              : 'Tu marketplace está desactivado. Actívalo cuando quieras recibir tráfico.'}
          </p>
        </div>
        <a href={marketplaceUrl} target="_blank" rel="noreferrer"
          style={{ ...ds.secondaryBtn, textDecoration: 'none' }}>
          Abrir mi marketplace ↗
        </a>
      </div>

      {!fiscalCompleto && (
        <div style={{ background: colors.dangerSoft, color: colors.danger, padding: '12px 14px', borderRadius: 10, marginBottom: 14, fontSize: type.sm, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span>⚠️ Completa tus datos fiscales para poder emitir facturas a los restaurantes.</span>
          <button onClick={() => setSection?.('configuracion')}
             style={{ ...ds.dangerBtn, height: 32, fontSize: type.xs }}>
            Completar ahora
          </button>
        </div>
      )}

      <h2 style={{ fontSize: type.xxs, fontWeight: 700, color: colors.textMute, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 10 }}>Ingresos</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 14, marginBottom: 20 }}>
        <StatCard label="Hoy" value={loading ? '…' : euro(stats.ingresosHoy)} sub={`${stats.pedidosHoy} pedido${stats.pedidosHoy !== 1 ? 's' : ''}`} />
        <StatCard label="Esta semana" value={loading ? '…' : euro(stats.ingresosSemana)} sub={`${stats.pedidosSemana} pedido${stats.pedidosSemana !== 1 ? 's' : ''}`} />
        <StatCard label="Este mes" value={loading ? '…' : euro(stats.ingresosMes)} sub={`${stats.pedidosMes} pedido${stats.pedidosMes !== 1 ? 's' : ''}`} />
        <StatCard label="Por cobrar" value={loading ? '…' : euro(stats.porCobrar)} sub={`${stats.pedidosPorCobrar} sin facturar`} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 14, marginBottom: 20 }}>
        <div style={ds.card}>
          <div style={{ fontSize: type.xxs, fontWeight: 700, color: colors.textMute, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 6 }}>Tu tienda</div>
          <div style={{ fontSize: type.sm, color: colors.textDim, marginBottom: 10, wordBreak: 'break-all' }}>{marketplaceUrl}</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button onClick={() => { navigator.clipboard?.writeText(marketplaceUrl) }} style={ds.secondaryBtn}>Copiar URL</button>
            <button onClick={() => setSection?.('marketplace')} style={ds.primaryBtn}>Gestionar</button>
          </div>
        </div>

        <div style={ds.card}>
          <div style={{ fontSize: type.xxs, fontWeight: 700, color: colors.textMute, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 6 }}>Restaurantes activos</div>
          <div style={{ fontSize: 28, fontWeight: 700, color: colors.text, marginBottom: 6 }}>
            {loading ? '…' : stats.restaurantesActivos}
            <span style={{ fontSize: type.sm, fontWeight: 500, color: colors.textMute, marginLeft: 6 }}>
              / {socio?.limite_restaurantes ?? 5}
            </span>
          </div>
          <button onClick={() => setSection?.('restaurantes')} style={ds.secondaryBtn}>Ver restaurantes</button>
        </div>

        <div style={ds.card}>
          <div style={{ fontSize: type.xxs, fontWeight: 700, color: colors.textMute, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 6 }}>Facturas</div>
          <div style={{ fontSize: type.sm, color: colors.textDim, marginBottom: 10 }}>
            Emite facturas por los pedidos que has repartido. El restaurante te paga fuera de Pidoo.
          </div>
          <button onClick={() => setSection?.('facturas')} style={ds.primaryBtn}>Ir a facturas</button>
        </div>
      </div>

      {/* Banner Servicios Rogotech (oportunidad extra para el socio) */}
      <div style={{
        background: `linear-gradient(135deg, ${colors.primary} 0%, #E85A1F 100%)`,
        borderRadius: 14, padding: '18px 20px', marginBottom: 20,
        color: '#fff', display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap',
        boxShadow: '0 8px 22px rgba(255,107,44,0.22)', cursor: 'pointer',
      }} onClick={() => setSection?.('servicios')}>
        <div style={{
          width: 46, height: 46, borderRadius: 12,
          background: 'rgba(255,255,255,0.18)', display: 'grid', placeItems: 'center', flexShrink: 0,
          fontSize: 24,
        }}>⚡</div>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontSize: type.base, fontWeight: 800, marginBottom: 2 }}>
            Gana comisión recomendando servicios digitales
          </div>
          <div style={{ fontSize: type.xs, opacity: 0.95, lineHeight: 1.5 }}>
            Automatizaciones, webs, apps y ERP de Rogotech. 15% por cada cliente que traigas.
          </div>
        </div>
        <button onClick={(e) => { e.stopPropagation(); setSection?.('servicios') }} style={{
          padding: '0 18px', height: 36, borderRadius: 9, border: 'none',
          background: '#fff', color: colors.primary, fontSize: type.xs, fontWeight: 800,
          cursor: 'pointer', fontFamily: 'inherit',
        }}>
          Ver servicios
        </button>
      </div>

      {topRestaurantes.length > 0 && (
        <div style={{ ...ds.card }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <div style={{ fontSize: type.xxs, fontWeight: 700, color: colors.textMute, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Top restaurantes por cobrar</div>
            <button onClick={() => setSection?.('facturas')} style={{ ...ds.secondaryBtn, height: 28, fontSize: type.xxs }}>Ver todo</button>
          </div>
          {topRestaurantes.map(r => (
            <div key={r.establecimiento_id} style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0',
              borderTop: `1px solid ${colors.border}`,
            }}>
              <div style={{
                width: 36, height: 36, borderRadius: 8, flexShrink: 0,
                background: r.establecimiento_logo ? `url(${r.establecimiento_logo}) center/cover` : colors.surface2,
                border: `1px solid ${colors.border}`,
              }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: type.sm, color: colors.text, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {r.establecimiento_nombre}
                </div>
                <div style={{ fontSize: type.xxs, color: colors.textMute }}>
                  {r.pedidos_count} pedido{r.pedidos_count !== 1 ? 's' : ''}
                </div>
              </div>
              <div style={{ fontSize: type.sm, fontWeight: 700, color: colors.text }}>
                {euro(r.total_neto)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
