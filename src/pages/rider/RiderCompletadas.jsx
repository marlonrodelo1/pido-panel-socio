// Historial: ordenes completadas hoy / ayer.

import { useEffect, useState } from 'react'
import { colors, type, ds } from '../../lib/uiStyles'
import { supabase } from '../../lib/supabase'
import { useRider } from '../../context/RiderContext'

export default function RiderCompletadas({ onBack }) {
  const { riderAccountId } = useRider()
  const [tab, setTab] = useState('hoy')
  const [rows, setRows] = useState([])

  useEffect(() => {
    if (!riderAccountId) return
    const now = new Date()
    const ini = new Date(now); ini.setHours(0, 0, 0, 0)
    if (tab === 'ayer') ini.setDate(ini.getDate() - 1)
    const fin = new Date(ini); fin.setHours(23, 59, 59, 999)
    let cancel = false
    ;(async () => {
      const { data } = await supabase
        .from('pedido_asignaciones')
        .select('id, entregado_at, distancia_metros, pedidos!inner(codigo, total, direccion_entrega, establecimientos!inner(nombre))')
        .eq('rider_account_id', riderAccountId)
        .not('entregado_at', 'is', null)
        .gte('entregado_at', ini.toISOString())
        .lte('entregado_at', fin.toISOString())
        .order('entregado_at', { ascending: false })
      if (!cancel) setRows(data || [])
    })()
    return () => { cancel = true }
  }, [riderAccountId, tab])

  return (
    <div style={{ padding: '14px 14px 24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
        <button onClick={onBack} style={{ background: 'transparent', border: 'none', color: colors.text, cursor: 'pointer', padding: 6 }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>
        </button>
        <div style={{ fontSize: type.base, fontWeight: 700 }}>Órdenes completadas</div>
      </div>

      <div style={{ display: 'flex', background: colors.surface2, borderRadius: 8, padding: 4, marginBottom: 16 }}>
        {[{ id: 'hoy', label: 'HOY' }, { id: 'ayer', label: 'AYER' }].map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            flex: 1, height: 36, borderRadius: 6, border: 'none', cursor: 'pointer',
            background: tab === t.id ? colors.surface : 'transparent',
            color: tab === t.id ? colors.text : colors.textMute,
            fontWeight: 700, fontSize: type.xs, letterSpacing: '0.06em',
          }}>{t.label} ({tab === t.id ? rows.length : '—'})</button>
        ))}
      </div>

      {rows.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: colors.textMute, fontSize: type.xs }}>
          Sin pedidos terminados {tab === 'hoy' ? 'hoy' : 'ayer'}.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {rows.map((r) => (
            <div key={r.id} style={{ ...ds.card, padding: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <div style={{ fontSize: type.sm, fontWeight: 700, color: colors.text }}>#{r.pedidos?.codigo}</div>
                <div style={{ fontSize: type.xs, color: colors.textMute }}>{new Date(r.entregado_at).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}</div>
              </div>
              <div style={{ fontSize: type.xs, color: colors.textMute, marginTop: 4 }}>
                {r.pedidos?.establecimientos?.nombre} → {r.pedidos?.direccion_entrega}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
