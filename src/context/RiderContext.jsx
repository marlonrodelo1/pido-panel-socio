// RiderContext — Estado central de la app rider.
//
// Responsabilidades:
//   - Cargar el socio del usuario logueado (`socios.user_id = user.id`).
//   - Tracking online/offline optimista con llamadas a rider-online/offline.
//   - GPS loop integrado con riderGeo cuando está online.
//   - Realtime: detectar nuevas filas en `pedido_asignaciones` con `socio_id` y
//     `estado='esperando_aceptacion'` → dispara modal pedido entrante.
//   - Listener push nativo para fallback cuando realtime no llega (app cerrada).
//   - Listado de asignaciones activas (aceptado, recogido, en_camino) para
//     RiderPedidos.jsx.
//
// API expuesta:
//   { socio, isOnline, asignacionPendiente, asignacionesActivas,
//     setOnline(boolean), dismissPendiente(), refreshAsignaciones() }

import { createContext, useContext, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { isAuthRetryableFetchError } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { useSocio } from './SocioContext'
import { riderOnline, riderOffline, riderHeartbeat, riderPresenceToken } from '../lib/riderApi'
import { startTracking, stopTracking, getCurrentPosition, requestLocationPermission, captureAndPush, openLocationSettings } from '../lib/riderGeo'
import { onPushReceived, onPushTapped } from '../lib/pushNative'
import { armOfflineBeacon, disarmOfflineBeacon, refreshOfflineBeaconToken, armPresenceBeat, disarmPresenceBeat, checkPresencePrereqs, consumeClosedFlag, marcarPedidoEnCurso } from '../lib/offlineBeacon'
import { comprobarMovil } from '../lib/comprobacionMovil'
import { isNativePlatform, getPlugin, getDeviceId } from '../lib/capacitor'
import { installPedidoSoundUnlock } from '../lib/pedidoSound'
import LocationDisclosureModal from '../components/LocationDisclosureModal'
import ComprobacionMovilModal from '../components/ComprobacionMovilModal'

const RiderCtx = createContext(null)
export const useRider = () => useContext(RiderCtx)

// v305: aviso en pantalla cuando no se pudo completar el Fuera de línea de un cierre del todo.
const MSG_CIERRE_SIN_RED = 'No hemos podido ponerte Fuera de línea porque no hay conexión. Lo volveremos a intentar cuando vuelvas a la app.'

export function RiderProvider({ children }) {
  const { socio, user, refreshSocio } = useSocio() || {}
  const [isOnline, setIsOnline] = useState(false)
  const [needsLocation, setNeedsLocation] = useState(false) // online sin permiso GPS → banner
  const [actionError, setActionError] = useState(null)      // error de red al conectar/desconectar
  const [asignacionPendiente, setAsignacionPendiente] = useState(null) // { id, pedido_id, codigo, ... }
  const [asignacionesActivas, setAsignacionesActivas] = useState([]) // pedidos en curso del rider
  const channelRef = useRef(null)
  const lastFetchRef = useRef(0)
  const lastPosRef = useRef(null)   // última posición GPS conocida (para el latido)
  const togglingRef = useRef(false) // mutex: hay un setOnline en vuelo (evita toggles cruzados)
  const toggleGenRef = useRef(0)    // v305: sube en cada pulsación del botón (ver apagarTrasCierre)
  const dismissedIdsRef = useRef(new Set()) // asignaciones ya descartadas localmente (no re-mostrar)
  const [showDisclosure, setShowDisclosure] = useState(false)
  const disclosureResolveRef = useRef(null)
  // v307: comprobación del móvil (ver lib/comprobacionMovil.js). `problemasMovil` = lo que falla
  // AHORA estando En línea (se mira al volver a la app) → banner en la pantalla principal.
  const [comprobacion, setComprobacion] = useState({ open: false, lista: [], comprobando: false, soloRevisar: false })
  const comprobacionResolveRef = useRef(null)
  const [problemasMovil, setProblemasMovil] = useState([])
  const deviceIdRef = useRef(null)     // id de este dispositivo (single-device)
  const supersededRef = useRef(false)  // ya se detecto que otro dispositivo tomo la cuenta
  // true mientras el RECLAMO del dispositivo (rider-online) está en vuelo. El latido no
  // debe correr en ese hueco: llegaría con el candado del dispositivo anterior y provocaría
  // un 409 sesion_superada espurio (logout). Regresión del 10-jul; se reutiliza también en
  // el re-reclamo al reabrir la app (last-wins single-device, ver efecto de init de abajo).
  const claimPendingRef = useRef(false)

  // Handler de fallo del watcher nativo (permiso denegado / GPS del sistema off).
  // El watcher entrega el error de forma asíncrona; aquí encendemos el banner para
  // que el rider sepa que está "en línea pero ciego" y pueda reactivar la ubicación.
  const handleWatcherError = useCallback((err) => {
    if (err?.code === 'NOT_AUTHORIZED') setNeedsLocation(true)
  }, [])

  // ─── ¿Qué pasa al ARRANCAR la app? (corregido el 28-sep-2026) ───
  // El comentario anterior decía "al arrancar empezamos SIEMPRE offline; nunca auto-encendemos
  // online desde el DB", y el código hacía lo contrario (reanudar el turno). Lo que hace de
  // verdad, según la regla de Marlon ("el socio SOLO queda Fuera de línea si pulsa su botón o
  // CIERRA LA APP DEL TODO"):
  //  1) Si el socio CERRÓ LA APP DEL TODO estando En línea (marca del nativo): NO se reanuda.
  //     Para volver tiene que pulsar En línea. Normalmente el nativo ya le puso Fuera de línea;
  //     si ese apagado no llegó (sin red al cerrar), se completa aquí (motivo
  //     'arranque_tras_cierre').
  //  2) Si no hay marca (el SISTEMA mató la app: ahorro de batería, memoria, o iOS la relanza en
  //     segundo plano con el ping silencioso), se mantiene lo que diga la BD: seguía En línea y
  //     dio el consentimiento de ubicación → se REANUDA el turno (tracking + latido).
  //  3) Sin el consentimiento de ubicación guardado (reinstalación, móvil nuevo) → Fuera de
  //     línea (motivo 'sin_consentimiento'): sin ubicación no se le pueden asignar pedidos.
  // La marca se LEE sin borrarla (soloLeer) y solo se borra cuando el Fuera de línea está
  // CONFIRMADO: la BD ya dice en_servicio=false o rider-offline respondió bien (revisión del
  // 28-sep). Antes se borraba nada más abrir: si el apagado fallaba (sin red, o el socio volvía a
  // cerrar la app durante los reintentos), la BD seguía En línea sin marca y el SIGUIENTE
  // arranque caía en el caso 2 y reanudaba el turno solo, justo lo que la regla prohíbe.
  // En segundo plano (App.getState().isActive=false, el ping de iOS) tampoco se borra: "abrir la
  // app" es cosa del socio; se borra cuando la abra (ver el efecto de volver del segundo plano).
  // Tras el arranque solo se reflejan cambios EXTERNOS hacia offline (superadmin, respaldo del
  // servidor); nunca se enciende online desde la BD.
  const didInitRef = useRef(false)
  const socioRef = useRef(socio)
  socioRef.current = socio
  const marcaCierreRef = useRef(false)    // hay una marca de cierre del todo sin borrar
  const apagandoCierreRef = useRef(false) // apagarTrasCierre en marcha (no lanzar dos)
  const appActivaRef = useRef(true)       // la app está delante (no lanzada en segundo plano)

  // El Fuera de línea tras el cierre está confirmado → fuera la marca (y el aviso de la bandeja).
  // Solo con la app delante: en segundo plano se deja para cuando el socio la abra.
  const cerrarMarcaCierre = (activa) => {
    if (!activa) return
    marcaCierreRef.current = false
    consumeClosedFlag().catch(() => {})
  }

  // Completa un apagado que el nativo no pudo mandar al cerrar la app (sin red). Reintenta a los
  // 5 s, 15 s, 30 s y 1 min; no insiste si otro dispositivo tiene la cuenta (409). Usa el MISMO
  // candado que el botón (togglingRef) mientras la petición está en vuelo: si el socio pulsa En
  // línea justo al abrir, su "En línea" no puede quedar pisado por este apagado que llega tarde.
  // Y si ya ha pulsado el botón (toggleGenRef cambió), manda lo suyo.
  // Si no lo consigue, la marca SE QUEDA: el siguiente arranque (o volver a la app) lo reintenta
  // y nunca reanuda el turno solo.
  // En Android corre A LA VEZ que el reintento del servicio nativo (si sigue vivo): los dos mandan
  // el mismo apagado, que es idempotente, y el del nativo sobrevive a que el socio vuelva a cerrar
  // la app. Si lo consigue el nativo, el efecto de "cambios externos" limpia la marca.
  // La llave de presencia no se revoca aquí: el nativo ya está desarmado y el próximo
  // "En línea" la rota.
  const apagarTrasCierre = async ({ activa = true } = {}) => {
    if (apagandoCierreRef.current) return
    apagandoCierreRef.current = true
    const gen = toggleGenRef.current
    const esperas = [5_000, 15_000, 30_000, 60_000]
    try {
      for (let intento = 0; ; intento++) {
        if (toggleGenRef.current !== gen || togglingRef.current) return
        togglingRef.current = true
        let res = null
        try {
          res = await riderOffline('arranque_tras_cierre').catch(() => null)
        } finally {
          togglingRef.current = false
        }
        if (res?.ok) {
          cerrarMarcaCierre(activa)
          setActionError(null)
          refreshSocio?.()
          return
        }
        if (res?.sessionDead) {
          // La marca se queda: al volver a iniciar sesión se reintenta (sin reanudar el turno).
          setActionError('Tu sesión ha caducado. Vuelve a iniciar sesión.')
          try { await supabase.auth.signOut() } catch (_) {}
          return
        }
        // Otro dispositivo tiene la cuenta: este no puede (ni debe) tocar su turno. La marca se
        // queda para que ESTE móvil no reanude solo; se borra si aquí se pulsa En línea.
        if (res?.status === 409) return
        if (intento >= esperas.length) break
        await new Promise((r) => setTimeout(r, esperas[intento]))
        if (socioRef.current && !socioRef.current.en_servicio) { // ya lo apagó otra vía
          cerrarMarcaCierre(activa)
          return
        }
      }
      if (activa) setActionError(MSG_CIERRE_SIN_RED)
    } finally {
      apagandoCierreRef.current = false
    }
  }

  const arrancarTurno = async () => {
    let consented = false
    try { consented = localStorage.getItem('pidoo_bg_loc_consent') === '1' } catch (_) {}
    const nativo = await isNativePlatform()
    // ¿La ha abierto el socio o la ha lanzado el sistema en segundo plano (ping de iOS)?
    let activa = true
    if (nativo) {
      try {
        const App = (await getPlugin('App'))?.plugin
        if (App?.getState) {
          const st = await App.getState()
          activa = st?.isActive !== false
        }
      } catch (_) { /* sin plugin App: se trata como apertura normal */ }
    }
    appActivaRef.current = activa
    // Solo LEER: se borra cuando el Fuera de línea esté confirmado (ver cabecera).
    const cierre = nativo ? await consumeClosedFlag({ soloLeer: true }) : null
    // Valor ACTUAL (durante los await pudo llegar un cambio externo).
    const s = socioRef.current
    if (!s) return

    if (cierre?.cerrada) {
      // (1) Cerró la app del todo: NO reanudar.
      marcaCierreRef.current = true
      setIsOnline(false)
      disarmOfflineBeacon()
      if (s.en_servicio) {
        // El apagado del cierre no llegó. Si el servicio de Android sigue reintentándolo (modo
        // reintento, ver PresenceBeatService) NO se para: si el socio vuelve a cerrar la app
        // antes de que esto lo consiga, ese reintento sigue solo y apaga en cuanto haya red.
        // (Ya está desarmado desde el cierre; se corta al pulsar En línea, ver setOnline.)
        apagarTrasCierre({ activa })
      } else {
        disarmPresenceBeat()
        cerrarMarcaCierre(activa) // la BD ya dice Fuera de línea: confirmado
      }
      return
    }

    if (s.en_servicio && consented) {
      // (2) REANUDAR turno: seguía En servicio y ya dio el consentimiento de ubicación
      // → mantener online y RE-ARRANCAR el tracking (que de verdad comparta, no solo
      // la UI). Así reabrir la app NO te apaga. El latido (efecto de abajo) revive solo
      // al pasar isOnline=true.
      //
      // RE-RECLAMO al abrir (last-wins single-device): `en_servicio` es una columna
      // COMPARTIDA entre dispositivos. Si otro dispositivo la dejó en true, ESTE —el que
      // ACABA de abrir/loguear— debe RECLAMAR active_device_id (rider-online) ANTES de
      // empezar a latir. Si no, el latido saldría con el id de ESTE dispositivo mientras
      // active_device_id sigue siendo el del OTRO → 409 sesion_superada → ESTE (el nuevo)
      // se desloguea y gana el viejo, justo lo contrario de "el último gana". Reclamando
      // aquí, el nuevo pasa a ser el activo y el anterior queda superado limpiamente (su
      // realtime ve el cambio de active_device_id → handleSuperseded). claimPendingRef
      // silencia el latido inmediato mientras el reclamo está en vuelo (mismo guard de la
      // regresión del 10-jul). Corre una sola vez por montaje (envuelto por didInitRef).
      claimPendingRef.current = true
      setIsOnline(true)
      armOfflineBeacon() // Parte B: re-armar el beacon de cierre al reanudar turno
      armPresenceBeat()  // v300: re-armar el latido nativo (rota la llave de presencia)
      riderOnline({})
        .then((res) => {
          // Éxito → este dispositivo ya es active_device_id. Un fallo de SESIÓN muerta lo
          // detecta y gestiona el latido (fuerza re-login); un fallo de RED se ignora a
          // propósito: NO hard-logout, NO revertimos en_servicio. El latido reintentará y,
          // sin red, tampoco recibiría un 409 limpio que dispare un logout espurio.
          if (!res?.ok) console.warn('[RiderContext] re-reclamo al abrir no OK:', res?.error)
        })
        .catch((e) => console.warn('[RiderContext] re-reclamo al abrir excepción:', e?.message))
        .finally(() => { claimPendingRef.current = false })
      requestLocationPermission().then((granted) => {
        setNeedsLocation(!granted)
        if (granted) startTracking({ onUpdate: (pos) => { lastPosRef.current = pos }, onError: handleWatcherError })
      })
    } else {
      // (3) Primer login / sin consentimiento previo / estaba offline → empezar offline
      // (aquí, al pulsar "En servicio", sale el aviso + se piden permisos).
      setIsOnline(false)
      // v307: SOLO en la app nativa. En la web (vista previa, socio.pidoo.es) este
      // consentimiento no se guarda nunca, así que abrir la web con el socio En línea en su
      // móvil lo echaba de línea (pasó el 5-oct con deltafood). Un navegador no puede apagar
      // al socio: eso es del botón o de cerrar la app del todo.
      if (nativo && s.en_servicio) { riderOffline('sin_consentimiento').catch(() => {}) }
    }
  }

  useEffect(() => {
    if (!socio) return
    if (!didInitRef.current) {
      didInitRef.current = true
      arrancarTurno()
      return
    }
    // Cambios externos posteriores (superadmin, respaldo del servidor) → reflejar offline.
    // Importante: además de la UI, hay que PARAR el tracking nativo; si no, el
    // foreground service y los POST de ubicación siguen corriendo con el rider
    // ya offline en DB (batería + privacidad). v305: salvo que lleve un pedido encima,
    // que el cliente sigue viendo en el mapa (ver "GPS del reparto" más abajo).
    if (!socio.en_servicio) {
      setIsOnline(false)
      setNeedsLocation(false)
      pararGpsSalvoReparto()
      disarmOfflineBeacon()
      disarmPresenceBeat() // v300: apagar también el latido nativo
      lastPosRef.current = null
      // v305: el Fuera de línea pendiente de un cierre del todo ha llegado por otra vía (el
      // reintento del servicio de Android, o el superadmin): confirmado. Fuera la marca si la app
      // está delante, y el aviso de "no hemos podido" deja de ser verdad.
      if (marcaCierreRef.current) {
        cerrarMarcaCierre(appActivaRef.current)
        setActionError((e) => (e === MSG_CIERRE_SIN_RED ? null : e))
      }
    }
  }, [socio?.id, socio?.en_servicio, handleWatcherError])

  // ─── GPS del reparto con el socio Fuera de línea (v305) ───
  // Fuera de línea = no recibe pedidos NUEVOS. Pero si tiene uno aceptado sin entregar, el
  // cliente sigue mirando el mapa: la posición tiene que seguir llegando
  // (rider-update-location no mira en_servicio, a propósito). Caso típico: cierra la app a
  // mitad de un reparto → el nativo le pone Fuera de línea → al reabrir no se reanuda el turno,
  // pero el GPS del reparto sí arranca. Cuando entrega (ya no hay pedido en curso), se para.
  const pedidoEnCursoRef = useRef(false)
  const repartoTrackingRef = useRef(false) // el GPS actual lo mantiene el reparto, no el turno
  const pararGpsSalvoReparto = () => {
    if (pedidoEnCursoRef.current) {
      repartoTrackingRef.current = true // sigue compartiendo; lo parará el efecto al entregar
      return
    }
    stopTracking()
  }

  // Disclosure obligatoria de Google Play (ubicación en segundo plano): se muestra
  // ANTES de pedir el permiso, una sola vez (consentimiento guardado en localStorage).
  // En web no aplica. Devuelve true si el usuario acepta (o ya consintió antes).
  const ensureBgConsent = async () => {
    if (!(await isNativePlatform())) return true
    try { if (localStorage.getItem('pidoo_bg_loc_consent') === '1') return true } catch (_) {}
    const ok = await new Promise((resolve) => {
      disclosureResolveRef.current = resolve
      setShowDisclosure(true)
    })
    setShowDisclosure(false)
    disclosureResolveRef.current = null
    if (ok) { try { localStorage.setItem('pidoo_bg_loc_consent', '1') } catch (_) {} }
    return ok
  }

  // ─── Acción: cambiar online/offline ────────────────────────
  // El estado online lo fija la edge `rider-online` (fuente de verdad). El permiso
  // GPS es BEST-EFFORT: si falta, NO bloqueamos ni revertimos el online — la edge
  // pone en_servicio aunque no haya coordenadas y avisamos con `needsLocation`
  // (banner en RiderEsperando). Solo revertimos si la edge falla de verdad (red).
  // iOS bloquea el autoplay del sonido del modal: desbloquearlo con el primer
  // gesto del usuario en la app (cualquier toque).
  useEffect(() => { installPedidoSoundUnlock() }, [])

  // ─── v307: comprobación del móvil ─────────────────────────
  // Antes de ponerse En línea (Android): notificaciones, sonido del aviso de pedidos, volumen de
  // alarma, batería, ubicación "siempre" e Inicio automático. Si todo está bien, no se enseña
  // nada. Si algo falla, pantalla con cada arreglo; resuelve true al pulsar "Ponerme En línea"
  // con todo en verde, false si el socio dice "Ahora no".
  const recomprobarMovil = async () => {
    setComprobacion((c) => ({ ...c, comprobando: true }))
    try {
      const { lista, fallos } = await comprobarMovil()
      setComprobacion((c) => ({ ...c, lista, comprobando: false }))
      setProblemasMovil(fallos)
    } catch (_) {
      setComprobacion((c) => ({ ...c, comprobando: false }))
    }
  }
  const pedirComprobacion = async ({ soloRevisar = false } = {}) => {
    let r
    try { r = await comprobarMovil() } catch (_) { return true }
    setProblemasMovil(r.fallos)
    if (!soloRevisar && r.fallos.length === 0) return true
    return new Promise((resolve) => {
      comprobacionResolveRef.current = resolve
      setComprobacion({ open: true, lista: r.lista, comprobando: false, soloRevisar })
    })
  }
  const cerrarComprobacion = (resultado) => {
    setComprobacion((c) => ({ ...c, open: false }))
    const res = comprobacionResolveRef.current
    comprobacionResolveRef.current = null
    res?.(resultado)
  }
  // Estando En línea, al volver a la app se mira otra vez (el socio pudo quitar el sonido o el
  // sistema resetear un permiso). Si algo falla, banner en la pantalla principal.
  useEffect(() => {
    if (!isOnline) { setProblemasMovil([]); return }
    let vivo = true
    const mirar = () => {
      if (document.visibilityState !== 'visible') return
      comprobarMovil().then((r) => { if (vivo) setProblemasMovil(r.fallos) }).catch(() => {})
    }
    mirar()
    document.addEventListener('visibilitychange', mirar)
    return () => { vivo = false; document.removeEventListener('visibilitychange', mirar) }
  }, [isOnline])

  const setOnline = async (next) => {
    // Mutex: si ya hay un cambio de estado en vuelo, ignoramos el segundo tap
    // (posiblemente desde otro toggle en otra pantalla). Evita que un online y un
    // offline concurrentes dejen la UI, la DB y el watcher desincronizados.
    if (togglingRef.current) return { ok: false, busy: true }
    togglingRef.current = true
    toggleGenRef.current += 1
    setActionError(null)
    if (next) {
      // === IR ONLINE (OPTIMISTA) ===
      // v305: si queda el apagado pendiente de un cierre del todo, se corta ANTES el reintento
      // del servicio de Android (sigue vivo a propósito, ver arrancarTurno): si no, un apagado
      // suyo que llegara tarde podría caer DESPUÉS de este En línea y dejarlo desconectado.
      if (marcaCierreRef.current) await disarmPresenceBeat()
      // El consentimiento y el permiso se piden ANTES de marcar la UI como online,
      // para no mostrar "En línea" mientras el modal de disclosure sigue abierto.
      // Son instantáneos si ya se concedieron.
      const consent = await ensureBgConsent()
      if (!consent) {
        setIsOnline(false)
        togglingRef.current = false
        // v305: esta pulsación paró un apagado pendiente tras cerrar la app: retomarlo.
        if (marcaCierreRef.current && socioRef.current?.en_servicio) apagarTrasCierre()
        return { ok: false, declined: true }
      }
      const granted = await requestLocationPermission()
      setNeedsLocation(!granted)
      // v307: sin el móvil preparado no se pone En línea (caso Edinson: pedidos que no sonaban).
      const listo = await pedirComprobacion()
      if (!listo) {
        setIsOnline(false)
        togglingRef.current = false
        if (marcaCierreRef.current && socioRef.current?.en_servicio) apagarTrasCierre()
        return { ok: false, declined: true }
      }
      // UI INSTANTÁNEA: pintamos "En línea" YA. GPS y edge corren en segundo plano.
      // claimPendingRef silencia el latido hasta que rider-online reclame el dispositivo.
      claimPendingRef.current = true
      setIsOnline(true)
      ;(async () => {
        let volverAApagar = false
        try {
          // 1) RECLAMAR PRIMERO, sin esperar al GPS: la edge acepta sin coordenadas y
          //    estampa last_location_at (cuenta como señal fresca para el dispatcher).
          //    Si esperásemos al primer fix (1-3s), el latido inmediato correría con el
          //    candado del dispositivo anterior → 409 sesion_superada → logout espurio.
          const res = await riderOnline({})
          claimPendingRef.current = false
          if (!res.ok) {
            // La edge falló de verdad (red/sesión) → revertimos el online optimista.
            setIsOnline(false)
            if (res.sessionDead) {
              setActionError('Tu sesión ha caducado. Vuelve a iniciar sesión.')
              try { await supabase.auth.signOut() } catch (_) {}
            } else {
              setActionError('No se pudo conectar. Revisa tu conexión e inténtalo de nuevo.')
              // v305: si quedaba pendiente el apagado de un cierre del todo (sin red), la pantalla
              // vuelve a decir Fuera de línea: la BD tiene que decir lo mismo. Se retoma al soltar
              // el candado (este intento de En línea paró el anterior al cambiar toggleGenRef).
              volverAApagar = marcaCierreRef.current && !!socioRef.current?.en_servicio
            }
            return
          }
          // 2) GPS después: primer fix + tracking continuo + push inmediato de posición.
          if (granted) {
            try { const pos = await getCurrentPosition(); if (pos) lastPosRef.current = pos } catch (_) {}
            startTracking({ onUpdate: (p) => { lastPosRef.current = p }, onError: handleWatcherError })
            captureAndPush()
          }
          // Parte B: armar el beacon de cierre. v300: armar el latido nativo de presencia.
          armOfflineBeacon()
          armPresenceBeat()
          // v305: volver a pulsar En línea anula una marca de cierre que no se llegara a leer
          // (el nativo también la borra al armar; esto cubre el caso de que armar falle) y
          // retira el aviso de cierre de la bandeja.
          marcaCierreRef.current = false
          consumeClosedFlag().catch(() => {})
          // v300: chequeo PROACTIVO de requisitos de fondo. Antes esperábamos al fallo
          // asíncrono del watcher para enterarnos; ahora, al ponerse online:
          //  - sin "Permitir siempre" → banner de ubicación al momento (las
          //    actualizaciones de Play a veces resetean ese permiso);
          //  - sin exención de batería → abrir ajustes, máx. 1 vez al día (si insistimos
          //    en cada toggle, el socio deja de leer).
          // v307: batería e Inicio automático ya los exige la comprobación del móvil antes de
          // llegar aquí (antes se pedían una vez al día / una sola vez, y el Inicio automático
          // solo si la batería ya estaba bien: a Edinson nunca se le llegó a pedir).
          try {
            const pre = await checkPresencePrereqs()
            if (pre && pre.bgLocation === false) setNeedsLocation(true)
          } catch (_) {}
          refreshSocio?.()
        } finally {
          claimPendingRef.current = false
          // El mutex se mantiene durante todo el trabajo de fondo (evita que un tap de
          // offline entre a medias) y se libera aquí al terminar.
          togglingRef.current = false
          if (volverAApagar) apagarTrasCierre()
        }
      })()
      return { ok: true, optimistic: true }
    } else {
      // === IR OFFLINE (OPTIMISTA) ===
      // UI INSTANTÁNEA: pintamos "Offline" YA; la edge corre en segundo plano igual
      // que en el camino online (misma queja de Marlon en ambos sentidos: el toggle
      // no puede quedarse "pensando" lo que dure la red).
      // OJO: no paramos el tracking hasta confirmar que la desconexión fue OK.
      // Si riderOffline() falla por red, revertimos a online y el GPS/latido deben
      // seguir vivos (si paráramos el tracking antes, quedaría "online + latiendo"
      // pero sin posición, justo lo que este sistema quiere evitar).
      setIsOnline(false)
      ;(async () => {
        try {
          const res = await riderOffline('boton') // v305: motivo en socio_presencia_log
          if (!res.ok) {
            if (res.sessionDead) {
              stopTracking()
              disarmOfflineBeacon()
              disarmPresenceBeat() // v300
              lastPosRef.current = null
              setActionError('Tu sesión ha caducado. Vuelve a iniciar sesión.')
              try { await supabase.auth.signOut() } catch (_) {}
            } else {
              // Fallo de red real → seguimos en servicio: revertimos el offline optimista.
              setIsOnline(true)
              setActionError('No se pudo desconectar. Inténtalo de nuevo.')
            }
            return
          }
          pararGpsSalvoReparto() // v305: con un pedido encima el cliente sigue viendo el mapa
          disarmOfflineBeacon() // Parte B: desconexión manual -> desarmar beacon
          disarmPresenceBeat()  // v300: parar el latido nativo
          // Higiene: la llave deja de valer. v305: con await, DENTRO del candado. Antes iba
          // suelta y, si el socio pulsaba En línea enseguida, este "revocar" podía llegar
          // DESPUÉS del "emitir" del nuevo En línea y borrar la llave recién creada: el latido
          // nativo y el apagado al cerrar la app se quedarían sin llave hasta el siguiente
          // En línea. (Carrera posible por orden de llegada; no se ha visto en producción.)
          await riderPresenceToken('revocar').catch(() => {})
          lastPosRef.current = null
          setNeedsLocation(false)
          refreshSocio?.()
        } finally {
          // El mutex se mantiene durante la desconexión en vuelo (evita que un tap
          // de online entre a medias) y se libera aquí al terminar.
          togglingRef.current = false
        }
      })()
      return { ok: true, optimistic: true }
    }
  }

  // Reintentar el permiso de ubicación desde el banner. Si se concede y ya
  // estamos online, arranca el tracking y empuja una posición; si sigue
  // denegado, abre los ajustes del sistema para que el usuario lo active.
  const retryLocation = async () => {
    const granted = await requestLocationPermission()
    setNeedsLocation(!granted)
    if (granted) {
      if (isOnline) { startTracking({ onUpdate: (pos) => { lastPosRef.current = pos }, onError: handleWatcherError }); captureAndPush() }
      // v305: con el permiso "solo mientras se usa la app" el GPS va en primer plano, pero al
      // guardar la app el móvil la suspende: ni latido, ni pedidos por cercanía, ni (en iPhone)
      // aviso al cerrarla. "Permitir siempre" solo se elige en Ajustes: se abren directamente.
      // (Hasta la 305 en iPhone esto no se sabía: el plugin no respondía.)
      try {
        const pre = await checkPresencePrereqs()
        if (pre && pre.bgLocation === false) openLocationSettings()
      } catch (_) {}
    } else {
      openLocationSettings()
    }
    return granted
  }

  const clearActionError = () => setActionError(null)

  // ─── Single-device: cerrar sesion si otro dispositivo toma la cuenta ──
  useEffect(() => { getDeviceId().then((id) => { deviceIdRef.current = id }).catch(() => {}) }, [])

  const handleSuperseded = useCallback(async () => {
    if (supersededRef.current) return
    supersededRef.current = true
    setIsOnline(false)
    stopTracking()
    disarmOfflineBeacon()
    disarmPresenceBeat() // v300: el otro dispositivo ya rotó la llave; paramos el servicio
    lastPosRef.current = null
    setActionError('Se inició sesión en otro dispositivo. Este teléfono se ha desconectado.')
    // Logout LOCAL a propósito: NO usamos logout() del SocioContext porque llama a
    // riderOffline() (flip-earía el en_servicio COMPARTIDO con el dispositivo nuevo) y a
    // unregisterSocioPushNative (borra el token por user_id → borraría el del dispositivo
    // nuevo, mismo login). El trigger ya dejó solo el token del dispositivo activo, así que
    // aquí basta con cerrar la sesión de ESTE dispositivo.
    try { await supabase.auth.signOut() } catch (_) {}
  }, [])

  // Realtime sobre la fila del socio: si active_device_id pasa a ser OTRO dispositivo,
  // esta sesion fue superada → logout inmediato.
  useEffect(() => {
    if (!socio?.id) return
    const ch = supabase
      .channel(`socio-device-${socio.id}`)
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'socios', filter: `id=eq.${socio.id}`,
      }, (payload) => {
        const active = payload.new?.active_device_id
        const mine = deviceIdRef.current
        if (active && mine && active !== mine) handleSuperseded()
      })
      .subscribe()
    return () => { try { supabase.removeChannel(ch) } catch (_) {} }
  }, [socio?.id, handleSuperseded])

  // ─── Cargar asignaciones activas del rider ─────────────────
  const refreshAsignaciones = useCallback(async () => {
    if (!socio?.id) return
    lastFetchRef.current = Date.now()
    // Pedidos en curso del rider = asignaciones ACEPTADAS aún no entregadas.
    // El pedido.estado dentro puede ser preparando/listo (Aceptado), recogido o
    // en_camino — la pantalla de detalle gestiona el avance. Filtrar por la
    // asignación (no por pedido.estado) evita perder los recién aceptados.
    const { data: asigs } = await supabase
      .from('pedido_asignaciones')
      // v305: metodo_pago y stripe_payment_id los necesita el detalle del pedido para decidir
      // los botones de cobro sin esperar a la recarga (sin ellos salía "Cobrar al cliente" un
      // instante en pedidos ya pagados).
      .select('created_at, pedidos!inner(id, codigo, estado, shipday_status, modo_entrega, origen_pedido, subtotal, total, coste_envio, propina, metodo_pago, stripe_payment_id, establecimiento_id, usuario_id, direccion_entrega, lat_entrega, lng_entrega, created_at)')
      .eq('socio_id', socio.id)
      .eq('estado', 'aceptado')
      .in('pedidos.estado', ['preparando', 'listo', 'recogido', 'en_camino'])
      .order('created_at', { ascending: false })
      .limit(20)
    setAsignacionesActivas((asigs || []).map(a => a.pedidos).filter(Boolean))

    // Asignación pendiente (esperando aceptación)
    const { data: pendiente } = await supabase
      .from('pedido_asignaciones')
      .select('id, pedido_id, estado, created_at, pedidos!inner(codigo, total, modo_entrega, origen_pedido, direccion_entrega, establecimientos(nombre, direccion))')
      .eq('socio_id', socio.id)
      .eq('estado', 'esperando_aceptacion')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    // Funcional: no pisar una pendiente ya mostrada (evita leer estado stale) y no
    // re-mostrar una que el rider ya descartó localmente (rechazo/timeout) mientras
    // el backend aún no la resuelve → evita el "modal zombi" que reaparecía en bucle.
    if (pendiente && !dismissedIdsRef.current.has(pendiente.id)) {
      setAsignacionPendiente((prev) => prev || pendiente)
    }
  }, [socio?.id])

  useEffect(() => {
    if (!socio?.id) return
    refreshAsignaciones()
  }, [socio?.id, refreshAsignaciones])

  // ─── Realtime: pedido_asignaciones del socio ───────────────
  useEffect(() => {
    if (!socio?.id) return
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current)
    }
    const ch = supabase
      .channel(`rider-${socio.id}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'pedido_asignaciones',
        filter: `socio_id=eq.${socio.id}`,
      }, async (payload) => {
        const newRow = payload.new
        if (newRow?.estado === 'esperando_aceptacion' && !dismissedIdsRef.current.has(newRow.id)) {
          // Enriquecer con datos del pedido
          const { data: pedido } = await supabase
            .from('pedidos')
            .select('codigo, total, modo_entrega, direccion_entrega, establecimientos(nombre, direccion)')
            .eq('id', newRow.pedido_id)
            .maybeSingle()
          // No pisar una pendiente ya mostrada: si llegan dos pedidos casi a la vez,
          // el segundo no debe reemplazar (y reiniciar el countdown de) el primero.
          setAsignacionPendiente((prev) => prev || { ...newRow, pedidos: pedido })
        }
      })
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'pedido_asignaciones',
        filter: `socio_id=eq.${socio.id}`,
      }, (payload) => {
        // Si la asignación que el rider tiene abierta deja de estar "esperando
        // aceptación" (la tomó otro, expiró o se reasignó), cerramos el modal.
        const row = payload.new
        if (row?.estado && row.estado !== 'esperando_aceptacion') {
          setAsignacionPendiente((prev) => (prev && prev.id === row.id ? null : prev))
        }
        refreshAsignaciones()
      })
      .subscribe((status) => {
        // Recuperación: si el canal se cae (WebView congelado en background, pérdida
        // de red), supabase-js no siempre re-une solo. Al reconectar, refrescamos por
        // si perdimos algún INSERT mientras el socket estuvo muerto.
        if (status === 'SUBSCRIBED') {
          refreshAsignaciones()
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          console.warn('[RiderContext] realtime status:', status)
        }
      })
    channelRef.current = ch
    return () => { supabase.removeChannel(ch); channelRef.current = null }
  }, [socio?.id, refreshAsignaciones])

  // ─── Recuperar realtime al volver del segundo plano ────────
  // El WebView de Android congela el websocket tras minutos en background; al volver,
  // reconectamos el socket y refrescamos las asignaciones para no perder pedidos.
  useEffect(() => {
    if (!socio?.id) return
    let removed = false
    let appHandle = null
    const onResume = () => {
      appActivaRef.current = true
      try { supabase.realtime.connect() } catch (_) {}
      refreshAsignaciones()
      // v305: marca de cierre del todo sin borrar (el apagado no se pudo confirmar, o la app
      // arrancó en segundo plano): al volver el socio a la app se completa. Nunca reanuda.
      if (marcaCierreRef.current && !togglingRef.current) {
        if (socioRef.current?.en_servicio) apagarTrasCierre({ activa: true })
        else cerrarMarcaCierre(true)
      }
    }
    // Web / PWA
    const onVisibility = () => { if (typeof document !== 'undefined' && !document.hidden) onResume() }
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility)
    // Nativo (Capacitor App)
    ;(async () => {
      const App = (await getPlugin('App'))?.plugin
      if (!App || removed) return
      appHandle = await App.addListener('appStateChange', (state) => {
        if (state?.isActive) onResume()
        else appActivaRef.current = false
      })
    })()
    return () => {
      removed = true
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility)
      try { appHandle?.remove?.() } catch (_) {}
    }
  }, [socio?.id, refreshAsignaciones])

  // ─── Listeners push: fallback cuando realtime no llega ─────
  useEffect(() => {
    const offRecv = onPushReceived(() => {
      // OJO (19-jul-2026): aquí NO se reproduce el sonido. Se intentó ("arrancar el timbre
      // sin esperar al modal") y salió mal: iOS entrega de golpe los push ACUMULADOS al
      // abrir la app, así que sonaba el chime nada más abrir, por pedidos viejos que ya no
      // existían. El timbre es responsabilidad EXCLUSIVA de ModalPedidoEntrante, que solo
      // suena si hay una asignación pendiente de verdad (y ya reintenta play cada 800 ms).
      refreshAsignaciones()
    })
    const offTap = onPushTapped(() => {
      refreshAsignaciones()
    })
    return () => { offRecv?.(); offTap?.() }
  }, [socio?.id, refreshAsignaciones])

  // ─── Pedido en curso → nativo (v305) ─────
  // El aviso de "has cerrado la app del todo" cambia si lleva un pedido aceptado sin entregar.
  // Se le dice al nativo cada vez que cambia, para que lo sepa aunque al cerrar no haya red.
  const hayPedidoEnCurso = asignacionesActivas.length > 0
  useEffect(() => {
    pedidoEnCursoRef.current = hayPedidoEnCurso
    marcarPedidoEnCurso(hayPedidoEnCurso)
  }, [hayPedidoEnCurso])

  // ─── GPS del reparto estando Fuera de línea (v305) ─────
  // Ver pararGpsSalvoReparto. Online, el GPS es del turno (este efecto no hace nada). Offline:
  // con pedido en curso se comparte la posición; sin él, se para el GPS que arrancó el reparto.
  useEffect(() => {
    if (isOnline) { repartoTrackingRef.current = false; return }
    if (!hayPedidoEnCurso) {
      if (repartoTrackingRef.current) {
        repartoTrackingRef.current = false
        stopTracking()
        lastPosRef.current = null
      }
      return
    }
    if (repartoTrackingRef.current) return
    let cancelado = false
    ;(async () => {
      if (!(await isNativePlatform())) return
      if (supersededRef.current) return // otro dispositivo tiene la cuenta: no compartir desde aquí
      const granted = await requestLocationPermission()
      if (cancelado || !granted) return
      repartoTrackingRef.current = true
      startTracking({ onUpdate: (p) => { lastPosRef.current = p }, onError: handleWatcherError })
      captureAndPush()
    })()
    return () => { cancelado = true }
  }, [isOnline, hayPedidoEnCurso, handleWatcherError])

  // ─── Latido de presencia mientras online (SOLO foreground/web) ─────
  // Cada 60s, estando EN SERVICIO, mandamos un latido (rider-heartbeat) aunque el
  // repartidor no se mueva. Mantiene fresco socios.last_location_at para que el
  // cron `auto-offline-socios-inactivos` no lo apague mientras la app siga viva.
  // OJO: este setInterval SOLO late con la app en primer plano (o en web) — al
  // minimizar, el SO congela los timers JS del WebView (CapacitorHttp hace nativa
  // la petición, pero no el timer que la dispara). En background el latido real
  // es el keepalive del watcher nativo de riderGeo.js (callback nativo→JS con
  // distanceFilter:0, postea rider-update-location ≥1 vez/min aunque esté quieto).
  // Este latido de foreground se mantiene porque además detecta sesión muerta.
  useEffect(() => {
    if (!isOnline) return
    // Latido inmediato al ponerse online + cada 60s.
    const beat = async () => {
      // No latir mientras el reclamo del dispositivo (rider-online) está en vuelo:
      // el candado aún puede ser del dispositivo anterior → 409 espurio → logout.
      if (claimPendingRef.current) return
      // Comprobación de sesión: si el refresh token está muerto (caducado/revocado),
      // el latido fallaría con 401 y el cron acabaría marcando al socio offline en
      // silencio, dejándolo sin pedidos con la UI diciendo "En línea". Lo detectamos
      // aquí y forzamos re-login en vez de "morir callado".
      try {
        let { data: { session } } = await supabase.auth.getSession()
        const expSoonMs = session?.expires_at ? session.expires_at * 1000 - Date.now() : 0
        if (!session || expSoonMs < 60_000) {
          const r = await supabase.auth.refreshSession()
          // Sin red (túnel, ascensor, parking) supabase-js NO lanza excepción: devuelve
          // session null + AuthRetryableFetchError. Tomarlo por sesión caducada echaba al
          // socio de la app y lo dejaba En línea en la BD sin nadie detrás. Sin red no es
          // sesión muerta: se salta este latido y se reintenta en el siguiente.
          if (!r?.data?.session && isAuthRetryableFetchError(r?.error)) return
          session = r?.data?.session || null
        }
        if (!session) {
          setIsOnline(false)
          stopTracking()
          disarmOfflineBeacon()
          disarmPresenceBeat() // v300
          lastPosRef.current = null
          setActionError('Tu sesión ha caducado. Vuelve a iniciar sesión para seguir recibiendo pedidos.')
          try { await supabase.auth.signOut() } catch (_) {}
          return
        }
      } catch (_) { /* sin red: no forzamos logout, reintentamos al siguiente latido */ }
      // Parte B: mantener fresco el token del beacon de cierre mientras la app esté viva.
      refreshOfflineBeaconToken()
      const p = lastPosRef.current
      const hb = await riderHeartbeat(p ? { latitud: p.latitud, longitud: p.longitud } : {})
      // Single-device: 409 = sesion superada por otro dispositivo → logout.
      if (hb && hb.ok === false && (hb.data?.error === 'sesion_superada' || hb.error === 'http_409')) {
        handleSuperseded()
      }
    }
    beat()
    const id = setInterval(beat, 60_000)
    return () => clearInterval(id)
  }, [isOnline])

  // ─── Dismiss asignación pendiente (tras aceptar/rechazar/timeout) ──
  const dismissPendiente = () => {
    setAsignacionPendiente((prev) => {
      // Recordamos el id descartado para que refreshAsignaciones / el INSERT realtime
      // no lo vuelvan a mostrar mientras el backend aún no lo resuelve (modal zombi).
      if (prev?.id) {
        dismissedIdsRef.current.add(prev.id)
        // Limpieza defensiva: no dejar crecer el set indefinidamente.
        if (dismissedIdsRef.current.size > 50) {
          dismissedIdsRef.current = new Set(Array.from(dismissedIdsRef.current).slice(-25))
        }
      }
      return null
    })
    // refrescar para mover a activas si aceptó
    setTimeout(refreshAsignaciones, 500)
  }

  // Cleanup global: al desmontar el provider (logout, cambio de árbol) paramos el
  // tracking nativo. Es estado de módulo en riderGeo, así que sin esto el foreground
  // service y el GPS seguirían vivos tras cerrar sesión.
  useEffect(() => () => { stopTracking(); disarmOfflineBeacon(); disarmPresenceBeat() }, [])

  const value = useMemo(() => ({
    socio,
    user,
    isOnline,
    needsLocation,
    actionError,
    asignacionPendiente,
    asignacionesActivas,
    setOnline,
    retryLocation,
    clearActionError,
    dismissPendiente,
    refreshAsignaciones,
    problemasMovil,
    revisarMovil: () => pedirComprobacion({ soloRevisar: true }),
  }), [socio, user, isOnline, needsLocation, actionError, asignacionPendiente, asignacionesActivas, refreshAsignaciones, problemasMovil])

  return (
    <RiderCtx.Provider value={value}>
      {children}
      <LocationDisclosureModal
        open={showDisclosure}
        onAccept={() => disclosureResolveRef.current?.(true)}
        onDecline={() => disclosureResolveRef.current?.(false)}
      />
      <ComprobacionMovilModal
        open={comprobacion.open}
        lista={comprobacion.lista}
        comprobando={comprobacion.comprobando}
        soloRevisar={comprobacion.soloRevisar}
        onRecheck={recomprobarMovil}
        onContinue={() => cerrarComprobacion(true)}
        onCancel={() => cerrarComprobacion(false)}
      />
    </RiderCtx.Provider>
  )
}
