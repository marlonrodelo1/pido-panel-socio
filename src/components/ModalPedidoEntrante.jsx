// ModalPedidoEntrante — Overlay full-screen cuando llega una asignación pendiente.
// Countdown 150s / 2:30 (ALINEADO con el cron de reasignación, que reasigna a los 150s
// de assigned_at — un countdown más largo enseñaba al rider pedidos ya reasignados),
// sonido + vibración, botones Aceptar / Rechazar.
// v51 (jul-2026): round-robin de 2 vueltas. Banner "responsable" (1ª asignación a R1) y
// "última vuelta" (2ª vuelta) leídos de asignacion.es_responsable / asignacion.vuelta.
import { useEffect, useMemo, useRef, useState } from 'react'
import { Bike, MapPin, Clock, Phone } from 'lucide-react'
import { useRider } from '../context/RiderContext'
import { riderAcceptOrder, riderRejectOrder } from '../lib/riderApi'
import { supabase } from '../lib/supabase'
import { colors } from '../lib/uiStyles'
import { calcGanancia } from '../lib/ganancia'
import { getPedidoAudio } from '../lib/pedidoSound'

// 150s (2:30) = ventana real del cron de reasignación (assigned_at < now() - 150s).
const COUNTDOWN_SECONDS = 150
const GMAPS_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY

export default function ModalPedidoEntrante() {
  const { asignacionPendiente, dismissPendiente, socio } = useRider() || {}
  const [secondsLeft, setSecondsLeft] = useState(COUNTDOWN_SECONDS)
  const [busy, setBusy] = useState(null) // 'accept' | 'reject' | null
  const [pedidoFull, setPedidoFull] = useState(null) // pedido completo (mapa + ganancia)
  const [pacto, setPacto] = useState(null)           // tarifa pactada con ese restaurante
  const audioRef = useRef(null)
  const intervalRef = useRef(null)

  useEffect(() => {
    if (!asignacionPendiente) return
    // El reloj real corre en el SERVIDOR desde asignacion.created_at (el cron
    // reasigna a los 90s de la asignación, no de cuando el rider la VE). Si la app
    // estaba en segundo plano y el rider abre tarde, hay que descontar lo ya
    // transcurrido — antes el modal arrancaba en 90s completos y dejaba "aceptar"
    // pedidos ya reasignados (409 "ya no está disponible").
    const creadaMs = asignacionPendiente.created_at ? new Date(asignacionPendiente.created_at).getTime() : Date.now()
    const transcurrido = Number.isFinite(creadaMs) ? Math.max(0, Math.floor((Date.now() - creadaMs) / 1000)) : 0
    const restante = Math.max(0, COUNTDOWN_SECONDS - transcurrido)
    setSecondsLeft(restante)
    setBusy(null)

    // Si ya expiró en servidor, no arrancamos sonido/vibración: el efecto del
    // timeout (secondsLeft=0) cerrará la asignación inmediatamente.
    if (restante <= 0) return

    // Sonido loop — instancia COMPARTIDA y desbloqueada con el primer gesto del
    // usuario (iOS bloquea autoplay sin gesto; ver lib/pedidoSound). Antes se creaba
    // un new Audio() aquí y en iOS quedaba mudo siempre.
    //
    // 18-jul-2026: antes un solo rechazo de autoplay = 150 s de SILENCIO, sin reintento
    // y sin log (el .catch estaba vacío). Ahora se reintenta cada 800 ms mientras el
    // modal esté abierto, se engancha al primer toque del rider, y si falla se ve en
    // consola en lugar de perderse.
    let retryId = null
    try {
      const a = getPedidoAudio()
      if (a) {
        audioRef.current = a
        a.currentTime = 0
        const intentar = () => a.play().then(() => {
          if (retryId) { clearInterval(retryId); retryId = null }
        }).catch((e) => {
          console.error('[pedidoSound] play bloqueado:', e?.name || e)
        })
        intentar()
        retryId = setInterval(intentar, 800)
        const alTocar = () => intentar()
        window.addEventListener('pointerdown', alTocar, { once: true })
        a.addEventListener('error', (e) => console.error('[pedidoSound] error de audio', e))
      }
    } catch (e) { console.error('[pedidoSound] excepción', e) }

    // Vibración rítmica repetida mientras el modal esté abierto (cada 3s) para que
    // el rider lo note aunque el móvil esté en el bolsillo.
    // navigator.vibrate NO existe en WKWebView (iOS): el iPhone no vibraba nunca.
    // @capacitor/haptics sí funciona en ambas plataformas; web cae al fallback.
    const vibe = async () => {
      try {
        const { Haptics } = await import('@capacitor/haptics')
        await Haptics.vibrate({ duration: 800 })
      } catch (_) {
        try { navigator.vibrate?.([300, 200, 300, 200, 600]) } catch (_) {}
      }
    }
    vibe()
    const vibeId = setInterval(vibe, 3000)

    // Countdown (solo decrementa; el efecto de abajo dispara el timeout en 0 para no
    // ejecutar efectos dentro del updater de setState, que React puede llamar 2 veces).
    intervalRef.current = setInterval(() => {
      setSecondsLeft((s) => (s <= 0 ? 0 : s - 1))
    }, 1000)

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
      if (retryId) clearInterval(retryId)
      clearInterval(vibeId)
      try { navigator.vibrate?.(0) } catch (_) {}
      try { audioRef.current?.pause() } catch (_) {}
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asignacionPendiente?.id])

  // Timeout del countdown: cerramos la asignación en el backend (rechazo por
  // "timeout") para que se reasigne de inmediato en vez de esperar al cron.
  useEffect(() => {
    if (!asignacionPendiente) return
    if (secondsLeft > 0) return
    if (intervalRef.current) clearInterval(intervalRef.current)
    handleTimeout()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secondsLeft, asignacionPendiente?.id])

  // El objeto asignacionPendiente.pedidos viene PARCIAL. Cargamos el pedido
  // completo para poder pintar el mini-mapa y calcular la ganancia del socio.
  // 18-jul-2026: además traemos el PACTO vigente con ese restaurante para poder
  // avisar en la propia asignación si la tarifa acordada es un PRECIO FIJO.
  useEffect(() => {
    setPedidoFull(null)
    setPacto(null)
    const pedidoId = asignacionPendiente?.pedido_id
    if (!pedidoId) return
    let cancel = false
    ;(async () => {
      const { data } = await supabase
        .from('pedidos')
        .select('id,codigo,total,subtotal,coste_envio,propina,modo_entrega,origen_pedido,metodo_pago,direccion_entrega,lat_entrega,lng_entrega,cliente_telefono,guest_telefono,guest_nombre,usuario_id,establecimiento_id,establecimientos(nombre,direccion,latitud,longitud)')
        .eq('id', pedidoId)
        .maybeSingle()
      if (cancel || !data) return
      setPedidoFull(data)

      // socio del CONTEXTO: la asignación recuperada al recargar (refreshAsignaciones)
      // no trae socio_id en su select, solo la que llega por realtime.
      const socioId = socio?.id || asignacionPendiente?.socio_id
      if (!socioId || !data.establecimiento_id) return
      const { data: vinc } = await supabase
        .from('socio_establecimiento')
        .select('tarifa_modo, tarifa_fija')
        .eq('socio_id', socioId)
        .eq('establecimiento_id', data.establecimiento_id)
        .maybeSingle()
      if (!cancel && vinc) setPacto(vinc)
    })()
    return () => { cancel = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asignacionPendiente?.pedido_id, socio?.id])

  // Mini-mapa estático: restaurante (terracotta) + entrega (verde) + path.
  // pedidoFull puede ser null mientras carga → mapa solo cuando hay coords + key.
  const estLat = pedidoFull?.establecimientos?.latitud
  const estLng = pedidoFull?.establecimientos?.longitud
  const entLat = pedidoFull?.lat_entrega
  const entLng = pedidoFull?.lng_entrega
  const mapaUrl = useMemo(() => {
    if (!GMAPS_KEY) return null
    if (estLat == null || estLng == null || entLat == null || entLng == null) return null
    const o = `${estLat},${estLng}`
    const d = `${entLat},${entLng}`
    return `https://maps.googleapis.com/maps/api/staticmap?size=640x300&scale=2`
      + `&markers=color:0xC5562C%7C${o}`
      + `&markers=color:0x2E7D32%7C${d}`
      + `&path=color:0x8B9D7A%7Cweight:4%7C${o}%7C${d}`
      + `&key=${encodeURIComponent(GMAPS_KEY)}`
  }, [estLat, estLng, entLat, entLng])

  if (!asignacionPendiente) return null

  // Cae al objeto parcial mientras carga el completo.
  const pedido = pedidoFull || asignacionPendiente.pedidos || {}
  const est = pedido.establecimientos || {}
  const total = Number(pedido.total || 0)
  const ganancia = calcGanancia(pedido)
  const isDelivery = pedido.modo_entrega === 'delivery'
  const esTelefonico = pedido.origen_pedido === 'telefonico'
  // Tarifa pactada con este restaurante: si es PRECIO FIJO, el rider debe verlo al aceptar.
  const esTarifaFija = pacto?.tarifa_modo === 'fija'
  const importeFijo = Number(pacto?.tarifa_fija ?? 0)

  // v51 round-robin: vuelta (1|2) y si este socio es el responsable (R1) del pedido.
  const vuelta = asignacionPendiente.vuelta || 1
  const esResponsable = !!asignacionPendiente.es_responsable
  const esUltimaVuelta = vuelta >= 2

  const mins = Math.floor(secondsLeft / 60)
  const secs = secondsLeft % 60
  const timeStr = `${mins}:${String(secs).padStart(2, '0')}`

  async function handleAccept() {
    if (busy) return
    setBusy('accept')
    try {
      const res = await riderAcceptOrder(asignacionPendiente.id)
      if (res?.ok) { dismissPendiente?.(); return }
      try { if (navigator.vibrate) navigator.vibrate(200) } catch (_) {}
      if (res?.sessionDead) {
        // Token muerto (refresh caducado) → re-login. NO es "otro repartidor".
        alert('Tu sesión ha caducado. Vuelve a iniciar sesión para seguir recibiendo pedidos.')
        dismissPendiente?.()
        try { await supabase.auth.signOut() } catch (_) {}
        return
      }
      if (res?.status === 409) {
        // estado_invalido: ya no está esperando aceptación (lo tomó otro o expiró).
        alert('Este pedido ya no está disponible. Puede que lo haya tomado otro repartidor o haya expirado.')
        dismissPendiente?.()
        return
      }
      console.error('rider-accept fallo:', res?.error)
      alert('No se pudo aceptar el pedido. Revisa tu conexión e inténtalo de nuevo.')
      setBusy(null)
    } catch (e) {
      console.error('rider-accept error:', e)
      alert('No se pudo aceptar el pedido. Revisa tu conexión e inténtalo de nuevo.')
      setBusy(null)
    }
  }

  async function handleReject() {
    if (busy) return
    setBusy('reject')
    try {
      const res = await riderRejectOrder(asignacionPendiente.id, 'rider_rechaza')
      if (res?.sessionDead) {
        alert('Tu sesión ha caducado. Vuelve a iniciar sesión.')
        try { await supabase.auth.signOut() } catch (_) {}
      }
    } finally { dismissPendiente?.() }
  }

  function handleTimeout() {
    // Cerrar la asignación en el backend para que se reasigne ya (no esperar al cron).
    // Best-effort: aunque falle, cerramos el modal localmente.
    const id = asignacionPendiente?.id
    if (id) { try { riderRejectOrder(id, 'timeout') } catch (_) {} }
    dismissPendiente?.()
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 100,
      background: 'rgba(26,24,21,0.92)', backdropFilter: 'blur(6px)',
      display: 'flex', flexDirection: 'column',
      paddingTop: 'calc(env(safe-area-inset-top, 0px) + 24px)',
      paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 18px)',
      paddingLeft: 18, paddingRight: 18,
      fontFamily: "'Plus Jakarta Sans', sans-serif",
      animation: 'fadeIn 0.18s ease',
    }}>
      <div style={{ textAlign: 'center', marginBottom: 22 }}>
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 7,
          background: 'rgba(255,255,255,0.10)', color: '#fff',
          padding: '6px 14px', borderRadius: 999,
          fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
        }}>
          <Bike size={13} /> Nuevo pedido asignado
        </div>
      </div>

      <div style={{
        background: colors.paper, borderRadius: 22,
        padding: 24, marginBottom: 16,
        flex: 1, display: 'flex', flexDirection: 'column', gap: 16,
        animation: 'slideUp 0.25s ease',
      }}>
        <style>{`@keyframes slideUp { from { transform: translateY(20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }`}</style>

        {/* Tarifa FIJA pactada con este restaurante: el rider cobra siempre lo mismo
            por entrega, sin importar la distancia. Debe verlo ANTES de aceptar. */}
        {esTarifaFija && (
          <div style={{
            borderRadius: 12, padding: '11px 13px',
            background: colors.sageSoft, color: colors.sage2,
            fontSize: 12.5, fontWeight: 700, lineHeight: 1.4,
            border: `1px solid ${colors.sage}`,
          }}>
            Tarifa fija pactada con {est.nombre || 'este restaurante'}: {importeFijo.toFixed(2).replace('.', ',')} € por entrega, vaya donde vaya.
          </div>
        )}

        {/* Pedido telefónico: el rider cobra SOLO el envío (sin % del subtotal).
            Tiene que quedarle claro ANTES de aceptar. */}
        {esTelefonico && (
          <div style={{
            borderRadius: 12, padding: '11px 13px',
            background: colors.infoSoft, color: colors.info,
            fontSize: 12.5, fontWeight: 700, lineHeight: 1.4,
            border: `1px solid ${colors.info}`,
          }}>
            Pedido telefónico: cobras SOLO el envío. Este tipo de pedido no lleva comisión.
          </div>
        )}

        {/* v51/v52: 3 avisos segun round-robin. Prioridad: ultima vuelta + responsable >
            ultima vuelta > responsable (primera asignacion). */}
        {esUltimaVuelta && esResponsable ? (
          <div style={{
            borderRadius: 12, padding: '11px 13px',
            background: colors.warningSoft, color: colors.warning,
            fontSize: 12.5, fontWeight: 700, lineHeight: 1.4,
            border: `1px solid ${colors.warning}`,
          }}>
            Última vuelta y eres el responsable. Si no lo aceptas, el pedido se cancela y TÚ asumes el coste de la comida.
          </div>
        ) : esUltimaVuelta ? (
          <div style={{
            borderRadius: 12, padding: '11px 13px',
            background: colors.warningSoft, color: colors.warning,
            fontSize: 12.5, fontWeight: 700, lineHeight: 1.4,
            border: `1px solid ${colors.warning}`,
          }}>
            Última vuelta. Si nadie lo acepta, el pedido se cancelará.
          </div>
        ) : esResponsable ? (
          <div style={{
            borderRadius: 12, padding: '11px 13px',
            background: colors.infoSoft, color: colors.info,
            fontSize: 12.5, fontWeight: 700, lineHeight: 1.4,
            border: `1px solid ${colors.info}`,
          }}>
            Eres el primer asignado: eres el responsable de este pedido.
          </div>
        ) : null}

        {/* MINI-MAPA: recogida (terracotta) + entrega (verde). Oculto si falta key/coords. */}
        {mapaUrl && (
          <div style={{
            width: '100%', height: 130, borderRadius: 14, overflow: 'hidden',
            border: `1px solid ${colors.border}`, background: colors.cream2,
          }}>
            <img
              src={mapaUrl}
              alt="Mapa del reparto"
              onError={(e) => { const p = e.currentTarget.parentElement; if (p) p.style.display = 'none' }}
              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
            />
          </div>
        )}

        <div>
          <div style={{
            fontSize: 11, color: colors.stone, fontWeight: 700,
            letterSpacing: '0.06em', textTransform: 'uppercase',
          }}>Restaurante</div>
          <div style={{ fontSize: 19, fontWeight: 800, color: colors.ink, marginTop: 2 }}>
            {est.nombre || 'Restaurante'}
          </div>
          {est.direccion && (
            <div style={{
              display: 'flex', alignItems: 'flex-start', gap: 5,
              fontSize: 12, color: colors.stone, marginTop: 4,
            }}>
              <MapPin size={12} strokeWidth={2.2} style={{ flexShrink: 0, marginTop: 1 }} />
              <span>{est.direccion}</span>
            </div>
          )}
        </div>

        <div style={{ height: 1, background: colors.border }} />

        <div>
          <div style={{
            fontSize: 11, color: colors.stone, fontWeight: 700,
            letterSpacing: '0.06em', textTransform: 'uppercase',
          }}>Entregar en</div>
          <div style={{
            display: 'flex', alignItems: 'flex-start', gap: 5,
            fontSize: 14, color: colors.ink, marginTop: 4, fontWeight: 600,
          }}>
            <MapPin size={14} strokeWidth={2.2} style={{ flexShrink: 0, marginTop: 2, color: colors.terracotta }} />
            <span>{pedido.direccion_entrega || '—'}</span>
          </div>
          {(pedido.cliente_telefono || pedido.guest_telefono) && (
            <a
              href={`tel:${pedido.cliente_telefono || pedido.guest_telefono}`}
              onClick={(e) => e.stopPropagation()}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                marginTop: 10, padding: '8px 14px', borderRadius: 10,
                background: colors.sageSoft, color: colors.sage2,
                fontSize: 13, fontWeight: 700, textDecoration: 'none',
              }}
            >
              <Phone size={14} strokeWidth={2.4} /> Llamar al cliente
            </a>
          )}
        </div>

        <div style={{ height: 1, background: colors.border }} />

        {/* Total del pedido = lo que cobra al cliente */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <div>
            <div style={{ fontSize: 12, color: colors.stone, fontWeight: 600 }}>Total del pedido</div>
            <div style={{ fontSize: 10, color: colors.stone2 }}>Lo que cobra al cliente</div>
          </div>
          <div style={{ fontSize: 20, fontWeight: 800, color: colors.ink }}>
            {total.toFixed(2).replace('.', ',')} €
          </div>
        </div>

        {/* Tu ganancia = lo que gana el socio (destacado en verde) */}
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
          background: colors.sageSoft, borderRadius: 12, padding: '10px 12px',
          border: `1px solid ${colors.sage}`,
        }}>
          <div>
            <div style={{ fontSize: 12, color: colors.sage2, fontWeight: 700 }}>Tu ganancia</div>
            <div style={{ fontSize: 10, color: colors.stone }}>
              {esTarifaFija
                ? `Tarifa fija pactada · ${importeFijo.toFixed(2).replace('.', ',')} € por entrega`
                : (esTelefonico ? 'Solo envío · sin comisión' : (isDelivery ? 'Envío + 10% + propina' : '10% del subtotal'))}
            </div>
          </div>
          <div style={{ fontSize: 22, fontWeight: 800, color: colors.sage2 }}>
            {ganancia.total.toFixed(2).replace('.', ',')} €
          </div>
        </div>
      </div>

      {/* Countdown */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
        color: '#fff', marginBottom: 14,
      }}>
        <Clock size={14} strokeWidth={2.4} />
        <span style={{ fontSize: 13, fontFamily: 'ui-monospace, monospace', fontWeight: 700 }}>
          {timeStr}
        </span>
        <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.65)' }}> · responde antes</span>
      </div>

      <div style={{ display: 'flex', gap: 10 }}>
        <button
          onClick={handleReject}
          disabled={busy === 'accept'}
          style={{
            flex: 1, padding: '14px', borderRadius: 14, border: 'none',
            background: 'rgba(255,255,255,0.10)', color: '#fff',
            fontWeight: 700, fontSize: 14, cursor: 'pointer', fontFamily: 'inherit',
            opacity: busy ? 0.6 : 1,
          }}
        >
          {busy === 'reject' ? 'Rechazando…' : 'Rechazar'}
        </button>
        <button
          onClick={handleAccept}
          disabled={busy === 'reject'}
          style={{
            flex: 2, padding: '14px', borderRadius: 14, border: 'none',
            background: `linear-gradient(180deg, ${colors.terracotta} 0%, ${colors.terracotta2} 100%)`,
            color: '#fff', fontWeight: 800, fontSize: 15, cursor: 'pointer', fontFamily: 'inherit',
            boxShadow: '0 8px 20px rgba(197,86,44,0.40), inset 0 1px 0 rgba(255,255,255,0.18)',
            opacity: busy ? 0.6 : 1,
          }}
        >
          {busy === 'accept' ? 'Aceptando…' : 'Aceptar pedido'}
        </button>
      </div>
    </div>
  )
}
