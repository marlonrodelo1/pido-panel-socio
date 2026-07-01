// dispatch-order v13 — PROXY a create-shipday-order v36.
//
// Históricamente esta era la función canon del dispatcher propio (sprint 26-27
// abril). En el pivote a Shipday del 30 abril se convirtió en proxy a Shipday.
// Hoy (26 mayo) Pidoo vuelve al dispatcher propio: create-shipday-order es la
// canon, dispatch-order queda como alias para no romper paneles viejos.
//
// Recibe lo que sea (pedido_id, pedidoId, etc) y reenvía como POST a
// create-shipday-order. Devuelve la misma respuesta.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method_not_allowed' }), { status: 405, headers: CORS })
  }

  let body: any
  try { body = await req.json() } catch {
    return new Response(JSON.stringify({ error: 'invalid_json' }), { status: 400, headers: CORS })
  }

  const baseUrl = Deno.env.get('SUPABASE_URL') || ''
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''

  const upstream = await fetch(`${baseUrl}/functions/v1/create-shipday-order`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${serviceKey}`,
    },
    body: JSON.stringify(body),
  })

  const text = await upstream.text()
  return new Response(text, {
    status: upstream.status,
    headers: { ...CORS, 'X-Proxied-To': 'create-shipday-order' },
  })
})
