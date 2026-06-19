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

function gotoSection(setSection, target) {
  if (setSection) setSection(target)
  else window.dispatchEvent(new CustomEvent('pidoo:goto', { detail: target }))
}

export default function Dashboard({ setSection, openRestaurante }) {
  const { socio } = useSocio()
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState({
    pedidosHoy: 0, pedidosSemana: 0, pedidosMes: 0,
    // null = sin fuente de datos disponible → se muestra "—"
    ingresosHoy: null, ingresosSemana: null, ingresosMes: null,
    porCobrar: null, pedidosPorCobrar: 0,
    restaurantesActivos: 0,
  })
  const [topRestaurantes, setTopRestaurantes] = useState([])
  const [subActiva, setSubActiva] = useState(null) // null=cargando, true/false una vez resuelto

  const fiscalCompleto = !!(socio?.razon_social && socio?.nif && socio?.direccion_fiscal && socio?.codigo_postal && socio?.ciudad)

  // Estado de la suscripción (para el banner de 7 días)
  useEffect(() => {
    if (!socio?.id) return
    let cancel = false
    ;(async () => {
      try {
        const { data } = await supabase
          .from('suscripciones_socio')
          .select('estado')
          .eq('socio_id', socio.id)
          .maybeSingle()
        if (!cancel) setSubActiva(['active', 'trialing'].includes(data?.estado))
      } catch (_) {
        if (!cancel) setSubActiva(false)
      }
    })()
    return () => { cancel = true }
  }, [socio?.id])

  useEffect(() => {
    if (!socio?.id) return
    ;(async () => {
      setLoading(true)
      try {
        const hoy = startOfDay()
        const semana = startOfWeek()
        const mes = startOfMonth()
        const fin = endOfToday()

        // Conteos de pedidos + restaurantes (fuentes que SÍ existen)
        const [ph, ps, pm, rest] = await Promise.all([
          supabase.from('pedidos').select('id', { count: 'exact', head: true })
            .eq('socio_id', socio.id).gte('created_at', hoy.toISOString()),
          supabase.from('pedidos').select('id', { count: 'exact', head: true })
            .eq('socio_id', socio.id).gte('created_at', semana.toISOString()),
          supabase.from('pedidos').select('id', { count: 'exact', head: true })
            .eq('socio_id', socio.id).gte('created_at', mes.toISOString()),
          supabase.from('socio_establecimiento').select('id', { count: 'exact', head: true })
            .eq('socio_id', socio.id).eq('estado', 'activa'),
        ])

        // Ingresos por rango + por cobrar. RPCs seguras: derivan el socio de
        // auth.uid() (no aceptan socio_id). Ingreso = envío+propina de los
        // pedidos delivery entregados del socio.
        const finIso = fin.toISOString()
        const [rih, ris, rim, rpcCobrar, rpr] = await Promise.all([
          supabase.rpc('get_ingresos_socio_rango', { p_desde: hoy.toISOString(), p_hasta: finIso }),
          supabase.rpc('get_ingresos_socio_rango', { p_desde: semana.toISOString(), p_hasta: finIso }),
          supabase.rpc('get_ingresos_socio_rango', { p_desde: mes.toISOString(), p_hasta: finIso }),
          supabase.rpc('get_por_cobrar_socio'),
          supabase.rpc('get_socio_por_cobrar_restaurantes'),
        ])
        const ingresosHoy = rih.error ? null : (rih.data ?? 0)
        const ingresosSemana = ris.error ? null : (ris.data ?? 0)
        const ingresosMes = rim.error ? null : (rim.data ?? 0)
        const pcRow = Array.isArray(rpcCobrar.data) ? rpcCobrar.data[0] : rpcCobrar.data
        const porCobrar = rpcCobrar.error ? null : (pcRow?.total ?? 0)
        const pedidosPorCobrar = pcRow?.pedidos ?? 0
        const pcRows = rpr.data || []

        setStats({
          pedidosHoy: ph.count || 0,
          pedidosSemana: ps.count || 0,
          pedidosMes: pm.count || 0,
          ingresosHoy,
          ingresosSemana,
          ingresosMes,
          porCobrar,
          pedidosPorCobrar,
          restaurantesActivos: rest.count || 0,
        })
        setTopRestaurantes(pcRows.slice(0, 5))
      } catch (e) { console.error(e) }
      setLoading(false)
    })()
  }, [socio])

  const fmtIngreso = (v) => (loading ? '…' : v == null ? '—' : euro(v))

  return (
    <div>
      <div style={{ marginBottom: 22 }}>
        <h1 style={ds.h1}>Resumen</h1>
        <p style={{ color: colors.textMute, fontSize: type.sm, marginTop: 4 }}>
          Tu actividad como socio repartidor.
        </p>
      </div>

      {/* Banner aviso 7 días — solo si NO hay suscripción activa/trial */}
      {subActiva === false && (
        <div style={{
          background: colors.warningSoft, color: colors.warning,
          border: `1px solid ${colors.warning}`,
          padding: '12px 14px', borderRadius: 10, marginBottom: 18,
          fontSize: type.sm, display: 'flex', alignItems: 'center',
          gap: 10, flexWrap: 'wrap', fontWeight: 600, lineHeight: 1.5,
        }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          <span style={{ flex: 1, minWidth: 200 }}>
            Tienes 7 días para añadir tu tarjeta y mantener tu marketplace activo. Si no, se pausará.
          </span>
          <button
            onClick={() => gotoSection(setSection, 'suscripcion')}
            style={{
              ...ds.glossyBtn, height: 34, fontSize: type.xs, whiteSpace: 'nowrap',
            }}>
            Añadir tarjeta
          </button>
        </div>
      )}

      {!fiscalCompleto && (
        <div style={{
          background: colors.dangerSoft, color: colors.danger,
          padding: '12px 14px', borderRadius: 10, marginBottom: 18,
          fontSize: type.sm, display: 'flex', alignItems: 'center',
          gap: 10, flexWrap: 'wrap',
        }}>
          <span>⚠️ Completa tus datos fiscales para poder emitir facturas a los restaurantes.</span>
          <button onClick={() => gotoSection(setSection, 'configuracion')}
             style={{ ...ds.dangerBtn, height: 32, fontSize: type.xs }}>
            Completar ahora
          </button>
        </div>
      )}

      {/* Stat cards principales */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))', gap: 12, marginBottom: 18 }}>
        <StatCard label="Hoy" value={fmtIngreso(stats.ingresosHoy)} sub={`${stats.pedidosHoy} pedido${stats.pedidosHoy !== 1 ? 's' : ''}`} />
        <StatCard label="Esta semana" value={fmtIngreso(stats.ingresosSemana)} sub={`${stats.pedidosSemana} pedido${stats.pedidosSemana !== 1 ? 's' : ''}`} tone="sage" />
        <StatCard label="Este mes" value={fmtIngreso(stats.ingresosMes)} sub={`${stats.pedidosMes} pedido${stats.pedidosMes !== 1 ? 's' : ''}`} />
        <StatCard label="Por cobrar" value={fmtIngreso(stats.porCobrar)} sub={`${stats.pedidosPorCobrar} sin facturar`} tone="terracotta" />
      </div>

      {/* Dos cards: restaurantes + próxima factura */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 14, marginBottom: 22 }}>
        <div style={{ ...ds.card, padding: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{
                fontSize: type.xxs, fontWeight: 700, color: colors.textMute,
                letterSpacing: '0.06em', textTransform: 'uppercase',
              }}>Restaurantes vinculados</div>
              <div style={{
                fontSize: 32, fontWeight: 800, color: colors.text, marginTop: 6,
                letterSpacing: '-0.6px', lineHeight: 1.1,
              }}>
                {loading ? '…' : stats.restaurantesActivos}
                <span style={{ fontSize: 16, fontWeight: 700, color: colors.textFaint, marginLeft: 6 }}>
                  / {socio?.limite_restaurantes ?? 5}
                </span>
              </div>
            </div>
            <div style={{
              width: 38, height: 38, borderRadius: 10,
              background: colors.terracottaSoft,
              display: 'grid', placeItems: 'center',
              color: colors.terracotta,
            }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 2v7a2 2 0 0 0 2 2h0a2 2 0 0 0 2-2V2"/><path d="M5 12v10"/><path d="M19 2v20"/><path d="M19 12h-5a3 3 0 0 1 3-3V2"/></svg>
            </div>
          </div>
          <button onClick={() => setSection?.('restaurantes')} style={{ ...ds.secondaryBtn, marginTop: 14, height: 34 }}>
            Ver restaurantes
          </button>
        </div>

        <div style={{ ...ds.card, padding: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{
                fontSize: type.xxs, fontWeight: 700, color: colors.textMute,
                letterSpacing: '0.06em', textTransform: 'uppercase',
              }}>Mi suscripción Pidoo</div>
              <div style={{
                fontSize: 26, fontWeight: 800, color: colors.text, marginTop: 6,
                letterSpacing: '-0.5px',
              }}>
                {subActiva === null ? '…' : subActiva ? 'Activa' : 'Sin plan'}
              </div>
              <div style={{ fontSize: type.xs, color: colors.textMute, marginTop: 4 }}>
                {subActiva === false
                  ? 'Añade tu tarjeta para activar tu marketplace'
                  : 'Tu plan de marketplace · 30 €/mes'}
              </div>
            </div>
            <div style={{
              width: 38, height: 38, borderRadius: 10,
              background: colors.sageSoft,
              display: 'grid', placeItems: 'center',
              color: colors.sage2,
            }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>
            </div>
          </div>
          <button onClick={() => gotoSection(setSection, 'suscripcion')} style={{ ...ds.secondaryBtn, marginTop: 14, height: 34 }}>
            Ver suscripción
          </button>
        </div>
      </div>

      {/* Top restaurantes por cobrar */}
      {topRestaurantes.length > 0 && (
        <>
          <div style={{
            fontSize: type.xxs, fontWeight: 700, color: colors.textMute,
            letterSpacing: '0.08em', textTransform: 'uppercase',
            marginBottom: 10,
          }}>Top restaurantes por cobrar</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {topRestaurantes.map(r => {
              const ini = (r.establecimiento_nombre || '?').split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase()
              return (
                <div
                  key={r.establecimiento_id}
                  onClick={() => openRestaurante?.(r.establecimiento_id)}
                  style={{
                    ...ds.card, padding: 14,
                    display: 'flex', alignItems: 'center', gap: 14,
                    cursor: openRestaurante ? 'pointer' : 'default',
                  }}
                >
                  {r.establecimiento_logo ? (
                    <div style={{
                      width: 42, height: 42, borderRadius: 10, flexShrink: 0,
                      background: `url(${r.establecimiento_logo}) center/cover`,
                      border: `1px solid ${colors.border}`,
                    }} />
                  ) : (
                    <div style={{
                      width: 42, height: 42, borderRadius: 10, flexShrink: 0,
                      background: colors.terracotta, color: '#fff',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontWeight: 800, fontSize: 13, letterSpacing: '-0.5px',
                    }}>{ini}</div>
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: type.sm, color: colors.text, fontWeight: 700,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {r.establecimiento_nombre}
                    </div>
                    <div style={{ fontSize: type.xs, color: colors.textMute, marginTop: 2 }}>
                      {r.pedidos_count} pedido{r.pedidos_count !== 1 ? 's' : ''} pendientes
                    </div>
                  </div>
                  <div style={{
                    fontSize: 17, fontWeight: 800, color: colors.terracotta,
                    fontVariantNumeric: 'tabular-nums',
                  }}>
                    {euro(r.total_neto)}
                  </div>
                  {openRestaurante && (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={colors.textFaint} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="9 18 15 12 9 6"/>
                    </svg>
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
