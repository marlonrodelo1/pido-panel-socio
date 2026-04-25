import { useEffect, useState } from 'react'
import { useSocio } from '../context/SocioContext'
import { supabase, FUNCTIONS_URL } from '../lib/supabase'
import { colors, ds, type, stateBadge } from '../lib/uiStyles'

export default function Restaurantes() {
  const { socio } = useSocio()
  const [tab, setTab] = useState('vinculados')
  const [vinculados, setVinculados] = useState([])
  const [buscador, setBuscador] = useState([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [enviando, setEnviando] = useState(null)

  const load = async () => {
    if (!socio?.id) return
    setLoading(true)
    try {
      const [vinc, rest] = await Promise.all([
        supabase.from('socio_establecimiento')
          .select('id, estado, solicitado_at, aceptado_at, establecimiento:establecimientos(id, nombre, logo_url, slug, tipo, rating, activo)')
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

  // Realtime: si el superadmin (o el restaurante) cambia el estado de la
  // vinculación, refrescamos sin necesidad de F5. Filtra por socio_id para
  // no recibir cambios ajenos.
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

  const solicitar = async (establecimiento_id) => {
    setEnviando(establecimiento_id)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const r = await fetch(`${FUNCTIONS_URL}/solicitar-vinculacion-socio`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({ establecimiento_id }),
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error || 'Error al solicitar')
      await load()
      setTab('vinculados')
    } catch (e) { alert(e.message) }
    finally { setEnviando(null) }
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

      <div style={{ display: 'flex', background: colors.surface2, borderRadius: 8, padding: 3, marginBottom: 16, maxWidth: 360, gap: 3 }}>
        {[
          { id: 'vinculados', l: `Mis vinculados (${vinculados.length})` },
          { id: 'buscar', l: 'Buscar' },
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

      {loading ? (
        <div style={{ color: colors.textMute, fontSize: type.sm, padding: 20 }}>Cargando…</div>
      ) : tab === 'vinculados' ? (
        vinculados.length === 0 ? (
          <div style={{ ...ds.card, textAlign: 'center', padding: 28 }}>
            <div style={{ fontSize: type.base, fontWeight: 600, marginBottom: 6 }}>Aún no tienes restaurantes</div>
            <div style={{ fontSize: type.sm, color: colors.textMute, marginBottom: 12 }}>
              Busca y solicita vinculación con los que quieras mostrar en tu marketplace.
            </div>
            <button onClick={() => setTab('buscar')} style={ds.primaryBtn}>Buscar restaurantes</button>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(260px,1fr))', gap: 12 }}>
            {vinculados.map(v => {
              const e = v.establecimiento || {}
              const badge = stateBadge(v.estado)
              return (
                <div key={v.id} style={ds.card}>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 8 }}>
                    <div style={{
                      width: 44, height: 44, borderRadius: 8, flexShrink: 0,
                      background: e.logo_url ? `url(${e.logo_url}) center/cover` : colors.surface2,
                      border: `1px solid ${colors.border}`,
                    }} />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: type.base, fontWeight: 600, color: colors.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {e.nombre || '—'}
                      </div>
                      <div style={{ fontSize: type.xs, color: colors.textMute }}>{e.tipo}</div>
                    </div>
                  </div>
                  <div style={{ ...badge }}>{badge._label}</div>
                </div>
              )
            })}
          </div>
        )
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
                <button onClick={() => solicitar(r.id)} disabled={enviando === r.id}
                  style={{ ...ds.primaryBtn, width: '100%', opacity: enviando === r.id ? 0.6 : 1 }}>
                  {enviando === r.id ? 'Enviando…' : 'Solicitar vinculación'}
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
    </div>
  )
}
