import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'
import { PDFDocument, StandardFonts, rgb } from 'npm:pdf-lib@1.17.1'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const EMISOR = {
  razon: 'Rogotech',
  cif: '[CIF_ROGOTECH]',
  direccion: 'Carretera España, 79',
  cp_ciudad: '38390 Santa Cruz de Tenerife',
  email: 'hola@pidoo.es',
}

const PRIMARY = rgb(1, 0.42, 0.17)
const TEXT = rgb(0.09, 0.09, 0.09)
const MUTE = rgb(0.45, 0.45, 0.45)
const LINE = rgb(0.85, 0.85, 0.85)

function fmtEur(n: number) {
  return (Number(n) || 0).toFixed(2) + ' EUR'
}
function fmtDate(d?: string | null) {
  if (!d) return '-'
  return new Date(d).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' })
}
function yearWeek(d?: string | null) {
  const date = d ? new Date(d) : new Date()
  const tmp = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  const dayNum = (tmp.getUTCDay() + 6) % 7
  tmp.setUTCDate(tmp.getUTCDate() - dayNum + 3)
  const firstThursday = tmp.getTime()
  tmp.setUTCMonth(0, 1)
  if (tmp.getUTCDay() !== 4) tmp.setUTCMonth(0, 1 + ((4 - tmp.getUTCDay()) + 7) % 7)
  const week = 1 + Math.ceil((firstThursday - tmp.getTime()) / 604800000)
  return { year: date.getUTCFullYear(), week: String(week).padStart(2, '0') }
}

function ascii(s: string) {
  return (s ?? '').toString().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/€/g, 'EUR').replace(/[^\x20-\x7E]/g, '')
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  try {
    const body = await req.json()
    const { tipo, id } = body || {}
    if (!tipo || !id || (tipo !== 'restaurante' && tipo !== 'socio')) {
      return new Response(JSON.stringify({ error: 'tipo y id requeridos' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } })
    }

    const sb = createClient(SUPABASE_URL, SERVICE_ROLE)

    let pdfBytes: Uint8Array
    let numeroFactura = ''
    let datosReceptor: { nombre: string; nif: string; lineas: string[]; email: string } = { nombre: '', nif: '', lineas: [], email: '' }
    let desglose: Array<[string, string]> = []
    let totalLinea: [string, string] | null = null
    let periodoInicio = ''
    let periodoFin = ''

    if (tipo === 'restaurante') {
      const { data: fac, error } = await sb
        .from('facturas_semanales')
        .select('*, establecimientos!inner(id, nombre, direccion, email, user_id, razon_social, nif)')
        .eq('id', id)
        .single()
      if (error || !fac) throw new Error('Factura no encontrada: ' + (error?.message || ''))

      const est = (fac as any).establecimientos
      datosReceptor = {
        nombre: est.razon_social || est.nombre || '-',
        nif: est.nif || '',
        lineas: [est.direccion].filter(Boolean),
        email: est.email || '-',
      }
      periodoInicio = fac.periodo_inicio || fac.semana_inicio
      periodoFin = fac.periodo_fin || fac.semana_fin
      const yw = yearWeek(periodoInicio)
      numeroFactura = `PID-RES-${yw.year}-W${yw.week}-${String(fac.id).slice(0, 6).toUpperCase()}`

      const ventasTarjeta = Number(fac.ventas_tarjeta || 0)
      const aFavor = Number(fac.a_favor_restaurante || 0)
      const ventasEfectivo = Number(fac.ventas_efectivo || 0)
      const debe = Number(fac.debe_restaurante || 0)
      const balanceNeto = Number(fac.balance_neto || (aFavor - debe))
      const comision = Number(fac.comision_plataforma || 0)
      const iva = comision * 0.21

      desglose = [
        ['Pedidos con tarjeta', String(fac.pedidos_tarjeta || 0)],
        ['Ventas tarjeta (bruto)', fmtEur(ventasTarjeta)],
        ['A favor del restaurante', fmtEur(aFavor)],
        ['Pedidos en efectivo', String(fac.pedidos_efectivo || 0)],
        ['Ventas efectivo (bruto)', fmtEur(ventasEfectivo)],
        ['Deuda efectivo a Pidoo', fmtEur(debe)],
        ['Comision plataforma (base)', fmtEur(comision)],
        ['IVA 21% sobre comision', fmtEur(iva)],
        ['Balance neto semana', fmtEur(balanceNeto)],
      ]
      totalLinea = ['Liquidacion neta', fmtEur(balanceNeto)]

      pdfBytes = await buildPdf({
        titulo: 'Factura semanal - Liquidacion restaurante',
        numeroFactura,
        periodoInicio,
        periodoFin,
        receptor: datosReceptor,
        desglose,
        total: totalLinea,
        subtitulo: 'Comision de plataforma por ventas con tarjeta. Los pagos en efectivo se compensan contra la deuda acumulada.',
      })

      const path = `restaurante/${fac.id}.pdf`
      await sb.storage.from('facturas-semanales').upload(path, pdfBytes, {
        contentType: 'application/pdf', upsert: true,
      })
      const { data: signed } = await sb.storage.from('facturas-semanales').createSignedUrl(path, 60 * 60 * 24 * 365)
      const url = signed?.signedUrl
      await sb.from('facturas_semanales').update({ pdf_url: url }).eq('id', fac.id)
      return new Response(JSON.stringify({ ok: true, url, numero_factura: numeroFactura }), {
        headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }

    // tipo === 'socio'
    const { data: bal, error } = await sb
      .from('balances_socio')
      .select('*, socios!inner(id, nombre_comercial, nombre, email, user_id, razon_social, nif, direccion_fiscal, codigo_postal, ciudad, provincia, pais)')
      .eq('id', id)
      .single()
    if (error || !bal) throw new Error('Balance no encontrado: ' + (error?.message || ''))

    const soc = (bal as any).socios
    const cpCiudad = [soc.codigo_postal, soc.ciudad].filter(Boolean).join(' ')
    datosReceptor = {
      nombre: soc.razon_social || soc.nombre_comercial || soc.nombre || '-',
      nif: soc.nif || '',
      lineas: [soc.direccion_fiscal, cpCiudad, soc.provincia].filter(Boolean),
      email: soc.email || '-',
    }
    periodoInicio = bal.periodo_inicio
    periodoFin = bal.periodo_fin
    const yw = yearWeek(periodoInicio)
    numeroFactura = `PID-SOC-${yw.year}-W${yw.week}-${String(bal.id).slice(0, 6).toUpperCase()}`

    const comisiones = Number(bal.comisiones_tarjeta || 0)
    const envios = Number(bal.envios_tarjeta || 0)
    const propinas = Number(bal.propinas_tarjeta || 0)
    const totalPagar = Number(bal.total_pagar_socio || (comisiones + envios + propinas))
    const efectivo = Number(bal.total_efectivo_recaudado || 0)

    desglose = [
      ['Comisiones (tarjeta)', fmtEur(comisiones)],
      ['Envios cobrados (tarjeta)', fmtEur(envios)],
      ['Propinas (tarjeta)', fmtEur(propinas)],
      ['Total efectivo recaudado por el socio', fmtEur(efectivo)],
    ]
    totalLinea = ['Total a pagar al socio', fmtEur(totalPagar)]

    pdfBytes = await buildPdf({
      titulo: 'Factura semanal - Liquidacion socio',
      numeroFactura,
      periodoInicio,
      periodoFin,
      receptor: datosReceptor,
      desglose,
      total: totalLinea,
      subtitulo: 'El efectivo recaudado se compensa contra los pagos de tarjeta. El neto a ingresar al socio es el total de esta factura.',
    })

    const path = `socio/${bal.id}.pdf`
    await sb.storage.from('facturas-semanales').upload(path, pdfBytes, {
      contentType: 'application/pdf', upsert: true,
    })
    const { data: signed } = await sb.storage.from('facturas-semanales').createSignedUrl(path, 60 * 60 * 24 * 365)
    const url = signed?.signedUrl
    await sb.from('balances_socio').update({ pdf_url: url }).eq('id', bal.id)
    return new Response(JSON.stringify({ ok: true, url, numero_factura: numeroFactura }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    console.error('generar-factura-liquidacion-pdf error', e)
    return new Response(JSON.stringify({ error: String(e?.message || e) }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }
})

async function buildPdf(opts: {
  titulo: string
  numeroFactura: string
  periodoInicio: string
  periodoFin: string
  receptor: { nombre: string; nif?: string; lineas?: string[]; email: string }
  desglose: Array<[string, string]>
  total: [string, string]
  subtitulo?: string
}) {
  const pdf = await PDFDocument.create()
  const page = pdf.addPage([595, 842])
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)

  const draw = (txt: string, x: number, y: number, size = 10, f = font, color = TEXT) => {
    page.drawText(ascii(txt), { x, y, size, font: f, color })
  }
  const line = (x1: number, y1: number, x2: number, y2: number, color = LINE) => {
    page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: 0.7, color })
  }

  // Logo texto
  draw('pidoo', 40, 790, 28, bold, PRIMARY)
  draw('Factura semanal', 40, 765, 11, font, MUTE)

  // Cabecera derecha
  draw(opts.numeroFactura, 400, 795, 10, bold, TEXT)
  draw('Periodo: ' + fmtDate(opts.periodoInicio) + ' -> ' + fmtDate(opts.periodoFin), 400, 780, 9, font, MUTE)
  draw('Emision: ' + fmtDate(new Date().toISOString()), 400, 767, 9, font, MUTE)

  line(40, 750, 555, 750)

  // Emisor
  draw('EMISOR', 40, 730, 9, bold, MUTE)
  draw(EMISOR.razon, 40, 714, 11, bold)
  draw('CIF: ' + EMISOR.cif, 40, 700, 10)
  draw(EMISOR.direccion, 40, 686, 10)
  draw(EMISOR.cp_ciudad, 40, 672, 10)
  draw(EMISOR.email, 40, 658, 10, font, MUTE)

  // Receptor
  draw('RECEPTOR', 320, 730, 9, bold, MUTE)
  draw(opts.receptor.nombre, 320, 714, 11, bold)
  let ry = 700
  if (opts.receptor.nif) { draw('NIF: ' + opts.receptor.nif, 320, ry, 10); ry -= 14 }
  for (const ln of (opts.receptor.lineas || [])) { draw(ln, 320, ry, 10); ry -= 14 }
  draw(opts.receptor.email, 320, ry, 10, font, MUTE)

  line(40, 640, 555, 640)

  // Titulo tabla
  draw(opts.titulo.toUpperCase(), 40, 620, 10, bold, PRIMARY)
  if (opts.subtitulo) {
    const sub = ascii(opts.subtitulo)
    const chunks = wrap(sub, 95)
    let yy = 604
    for (const c of chunks) {
      draw(c, 40, yy, 9, font, MUTE)
      yy -= 12
    }
  }

  // Tabla desglose
  let y = 560
  draw('CONCEPTO', 40, y, 9, bold, MUTE)
  draw('IMPORTE', 480, y, 9, bold, MUTE)
  y -= 8
  line(40, y, 555, y)
  y -= 16

  for (const [k, v] of opts.desglose) {
    draw(k, 40, y, 10)
    const w = bold.widthOfTextAtSize(ascii(v), 10)
    draw(v, 555 - w, y, 10, bold)
    y -= 18
    if (y < 150) break
  }

  // Total
  y -= 6
  line(40, y, 555, y)
  y -= 22
  const [tk, tv] = opts.total
  draw(tk.toUpperCase(), 40, y, 11, bold, PRIMARY)
  const tw = bold.widthOfTextAtSize(ascii(tv), 14)
  draw(tv, 555 - tw, y - 2, 14, bold, PRIMARY)

  // Pie
  draw('Esta factura se genera automaticamente. Pidoo es una marca de Rogotech.', 40, 60, 8, font, MUTE)
  draw('pidoo.es', 40, 48, 8, font, MUTE)

  return await pdf.save()
}

function wrap(text: string, maxChars: number) {
  const words = text.split(' ')
  const out: string[] = []
  let cur = ''
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > maxChars) {
      if (cur) out.push(cur)
      cur = w
    } else {
      cur = (cur + ' ' + w).trim()
    }
  }
  if (cur) out.push(cur)
  return out.slice(0, 4)
}
