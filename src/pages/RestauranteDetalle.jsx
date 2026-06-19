import { useEffect, useMemo, useState } from 'react'
import { useSocio } from '../context/SocioContext'
import { supabase, FUNCTIONS_URL } from '../lib/supabase'
import { colors, ds, type, stateBadge } from '../lib/uiStyles'
import StatCard from '../components/StatCard'

function euro(v) { return `${Number(v || 0).toFixed(2)} €` }

export default function RestauranteDetalle({ establecimiento_id, onBack }) {
  const { socio } = useSocio()
  const [loading, setLoading] = useState(true)
  const [establecimiento, setEstablecimiento] = useState(null)
  const [vinculacion, setVinculacion] = useState(null)
  const [pedidos7d, setPedidos7d] = useState([])
  const [resumenCobro, setResumenCobro] = useState(null)
  const [detalleEarnings, setDetalleEarnings] = useState([])
  const [historicoFacturas, setHistoricoFacturas] = useState([])
  const [emitiendo, setEmitiendo] = useState(false)
  const [msg, setMsg] = useState(null)
  const [togglingDestacado, setTogglingDestacado] = useState(false)

  const fiscalCompletoSocio = !!(socio?.razon_social && socio?.nif && socio?.direccion_fiscal && socio?.codigo_postal && socio?.ciudad)

  useEffect(() => {
    if (!establecimiento_id || !socio?.id) return
    let cancel = false
    ;(async () => {
      setLoading(true)
      try {
        const desde7 = new Date()
        desde7.setDate(desde7.getDate() - 7)

        // get_por_cobrar_socio ya NO existe en la DB (404) → se quita la llamada.
        // TODO: recalcular "por cobrar" cuando exista la fuente de datos.
        const [estRes, vincRes, pedRes, detRes, factRes] = await Promise.all([
          supabase.from('establecimientos')
            .select('id, nombre, logo_url, telefono, email, direccion, razon_social, nif, direccion_fiscal, codigo_postal, ciudad_fiscal, provincia_fiscal, slug, tipo')
            .eq('id', establecimiento_id).maybeSingle(),
          supabase.from('socio_establecimiento')
            .select('id, estado, solicitado_at, aceptado_at, exclusivo, destacado, orden_destacado')
            .eq('socio_id', socio.id).eq('establecimiento_id', establecimiento_id).maybeSingle(),
          supabase.from('pedidos')
            .select('id, codigo, estado, total, created_at, metodo_pago')
            .eq('socio_id', socio.id).eq('establecimiento_id', establecimiento_id)
            .gte('created_at', desde7.toISOString())
            .order('created_at', { ascending: false }).limit(50),
          supabase.rpc('get_detalle_por_cobrar_socio', { p_establecimiento_id: establecimiento_id }),
          supabase.from('facturas_socio_restaurante')
            .select('id, numero, fecha_emision, total, estado, pdf_url, pedidos_count, periodo_inicio, periodo_fin')
            .eq('socio_id', socio.id).eq('establecimiento_id', establecimiento_id)
            .order('fecha_emision', { ascending: false }).limit(20),
        ])

        if (cancel) return
        setEstablecimiento(estRes.data || null)
        setVinculacion(vincRes.data || null)
        setPedidos7d(pedRes.data || [])
        setResumenCobro(Array.isArray(detRes.data) ? (detRes.data[0] || null) : (detRes.data || null))
        setDetalleEarnings([])
        setHistoricoFacturas(factRes.data || [])
      } catch (e) {
        console.error(e)
      }
      if (!cancel) setLoading(false)
    })()
    return () => { cancel = true }
  }, [establecimiento_id, socio?.id])

  const totalCobrado = useMemo(
    () => historicoFacturas.filter(f => f.estado === 'pagada').reduce((s, r) => s + Number(r.total || 0), 0),
    [historicoFacturas]
  )
  const totalPorCobrar = Number(resumenCobro?.total_neto || 0)
  const pedidosPendientesFactura = Number(resumenCobro?.pedidos_count || 0)

  const fiscalRestauranteOk = !!(establecimiento?.razon_social && establecimiento?.nif)
  const puedeFacturar = fiscalCompletoSocio && fiscalRestauranteOk && pedidosPendientesFactura > 0

  const toggleDestacado = async () => {
    if (!vinculacion?.id || togglingDestacado) return
    const nuevo = !vinculacion.destacado
    setTogglingDestacado(true)
    setMsg(null)
    try {
      const { error } = await supabase
        .from('socio_establecimiento')
        .update({ destacado: nuevo })
        .eq('id', vinculacion.id)
      if (error) throw error
      setVinculacion(v => v ? ({ ...v, destacado: nuevo }) : v)
      setMsg({ tipo: 'ok', txt: nuevo ? 'Restaurante destacado.' : 'Quitado de los destacados.' })
    } catch (e) {
      setMsg({ tipo: 'error', txt: 'No se pudo actualizar: ' + e.message })
    } finally {
      setTogglingDestacado(false)
    }
  }

  const emitirFactura = async () => {
    setEmitiendo(true); setMsg(null)
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
      window.setTimeout(() => window.dispatchEvent(new CustomEvent('pidoo:refresh-rest-detalle')), 200)
    } catch (e) {
      setMsg({ tipo: 'error', txt: e.message })
    } finally {
      setEmitiendo(false)
    }
  }

  useEffect(() => {
    const handler = () => {
      ;(async () => {
        if (!establecimiento_id || !socio?.id) return
        try {
          // get_por_cobrar_socio eliminada (404) → no se vuelve a llamar.
          const [factRes, detRes] = await Promise.all([
            supabase.from('facturas_socio_restaurante')
              .select('id, numero, fecha_emision, total, estado, pdf_url, pedidos_count, periodo_inicio, periodo_fin')
              .eq('socio_id', socio.id).eq('establecimiento_id', establecimiento_id)
              .order('fecha_emision', { ascending: false }).limit(20),
            supabase.rpc('get_detalle_por_cobrar_socio', { p_establecimiento_id: establecimiento_id }),
          ])
          setResumenCobro(null)
          setHistoricoFacturas(factRes.data || [])
          setDetalleEarnings(detRes.data || [])
        } catch (e) { console.error(e) }
      })()
    }
    window.addEventListener('pidoo:refresh-rest-detalle', handler)
    return () => window.removeEventListener('pidoo:refresh-rest-detalle', handler)
  }, [establecimiento_id, socio?.id])

  if (loading) {
    return <div style={{ color: colors.textMute, padding: 20, fontSize: type.sm }}>Cargando…</div>
  }
  if (!establecimiento) {
    return (
      <div>
        <BackBtn onBack={onBack} />
        <div style={{ ...ds.card, textAlign: 'center', padding: 28 }}>
          <div style={{ fontSize: type.base, fontWeight: 700 }}>Restaurante no encontrado</div>
        </div>
      </div>
    )
  }

  const badge = stateBadge(vinculacion?.estado)
  const nombre = establecimiento.nombre || '—'
  const tipo = establecimiento.tipo || 'Restaurante'

  return (
    <div>
      <BackBtn onBack={onBack} />

      {/* Header card */}
      <div style={{ ...ds.card, padding: 22, marginBottom: 18 }}>
        <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
          {establecimiento.logo_url ? (
            <div style={{
              width: 72, height: 72, borderRadius: 14, flexShrink: 0,
              background: `url(${establecimiento.logo_url}) center/cover`,
              border: `1.5px solid ${colors.terracotta}`,
            }} />
          ) : (
            <div style={{
              width: 72, height: 72, borderRadius: 14, flexShrink: 0,
              background: colors.terracottaSoft, color: colors.terracotta,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontWeight: 800, fontSize: 22, border: `1.5px solid ${colors.terracotta}`,
            }}>{nombre.slice(0, 1).toUpperCase()}</div>
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontSize: 22, fontWeight: 800, color: colors.text,
              letterSpacing: '-0.4px',
            }}>{nombre}</div>
            <div style={{
              fontSize: 11, color: colors.textFaint, marginTop: 4,
              fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase',
            }}>{tipo}</div>
            <div style={{
              display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 8,
              fontSize: type.xs, color: colors.textMute,
            }}>
              {establecimiento.telefono && <span>📞 {establecimiento.telefono}</span>}
              {establecimiento.email && <span>✉️ {establecimiento.email}</span>}
              {establecimiento.direccion && <span>📍 {establecimiento.direccion}</span>}
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-end' }}>
            {vinculacion && <div style={badge}>{badge._label}</div>}
            {vinculacion?.estado === 'activa' && (
              <button onClick={toggleDestacado} disabled={togglingDestacado}
                title={vinculacion.destacado ? 'Quitar destacado' : 'Marcar como destacado'}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  padding: '7px 14px', borderRadius: 999, cursor: 'pointer',
                  fontSize: 12, fontWeight: 700, fontFamily: type.family,
                  background: vinculacion.destacado ? colors.terracotta : colors.surface2,
                  color: vinculacion.destacado ? '#fff' : colors.textDim,
                  border: `1px solid ${vinculacion.destacado ? colors.terracotta : colors.border}`,
                  opacity: togglingDestacado ? 0.6 : 1,
                }}>
                <span style={{ fontSize: 13 }}>{vinculacion.destacado ? '★' : '☆'}</span>
                {vinculacion.destacado ? 'Destacado' : 'Destacar'}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))', gap: 12, marginBottom: 18 }}>
        <StatCard label="Pedidos 7 días" value={pedidos7d.length} sub={pedidos7d.length === 1 ? '1 pedido' : `${pedidos7d.length} pedidos`} />
        <StatCard label="Por cobrar" value={euro(totalPorCobrar)} sub={`${pedidosPendientesFactura} sin facturar`} tone="terracotta" />
        <StatCard label="Cobrado (histórico)" value={euro(totalCobrado)} tone="sage" />
        <StatCard label="Facturas emitidas" value={historicoFacturas.length} />
      </div>

      {/* Warning fiscal restaurante */}
      {!fiscalRestauranteOk && (
        <Warning>
          ⚠️ Este restaurante no tiene datos fiscales completos.
          {!establecimiento.razon_social && ' Falta razón social.'}
          {!establecimiento.nif && ' Falta CIF/NIF.'}
          {' '}Pídeselo antes de poder emitir factura.
        </Warning>
      )}

      {/* Warning fiscal socio */}
      {!fiscalCompletoSocio && (
        <div style={{
          background: colors.dangerSoft, color: colors.danger,
          padding: '12px 14px', borderRadius: 10, marginBottom: 14,
          fontSize: type.xs, lineHeight: 1.5,
          display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
        }}>
          <span>⚠️ Tus datos fiscales están incompletos. No podrás emitir facturas hasta completarlos.</span>
          <button onClick={() => window.dispatchEvent(new CustomEvent('pidoo:goto', { detail: 'configuracion' }))}
            style={{ ...ds.dangerBtn, height: 30, fontSize: 11 }}>
            Ir a Configuración
          </button>
        </div>
      )}

      {/* Msg */}
      {msg && (
        <div style={{
          background: msg.tipo === 'ok' ? colors.sageSoft : colors.dangerSoft,
          color: msg.tipo === 'ok' ? colors.sage2 : colors.danger,
          padding: '10px 14px', borderRadius: 10, marginBottom: 14, fontSize: type.xs, fontWeight: 600,
        }}>{msg.txt}</div>
      )}

      {/* CTA emitir factura */}
      <div style={{ marginBottom: 24 }}>
        <button onClick={emitirFactura} disabled={!puedeFacturar || emitiendo}
          style={{ ...ds.glossyBtn, opacity: (!puedeFacturar || emitiendo) ? 0.5 : 1 }}>
          {emitiendo ? 'Emitiendo…' : `Emitir factura semanal${pedidosPendientesFactura ? ` (${pedidosPendientesFactura} pedidos)` : ''}`}
        </button>
      </div>

      {/* Pedidos 7 días */}
      <SectionTitle>Pedidos últimos 7 días</SectionTitle>
      {pedidos7d.length === 0 ? (
        <div style={{ ...ds.card, textAlign: 'center', padding: 22, marginBottom: 22, color: colors.textMute, fontSize: type.sm }}>
          Sin pedidos en los últimos 7 días.
        </div>
      ) : (
        <Table head={['Código', 'Fecha', 'Estado', 'Pago', 'Total']}
          cols="110px 1fr 110px 100px 110px">
          {pedidos7d.map(p => {
            const b = stateBadge(p.estado)
            return (
              <TableRow key={p.id} cols="110px 1fr 110px 100px 110px">
                <span style={{ fontWeight: 600, color: colors.text, fontFamily: type.mono }}>{p.codigo}</span>
                <span>{new Date(p.created_at).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                <span><span style={b}>{b._label}</span></span>
                <span style={{ fontSize: 11, textTransform: 'uppercase', color: colors.textMute }}>{p.metodo_pago || '—'}</span>
                <span style={{ fontWeight: 600, color: colors.text, fontVariantNumeric: 'tabular-nums' }}>{euro(p.total)}</span>
              </TableRow>
            )
          })}
        </Table>
      )}

      {/* Pendientes facturar */}
      {detalleEarnings.length > 0 && (
        <>
          <SectionTitle>Pedidos pendientes de facturar</SectionTitle>
          <Table head={['Código', 'Fecha', 'Envío', 'Com.', 'Propina', 'Total']}
            cols="110px 1fr 80px 80px 80px 90px">
            {detalleEarnings.map(it => (
              <TableRow key={it.rider_earning_id} cols="110px 1fr 80px 80px 80px 90px">
                <span style={{ color: colors.text, fontWeight: 600, fontFamily: type.mono }}>{it.pedido_codigo}</span>
                <span>{it.pedido_fecha ? new Date(it.pedido_fecha).toLocaleDateString('es-ES') : '—'}</span>
                <span style={{ fontVariantNumeric: 'tabular-nums' }}>{euro(it.coste_envio)}</span>
                <span style={{ fontVariantNumeric: 'tabular-nums' }}>{euro(it.comision_rider)}</span>
                <span style={{ fontVariantNumeric: 'tabular-nums' }}>{euro(it.propina)}</span>
                <span style={{ color: colors.text, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{euro(it.neto_rider)}</span>
              </TableRow>
            ))}
          </Table>
        </>
      )}

      {/* Histórico facturas */}
      {historicoFacturas.length > 0 && (
        <>
          <SectionTitle>Histórico de facturas</SectionTitle>
          <Table head={['Número', 'Fecha', 'Pedidos', 'Total', '']}
            cols="120px 1fr 100px 100px 110px">
            {historicoFacturas.map(f => (
              <TableRow key={f.id} cols="120px 1fr 100px 100px 110px">
                <span style={{ fontWeight: 600, color: colors.text, fontFamily: type.mono }}>{f.numero}</span>
                <span>{f.fecha_emision ? new Date(f.fecha_emision).toLocaleDateString('es-ES') : '—'}</span>
                <span>{f.pedidos_count}</span>
                <span style={{ fontWeight: 700, color: colors.text, fontVariantNumeric: 'tabular-nums' }}>{euro(f.total)}</span>
                <span>
                  {f.pdf_url ? (
                    <a href={f.pdf_url} target="_blank" rel="noreferrer"
                      style={{
                        ...ds.secondaryBtn, height: 30, fontSize: 11,
                        textDecoration: 'none', display: 'inline-flex', alignItems: 'center',
                      }}>PDF</a>
                  ) : (
                    <span style={{ fontSize: 11, color: colors.textFaint }}>—</span>
                  )}
                </span>
              </TableRow>
            ))}
          </Table>
        </>
      )}
    </div>
  )
}

// ─────────────── helpers ───────────────
function BackBtn({ onBack }) {
  return (
    <button onClick={onBack} style={{
      ...ds.secondaryBtn, marginBottom: 14,
      display: 'inline-flex', alignItems: 'center', gap: 6,
    }}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>
      Volver a restaurantes
    </button>
  )
}

function Warning({ children }) {
  return (
    <div style={{
      background: colors.warningSoft, color: colors.warning,
      padding: '12px 14px', borderRadius: 10, marginBottom: 14,
      fontSize: type.xs, lineHeight: 1.5,
    }}>{children}</div>
  )
}

function SectionTitle({ children }) {
  return (
    <h2 style={{
      fontSize: 11, fontWeight: 700, color: colors.textMute,
      letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 10,
    }}>{children}</h2>
  )
}

function Table({ head, cols, children }) {
  return (
    <div style={{ ...ds.card, padding: 0, overflow: 'hidden', marginBottom: 22 }}>
      <div style={{
        display: 'grid', gridTemplateColumns: cols, gap: 10,
        padding: '12px 16px',
        background: colors.surface2,
        fontSize: 11, fontWeight: 700, color: colors.textMute,
        letterSpacing: '0.04em', textTransform: 'uppercase',
      }}>
        {head.map((h, i) => <div key={i}>{h}</div>)}
      </div>
      {children}
    </div>
  )
}

function TableRow({ cols, children }) {
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: cols, gap: 10,
      padding: '12px 16px', alignItems: 'center',
      borderTop: `1px solid ${colors.border}`,
      fontSize: type.sm, color: colors.textDim,
    }}>{children}</div>
  )
}
