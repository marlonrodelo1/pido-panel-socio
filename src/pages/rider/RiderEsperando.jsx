// RiderEsperando — Pantalla por defecto cuando rider está online esperando.
// Muestra estado, último GPS, restaurantes vinculados.
import { useEffect, useState } from 'react'
import { Bike, MapPin, AlertCircle } from 'lucide-react'
import { useRider } from '../../context/RiderContext'
import { supabase } from '../../lib/supabase'
import { colors } from '../../lib/uiStyles'

export default function RiderEsperando({ onOpenPedido }) {
  const { socio, isOnline, asignacionesActivas } = useRider() || {}
  const [restaurantes, setRestaurantes] = useState([])

  useEffect(() => {
    if (!socio?.id) return
    let cancel = false
    ;(async () => {
      const { data } = await supabase
        .from('socio_establecimiento')
        .select('establecimiento_id, estado, establecimientos(id, nombre, direccion, logo_url, tiene_delivery)')
        .eq('socio_id', socio.id)
        .in('estado', ['activa', 'pausada'])
      if (!cancel) setRestaurantes((data || []).map(r => ({ ...r.establecimientos, _estado: r.estado })).filter(Boolean))
    })()
    return () => { cancel = true }
  }, [socio?.id, isOnline])

  return (
    <div style={{
      padding: '16px 16px calc(80px + env(safe-area-inset-bottom, 0px))',
      fontFamily: "'Plus Jakarta Sans', sans-serif",
    }}>
      {!isOnline && (
        <div style={{
          padding: '14px 16px', borderRadius: 14, marginBottom: 14,
          background: colors.warningSoft, color: '#8B6126',
          display: 'flex', alignItems: 'flex-start', gap: 10,
        }}>
          <AlertCircle size={18} strokeWidth={2.2} style={{ flexShrink: 0, marginTop: 1 }} />
          <div>
            <div style={{ fontWeight: 700, fontSize: 13 }}>Estás offline</div>
            <div style={{ fontSize: 12, marginTop: 2, opacity: 0.85 }}>
              Activa "En línea" arriba para empezar a recibir pedidos.
            </div>
          </div>
        </div>
      )}

      {isOnline && (
        <div style={{
          padding: 18, borderRadius: 18,
          background: `linear-gradient(135deg, ${colors.sageSoft}, ${colors.cream2})`,
          marginBottom: 16, textAlign: 'center',
        }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            color: colors.sage2, fontWeight: 700, fontSize: 11,
            background: '#fff', padding: '4px 10px', borderRadius: 999,
            marginBottom: 10,
          }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: colors.sage }} />
            En línea
          </div>
          <div style={{ fontSize: 17, fontWeight: 700, color: colors.ink, marginBottom: 4 }}>
            Esperando pedidos…
          </div>
          <div style={{ fontSize: 12, color: colors.stone }}>
            Te avisaremos cuando llegue uno cerca.
          </div>
        </div>
      )}

      {asignacionesActivas?.length > 0 && (
        <div style={{ marginBottom: 18 }}>
          <div style={{
            fontSize: 11, fontWeight: 700, color: colors.stone,
            textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8,
          }}>
            Pedidos en curso ({asignacionesActivas.length})
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {asignacionesActivas.map(p => (
              <button
                key={p.id}
                onClick={() => onOpenPedido?.(p)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: 12, borderRadius: 12, border: 'none',
                  background: colors.paper, cursor: 'pointer',
                  textAlign: 'left', fontFamily: 'inherit',
                  borderLeft: `3px solid ${colors.terracotta}`,
                }}
              >
                <Bike size={16} strokeWidth={2.2} style={{ color: colors.terracotta }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: colors.ink }}>{p.codigo}</div>
                  <div style={{ fontSize: 11, color: colors.stone, marginTop: 2 }}>
                    {p.estado} · {Number(p.total || 0).toFixed(2)} €
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      <div>
        <div style={{
          fontSize: 11, fontWeight: 700, color: colors.stone,
          textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8,
        }}>
          Restaurantes vinculados ({restaurantes.length})
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {restaurantes.map(r => (
            <div
              key={r.id}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: 11, borderRadius: 12, background: colors.paper,
                border: `1px solid ${colors.border}`,
              }}
            >
              <div style={{
                width: 40, height: 40, borderRadius: '50%',
                background: colors.cream2, overflow: 'hidden',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                {r.logo_url
                  ? <img src={r.logo_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  : <span style={{ fontSize: 14, fontWeight: 800, color: colors.terracotta }}>
                      {r.nombre?.[0]?.toUpperCase() || 'R'}
                    </span>
                }
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: 13, fontWeight: 700, color: colors.ink,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>{r.nombre}</div>
                <div style={{
                  fontSize: 11, color: colors.stone, marginTop: 1,
                  display: 'flex', alignItems: 'center', gap: 4,
                }}>
                  <MapPin size={10} strokeWidth={2.2} />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {r.direccion?.split(',')[0]}
                  </span>
                </div>
              </div>
            </div>
          ))}
          {restaurantes.length === 0 && (
            <div style={{ fontSize: 12, color: colors.stone, padding: 14, textAlign: 'center' }}>
              Aún no tienes restaurantes vinculados.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
