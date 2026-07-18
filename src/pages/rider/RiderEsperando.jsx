// RiderEsperando — Pantalla por defecto cuando rider está online esperando.
// Muestra estado, último GPS, fuentes de pedidos y restaurantes vinculados.
// 18-jul-2026 (autonomía del socio): toggle por restaurante (reparto_activo del
// vínculo) + toggles de fuentes (acepta_marketplace/telefonicos/app en socios).
// Ambos optimistas: la UI cambia YA y el update corre detrás; si falla, revierte.
import { useEffect, useState } from 'react'
import { Bike, MapPin, AlertCircle, X, Store, Phone, Smartphone } from 'lucide-react'
import { useRider } from '../../context/RiderContext'
import { supabase } from '../../lib/supabase'
import { colors } from '../../lib/uiStyles'

// Switch pequeño estilo pill. Cambia al instante (el guardado corre detrás).
function Switch({ on, onToggle, ariaLabel }) {
  return (
    <button
      onClick={onToggle}
      aria-label={ariaLabel}
      role="switch"
      aria-checked={on}
      style={{
        width: 42, height: 24, borderRadius: 999, border: 'none', padding: 2,
        background: on ? colors.sage : colors.stone2, cursor: 'pointer',
        display: 'flex', alignItems: 'center', flexShrink: 0,
        justifyContent: on ? 'flex-end' : 'flex-start',
        transition: 'background .15s',
      }}
    >
      <span style={{
        width: 20, height: 20, borderRadius: '50%', background: '#fff',
        boxShadow: '0 1px 3px rgba(26,24,21,0.25)',
      }} />
    </button>
  )
}

const FUENTES = [
  {
    campo: 'acepta_app', icono: Smartphone, titulo: 'App y tienda del restaurante',
    desc: 'Pedidos de la app Pidoo y de la web del restaurante.',
    off: 'No recibirás pedidos de la app ni de las tiendas.',
  },
  {
    campo: 'acepta_marketplace', icono: Store, titulo: 'Mi marketplace',
    desc: 'Pedidos de tu propia tienda pública.',
    off: 'Tus clientes del marketplace no podrán pedir a domicilio.',
  },
  {
    campo: 'acepta_telefonicos', icono: Phone, titulo: 'Pedidos telefónicos',
    desc: 'Envíos que crea el restaurante · solo envío, sin comisión.',
    off: 'Los restaurantes no podrán mandarte envíos telefónicos.',
  },
]

export default function RiderEsperando({ onOpenPedido }) {
  const { socio, isOnline, needsLocation, actionError, retryLocation, clearActionError, asignacionesActivas } = useRider() || {}
  const [restaurantes, setRestaurantes] = useState([])
  const [retrying, setRetrying] = useState(false)
  // Fuentes: estado local optimista, sembrado desde la fila socios (default true).
  const [fuentes, setFuentes] = useState({ acepta_app: true, acepta_marketplace: true, acepta_telefonicos: true })

  useEffect(() => {
    if (!socio) return
    setFuentes({
      acepta_app: socio.acepta_app !== false,
      acepta_marketplace: socio.acepta_marketplace !== false,
      acepta_telefonicos: socio.acepta_telefonicos !== false,
    })
  }, [socio?.id, socio?.acepta_app, socio?.acepta_marketplace, socio?.acepta_telefonicos])

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

  // Toggle por restaurante (optimista): pinta YA, guarda detrás, revierte si falla.
  async function toggleRestaurante(vincId, next) {
    setRestaurantes(prev => prev.map(r => r._vincId === vincId ? { ...r, _repartoActivo: next } : r))
    const { error } = await supabase.from('socio_establecimiento')
      .update({ reparto_activo: next }).eq('id', vincId)
    if (error) {
      console.error('[RiderEsperando] toggle restaurante fallo:', error.message)
      setRestaurantes(prev => prev.map(r => r._vincId === vincId ? { ...r, _repartoActivo: !next } : r))
    }
  }

  // Toggle de fuente (optimista sobre socios.acepta_*).
  async function toggleFuente(campo) {
    const next = !fuentes[campo]
    setFuentes(prev => ({ ...prev, [campo]: next }))
    const { error } = await supabase.from('socios')
      .update({ [campo]: next }).eq('id', socio.id)
    if (error) {
      console.error('[RiderEsperando] toggle fuente fallo:', error.message)
      setFuentes(prev => ({ ...prev, [campo]: !next }))
    }
  }

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

      {/* Error de red al conectar/desconectar (desechable) */}
      {actionError && (
        <div style={{
          padding: '12px 14px', borderRadius: 14, marginBottom: 14,
          background: '#FDE8E4', color: '#9B3412',
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
          background: colors.warningSoft, color: '#8B6126',
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
                background: '#8B6126', color: '#fff', fontWeight: 700, fontSize: 12,
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

      {/* Fuentes de pedidos: el socio decide de qué vías acepta pedidos. */}
      <div style={{ marginBottom: 18 }}>
        <div style={{
          fontSize: 11, fontWeight: 700, color: colors.stone,
          textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8,
        }}>
          Fuentes de pedidos
        </div>
        <div style={{
          borderRadius: 12, background: colors.paper,
          border: `1px solid ${colors.border}`, overflow: 'hidden',
        }}>
          {FUENTES.map((f, i) => {
            const Icono = f.icono
            const on = fuentes[f.campo]
            return (
              <div key={f.campo} style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '11px 12px',
                borderTop: i > 0 ? `1px solid ${colors.border}` : 'none',
              }}>
                <div style={{
                  width: 34, height: 34, borderRadius: 10, flexShrink: 0,
                  background: on ? colors.sageSoft : colors.cream2,
                  color: on ? colors.sage2 : colors.stone2,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <Icono size={16} strokeWidth={2.2} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: on ? colors.ink : colors.stone }}>
                    {f.titulo}
                  </div>
                  <div style={{ fontSize: 11, color: on ? colors.stone : '#B0763B', marginTop: 1, lineHeight: 1.35 }}>
                    {on ? f.desc : f.off}
                  </div>
                </div>
                <Switch on={on} onToggle={() => toggleFuente(f.campo)} ariaLabel={f.titulo} />
              </div>
            )
          })}
        </div>
      </div>

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
                  color: r._repartoActivo ? colors.stone : '#B0763B',
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
                    <span style={{ fontWeight: 700 }}>En pausa: no recibirás pedidos de este restaurante</span>
                  )}
                </div>
              </div>
              {/* Toggle por restaurante: solo en vínculos activos (los "pausada" los
                  gestiona el sistema, no el socio). */}
              {r._estado === 'activa' && (
                <Switch
                  on={r._repartoActivo}
                  onToggle={() => toggleRestaurante(r._vincId, !r._repartoActivo)}
                  ariaLabel={`Recibir pedidos de ${r.nombre}`}
                />
              )}
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
