import { useEffect, useMemo, useState } from 'react'
import { useSocio } from '../context/SocioContext'
import { supabase, FUNCTIONS_URL } from '../lib/supabase'
import { colors, ds, type, stateBadge } from '../lib/uiStyles'
import StatCard from '../components/StatCard'
import { formatTarifa, tarifaCampos, fmtPct, formatFechaCorta } from '../lib/tarifas'
import { getPlugin } from '../lib/capacitor'

function euro(v) { return `${Number(v || 0).toFixed(2)} €` }

// Abre un PDF: navegador nativo (Browser) dentro de la APK; en web cae a window.open.
async function abrirPDF(url) {
  if (!url) return
  try {
    const B = (await getPlugin('Browser'))?.plugin
    if (B) { await B.open({ url }); return }
  } catch (_) {}
  window.open(url, '_blank', 'noopener')
}

export default function RestauranteDetalle({ establecimiento_id, onBack, hideBack }) {
  const { socio } = useSocio()
  const [loading, setLoading] = useState(true)
  const [establecimiento, setEstablecimiento] = useState(null)
  const [vinculacion, setVinculacion] = useState(null)
  const [pedidos7d, setPedidos7d] = useState([])
  const [pedidosMes, setPedidosMes] = useState([])
  const [resumenCobro, setResumenCobro] = useState(null)
  const [detalleEarnings, setDetalleEarnings] = useState([])
  const [historicoFacturas, setHistoricoFacturas] = useState([])
  const [emitiendo, setEmitiendo] = useState(false)
  const [cargandoPreview, setCargandoPreview] = useState(false)
  const [preview, setPreview] = useState(null)
  const [msg, setMsg] = useState(null)
  const [togglingDestacado, setTogglingDestacado] = useState(false)
  const [confirmarDesv, setConfirmarDesv] = useState(false)
  const [desvinculando, setDesvinculando] = useState(false)

  const fiscalCompletoSocio = !!(socio?.razon_social && socio?.nif && socio?.direccion_fiscal && socio?.codigo_postal && socio?.ciudad)

  useEffect(() => {
    if (!establecimiento_id || !socio?.id) return
    let cancel = false
    ;(async () => {
      setLoading(true)
      try {
        const desde7 = new Date()
        desde7.setDate(desde7.getDate() - 7)
        // Primer día del mes en curso (para "lo enviado este mes")
        const inicioMes = new Date()
        inicioMes.setDate(1)
        inicioMes.setHours(0, 0, 0, 0)

        const [estRes, vincRes, pedRes, mesRes, detRes, factRes] = await Promise.all([
          supabase.from('establecimientos')
            .select('id, nombre, logo_url, telefono, email, direccion, razon_social, nif, direccion_fiscal, codigo_postal, ciudad_fiscal, provincia_fiscal, slug, tipo')
            .eq('id', establecimiento_id).maybeSingle(),
          supabase.from('socio_establecimiento')
            .select(`
              id, estado, solicitado_at, aceptado_at, exclusivo, destacado, orden_destacado,
              tarifa_modo, tarifa_fija, tarifa_base, tarifa_radio_base_km, tarifa_precio_km, tarifa_maxima, comision_pct, tarifa_aceptada_en,
              tarifa_pendiente, tarifa_pendiente_origen, tarifa_pendiente_expira_en
            `)
            .eq('socio_id', socio.id).eq('establecimiento_id', establecimiento_id).maybeSingle(),
          supabase.from('pedidos')
            .select('id, codigo, estado, total, created_at, metodo_pago')
            .eq('socio_id', socio.id).eq('establecimiento_id', establecimiento_id)
            .gte('created_at', desde7.toISOString())
            .order('created_at', { ascending: false }).limit(50),
          // Pedidos ENTREGADOS este mes → ingresos del socio (envío + propina)
          supabase.from('pedidos')
            .select('id, codigo, coste_envio, propina, subtotal, entregado_at')
            .eq('socio_id', socio.id).eq('establecimiento_id', establecimiento_id)
            .eq('estado', 'entregado')
            .gte('entregado_at', inicioMes.toISOString())
            .order('entregado_at', { ascending: false }).limit(500),
          // RPC agregada "por cobrar" (deriva socio del auth). Si no existe → degrada.
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
        setPedidosMes(mesRes.data || [])
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
  const totalFacturasPendientes = useMemo(
    () => historicoFacturas.filter(f => f.estado !== 'pagada').reduce((s, r) => s + Number(r.total || 0), 0),
    [historicoFacturas]
  )
  // "Lo enviado este mes" = ingresos del socio (envío + propina) de pedidos entregados este mes.
  const ingresosMes = useMemo(
    () => pedidosMes.reduce((s, p) => s + Number(p.coste_envio || 0) + Number(p.propina || 0), 0),
    [pedidosMes]
  )
  const totalPorCobrar = Number(resumenCobro?.total_neto || 0)
  const pedidosPendientesFactura = Number(resumenCobro?.pedidos_count || 0)

  // Tarifa pactada (snapshot vigente en socio_establecimiento)
  const tarifaPactada = useMemo(() => {
    if (!vinculacion) return null
    // 18-jul-2026: el pacto puede ser 'fija' (precio por entrega) o 'distancia'.
    // Los vínculos antiguos no traen tarifa_modo → se tratan como 'distancia'.
    const esFija = vinculacion.tarifa_modo === 'fija'
    const t = esFija
      ? { tarifa_modo: 'fija', tarifa_fija: vinculacion.tarifa_fija }
      : {
          tarifa_modo: 'distancia',
          tarifa_base: vinculacion.tarifa_base,
          tarifa_radio_base_km: vinculacion.tarifa_radio_base_km,
          tarifa_precio_km: vinculacion.tarifa_precio_km,
          tarifa_maxima: vinculacion.tarifa_maxima,
        }
    const tieneAlguna = Object.entries(t)
      .filter(([k]) => k !== 'tarifa_modo')
      .some(([, v]) => v !== null && v !== undefined)
    if (!tieneAlguna) return null
    return { ...t, comision_pct: vinculacion.comision_pct }
  }, [vinculacion])

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

  const desvincular = async () => {
    if (!vinculacion?.id) return
    setDesvinculando(true); setMsg(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const r = await fetch(`${FUNCTIONS_URL}/desvincular-socio-establecimiento`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({ socio_establecimiento_id: vinculacion.id }),
      })
      const data = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(data.error || `Error ${r.status}`)
      setConfirmarDesv(false)
      // La vinculación ya no existe → volver al listado (se refresca al montar).
      if (onBack) onBack()
    } catch (e) {
      setConfirmarDesv(false)
      setMsg({ tipo: 'error', txt: 'No se pudo desvincular: ' + e.message })
    } finally {
      setDesvinculando(false)
    }
  }

  // Previsualización: calcula el desglose EXACTO de lo que se va a facturar
  // (misma fórmula que la edge generar-factura-socio-restaurante) para revisarlo
  // ANTES de emitir. No registra nada; solo consulta los pedidos pendientes.
  const abrirPreviewFactura = async () => {
    setCargandoPreview(true); setMsg(null)
    try {
      const { data: peds, error } = await supabase.from('pedidos')
        .select('id, modo_entrega, origen_pedido, subtotal, coste_envio, propina, entregado_at, created_at')
        .eq('socio_id', socio.id).eq('establecimiento_id', establecimiento_id)
        .eq('estado', 'entregado').is('factura_socio_id', null)
        .or('modo_entrega.eq.delivery,and(modo_entrega.eq.recogida,origen_pedido.eq.marketplace_socio)')
        .order('entregado_at', { ascending: true })
      if (error) throw error
      if (!peds || peds.length === 0) {
        setMsg({ tipo: 'error', txt: 'No hay pedidos pendientes de facturar a este restaurante.' })
        return
      }
      const pct = Number(vinculacion?.comision_pct ?? 10)
      let comision = 0, envios = 0, propinas = 0
      for (const p of peds) {
        const del = p.modo_entrega === 'delivery'
        // Telefónico: solo envío + propina, sin % del subtotal (igual que la edge v8)
        if (p.origen_pedido !== 'telefonico') {
          comision += +(Number(p.subtotal || 0) * pct / 100).toFixed(2) // redondeo por pedido (igual que la edge)
        }
        if (del) { envios += Number(p.coste_envio || 0); propinas += Number(p.propina || 0) }
      }
      comision = +comision.toFixed(2); envios = +envios.toFixed(2); propinas = +propinas.toFixed(2)
      const base = +(comision + envios + propinas).toFixed(2)
      const ivaPct = Number(socio?.iva_pct ?? 21)
      const ivaImporte = +(base * ivaPct / 100).toFixed(2)
      const total = +(base + ivaImporte).toFixed(2)
      const fechas = peds.map(p => new Date(p.entregado_at || p.created_at)).sort((a, b) => +a - +b)
      setPreview({
        pedidos_count: peds.length, comision_pct: pct,
        comision, envios, propinas, base, iva_pct: ivaPct, iva_importe: ivaImporte, total,
        periodo_inicio: fechas[0]?.toISOString().slice(0, 10),
        periodo_fin: fechas[fechas.length - 1]?.toISOString().slice(0, 10),
      })
    } catch (e) {
      setMsg({ tipo: 'error', txt: 'No se pudo calcular la factura: ' + e.message })
    } finally {
      setCargandoPreview(false)
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
      if (data.pdf_url) abrirPDF(data.pdf_url)
      window.setTimeout(() => window.dispatchEvent(new CustomEvent('pidoo:refresh-rest-detalle')), 200)
    } catch (e) {
      setMsg({ tipo: 'error', txt: e.message })
    } finally {
      setEmitiendo(false)
      setPreview(null)
    }
  }

  useEffect(() => {
    const handler = () => {
      ;(async () => {
        if (!establecimiento_id || !socio?.id) return
        try {
          const inicioMes = new Date()
          inicioMes.setDate(1)
          inicioMes.setHours(0, 0, 0, 0)
          const [factRes, detRes, mesRes] = await Promise.all([
            supabase.from('facturas_socio_restaurante')
              .select('id, numero, fecha_emision, total, estado, pdf_url, pedidos_count, periodo_inicio, periodo_fin')
              .eq('socio_id', socio.id).eq('establecimiento_id', establecimiento_id)
              .order('fecha_emision', { ascending: false }).limit(20),
            supabase.rpc('get_detalle_por_cobrar_socio', { p_establecimiento_id: establecimiento_id }),
            supabase.from('pedidos')
              .select('id, codigo, coste_envio, propina, subtotal, entregado_at')
              .eq('socio_id', socio.id).eq('establecimiento_id', establecimiento_id)
              .eq('estado', 'entregado')
              .gte('entregado_at', inicioMes.toISOString())
              .order('entregado_at', { ascending: false }).limit(500),
          ])
          setResumenCobro(Array.isArray(detRes.data) ? (detRes.data[0] || null) : (detRes.data || null))
          setHistoricoFacturas(factRes.data || [])
          setPedidosMes(mesRes.data || [])
          setDetalleEarnings([])
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
        {!hideBack && <BackBtn onBack={onBack} />}
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
      {!hideBack && <BackBtn onBack={onBack} />}

      {/* Header card */}
      <div style={{ ...ds.card, padding: 22, marginBottom: 18 }}>
        <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
          {establecimiento.logo_url ? (
            <div style={{
              width: 64, height: 64, borderRadius: 14, flexShrink: 0,
              background: `url(${establecimiento.logo_url}) center/cover`,
              border: `1.5px solid ${colors.terracotta}`,
            }} />
          ) : (
            <div style={{
              width: 64, height: 64, borderRadius: 14, flexShrink: 0,
              background: colors.terracottaSoft, color: colors.terracotta,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontWeight: 800, fontSize: 22, border: `1.5px solid ${colors.terracotta}`,
            }}>{nombre.slice(0, 1).toUpperCase()}</div>
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontSize: 20, fontWeight: 800, color: colors.text, letterSpacing: '-0.4px',
            }}>{nombre}</div>
            <div style={{
              fontSize: 11, color: colors.textFaint, marginTop: 4,
              fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase',
            }}>{tipo}</div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
          {vinculacion && <div style={badge}>{badge._label}</div>}
          {vinculacion?.estado === 'activa' && (
            <button onClick={toggleDestacado} disabled={togglingDestacado}
              title={vinculacion.destacado ? 'Quitar destacado' : 'Marcar como destacado'}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '7px 14px', borderRadius: 999, cursor: 'pointer',
                fontSize: 12, fontWeight: 700, fontFamily: type.family, whiteSpace: 'nowrap',
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

        <div style={{
          display: 'flex', flexDirection: 'column', gap: 6, marginTop: 14,
          fontSize: type.xs, color: colors.textMute,
        }}>
          {establecimiento.telefono && <span>📞 {establecimiento.telefono}</span>}
          {establecimiento.email && <span style={{ wordBreak: 'break-all' }}>✉️ {establecimiento.email}</span>}
          {establecimiento.direccion && <span>📍 {establecimiento.direccion}</span>}
        </div>
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))', gap: 12, marginBottom: 18 }}>
        <StatCard label="Enviado este mes" value={euro(ingresosMes)} sub={pedidosMes.length === 1 ? '1 entregado' : `${pedidosMes.length} entregados`} tone="sage" />
        <StatCard label="Por cobrar" value={euro(totalPorCobrar)} sub={`${pedidosPendientesFactura} sin facturar`} tone="terracotta" />
        <StatCard label="Cobrado (histórico)" value={euro(totalCobrado)} />
        <StatCard label="Pedidos 7 días" value={pedidos7d.length} sub={pedidos7d.length === 1 ? '1 pedido' : `${pedidos7d.length} pedidos`} />
      </div>

      {/* Tarifa pactada */}
      <SectionTitle>Tarifa pactada</SectionTitle>
      <div style={{ ...ds.card, padding: 18, marginBottom: 18 }}>
        {tarifaPactada ? (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))', gap: 14 }}>
              {[...tarifaCampos(tarifaPactada), { campo: 'comision_pct', label: 'Comisión', valor: tarifaPactada.comision_pct, fmt: fmtPct }].map(c => (
                <div key={c.campo}>
                  <div style={{ fontSize: 11, color: colors.textMute, fontWeight: 600 }}>{c.label}</div>
                  <div style={{
                    fontSize: 18, fontWeight: 800, color: colors.text,
                    fontVariantNumeric: 'tabular-nums', marginTop: 2,
                  }}>{c.fmt(c.valor)}</div>
                </div>
              ))}
            </div>
            <div style={{ fontSize: type.xs, color: colors.textMute, marginTop: 12 }}>
              {formatTarifa(tarifaPactada)}
              {vinculacion?.tarifa_aceptada_en && (
                <span> · Vigente desde {formatFechaCorta(vinculacion.tarifa_aceptada_en)}</span>
              )}
            </div>
            {vinculacion?.tarifa_pendiente && Object.keys(vinculacion.tarifa_pendiente).length > 0 && (
              <div style={{
                marginTop: 12, padding: '8px 12px', borderRadius: 8,
                background: colors.warningSoft, color: colors.warning,
                fontSize: type.xs, fontWeight: 600,
              }}>
                Hay una propuesta de tarifa pendiente
                {vinculacion.tarifa_pendiente_origen === 'socio' ? ' (tuya, esperando al restaurante)' : ' del restaurante'}.
                Revísala en Restaurantes → Propuestas.
              </div>
            )}
          </>
        ) : (
          <div style={{ fontSize: type.sm, color: colors.textDim }}>
            No hay tarifa pactada con este restaurante. Se aplica la <b>tarifa por defecto</b> de la plataforma.
          </div>
        )}
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
        <button onClick={abrirPreviewFactura} disabled={!puedeFacturar || cargandoPreview || emitiendo}
          style={{ ...ds.glossyBtn, opacity: (!puedeFacturar || cargandoPreview || emitiendo) ? 0.5 : 1 }}>
          {cargandoPreview ? 'Calculando…' : `Revisar y emitir factura${pedidosPendientesFactura ? ` (${pedidosPendientesFactura} pedidos)` : ''}`}
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

      {/* Entregados este mes (lo enviado) */}
      <SectionTitle>Entregados este mes · lo que has enviado</SectionTitle>
      {pedidosMes.length === 0 ? (
        <div style={{ ...ds.card, textAlign: 'center', padding: 22, marginBottom: 22, color: colors.textMute, fontSize: type.sm }}>
          Sin pedidos entregados este mes.
        </div>
      ) : (
        <Table head={['Código', 'Entregado', 'Envío', 'Propina', 'Tu ingreso']}
          cols="110px 1fr 90px 90px 100px">
          {pedidosMes.map(p => (
            <TableRow key={p.id} cols="110px 1fr 90px 90px 100px">
              <span style={{ fontWeight: 600, color: colors.text, fontFamily: type.mono }}>{p.codigo}</span>
              <span>{p.entregado_at ? new Date(p.entregado_at).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'}</span>
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>{euro(p.coste_envio)}</span>
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>{euro(p.propina)}</span>
              <span style={{ fontWeight: 700, color: colors.sage2, fontVariantNumeric: 'tabular-nums' }}>
                {euro(Number(p.coste_envio || 0) + Number(p.propina || 0))}
              </span>
            </TableRow>
          ))}
          <div style={{
            display: 'grid', gridTemplateColumns: '110px 1fr 90px 90px 100px', gap: 10,
            padding: '12px 16px', alignItems: 'center',
            borderTop: `1px solid ${colors.borderStrong}`, background: colors.surface2,
            fontSize: type.sm,
          }}>
            <span style={{ fontWeight: 700, color: colors.text, gridColumn: '1 / 5' }}>Total enviado este mes</span>
            <span style={{ fontWeight: 800, color: colors.sage2, fontVariantNumeric: 'tabular-nums' }}>{euro(ingresosMes)}</span>
          </div>
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
      <SectionTitle>Facturas · enviadas y pendientes</SectionTitle>
      {historicoFacturas.length === 0 ? (
        <div style={{ ...ds.card, textAlign: 'center', padding: 22, marginBottom: 22, color: colors.textMute, fontSize: type.sm }}>
          Aún no has emitido facturas a este restaurante.
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 12, fontSize: type.xs, color: colors.textMute }}>
            <span>Pendiente de cobro: <b style={{ color: colors.terracotta }}>{euro(totalFacturasPendientes)}</b></span>
            <span>Cobrado: <b style={{ color: colors.sage2 }}>{euro(totalCobrado)}</b></span>
          </div>
          <Table head={['Número', 'Fecha', 'Pedidos', 'Estado', 'Total', '']}
            cols="120px 1fr 80px 110px 100px 90px">
            {historicoFacturas.map(f => {
              const fb = stateBadge(f.estado === 'pagada' ? 'entregado' : 'pendiente')
              return (
                <TableRow key={f.id} cols="120px 1fr 80px 110px 100px 90px">
                  <span style={{ fontWeight: 600, color: colors.text, fontFamily: type.mono }}>{f.numero}</span>
                  <span>{f.fecha_emision ? new Date(f.fecha_emision).toLocaleDateString('es-ES') : '—'}</span>
                  <span>{f.pedidos_count}</span>
                  <span>
                    <span style={fb}>{f.estado === 'pagada' ? 'Pagada' : 'Pendiente'}</span>
                  </span>
                  <span style={{ fontWeight: 700, color: colors.text, fontVariantNumeric: 'tabular-nums' }}>{euro(f.total)}</span>
                  <span>
                    {f.pdf_url ? (
                      <button onClick={() => abrirPDF(f.pdf_url)}
                        style={{
                          ...ds.secondaryBtn, height: 30, fontSize: 11, cursor: 'pointer',
                          display: 'inline-flex', alignItems: 'center',
                        }}>PDF</button>
                    ) : (
                      <span style={{ fontSize: 11, color: colors.textFaint }}>—</span>
                    )}
                  </span>
                </TableRow>
              )
            })}
          </Table>
        </>
      )}

      {/* Zona peligrosa — desvincular del restaurante */}
      {vinculacion && vinculacion.estado !== 'rechazada' && (
        <div style={{ marginTop: 8, padding: 18, borderRadius: 14, background: colors.dangerSoft }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: colors.danger, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>Zona peligrosa</div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ fontSize: type.sm, color: colors.danger, flex: '1 1 200px' }}>
              Dejar de trabajar con este restaurante. Se le enviará una notificación.
            </div>
            <button onClick={() => setConfirmarDesv(true)} style={{ ...ds.dangerBtn, background: 'transparent', whiteSpace: 'nowrap' }}>
              Desvincular
            </button>
          </div>
        </div>
      )}

      {confirmarDesv && (
        <div onClick={() => !desvinculando && setConfirmarDesv(false)}
          style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(26,24,21,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()}
            style={{ background: colors.paper, borderRadius: 16, maxWidth: 420, width: '100%', padding: 24, border: `1px solid ${colors.border}`, boxShadow: colors.shadowLg }}>
            <h2 style={{ ...ds.h2, marginBottom: 8 }}>Desvincular restaurante</h2>
            <p style={{ fontSize: type.sm, color: colors.textDim, lineHeight: 1.5, marginBottom: 18 }}>
              ¿Seguro que quieres desvincularte de <b style={{ color: colors.text }}>{nombre}</b>? Dejarás de recibir sus pedidos y se le enviará una notificación. Podrás volver a solicitar la vinculación más adelante.
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setConfirmarDesv(false)} disabled={desvinculando} style={ds.secondaryBtn}>Cancelar</button>
              <button onClick={desvincular} disabled={desvinculando} style={{ ...ds.dangerBtn, opacity: desvinculando ? 0.6 : 1 }}>
                {desvinculando ? 'Desvinculando…' : 'Sí, desvincular'}
              </button>
            </div>
          </div>
        </div>
      )}

      {preview && (
        <div onClick={() => !emitiendo && setPreview(null)}
          style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(26,24,21,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()}
            style={{ background: colors.paper, borderRadius: 16, maxWidth: 440, width: '100%', padding: 24, border: `1px solid ${colors.border}`, boxShadow: colors.shadowLg }}>
            <h2 style={{ ...ds.h2, marginBottom: 4 }}>Revisar factura</h2>
            <p style={{ fontSize: type.xs, color: colors.textMute, marginBottom: 16 }}>
              {nombre} · {preview.pedidos_count} {preview.pedidos_count === 1 ? 'pedido' : 'pedidos'}
              {preview.periodo_inicio && preview.periodo_fin && (
                <> · {new Date(preview.periodo_inicio).toLocaleDateString('es-ES')} – {new Date(preview.periodo_fin).toLocaleDateString('es-ES')}</>
              )}
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: type.sm, marginBottom: 16 }}>
              <Linea label={`Comisión (${preview.comision_pct}%)`} valor={preview.comision} />
              <Linea label="Envíos" valor={preview.envios} />
              <Linea label="Propinas" valor={preview.propinas} />
              <div style={{ borderTop: `1px solid ${colors.border}`, margin: '2px 0' }} />
              <Linea label="Base imponible" valor={preview.base} bold />
              <Linea label={`IVA (${preview.iva_pct}%)`} valor={preview.iva_importe} />
              <div style={{ borderTop: `1px solid ${colors.borderStrong}`, margin: '2px 0' }} />
              <Linea label="Total" valor={preview.total} bold big />
            </div>
            <p style={{ fontSize: 11, color: colors.textFaint, marginBottom: 16, lineHeight: 1.5 }}>
              Revisa los importes. Al confirmar se emite la factura y estos pedidos quedan marcados como facturados.
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setPreview(null)} disabled={emitiendo} style={ds.secondaryBtn}>Cancelar</button>
              <button onClick={emitirFactura} disabled={emitiendo}
                style={{ ...ds.glossyBtn, width: 'auto', padding: '0 20px', opacity: emitiendo ? 0.6 : 1 }}>
                {emitiendo ? 'Emitiendo…' : 'Confirmar y emitir'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─────────────── helpers ───────────────
function Linea({ label, valor, bold, big }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <span style={{ color: bold ? colors.text : colors.textDim, fontWeight: bold ? 700 : 500 }}>{label}</span>
      <span style={{ color: colors.text, fontWeight: bold ? 800 : 600, fontVariantNumeric: 'tabular-nums', fontSize: big ? 18 : 14 }}>{euro(valor)}</span>
    </div>
  )
}

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
