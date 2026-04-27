// validar-shipday-key — DEPRECATED (Shipday integration removed)
//
// El wizard de onboarding del socio y la ficha de admin la usaban para
// validar API keys Shipday y obtener el `carrier_name`. El nuevo flujo
// no requiere API key Shipday; los socios operan via la app propia.

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
