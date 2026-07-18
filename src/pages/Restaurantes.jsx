import { useEffect, useMemo, useState } from 'react'
import { useSocio } from '../context/SocioContext'
import { supabase, FUNCTIONS_URL } from '../lib/supabase'
import { colors, ds, type, stateBadge } from '../lib/uiStyles'
import {
  formatTarifa, tarifaCampos, compararTarifas, fmtPct,
  formatCuentaAtras, formatFechaCorta,
} from '../lib/tarifas'
import AddressAutocomplete from '../components/AddressAutocomplete'

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

function nuevoAltaState() {
  return { nombre: '', email: '', telefono: '', direccion: '', latitud: null, longitud: null, loading: false, error: null, success: null }
}

// Badge extra para restaurantes que el socio dio de alta (es_captador) y aún están
// pasando las dos puertas: confirmación del restaurante + verificación del super-admin.
function altaEstadoBadge(v) {
  if (!v?.es_captador) return null
  const e = v.establecimiento || {}
  if (e.alta_confirmada_at == null) {
    return { label: 'Pendiente confirmación', bg: colors.warningSoft, color: colors.warning }
  }
  if (e.estado === 'pendiente_verificacion') {
    return { label: 'Pendiente verificación', bg: colors.infoSoft, color: colors.info }
  }
  return null
}

export default function Restaurantes({ onOpenRestaurante }) {
  const { socio } = useSocio()
  const [tab, setTab] = useState('vinculados')
  const [vinculados, setVinculados] = useState([])
  const [buscador, setBuscador] = useState([])
  const [query, setQuery] = useState('')
  const [categoria, setCategoria] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [enviando, setEnviando] = useState(null)

  const [modalSolicitar, setModalSolicitar] = useState(null)
  const [modalRechazar, setModalRechazar] = useState(null)
  const [respondiendo, setRespondiendo] = useState(null)
  const [modalProponer, setModalProponer] = useState(null)
  const [proponiendo, setProponiendo] = useState(false)
  const [modalAlta, setModalAlta] = useState(null)

  const [, setTick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setTick(x => x + 1), 60000)
    return () => clearInterval(t)
  }, [])

  const load = async () => {
    if (!socio?.id) return
    const cacheKey = `pidoo_socio_vinc_${socio.id}`
    // Pintar AL INSTANTE los vinculados de la última vez (caché local): la consulta
    // en el servidor tarda ~33ms, pero la cadena de arranque (sesión -> socio -> query)
    // son 2-3 viajes en serie en red móvil (~1-2s). Con caché, la lista aparece ya y
    // se refresca en segundo plano en vez de mostrar "Cargando…" en blanco.
    let teniaCache = false
    try {
      const cached = localStorage.getItem(cacheKey)
      if (cached) {
        const arr = JSON.parse(cached)
        if (Array.isArray(arr) && arr.length) { setVinculados(arr); teniaCache = true }
      }
    } catch (_) {}
    if (!teniaCache) setLoading(true)
    setError(false)
    try {
      const queries = Promise.all([
        supabase.from('socio_establecimiento')
          .select(`
            id, estado, es_captador, solicitado_at, aceptado_at,
            tarifa_modo, tarifa_fija, tarifa_base, tarifa_radio_base_km, tarifa_precio_km, tarifa_maxima, comision_pct,
            tarifa_aceptada_en, tarifa_pendiente, tarifa_pendiente_at,
            tarifa_pendiente_origen, tarifa_pendiente_expira_en,
            establecimiento:establecimientos(id, nombre, logo_url, slug, tipo, rating, activo, estado, alta_confirmada_at)
          `)
          .eq('socio_id', socio.id)
          .order('solicitado_at', { ascending: false }),
        supabase.from('establecimientos')
          .select('id, nombre, logo_url, slug, tipo, rating, activo, estado')
          .eq('activo', true)
          .limit(100),
      ])
      // Timeout 12s: en red lenta la consulta puede colgarse sin dar error.
      const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 12000))
      const [vinc, rest] = await Promise.race([queries, timeout])
      const vincData = vinc.data || []
      setVinculados(vincData)
      try { localStorage.setItem(cacheKey, JSON.stringify(vincData)) } catch (_) {}
      const vinculadosIds = new Set(vincData.map(v => v.establecimiento?.id))
      setBuscador((rest.data || []).filter(r => !vinculadosIds.has(r.id)))
    } catch (e) { console.error(e); if (!teniaCache) setError(true) }
    setLoading(false)
  }

  // Depender solo de socio?.id (no del objeto socio entero): así load() se dispara
  // al entrar / cambiar de socio, y NO en cada refresco del contexto (auth, realtime,
  // heartbeat…) que recreaba el objeto socio y recargaba la lista de más (parpadeo).
  useEffect(() => { load() }, [socio?.id])

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
        // Tarifa que PROPONE el socio (18-jul-2026). Se siembra con la del restaurante
        // como punto de partida razonable; el socio puede cambiarla antes de enviar.
        tarifa_modo: 'distancia',
        tarifa_fija: '',
        tarifa_base: data?.tarifa_base ?? '',
        tarifa_radio_base_km: data?.tarifa_radio_base_km ?? '',
        tarifa_precio_km: data?.tarifa_precio_km ?? '',
        tarifa_maxima: data?.tarifa_maxima ?? '',
        comision_pct: 10,
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
        // 18-jul-2026: el socio propone SU tarifa al solicitar, para que el restaurante
        // sepa cuánto cobra ANTES de aceptar la vinculación (solicitar-vinculacion v8).
        body: JSON.stringify(
          modalSolicitar.tarifa_modo === 'fija'
            ? {
                establecimiento_id: modalSolicitar.establecimiento.id,
                tarifa_modo: 'fija',
                tarifa_fija: Number(modalSolicitar.tarifa_fija),
                comision_pct: modalSolicitar.comision_pct === '' || modalSolicitar.comision_pct == null ? 10 : Number(modalSolicitar.comision_pct),
              }
            : {
                establecimiento_id: modalSolicitar.establecimiento.id,
                tarifa_modo: 'distancia',
                tarifa_base: Number(modalSolicitar.tarifa_base),
                tarifa_radio_base_km: Number(modalSolicitar.tarifa_radio_base_km),
                tarifa_precio_km: Number(modalSolicitar.tarifa_precio_km),
                tarifa_maxima: modalSolicitar.tarifa_maxima === '' || modalSolicitar.tarifa_maxima == null ? null : Number(modalSolicitar.tarifa_maxima),
                comision_pct: modalSolicitar.comision_pct === '' || modalSolicitar.comision_pct == null ? 10 : Number(modalSolicitar.comision_pct),
                tarifa_snapshot: tarifaSnapshot || null,
              }
        ),
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
        // 18-jul-2026: el pacto lleva modalidad. En 'fija' solo viaja el importe por
        // entrega; en 'distancia' los 4 campos de siempre (proponer-tarifa-socio v7).
        body: JSON.stringify(
          m.tarifa_modo === 'fija'
            ? {
                socio_establecimiento_id: m.vinc.id,
                tarifa_modo: 'fija',
                tarifa_fija: Number(m.tarifa_fija),
                comision_pct: m.comision_pct === '' || m.comision_pct == null ? 10 : Number(m.comision_pct),
              }
            : {
                socio_establecimiento_id: m.vinc.id,
                tarifa_modo: 'distancia',
                tarifa_base: Number(m.tarifa_base),
                tarifa_radio_base_km: Number(m.tarifa_radio_base_km),
                tarifa_precio_km: Number(m.tarifa_precio_km),
                tarifa_maxima: m.tarifa_maxima === '' || m.tarifa_maxima == null ? null : Number(m.tarifa_maxima),
                comision_pct: m.comision_pct === '' || m.comision_pct == null ? 10 : Number(m.comision_pct),
              }
        ),
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

  const crearRestaurante = async () => {
    if (!modalAlta) return
    const m = modalAlta
    setModalAlta(s => ({ ...s, loading: true, error: null }))
    const payload = {
      nombre: m.nombre.trim(),
      email: m.email.trim(),
      telefono: m.telefono.trim() || null,
      direccion: m.direccion.trim(),
      latitud: m.latitud,
      longitud: m.longitud,
    }
    // Reintento automático en fallos transitorios (red / 5xx / arranque en frío de la
    // edge). Es seguro porque socio-crear-restaurante v2 es idempotente: un reintento
    // sobre un alta ya creada devuelve ok (ya_existia). Los errores 4xx (validación,
    // límite, email en uso) son deterministas → se muestran sin reintentar.
    const MAX = 3
    let ultimoError = null
    for (let intento = 1; intento <= MAX; intento++) {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        const r = await fetch(`${FUNCTIONS_URL}/socio-crear-restaurante`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session?.access_token}` },
          body: JSON.stringify(payload),
        })
        const data = await r.json().catch(() => ({}))
        if (r.ok && data?.ok) {
          setModalAlta(s => s ? ({ ...s, loading: false, success: { email: m.email.trim(), email_enviado: !!data.email_enviado } }) : null)
          await load()
          return
        }
        if (r.status >= 400 && r.status < 500) {
          // Error determinista: no reintentar
          setModalAlta(s => s ? ({ ...s, loading: false, error: data?.message || data?.error || `Error (${r.status})` }) : null)
          return
        }
        ultimoError = new Error(data?.message || data?.error || `Error (${r.status})`)
      } catch (e) {
        ultimoError = e // error de red → reintentar
      }
      if (intento < MAX) await new Promise(res => setTimeout(res, 700 * intento))
    }
    setModalAlta(s => s ? ({ ...s, loading: false, error: ultimoError?.message || 'No se pudo crear el restaurante. Inténtalo de nuevo.' }) : null)
  }

  // Categorías disponibles (derivadas del tipo de los restaurantes buscables).
  const categorias = useMemo(
    () => [...new Set(buscador.map(r => r.tipo).filter(Boolean))].sort(),
    [buscador]
  )

  const filtrados = buscador.filter(r =>
    (!query || r.nombre.toLowerCase().includes(query.toLowerCase())) &&
    (!categoria || r.tipo === categoria)
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
        <button onClick={() => setModalAlta(nuevoAltaState())} style={ds.glossyBtn}>
          + Dar de alta restaurante
        </button>
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
      ) : error ? (
        <div style={{ textAlign: 'center', padding: 30 }}>
          <div style={{ fontSize: type.base, fontWeight: 700, color: colors.text, marginBottom: 6 }}>No se pudo cargar</div>
          <div style={{ fontSize: type.sm, color: colors.textMute, marginBottom: 14 }}>Revisa tu conexión e inténtalo de nuevo.</div>
          <button onClick={load} style={ds.primaryBtn}>Reintentar</button>
        </div>
      ) : tab === 'vinculados' ? (
        renderVinculados({ vinculados, onOpenRestaurante, setTab, onAlta: () => setModalAlta(nuevoAltaState()), onProponer: (vinc) => setModalProponer({ vinc, tarifa_modo: vinc.tarifa_modo === 'fija' ? 'fija' : 'distancia', tarifa_fija: vinc.tarifa_fija ?? '', tarifa_base: vinc.tarifa_base ?? '', tarifa_radio_base_km: vinc.tarifa_radio_base_km ?? '', tarifa_precio_km: vinc.tarifa_precio_km ?? '', tarifa_maxima: vinc.tarifa_maxima ?? '', comision_pct: vinc.comision_pct ?? 10, error: null }) })
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
            style={{ ...ds.input, marginBottom: categorias.length > 0 ? 12 : 14 }}
          />
          {categorias.length > 0 && (
            <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: colors.textMute, letterSpacing: '0.04em', textTransform: 'uppercase', marginRight: 2 }}>Categorías</span>
              <CategoriaChip label="Todas" active={!categoria} onClick={() => setCategoria('')} />
              {categorias.map(c => (
                <CategoriaChip key={c} label={c} active={categoria === c}
                  onClick={() => setCategoria(categoria === c ? '' : c)} />
              ))}
            </div>
          )}
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
          onAcepta={(cambios) => setModalSolicitar(m => ({ ...m, ...cambios }))}
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

      {modalAlta && (
        <ModalAlta
          state={modalAlta}
          onChange={(patch) => setModalAlta(m => m ? ({ ...m, ...patch }) : null)}
          onConfirm={crearRestaurante}
          onClose={() => { const exito = !!modalAlta.success; setModalAlta(null); if (exito) setTab('vinculados') }}
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

// ───────────── Chip de categoría (filtro del buscador) ─────────────
function CategoriaChip({ label, active, onClick }) {
  return (
    <button onClick={onClick} style={{
      padding: '6px 12px', borderRadius: 999,
      border: active ? `1px solid ${colors.terracotta}` : `1px solid ${colors.border}`,
      background: active ? colors.terracotta : colors.paper,
      color: active ? '#fff' : colors.textDim,
      fontSize: type.xs, fontWeight: 700, cursor: 'pointer',
      fontFamily: type.family, textTransform: 'capitalize', transition: 'background 0.15s',
    }}>{label}</button>
  )
}

function renderVinculados({ vinculados, onOpenRestaurante, setTab, onProponer, onAlta }) {
  if (vinculados.length === 0) {
    return (
      <div style={{ ...ds.card, textAlign: 'center', padding: 30 }}>
        <div style={{ fontSize: type.base, fontWeight: 700, marginBottom: 6 }}>Aún no tienes restaurantes</div>
        <div style={{ fontSize: type.sm, color: colors.textMute, marginBottom: 14 }}>
          Da de alta tu propio restaurante, o busca y solicita vinculación con los que quieras repartir.
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
          <button onClick={onAlta} style={ds.glossyBtn}>+ Dar de alta restaurante</button>
          <button onClick={() => setTab('buscar')} style={ds.secondaryBtn}>Buscar restaurantes</button>
        </div>
      </div>
    )
  }
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(290px,1fr))', gap: 14 }}>
      {vinculados.map(v => {
        const e = v.establecimiento || {}
        const badge = stateBadge(v.estado)
        const altaBadge = altaEstadoBadge(v)
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
                comision_pct: v.comision_pct,
              } : null)}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <div style={badge}>{badge._label}</div>
                {altaBadge && (
                  <span style={{
                    fontSize: 10, fontWeight: 800, padding: '3px 8px', borderRadius: 6,
                    letterSpacing: '0.04em', textTransform: 'uppercase',
                    background: altaBadge.bg, color: altaBadge.color,
                  }}>{altaBadge.label}</span>
                )}
              </div>
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
          comision_pct: v.comision_pct,
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
      {[...tarifaCampos(actual), { campo: 'comision_pct', label: 'Comisión', valor: actual?.comision_pct, fmt: fmtPct }].map((row, i) => {
        const fila = filas.find(f => f.campo === row.campo)
        const labelMap = {
          tarifa_base: 'Tarifa base',
          tarifa_radio_base_km: 'Radio incluido',
          tarifa_precio_km: 'Precio km extra',
          tarifa_maxima: 'Tarifa máxima',
          comision_pct: 'Comisión',
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
  // Para enviar hace falta la tarifa completa + la confirmación explícita.
  const comisionOk = state.comision_pct !== '' && state.comision_pct != null
  const tarifaOk = state.tarifa_modo === 'fija'
    ? (state.tarifa_fija !== '' && state.tarifa_fija != null && comisionOk)
    : (state.tarifa_base !== '' && state.tarifa_radio_base_km !== '' && state.tarifa_precio_km !== '' && comisionOk)
  const puedeEnviar = tarifaOk && state.acepta
  return (
    <ModalShell onClose={onClose}>
      <h2 style={{ ...ds.h2, marginBottom: 6 }}>Solicitar vinculación</h2>
      <div style={{ fontSize: type.sm, color: colors.textMute, marginBottom: 14 }}>
        Vas a solicitar la vinculación con <b style={{ color: colors.text }}>{e.nombre}</b>. Indica <b style={{ color: colors.text }}>cuánto cobras por entrega</b>: el restaurante lo verá antes de aceptarte.
      </div>

      {tarifaMostrada && (
        <div style={{
          padding: '10px 12px', borderRadius: 10, marginBottom: 12,
          background: colors.surface2, border: `1px solid ${colors.border}`,
          fontSize: type.xs, color: colors.textMute, lineHeight: 1.5,
        }}>
          Referencia · tarifa actual del restaurante: <b style={{ color: colors.text }}>{formatTarifa(tarifaMostrada)}</b>
        </div>
      )}

      {/* Modalidad de la tarifa que propone el socio */}
      <label style={{ fontSize: 11, color: colors.textMute, fontWeight: 600, display: 'block', marginBottom: 6 }}>
        ¿Cómo cobras?
      </label>
      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        {[
          { v: 'fija', t: 'Precio fijo', d: 'Lo mismo por cada entrega.' },
          { v: 'distancia', t: 'Por distancia', d: 'Base + coste por km extra.' },
        ].map(o => {
          const activo = (state.tarifa_modo === 'fija' ? 'fija' : 'distancia') === o.v
          return (
            <button
              key={o.v}
              type="button"
              onClick={() => onAcepta({ tarifa_modo: o.v })}
              style={{
                flex: 1, textAlign: 'left', cursor: 'pointer',
                padding: '10px 12px', borderRadius: 10,
                border: `1.5px solid ${activo ? colors.primary : colors.border}`,
                background: activo ? (colors.primarySoft || colors.surface2) : colors.surface,
                fontFamily: 'inherit',
              }}
            >
              <div style={{ fontSize: type.sm, fontWeight: 700, color: activo ? colors.primary : colors.text }}>{o.t}</div>
              <div style={{ fontSize: type.xs, color: colors.textMute, marginTop: 2 }}>{o.d}</div>
            </button>
          )
        })}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
        {(state.tarifa_modo === 'fija'
          ? [{ k: 'tarifa_fija', l: 'Precio por entrega (€)' }, { k: 'comision_pct', l: 'Comisión (%)' }]
          : [
              { k: 'tarifa_base', l: 'Tarifa base (€)' },
              { k: 'tarifa_radio_base_km', l: 'Radio incluido (km)' },
              { k: 'tarifa_precio_km', l: 'Precio km extra (€)' },
              { k: 'tarifa_maxima', l: 'Tarifa máxima (€)' },
              { k: 'comision_pct', l: 'Comisión (%)' },
            ]
        ).map(c => (
          <div key={c.k}>
            <label style={{ fontSize: 11, color: colors.textMute, fontWeight: 600, display: 'block', marginBottom: 4 }}>{c.l}</label>
            <input
              type="number" step={c.k === 'comision_pct' ? '0.5' : '0.01'} min="0"
              max={c.k === 'comision_pct' ? '100' : undefined}
              value={state[c.k] ?? ''}
              onChange={(ev) => onAcepta({ [c.k]: ev.target.value })}
              style={ds.input}
            />
          </div>
        ))}
      </div>

      <label style={{
        display: 'flex', gap: 10, alignItems: 'flex-start', cursor: 'pointer',
        fontSize: type.sm, color: colors.text, marginBottom: 6,
      }}>
        <input
          type="checkbox" checked={state.acepta}
          onChange={(ev) => onAcepta({ acepta: ev.target.checked })}
          style={{ marginTop: 3, accentColor: colors.terracotta }}
        />
        <span>
          Confirmo mi tarifa. El restaurante la verá al recibir la solicitud y podrá aceptarla o rechazarla.
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
          disabled={!puedeEnviar || state.loading}
          style={{ ...ds.glossyBtn, opacity: (!puedeEnviar || state.loading) ? 0.5 : 1 }}
        >
          {state.loading ? 'Enviando…' : 'Enviar solicitud y tarifa'}
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
  // 18-jul-2026: el pacto puede ser PRECIO FIJO por entrega o POR DISTANCIA.
  // Antes solo existía "por distancia" y no había forma de pactar (ni guardar) un fijo.
  const modo = state.tarifa_modo === 'fija' ? 'fija' : 'distancia'
  const campos = modo === 'fija'
    ? [
        { k: 'tarifa_fija', l: 'Precio por entrega (€)', req: true },
        { k: 'comision_pct', l: 'Comisión (%)', req: true },
      ]
    : [
        { k: 'tarifa_base', l: 'Tarifa base (€)', req: true },
        { k: 'tarifa_radio_base_km', l: 'Radio incluido (km)', req: true },
        { k: 'tarifa_precio_km', l: 'Precio km extra (€)', req: true },
        { k: 'tarifa_maxima', l: 'Tarifa máxima (€)', req: false },
        { k: 'comision_pct', l: 'Comisión (%)', req: true },
      ]
  const comisionOk = state.comision_pct !== '' && state.comision_pct != null
  const completo = modo === 'fija'
    ? (state.tarifa_fija !== '' && state.tarifa_fija != null && comisionOk)
    : (state.tarifa_base !== '' && state.tarifa_radio_base_km !== '' && state.tarifa_precio_km !== '' && comisionOk)

  const OpcionModo = ({ valor, titulo, desc }) => {
    const activo = modo === valor
    return (
      <button
        type="button"
        onClick={() => onChange({ tarifa_modo: valor })}
        style={{
          flex: 1, textAlign: 'left', cursor: 'pointer',
          padding: '10px 12px', borderRadius: 10,
          border: `1.5px solid ${activo ? colors.primary : colors.border}`,
          background: activo ? colors.primarySoft || colors.surface2 : colors.surface,
          fontFamily: 'inherit',
        }}
      >
        <div style={{ fontSize: type.sm, fontWeight: 700, color: activo ? colors.primary : colors.text }}>{titulo}</div>
        <div style={{ fontSize: type.xs, color: colors.textMute, marginTop: 2, lineHeight: 1.35 }}>{desc}</div>
      </button>
    )
  }

  return (
    <ModalShell onClose={onClose}>
      <h2 style={{ ...ds.h2, marginBottom: 6 }}>Proponer tarifa</h2>
      <div style={{ fontSize: type.sm, color: colors.textMute, marginBottom: 14 }}>
        Propones a <b style={{ color: colors.text }}>{state.vinc.establecimiento?.nombre}</b> la tarifa de reparto que cobrarás por pedido. El restaurante tiene 7 días para aceptarla o rechazarla.
      </div>

      <label style={{ fontSize: 11, color: colors.textMute, fontWeight: 600, display: 'block', marginBottom: 6 }}>
        Tipo de tarifa
      </label>
      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        <OpcionModo valor="fija" titulo="Precio fijo" desc="Lo mismo por cada entrega, sin importar la distancia." />
        <OpcionModo valor="distancia" titulo="Por distancia" desc="Base + coste por km fuera del radio incluido." />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
        {campos.map(c => (
          <div key={c.k}>
            <label style={{ fontSize: 11, color: colors.textMute, fontWeight: 600, display: 'block', marginBottom: 4 }}>{c.l}</label>
            <input
              type="number" step={c.k === 'comision_pct' ? '0.5' : '0.01'} min="0"
              max={c.k === 'comision_pct' ? '100' : undefined}
              value={state[c.k] ?? ''}
              onChange={(e) => onChange({ [c.k]: e.target.value })}
              placeholder={c.req ? 'Obligatorio' : 'Opcional'}
              style={ds.input}
            />
          </div>
        ))}
      </div>
      <div style={{
        marginBottom: 14, padding: '10px 12px', borderRadius: 10,
        background: colors.surface2, fontSize: type.xs, color: colors.textMute, lineHeight: 1.5,
      }}>
        La <b style={{ color: colors.text }}>comisión</b> es el % del importe del pedido que cobras a este restaurante (por defecto 10%). Puedes ajustarlo.
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

function ModalAlta({ state, onChange, onConfirm, onClose }) {
  const emailValido = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((state.email || '').trim())
  const completo = state.nombre.trim().length >= 2 && emailValido && state.direccion.trim().length >= 3

  if (state.success) {
    return (
      <ModalShell onClose={onClose}>
        <div style={{ textAlign: 'center', padding: '8px 4px' }}>
          <div style={{
            width: 56, height: 56, borderRadius: 999, background: colors.sageSoft, color: colors.sage2,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 14,
          }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
          </div>
          <h2 style={{ ...ds.h2, marginBottom: 8 }}>Restaurante creado</h2>
          <p style={{ fontSize: type.sm, color: colors.textMute, lineHeight: 1.5, marginBottom: 6 }}>
            {state.success.email_enviado
              ? <>Hemos enviado una invitación a <b style={{ color: colors.text }}>{state.success.email}</b>. Cuando el restaurante confirme y el equipo Pidoo lo verifique, aparecerá activo en tu marketplace.</>
              : <>El restaurante <b style={{ color: colors.text }}>{state.success.email}</b> quedó creado, pero el email de invitación aún no está configurado. Contacta con el equipo Pidoo para que el restaurante reciba su acceso.</>}
          </p>
          <div style={{ marginTop: 16 }}>
            <button onClick={onClose} style={ds.glossyBtn}>Entendido</button>
          </div>
        </div>
      </ModalShell>
    )
  }

  return (
    <ModalShell onClose={state.loading ? () => {} : onClose}>
      <h2 style={{ ...ds.h2, marginBottom: 6 }}>Dar de alta restaurante</h2>
      <div style={{ fontSize: type.sm, color: colors.textMute, marginBottom: 16 }}>
        Crea el restaurante y le enviaremos una invitación por email para que confirme su alta y cree su contraseña. Quedará vinculado a tu marketplace y saldrá público cuando el equipo Pidoo lo verifique.
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 14 }}>
        <div>
          <label style={ds.label}>Nombre del restaurante</label>
          <input value={state.nombre} onChange={e => onChange({ nombre: e.target.value })} placeholder="Ej. Guachinche La Esquina" style={ds.input} />
        </div>
        <div>
          <label style={ds.label}>Dirección</label>
          <AddressAutocomplete
            value={state.direccion}
            onChange={(v) => onChange({ direccion: v, latitud: null, longitud: null })}
            onSelect={(p) => onChange({ direccion: p.direccion, latitud: p.latitud, longitud: p.longitud })}
            placeholder="Busca la dirección del restaurante…"
          />
          {state.latitud != null && (
            <div style={{ fontSize: 11, color: colors.sage2, fontWeight: 600, marginTop: 4 }}>Ubicación fijada ✓</div>
          )}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <label style={ds.label}>Email del restaurante</label>
            <input type="email" value={state.email} onChange={e => onChange({ email: e.target.value })} placeholder="restaurante@email.com" style={ds.input} />
          </div>
          <div>
            <label style={ds.label}>Teléfono (opcional)</label>
            <input value={state.telefono} onChange={e => onChange({ telefono: e.target.value })} placeholder="600 000 000" inputMode="tel" style={ds.input} />
          </div>
        </div>
      </div>

      <div style={{ marginBottom: 14, padding: '10px 12px', borderRadius: 10, background: colors.surface2, fontSize: type.xs, color: colors.textMute, lineHeight: 1.5 }}>
        Usa un email <b style={{ color: colors.text }}>distinto al tuyo de socio</b>. Ahí llegará la invitación para que el restaurante gestione su carta y sus pedidos.
      </div>

      {state.error && (
        <div style={{ marginBottom: 12, padding: '8px 10px', borderRadius: 8, background: colors.dangerSoft, color: colors.danger, fontSize: type.xs, fontWeight: 600 }}>{state.error}</div>
      )}

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button onClick={onClose} style={ds.secondaryBtn} disabled={state.loading}>Cancelar</button>
        <button onClick={onConfirm} disabled={!completo || state.loading} style={{ ...ds.glossyBtn, opacity: (!completo || state.loading) ? 0.5 : 1 }}>
          {state.loading ? 'Creando…' : 'Crear y enviar invitación'}
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
