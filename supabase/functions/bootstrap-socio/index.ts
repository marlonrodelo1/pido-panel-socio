// bootstrap-socio v5 — DESHABILITADO por motivos de seguridad.
// Permitía account takeover (resetear password de cualquier email vía service role).
// Use signup normal vía Supabase Auth + onboarding wizard en pido-panel-socio.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve((req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  return new Response(
    JSON.stringify({
      error: 'Endpoint deshabilitado',
      message: 'Use signup normal vía Supabase Auth + onboarding wizard en pido-panel-socio.',
    }),
    { status: 410, headers: { ...CORS, 'Content-Type': 'application/json' } }
  );
});
