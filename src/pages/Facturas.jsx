import { useEffect, useMemo, useState } from 'react'
import { useSocio } from '../context/SocioContext'
import { supabase, FUNCTIONS_URL } from '../lib/supabase'
import { colors, ds, type } from '../lib/uiStyles'
import StatCard from '../components/StatCard'

function euro(v) { return `${Number(v || 0).toFixed(2)} €` }

export default function Facturas() {
  const { socio } = useSocio()
  const [tab, setTab] = useState('por_cobrar')
  const [porCobrar, setPorCobrar] = useState([])
  const [historico, setHistorico] = useState([])
  const [loading, setLoading] = useState(true)
  const [emitiendo, setEmitiendo] = useState(null)
  const [msg, setMsg] = useState(null)
  const [detalle, setDetalle] = useState(null)

  const fiscalCompleto = !!(socio?.razon_social && socio?.nif && socio?.direccion_fiscal && socio?.codigo_postal && socio?.ciudad)

  const load = async () => {
    if (!socio?.id) return
    setLoading(true)
    try {
      const [{ data: pc }, { data: hist }] = await Promise.all([
        supabase.rpc('get_por_cobrar_socio'),
        supabase.from('facturas_socio_restaurante')
          .select('id, numero, anio, periodo_inicio, periodo_fin, fecha_emision, total, base_imponible, iva_importe, estado, pdf_url, pedidos_count, establecimiento:establecimientos(id, nombre, logo_url)')
          .eq('socio_id', socio.id)
          .order('fecha_emision', { ascending: false })
          .limit(100),
      ])
      setPorCobrar(pc || [])
      setHistorico(hist || [])
    } catch (e) {
      console.error(e)
      setMsg({ tipo: 'error', txt: e.message || 'Error cargando datos' })
    }
    setLoading(false)
  }

  useEffect(() => { load() }, [socio?.id])

  const totalPorCobrar = useMemo(
    () => porCobrar.reduce((s, r) => s + Number(r.total_neto || 0), 0),
    [porCobrar]
  )
  const totalPedidosPendientes = useMemo(
    () => porCobrar.reduce((s, r) => s + Number(r.pedidos_count || 0), 0),
    [porCobrar]
  )
  const totalCobrado = useMemo(
    () => historico.filter(h => h.estado === 'pagada').reduce((s, r) => s + Number(r.total || 0), 0),
    [historico]
  )

  const emitirFactura = async (establecimiento_id) => {
    if (!fiscalCompleto) {
      setMsg({ tipo: 'error', txt: 'Completa primero tus datos fiscales en Configuración.' })
      return
    }
    setEmitiendo(establecimiento_id); setMsg(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const r = await fetch(`${FUNCTIONS_URL}/generar-factura-socio-restaurante`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({ establecimiento_id }),
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error || `Error ${r.status}`)
      setMsg({ tipo: 'ok', txt: `Factura ${data.numero} emitida correctamente.` })
      if (data.pdf_url) window.open(data.pdf_url, '_blank', 'noopener')
      await load()
    } catch (e) {
      setMsg({ tipo: 'error', txt: e.message })
    } finally {
      setEmitiendo(null)
    }
  }

  const verDetalle = async (row) => {
    try {
      const { data } = await supabase.rpc('get_detalle_por_cobrar_socio', { p_establecimiento_id: row.establecimiento_id })
      setDetalle({ row, items: data || [] })
    } catch (e) {
      setMsg({ tipo: 'error', txt: e.message })
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h1 style={ds.h1}>Facturas</h1>
          <p style={{ color: colors.textMute, fontSize: type.sm, marginTop: 4, marginBottom: 18 }}>
            Emite facturas a los restaurantes por los pedidos que has repartido. El restaurante las paga fuera de Pidoo.
          </p>
        </div>
      </div>

      {!fiscalCompleto && (
        <div style={{ background: colors.dangerSoft, color: colors.danger, padding: '12px 14px', borderRadius: 10, marginBottom: 14, fontSize: type.sm, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span>⚠️ Tus datos fiscales están incompletos. No podrás emitir facturas hasta completarlos.</span>
          <a href="#configuracion" onClick={e => { e.preventDefault(); window.dispatchEvent(new CustomEvent('pidoo:goto', { detail: 'configuracion' })) }}
             style={{ ...ds.dangerBtn, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', height: 32, fontSize: type.xs }}>
            Ir a Configuración
          </a>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 14, marginBottom: 18 }}>
        <StatCard label="Por cobrar" value={loading ? '…' : euro(totalPorCobrar)} sub={`${totalPedidosPendientes} pedidos sin facturar`} />
        <StatCard label="Restaurantes con deuda" value={loading ? '…' : porCobrar.length} />
        <StatCard label="Facturas emitidas" value={loading ? '…' : historico.length} />
        <StatCard label="Cobrado (histórico)" value={loading ? '…' : euro(totalCobrado)} />
      </div>

      <div style={{ display: 'flex', background: colors.surface2, borderRadius: 8, padding: 3, marginBottom: 16, maxWidth: 420, gap: 3 }}>
        {[
          { id: 'por_cobrar', l: `Por cobrar (${porCobrar.length})` },
          { id: 'historico', l: `Histórico (${historico.length})` },
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            flex: 1, padding: '9px 0', borderRadius: 6, border: 'none',
            background: tab === t.id ? colors.surface : 'transparent',
            color: tab === t.id ? colors.text : colors.textMute,
            fontSize: type.xs, fontWeight: 700, cursor: 'pointer',
            boxShadow: tab === t.id ? colors.shadow : 'none',
          }}>{t.l}</button>
        ))}
      </div>

      {msg && (
        <div style={{
          background: msg.tipo === 'ok' ? colors.stateOkSoft : colors.dangerSoft,
          color: msg.tipo === 'ok' ? colors.stateOk : colors.danger,
          padding: '10px 12px', borderRadius: 8, marginBottom: 14, fontSize: type.xs,
        }}>{msg.txt}</div>
      )}

      {loading ? (
        <div style={{ color: colors.textMute, fontSize: type.sm, padding: 20 }}>Cargando…</div>
      ) : tab === 'por_cobrar' ? (
        porCobrar.length === 0 ? (
          <div style={{ ...ds.card, textAlign: 'center', padding: 28 }}>
            <div style={{ fontSize: type.base, fontWeight: 600, marginBottom: 6 }}>No tienes pedidos por facturar</div>
            <div style={{ fontSize: type.sm, color: colors.textMute }}>
              Cuando repartas pedidos, aparecerán aquí agrupados por restaurante.
            </div>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(320px,1fr))', gap: 14 }}>
            {porCobrar.map(row => (
              <div key={row.establecimiento_id} style={ds.card}>
                <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 12 }}>
                  <div style={{
                    width: 48, height: 48, borderRadius: 10, flexShrink: 0,
                    background: row.establecimiento_logo ? `url(${row.establecimiento_logo}) center/cover` : colors.surface2,
                    border: `1px solid ${colors.border}`,
                  }} />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: type.base, fontWeight: 600, color: colors.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {row.establecimiento_nombre}
                    </div>
                    <div style={{ fontSize: type.xs, color: colors.textMute }}>
                      {row.pedidos_count} pedido{row.pedidos_count !== 1 ? 's' : ''} sin facturar
                    </div>
                  </div>
                </div>

                <div style={{ fontSize: 26, fontWeight: 700, color: colors.text, marginBottom: 6 }}>
                  {euro(row.total_neto)}
                </div>
                <div style={{ fontSize: type.xxs, color: colors.textMute, marginBottom: 12, lineHeight: 1.6 }}>
                  Envíos {euro(row.total_envio)} · Comisiones {euro(row.total_comision_rider)} · Propinas {euro(row.total_propina)}
                </div>

                {!row.establecimiento_nif && (
                  <div style={{ fontSize: type.xxs, color: colors.danger, marginBottom: 8 }}>
                    ⚠️ Este restaurante no tiene CIF registrado. Pídeselo antes de facturar.
                  </div>
                )}

                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => verDetalle(row)} style={{ ...ds.secondaryBtn, flex: 1, height: 36, fontSize: type.xs }}>
                    Ver detalle
                  </button>
                  <button
                    onClick={() => emitirFactura(row.establecimiento_id)}
                    disabled={!fiscalCompleto || emitiendo === row.establecimiento_id || !row.establecimiento_nif}
                    style={{ ...ds.primaryBtn, flex: 1, height: 36, fontSize: type.xs, opacity: (!fiscalCompleto || emitiendo === row.establecimiento_id || !row.establecimiento_nif) ? 0.5 : 1 }}
                  >
                    {emitiendo === row.establecimiento_id ? 'Emitiendo…' : 'Emitir factura'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )
      ) : (
        historico.length === 0 ? (
          <div style={{ ...ds.card, textAlign: 'center', padding: 28 }}>
            <div style={{ fontSize: type.base, fontWeight: 600 }}>Aún no has emitido facturas</div>
          </div>
        ) : (
          <div style={{ ...ds.card, padding: 0, overflow: 'hidden' }}>
            <div style={{
              display: 'grid', gridTemplateColumns: '120px 1fr 1.2fr 120px 100px 110px',
              padding: '10px 14px', gap: 8,
              fontSize: type.xxs, fontWeight: 700, color: colors.textMute,
              textTransform: 'uppercase', letterSpacing: '0.06em',
              borderBottom: `1px solid ${colors.border}`, background: colors.elev2,
            }}>
              <div>Número</div>
              <div>Fecha</div>
              <div>Restaurante</div>
              <div>Pedidos</div>
              <div>Total</div>
              <div></div>
            </div>
            {historico.map(f => (
              <div key={f.id} style={{
                display: 'grid', gridTemplateColumns: '120px 1fr 1.2fr 120px 100px 110px',
                padding: '10px 14px', gap: 8,
                fontSize: type.sm, borderBottom: `1px solid ${colors.border}`,
                alignItems: 'center', color: colors.textDim,
              }}>
                <div style={{ fontWeight: 600, color: colors.text }}>{f.numero}</div>
                <div>{f.fecha_emision ? new Date(f.fecha_emision).toLocaleDateString('es-ES') : '—'}</div>
                <div style={{ color: colors.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {f.establecimiento?.nombre || '—'}
                </div>
                <div>{f.pedidos_count}</div>
                <div style={{ fontWeight: 600, color: colors.text }}>{euro(f.total)}</div>
                <div>
                  {f.pdf_url ? (
                    <a href={f.pdf_url} target="_blank" rel="noreferrer"
                       style={{ ...ds.secondaryBtn, height: 30, fontSize: type.xs, textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}>
                      Ver PDF
                    </a>
                  ) : (
                    <span style={{ fontSize: type.xxs, color: colors.textMute }}>Sin PDF</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )
      )}

      {detalle && (
        <div onClick={() => setDetalle(null)} style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 100,
          display: 'flex', alignItems: 'flex-end', justifyContent: 'center', padding: 20,
        }}>
          <div onClick={e => e.stopPropagation()} style={{
            background: colors.surface, borderRadius: 16, padding: 20, maxWidth: 640, width: '100%',
            maxHeight: '85vh', overflow: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h2 style={{ ...ds.h2, margin: 0 }}>{detalle.row.establecimiento_nombre}</h2>
              <button onClick={() => setDetalle(null)} style={ds.secondaryBtn}>Cerrar</button>
            </div>
            <p style={{ fontSize: type.sm, color: colors.textMute, margin: '0 0 14px' }}>
              {detalle.items.length} pedido{detalle.items.length !== 1 ? 's' : ''} pendiente{detalle.items.length !== 1 ? 's' : ''} de facturar
            </p>
            <div style={{ ...ds.card, padding: 0, overflow: 'hidden' }}>
              <div style={{
                display: 'grid', gridTemplateColumns: '110px 1fr 80px 80px 80px 90px',
                padding: '10px 14px', gap: 6,
                fontSize: type.xxs, fontWeight: 700, color: colors.textMute,
                textTransform: 'uppercase', letterSpacing: '0.06em',
                borderBottom: `1px solid ${colors.border}`, background: colors.elev2,
              }}>
                <div>Código</div>
                <div>Fecha</div>
                <div>Envío</div>
                <div>Com.</div>
                <div>Propina</div>
                <div>Total</div>
              </div>
              {detalle.items.map(it => (
                <div key={it.rider_earning_id} style={{
                  display: 'grid', gridTemplateColumns: '110px 1fr 80px 80px 80px 90px',
                  padding: '8px 14px', gap: 6,
                  fontSize: type.xs, borderBottom: `1px solid ${colors.border}`,
                  color: colors.textDim,
                }}>
                  <div style={{ color: colors.text, fontWeight: 600 }}>{it.pedido_codigo}</div>
                  <div>{it.pedido_fecha ? new Date(it.pedido_fecha).toLocaleDateString('es-ES') : '—'}</div>
                  <div>{euro(it.coste_envio)}</div>
                  <div>{euro(it.comision_rider)}</div>
                  <div>{euro(it.propina)}</div>
                  <div style={{ color: colors.text, fontWeight: 600 }}>{euro(it.neto_rider)}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
