import { useEffect, useMemo, useState } from 'react'
import { useSocio } from '../context/SocioContext'
import { supabase, FUNCTIONS_URL } from '../lib/supabase'
import { colors, ds, type, stateBadge } from '../lib/uiStyles'
import {
  formatTarifa, tarifaCampos, compararTarifas,
  formatCuentaAtras, formatFechaCorta,
} from '../lib/tarifas'

const ESTADOS_PENDIENTES = ['pendiente', 'solicitada']

export default function Restaurantes({ onOpenRestaurante }) {
  const { socio } = useSocio()
  const [tab, setTab] = useState('vinculados')
  const [vinculados, setVinculados] = useState([])
  const [buscador, setBuscador] = useState([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [enviando, setEnviando] = useState(null)

  // Modal de confirmación al solicitar vinculación
  const [modalSolicitar, setModalSolicitar] = useState(null)
  // Modal de respuesta a propuesta de cambio (rechazar con motivo)
  const [modalRechazar, setModalRechazar] = useState(null)
  const [respondiendo, setRespondiendo] = useState(null)

  // Tick para refrescar cuenta atrás cada minuto
  const [, setTick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setTick(x => x + 1), 60000)
    return () => clearInterval(t)
  }, [])

  const load = async () => {
    if (!socio?.id) return
    setLoading(true)
    try {
      const [vinc, rest] = await Promise.all([
        supabase.from('socio_establecimiento')
          .select(`
            id, estado, solicitado_at, aceptado_at,
            tarifa_base, tarifa_radio_base_km, tarifa_precio_km, tarifa_maxima,
            tarifa_aceptada_en, tarifa_pendiente, tarifa_pendiente_at,
            tarifa_pendiente_origen, tarifa_pendiente_expira_en,
            establecimiento:establecimientos(id, nombre, logo_url, slug, tipo, rating, activo)
          `)
          .eq('socio_id', socio.id)
          .order('solicitado_at', { ascending: false }),
        supabase.from('establecimientos')
          .select('id, nombre, logo_url, slug, tipo, rating, activo, estado')
          .eq('activo', true)
          .limit(100),
      ])
      setVinculados(vinc.data || [])
      const vinculadosIds = new Set((vinc.data || []).map(v => v.establecimiento?.id))
      setBuscador((rest.data || []).filter(r => !vinculadosIds.has(r.id)))
    } catch (e) { console.error(e) }
    setLoading(false)
  }

  useEffect(() => { load() }, [socio])

  // Realtime sobre socio_establecimiento — cualquier cambio (estado o
  // tarifa pendiente) refresca para que los banners se actualicen.
  useEffect(() => {
    if (!socio?.id) return
    const channel = supabase
      .channel(`socio-vinc-${socio.id}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'socio_establecimiento',
        filter: `socio_id=eq.${socio.id}`,
      }, () => load())
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [socio?.id])

  const propuestas = useMemo(
    () => vinculados.filter(v => v.tarifa_pendiente && Object.keys(v.tarifa_pendiente).length > 0),
    [vinculados]
  )

  // Pulsa "Solicitar vinculación" → cargamos config y abrimos modal
  const abrirSolicitar = async (establecimiento) => {
    setEnviando(establecimiento.id)
    try {
      const { data } = await supabase
        .from('restaurante_config_delivery')
        .select('tarifa_base, tarifa_radio_base_km, tarifa_precio_km, tarifa_maxima')
        .eq('establecimiento_id', establecimiento.id)
        .maybeSingle()
      setModalSolicitar({
        establecimiento,
        tarifa: data || null,
        acepta: false,
        loading: false,
        error: null,
        // Si la edge devuelve 409, guardamos aquí la nueva tarifa
        tarifaActualizada: null,
      })
    } catch (e) {
      alert('No se pudo cargar la tarifa: ' + e.message)
    } finally {
      setEnviando(null)
    }
  }

  const confirmarSolicitar = async () => {
    if (!modalSolicitar) return
    const tarifaSnapshot = modalSolicitar.tarifaActualizada || modalSolicitar.tarifa
    setModalSolicitar(m => ({ ...m, loading: true, error: null }))
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const r = await fetch(`${FUNCTIONS_URL}/solicitar-vinculacion-socio`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({
          establecimiento_id: modalSolicitar.establecimiento.id,
          acepta_tarifa: true,
          tarifa_snapshot: tarifaSnapshot || null,
        }),
      })
      const data = await r.json().catch(() => ({}))
      if (r.status === 409 && data?.tarifa_actual) {
        // La tarifa cambió mientras decidía. Mostrar nueva y pedir reconfirmación.
        setModalSolicitar(m => ({
          ...m,
          loading: false,
          tarifaActualizada: data.tarifa_actual,
          acepta: false,
          error: 'La tarifa del restaurante ha cambiado. Revísala y vuelve a aceptar.',
        }))
        return
      }
      if (!r.ok) throw new Error(data?.error || `Error al solicitar (${r.status})`)
      setModalSolicitar(null)
      await load()
      setTab('vinculados')
    } catch (e) {
      setModalSolicitar(m => m ? ({ ...m, loading: false, error: e.message }) : null)
    }
  }

  const responderPropuesta = async (vinc, accion, motivo) => {
    setRespondiendo(vinc.id)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const r = await fetch(`${FUNCTIONS_URL}/responder-tarifa-pendiente`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({
          socio_establecimiento_id: vinc.id,
          accion,
          motivo: motivo || null,
        }),
      })
      const data = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(data?.error || `Error (${r.status})`)
      setModalRechazar(null)
      await load()
    } catch (e) {
      alert(e.message)
    } finally {
      setRespondiendo(null)
    }
  }

  const filtrados = buscador.filter(r =>
    !query || r.nombre.toLowerCase().includes(query.toLowerCase())
  )

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <h1 style={ds.h1}>Restaurantes</h1>
        <div style={{ fontSize: type.xs, color: colors.textMute }}>
          {vinculados.filter(v => v.estado === 'activa').length} / {socio?.limite_restaurantes ?? 5} activos
        </div>
      </div>

      <div style={{
        display: 'flex', background: colors.surface2, borderRadius: 8, padding: 3,
        marginBottom: 16, maxWidth: 540, gap: 3, flexWrap: 'wrap',
      }}>
        {[
          { id: 'vinculados', l: `Mis vinculados (${vinculados.length})` },
          { id: 'propuestas', l: `Propuestas (${propuestas.length})`, badge: propuestas.length },
          { id: 'buscar', l: 'Buscar' },
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            flex: 1, minWidth: 110, padding: '9px 8px', borderRadius: 6, border: 'none',
            background: tab === t.id ? colors.surface : 'transparent',
            color: tab === t.id ? colors.text : colors.textMute,
            fontSize: type.xs, fontWeight: 700, cursor: 'pointer',
            boxShadow: tab === t.id ? colors.shadow : 'none',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          }}>
            {t.l}
            {t.badge > 0 && (
              <span style={{
                background: colors.primary, color: '#fff',
                fontSize: type.xxs, fontWeight: 800,
                minWidth: 18, height: 18, padding: '0 5px',
                borderRadius: 9, display: 'inline-flex',
                alignItems: 'center', justifyContent: 'center',
              }}>{t.badge}</span>
            )}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{ color: colors.textMute, fontSize: type.sm, padding: 20 }}>Cargando…</div>
      ) : tab === 'vinculados' ? (
        renderVinculados({ vinculados, onOpenRestaurante, setTab })
      ) : tab === 'propuestas' ? (
        renderPropuestas({
          propuestas, respondiendo,
          onAceptar: (v) => responderPropuesta(v, 'aceptar'),
          onRechazar: (v) => setModalRechazar({ vinc: v, motivo: '' }),
        })
      ) : (
        <>
          <input
            value={query} onChange={e => setQuery(e.target.value)}
            placeholder="Buscar por nombre…"
            style={{ ...ds.input, marginBottom: 14 }}
          />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(260px,1fr))', gap: 12 }}>
            {filtrados.map(r => (
              <div key={r.id} style={ds.card}>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 10 }}>
                  <div style={{
                    width: 44, height: 44, borderRadius: 8, flexShrink: 0,
                    background: r.logo_url ? `url(${r.logo_url}) center/cover` : colors.surface2,
                    border: `1px solid ${colors.border}`,
                  }} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: type.base, fontWeight: 600, color: colors.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {r.nombre}
                    </div>
                    <div style={{ fontSize: type.xs, color: colors.textMute }}>{r.tipo}{r.rating ? ` · ★ ${Number(r.rating).toFixed(1)}` : ''}</div>
                  </div>
                </div>
                <button onClick={() => abrirSolicitar(r)} disabled={enviando === r.id}
                  style={{ ...ds.primaryBtn, width: '100%', opacity: enviando === r.id ? 0.6 : 1 }}>
                  {enviando === r.id ? 'Cargando…' : 'Solicitar vinculación'}
                </button>
              </div>
            ))}
            {filtrados.length === 0 && (
              <div style={{ ...ds.card, gridColumn: '1/-1', textAlign: 'center', color: colors.textMute }}>
                No hay resultados.
              </div>
            )}
          </div>
        </>
      )}

      {modalSolicitar && (
        <ModalSolicitar
          state={modalSolicitar}
          onAcepta={(v) => setModalSolicitar(m => ({ ...m, acepta: v }))}
          onConfirm={confirmarSolicitar}
          onClose={() => setModalSolicitar(null)}
        />
      )}

      {modalRechazar && (
        <ModalRechazar
          state={modalRechazar}
          loading={respondiendo === modalRechazar.vinc.id}
          onChange={(motivo) => setModalRechazar(m => ({ ...m, motivo }))}
          onConfirm={() => responderPropuesta(modalRechazar.vinc, 'rechazar', modalRechazar.motivo)}
          onClose={() => setModalRechazar(null)}
        />
      )}
    </div>
  )
}

function renderVinculados({ vinculados, onOpenRestaurante, setTab }) {
  if (vinculados.length === 0) {
    return (
      <div style={{ ...ds.card, textAlign: 'center', padding: 28 }}>
        <div style={{ fontSize: type.base, fontWeight: 600, marginBottom: 6 }}>Aún no tienes restaurantes</div>
        <div style={{ fontSize: type.sm, color: colors.textMute, marginBottom: 12 }}>
          Busca y solicita vinculación con los que quieras mostrar en tu marketplace.
        </div>
        <button onClick={() => setTab('buscar')} style={ds.primaryBtn}>Buscar restaurantes</button>
      </div>
    )
  }
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(280px,1fr))', gap: 12 }}>
      {vinculados.map(v => {
        const e = v.establecimiento || {}
        const badge = stateBadge(v.estado)
        const clickable = !!e.id && (v.estado === 'activa' || v.estado === 'solicitada' || v.estado === 'pendiente')
        const tienePropuesta = !!v.tarifa_pendiente && Object.keys(v.tarifa_pendiente).length > 0
        const cuenta = tienePropuesta ? formatCuentaAtras(v.tarifa_pendiente_expira_en) : null
        return (
          <div
            key={v.id}
            onClick={() => { if (clickable && onOpenRestaurante) onOpenRestaurante(e.id) }}
            style={{
              ...ds.card,
              cursor: clickable ? 'pointer' : 'default',
              transition: 'transform 0.15s, box-shadow 0.15s',
              borderColor: tienePropuesta ? colors.primaryBorder : colors.border,
            }}
            onMouseEnter={(ev) => { if (clickable) { ev.currentTarget.style.transform = 'translateY(-2px)'; ev.currentTarget.style.boxShadow = colors.shadowLg } }}
            onMouseLeave={(ev) => { ev.currentTarget.style.transform = 'translateY(0)'; ev.currentTarget.style.boxShadow = '' }}
          >
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 8 }}>
              <div style={{
                width: 44, height: 44, borderRadius: 8, flexShrink: 0,
                background: e.logo_url ? `url(${e.logo_url}) center/cover` : colors.surface2,
                border: `1px solid ${colors.border}`,
              }} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: type.base, fontWeight: 600, color: colors.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {e.nombre || '—'}
                </div>
                <div style={{ fontSize: type.xs, color: colors.textMute }}>{e.tipo}</div>
              </div>
              {clickable && (
                <span style={{ color: colors.textMute, fontSize: type.lg }}>›</span>
              )}
            </div>
            <div style={{
              fontSize: type.xxs, color: colors.textDim, marginBottom: 8,
              padding: '6px 8px', borderRadius: 6, background: colors.surface2,
              border: `1px solid ${colors.border}`,
            }}>
              <span style={{ fontWeight: 700, color: colors.textMute }}>Tarifa: </span>
              {formatTarifa(v.tarifa_base !== null ? {
                tarifa_base: v.tarifa_base,
                tarifa_radio_base_km: v.tarifa_radio_base_km,
                tarifa_precio_km: v.tarifa_precio_km,
                tarifa_maxima: v.tarifa_maxima,
              } : null)}
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              <div style={{ ...badge }}>{badge._label}</div>
              {tienePropuesta && (
                <div style={{
                  fontSize: type.xxs, fontWeight: 700, padding: '3px 8px', borderRadius: 6,
                  letterSpacing: '0.04em', textTransform: 'uppercase',
                  background: colors.primarySoft, color: colors.primary,
                  border: `1px solid ${colors.primaryBorder}`,
                }}>
                  Nueva propuesta {cuenta && !cuenta.expirada
                    ? `· actuar antes del ${formatFechaCorta(v.tarifa_pendiente_expira_en)}`
                    : ''}
                </div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function renderPropuestas({ propuestas, respondiendo, onAceptar, onRechazar }) {
  if (propuestas.length === 0) {
    return (
      <div style={{ ...ds.card, textAlign: 'center', padding: 28, color: colors.textMute }}>
        No hay propuestas de cambio de tarifa pendientes.
      </div>
    )
  }
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {propuestas.map(v => {
        const e = v.establecimiento || {}
        const cuenta = formatCuentaAtras(v.tarifa_pendiente_expira_en)
        const actual = {
          tarifa_base: v.tarifa_base,
          tarifa_radio_base_km: v.tarifa_radio_base_km,
          tarifa_precio_km: v.tarifa_precio_km,
          tarifa_maxima: v.tarifa_maxima,
        }
        const propuesta = v.tarifa_pendiente || {}
        const filas = compararTarifas(actual, propuesta)
        return (
          <div key={v.id} style={{ ...ds.card, padding: '18px 20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontSize: type.lg, fontWeight: 700, color: colors.text }}>
                  {e.nombre || '—'}
                </div>
                <div style={{ fontSize: type.xs, color: colors.textMute, marginTop: 2 }}>
                  Propuesta de {v.tarifa_pendiente_origen === 'restaurante' ? 'el restaurante' : v.tarifa_pendiente_origen || 'sistema'}
                  {' · '}
                  recibida {formatFechaCorta(v.tarifa_pendiente_at)}
                </div>
              </div>
              {cuenta && (
                <div style={{
                  fontSize: type.xs, fontWeight: 700,
                  padding: '6px 10px', borderRadius: 8,
                  background: cuenta.urgente ? colors.dangerSoft : colors.primarySoft,
                  color: cuenta.urgente ? colors.danger : colors.primary,
                  border: `1px solid ${cuenta.urgente ? colors.danger : colors.primaryBorder}`,
                }}>
                  {cuenta.expirada ? 'Caducada' : `Caduca en ${cuenta.label}`}
                </div>
              )}
            </div>

            <TablaComparativa filas={filas} actual={actual} propuesta={propuesta} />

            <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              <button
                onClick={() => onRechazar(v)}
                disabled={respondiendo === v.id || cuenta?.expirada}
                style={{
                  ...ds.secondaryBtn,
                  opacity: (respondiendo === v.id || cuenta?.expirada) ? 0.6 : 1,
                }}
              >Rechazar</button>
              <button
                onClick={() => onAceptar(v)}
                disabled={respondiendo === v.id || cuenta?.expirada}
                style={{
                  ...ds.primaryBtn,
                  background: colors.stateOk, borderColor: colors.stateOk,
                  opacity: (respondiendo === v.id || cuenta?.expirada) ? 0.6 : 1,
                }}
              >{respondiendo === v.id ? 'Procesando…' : 'Aceptar nueva tarifa'}</button>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function TablaComparativa({ filas, actual, propuesta }) {
  return (
    <div style={{
      borderRadius: 8, border: `1px solid ${colors.border}`, overflow: 'hidden',
    }}>
      <div style={{
        display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr',
        background: colors.surface2,
        fontSize: type.xxs, fontWeight: 700, color: colors.textMute,
        letterSpacing: '0.06em', textTransform: 'uppercase',
      }}>
        <div style={{ padding: '8px 10px' }}>Concepto</div>
        <div style={{ padding: '8px 10px' }}>Actual</div>
        <div style={{ padding: '8px 10px' }}>Propuesta</div>
      </div>
      {tarifaCampos(actual).map((row, i) => {
        const fila = filas.find(f => f.campo === row.campo)
        const labelMap = {
          tarifa_base: 'Tarifa base',
          tarifa_radio_base_km: 'Radio incluido',
          tarifa_precio_km: 'Precio km extra',
          tarifa_maxima: 'Tarifa máxima',
        }
        const fmt = row.fmt
        const cambia = fila?.mejor !== 'igual'
        const mejor = fila?.mejor === 'despues'
        return (
          <div key={row.campo} style={{
            display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr',
            borderTop: i === 0 ? 'none' : `1px solid ${colors.border}`,
            fontSize: type.sm, color: colors.text,
            background: cambia ? (mejor ? colors.stateOkSoft : colors.dangerSoft) : colors.surface,
          }}>
            <div style={{ padding: '10px', fontWeight: 600 }}>{labelMap[row.campo]}</div>
            <div style={{ padding: '10px', color: colors.textDim }}>
              {fmt(actual?.[row.campo])}
            </div>
            <div style={{ padding: '10px', fontWeight: cambia ? 700 : 400, color: cambia ? (mejor ? colors.stateOk : colors.danger) : colors.text }}>
              {fmt(propuesta?.[row.campo])}
              {cambia && (
                <span style={{ fontSize: type.xxs, marginLeft: 6, fontWeight: 800 }}>
                  {mejor ? '↑ mejor' : '↓ peor'}
                </span>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function ModalSolicitar({ state, onAcepta, onConfirm, onClose }) {
  const tarifaMostrada = state.tarifaActualizada || state.tarifa
  const e = state.establecimiento
  return (
    <ModalShell onClose={onClose}>
      <h2 style={{ ...ds.h2, marginBottom: 6 }}>Solicitar vinculación</h2>
      <div style={{ fontSize: type.sm, color: colors.textMute, marginBottom: 14 }}>
        Vas a solicitar la vinculación con <b style={{ color: colors.text }}>{e.nombre}</b>. Revisa la tarifa que cobrarás por cada pedido entregado.
      </div>

      {state.tarifaActualizada && (
        <div style={{
          padding: '10px 12px', borderRadius: 8, marginBottom: 12,
          background: colors.statePrepSoft,
          border: `1px solid ${colors.statePrep}`,
          color: colors.statePrep, fontSize: type.xs, fontWeight: 600,
        }}>
          La tarifa del restaurante cambió mientras decidías. Esta es la nueva — revísala antes de confirmar.
        </div>
      )}

      <div style={{
        padding: '12px 14px', borderRadius: 10,
        background: colors.surface2, border: `1px solid ${colors.border}`,
        marginBottom: 14,
      }}>
        <div style={{ fontSize: type.xxs, fontWeight: 700, color: colors.textMute, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 8 }}>
          Tarifa propuesta
        </div>
        {tarifaMostrada ? (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {tarifaCampos(tarifaMostrada).map(c => (
              <div key={c.campo}>
                <div style={{ fontSize: type.xxs, color: colors.textMute }}>{
                  {
                    tarifa_base: 'Tarifa base',
                    tarifa_radio_base_km: 'Radio incluido',
                    tarifa_precio_km: 'Precio km extra',
                    tarifa_maxima: 'Tarifa máxima',
                  }[c.campo]
                }</div>
                <div style={{ fontSize: type.base, fontWeight: 700, color: colors.text }}>
                  {c.fmt(c.valor)}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ fontSize: type.sm, color: colors.textDim }}>
            El restaurante no tiene tarifa propia. Se aplicará la <b>tarifa por defecto</b> de la plataforma.
          </div>
        )}
      </div>

      <label style={{
        display: 'flex', gap: 10, alignItems: 'flex-start', cursor: 'pointer',
        fontSize: type.sm, color: colors.text, marginBottom: 6,
      }}>
        <input
          type="checkbox" checked={state.acepta}
          onChange={(e) => onAcepta(e.target.checked)}
          style={{ marginTop: 3, accentColor: colors.primary }}
        />
        <span>
          Acepto la tarifa propuesta y entiendo que el restaurante puede proponerme cambios futuros que tendré que aceptar o rechazar.
        </span>
      </label>

      {state.error && (
        <div style={{
          marginTop: 10, padding: '8px 10px', borderRadius: 6,
          background: colors.dangerSoft, color: colors.danger,
          fontSize: type.xs, fontWeight: 600,
        }}>{state.error}</div>
      )}

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
        <button onClick={onClose} style={ds.secondaryBtn} disabled={state.loading}>Cancelar</button>
        <button
          onClick={onConfirm}
          disabled={!state.acepta || state.loading}
          style={{ ...ds.primaryBtn, opacity: (!state.acepta || state.loading) ? 0.5 : 1 }}
        >
          {state.loading ? 'Enviando…' : 'Confirmar solicitud'}
        </button>
      </div>
    </ModalShell>
  )
}

function ModalRechazar({ state, loading, onChange, onConfirm, onClose }) {
  return (
    <ModalShell onClose={onClose}>
      <h2 style={{ ...ds.h2, marginBottom: 6 }}>Rechazar nueva tarifa</h2>
      <div style={{ fontSize: type.sm, color: colors.textMute, marginBottom: 12 }}>
        Vas a rechazar la propuesta de <b style={{ color: colors.text }}>{state.vinc.establecimiento?.nombre}</b>. La tarifa actual seguirá vigente. Puedes añadir un motivo (opcional).
      </div>
      <textarea
        value={state.motivo}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Motivo del rechazo (opcional)…"
        rows={3}
        style={{
          ...ds.input,
          height: 'auto', padding: '10px 12px',
          fontFamily: 'inherit', resize: 'vertical', marginBottom: 12,
        }}
      />
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button onClick={onClose} style={ds.secondaryBtn} disabled={loading}>Cancelar</button>
        <button onClick={onConfirm} disabled={loading} style={ds.dangerBtn}>
          {loading ? 'Procesando…' : 'Rechazar propuesta'}
        </button>
      </div>
    </ModalShell>
  )
}

function ModalShell({ children, onClose }) {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(15,15,15,0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: colors.surface, borderRadius: 14,
          maxWidth: 520, width: '100%',
          maxHeight: '90vh', overflowY: 'auto',
          boxShadow: colors.shadowLg, padding: 22,
        }}
      >
        {children}
      </div>
    </div>
  )
}
