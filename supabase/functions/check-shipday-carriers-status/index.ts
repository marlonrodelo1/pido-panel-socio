// check-shipday-carriers-status — invocada por pg_cron cada 1 min.
//
// Itera todos los socios activos con shipday_api_key configurada,
// consulta GET /carriers en Shipday, cuenta carriers con
// isActive && isOnShift, y actualiza socios.en_servicio.
//
// El trigger BEFORE UPDATE on socios sincroniza marketplace_activo,
// y el AFTER UPDATE propaga a socio_establecimiento + establecimientos.tiene_delivery.
//
// Auth: la invocacion del cron va via pg_net con la SERVICE_ROLE_KEY.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SHIPDAY_API = 'https://api.shipday.com'

function adminClient() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  )
}

async function checkOneSocio(apiKey: string): Promise<{ ok: boolean; online: boolean; carriers_count: number; reason?: string }> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 8_000)
  try {
    const res = await fetch(`${SHIPDAY_API}/carriers`, {
      method: 'GET',
      headers: {
        'Authorization': `Basic ${apiKey}`,
        'Content-Type': 'application/json',
      },
      signal: ctrl.signal,
    })
    clearTimeout(t)
    if (res.status === 401 || res.status === 403) {
      return { ok: false, online: false, carriers_count: 0, reason: 'invalid_key' }
    }
    if (!res.ok) {
      return { ok: false, online: false, carriers_count: 0, reason: 'http_' + res.status }
    }
    const data = await res.json().catch(() => null)
    const list: any[] = Array.isArray(data) ? data : (Array.isArray(data?.carriers) ? data.carriers : [])
    // Online = isActive (no eliminado en Shipday) Y isOnShift (turno iniciado).
    const onlineCount = list.filter((c) => c?.isActive !== false && c?.isOnShift === true).length
    return { ok: true, online: onlineCount > 0, carriers_count: onlineCount }
  } catch (err) {
    clearTimeout(t)
    return { ok: false, online: false, carriers_count: 0, reason: 'unreachable' }
  }
}

serve(async (_req) => {
  const sb = adminClient()

  const { data: socios, error } = await sb
    .from('socios')
    .select('id, en_servicio, shipday_api_key')
    .eq('activo', true)
    .not('shipday_api_key', 'is', null)
    .neq('shipday_api_key', '')

  if (error) {
    return new Response(JSON.stringify({ ok: false, error: error.message }), { status: 500 })
  }

  const total = socios?.length || 0
  let online = 0, offline = 0, errors = 0, changed = 0

  for (const s of socios || []) {
    const r = await checkOneSocio(s.shipday_api_key as string)
    if (!r.ok) {
      errors++
      continue
    }
    const newOnline = r.online
    if (s.en_servicio !== newOnline) {
      const { error: upErr } = await sb
        .from('socios')
        .update({ en_servicio: newOnline })
        .eq('id', s.id)
      if (!upErr) changed++
    }
    if (newOnline) online++; else offline++
  }

  return new Response(
    JSON.stringify({ ok: true, total, online, offline, errors, changed, ts: new Date().toISOString() }),
    { headers: { 'Content-Type': 'application/json' } },
  )
})
