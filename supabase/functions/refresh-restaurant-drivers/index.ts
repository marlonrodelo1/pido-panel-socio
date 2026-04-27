// refresh-restaurant-drivers — DEPRECATED (Shipday integration removed)
//
// El cliente la invocaba al abrir el carrito para forzar un chequeo en
// vivo del estado de los riders en Shipday. Ahora el estado se mantiene
// en la tabla `drivers_status` por las edge functions `rider-online` /
// `rider-offline` y se lee directamente vía Realtime.

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
      message: 'Shipday integration removed — use the propio dispatcher',
    }),
    { status: 410, headers: { ...CORS, 'Content-Type': 'application/json' } },
  )
})
