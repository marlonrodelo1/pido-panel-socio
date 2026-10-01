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
//    (en verano = 01:00 de Canarias). Antes facturaba todo lo pendiente hasta el momento de
//    pulsar: Deli Santana cobra a Mamma Mia los miercoles y se le colaban el lunes y el
//    martes de la semana en curso. Los pedidos desde el lunes esperan a la factura siguiente,
//    da igual el dia que pulse el socio. periodo_fin = el domingo anterior al corte.
//    `simular: true` devuelve el desglose sin registrar nada (para la pantalla de revisar).

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, content-type, x-client-info, apikey',
}
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!

function bad(status: number, error: string) {
  return new Response(JSON.stringify({ error }), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
}
function ok(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } })
}
function eur(n: number) { return `${(Number(n) || 0).toFixed(2).replace('.', ',')} €` }
function fmtDate(iso: string | Date) {
  const d = typeof iso === 'string' ? new Date(iso) : iso
  return d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' })
}
function sanitizeNum(s: string) { return s.replace(/[^0-9A-Za-z_\-]/g, '_') }
const toNum = (v: any) => Number(v || 0)
const DIA_MS = 86400000

// Lunes 00:00 UTC de la semana en curso. Copia exacta de prevWeek().fin de
// liquidacion-semanal: si se cambia uno, cambiar el otro, o la factura del socio y la
// liquidacion de Pidoo dejaran de cubrir los mismos pedidos.
function corteLunes(now = new Date()) {
  const diffToMonday = (now.getUTCDay() + 6) % 7
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - diffToMonday, 0, 0, 0))
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return bad(405, 'Method not allowed')

  const auth = req.headers.get('Authorization') || ''
  if (!auth.toLowerCase().startsWith('bearer ')) return bad(401, 'Falta autorizacion')
  const token = auth.slice(7)

  let body: any
  try { body = await req.json() } catch { return bad(400, 'JSON invalido') }
  const establecimiento_id = body?.establecimiento_id
  const periodo_inicio_in = body?.periodo_inicio || null
  const periodo_fin_in = body?.periodo_fin || null
  const simular = body?.simular === true
  if (!establecimiento_id) return bad(400, 'establecimiento_id requerido')

  const asUser = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: `Bearer ${token}` } } })
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE)

  const { data: userData, error: userErr } = await asUser.auth.getUser()
  if (userErr || !userData?.user) return bad(401, 'Sesion invalida')
  const user_id = userData.user.id

  const { data: socio, error: sErr } = await admin.from('socios').select('*').eq('user_id', user_id).maybeSingle()
  if (sErr || !socio) return bad(403, 'No eres un socio valido')

  const faltanSocio: string[] = []
  if (!socio.razon_social) faltanSocio.push('razon social')
  if (!socio.nif) faltanSocio.push('NIF')
  if (!socio.direccion_fiscal) faltanSocio.push('direccion fiscal')
  if (!socio.codigo_postal) faltanSocio.push('codigo postal')
  if (!socio.ciudad) faltanSocio.push('ciudad')
  if (faltanSocio.length) return bad(400, `Completa tus datos fiscales: ${faltanSocio.join(', ')}`)

  const { data: est, error: eErr } = await admin.from('establecimientos').select('*').eq('id', establecimiento_id).maybeSingle()
  if (eErr || !est) return bad(404, 'Restaurante no encontrado')
  if (!est.nif || !est.razon_social) return bad(400, 'El restaurante no tiene datos fiscales completos (razon social y NIF).')

  // Comision % pactada para este par socio-restaurante (default 10). Solo para la etiqueta
  // del encabezado; los IMPORTES salen del snapshot socio_liq_* de cada pedido.
  const { data: vinc } = await admin.from('socio_establecimiento')
    .select('comision_pct').eq('socio_id', socio.id).eq('establecimiento_id', establecimiento_id).maybeSingle()
  const comisionPct = Number(vinc?.comision_pct ?? 10)

  // Pedidos a facturar: entregados, del socio, sin facturar, y:
  //  - delivery (cualquier origen), o
  //  - recogida SOLO si vino del marketplace del socio.
  let q = admin.from('pedidos')
    .select('id, codigo, modo_entrega, origen_pedido, subtotal, coste_envio, propina, created_at, entregado_at, socio_liq_envio, socio_liq_comision, socio_liq_propina, socio_liq_total')
    .eq('socio_id', socio.id)
    .eq('establecimiento_id', establecimiento_id)
    .eq('estado', 'entregado')
    .is('factura_socio_id', null)
    .or('modo_entrega.eq.delivery,and(modo_entrega.eq.recogida,origen_pedido.eq.marketplace_socio)')
    .order('entregado_at', { ascending: true })
  if (periodo_inicio_in) q = q.gte('entregado_at', periodo_inicio_in)
  if (periodo_fin_in) q = q.lt('entregado_at', periodo_fin_in)
  const { data: pendientes, error: pErr } = await q
  if (pErr) return bad(500, pErr.message)

  // v15: solo semanas cerradas. Lo entregado desde el lunes (fecha = entregado_at, o
  // created_at si falta: la misma que se imprime en cada linea) espera a la siguiente.
  const corte = corteLunes()
  const siguienteCorte = new Date(corte.getTime() + 7 * DIA_MS)
  const pedidos = (pendientes || []).filter(r => new Date(r.entregado_at || r.created_at) < corte)
  const enCurso = (pendientes || []).length - pedidos.length
  const infoCorte = {
    corte: corte.toISOString(),
    siguiente_corte: siguienteCorte.toISOString(),
    pedidos_semana_en_curso: enCurso,
  }
  if (pedidos.length === 0) {
    if (simular) return ok({ simulacion: true, pedidos_count: 0, comision: 0, envios: 0, propinas: 0, total: 0, comision_pct: comisionPct, lineas: [], ...infoCorte })
    if (enCurso > 0) {
      const cuantos = enCurso === 1 ? 'El pedido' : `Los ${enCurso} pedidos`
      const verbo = enCurso === 1 ? 'se factura' : 'se facturan'
      return bad(400, `La semana en curso aún no ha cerrado. ${cuantos} desde el lunes ${fmtDate(corte)} ${verbo} a partir del lunes ${fmtDate(siguienteCorte)}.`)
    }
    return bad(400, 'No hay pedidos pendientes de facturar a este restaurante.')
  }

  // Lineas: se toma el SNAPSHOT congelado socio_liq_* (respeta la tarifa pactada). Si falta
  // (pedido entregado antes del trigger de congelado), se recalcula con la logica antigua.
  const lineas = pedidos.map((r) => {
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
  const totComision = +lineas.reduce((s, r) => s + r.comision, 0).toFixed(2)
  const totEnvio = +lineas.reduce((s, r) => s + r.envio, 0).toFixed(2)
  const totPropina = +lineas.reduce((s, r) => s + r.propina, 0).toFixed(2)
  // v10: el precio ya lo incluye todo. No se anade impuesto por encima.
  const total = +(totComision + totEnvio + totPropina).toFixed(2)

  const fechas = pedidos.map(r => new Date(r.entregado_at || r.created_at)).sort((a, b) => +a - +b)
  const periodo_inicio = (fechas[0] || new Date()).toISOString().slice(0, 10)
  // v15: el periodo cierra el domingo anterior al corte, como liquidacion-semanal.
  const finPeriodo = periodo_fin_in && new Date(periodo_fin_in) < corte ? new Date(periodo_fin_in) : corte
  const periodo_fin = new Date(finPeriodo.getTime() - 1).toISOString().slice(0, 10)

  if (simular) {
    return ok({
      simulacion: true, pedidos_count: pedidos.length, comision: totComision, envios: totEnvio,
      propinas: totPropina, total, comision_pct: comisionPct, periodo_inicio, periodo_fin, lineas, ...infoCorte,
    })
  }

  const anio = new Date().getFullYear()
  const { data: corrData, error: corrErr } = await admin.rpc('siguiente_correlativo_factura_socio', { p_socio_id: socio.id, p_anio: anio })
  if (corrErr) return bad(500, `Error al reservar correlativo: ${corrErr.message}`)
  const correlativo = Number(corrData)
  const numero = `${anio}/${String(correlativo).padStart(4, '0')}`

  const snapshotSocio = {
    nombre: socio.nombre, razon_social: socio.razon_social, nif: socio.nif,
    direccion_fiscal: socio.direccion_fiscal, codigo_postal: socio.codigo_postal,
    ciudad: socio.ciudad, provincia: socio.provincia, pais: socio.pais, iban: socio.iban,
  }
  const snapshotRest = {
    nombre: est.nombre, razon_social: est.razon_social, nif: est.nif,
    direccion_fiscal: est.direccion_fiscal, codigo_postal: est.codigo_postal,
    ciudad: est.ciudad_fiscal, provincia: est.provincia_fiscal,
  }
  const notas = `Comision = ${eur(totComision)} · Envios = ${eur(totEnvio)} · Propinas = ${eur(totPropina)} · IGIC incluido`
  const { data: factura, error: fErr } = await admin.from('facturas_socio_restaurante').insert({
    socio_id: socio.id, establecimiento_id: est.id,
    numero, anio, serie_correlativo: correlativo,
    periodo_inicio, periodo_fin, pedidos_count: pedidos.length,
    base_imponible: total, iva_pct: 0, iva_importe: 0, total,
    snapshot_socio: snapshotSocio, snapshot_restaurante: snapshotRest, notas,
  }).select().single()
  if (fErr || !factura) return bad(500, `Error creando factura: ${fErr?.message}`)

  const { error: updErr } = await admin.from('pedidos').update({ factura_socio_id: factura.id }).in('id', pedidos.map(r => r.id))
  if (updErr) {
    await admin.from('facturas_socio_restaurante').delete().eq('id', factura.id)
    return bad(500, `Error marcando pedidos: ${updErr.message}`)
  }

  let pdfBytes: Uint8Array
  try {
    const doc = await PDFDocument.create()
    const page = doc.addPage([595.28, 841.89])
    const font = await doc.embedFont(StandardFonts.Helvetica)
    const bold = await doc.embedFont(StandardFonts.HelveticaBold)
    const W = page.getWidth(); const H = page.getHeight(); const M = 40
    let y = H - M
    const text = (s: string, x: number, yy: number, size = 10, f = font, color = rgb(0.1, 0.1, 0.1)) => page.drawText(s, { x, y: yy, size, font: f, color })

    text('FACTURA', M, y, 22, bold)
    text(`Nº ${numero}`, W - M - 150, y, 12, bold, rgb(0.5, 0.5, 0.5)); y -= 22
    text(`Fecha: ${fmtDate(new Date())}`, W - M - 150, y, 10, font, rgb(0.45, 0.45, 0.45)); y -= 28

    text('EMISOR', M, y, 9, bold, rgb(0.5, 0.5, 0.5)); y -= 14
    text(socio.razon_social || socio.nombre || '', M, y, 11, bold); y -= 14
    text(`NIF: ${socio.nif}`, M, y); y -= 13
    text(socio.direccion_fiscal || '', M, y); y -= 13
    text(`${socio.codigo_postal || ''} ${socio.ciudad || ''}${socio.provincia ? ', ' + socio.provincia : ''}`, M, y); y -= 13

    let y2 = H - M - 50 - 28
    text('CLIENTE', W / 2 + 10, y2, 9, bold, rgb(0.5, 0.5, 0.5)); y2 -= 14
    text(est.razon_social || est.nombre || '', W / 2 + 10, y2, 11, bold); y2 -= 14
    text(`CIF/NIF: ${est.nif}`, W / 2 + 10, y2); y2 -= 13
    text(est.direccion_fiscal || est.direccion || '', W / 2 + 10, y2); y2 -= 13
    text(`${est.codigo_postal || ''} ${est.ciudad_fiscal || ''}${est.provincia_fiscal ? ', ' + est.provincia_fiscal : ''}`, W / 2 + 10, y2); y2 -= 13
    y = Math.min(y, y2) - 16

    page.drawRectangle({ x: M, y: y - 4, width: W - 2 * M, height: 20, color: rgb(0.95, 0.95, 0.97) })
    text('CONCEPTO', M + 8, y + 2, 9, bold, rgb(0.3, 0.3, 0.3)); y -= 26
    text(`Comision + envios + propinas del ${fmtDate(periodo_inicio)} al ${fmtDate(periodo_fin)}`, M + 4, y, 10, font); y -= 14
    text(`Total pedidos: ${pedidos.length}`, M + 4, y, 10, font, rgb(0.4, 0.4, 0.4)); y -= 22

    const cols = [
      { label: 'Codigo', x: M + 4 },
      { label: 'Fecha', x: M + 92 },
      { label: 'Comision', x: M + 185 },
      { label: 'Envio', x: M + 265 },
      { label: 'Propina', x: M + 345 },
      { label: 'Total', x: W - M - 58 },
    ]
    page.drawRectangle({ x: M, y: y - 4, width: W - 2 * M, height: 18, color: rgb(0.92, 0.92, 0.95) })
    for (const c of cols) text(c.label, c.x, y + 1, 9, bold, rgb(0.3, 0.3, 0.3))
    y -= 20
    for (const r of lineas) {
      if (y < 130) { doc.addPage([595.28, 841.89]); y = H - M }
      text(r.codigo, cols[0].x, y, 9)
      text(fmtDate(r.fecha), cols[1].x, y, 9)
      text(eur(r.comision), cols[2].x, y, 9)
      text(r.esDelivery ? eur(r.envio) : '—', cols[3].x, y, 9)
      text(r.esDelivery ? eur(r.propina) : '—', cols[4].x, y, 9)
      text(eur(r.total_linea), cols[5].x, y, 9, bold)
      y -= 14
    }

    y -= 8
    page.drawLine({ start: { x: W - M - 220, y }, end: { x: W - M, y }, thickness: 0.6, color: rgb(0.7, 0.7, 0.7) }); y -= 14
    const labelX = W - M - 220; const valX = W - M - 60
    text('Comisiones', labelX, y, 10); text(eur(totComision), valX, y, 10); y -= 13
    text('Envios', labelX, y, 10); text(eur(totEnvio), valX, y, 10); y -= 13
    text('Propinas', labelX, y, 10); text(eur(totPropina), valX, y, 10); y -= 18
    page.drawRectangle({ x: labelX - 6, y: y - 6, width: 226, height: 20, color: rgb(0.95, 0.95, 0.97) })
    text('TOTAL', labelX, y, 11, bold); text(eur(total), valX, y, 11, bold); y -= 16
    text('IGIC incluido', labelX, y, 9, font, rgb(0.45, 0.45, 0.45)); y -= 22

    y -= 8
    text('FORMA DE PAGO', M, y, 9, bold, rgb(0.5, 0.5, 0.5)); y -= 14
    if (socio.iban) { text(`Transferencia — IBAN: ${socio.iban}`, M, y, 10); y -= 13 }
    text(`Titular: ${socio.razon_social || socio.nombre}`, M, y, 10); y -= 13
    text('Vencimiento: 15 dias desde la emision', M, y, 10, font, rgb(0.4, 0.4, 0.4)); y -= 18

    text(`Factura generada con Pidoo · ${new Date().toISOString().slice(0, 19).replace('T', ' ')} UTC`, M, M - 10, 7, font, rgb(0.65, 0.65, 0.65))
    pdfBytes = await doc.save()
  } catch (e) {
    await admin.from('pedidos').update({ factura_socio_id: null }).in('id', pedidos.map(r => r.id))
    await admin.from('facturas_socio_restaurante').delete().eq('id', factura.id)
    return bad(500, `Error generando PDF: ${(e as Error).message}`)
  }

  const path = `${socio.id}/${anio}/${sanitizeNum(numero)}.pdf`
  const { error: upErr } = await admin.storage.from('facturas-socio').upload(path, pdfBytes, { contentType: 'application/pdf', upsert: true })
  if (upErr) return bad(500, `Error subiendo PDF: ${upErr.message}`)
  const { data: signed } = await admin.storage.from('facturas-socio').createSignedUrl(path, 60 * 60 * 24 * 365)
  await admin.from('facturas_socio_restaurante').update({ pdf_url: signed?.signedUrl || null }).eq('id', factura.id)

  return ok({ factura_id: factura.id, numero, pdf_url: signed?.signedUrl || null, total, base: total, comision: totComision, envios: totEnvio, propinas: totPropina, comision_pct: comisionPct, pedidos_count: pedidos.length, periodo_inicio, periodo_fin, ...infoCorte })
})
