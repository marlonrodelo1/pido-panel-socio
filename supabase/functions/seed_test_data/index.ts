import "jsr:@supabase/functions-js/edge-runtime.d.ts";
// DISABLED FOR SECURITY 2026-04-24: pobló la DB con establecimientos/usuarios de test
// expuesto sin auth. Cualquiera podía spamear datos. Reemplazada por 410 Gone.
Deno.serve(() => new Response(JSON.stringify({ error: 'gone', reason: 'disabled_for_security' }), { status: 410, headers: { 'Content-Type': 'application/json' } }));
