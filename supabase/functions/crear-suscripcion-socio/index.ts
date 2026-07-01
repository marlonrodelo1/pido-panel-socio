import "jsr:@supabase/functions-js/edge-runtime.d.ts";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
// RETIRADA: suscripcion socio (30/39 EUR/mes). Modelo muerto. Pidoo cobra 10% por pedido, sin cuota.
Deno.serve((req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  return new Response(
    JSON.stringify({ error: "funcion_retirada", message: "Funcion retirada: la suscripcion de socio ya no existe." }),
    { status: 410, headers: { ...cors, "Content-Type": "application/json" } }
  );
});
