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
import { Capacitor } from '@capacitor/core'
import { socioCobroMovil, logCobroMovil } from './riderApi'
import { isNativeSync } from './capacitor'

const MAX_ARRANQUE_MS = 30_000
const MAX_BUSCAR_LECTOR_MS = 25_000
// La primera conexión descarga la configuración del lector: puede tardar.
const MAX_CONECTAR_MS = 60_000
const CONFIG_TTL_MS = 5 * 60_000

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
