import "jsr:@supabase/functions-js/edge-runtime.d.ts";
// DISABLED FOR SECURITY 2026-04-24: reseteaba password de cualquier email con un token
// hardcoded público. Cualquiera con el token (filtrado en código) podía tomar el control de cuentas.
// Reemplazada por 410 Gone. Reset de passwords debe usar flujo oficial de Supabase Auth.
Deno.serve(() => new Response(JSON.stringify({ error: 'gone', reason: 'disabled_for_security' }), { status: 410, headers: { 'Content-Type': 'application/json' } }));
