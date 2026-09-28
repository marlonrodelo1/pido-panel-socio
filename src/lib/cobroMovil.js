// cobroMovil.js — Cobrar un pedido con el móvil del socio (Tap to Pay de Stripe).
//
// El cliente acerca su tarjeta (o Apple Pay / Google Pay) a la parte de atrás del móvil del
// socio. El dinero entra en la cuenta de Stripe de Pidoo y el pedido pasa a «tarjeta»: la
// liquidación del lunes ya lo cuenta como dinero que Pidoo le debe al restaurante.
//
// Tres piezas:
//   configCobroMovil()   ¿puede este socio cobrar con el móvil? (edge socio-cobro-movil, 'config').
//   prepararLector(loc)  arranca Stripe Terminal y conecta el lector Tap to Pay del propio móvil.
//                        La primera vez tarda unos segundos: se llama al abrir un pedido cobrable
//                        para que no sea delante del cliente.
//   cobrarPedido(id)     el SERVIDOR crea el cobro con el total del pedido (el móvil nunca pone el
//                        importe), sale la pantalla de Stripe «acerca la tarjeta» y el servidor lo
//                        confirma con Stripe y lo registra.
//
// Solo Android por ahora: en iPhone hace falta el permiso de Apple («Tap to Pay on iPhone»).
// En web no existe.
//
// OJO con el plugin (@capacitor-community/stripe-terminal 8.2.1, Android): si la búsqueda del
// lector FALLA (NFC apagado, opciones de desarrollador activas, móvil no compatible), el plugin
// solo lo apunta en su log y la promesa de discoverReaders NO SE RESUELVE NUNCA. Por eso cada
// paso lleva un tiempo máximo y un mensaje que dice qué revisar.
//
// v305: la ENTREGA va aparte, en rider-estado ('entregado' con `cobro`), que vuelve a mirar Stripe
// antes de entregar. Aquí además: leer los cobros de un pedido (check verde del historial), la
// clave del datáfono del restaurante, los requisitos del móvil y los mensajes de la puerta.
import { Capacitor } from '@capacitor/core'
import { socioCobroMovil, logCobroMovil } from './riderApi'
import { isNativeSync } from './capacitor'
import { supabase } from './supabase'
import { tapToPayChecks, openNfcSettings } from './offlineBeacon'

const MAX_ARRANQUE_MS = 30_000
const MAX_BUSCAR_LECTOR_MS = 25_000
// La primera conexión descarga la configuración del lector: puede tardar.
const MAX_CONECTAR_MS = 60_000
const CONFIG_TTL_MS = 5 * 60_000
// Tap to Pay de Stripe en Android pide Android 13 (API 33) o superior.
export const ANDROID_MIN_SDK = 33
const MAX_REQUISITOS_MS = 4_000

const MENSAJES = {
  no_soportado: 'Este móvil no puede cobrar con tarjeta.',
  movil_no_valido: 'Este móvil no puede cobrar con tarjeta ahora mismo. Revisa que el NFC esté activado y que las «Opciones de desarrollador» estén apagadas. Hace falta Android 13 o superior.',
  nfc: 'Activa el NFC del móvil en Ajustes y vuelve a intentarlo.',
  inseguro: 'Apaga las «Opciones de desarrollador» del móvil (Ajustes) y vuelve a intentarlo.',
  ubicacion: 'Pidoo Socio necesita permiso de ubicación para cobrar con tarjeta.',
  cuenta: 'El cobro con tarjeta no está disponible todavía. Avisa a Pidoo.',
  no_arranca: 'No se pudo preparar el cobro. Revisa la conexión e inténtalo otra vez.',
  no_conecta: 'No se pudo preparar el lector del móvil. Inténtalo otra vez.',
  cancelado: 'Cobro cancelado. No se ha cobrado nada.',
  rechazada: 'Tarjeta rechazada. Pide otra tarjeta o cobra de otra forma.',
  red: 'Sin conexión. Busca cobertura y vuelve a intentarlo.',
  sesion: 'Tu sesión ha caducado. Vuelve a iniciar sesión.',
  ya_pagado: 'Este pedido ya está pagado.',
  desactivado: 'El cobro con tarjeta no está activado para tu cuenta.',
  estado: 'Marca primero «Recogí el pedido» para poder cobrar.',
  en_curso: 'Hay un cobro de este pedido en marcha. Espera unos segundos y vuelve a intentarlo.',
  no_cobrado: 'No se pudo cobrar. No se ha cobrado nada: inténtalo otra vez.',
  servidor: 'No se pudo preparar el cobro. Inténtalo otra vez.',
}

export class ErrorCobro extends Error {
  constructor(codigo, detalle) {
    super(MENSAJES[codigo] || MENSAJES.no_cobrado)
    this.codigo = codigo
    this.detalle = detalle || null
  }
}

let _mod = null
let _init = null
let _conectado = false
let _preparando = null
let _config = null // { t, valor }

export function cobroMovilSoportado() {
  try {
    return isNativeSync() && Capacitor.getPlatform() === 'android' && Capacitor.isPluginAvailable('StripeTerminal')
  } catch (_) {
    return false
  }
}

// ¿Puede este socio cobrar con el móvil y qué formas de pago? Se cachea 5 min.
export async function configCobroMovil() {
  const nada = { habilitado: false, metodos: [], locationId: null }
  if (!cobroMovilSoportado()) return nada
  if (_config && Date.now() - _config.t < CONFIG_TTL_MS) return _config.valor
  const r = await socioCobroMovil('config')
  if (!r?.ok) return nada // sin red: no se cachea, se pregunta otra vez al abrir otro pedido
  const valor = r.data?.habilitado
    ? { habilitado: true, metodos: r.data.metodos || [], locationId: r.data.location_id || null }
    : nada
  _config = { t: Date.now(), valor }
  return valor
}

function conTiempo(promesa, ms, codigo) {
  let t
  return Promise.race([
    Promise.resolve(promesa).finally(() => clearTimeout(t)),
    new Promise((_, rej) => { t = setTimeout(() => rej(new ErrorCobro(codigo)), ms) }),
  ])
}

const esperar = (ms) => new Promise((r) => setTimeout(r, ms))

async function plugin() {
  if (!_mod) _mod = await import('@capacitor-community/stripe-terminal')
  return _mod
}

async function inicializar() {
  if (_init) return _init
  _init = (async () => {
    const { StripeTerminal: ST, TerminalEventsEnum: Ev } = await plugin()
    // El SDK pide un token de conexión cuando lo necesita. Lo da la edge con la sesión del
    // socio: así nadie sin sesión puede sacar tokens de la cuenta de Stripe de Pidoo.
    await ST.addListener(Ev.RequestedConnectionToken, async () => {
      const r = await socioCobroMovil('token')
      if (!r?.ok) logCobroMovil('warn', { paso: 'token', status: r?.status, error: r?.error })
      // Con token vacío el SDK recibe un fallo en vez de quedarse esperando para siempre.
      try { await ST.setConnectionToken({ token: (r?.ok && r.data?.secret) || '' }) } catch (_) {}
    })
    const perdido = () => { _conectado = false }
    await ST.addListener(Ev.DisconnectedReader, perdido)
    await ST.addListener(Ev.UnexpectedReaderDisconnect, perdido)
    await ST.addListener(Ev.ReaderReconnectFailed, perdido)
    await ST.initialize({ isTest: false })
  })()
  try {
    return await _init
  } catch (e) {
    _init = null
    throw e
  }
}

// Arranca Stripe Terminal y conecta el lector Tap to Pay del propio móvil. Idempotente.
export async function prepararLector(locationId) {
  if (!cobroMovilSoportado()) throw new ErrorCobro('no_soportado')
  if (_conectado) return
  if (_preparando) return _preparando
  _preparando = (async () => {
    try {
      await conTiempo(inicializar(), MAX_ARRANQUE_MS, 'no_arranca')
    } catch (e) {
      throw traducir(e, 'no_arranca', 'inicializar')
    }
    const { StripeTerminal: ST, TerminalConnectTypes: Tipos } = await plugin()
    try {
      const { reader } = await ST.getConnectedReader()
      if (reader) { _conectado = true; return }
    } catch (_) { /* sin lector conectado: se busca */ }
    if (!locationId) throw new ErrorCobro('cuenta', 'sin_location')

    let lectores = []
    try {
      const r = await conTiempo(ST.discoverReaders({ type: Tipos.TapToPay, locationId }), MAX_BUSCAR_LECTOR_MS, 'movil_no_valido')
      lectores = r?.readers || []
    } catch (e) {
      try { await ST.cancelDiscoverReaders() } catch (_) {}
      throw traducir(e, 'movil_no_valido', 'buscar_lector')
    }
    if (!lectores[0]) throw new ErrorCobro('movil_no_valido', 'sin_lectores')
    try {
      await conTiempo(ST.connectReader({ reader: lectores[0], autoReconnectOnUnexpectedDisconnect: true }), MAX_CONECTAR_MS, 'no_conecta')
    } catch (e) {
      throw traducir(e, 'no_conecta', 'conectar')
    }
    _conectado = true
  })()
  try {
    return await _preparando
  } finally {
    _preparando = null
  }
}

// Cobra el pedido. onPaso('preparando' | 'tarjeta' | 'confirmando') para pintar el progreso.
// Devuelve { importeCent, registrado, yaEstaba?, pendienteRegistro? } o lanza ErrorCobro.
export async function cobrarPedido(pedidoId, { onPaso } = {}) {
  onPaso?.('preparando')
  const c = await socioCobroMovil('crear', { pedido_id: pedidoId, plataforma: 'android' })
  if (!c?.ok) throw errorDeEdge(c, 'crear')
  if (c.data?.ya_cobrado) return { importeCent: c.data.importe_cent, registrado: true, yaEstaba: true }
  const { client_secret: secret, payment_intent_id: piId, location_id: locationId, importe_cent: importeCent } = c.data || {}
  if (!secret || !piId) throw new ErrorCobro('servidor', 'crear_sin_secret')

  await prepararLector(locationId)
  const { StripeTerminal: ST } = await plugin()

  onPaso?.('tarjeta')
  try {
    await ST.collectPaymentMethod({ paymentIntent: secret })
  } catch (e) {
    throw traducir(e, 'no_cobrado', 'leer_tarjeta', { pedidoId, piId })
  }

  onPaso?.('confirmando')
  let aprobadoEnMovil = false
  let errorMovil = null
  try {
    await ST.confirmPaymentIntent()
    aprobadoEnMovil = true
  } catch (e) {
    errorMovil = e
  }

  // La última palabra la tiene Stripe: el servidor le pregunta y, si está cobrado, lo registra.
  const v = await confirmarEnServidor(pedidoId, piId)
  if (v.cobrado) return { importeCent: v.importeCent ?? importeCent, registrado: v.registrado }
  if (aprobadoEnMovil) {
    // El móvil dice «aprobado» pero el servidor no ha podido comprobarlo (sin cobertura). El
    // cobro es real: el aviso de Stripe (stripe-webhook-pagos) lo registrará en el servidor.
    logCobroMovil('warn', { paso: 'confirmar_sin_servidor', pedidoId, piId })
    return { importeCent, registrado: false, pendienteRegistro: true }
  }
  throw traducir(errorMovil, 'no_cobrado', 'confirmar', { pedidoId, piId, servidor: v.detalle })
}

async function confirmarEnServidor(pedidoId, piId) {
  let ultimo = null
  for (let i = 0; i < 4; i++) {
    const r = await socioCobroMovil('confirmar', { pedido_id: pedidoId, payment_intent_id: piId })
    ultimo = r
    if (r?.ok && r.data?.cobrado) return { cobrado: true, importeCent: r.data.importe_cent, registrado: !!r.data.registrado }
    // 202 = Stripe aún lo está procesando · status 0 = sin red. Se reintenta un poco.
    if ((r?.ok && r.data?.pendiente) || r?.status === 0) { await esperar(1500 * (i + 1)); continue }
    break
  }
  return { cobrado: false, detalle: ultimo?.data?.error || ultimo?.error || null }
}

// ─── v305: lo que rodea al cobro en la puerta ───────────────────────────────

// Columnas de pedido_cobros_movil que pintan el pago (estadoPago en lib/metodoPago.js).
export const COBROS_COLUMNAS = 'pedido_id, estado, importe, cobrado_at, revisar, metodo_pago_anterior, tarjeta_marca, tarjeta_ultimos4, tarjeta_lectura, recibo_url'

// Cobros con el móvil de uno o varios pedidos. TOLERANTE: si falla (sin red, tabla sin permiso)
// devuelve ok:false y lista vacía, y quien llama sigue pintando lo que tiene. Por eso va en una
// consulta aparte y no embebida: un embed roto tiraría la consulta entera del historial.
// pedido_cobros_movil NO está en realtime: después de cobrar hay que volver a llamar aquí.
export async function leerCobros(pedidoIds) {
  const ids = Array.from(new Set((Array.isArray(pedidoIds) ? pedidoIds : [pedidoIds]).filter(Boolean)))
  if (!ids.length) return { ok: true, filas: [] }
  try {
    const trozos = []
    for (let i = 0; i < ids.length; i += 100) trozos.push(ids.slice(i, i + 100))
    const res = await Promise.all(trozos.map((t) => supabase.from('pedido_cobros_movil').select(COBROS_COLUMNAS).in('pedido_id', t)))
    const fallo = res.find((r) => r.error)
    if (fallo) return { ok: false, filas: res.flatMap((r) => r.data || []) }
    return { ok: true, filas: res.flatMap((r) => r.data || []) }
  } catch (_) {
    return { ok: false, filas: [] }
  }
}

// ¿Enseña la app «Cobrado con datáfono del restaurante»? configuracion_plataforma
// cobro_datafono_fisico (nace en 'on', pública). Lo aplica también el servidor (rider-estado v13).
// Solo un 'off' EXPLÍCITO lo apaga: hoy hay restaurantes (Duende) que dan el datáfono al
// repartidor, y sin este botón la única salida sería «efectivo», que pasa el pedido a efectivo y
// descuadra el cajón del restaurante.
// Devuelve true / false, o null si no se pudo leer (sin red): entonces se enseña el botón y
// decide el servidor (si está en 'off' responde 409 con un mensaje claro).
let _datafonoFisico = null // { t, valor }
export async function datafonoFisicoActivo() {
  if (_datafonoFisico && Date.now() - _datafonoFisico.t < CONFIG_TTL_MS) return _datafonoFisico.valor
  try {
    const { data, error } = await supabase.from('configuracion_plataforma').select('valor').eq('clave', 'cobro_datafono_fisico').maybeSingle()
    if (error) return null // sin red: no se cachea
    const valor = String(data?.valor ?? 'on').trim().toLowerCase() !== 'off'
    _datafonoFisico = { t: Date.now(), valor }
    return valor
  } catch (_) {
    return null
  }
}

// Requisitos del móvil para Tap to Pay (Android), desde el plugin nativo.
// null = no se pudo comprobar (iPhone, web o una app sin esa función): entonces no se bloquea
// nada y el propio cobro dirá qué falta.
export async function requisitosTapToPay() {
  if (!cobroMovilSoportado()) return null
  let c = null
  try {
    c = await Promise.race([
      tapToPayChecks(),
      new Promise((r) => setTimeout(() => r(null), MAX_REQUISITOS_MS)),
    ])
  } catch (_) {
    c = null
  }
  if (!c) return null
  const sdk = Number(c.androidSdk) || 0
  const androidOk = sdk >= ANDROID_MIN_SDK
  const hardwareOk = !!c.tieneNfc && androidOk
  return {
    ...c,
    androidOk,
    hardwareOk,
    // Lo que el socio puede arreglar en Ajustes.
    listo: hardwareOk && !!c.nfcActivado && !c.opcionesDesarrollador,
  }
}

export async function abrirAjustesNfc() {
  try { await openNfcSettings() } catch (_) {}
}

// ¿Está ya conectado el lector Tap to Pay del móvil en esta sesión de la app? (Configuración)
export function lectorPreparado() {
  return _conectado
}

const eur = (n) => `${(Number(n) || 0).toFixed(2).replace('.', ',')} €`

// Mensaje para el socio cuando rider-estado NO entrega (errores de negocio, siempre 409).
export function mensajeEntrega(res) {
  const cod = (typeof res?.data?.error === 'string' && res.data.error) || res?.error || ''
  if (res?.status === 0 || cod === 'network') return 'Sin conexión. Busca cobertura y vuelve a intentarlo.'
  switch (cod) {
    case 'ya_cobrado_con_tarjeta':
      return `Este pedido ya está cobrado con tarjeta${res?.data?.importe ? ` (${eur(res.data.importe)})` : ''}. No cobres en efectivo: si el cliente te ha dado dinero, devuélveselo. Pulsa «Entregado».`
    case 'ya_pagado':
      return 'Este pedido ya está pagado. No hay que cobrar nada: pulsa «Entregado».'
    case 'cobro_tarjeta_en_curso':
      return 'Hay un cobro con tarjeta de este pedido en marcha. Espera unos segundos y vuelve a intentarlo.'
    case 'no_se_pudo_anular_cobro_tarjeta':
      return 'Quedó un cobro con tarjeta a medias y no se pudo anular. Espera unos segundos y vuelve a intentarlo.'
    case 'stripe_no_responde':
      return 'No se pudo comprobar el cobro con tarjeta. Revisa la conexión e inténtalo otra vez.'
    case 'cobro_tarjeta_no_confirmado':
      return 'Todavía no está confirmado el cobro con tarjeta. Espera unos segundos y pulsa otra vez.'
    case 'registro_tarjeta_fallido':
      return 'El cobro con tarjeta está hecho, pero no se pudo apuntar. Pulsa otra vez en unos segundos. No lo vuelvas a cobrar.'
    case 'datafono_fisico_desactivado':
      return 'El cobro con el datáfono del restaurante no está activado. Cobra con tarjeta en el móvil o en efectivo.'
    case 'metodo_no_datafono':
      return 'Este pedido no es de datáfono.'
    case 'estado_no_cobrable':
    case 'estado_invalido':
      return 'El pedido ya no está en reparto. Vuelve atrás y revisa la lista de pedidos. Si lo has cobrado en efectivo, avisa al restaurante.'
    case 'metodo_no_cambiable':
      return 'No se pudo apuntar el cobro en efectivo en este pedido. Avisa a Pidoo.'
    case 'sesion_superada':
      return 'Se ha iniciado sesión con tu cuenta en otro móvil. Vuelve a entrar en este para seguir.'
    default:
      return 'No se pudo actualizar el pedido. Revisa tu conexión e inténtalo de nuevo.'
  }
}

// Anula un cobro a medias cuando el socio decide cobrar de otra forma (no mueve dinero).
export async function anularCobroPendiente(pedidoId, piId) {
  if (!pedidoId || !piId) return
  try { await socioCobroMovil('cancelar', { pedido_id: pedidoId, payment_intent_id: piId }) } catch (_) {}
}

function errorDeEdge(r, paso) {
  if (r?.sessionDead) return new ErrorCobro('sesion', paso)
  if (r?.status === 0) return new ErrorCobro('red', paso)
  const cod = typeof r?.data?.error === 'string' ? r.data.error : r?.error
  const mapa = {
    ya_pagado: 'ya_pagado',
    cobro_movil_desactivado: 'desactivado',
    estado_no_cobrable: 'estado',
    cobro_en_curso: 'en_curso',
    location_no_disponible: 'cuenta',
  }
  const codigo = mapa[cod] || 'servidor'
  logCobroMovil('warn', { paso, status: r?.status, error: cod, data: r?.data || null })
  return new ErrorCobro(codigo, cod)
}

// El plugin rechaza con mensajes de texto del SDK de Stripe (en inglés). Se traducen por
// palabras clave a algo que el socio pueda resolver en la puerta, y se deja rastro.
function traducir(e, porDefecto, paso, extra) {
  if (e instanceof ErrorCobro) {
    logCobroMovil('warn', { paso, codigo: e.codigo, detalle: e.detalle, ...(extra || {}) })
    return e
  }
  const partes = [e?.code, e?.message, e?.data?.code, e?.data?.declineCode, e?.data?.message, typeof e === 'string' ? e : null]
  const texto = partes.filter(Boolean).join(' | ')
  const t = texto.toLowerCase()
  const codigo =
    /cancel/.test(t) ? 'cancelado'
      : /declin|insufficient|expired|incorrect_pin|pin_/.test(t) ? 'rechazada'
        : /nfc/.test(t) ? 'nfc'
          : /insecure|developer|debug|tamper|root/.test(t) ? 'inseguro'
            : /permission|location/.test(t) ? 'ubicacion'
              : /unsupported|not supported|incompatible/.test(t) ? 'movil_no_valido'
                : /network|timed out|timeout|offline|unable to resolve|failed to connect/.test(t) ? 'red'
                  : /not available|not enabled|account|country/.test(t) ? 'cuenta'
                    : porDefecto
  logCobroMovil('warn', { paso, codigo, texto: texto.slice(0, 500), ...(extra || {}) })
  return new ErrorCobro(codigo, texto.slice(0, 300))
}
