// create-shipday-order — DEPRECATED (Shipday integration removed)
//
// Pidoo usa ahora `dispatch-order` con su propio dispatcher. Esta función
// queda neutralizada y devuelve 410 Gone para que cualquier llamada
// residual desde versiones antiguas de la app o paneles falle de forma
// explícita en lugar de intentar contactar a la API de Shipday.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

serve((req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  return new Response(
    JSON.stringify({
      error: 'gone',
      message: 'Shipday integration removed — use the propio dispatcher (dispatch-order)',
    }),
    { status: 410, headers: { ...CORS, 'Content-Type': 'application/json' } },
  )
})
