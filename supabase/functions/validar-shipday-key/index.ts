// validar-shipday-key — Reactivada.
//
// Body: { api_key }
// GET https://api.shipday.com/carriers con `Authorization: Basic <api_key>`.
//
// Devuelve:
//   200 { ok: true, carriers_count, carriers: [string nombres] }
//   200 { ok: false, reason: 'invalid_key' | 'unreachable' | 'http_error', status? }

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'

const CORS_BASE: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-supabase-api-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
function preflight(req: Request) {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_BASE })
  return null
}
function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_BASE, 'Content-Type': 'application/json' },
  })
}

const SHIPDAY_API = 'https://api.shipday.com'

serve(async (req) => {
  const pre = preflight(req)
  if (pre) return pre
  if (req.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405)

  let body: { api_key?: string } = {}
  try { body = await req.json() } catch (_) {}
  const apiKey = (body.api_key || '').trim()
  if (!apiKey) return jsonResponse({ ok: false, reason: 'missing_api_key' }, 400)

  let res: Response
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 10_000)
    res = await fetch(`${SHIPDAY_API}/carriers`, {
      method: 'GET',
      headers: {
        'Authorization': `Basic ${apiKey}`,
        'Content-Type': 'application/json',
      },
      signal: ctrl.signal,
    })
    clearTimeout(t)
  } catch (err) {
    console.warn('[validar-shipday-key] unreachable', err)
    return jsonResponse({ ok: false, reason: 'unreachable' })
  }

  if (res.status === 401 || res.status === 403) {
    return jsonResponse({ ok: false, reason: 'invalid_key', status: res.status })
  }
  if (!res.ok) {
    return jsonResponse({ ok: false, reason: 'http_error', status: res.status })
  }

  let data: any = null
  try { data = await res.json() } catch (_) {}
  const list: any[] = Array.isArray(data) ? data : (Array.isArray(data?.carriers) ? data.carriers : [])
  const activos = list.filter((c) => c?.isActive !== false)
  const nombres = activos.slice(0, 10).map((c) => c?.name || c?.fullName || c?.email || 'rider')

  return jsonResponse({
    ok: true,
    carriers_count: activos.length,
    carriers: nombres,
  })
})
