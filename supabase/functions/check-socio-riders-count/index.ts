import "jsr:@supabase/functions-js/edge-runtime.d.ts";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
// RETIRADA: contador de riders para facturacion multirider 39 EUR (modelo muerto + dependia de Shipday).
Deno.serve((req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  return new Response(
    JSON.stringify({ error: "funcion_retirada", message: "Funcion retirada: la facturacion multirider 39 EUR ya no existe." }),
    { status: 410, headers: { ...cors, "Content-Type": "application/json" } }
  );
});
