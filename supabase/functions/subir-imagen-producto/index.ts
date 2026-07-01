import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });

const BUCKETS = ["productos", "logos", "banners"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json(405, { error: "Metodo no permitido" });

  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Auth: validamos el token de sesion via Auth (valida ES256). Storage no lo
    // valida, por eso subimos con service_role tras comprobar la sesion + dueno.
    const token = (req.headers.get("Authorization") || "").replace("Bearer ", "").trim();
    if (!token) return json(401, { error: "Falta sesion" });
    const { data: { user }, error: uErr } = await admin.auth.getUser(token);
    if (uErr || !user) return json(401, { error: "Sesion no valida" });

    const form = await req.formData();
    const bucket = String(form.get("bucket") || "productos");
    const path = String(form.get("path") || "");
    const file = form.get("file");
    const estIdField = String(form.get("establecimientoId") || "");
    if (!BUCKETS.includes(bucket)) return json(400, { error: "Bucket no permitido" });
    if (!path || !(file instanceof File)) return json(400, { error: "Faltan datos (path/file)" });
    if (!file.type.startsWith("image/")) return json(400, { error: "Solo se permiten imagenes" });
    if (file.size > 5 * 1024 * 1024) return json(400, { error: "La imagen no puede superar los 5 MB" });

    // Ownership: usa establecimientoId si viene; si no, el primer segmento del path.
    const estId = estIdField || path.split("/")[0];
    const { data: est, error: eErr } = await admin
      .from("establecimientos")
      .select("id")
      .eq("id", estId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (eErr) return json(500, { error: eErr.message });
    if (!est) return json(403, { error: "No puedes subir a este establecimiento" });

    const bytes = new Uint8Array(await file.arrayBuffer());
    const { error: upErr } = await admin.storage
      .from(bucket)
      .upload(path, bytes, { contentType: file.type, upsert: true });
    if (upErr) return json(400, { error: upErr.message });

    const { data: { publicUrl } } = admin.storage.from(bucket).getPublicUrl(path);
    return json(200, { publicUrl });
  } catch (e) {
    return json(500, { error: String((e as Error)?.message ?? e) });
  }
});
