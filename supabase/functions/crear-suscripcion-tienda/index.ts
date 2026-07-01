import "jsr:@supabase/functions-js/edge-runtime.d.ts";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
// RETIRADA: suscripcion tienda publica 39 EUR/mes. plan_pro ahora es flag gratis. Pidoo cobra 10% por pedido.
Deno.serve((req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  return new Response(
    JSON.stringify({ error: "funcion_retirada", message: "Funcion retirada: la suscripcion de tienda (39 EUR/mes) ya no existe. plan_pro es gratis." }),
    { status: 410, headers: { ...cors, "Content-Type": "application/json" } }
  );
});
