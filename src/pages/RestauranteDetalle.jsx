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

        const [estRes, vincRes, pedRes, porCobrarRes, detRes, factRes] = await Promise.all([
          supabase.from('establecimientos')
            .select('id, nombre, logo_url, telefono, email, direccion, razon_social, nif, direccion_fiscal, codigo_postal, ciudad_fiscal, provincia_fiscal, slug')
            .eq('id', establecimiento_id).maybeSingle(),
          supabase.from('socio_establecimiento')
            .select('id, estado, solicitado_at, aceptado_at, exclusivo, destacado, orden_destacado')
            .eq('socio_id', socio.id).eq('establecimiento_id', establecimiento_id).maybeSingle(),
          supabase.from('pedidos')
            .select('id, codigo, estado, total, created_at, metodo_pago')
            .eq('socio_id', socio.id).eq('establecimiento_id', establecimiento_id)
            .gte('created_at', desde7.toISOString())
            .order('created_at', { ascending: false }).limit(50),
          supabase.rpc('get_por_cobrar_socio'),
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
        const fila = (porCobrarRes.data || []).find(r => r.establecimiento_id === establecimiento_id) || null
        setResumenCobro(fila)
        setDetalleEarnings(detRes.data || [])
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
      setMsg({
        tipo: 'ok',
        txt: nuevo
          ? 'Restaurante marcado como destacado en tu marketplace.'
          : 'Restaurante quitado de los destacados.',
      })
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
      // Refrescar
      window.setTimeout(() => window.dispatchEvent(new CustomEvent('pidoo:refresh-rest-detalle')), 200)
    } catch (e) {
      setMsg({ tipo: 'error', txt: e.message })
    } finally {
      setEmitiendo(false)
    }
  }

  // Listener para refrescar tras emitir
  useEffect(() => {
    const handler = () => {
      // re-trigger del useEffect cambiando un estado dummy
      setLoading(true)
      const id = window.setTimeout(() => {
        setLoading(false)
      }, 50)
      // forzar reload completo
      ;(async () => {
        if (!establecimiento_id || !socio?.id) return
        try {
          const [porCobrarRes, factRes, detRes] = await Promise.all([
            supabase.rpc('get_por_cobrar_socio'),
            supabase.from('facturas_socio_restaurante')
              .select('id, numero, fecha_emision, total, estado, pdf_url, pedidos_count, periodo_inicio, periodo_fin')
              .eq('socio_id', socio.id).eq('establecimiento_id', establecimiento_id)
              .order('fecha_emision', { ascending: false }).limit(20),
            supabase.rpc('get_detalle_por_cobrar_socio', { p_establecimiento_id: establecimiento_id }),
          ])
          const fila = (porCobrarRes.data || []).find(r => r.establecimiento_id === establecimiento_id) || null
          setResumenCobro(fila)
          setHistoricoFacturas(factRes.data || [])
          setDetalleEarnings(detRes.data || [])
        } catch (e) { console.error(e) }
      })()
      return () => window.clearTimeout(id)
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
        <button onClick={onBack} style={{ ...ds.secondaryBtn, marginBottom: 14 }}>← Volver</button>
        <div style={{ ...ds.card, textAlign: 'center', padding: 28 }}>
          <div style={{ fontSize: type.base, fontWeight: 600 }}>Restaurante no encontrado</div>
        </div>
      </div>
    )
  }

  const badge = stateBadge(vinculacion?.estado)

  return (
    <div>
      <button onClick={onBack} style={{ ...ds.secondaryBtn, marginBottom: 14 }}>← Volver a restaurantes</button>

      {/* Header restaurante */}
      <div style={{ ...ds.card, display: 'flex', gap: 14, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
        <div style={{
          width: 64, height: 64, borderRadius: 12, flexShrink: 0,
          background: establecimiento.logo_url ? `url(${establecimiento.logo_url}) center/cover` : colors.surface2,
          border: `1px solid ${colors.border}`,
        }} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: type.lg, fontWeight: 800, color: colors.text, letterSpacing: '-0.2px' }}>
            {establecimiento.nombre}
          </div>
          <div style={{ fontSize: type.xs, color: colors.textMute, marginTop: 4, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {establecimiento.telefono && <span>📞 {establecimiento.telefono}</span>}
            {establecimiento.email && <span>✉️ {establecimiento.email}</span>}
            {establecimiento.direccion && <span>📍 {establecimiento.direccion}</span>}
          </div>
        </div>
        {vinculacion && <div style={badge}>{badge._label}</div>}
        {vinculacion?.estado === 'activa' && (
          <button
            onClick={toggleDestacado}
            disabled={togglingDestacado}
            title={vinculacion.destacado
              ? 'Quitar de destacados en tu marketplace'
              : 'Mostrar como destacado en tu marketplace'}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '8px 14px', borderRadius: 999, cursor: 'pointer',
              fontSize: type.xs, fontWeight: 700, fontFamily: 'inherit',
              background: vinculacion.destacado ? colors.primary : colors.surface2,
              color: vinculacion.destacado ? '#fff' : colors.textDim,
              border: `1px solid ${vinculacion.destacado ? colors.primary : colors.border}`,
              opacity: togglingDestacado ? 0.6 : 1,
              transition: 'background 0.15s, color 0.15s',
            }}
          >
            <span style={{ fontSize: 13 }}>{vinculacion.destacado ? '★' : '☆'}</span>
            {vinculacion.destacado ? 'Destacado' : 'Destacar'}
          </button>
        )}
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 14, marginBottom: 18 }}>
        <StatCard label="Pedidos 7 días" value={pedidos7d.length} sub={pedidos7d.length === 1 ? '1 pedido' : `${pedidos7d.length} pedidos`} />
        <StatCard label="Por cobrar" value={euro(totalPorCobrar)} sub={`${pedidosPendientesFactura} sin facturar`} />
        <StatCard label="Cobrado (histórico)" value={euro(totalCobrado)} />
        <StatCard label="Facturas emitidas" value={historicoFacturas.length} />
      </div>

      {/* Warning datos fiscales del restaurante */}
      {!fiscalRestauranteOk && (
        <div style={{
          background: 'rgba(245,158,11,0.14)', color: '#92400E',
          border: '1px solid rgba(245,158,11,0.35)',
          padding: '12px 14px', borderRadius: 10, marginBottom: 14,
          fontSize: type.xs, lineHeight: 1.5,
        }}>
          ⚠️ Este restaurante no tiene datos fiscales completos.
          {!establecimiento.razon_social && ' Falta razón social.'}
          {!establecimiento.nif && ' Falta CIF/NIF.'}
          {' '}Pídeselo antes de poder emitir factura.
        </div>
      )}

      {/* Warning datos fiscales del socio */}
      {!fiscalCompletoSocio && (
        <div style={{
          background: colors.dangerSoft, color: colors.danger,
          padding: '12px 14px', borderRadius: 10, marginBottom: 14,
          fontSize: type.xs, lineHeight: 1.5,
          display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
        }}>
          <span>⚠️ Tus datos fiscales están incompletos. No podrás emitir facturas hasta completarlos.</span>
          <button onClick={() => window.dispatchEvent(new CustomEvent('pidoo:goto', { detail: 'configuracion' }))}
            style={{ ...ds.dangerBtn, height: 30, fontSize: type.xxs }}>
            Ir a Configuración
          </button>
        </div>
      )}

      {/* Mensaje resultado */}
      {msg && (
        <div style={{
          background: msg.tipo === 'ok' ? colors.stateOkSoft : colors.dangerSoft,
          color: msg.tipo === 'ok' ? colors.stateOk : colors.danger,
          padding: '10px 12px', borderRadius: 8, marginBottom: 14, fontSize: type.xs,
        }}>{msg.txt}</div>
      )}

      {/* Botón emitir factura */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 22 }}>
        <button
          onClick={emitirFactura}
          disabled={!puedeFacturar || emitiendo}
          style={{ ...ds.primaryBtn, opacity: (!puedeFacturar || emitiendo) ? 0.5 : 1 }}
        >
          {emitiendo ? 'Emitiendo…' : `Emitir factura semanal${pedidosPendientesFactura ? ` (${pedidosPendientesFactura} pedidos)` : ''}`}
        </button>
      </div>

      {/* Pedidos últimos 7 días */}
      <h2 style={{ fontSize: type.xxs, fontWeight: 700, color: colors.textMute, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 10 }}>
        Pedidos últimos 7 días
      </h2>
      {pedidos7d.length === 0 ? (
        <div style={{ ...ds.card, textAlign: 'center', padding: 22, marginBottom: 20, color: colors.textMute, fontSize: type.sm }}>
          Sin pedidos en los últimos 7 días.
        </div>
      ) : (
        <div style={{ ...ds.card, padding: 0, overflow: 'hidden', marginBottom: 22 }}>
          <div style={{
            display: 'grid', gridTemplateColumns: '110px 1fr 110px 100px 110px',
            padding: '10px 14px', gap: 8,
            fontSize: type.xxs, fontWeight: 700, color: colors.textMute,
            textTransform: 'uppercase', letterSpacing: '0.06em',
            borderBottom: `1px solid ${colors.border}`, background: colors.elev2,
          }}>
            <div>Código</div>
            <div>Fecha</div>
            <div>Estado</div>
            <div>Pago</div>
            <div>Total</div>
          </div>
          {pedidos7d.map(p => {
            const b = stateBadge(p.estado)
            return (
              <div key={p.id} style={{
                display: 'grid', gridTemplateColumns: '110px 1fr 110px 100px 110px',
                padding: '10px 14px', gap: 8,
                fontSize: type.sm, color: colors.textDim,
                borderBottom: `1px solid ${colors.border}`,
                alignItems: 'center',
              }}>
                <div style={{ fontWeight: 600, color: colors.text }}>{p.codigo}</div>
                <div>{new Date(p.created_at).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</div>
                <div><span style={{ ...b }}>{b._label}</span></div>
                <div style={{ fontSize: type.xxs, textTransform: 'uppercase', color: colors.textMute }}>{p.metodo_pago || '—'}</div>
                <div style={{ fontWeight: 600, color: colors.text }}>{euro(p.total)}</div>
              </div>
            )
          })}
        </div>
      )}

      {/* Pedidos pendientes de facturar */}
      {detalleEarnings.length > 0 && (
        <>
          <h2 style={{ fontSize: type.xxs, fontWeight: 700, color: colors.textMute, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 10 }}>
            Pedidos pendientes de facturar
          </h2>
          <div style={{ ...ds.card, padding: 0, overflow: 'hidden', marginBottom: 22 }}>
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
            {detalleEarnings.map(it => (
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
        </>
      )}

      {/* Histórico facturas */}
      {historicoFacturas.length > 0 && (
        <>
          <h2 style={{ fontSize: type.xxs, fontWeight: 700, color: colors.textMute, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 10 }}>
            Histórico de facturas
          </h2>
          <div style={{ ...ds.card, padding: 0, overflow: 'hidden' }}>
            <div style={{
              display: 'grid', gridTemplateColumns: '120px 1fr 100px 100px 110px',
              padding: '10px 14px', gap: 8,
              fontSize: type.xxs, fontWeight: 700, color: colors.textMute,
              textTransform: 'uppercase', letterSpacing: '0.06em',
              borderBottom: `1px solid ${colors.border}`, background: colors.elev2,
            }}>
              <div>Número</div>
              <div>Fecha</div>
              <div>Pedidos</div>
              <div>Total</div>
              <div></div>
            </div>
            {historicoFacturas.map(f => (
              <div key={f.id} style={{
                display: 'grid', gridTemplateColumns: '120px 1fr 100px 100px 110px',
                padding: '10px 14px', gap: 8,
                fontSize: type.sm, color: colors.textDim,
                borderBottom: `1px solid ${colors.border}`,
                alignItems: 'center',
              }}>
                <div style={{ fontWeight: 600, color: colors.text }}>{f.numero}</div>
                <div>{f.fecha_emision ? new Date(f.fecha_emision).toLocaleDateString('es-ES') : '—'}</div>
                <div>{f.pedidos_count}</div>
                <div style={{ fontWeight: 600, color: colors.text }}>{euro(f.total)}</div>
                <div>
                  {f.pdf_url ? (
                    <a href={f.pdf_url} target="_blank" rel="noreferrer"
                      style={{ ...ds.secondaryBtn, height: 30, fontSize: type.xs, textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}>
                      PDF
                    </a>
                  ) : (
                    <span style={{ fontSize: type.xxs, color: colors.textMute }}>—</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
