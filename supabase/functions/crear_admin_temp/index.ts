import "jsr:@supabase/functions-js/edge-runtime.d.ts";
// DISABLED FOR SECURITY 2026-04-24: esta function creaba un superadmin con password hardcoded
// y estaba expuesta públicamente (verify_jwt=false). Cualquier visitante podía crearse admin.
// Reemplazada por un 410 Gone. No volver a activar.
Deno.serve(() => new Response(JSON.stringify({ error: 'gone', reason: 'disabled_for_security' }), { status: 410, headers: { 'Content-Type': 'application/json' } }));
