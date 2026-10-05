import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'
import { PDFDocument, StandardFonts, rgb } from 'https://esm.sh/pdf-lib@1.17.1'

// generar-factura-socio-restaurante v10 — modelo comision (22-jun-2026).
// El socio factura al restaurante por: COMISION + ENVIO + PROPINA.
//  - Delivery entregado: comision + envio + propina.
//  - Recogida del MARKETPLACE del socio (origen_pedido='marketplace_socio'): SOLO comision.
//  - Recogida por tienda del restaurante / app general: NO entra (el socio no cobra).
//  - v8 (11-jul-2026): pedido TELEFONICO factura SOLO envio + propina, sin % del subtotal.
//  - v9 (22-jul-2026): FUENTE UNICA = snapshot congelado socio_liq_* del pedido (el mismo
//    que ve el socio y con el que se le liquida). Respeta la TARIFA PACTADA (fija/distancia):
//    en pacto fija el envio facturado = tarifa_fija (no coste_envio del cliente) y comision 0.
//    Asi la factura al restaurante == lo que cobra el socio (Opcion A: la diferencia con lo
//    que pago el cliente la cubre el restaurante). Fallback al calculo viejo si el pedido no
//    tiene snapshot (pedidos entregados antes del trigger de congelado).
//  - v10 (29-jul-2026): PRECIO FINAL CON IGIC INCLUIDO (decision de Marlon). Se elimina el
//    impuesto anadido por encima: el total facturado == comision + envios + propinas, sin
//    linea de IVA/IGIC ni base imponible separada. Estamos en Canarias: no hay IVA. El PDF
//    y la pantalla del socio muestran solo el TOTAL con la mencion "IGIC incluido".
//    En BD se sigue guardando base_imponible (= total) por compatibilidad historica, con
//    iva_pct = 0 e iva_importe = 0. Las facturas anteriores al 29-jul-2026 quedan como
//    estaban (eran pruebas).
//  - v15 (1-oct-2026): CORTE DE LOS LUNES. Solo se facturan pedidos de semanas CERRADAS:
//    entregados antes del ultimo lunes 00:00 UTC, el MISMO corte que liquidacion-semanal
//    (en verano = 01:00 de Canarias). Los pedidos desde el lunes esperan a la factura
//    siguiente, da igual el dia que pulse el socio.
//    `simular: true` devuelve el desglose sin registrar nada (para la pantalla de revisar).
//  - v16 (5-oct-2026): UNA FACTURA POR SEMANA, NUNCA SE JUNTAN SEMANAS (Marlon: "no se
//    puede acumular"). La v15 metia en una sola factura todo lo pendiente anterior al corte:
//    Deli Santana -> Duende salio con 3 semanas (14 sep-4 oct, 135 pedidos) en la 2026/0019.
//      * El periodo es SIEMPRE la semana entera, lunes a domingo (como la liquidacion).
//      * Boton del socio (JWT): factura la semana cerrada MAS ANTIGUA que tenga pendiente.
//        Si quedan mas, cada pulsacion emite la siguiente, una por una.
//      * EMISION AUTOMATICA los lunes (cron, header x-cron-secret, body {modo:'auto'}):
//        emite la factura de la semana que acaba de cerrar para CADA par socio->restaurante,
//        sin que el socio pulse nada. Por defecto SOLO la semana recien cerrada; con
//        `desde: 'YYYY-MM-DD'` recupera semanas anteriores (una factura por semana).
//        Filtros opcionales socio_id / establecimiento_id. `simular: true` no escribe nada.
//        Se salta (y lo devuelve en `omitidos`) a quien no tenga datos fiscales o salga a 0 €.
//      * {modo:'regenerar_pdf', factura_id} (cron): rehace el PDF de una factura existente
//        con sus datos congelados (snapshots, fecha de emision, sus pedidos) y vuelve a subirlo.
//      * PDF PAGINADO: la v15 creaba paginas nuevas pero seguia escribiendo en la primera y
//        con mas de ~30 pedidos la tabla salia encima de la cabecera. Ahora cada pagina lleva
//        la cabecera de la tabla, el pie con "Pag. X/N" y el bloque de totales nunca se corta.
//      * Los textos del PDF pasan por win(): un caracter fuera de WinAnsi (p.ej. U+2060
//        pegado desde WhatsApp) ya no tumba la factura.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, content-type, x-client-info, apikey, x-cron-secret',
}
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const CRON_SECRET = Deno.env.get('CRON_SECRET') || ''

function bad(status: number, error: string, extra: Record<string, unknown> = {}) {
  return new Response(JSON.stringify({ error, ...extra }), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
}
function ok(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } })
}
function eur(n: number) { return `${(Number(n) || 0).toFixed(2).replace('.', ',')} €` }
function fmtDate(iso: string | Date) {
  const d = typeof iso === 'string' ? new Date(iso) : iso
  return d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' })
}
function sanitizeNum(s: string) { return s.replace(/[^0-9A-Za-z_\-]/g, '_') }
const toNum = (v: any) => Number(v || 0)
const DIA_MS = 86400000
const isoDia = (d: Date) => d.toISOString().slice(0, 10)

// Lunes 00:00 UTC de la semana que contiene `now`. Con la fecha de hoy es el corte, y es
// copia exacta de prevWeek().fin de liquidacion-semanal: si se cambia uno, cambiar el otro,
// o la factura del socio y la liquidacion de Pidoo dejaran de cubrir los mismos pedidos.
function corteLunes(now = new Date()) {
  const diffToMonday = (now.getUTCDay() + 6) % 7
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - diffToMonday, 0, 0, 0))
}

// pdf-lib con fuentes estandar solo sabe pintar WinAnsi (CP1252). Cualquier otro caracter
// lanza una excepcion y se lleva la factura entera por delante.
const WIN_EXTRA = new Set([...'€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ'])
function win(s: unknown): string {
  return String(s ?? '')
    .replace(/[  -   　]/g, ' ')
    .replace(/[​-‍⁠﻿­]/g, '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[‐-‒−]/g, '-')
    .replace(/./gsu, (ch) => {
      const c = ch.codePointAt(0)!
      if (c >= 0x20 && c <= 0x7E) return ch
      if (c >= 0xA1 && c <= 0xFF) return ch
      if (WIN_EXTRA.has(ch)) return ch
      return '?'
    })
}

const SELECT_PED = 'id, socio_id, establecimiento_id, codigo, modo_entrega, origen_pedido, subtotal, coste_envio, propina, created_at, entregado_at, socio_liq_envio, socio_liq_comision, socio_liq_propina, socio_liq_total'
const fechaPedido = (r: any) => new Date(r.entregado_at || r.created_at)

// Pedidos pendientes de facturar: entregados, de un socio, sin factura, y delivery (cualquier
// origen) o recogida SOLO si vino del marketplace del socio. Solo semanas cerradas (< corte).
// Paginado: el automatico de los lunes puede pasar de las 1000 filas de PostgREST.
async function pedidosPendientes(admin: any, f: { socio_id?: string, establecimiento_id?: string, corte: Date }) {
  const out: any[] = []
  for (let from = 0; ; from += 1000) {
    let q = admin.from('pedidos').select(SELECT_PED)
      .eq('estado', 'entregado')
      .is('factura_socio_id', null)
      .not('socio_id', 'is', null)
      .or('modo_entrega.eq.delivery,and(modo_entrega.eq.recogida,origen_pedido.eq.marketplace_socio)')
      // Un pedido creado despues del corte no puede estar entregado antes: prefiltro seguro.
      .lt('created_at', f.corte.toISOString())
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + 999)
    if (f.socio_id) q = q.eq('socio_id', f.socio_id)
    if (f.establecimiento_id) q = q.eq('establecimiento_id', f.establecimiento_id)
    const { data, error } = await q
    if (error) throw new Error(error.message)
    out.push(...(data || []))
    if (!data || data.length < 1000) break
  }
  return out
}

// Lineas: se toma el SNAPSHOT congelado socio_liq_* (respeta la tarifa pactada). Si falta
// (pedido entregado antes del trigger de congelado), se recalcula con la logica antigua.
function calcularLineas(pedidos: any[], comisionPct: number) {
  const lineas = pedidos
    .slice()
    .sort((a, b) => +fechaPedido(a) - +fechaPedido(b))
    .map((r) => {
      const esDelivery = r.modo_entrega === 'delivery'
      const tieneSnap = r.socio_liq_total != null
      let comision: number, envio: number, propina: number
      if (tieneSnap) {
        comision = +toNum(r.socio_liq_comision).toFixed(2)
        envio = +toNum(r.socio_liq_envio).toFixed(2)
        propina = +toNum(r.socio_liq_propina).toFixed(2)
      } else {
        comision = r.origen_pedido === 'telefonico' ? 0 : +(toNum(r.subtotal) * comisionPct / 100).toFixed(2)
        envio = esDelivery ? +toNum(r.coste_envio).toFixed(2) : 0
        propina = esDelivery ? +toNum(r.propina).toFixed(2) : 0
      }
      return {
        codigo: r.codigo || '—',
        fecha: r.entregado_at || r.created_at,
        esDelivery,
        comision, envio, propina,
        total_linea: +(comision + envio + propina).toFixed(2),
      }
    })
  const comision = +lineas.reduce((s, r) => s + r.comision, 0).toFixed(2)
  const envios = +lineas.reduce((s, r) => s + r.envio, 0).toFixed(2)
  const propinas = +lineas.reduce((s, r) => s + r.propina, 0).toFixed(2)
  // v10: el precio ya lo incluye todo. No se anade impuesto por encima.
  const total = +(comision + envios + propinas).toFixed(2)
  return { lineas, comision, envios, propinas, total }
}

// Agrupa por semana (lunes 00:00 UTC). Devuelve las semanas en orden cronologico.
function porSemana(pedidos: any[]) {
  const m = new Map<string, any[]>()
  for (const r of pedidos) {
    const k = isoDia(corteLunes(fechaPedido(r)))
    if (!m.has(k)) m.set(k, [])
    m.get(k)!.push(r)
  }
  return [...m.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([semana, peds]) => ({ semana, pedidos: peds }))
}
const periodoSemana = (semana: string) => {
  const ini = new Date(`${semana}T00:00:00Z`)
  return { periodo_inicio: semana, periodo_fin: isoDia(new Date(ini.getTime() + 6 * DIA_MS)) }
}

function faltanDatosSocio(socio: any) {
  const f: string[] = []
  if (!socio.razon_social) f.push('razon social')
  if (!socio.nif) f.push('NIF')
  if (!socio.direccion_fiscal) f.push('direccion fiscal')
  if (!socio.codigo_postal) f.push('codigo postal')
  if (!socio.ciudad) f.push('ciudad')
  return f
}
const snapshotDeSocio = (socio: any) => ({
  nombre: socio.nombre, razon_social: socio.razon_social, nif: socio.nif,
  direccion_fiscal: socio.direccion_fiscal, codigo_postal: socio.codigo_postal,
  ciudad: socio.ciudad, provincia: socio.provincia, pais: socio.pais, iban: socio.iban,
})
const snapshotDeRest = (est: any) => ({
  nombre: est.nombre, razon_social: est.razon_social, nif: est.nif,
  direccion_fiscal: est.direccion_fiscal, direccion: est.direccion, codigo_postal: est.codigo_postal,
  ciudad: est.ciudad_fiscal, provincia: est.provincia_fiscal,
})

async function comisionPctPar(admin: any, socio_id: string, establecimiento_id: string) {
  // Comision % pactada para este par socio-restaurante (default 10). Solo para la etiqueta
  // y el fallback de pedidos sin snapshot; los IMPORTES salen del snapshot socio_liq_*.
  const { data: vinc } = await admin.from('socio_establecimiento')
    .select('comision_pct').eq('socio_id', socio_id).eq('establecimiento_id', establecimiento_id).maybeSingle()
  return Number(vinc?.comision_pct ?? 10)
}

// ── PDF ─────────────────────────────────────────────────────────────────────────────
async function renderPdf(o: {
  numero: string, fechaEmision: string | Date, generadoEn: string | Date,
  periodo_inicio: string, periodo_fin: string, socio: any, rest: any,
  calc: ReturnType<typeof calcularLineas>,
}) {
  const SIZE: [number, number] = [595.28, 841.89]
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const W = SIZE[0]; const H = SIZE[1]; const M = 40
  const GRIS = rgb(0.5, 0.5, 0.5)
  let page = doc.addPage(SIZE)
  let y = H - M
  const text = (s: string, x: number, yy: number, size = 10, f = font, color = rgb(0.1, 0.1, 0.1)) =>
    page.drawText(win(s), { x, y: yy, size, font: f, color })
  const nuevaPagina = () => {
    page = doc.addPage(SIZE)
    y = H - M
    text(`FACTURA Nº ${o.numero} (continuación)`, M, y, 10, bold, GRIS)
    y -= 26
  }

  const { socio, rest, calc } = o
  text('FACTURA', M, y, 22, bold)
  text(`Nº ${o.numero}`, W - M - 150, y, 12, bold, GRIS); y -= 22
  text(`Fecha: ${fmtDate(o.fechaEmision)}`, W - M - 150, y, 10, font, rgb(0.45, 0.45, 0.45)); y -= 28

  text('EMISOR', M, y, 9, bold, GRIS); y -= 14
  text(socio.razon_social || socio.nombre || '', M, y, 11, bold); y -= 14
  text(`NIF: ${socio.nif || ''}`, M, y); y -= 13
  text(socio.direccion_fiscal || '', M, y); y -= 13
  text(`${socio.codigo_postal || ''} ${socio.ciudad || ''}${socio.provincia ? ', ' + socio.provincia : ''}`, M, y); y -= 13

  let y2 = H - M - 50 - 28
  text('CLIENTE', W / 2 + 10, y2, 9, bold, GRIS); y2 -= 14
  text(rest.razon_social || rest.nombre || '', W / 2 + 10, y2, 11, bold); y2 -= 14
  text(`CIF/NIF: ${rest.nif || ''}`, W / 2 + 10, y2); y2 -= 13
  text(rest.direccion_fiscal || rest.direccion || '', W / 2 + 10, y2); y2 -= 13
  text(`${rest.codigo_postal || ''} ${rest.ciudad || ''}${rest.provincia ? ', ' + rest.provincia : ''}`, W / 2 + 10, y2); y2 -= 13
  y = Math.min(y, y2) - 16

  page.drawRectangle({ x: M, y: y - 4, width: W - 2 * M, height: 20, color: rgb(0.95, 0.95, 0.97) })
  text('CONCEPTO', M + 8, y + 2, 9, bold, rgb(0.3, 0.3, 0.3)); y -= 26
  text(`Comision + envios + propinas del ${fmtDate(o.periodo_inicio)} al ${fmtDate(o.periodo_fin)}`, M + 4, y, 10, font); y -= 14
  text(`Total pedidos: ${calc.lineas.length}`, M + 4, y, 10, font, rgb(0.4, 0.4, 0.4)); y -= 22

  const cols = [
    { label: 'Codigo', x: M + 4 },
    { label: 'Fecha', x: M + 92 },
    { label: 'Comision', x: M + 185 },
    { label: 'Envio', x: M + 265 },
    { label: 'Propina', x: M + 345 },
    { label: 'Total', x: W - M - 58 },
  ]
  const cabeceraTabla = () => {
    page.drawRectangle({ x: M, y: y - 4, width: W - 2 * M, height: 18, color: rgb(0.92, 0.92, 0.95) })
    for (const c of cols) text(c.label, c.x, y + 1, 9, bold, rgb(0.3, 0.3, 0.3))
    y -= 20
  }
  cabeceraTabla()
  for (const r of calc.lineas) {
    if (y < 60) { nuevaPagina(); cabeceraTabla() }
    text(r.codigo, cols[0].x, y, 9)
    text(fmtDate(r.fecha), cols[1].x, y, 9)
    text(eur(r.comision), cols[2].x, y, 9)
    text(r.esDelivery ? eur(r.envio) : '—', cols[3].x, y, 9)
    text(r.esDelivery ? eur(r.propina) : '—', cols[4].x, y, 9)
    text(eur(r.total_linea), cols[5].x, y, 9, bold)
    y -= 14
  }

  // El bloque de totales + forma de pago ocupa ~170 pt: si no cabe entero, pagina nueva.
  if (y < 230) nuevaPagina()
  y -= 8
  page.drawLine({ start: { x: W - M - 220, y }, end: { x: W - M, y }, thickness: 0.6, color: rgb(0.7, 0.7, 0.7) }); y -= 14
  const labelX = W - M - 220; const valX = W - M - 60
  text('Comisiones', labelX, y, 10); text(eur(calc.comision), valX, y, 10); y -= 13
  text('Envios', labelX, y, 10); text(eur(calc.envios), valX, y, 10); y -= 13
  text('Propinas', labelX, y, 10); text(eur(calc.propinas), valX, y, 10); y -= 18
  page.drawRectangle({ x: labelX - 6, y: y - 6, width: 226, height: 20, color: rgb(0.95, 0.95, 0.97) })
  text('TOTAL', labelX, y, 11, bold); text(eur(calc.total), valX, y, 11, bold); y -= 16
  text('IGIC incluido', labelX, y, 9, font, rgb(0.45, 0.45, 0.45)); y -= 22

  y -= 8
  text('FORMA DE PAGO', M, y, 9, bold, GRIS); y -= 14
  if (socio.iban) { text(`Transferencia — IBAN: ${socio.iban}`, M, y, 10); y -= 13 }
  text(`Titular: ${socio.razon_social || socio.nombre || ''}`, M, y, 10); y -= 13
  text('Vencimiento: 15 dias desde la emision', M, y, 10, font, rgb(0.4, 0.4, 0.4)); y -= 18

  const gen = (typeof o.generadoEn === 'string' ? new Date(o.generadoEn) : o.generadoEn).toISOString().slice(0, 19).replace('T', ' ')
  const pages = doc.getPages()
  pages.forEach((p, i) => p.drawText(
    win(`Factura ${o.numero} · generada con Pidoo · ${gen} UTC · Pág. ${i + 1}/${pages.length}`),
    { x: M, y: M - 10, size: 7, font, color: rgb(0.65, 0.65, 0.65) },
  ))
  return await doc.save()
}

async function subirPdf(admin: any, socio_id: string, anio: number, numero: string, bytes: Uint8Array) {
  const path = `${socio_id}/${anio}/${sanitizeNum(numero)}.pdf`
  const { error: upErr } = await admin.storage.from('facturas-socio').upload(path, bytes, { contentType: 'application/pdf', upsert: true })
  if (upErr) throw new Error(`Error subiendo PDF: ${upErr.message}`)
  const { data: signed } = await admin.storage.from('facturas-socio').createSignedUrl(path, 60 * 60 * 24 * 365)
  return signed?.signedUrl || null
}

// Emite UNA factura de UNA semana para un par socio->restaurante. Orden pensado para no dejar
// nada a medias: PDF en memoria -> factura (reintenta si otro proceso cogio el mismo
// correlativo) -> marcar pedidos (solo los que sigan sin factura; si alguno ya no lo esta,
// deshace) -> subir PDF.
async function emitirSemana(admin: any, socio: any, est: any, comisionPct: number, semana: string, pedidos: any[]) {
  const calc = calcularLineas(pedidos, comisionPct)
  const { periodo_inicio, periodo_fin } = periodoSemana(semana)
  const ahora = new Date()
  const anio = ahora.getUTCFullYear()
  const snapSocio = snapshotDeSocio(socio)
  const snapRest = snapshotDeRest(est)
  const notas = `Comision = ${eur(calc.comision)} · Envios = ${eur(calc.envios)} · Propinas = ${eur(calc.propinas)} · IGIC incluido`

  let factura: any = null
  let numero = ''
  let pdfBytes: Uint8Array | null = null
  for (let intento = 0; intento < 3 && !factura; intento++) {
    const { data: corrData, error: corrErr } = await admin.rpc('siguiente_correlativo_factura_socio', { p_socio_id: socio.id, p_anio: anio })
    if (corrErr) throw new Error(`Error al reservar correlativo: ${corrErr.message}`)
    const correlativo = Number(corrData)
    numero = `${anio}/${String(correlativo).padStart(4, '0')}`
    try {
      pdfBytes = await renderPdf({ numero, fechaEmision: ahora, generadoEn: ahora, periodo_inicio, periodo_fin, socio: snapSocio, rest: snapRest, calc })
    } catch (e) {
      throw new Error(`Error generando PDF: ${(e as Error).message}`)
    }
    const { data, error } = await admin.from('facturas_socio_restaurante').insert({
      socio_id: socio.id, establecimiento_id: est.id,
      numero, anio, serie_correlativo: correlativo,
      periodo_inicio, periodo_fin, pedidos_count: pedidos.length,
      base_imponible: calc.total, iva_pct: 0, iva_importe: 0, total: calc.total,
      snapshot_socio: snapSocio, snapshot_restaurante: snapRest, notas,
    }).select().single()
    if (error) {
      if ((error as any).code === '23505') continue
      throw new Error(`Error creando factura: ${error.message}`)
    }
    factura = data
  }
  if (!factura) throw new Error('No se pudo reservar un numero de factura libre (3 intentos).')

  const ids = pedidos.map(r => r.id)
  const marcados: string[] = []
  let fallo: string | null = null
  for (let i = 0; i < ids.length && !fallo; i += 200) {
    const { data, error } = await admin.from('pedidos').update({ factura_socio_id: factura.id })
      .in('id', ids.slice(i, i + 200)).is('factura_socio_id', null).select('id')
    if (error) fallo = error.message
    else marcados.push(...(data || []).map((d: any) => d.id))
  }
  if (!fallo && marcados.length !== ids.length) fallo = `${ids.length - marcados.length} pedidos ya estaban facturados por otro proceso`
  if (fallo) {
    if (marcados.length) await admin.from('pedidos').update({ factura_socio_id: null }).in('id', marcados).eq('factura_socio_id', factura.id)
    await admin.from('facturas_socio_restaurante').delete().eq('id', factura.id)
    throw new Error(`Error marcando pedidos: ${fallo}`)
  }

  let pdf_url: string | null = null
  let aviso: string | null = null
  try {
    pdf_url = await subirPdf(admin, socio.id, anio, numero, pdfBytes!)
    await admin.from('facturas_socio_restaurante').update({ pdf_url }).eq('id', factura.id)
  } catch (e) {
    // La factura ya existe (tiene numero fiscal): no se deshace. El PDF se rehace con
    // {modo:'regenerar_pdf', factura_id}.
    aviso = (e as Error).message
  }
  return {
    factura_id: factura.id, numero, pdf_url, aviso, total: calc.total, base: calc.total,
    comision: calc.comision, envios: calc.envios, propinas: calc.propinas, comision_pct: comisionPct,
    pedidos_count: pedidos.length, periodo_inicio, periodo_fin,
  }
}

// ── Modo cron: emision automatica de los lunes ──────────────────────────────────────
async function modoAuto(admin: any, body: any) {
  const simular = body?.simular === true
  const corte = corteLunes()
  const desde = body?.desde ? corteLunes(new Date(`${String(body.desde).slice(0, 10)}T00:00:00Z`)) : new Date(corte.getTime() - 7 * DIA_MS)
  const pendientes = (await pedidosPendientes(admin, { socio_id: body?.socio_id, establecimiento_id: body?.establecimiento_id, corte }))
    .filter(r => { const f = fechaPedido(r); return f < corte && f >= desde })

  const pares = new Map<string, any[]>()
  for (const r of pendientes) {
    const k = `${r.socio_id}|${r.establecimiento_id}`
    if (!pares.has(k)) pares.set(k, [])
    pares.get(k)!.push(r)
  }

  const emitidas: any[] = []
  const omitidos: any[] = []
  const errores: any[] = []
  for (const [k, peds] of pares) {
    const [socio_id, establecimiento_id] = k.split('|')
    const [{ data: socio }, { data: est }] = await Promise.all([
      admin.from('socios').select('*').eq('id', socio_id).maybeSingle(),
      admin.from('establecimientos').select('*').eq('id', establecimiento_id).maybeSingle(),
    ])
    const etiqueta = { socio: socio?.nombre_comercial || socio?.nombre || socio_id, restaurante: est?.nombre || establecimiento_id }
    if (!socio || !est) { omitidos.push({ ...etiqueta, motivo: 'socio o restaurante no encontrado', pedidos: peds.length }); continue }
    const falta = faltanDatosSocio(socio)
    if (falta.length) { omitidos.push({ ...etiqueta, motivo: `socio sin datos fiscales: ${falta.join(', ')}`, pedidos: peds.length }); continue }
    if (!est.nif || !est.razon_social) { omitidos.push({ ...etiqueta, motivo: 'restaurante sin razon social o NIF', pedidos: peds.length }); continue }
    const pct = await comisionPctPar(admin, socio_id, establecimiento_id)

    for (const { semana, pedidos } of porSemana(peds)) {
      const calc = calcularLineas(pedidos, pct)
      const resumen = { ...etiqueta, ...periodoSemana(semana), pedidos_count: pedidos.length, total: calc.total }
      if (calc.total <= 0) { omitidos.push({ ...resumen, motivo: 'importe 0 €' }); continue }
      if (simular) { emitidas.push(resumen); continue }
      try {
        const r = await emitirSemana(admin, socio, est, pct, semana, pedidos)
        emitidas.push({ ...resumen, numero: r.numero, factura_id: r.factura_id, pdf: !!r.pdf_url, aviso: r.aviso })
      } catch (e) {
        errores.push({ ...resumen, error: (e as Error).message })
      }
    }
  }
  console.log(`[facturas-socio auto] corte=${isoDia(corte)} desde=${isoDia(desde)} simular=${simular} emitidas=${emitidas.length} omitidos=${omitidos.length} errores=${errores.length}`)
  return ok({ modo: 'auto', simulacion: simular, corte: corte.toISOString(), desde: desde.toISOString(), emitidas, omitidos, errores })
}

// ── Modo cron: rehacer el PDF de una factura ya emitida ─────────────────────────────
async function modoRegenerarPdf(admin: any, body: any) {
  const factura_id = body?.factura_id
  if (!factura_id) return bad(400, 'factura_id requerido')
  const { data: f } = await admin.from('facturas_socio_restaurante').select('*').eq('id', factura_id).maybeSingle()
  if (!f) return bad(404, 'Factura no encontrada')
  if (f.estado === 'anulada') return bad(400, 'La factura esta anulada')
  const { data: peds, error } = await admin.from('pedidos').select(SELECT_PED).eq('factura_socio_id', f.id)
  if (error) return bad(500, error.message)
  if (!peds?.length) return bad(409, 'La factura no tiene pedidos asociados')
  const pct = await comisionPctPar(admin, f.socio_id, f.establecimiento_id)
  const calc = calcularLineas(peds, pct)
  if (Math.abs(calc.total - toNum(f.total)) > 0.005 || peds.length !== f.pedidos_count) {
    return bad(409, `No cuadra con lo emitido: ${peds.length} pedidos / ${calc.total} € frente a ${f.pedidos_count} / ${f.total} €`)
  }
  const rest = { ...(f.snapshot_restaurante || {}) }
  if (!rest.direccion_fiscal && !rest.direccion) {
    const { data: est } = await admin.from('establecimientos').select('direccion').eq('id', f.establecimiento_id).maybeSingle()
    rest.direccion = est?.direccion
  }
  const bytes = await renderPdf({
    numero: f.numero, fechaEmision: f.fecha_emision, generadoEn: f.created_at,
    periodo_inicio: f.periodo_inicio, periodo_fin: f.periodo_fin,
    socio: f.snapshot_socio || {}, rest, calc,
  })
  const pdf_url = await subirPdf(admin, f.socio_id, f.anio, f.numero, bytes)
  await admin.from('facturas_socio_restaurante').update({ pdf_url }).eq('id', f.id)
  return ok({ modo: 'regenerar_pdf', factura_id: f.id, numero: f.numero, pdf_url })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return bad(405, 'Method not allowed')

  let body: any
  try { body = await req.json() } catch { return bad(400, 'JSON invalido') }
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE)

  // ---- Modos de servidor (cron): x-cron-secret ----
  if (body?.modo === 'auto' || body?.modo === 'regenerar_pdf') {
    const esCron = !!CRON_SECRET && (req.headers.get('x-cron-secret') || '') === CRON_SECRET
    if (!esCron) return bad(401, 'No autorizado')
    try {
      return body.modo === 'auto' ? await modoAuto(admin, body) : await modoRegenerarPdf(admin, body)
    } catch (e) {
      return bad(500, (e as Error).message)
    }
  }

  // ---- Boton del socio (JWT) ----
  const auth = req.headers.get('Authorization') || ''
  if (!auth.toLowerCase().startsWith('bearer ')) return bad(401, 'Falta autorizacion')
  const token = auth.slice(7)
  const establecimiento_id = body?.establecimiento_id
  const simular = body?.simular === true
  if (!establecimiento_id) return bad(400, 'establecimiento_id requerido')

  const asUser = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: `Bearer ${token}` } } })
  const { data: userData, error: userErr } = await asUser.auth.getUser()
  if (userErr || !userData?.user) return bad(401, 'Sesion invalida')

  const { data: socio, error: sErr } = await admin.from('socios').select('*').eq('user_id', userData.user.id).maybeSingle()
  if (sErr || !socio) return bad(403, 'No eres un socio valido')

  const faltanSocio = faltanDatosSocio(socio)
  if (faltanSocio.length) return bad(400, `Completa tus datos fiscales: ${faltanSocio.join(', ')}`)

  const { data: est, error: eErr } = await admin.from('establecimientos').select('*').eq('id', establecimiento_id).maybeSingle()
  if (eErr || !est) return bad(404, 'Restaurante no encontrado')
  if (!est.nif || !est.razon_social) return bad(400, 'El restaurante no tiene datos fiscales completos (razon social y NIF).')

  const comisionPct = await comisionPctPar(admin, socio.id, establecimiento_id)

  // Lo pendiente hasta ahora mismo (para contar lo de la semana en curso, que espera).
  const corte = corteLunes()
  const siguienteCorte = new Date(corte.getTime() + 7 * DIA_MS)
  let todos: any[]
  try {
    todos = await pedidosPendientes(admin, { socio_id: socio.id, establecimiento_id, corte: siguienteCorte })
  } catch (e) {
    return bad(500, (e as Error).message)
  }
  const cerrados = todos.filter(r => fechaPedido(r) < corte)
  const enCurso = todos.length - cerrados.length
  const semanas = porSemana(cerrados)
  const infoCorte = {
    corte: corte.toISOString(),
    siguiente_corte: siguienteCorte.toISOString(),
    pedidos_semana_en_curso: enCurso,
    // v16: semanas cerradas sin facturar. Cada pulsacion factura SOLO la mas antigua.
    semanas_pendientes: semanas.length,
  }
  if (semanas.length === 0) {
    if (simular) return ok({ simulacion: true, pedidos_count: 0, comision: 0, envios: 0, propinas: 0, total: 0, comision_pct: comisionPct, lineas: [], ...infoCorte })
    if (enCurso > 0) {
      const cuantos = enCurso === 1 ? 'El pedido' : `Los ${enCurso} pedidos`
      const verbo = enCurso === 1 ? 'se factura' : 'se facturan'
      return bad(400, `La semana en curso aún no ha cerrado. ${cuantos} desde el lunes ${fmtDate(corte)} ${verbo} a partir del lunes ${fmtDate(siguienteCorte)}.`)
    }
    return bad(400, 'No hay pedidos pendientes de facturar a este restaurante.')
  }

  const { semana, pedidos } = semanas[0]
  if (simular) {
    const calc = calcularLineas(pedidos, comisionPct)
    return ok({
      simulacion: true, pedidos_count: pedidos.length, comision: calc.comision, envios: calc.envios,
      propinas: calc.propinas, total: calc.total, comision_pct: comisionPct, ...periodoSemana(semana),
      lineas: calc.lineas, ...infoCorte,
    })
  }

  try {
    const r = await emitirSemana(admin, socio, est, comisionPct, semana, pedidos)
    return ok({ ...r, ...infoCorte, semanas_pendientes: semanas.length - 1 })
  } catch (e) {
    return bad(500, (e as Error).message)
  }
})
