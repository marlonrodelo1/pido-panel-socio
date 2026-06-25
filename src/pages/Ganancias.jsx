import { useEffect, useState } from 'react'
import { useSocio } from '../context/SocioContext'
import { supabase } from '../lib/supabase'
import { colors, ds, type } from '../lib/uiStyles'
import StatCard from '../components/StatCard'

// Helpers de fecha — mismos que Dashboard.jsx
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

const EMPTY_RANGO = { pedidos_count: 0, total_envio: 0, total_comision: 0, total_propina: 0, total: 0 }

export default function Ganancias() {
  const { socio } = useSocio()
  const [loading, setLoading] = useState(true)
  // null = la RPC falló / sin fuente → se muestra "—"
  const [hoy, setHoy] = useState(null)
  const [semana, setSemana] = useState(null)
  const [mes, setMes] = useState(null)
  const [porCobrar, setPorCobrar] = useState({ total: null, pedidos: 0 })
  const [porRestaurante, setPorRestaurante] = useState([])

  useEffect(() => {
    if (!socio?.id) return
    let cancel = false
    ;(async () => {
      setLoading(true)
      try {
        const finIso = endOfToday().toISOString()
        const rango = (desde) =>
          supabase.rpc('get_ganancias_socio_rango', { p_desde: desde.toISOString(), p_hasta: finIso })

        // Las RPC derivan el socio de auth.uid() — no se pasa socio_id.
        const [rHoy, rSem, rMes, rCobrar, rPorRest] = await Promise.all([
          rango(startOfDay()),
          rango(startOfWeek()),
          rango(startOfMonth()),
          supabase.rpc('get_por_cobrar_socio'),
          supabase.rpc('get_socio_por_cobrar_restaurantes'),
        ])

        if (cancel) return

        const pick = (r) => {
          if (r.error) return null
          const row = Array.isArray(r.data) ? r.data[0] : r.data
          return row || EMPTY_RANGO
        }
        setHoy(pick(rHoy))
        setSemana(pick(rSem))
        setMes(pick(rMes))

        const pcRow = Array.isArray(rCobrar.data) ? rCobrar.data[0] : rCobrar.data
        setPorCobrar({
          total: rCobrar.error ? null : (pcRow?.total ?? 0),
          pedidos: pcRow?.pedidos ?? 0,
        })
        setPorRestaurante(rPorRest.data || [])
      } catch (e) {
        console.error(e)
        if (!cancel) { setHoy(null); setSemana(null); setMes(null) }
      }
      if (!cancel) setLoading(false)
    })()
    return () => { cancel = true }
  }, [socio?.id])

  return (
    <div>
      <div style={{ marginBottom: 22 }}>
        <h1 style={ds.h1}>Ganancias</h1>
        <p style={{ color: colors.textMute, fontSize: type.sm, marginTop: 4 }}>
          Lo que has ganado repartiendo: envíos, comisión y propinas.
        </p>
      </div>

      {/* Resumen rápido por periodo */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))',
        gap: 12, marginBottom: 22,
      }}>
        <StatCard
          label="Hoy"
          value={loading ? '…' : hoy == null ? '—' : euro(hoy.total)}
          sub={hoy == null ? 'sin datos' : `${hoy.pedidos_count} pedido${hoy.pedidos_count !== 1 ? 's' : ''}`}
        />
        <StatCard
          label="Esta semana"
          value={loading ? '…' : semana == null ? '—' : euro(semana.total)}
          sub={semana == null ? 'sin datos' : `${semana.pedidos_count} pedido${semana.pedidos_count !== 1 ? 's' : ''}`}
          tone="sage"
        />
        <StatCard
          label="Este mes"
          value={loading ? '…' : mes == null ? '—' : euro(mes.total)}
          sub={mes == null ? 'sin datos' : `${mes.pedidos_count} pedido${mes.pedidos_count !== 1 ? 's' : ''}`}
          tone="terracotta"
        />
      </div>

      {/* Desglose detallado por periodo */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))',
        gap: 14, marginBottom: 24,
      }}>
        <DesglosePeriodo titulo="Hoy" loading={loading} data={hoy} />
        <DesglosePeriodo titulo="Esta semana" loading={loading} data={semana} tone="sage" />
        <DesglosePeriodo titulo="Este mes" loading={loading} data={mes} tone="terracotta" />
      </div>

      {/* Por cobrar a los restaurantes */}
      <div style={{
        fontSize: type.xxs, fontWeight: 700, color: colors.textMute,
        letterSpacing: '0.08em', textTransform: 'uppercase',
        marginBottom: 10,
      }}>
        Por cobrar a los restaurantes
      </div>

      <div style={{
        ...ds.card, padding: 18, marginBottom: 14,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14,
      }}>
        <div>
          <div style={{ fontSize: type.sm, color: colors.textMute, fontWeight: 600 }}>
            Total pendiente de cobro
          </div>
          <div style={{ fontSize: type.xs, color: colors.textFaint, marginTop: 2 }}>
            {porCobrar.pedidos} pedido{porCobrar.pedidos !== 1 ? 's' : ''} sin facturar
          </div>
        </div>
        <div style={{
          fontSize: 28, fontWeight: 800, color: colors.terracotta,
          letterSpacing: '-0.6px', fontVariantNumeric: 'tabular-nums', lineHeight: 1.1,
        }}>
          {loading ? '…' : porCobrar.total == null ? '—' : euro(porCobrar.total)}
        </div>
      </div>

      <div style={{ fontSize: type.xs, color: colors.textFaint, marginBottom: 14, marginTop: -4, lineHeight: 1.5 }}>
        Es lo que facturas a cada restaurante por tus repartos: envío + comisión + propina (sin IVA).
        En pedidos en efectivo recuerda que ya cobraste el total al cliente y debes entregarle al restaurante su parte.
      </div>

      {loading ? (
        <div style={{ color: colors.textMute, padding: 20 }}>Cargando…</div>
      ) : porRestaurante.length === 0 ? (
        <div style={{ ...ds.card, textAlign: 'center', padding: 30 }}>
          <div style={{ fontSize: type.base, fontWeight: 700 }}>No tienes nada por cobrar</div>
          <div style={{ fontSize: type.sm, color: colors.textMute, marginTop: 4 }}>
            Cuando entregues pedidos, aquí verás lo que facturas a cada restaurante por tus repartos.
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {porRestaurante.map((r) => {
            const ini = (r.establecimiento_nombre || '?').split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase()
            return (
              <div
                key={r.establecimiento_id}
                style={{
                  ...ds.card, padding: 14,
                  display: 'flex', alignItems: 'center', gap: 14,
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
                    {r.pedidos_count} pedido{r.pedidos_count !== 1 ? 's' : ''} pendiente{r.pedidos_count !== 1 ? 's' : ''}
                  </div>
                </div>
                <div style={{
                  fontSize: 17, fontWeight: 800, color: colors.terracotta,
                  fontVariantNumeric: 'tabular-nums',
                }}>
                  {euro(r.total_neto)}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

/**
 * Card con el desglose de un periodo: total grande + envíos / comisión / propinas.
 */
function DesglosePeriodo({ titulo, loading, data, tone }) {
  const totalColor = tone === 'sage' ? colors.sage2
    : tone === 'terracotta' ? colors.terracotta
    : colors.text
  return (
    <div style={{ ...ds.card, padding: 18 }}>
      <div style={{
        fontSize: type.xxs, fontWeight: 700, color: colors.textMute,
        letterSpacing: '0.06em', textTransform: 'uppercase',
      }}>{titulo}</div>
      <div style={{
        fontSize: 30, fontWeight: 800, color: totalColor, marginTop: 6,
        letterSpacing: '-0.6px', lineHeight: 1.1,
        fontVariantNumeric: 'tabular-nums',
      }}>
        {loading ? '…' : data == null ? '—' : euro(data.total)}
      </div>
      <div style={{ fontSize: type.xs, color: colors.textFaint, marginTop: 4 }}>
        {loading ? '' : data == null ? 'sin datos' : `${data.pedidos_count} pedido${data.pedidos_count !== 1 ? 's' : ''}`}
      </div>

      <div style={{ height: 1, background: colors.border, margin: '14px 0 10px' }} />

      <DesgloseRow k="Envíos" v={loading || data == null ? '—' : euro(data.total_envio)} />
      <DesgloseRow k="Comisión" v={loading || data == null ? '—' : euro(data.total_comision)} />
      <DesgloseRow k="Propinas" v={loading || data == null ? '—' : euro(data.total_propina)} />
    </div>
  )
}

function DesgloseRow({ k, v }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
      gap: 10, padding: '4px 0', fontSize: type.sm,
    }}>
      <span style={{ color: colors.textMute }}>{k}</span>
      <span style={{
        color: colors.text, fontWeight: 600,
        fontVariantNumeric: 'tabular-nums',
      }}>{v}</span>
    </div>
  )
}
