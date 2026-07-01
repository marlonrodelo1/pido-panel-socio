import "jsr:@supabase/functions-js/edge-runtime.d.ts";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
// RETIRADA: sincronizacion de carriers Shipday. Shipday eliminado, reparto = dispatcher propio.
Deno.serve((req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  return new Response(
    JSON.stringify({ error: "funcion_retirada", message: "Funcion retirada: Shipday eliminado, el reparto usa el dispatcher propio." }),
    { status: 410, headers: { ...cors, "Content-Type": "application/json" } }
  );
});
