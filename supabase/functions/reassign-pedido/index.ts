// reassign-pedido (legacy) — redirige a reassign-pedido-v2.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  let body: any = {}
  try { body = await req.json() } catch (_) {}
  const r = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/reassign-pedido-v2`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}` },
    body: JSON.stringify(body),
  })
  const txt = await r.text()
  return new Response(txt, { status: r.status, headers: { ...CORS, 'Content-Type': 'application/json' } })
})
