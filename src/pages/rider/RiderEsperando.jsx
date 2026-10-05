// RiderEsperando — Pantalla por defecto cuando rider está online esperando.
// Muestra estado, último GPS y restaurantes vinculados.
// 18-jul-2026 (autonomía del socio): toggle por restaurante (reparto_activo del vínculo),
// que vive en el detalle de cada restaurante.
// 5-oct-2026: fuera la tarjeta "Fuentes de pedidos" (socios.acepta_app/marketplace/
// telefonicos). Desde el 28-sep el telefónico paga lo mismo que la app, así que ya no había
// nada que elegir por vía: el socio decide por RESTAURANTE (apagarlo = no recibe sus pedidos
// por ninguna vía y deja de salir en su marketplace). Las columnas siguen en BD, todas a
// true, y los edges las siguen leyendo con `!== false`.
import { useEffect, useState } from 'react'
import { Bike, MapPin, AlertCircle, X, ChevronRight } from 'lucide-react'
import { useRider } from '../../context/RiderContext'
import { supabase } from '../../lib/supabase'
import { colors } from '../../lib/uiStyles'

export default function RiderEsperando({ onOpenPedido, onOpenRestaurante }) {
  const { socio, isOnline, needsLocation, actionError, retryLocation, clearActionError, asignacionesActivas, problemasMovil, revisarMovil } = useRider() || {}
  const [restaurantes, setRestaurantes] = useState([])
  const [retrying, setRetrying] = useState(false)

  useEffect(() => {
    if (!socio?.id) return
    let cancel = false
    ;(async () => {
      const { data } = await supabase
        .from('socio_establecimiento')
        .select('id, establecimiento_id, estado, reparto_activo, establecimientos(id, nombre, direccion, logo_url, tiene_delivery)')
        .eq('socio_id', socio.id)
        .in('estado', ['activa', 'pausada'])
      if (!cancel) setRestaurantes((data || []).map(r => ({
        ...r.establecimientos, _vincId: r.id, _estado: r.estado, _repartoActivo: r.reparto_activo !== false,
      })).filter(r => r.id))
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
          background: colors.warningSoft, color: colors.warningInk,
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

      {/* v307: En línea, pero el móvil ya no está preparado (quitó el sonido, bajó la alarma,
          el sistema reseteó un permiso...). Se mira cada vez que vuelve a la app. */}
      {isOnline && problemasMovil?.length > 0 && (
        <div style={{
          padding: '14px 16px', borderRadius: 14, marginBottom: 14,
          background: colors.errorBg, color: colors.errorInk,
          display: 'flex', alignItems: 'flex-start', gap: 10,
        }}>
          <AlertCircle size={18} strokeWidth={2.2} style={{ flexShrink: 0, marginTop: 1 }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 13 }}>Puede que no te suenen los pedidos</div>
            <div style={{ fontSize: 12, marginTop: 2, opacity: 0.9 }}>
              {(() => { const t = problemasMovil.map((p) => p.corto || p.titulo).join(', '); return t.charAt(0).toUpperCase() + t.slice(1) + '.' })()}
            </div>
            <button
              onClick={() => revisarMovil?.()}
              style={{
                marginTop: 10, padding: '8px 14px', borderRadius: 999, border: 'none',
                background: colors.errorInk, color: colors.cream, fontWeight: 700, fontSize: 12,
                cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              Arreglarlo
            </button>
          </div>
        </div>
      )}

      {/* Error de red al conectar/desconectar (desechable) */}
      {actionError && (
        <div style={{
          padding: '12px 14px', borderRadius: 14, marginBottom: 14,
          background: colors.errorBg, color: colors.errorInk,
          display: 'flex', alignItems: 'flex-start', gap: 10,
        }}>
          <AlertCircle size={18} strokeWidth={2.2} style={{ flexShrink: 0, marginTop: 1 }} />
          <div style={{ flex: 1, fontSize: 12, fontWeight: 600 }}>{actionError}</div>
          <button onClick={() => clearActionError?.()} aria-label="Cerrar" style={{
            border: 'none', background: 'transparent', color: 'inherit',
            cursor: 'pointer', padding: 0, display: 'flex',
          }}>
            <X size={16} strokeWidth={2.4} />
          </button>
        </div>
      )}

      {/* Online pero sin permiso de ubicación: banner persistente con acción */}
      {isOnline && needsLocation && (
        <div style={{
          padding: '14px 16px', borderRadius: 14, marginBottom: 14,
          background: colors.warningSoft, color: colors.warningInk,
          display: 'flex', alignItems: 'flex-start', gap: 10,
        }}>
          <MapPin size={18} strokeWidth={2.2} style={{ flexShrink: 0, marginTop: 1 }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 13 }}>Activa la ubicación</div>
            <div style={{ fontSize: 12, marginTop: 2, opacity: 0.85 }}>
              Sin tu ubicación no podremos asignarte pedidos cercanos. Estás en línea, pero necesitamos el GPS.
            </div>
            <button
              onClick={async () => { if (retrying) return; setRetrying(true); try { await retryLocation?.() } finally { setRetrying(false) } }}
              disabled={retrying}
              style={{
                marginTop: 10, padding: '8px 14px', borderRadius: 999, border: 'none',
                background: colors.warningInk, color: colors.cream, fontWeight: 700, fontSize: 12,
                cursor: retrying ? 'wait' : 'pointer', opacity: retrying ? 0.7 : 1,
                fontFamily: 'inherit',
              }}
            >
              {retrying ? 'Comprobando…' : 'Activar ubicación'}
            </button>
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
            background: colors.paper, padding: '4px 10px', borderRadius: 999,
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
            <button
              key={r.id}
              onClick={() => onOpenRestaurante?.(r.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, width: '100%',
                padding: 11, borderRadius: 12, background: colors.paper,
                border: `1px solid ${colors.border}`, cursor: 'pointer',
                textAlign: 'left', fontFamily: 'inherit',
                opacity: r._repartoActivo ? 1 : 0.72,
              }}
            >
              <div style={{
                width: 40, height: 40, borderRadius: '50%',
                background: colors.cream2, overflow: 'hidden', flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                filter: r._repartoActivo ? 'none' : 'grayscale(1)',
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
                  fontSize: 11, marginTop: 1,
                  color: r._repartoActivo ? colors.stone : colors.warningStrong,
                  display: 'flex', alignItems: 'center', gap: 4,
                }}>
                  {r._repartoActivo ? (
                    <>
                      <MapPin size={10} strokeWidth={2.2} />
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {r.direccion?.split(',')[0]}
                      </span>
                    </>
                  ) : (
                    <span style={{ fontWeight: 700 }}>En pausa</span>
                  )}
                </div>
              </div>
              {/* Badge "Pausado" + chevron. El on/off vive ahora en el detalle. */}
              {r._estado === 'activa' && !r._repartoActivo && (
                <span style={{
                  fontSize: 10, fontWeight: 800, color: colors.warningStrong,
                  background: colors.warningSoft, padding: '3px 8px',
                  borderRadius: 999, whiteSpace: 'nowrap', flexShrink: 0,
                }}>Pausado</span>
              )}
              <ChevronRight size={18} strokeWidth={2.2} style={{ color: colors.stone2, flexShrink: 0 }} />
            </button>
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
