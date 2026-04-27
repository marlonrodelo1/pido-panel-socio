// sync-shipday-status — DEPRECATED (Shipday integration removed)
//
// El cliente solía llamar esta función cada 8 s para sincronizar el
// estado del pedido. Ahora el estado se actualiza por Realtime en la
// tabla `pedidos` desde el dispatcher propio y las edge functions
// `rider-*`. Esta función queda neutralizada.

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
