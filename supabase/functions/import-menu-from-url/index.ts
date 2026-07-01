import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getCorsHeaders, handleCorsPreflightRequest } from '../_shared/cors.ts'

const LASTSHOP_CDN = 'https://res.cloudinary.com/lastpos/image/upload/f_auto,q_auto/'

function detectPlatform(url: string): 'lastshop' | 'glovo' | 'ubereats' | 'unknown' {
  const u = url.toLowerCase()
  if (u.includes('.last.shop') || u.includes('/last.shop/')) return 'lastshop'
  if (u.includes('glovoapp.com') || u.includes('glovo.com')) return 'glovo'
  if (u.includes('ubereats.com')) return 'ubereats'
  return 'unknown'
}

async function fetchLastshopMenu(url: string) {
  const clean = url.split('?')[0].replace(/\/$/, '')
  const ctxUrl = clean + '/index.pageContext.json'
  const ctxRes = await fetch(ctxUrl, { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' } })
  if (!ctxRes.ok) throw new Error(`No se pudo leer pageContext (${ctxRes.status}).`)
  const ctx = await ctxRes.json()

  let locationId: string | null = null, catalogId: string | null = null, shopName: string | null = null
  function walk(o: any) {
    if (!o || typeof o !== 'object') return
    if (Array.isArray(o)) { for (const i of o) walk(i); return }
    for (const [k, v] of Object.entries(o)) {
      if (k === 'locationId' && typeof v === 'string' && !locationId) locationId = v
      else if (k === 'catalogId' && typeof v === 'string' && !catalogId) catalogId = v
      else if (k === 'name' && typeof v === 'string' && !shopName && o?.slug) shopName = v
      walk(v)
    }
  }
  walk(ctx)
  if (!locationId || !catalogId) throw new Error('No se encontro catalogId/locationId')

  const origin = new URL(url).origin
  const catUrl = `https://api.last.app/shop/locations/${locationId}/catalog/${catalogId}?language=es`
  const catRes = await fetch(catUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0', 'Origin': origin, 'Accept': 'application/json' },
  })
  if (!catRes.ok) throw new Error(`Error descargando catalogo (${catRes.status})`)
  const cats = await catRes.json()

  const categorias: any[] = [], productos: any[] = []
  const gruposMap = new Map<string, any>()
  const prodExtras: any[] = []
  let orden_prod = 0

  for (let i = 0; i < cats.length; i++) {
    const c = cats[i]
    if (!c.enabled) continue
    categorias.push({ _lastId: c.id, nombre: (c.name || '').trim(), orden: i })
    for (const p of (c.products || [])) {
      if (!p.enabled || p.deleted) continue
      productos.push({
        _lastId: p.id, _catLastId: c.id,
        nombre: (p.name || '').trim(),
        descripcion: (p.description || '').trim() || null,
        precio: Math.round((p.price || 0)) / 100,
        imagen_url: p.imageId ? LASTSHOP_CDN + p.imageId : null,
        orden: orden_prod++,
      })
      for (const mg of (p.modifierGroups || [])) {
        if (!gruposMap.has(mg.id)) {
          gruposMap.set(mg.id, {
            _lastId: mg.id,
            nombre: (mg.name || 'Opciones').trim(),
            tipo: (mg.min === 1 && (mg.max === 1 || mg.maxSelectableQuantity === 1)) ? 'unico' : 'multiple',
            max_selecciones: mg.maxSelectableQuantity || mg.max || 1,
            opciones: (mg.modifiers || []).map((mod: any, oi: number) => ({
              nombre: (mod.name || '').trim(),
              // Last.shop usa priceImpact para el precio del extra
              precio: Math.round((mod.priceImpact || mod.price || 0)) / 100,
              orden: oi,
            })),
          })
        }
        prodExtras.push({ _prodLastId: p.id, _grupoLastId: mg.id })
      }
    }
  }

  return {
    plataforma: 'lastshop',
    shop_name: shopName,
    categorias, productos,
    grupos: Array.from(gruposMap.values()),
    prod_extras: prodExtras,
    stats: {
      categorias: categorias.length,
      productos: productos.length,
      productos_con_imagen: productos.filter(p => p.imagen_url).length,
      grupos_extras: gruposMap.size,
      opciones_extras: Array.from(gruposMap.values()).reduce((s, g) => s + g.opciones.length, 0),
    },
  }
}

async function insertIntoPidoo(supabase: any, establecimiento_id: string, data: any) {
  const catIdMap = new Map<string, string>()
  if (data.categorias.length > 0) {
    const rows = data.categorias.map((c: any) => ({ establecimiento_id, nombre: c.nombre, orden: c.orden, activa: true }))
    const { data: inserted, error } = await supabase.from('categorias').insert(rows).select('id')
    if (error) throw new Error('Error creando categorias: ' + error.message)
    data.categorias.forEach((c: any, i: number) => catIdMap.set(c._lastId, inserted[i].id))
  }

  const prodIdMap = new Map<string, string>()
  if (data.productos.length > 0) {
    const rows = data.productos.map((p: any) => ({
      establecimiento_id, categoria_id: catIdMap.get(p._catLastId),
      nombre: p.nombre, descripcion: p.descripcion, precio: p.precio,
      imagen_url: p.imagen_url, disponible: true, orden: p.orden,
    }))
    const inserted: any[] = []
    for (let i = 0; i < rows.length; i += 50) {
      const chunk = rows.slice(i, i + 50)
      const { data: r, error } = await supabase.from('productos').insert(chunk).select('id')
      if (error) throw new Error('Error creando productos: ' + error.message)
      inserted.push(...r)
    }
    data.productos.forEach((p: any, i: number) => prodIdMap.set(p._lastId, inserted[i].id))
  }

  const grupoIdMap = new Map<string, string>()
  if (data.grupos.length > 0) {
    const rows = data.grupos.map((g: any) => ({
      establecimiento_id, nombre: g.nombre, tipo: g.tipo, max_selecciones: g.max_selecciones,
    }))
    const { data: inserted, error } = await supabase.from('grupos_extras').insert(rows).select('id')
    if (error) throw new Error('Error creando grupos: ' + error.message)
    data.grupos.forEach((g: any, i: number) => grupoIdMap.set(g._lastId, inserted[i].id))

    const opcRows: any[] = []
    data.grupos.forEach((g: any) => {
      const gid = grupoIdMap.get(g._lastId)
      for (const o of g.opciones) opcRows.push({ grupo_id: gid, nombre: o.nombre, precio: o.precio, orden: o.orden })
    })
    if (opcRows.length > 0) {
      const { error: e2 } = await supabase.from('extras_opciones').insert(opcRows)
      if (e2) throw new Error('Error creando opciones: ' + e2.message)
    }
  }

  if (data.prod_extras.length > 0) {
    const rows = data.prod_extras
      .filter((pe: any) => prodIdMap.has(pe._prodLastId) && grupoIdMap.has(pe._grupoLastId))
      .map((pe: any) => ({ producto_id: prodIdMap.get(pe._prodLastId), grupo_id: grupoIdMap.get(pe._grupoLastId) }))
    if (rows.length > 0) {
      const { error } = await supabase.from('producto_extras').insert(rows)
      if (error) throw new Error('Error vinculando extras: ' + error.message)
    }
  }

  return {
    categorias: data.categorias.length, productos: data.productos.length,
    grupos_extras: data.grupos.length,
    opciones_extras: data.grupos.reduce((s: number, g: any) => s + g.opciones.length, 0),
    vinculos: data.prod_extras.length,
  }
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return handleCorsPreflightRequest(req)
  const CORS = getCorsHeaders(req)
  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return Response.json({ error: 'No autorizado' }, { status: 401, headers: CORS })
    const token = authHeader.replace('Bearer ', '')

    const supabaseUser = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )
    const { data: { user }, error: authErr } = await supabaseUser.auth.getUser(token)
    if (authErr || !user) return Response.json({ error: 'Token invalido' }, { status: 401, headers: CORS })

    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const { data: prof } = await supabase.from('usuarios').select('rol').eq('id', user.id).single()
    if (!prof || prof.rol !== 'superadmin') return Response.json({ error: 'Solo superadmin' }, { status: 403, headers: CORS })

    const { url, establecimiento_id, action } = await req.json()
    if (!url) return Response.json({ error: 'Falta url' }, { status: 400, headers: CORS })

    const platform = detectPlatform(url)
    if (platform === 'unknown') return Response.json({ error: 'Plataforma no soportada.' }, { status: 400, headers: CORS })
    if (platform === 'glovo' || platform === 'ubereats') {
      return Response.json({ error: `${platform === 'glovo' ? 'Glovo' : 'Uber Eats'} todavia no soportado. Usa el CSV.` }, { status: 400, headers: CORS })
    }

    const data = await fetchLastshopMenu(url)
    if (action === 'import') {
      if (!establecimiento_id) return Response.json({ error: 'Falta establecimiento_id' }, { status: 400, headers: CORS })
      const result = await insertIntoPidoo(supabase, establecimiento_id, data)
      return Response.json({ success: true, plataforma: platform, ...result }, { headers: CORS })
    }

    return Response.json({
      plataforma: platform, shop_name: data.shop_name, stats: data.stats,
      sample_productos: data.productos.slice(0, 10).map((p: any) => ({
        nombre: p.nombre, precio: p.precio,
        categoria: data.categorias.find((c: any) => c._lastId === p._catLastId)?.nombre,
        tiene_imagen: !!p.imagen_url,
      })),
      categorias: data.categorias.map((c: any) => c.nombre),
    }, { headers: CORS })
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Internal server error'
    return Response.json({ error: msg }, { status: 500, headers: CORS })
  }
})
