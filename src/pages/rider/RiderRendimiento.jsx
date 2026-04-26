// Rendimiento del rider: rating, entregas, % a tiempo, tasa aceptación,
// ganancias y horas online. Lee de pedidos + pedido_asignaciones + rider_earnings.

import { useEffect, useMemo, useState } from 'react'
import { colors, type, ds } from '../../lib/uiStyles'
import { supabase } from '../../lib/supabase'
import { useSocio } from '../../context/SocioContext'
import { useRider } from '../../context/RiderContext'

const PERIODOS = [
  { id: 'semana', label: 'Esta semana' },
  { id: 'mes',    label: 'Este mes' },
  { id: 'hoy',    label: 'Hoy' },
]

function rangoDias(periodo) {
  const now = new Date()
  const fin = new Date(now); fin.setHours(23, 59, 59, 999)
  let ini
  if (periodo === 'hoy') {
    ini = new Date(now); ini.setHours(0, 0, 0, 0)
  } else if (periodo === 'mes') {
    ini = new Date(now.getFullYear(), now.getMonth(), 1)
  } else {
    const d = now.getDay() || 7 // lunes=1
    ini = new Date(now); ini.setDate(now.getDate() - (d - 1)); ini.setHours(0, 0, 0, 0)
  }
  return { iniIso: ini.toISOString(), finIso: fin.toISOString(), iniLabel: ini, finLabel: fin }
}

function fmtRango(d) {
  return d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' })
}

export default function RiderRendimiento() {
  const { socio } = useSocio()
  const { riderAccountId } = useRider()
  const [periodo, setPeriodo] = useState('semana')
  const [stats, setStats] = useState(null)

  const { iniIso, finIso, iniLabel, finLabel } = useMemo(() => rangoDias(periodo), [periodo])

  useEffect(() => {
    if (!riderAccountId) return
    let cancel = false
    ;(async () => {
      const [earningsRes, asignRes] = await Promise.all([
        supabase
          .from('rider_earnings')
          .select('neto_rider, created_at')
          .eq('rider_account_id', riderAccountId)
          .gte('created_at', iniIso)
          .lte('created_at', finIso),
        supabase
          .from('pedido_asignaciones')
          .select('estado, aceptado_at, entregado_at, created_at')
          .eq('rider_account_id', riderAccountId)
          .gte('created_at', iniIso)
          .lte('created_at', finIso),
      ])
      if (cancel) return
      const earnings = earningsRes.data || []
      const asigs = asignRes.data || []
      const entregadas = asigs.filter((a) => !!a.entregado_at).length
      const aceptadas = asigs.filter((a) => a.estado === 'aceptado' || !!a.aceptado_at).length
      const totalAsignadas = asigs.length
      const aceptacion = totalAsignadas > 0 ? (aceptadas / totalAsignadas) * 100 : null
      const ganancias = earnings.reduce((s, e) => s + Number(e.neto_rider || 0), 0)
      setStats({
        rating: socio?.rating ? Number(socio.rating).toFixed(2) : '5.00',
        entregadas,
        aceptacion,
        ganancias,
      })
    })()
    return () => { cancel = true }
  }, [riderAccountId, iniIso, finIso, socio?.rating])

  const card = (titulo, valor, subtitulo) => (
    <div style={{ ...ds.card, padding: 18 }}>
      <div style={{ fontSize: type.xl, fontWeight: 800, color: colors.text, lineHeight: 1.1 }}>{valor}</div>
      <div style={{ fontSize: type.xs, color: colors.textMute, marginTop: 6 }}>{titulo}</div>
      {subtitulo && <div style={{ fontSize: 10, color: colors.textFaint, marginTop: 2 }}>{subtitulo}</div>}
    </div>
  )

  return (
    <div style={{ padding: '14px 14px 24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <select value={periodo} onChange={(e) => setPeriodo(e.target.value)} style={{ ...ds.input, width: 'auto', height: 36, paddingRight: 28 }}>
          {PERIODOS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
        <div style={{ fontSize: type.xs, color: colors.textMute }}>
          {fmtRango(iniLabel)} - {fmtRango(finLabel)}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        {card('Calificación del cliente', stats?.rating ?? '—')}
        {card('Entregas completadas', stats?.entregadas ?? '—')}
        {card('Tasa de aceptación', stats?.aceptacion == null ? '—' : `${stats.aceptacion.toFixed(0)}%`)}
        {card('Ganancias', stats?.ganancias != null ? `${stats.ganancias.toFixed(2)} €` : '—')}
      </div>
    </div>
  )
}
