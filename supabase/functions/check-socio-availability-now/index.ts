import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Content-Type': 'application/json' }

// check-socio-availability-now v10
// Disponible = al menos un socio vinculado (estado='activa') que este ACTIVO, EN SERVICIO
// y con SENAL RECIENTE (last_location_at < FRESH_MS).
//
// CAMBIO v10 (18-jul-2026): AUTONOMIA DEL SOCIO.
//   - Vinculos con reparto_activo=false (el socio pauso ese restaurante desde su app)
//     NO cuentan como disponibles.
//   - Fuentes: sin socio_id en el body (carrito normal de la app / tienda del restaurante)
//     solo cuentan socios con acepta_app=true. Con socio_id (carrito del MARKETPLACE de un
//     socio; pido-app lo mandara en una release futura) se evalua SOLO ese socio y exige
//     acepta_marketplace=true.
//   Alineado con el dispatcher create-shipday-order v54.
//
// CAMBIO v8 (5-jul-2026): se REINTRODUCE la frescura, alineada con el nuevo modelo de
// presencia (en_servicio ya no se apaga por minimizar; la disponibilidad real la decide
// la frescura del latido rider-heartbeat, ~60s). Umbral 12 min (redes de Canarias),
// mismo criterio que el dispatcher.
const FRESH_MS = 12 * 60 * 1000
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  let body: any = {}
  try { body = await req.json() } catch {}
  const est = body?.establecimiento_id
  const socioId = body?.socio_id || null // contexto marketplace del socio (opcional)
  if (!est) return new Response(JSON.stringify({ error: 'missing establecimiento_id' }), { status: 400, headers: CORS })
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  let q = sb.from('socio_establecimiento')
    .select('reparto_activo, socios!inner(id, en_servicio, activo, last_location_at, acepta_app, acepta_marketplace)')
    .eq('establecimiento_id', est).eq('estado', 'activa')
  if (socioId) q = q.eq('socio_id', socioId)
  const { data: vinc } = await q
  const now = Date.now()
  const esFresco = (s: any) => {
    const ts = s?.last_location_at ? new Date(s.last_location_at).getTime() : NaN
    return Number.isFinite(ts) && (now - ts) <= FRESH_MS
  }
  const aceptaFuente = (s: any) => socioId ? (s?.acepta_marketplace !== false) : (s?.acepta_app !== false)
  const ok = (vinc || [])
    .filter((v: any) => v.reparto_activo !== false)
    .map((v: any) => v.socios)
    .filter((s: any) => s && s.activo && s.en_servicio && esFresco(s) && aceptaFuente(s))
  return new Response(JSON.stringify({ ok: true, disponible: ok.length > 0, online_count: ok.length }), { status: 200, headers: CORS })
})
