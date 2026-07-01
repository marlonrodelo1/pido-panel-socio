import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getCorsHeaders, handleCorsPreflightRequest } from '../_shared/cors.ts'

function generarCodigoAleatorio(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  let codigo = 'PD-'
  for (let i = 0; i < 6; i++) {
    codigo += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return codigo
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return handleCorsPreflightRequest(req)

  const CORS = getCorsHeaders(req)

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // Generate unique order code with retry logic
    let codigo: string
    let intentos = 0
    const maxIntentos = 10

    do {
      codigo = generarCodigoAleatorio()
      const { data: existe } = await supabase
        .from('pedidos')
        .select('id')
        .eq('codigo', codigo)
        .maybeSingle()

      if (!existe) break

      intentos++
      if (intentos >= maxIntentos) {
        return Response.json(
          { error: 'No se pudo generar un código único después de múltiples intentos' },
          { status: 500, headers: CORS }
        )
      }
    } while (true)

    return Response.json(
      { codigo },
      { status: 200, headers: CORS }
    )

  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Internal server error'
    return Response.json({ error: msg }, { status: 500, headers: CORS })
  }
})
