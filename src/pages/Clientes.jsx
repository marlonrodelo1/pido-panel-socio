import { useEffect, useState } from 'react'
import { Phone, MessageCircle } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { colors, ds, type } from '../lib/uiStyles'

function euro(v) { return `${Number(v || 0).toFixed(2)} €` }
function fmtFecha(ts) {
  if (!ts) return '—'
  return new Date(ts).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' })
}
function iniciales(n) {
  if (!n) return '?'
  return n.split(' ').filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase()
}
// wa.me quiere el número con prefijo país sin '+'. Asumimos España (34) si son 9 dígitos.
function waLink(tel) {
  const d = String(tel || '').replace(/\D/g, '')
  if (!d) return null
  const full = d.length === 9 ? '34' + d : d
  return `https://wa.me/${full}`
}

export default function Clientes() {
  const [clientes, setClientes] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [q, setQ] = useState('')

  useEffect(() => {
    let cancel = false
    ;(async () => {
      setLoading(true); setError(null)
      // RPC SECURITY DEFINER: agrega los pedidos del socio autenticado por cliente
      // (nombre + teléfono + nº pedidos + gasto + último). Scope por socios.user_id.
      const { data, error } = await supabase.rpc('get_clientes_socio')
      if (cancel) return
      if (error) { setError(error.message); setClientes([]) }
      else setClientes(data || [])
      setLoading(false)
    })()
    return () => { cancel = true }
  }, [])

  const filtrados = clientes.filter(c => {
    if (!q) return true
    const s = q.toLowerCase()
    return (c.nombre || '').toLowerCase().includes(s) || (c.telefono || '').includes(q)
  })

  const totalClientes = clientes.length
  const totalGastado = clientes.reduce((a, c) => a + Number(c.total_gastado || 0), 0)

  return (
    <div>
      <h1 style={ds.h1}>Mis clientes</h1>
      <p style={{ color: colors.textMute, fontSize: type.sm, marginTop: 4, marginBottom: 16 }}>
        Las personas que han pedido contigo. Llámalas o escríbeles por WhatsApp.
      </p>

      {!loading && !error && totalClientes > 0 && (
        <div style={{ display: 'flex', gap: 16, marginBottom: 16, flexWrap: 'wrap', fontSize: type.sm, color: colors.textMute }}>
          <span><b style={{ color: colors.text }}>{totalClientes}</b> cliente{totalClientes !== 1 ? 's' : ''}</span>
          <span>Ventas totales: <b style={{ color: colors.terracotta }}>{euro(totalGastado)}</b></span>
        </div>
      )}

      {clientes.length > 0 && (
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar por nombre o teléfono…"
          style={{ ...ds.input, marginBottom: 14 }} />
      )}

      {loading ? (
        <div style={{ color: colors.textMute, fontSize: type.sm, padding: 20 }}>Cargando…</div>
      ) : error ? (
        <div style={{ ...ds.card, textAlign: 'center', padding: 28 }}>
          <div style={{ fontSize: type.base, fontWeight: 700, marginBottom: 6 }}>No se pudo cargar</div>
          <div style={{ fontSize: type.sm, color: colors.textMute }}>{error}</div>
        </div>
      ) : filtrados.length === 0 ? (
        <div style={{ ...ds.card, textAlign: 'center', padding: 30, color: colors.textMute, fontSize: type.sm }}>
          {clientes.length === 0
            ? 'Aún no tienes clientes. Cuando alguien pida contigo, aparecerá aquí con su teléfono.'
            : 'Ningún cliente coincide con la búsqueda.'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {filtrados.map(c => (
            <div key={c.cliente_key} style={{ ...ds.card, padding: 14, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <div style={{
                width: 44, height: 44, borderRadius: '50%', flexShrink: 0,
                background: colors.terracotta, color: '#fff',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontWeight: 800, fontSize: 14, letterSpacing: '-0.5px',
              }}>{iniciales(c.nombre)}</div>

              <div style={{ flex: '1 1 150px', minWidth: 0 }}>
                <div style={{ fontSize: type.sm, fontWeight: 700, color: colors.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {c.nombre || 'Cliente'}
                </div>
                <div style={{ fontSize: type.xs, color: colors.textMute, marginTop: 2 }}>
                  {c.num_pedidos} pedido{c.num_pedidos !== 1 ? 's' : ''} · {euro(c.total_gastado)} · últ. {fmtFecha(c.ultimo_pedido_at)}
                </div>
              </div>

              <div style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
                {c.telefono ? (
                  <>
                    <a href={`tel:${c.telefono}`}
                      style={{ ...ds.secondaryBtn, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
                      <Phone size={14} strokeWidth={2.2} /> Llamar
                    </a>
                    {waLink(c.telefono) && (
                      <a href={waLink(c.telefono)} target="_blank" rel="noreferrer"
                        style={{ ...ds.primaryBtn, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
                        <MessageCircle size={14} strokeWidth={2.2} /> WhatsApp
                      </a>
                    )}
                  </>
                ) : (
                  <span style={{ fontSize: type.xs, color: colors.textFaint }}>Sin teléfono</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
