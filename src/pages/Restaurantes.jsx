import { useEffect, useMemo, useState } from 'react'
import { useSocio } from '../context/SocioContext'
import { supabase, FUNCTIONS_URL } from '../lib/supabase'
import { colors, ds, type, stateBadge } from '../lib/uiStyles'
import {
  formatTarifa, tarifaCampos, compararTarifas,
  formatCuentaAtras, formatFechaCorta,
} from '../lib/tarifas'

const ESTADOS_PENDIENTES = ['pendiente', 'solicitada']

// Paleta circular para iniciales de restaurantes sin logo
const TONOS = [colors.terracotta, '#5A8C7A', '#8B6126', '#4A6480', colors.danger]
function colorPara(seed) {
  if (!seed) return TONOS[0]
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return TONOS[h % TONOS.length]
}
function iniciales(nombre) {
  if (!nombre) return '?'
  return nombre.split(' ').slice(0, 2).map(w => w[0] || '').join('').toUpperCase().slice(0, 2)
}

export default function Restaurantes({ onOpenRestaurante }) {
  const { socio } = useSocio()
  const [tab, setTab] = useState('vinculados')
  const [vinculados, setVinculados] = useState([])
  const [buscador, setBuscador] = useState([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [enviando, setEnviando] = useState(null)

  const [modalSolicitar, setModalSolicitar] = useState(null)
  const [modalRechazar, setModalRechazar] = useState(null)
  const [respondiendo, setRespondiendo] = useState(null)
  const [modalProponer, setModalProponer] = useState(null)
  const [proponiendo, setProponiendo] = useState(false)

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

  const proponerTarifa = async () => {
    if (!modalProponer) return
    const m = modalProponer
    setProponiendo(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const r = await fetch(`${FUNCTIONS_URL}/proponer-tarifa-socio`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session?.access_token}` },
        body: JSON.stringify({
          socio_establecimiento_id: m.vinc.id,
          tarifa_base: Number(m.tarifa_base),
          tarifa_radio_base_km: Number(m.tarifa_radio_base_km),
          tarifa_precio_km: Number(m.tarifa_precio_km),
          tarifa_maxima: m.tarifa_maxima === '' || m.tarifa_maxima == null ? null : Number(m.tarifa_maxima),
        }),
      })
      const data = await r.json().catch(() => ({}))
      if (!r.ok || !data?.ok) throw new Error(data?.error || `Error (${r.status})`)
      setModalProponer(null)
      await load()
    } catch (e) {
      setModalProponer(prev => prev ? ({ ...prev, error: e.message }) : null)
    } finally {
      setProponiendo(false)
    }
  }

  const filtrados = buscador.filter(r =>
    !query || r.nombre.toLowerCase().includes(query.toLowerCase())
  )

  const activos = vinculados.filter(v => v.estado === 'activa').length

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 18, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h1 style={ds.h1}>Restaurantes</h1>
          <p style={{ fontSize: type.sm, color: colors.textMute, marginTop: 4 }}>
            {activos} / {socio?.limite_restaurantes ?? 5} activos
          </p>
        </div>
      </div>

      {/* Pills tabs */}
      <PillTabs
        tabs={[
          { id: 'vinculados', l: 'Mis vinculados', count: vinculados.length },
          { id: 'propuestas', l: 'Propuestas', count: propuestas.length, warn: propuestas.length > 0 },
          { id: 'buscar', l: 'Buscar' },
        ]}
        value={tab}
        onChange={setTab}
      />

      {loading ? (
        <div style={{ color: colors.textMute, fontSize: type.sm, padding: 22 }}>Cargando…</div>
      ) : tab === 'vinculados' ? (
        renderVinculados({ vinculados, onOpenRestaurante, setTab, onProponer: (vinc) => setModalProponer({ vinc, tarifa_base: vinc.tarifa_base ?? '', tarifa_radio_base_km: vinc.tarifa_radio_base_km ?? '', tarifa_precio_km: vinc.tarifa_precio_km ?? '', tarifa_maxima: vinc.tarifa_maxima ?? '', error: null }) })
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
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(280px,1fr))', gap: 14 }}>
            {filtrados.map(r => {
              const tone = colorPara(r.id || r.nombre)
              return (
                <div key={r.id} style={{ ...ds.card, padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                    {r.logo_url ? (
                      <div style={{
                        width: 52, height: 52, borderRadius: 12, flexShrink: 0,
                        background: `url(${r.logo_url}) center/cover`,
                        border: `1.5px solid ${tone}`,
                      }} />
                    ) : (
                      <div style={{
                        width: 52, height: 52, borderRadius: 12, flexShrink: 0,
                        background: tone + '22', border: `1.5px solid ${tone}`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        color: tone, fontWeight: 800, fontSize: 15,
                      }}>{iniciales(r.nombre)}</div>
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontSize: 15, fontWeight: 700, color: colors.text,
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      }}>{r.nombre}</div>
                      <div style={{
                        fontSize: 11, color: colors.textFaint, marginTop: 2,
                        fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase',
                      }}>{r.tipo || 'Restaurante'}</div>
                    </div>
                  </div>
                  <button onClick={() => abrirSolicitar(r)} disabled={enviando === r.id}
                    style={{ ...ds.primaryBtn, width: '100%', opacity: enviando === r.id ? 0.6 : 1 }}>
                    {enviando === r.id ? 'Cargando…' : 'Solicitar vinculación'}
                  </button>
                </div>
              )
            })}
            {filtrados.length === 0 && (
              <div style={{ ...ds.card, gridColumn: '1/-1', textAlign: 'center', color: colors.textMute, padding: 28 }}>
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

      {modalProponer && (
        <ModalProponer
          state={modalProponer}
          loading={proponiendo}
          onChange={(patch) => setModalProponer(m => ({ ...m, ...patch }))}
          onConfirm={proponerTarifa}
          onClose={() => setModalProponer(null)}
        />
      )}
    </div>
  )
}

// ───────────── Pills (tabs) ─────────────
function PillTabs({ tabs, value, onChange }) {
  return (
    <div style={{ display: 'flex', gap: 6, marginBottom: 22, flexWrap: 'wrap' }}>
      {tabs.map(t => {
        const active = value === t.id
        return (
          <button key={t.id} onClick={() => onChange(t.id)} style={{
            display: 'inline-flex', alignItems: 'center', gap: 7,
            padding: '8px 14px', borderRadius: 999,
            border: active ? `1px solid ${colors.ink}` : `1px solid ${colors.border}`,
            background: active ? colors.ink : colors.paper,
            color: active ? colors.cream : colors.textDim,
            fontSize: type.sm, fontWeight: 600, cursor: 'pointer',
            fontFamily: type.family, transition: 'background 0.15s',
          }}>
            {t.l}
            {typeof t.count === 'number' && t.count > 0 && (
              <span style={{
                minWidth: 20, height: 18, padding: '0 6px', borderRadius: 9,
                background: active ? colors.cream : (t.warn ? colors.warning : colors.surface2),
                color: active ? colors.ink : (t.warn ? '#fff' : colors.textDim),
                fontSize: 11, fontWeight: 800,
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              }}>{t.count}</span>
            )}
          </button>
        )
      })}
    </div>
  )
}

function renderVinculados({ vinculados, onOpenRestaurante, setTab, onProponer }) {
  if (vinculados.length === 0) {
    return (
      <div style={{ ...ds.card, textAlign: 'center', padding: 30 }}>
        <div style={{ fontSize: type.base, fontWeight: 700, marginBottom: 6 }}>Aún no tienes restaurantes</div>
        <div style={{ fontSize: type.sm, color: colors.textMute, marginBottom: 14 }}>
          Busca y solicita vinculación con los que quieras repartir.
        </div>
        <button onClick={() => setTab('buscar')} style={ds.primaryBtn}>Buscar restaurantes</button>
      </div>
    )
  }
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(290px,1fr))', gap: 14 }}>
      {vinculados.map(v => {
        const e = v.establecimiento || {}
        const badge = stateBadge(v.estado)
        // Cualquier vinculado con establecimiento válido abre su detalle financiero.
        const clickable = !!e.id
        const tienePropuesta = !!v.tarifa_pendiente && Object.keys(v.tarifa_pendiente).length > 0
        const cuenta = tienePropuesta ? formatCuentaAtras(v.tarifa_pendiente_expira_en) : null
        const tone = colorPara(e.id || e.nombre)
        return (
          <div
            key={v.id}
            onClick={() => { if (clickable && onOpenRestaurante) onOpenRestaurante(e.id) }}
            style={{
              ...ds.card, padding: 18,
              display: 'flex', flexDirection: 'column', gap: 12,
              cursor: clickable ? 'pointer' : 'default',
              transition: 'transform 0.15s, box-shadow 0.15s',
              borderColor: tienePropuesta ? colors.terracotta : colors.border,
            }}
            onMouseEnter={(ev) => { if (clickable) { ev.currentTarget.style.transform = 'translateY(-2px)'; ev.currentTarget.style.boxShadow = colors.shadowLg } }}
            onMouseLeave={(ev) => { ev.currentTarget.style.transform = 'translateY(0)'; ev.currentTarget.style.boxShadow = '' }}
          >
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              {e.logo_url ? (
                <div style={{
                  width: 52, height: 52, borderRadius: 12, flexShrink: 0,
                  background: `url(${e.logo_url}) center/cover`,
                  border: `1.5px solid ${tone}`,
                }} />
              ) : (
                <div style={{
                  width: 52, height: 52, borderRadius: 12, flexShrink: 0,
                  background: tone + '22', border: `1.5px solid ${tone}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: tone, fontWeight: 800, fontSize: 15,
                }}>{iniciales(e.nombre)}</div>
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: 15, fontWeight: 700, color: colors.text,
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}>{e.nombre || '—'}</div>
                <div style={{
                  fontSize: 11, color: colors.textFaint, marginTop: 2,
                  fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase',
                }}>{e.tipo || 'Restaurante'}</div>
              </div>
            </div>
            <div style={{
              background: colors.surface2, borderRadius: 10, padding: '10px 12px',
              fontSize: 12, color: colors.textMute, lineHeight: 1.5,
            }}>
              <div style={{
                fontWeight: 700, color: colors.text, fontSize: 11,
                letterSpacing: '0.04em', textTransform: 'uppercase', marginBottom: 4,
              }}>Tarifa</div>
              {formatTarifa(v.tarifa_base !== null ? {
                tarifa_base: v.tarifa_base,
                tarifa_radio_base_km: v.tarifa_radio_base_km,
                tarifa_precio_km: v.tarifa_precio_km,
                tarifa_maxima: v.tarifa_maxima,
              } : null)}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
              <div style={badge}>{badge._label}</div>
              {tienePropuesta && (
                <div style={{
                  fontSize: 10, fontWeight: 800, padding: '3px 8px', borderRadius: 999,
                  letterSpacing: '0.04em', textTransform: 'uppercase',
                  background: colors.warningSoft, color: colors.warning,
                  display: 'inline-flex', alignItems: 'center', gap: 5,
                }}>
                  <span style={{ width: 6, height: 6, borderRadius: 3, background: colors.warning }}/>
                  Nueva propuesta{cuenta && !cuenta.expirada ? ` · ${formatFechaCorta(v.tarifa_pendiente_expira_en)}` : ''}
                </div>
              )}
            </div>
            {v.estado === 'activa' && (
              <button
                onClick={(ev) => { ev.stopPropagation(); onProponer && onProponer(v) }}
                style={{ ...ds.secondaryBtn, width: '100%' }}
              >Proponer tarifa</button>
            )}
            {clickable && (
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                fontSize: 11, fontWeight: 700, color: colors.terracotta,
                letterSpacing: '0.03em', textTransform: 'uppercase',
              }}>
                Ver detalle
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
              </div>
            )}
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
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
          <div key={v.id} style={{ ...ds.card, padding: 22 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
              <div>
                <div style={{ ...ds.h2, marginBottom: 0 }}>{e.nombre || '—'}</div>
                <div style={{ fontSize: type.xs, color: colors.textMute, marginTop: 4 }}>
                  {v.tarifa_pendiente_origen === 'socio'
                    ? 'Tu propuesta · esperando al restaurante'
                    : 'Propuesta del restaurante'}
                  {' · '}
                  {formatFechaCorta(v.tarifa_pendiente_at)}
                </div>
              </div>
              {cuenta && (
                <div style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  fontSize: 11, fontWeight: 700, padding: '5px 12px', borderRadius: 999,
                  background: cuenta.urgente ? colors.dangerSoft : colors.warningSoft,
                  color: cuenta.urgente ? colors.danger : colors.warning,
                }}>
                  <span style={{ width: 6, height: 6, borderRadius: 3, background: cuenta.urgente ? colors.danger : colors.warning }}/>
                  {cuenta.expirada ? 'Caducada' : `Expira ${cuenta.label}`}
                </div>
              )}
            </div>

            <TablaComparativa filas={filas} actual={actual} propuesta={propuesta} />

            {v.tarifa_pendiente_origen === 'socio' ? (
              <div style={{ marginTop: 16, fontSize: type.sm, color: colors.textMute, textAlign: 'right' }}>
                Esperando a que el restaurante acepte o rechace tu propuesta.
              </div>
            ) : (
              <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                <button
                  onClick={() => onRechazar(v)}
                  disabled={respondiendo === v.id || cuenta?.expirada}
                  style={{ ...ds.dangerBtn, opacity: (respondiendo === v.id || cuenta?.expirada) ? 0.6 : 1 }}
                >Rechazar</button>
                <button
                  onClick={() => onAceptar(v)}
                  disabled={respondiendo === v.id || cuenta?.expirada}
                  style={{ ...ds.glossyBtn, opacity: (respondiendo === v.id || cuenta?.expirada) ? 0.6 : 1 }}
                >{respondiendo === v.id ? 'Procesando…' : 'Aceptar nueva tarifa'}</button>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function TablaComparativa({ filas, actual, propuesta }) {
  return (
    <div style={{
      borderRadius: 12, border: `1px solid ${colors.border}`, overflow: 'hidden',
    }}>
      <div style={{
        display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr',
        background: colors.surface2,
        padding: '10px 14px',
        fontSize: 11, fontWeight: 700, color: colors.textMute,
        letterSpacing: '0.04em', textTransform: 'uppercase',
      }}>
        <span>Concepto</span><span>Actual</span><span>Propuesta</span>
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
        const bg = !cambia ? colors.paper : (mejor ? colors.sageSoft : colors.dangerSoft)
        const txtColor = !cambia ? colors.text : (mejor ? colors.sage2 : colors.danger)
        return (
          <div key={row.campo} style={{
            display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr',
            padding: '12px 14px',
            borderTop: i === 0 ? 'none' : `1px solid ${colors.border}`,
            fontSize: type.sm, background: bg,
          }}>
            <span style={{ color: colors.textMute, fontWeight: 600 }}>{labelMap[row.campo]}</span>
            <span style={{ color: colors.textDim }}>{fmt(actual?.[row.campo])}</span>
            <span style={{ color: txtColor, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              {cambia && (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  {mejor
                    ? <><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></>
                    : <><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></>}
                </svg>
              )}
              {fmt(propuesta?.[row.campo])}
            </span>
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
      <div style={{ fontSize: type.sm, color: colors.textMute, marginBottom: 16 }}>
        Vas a solicitar la vinculación con <b style={{ color: colors.text }}>{e.nombre}</b>. Revisa la tarifa que cobrarás por cada pedido entregado.
      </div>

      {state.tarifaActualizada && (
        <div style={{
          padding: '10px 12px', borderRadius: 10, marginBottom: 12,
          background: colors.warningSoft, color: colors.warning,
          fontSize: type.xs, fontWeight: 600,
        }}>
          La tarifa del restaurante cambió mientras decidías. Esta es la nueva — revísala antes de confirmar.
        </div>
      )}

      <div style={{
        padding: '14px 16px', borderRadius: 12,
        background: colors.surface2, border: `1px solid ${colors.border}`,
        marginBottom: 16,
      }}>
        <div style={{
          fontSize: 11, fontWeight: 700, color: colors.textMute,
          letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 8,
        }}>
          Tarifa propuesta
        </div>
        {tarifaMostrada ? (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {tarifaCampos(tarifaMostrada).map(c => (
              <div key={c.campo}>
                <div style={{ fontSize: 11, color: colors.textMute, fontWeight: 600 }}>{
                  {
                    tarifa_base: 'Tarifa base',
                    tarifa_radio_base_km: 'Radio incluido',
                    tarifa_precio_km: 'Precio km extra',
                    tarifa_maxima: 'Tarifa máxima',
                  }[c.campo]
                }</div>
                <div style={{
                  fontSize: 17, fontWeight: 800, color: colors.text,
                  fontVariantNumeric: 'tabular-nums', marginTop: 2,
                }}>
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
          style={{ marginTop: 3, accentColor: colors.terracotta }}
        />
        <span>
          Acepto la tarifa propuesta y entiendo que el restaurante puede proponerme cambios futuros que tendré que aceptar o rechazar.
        </span>
      </label>

      {state.error && (
        <div style={{
          marginTop: 10, padding: '8px 10px', borderRadius: 8,
          background: colors.dangerSoft, color: colors.danger,
          fontSize: type.xs, fontWeight: 600,
        }}>{state.error}</div>
      )}

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 18 }}>
        <button onClick={onClose} style={ds.secondaryBtn} disabled={state.loading}>Cancelar</button>
        <button
          onClick={onConfirm}
          disabled={!state.acepta || state.loading}
          style={{ ...ds.glossyBtn, opacity: (!state.acepta || state.loading) ? 0.5 : 1 }}
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
      <div style={{ fontSize: type.sm, color: colors.textMute, marginBottom: 14 }}>
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

function ModalProponer({ state, loading, onChange, onConfirm, onClose }) {
  const campos = [
    { k: 'tarifa_base', l: 'Tarifa base (€)', req: true },
    { k: 'tarifa_radio_base_km', l: 'Radio incluido (km)', req: true },
    { k: 'tarifa_precio_km', l: 'Precio km extra (€)', req: true },
    { k: 'tarifa_maxima', l: 'Tarifa máxima (€)', req: false },
  ]
  const completo = state.tarifa_base !== '' && state.tarifa_radio_base_km !== '' && state.tarifa_precio_km !== ''
  return (
    <ModalShell onClose={onClose}>
      <h2 style={{ ...ds.h2, marginBottom: 6 }}>Proponer tarifa</h2>
      <div style={{ fontSize: type.sm, color: colors.textMute, marginBottom: 16 }}>
        Propones a <b style={{ color: colors.text }}>{state.vinc.establecimiento?.nombre}</b> la tarifa de reparto que cobrarás por pedido. El restaurante tiene 7 días para aceptarla o rechazarla.
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
        {campos.map(c => (
          <div key={c.k}>
            <label style={{ fontSize: 11, color: colors.textMute, fontWeight: 600, display: 'block', marginBottom: 4 }}>{c.l}</label>
            <input
              type="number" step="0.01" min="0"
              value={state[c.k] ?? ''}
              onChange={(e) => onChange({ [c.k]: e.target.value })}
              placeholder={c.req ? 'Obligatorio' : 'Opcional'}
              style={ds.input}
            />
          </div>
        ))}
      </div>
      {state.error && (
        <div style={{ marginBottom: 12, padding: '8px 10px', borderRadius: 8, background: colors.dangerSoft, color: colors.danger, fontSize: type.xs, fontWeight: 600 }}>{state.error}</div>
      )}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button onClick={onClose} style={ds.secondaryBtn} disabled={loading}>Cancelar</button>
        <button onClick={onConfirm} disabled={!completo || loading} style={{ ...ds.glossyBtn, opacity: (!completo || loading) ? 0.5 : 1 }}>
          {loading ? 'Enviando…' : 'Enviar propuesta'}
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
        background: 'rgba(26,24,21,0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: colors.paper, borderRadius: 16,
          maxWidth: 560, width: '100%',
          maxHeight: '90vh', overflowY: 'auto',
          boxShadow: colors.shadowLg, padding: 24,
          border: `1px solid ${colors.border}`,
        }}
      >
        {children}
      </div>
    </div>
  )
}
