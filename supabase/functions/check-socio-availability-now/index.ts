import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Content-Type': 'application/json' }

// check-socio-availability-now v7
// Disponible = al menos un socio vinculado (estado='activa') que esté ACTIVO y EN SERVICIO (online).
// CAMBIO v7: se eliminó la exigencia de GPS reciente (last_location_at < 60 min). Esa condición
// bloqueaba a socios realmente online cuyo GPS no se refresca a tiempo (p.ej. probando sin GPS),
// devolviendo 'no hay repartidores' erróneo. Ahora usa el MISMO criterio que el marketplace del
// socio (socios.en_servicio). El dispatcher (create-shipday-order) ya gestiona la asignación y el
// caso 'no rider' al aceptar el restaurante.
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  let body: any = {}
  try { body = await req.json() } catch {}
  const est = body?.establecimiento_id
  if (!est) return new Response(JSON.stringify({ error: 'missing establecimiento_id' }), { status: 400, headers: CORS })
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  const { data: vinc } = await sb.from('socio_establecimiento').select('socios!inner(id, en_servicio, activo)').eq('establecimiento_id', est).eq('estado', 'activa')
  const ok = (vinc || []).map((v:any) => v.socios).filter((s:any) => s && s.activo && s.en_servicio)
  return new Response(JSON.stringify({ ok: true, disponible: ok.length > 0, online_count: ok.length }), { status: 200, headers: CORS })
})
