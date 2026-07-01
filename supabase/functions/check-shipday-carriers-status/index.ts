// check-shipday-carriers-status — RETIRADA. Integración Shipday desmantelada; la plataforma usa su
// dispatcher propio (pedido_asignaciones + rider-*) desde jun-2026.
Deno.serve(() => new Response(
  JSON.stringify({ error: 'funcion_retirada', mensaje: 'Shipday retirado; la plataforma usa su dispatcher propio.' }),
  { status: 410, headers: { 'Content-Type': 'application/json' } },
))
