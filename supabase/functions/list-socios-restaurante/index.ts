// list-socios-restaurante v1 — devuelve los socios vinculados ACTIVOS de un
// establecimiento para que el restaurante elija a cuál asignar (caso multi-socio).
// Usa service role y devuelve SOLO campos curados (sin PII: ni api_key ni GPS ni
// teléfono), porque RLS de socios no deja al restaurante leer socios privados.
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  try {
    const url = Deno.env.get('SUPABASE_URL')!
    const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const anon = Deno.env.get('SUPABASE_ANON_KEY')!
    const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim()
    if (!jwt) return Response.json({ error: 'missing_auth' }, { status: 401, headers: CORS })
    const authClient = createClient(url, anon, { global: { headers: { Authorization: `Bearer ${jwt}` } } })
    const { data: { user } } = await authClient.auth.getUser(jwt)
    if (!user) return Response.json({ error: 'invalid_jwt' }, { status: 401, headers: CORS })

    const { establecimiento_id } = await req.json().catch(() => ({}))
    if (!establecimiento_id) return Response.json({ error: 'establecimiento_id requerido' }, { status: 400, headers: CORS })

    const sb = createClient(url, service)

    const { data: est } = await sb.from('establecimientos').select('id, user_id').eq('id', establecimiento_id).maybeSingle()
    if (!est) return Response.json({ error: 'establecimiento_no_encontrado' }, { status: 404, headers: CORS })
    const { data: rolRow } = await sb.from('usuarios').select('rol').eq('id', user.id).maybeSingle()
    const isAdmin = rolRow?.rol === 'admin' || rolRow?.rol === 'superadmin'
    if (est.user_id !== user.id && !isAdmin) return Response.json({ error: 'forbidden' }, { status: 403, headers: CORS })

    const { data: vincs } = await sb.from('socio_establecimiento')
      .select('socio_id, socios!inner(id, nombre, nombre_comercial, logo_url, en_servicio)')
      .eq('establecimiento_id', establecimiento_id).eq('estado', 'activa')

    const socios = (vincs || []).map((v: any) => ({
      socio_id: v.socio_id,
      nombre: v.socios?.nombre_comercial || v.socios?.nombre || 'Socio',
      logo_url: v.socios?.logo_url || null,
      en_servicio: !!v.socios?.en_servicio,
    }))

    return Response.json({ ok: true, socios }, { status: 200, headers: CORS })
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'error' }, { status: 500, headers: CORS })
  }
})
