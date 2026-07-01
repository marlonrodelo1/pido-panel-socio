import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'
import { PDFDocument, StandardFonts, rgb } from 'https://esm.sh/pdf-lib@1.17.1'

// generar-factura-socio-restaurante v6 — modelo comision (22-jun-2026).
// El socio factura al restaurante por: COMISION (% pactado del subtotal) + ENVIO + PROPINA.
//  - Delivery entregado: comision + envio + propina.
//  - Recogida del MARKETPLACE del socio (origen_pedido='marketplace_socio'): SOLO comision.
//  - Recogida por tienda del restaurante / app general: NO entra (el socio no cobra).
// Comision % = socio_establecimiento.comision_pct (default 10). Calcula desde pedidos,
// marca los facturados (factura_socio_id) y genera PDF.

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

  // Comision % pactada para este par socio-restaurante (default 10).
  const { data: vinc } = await admin.from('socio_establecimiento')
    .select('comision_pct').eq('socio_id', socio.id).eq('establecimiento_id', establecimiento_id).maybeSingle()
  const comisionPct = Number(vinc?.comision_pct ?? 10)

  // Pedidos a facturar: entregados, del socio, sin facturar, y:
  //  - delivery (cualquier origen), o
  //  - recogida SOLO si vino del marketplace del socio.
  let q = admin.from('pedidos')
    .select('id, codigo, modo_entrega, origen_pedido, subtotal, coste_envio, propina, created_at, entregado_at')
    .eq('socio_id', socio.id)
    .eq('establecimiento_id', establecimiento_id)
    .eq('estado', 'entregado')
    .is('factura_socio_id', null)
    .or('modo_entrega.eq.delivery,and(modo_entrega.eq.recogida,origen_pedido.eq.marketplace_socio)')
    .order('entregado_at', { ascending: true })
  if (periodo_inicio_in) q = q.gte('entregado_at', periodo_inicio_in)
  if (periodo_fin_in) q = q.lt('entregado_at', periodo_fin_in)
  const { data: pedidos, error: pErr } = await q
  if (pErr) return bad(500, pErr.message)
  if (!pedidos || pedidos.length === 0) return bad(400, 'No hay pedidos pendientes de facturar a este restaurante.')

  // Lineas: comision siempre; envio y propina solo en delivery.
  const lineas = pedidos.map((r) => {
    const esDelivery = r.modo_entrega === 'delivery'
    const comision = +(toNum(r.subtotal) * comisionPct / 100).toFixed(2)
    const envio = esDelivery ? toNum(r.coste_envio) : 0
    const propina = esDelivery ? toNum(r.propina) : 0
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
  const base = +(totComision + totEnvio + totPropina).toFixed(2)
  const ivaPct = Number(socio.iva_pct ?? 21)
  const ivaImporte = +(base * ivaPct / 100).toFixed(2)
  const total = +(base + ivaImporte).toFixed(2)

  const fechas = pedidos.map(r => new Date(r.entregado_at || r.created_at)).sort((a, b) => +a - +b)
  const periodo_inicio = (fechas[0] || new Date()).toISOString().slice(0, 10)
  const periodo_fin = (fechas[fechas.length - 1] || new Date()).toISOString().slice(0, 10)

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
  const notas = `Comision ${comisionPct}% = ${eur(totComision)} · Envios = ${eur(totEnvio)} · Propinas = ${eur(totPropina)}`
  const { data: factura, error: fErr } = await admin.from('facturas_socio_restaurante').insert({
    socio_id: socio.id, establecimiento_id: est.id,
    numero, anio, serie_correlativo: correlativo,
    periodo_inicio, periodo_fin, pedidos_count: pedidos.length,
    base_imponible: base, iva_pct: ivaPct, iva_importe: ivaImporte, total,
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
    text(`Comision (${comisionPct}%) + envios + propinas del ${fmtDate(periodo_inicio)} al ${fmtDate(periodo_fin)}`, M + 4, y, 10, font); y -= 14
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
    text(`Comisiones (${comisionPct}%)`, labelX, y, 10); text(eur(totComision), valX, y, 10); y -= 13
    text('Envios', labelX, y, 10); text(eur(totEnvio), valX, y, 10); y -= 13
    text('Propinas', labelX, y, 10); text(eur(totPropina), valX, y, 10); y -= 16
    text('Base imponible', labelX, y, 10, bold); text(eur(base), valX, y, 10, bold); y -= 13
    text(`IVA ${ivaPct}%`, labelX, y, 10); text(eur(ivaImporte), valX, y, 10); y -= 16
    page.drawRectangle({ x: labelX - 6, y: y - 6, width: 226, height: 20, color: rgb(0.95, 0.95, 0.97) })
    text('TOTAL', labelX, y, 11, bold); text(eur(total), valX, y, 11, bold); y -= 26

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

  return ok({ factura_id: factura.id, numero, pdf_url: signed?.signedUrl || null, total, base, comision: totComision, envios: totEnvio, propinas: totPropina, comision_pct: comisionPct, pedidos_count: pedidos.length })
})
