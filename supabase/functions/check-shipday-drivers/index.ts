// check-shipday-drivers — DEPRECATED (Shipday integration removed)
//
// Antes corría cada minuto desde pg_cron para chequear el estado online
// de cada rider en Shipday. Ahora el estado lo gestionan los propios
// riders desde su app via `rider-online` / `rider-offline`. Esta función
// queda neutralizada y el cron debe deshabilitarse manualmente.

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
