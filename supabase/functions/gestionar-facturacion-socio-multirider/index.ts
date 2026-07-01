import "jsr:@supabase/functions-js/edge-runtime.d.ts";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
// RETIRADA: modelo SaaS de suscripcion (39 EUR/mes) eliminado. Pidoo cobra 10% por pedido, sin cuota.
Deno.serve((req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  return new Response(
    JSON.stringify({ error: "funcion_retirada", message: "Funcion retirada: el modelo de suscripcion (39 EUR/mes) ya no existe. Pidoo cobra 10% por pedido, sin cuota." }),
    { status: 410, headers: { ...cors, "Content-Type": "application/json" } }
  );
});
