import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getCorsHeaders, handleCorsPreflightRequest } from '../_shared/cors.ts'

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return handleCorsPreflightRequest(req)

  const CORS = getCorsHeaders(req)

  try {
    // 1. Verificar JWT
    const authHeader = req.headers.get('Authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return Response.json({ error: 'Unauthorized' }, { status: 401, headers: CORS })
    }
    const token = authHeader.replace('Bearer ', '')

    const anon = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
    )
    const { data: { user }, error: authErr } = await anon.auth.getUser(token)
    if (authErr || !user) {
      return Response.json({ error: 'Invalid or expired token' }, { status: 401, headers: CORS })
    }

    // 2. Comprobar rol superadmin
    const { data: u } = await anon.from('usuarios').select('rol').eq('id', user.id).single()
    if (u?.rol !== 'superadmin') {
      return Response.json({ error: 'Forbidden: superadmin role required' }, { status: 403, headers: CORS })
    }

    // 3. Leer body y ejecutar accion
    const { action, shipday_api_key, socio_id, activo } = await req.json()

    if (action === 'verify') {
      if (!shipday_api_key?.trim()) {
        return Response.json({ valid: false }, { status: 200, headers: CORS })
      }
      const r = await fetch('https://api.shipday.com/auth/check-api-key', {
        method: 'GET',
        headers: { Authorization: `Bearer ${shipday_api_key.trim()}` },
      })
      return Response.json({ valid: r.ok }, { status: 200, headers: CORS })
    }

    if (action === 'update') {
      if (!socio_id) {
        return Response.json({ error: 'socio_id is required' }, { status: 400, headers: CORS })
      }
      const svc = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      )
      const { error } = await svc
        .from('socios')
        .update({ shipday_api_key: shipday_api_key?.trim() || null })
        .eq('id', socio_id)
      if (error) {
        return Response.json({ error: error.message }, { status: 500, headers: CORS })
      }
      return Response.json({ success: true }, { status: 200, headers: CORS })
    }

    if (action === 'toggle_activo') {
      if (!socio_id) {
        return Response.json({ error: 'socio_id is required' }, { status: 400, headers: CORS })
      }
      const svc = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      )
      const { error } = await svc
        .from('socios')
        .update({ activo: !!activo })
        .eq('id', socio_id)
      if (error) {
        return Response.json({ error: error.message }, { status: 500, headers: CORS })
      }
      return Response.json({ success: true }, { status: 200, headers: CORS })
    }

    return Response.json({ error: 'Unknown action' }, { status: 400, headers: CORS })

  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Internal server error'
    return Response.json({ error: msg }, { status: 500, headers: CORS })
  }
})
