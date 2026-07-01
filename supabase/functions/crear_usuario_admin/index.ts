import "jsr:@supabase/functions-js/edge-runtime.d.ts";
// DISABLED FOR SECURITY 2026-04-24: creó cualquier auth user con email+password sin auth.
// Reemplazada por 410 Gone. Usar auth.admin desde server trusted si se necesita.
Deno.serve(() => new Response(JSON.stringify({ error: 'gone', reason: 'disabled_for_security' }), { status: 410, headers: { 'Content-Type': 'application/json' } }));
