// _shared/cors.ts — versión UNIFICADA del repo.
//
// En producción cada edge function se despliega con su propia copia de `_shared`,
// y con el tiempo convivieron DOS APIs de CORS distintas. El repo usa una sola
// carpeta `_shared/` compartida, así que este fichero es el SUPERCONJUNTO de ambas
// para que todos los `import` resuelvan:
//
//   1) API simple (origen '*'): `corsHeaders`, `preflight`, `jsonResponse`
//      La usan p.ej. los rider-* (rider-pickup/reject/deliver/fail-delivery),
//      reassign-pedido-v2, etc.
//   2) API con whitelist de origen: `getCorsHeaders`, `handleCorsPreflightRequest`
//      La usan p.ej. generar_codigo_pedido, calcular_envio, update_socio_admin,
//      import-menu-from-url.

// ─────────────────────────────────────────────────────────────
// 1) API simple (Access-Control-Allow-Origin: *)
// ─────────────────────────────────────────────────────────────
export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-supabase-api-version',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
}

export function preflight(req: Request): Response | null {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  return null
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

// ─────────────────────────────────────────────────────────────
// 2) API con whitelist de origen (refleja el Origin permitido)
// ─────────────────────────────────────────────────────────────
const ALLOWED_ORIGINS: string[] = [
  'https://pidoo.es',
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:5175',
  'http://localhost:5176',
  'http://localhost:5177',
  'https://localhost',
  'capacitor://localhost',
  'http://localhost',
]

// Cualquier subdominio de pidoo.es (admin.pidoo.es, partner.pidoo.es, socio.pidoo.es…)
const SUBDOMAIN_REGEX = /^https:\/\/([a-z0-9-]+\.)?pidoo\.es$/

function isOriginAllowed(origin: string | null): boolean {
  if (!origin) return true // Apps nativas (Capacitor) pueden no enviar Origin
  if (ALLOWED_ORIGINS.includes(origin)) return true
  if (SUBDOMAIN_REGEX.test(origin)) return true
  return false
}

export function getCorsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin')
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, idempotency-key, x-shipday-signature',
  }

  if (isOriginAllowed(origin)) {
    headers['Access-Control-Allow-Origin'] = origin || '*'
    headers['Vary'] = 'Origin'
  }

  return headers
}

export function handleCorsPreflightRequest(req: Request): Response {
  return new Response('ok', { status: 200, headers: getCorsHeaders(req) })
}
