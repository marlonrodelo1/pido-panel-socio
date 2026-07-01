// check-shipday-carriers-status — invocada por pg_cron cada 1 min.
//
// Por invocacion ejecuta 2 pasadas con 30s de separacion para que la
// latencia maxima desde que el socio se conecta/desconecta en Shipday
// hasta que la BD lo refleja sea ~30s (en vez de 60s).
//
// Itera todos los socios activos con shipday_api_key configurada,
// consulta GET /carriers en Shipday, cuenta carriers con
// isActive && isOnShift, y actualiza socios.en_servicio.
//
// El trigger BEFORE UPDATE on socios sincroniza marketplace_activo,
// y el AFTER UPDATE propaga a socio_establecimiento + establecimientos.tiene_delivery.

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
    const onlineCount = list.filter((c) => c?.isActive !== false && c?.isOnShift === true).length
    return { ok: true, online: onlineCount > 0, carriers_count: onlineCount }
  } catch (err) {
    clearTimeout(t)
    return { ok: false, online: false, carriers_count: 0, reason: 'unreachable' }
  }
}

async function singlePass(sb: any) {
  const { data: socios, error } = await sb
    .from('socios')
    .select('id, en_servicio, shipday_api_key')
    .eq('activo', true)
    .not('shipday_api_key', 'is', null)
    .neq('shipday_api_key', '')
  if (error) {
    return { ok: false, error: error.message, total: 0, online: 0, offline: 0, errors: 0, changed: 0 }
  }
  const total = socios?.length || 0
  let online = 0, offline = 0, errors = 0, changed = 0
  for (const s of socios || []) {
    const r = await checkOneSocio(s.shipday_api_key as string)
    if (!r.ok) { errors++; continue }
    if (s.en_servicio !== r.online) {
      const { error: upErr } = await sb.from('socios').update({ en_servicio: r.online }).eq('id', s.id)
      if (!upErr) changed++
    }
    if (r.online) online++; else offline++
  }
  return { ok: true, total, online, offline, errors, changed }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

serve(async (_req) => {
  const sb = adminClient()

  // Pasada 1 (al instante).
  const pass1 = await singlePass(sb)
  // Esperar 30s para que la siguiente pasada cubra el medio minuto restante
  // hasta que el cron vuelva a invocarnos.
  await sleep(30_000)
  // Pasada 2 (a los 30s).
  const pass2 = await singlePass(sb)

  return new Response(
    JSON.stringify({
      ok: true,
      pass1, pass2,
      ts: new Date().toISOString(),
    }),
    { headers: { 'Content-Type': 'application/json' } },
  )
})
