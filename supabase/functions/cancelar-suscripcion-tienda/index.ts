import "jsr:@supabase/functions-js/edge-runtime.d.ts";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
// RETIRADA: cancelar suscripcion tienda. Ya no hay suscripciones (plan_pro gratis).
Deno.serve((req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  return new Response(
    JSON.stringify({ error: "funcion_retirada", message: "Funcion retirada: ya no hay suscripciones de tienda que cancelar." }),
    { status: 410, headers: { ...cors, "Content-Type": "application/json" } }
  );
});
