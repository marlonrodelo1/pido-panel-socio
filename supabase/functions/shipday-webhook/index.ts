// shipday-webhook — DEPRECATED (Shipday integration removed)
//
// Pidoo migró a un dispatcher propio. Esta función queda neutralizada
// para que cualquier llamada externa (incluido el webhook real de
// Shipday si quedaron suscripciones residuales) reciba 410 Gone.
//
// El archivo se mantiene en el repo y desplegado solo para que el
// historial de despliegues no pierda referencias y para devolver una
// respuesta clara a integraciones legacy.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
}

serve((req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  return new Response(
    JSON.stringify({
      error: 'gone',
      message: 'Shipday integration removed — use the propio dispatcher',
    }),
    { status: 410, headers: { ...CORS, 'Content-Type': 'application/json' } },
  )
})
