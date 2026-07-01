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

const BUCKET = "socios-media";

// Subida de logo/banner del socio. Storage no valida el JWT ES256, por eso
// validamos la sesion via Auth y subimos con service_role (mismo patron que
// subir-imagen-producto). Cada socio solo puede escribir bajo su carpeta {user_id}/.
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json(405, { error: "Metodo no permitido" });

  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const token = (req.headers.get("Authorization") || "").replace("Bearer ", "").trim();
    if (!token) return json(401, { error: "Falta sesion" });
    const { data: { user }, error: uErr } = await admin.auth.getUser(token);
    if (uErr || !user) return json(401, { error: "Sesion no valida" });

    const form = await req.formData();
    const path = String(form.get("path") || "");
    const file = form.get("file");
    if (!path || !(file instanceof File)) return json(400, { error: "Faltan datos (path/file)" });
    if (!file.type.startsWith("image/")) return json(400, { error: "Solo se permiten imagenes" });
    if (file.size > 5 * 1024 * 1024) return json(400, { error: "La imagen no puede superar los 5 MB" });

    // Ownership: el path debe ir bajo la carpeta del propio usuario y debe existir
    // un socio para ese usuario.
    if (path.split("/")[0] !== user.id) return json(403, { error: "Ruta no permitida" });
    const { data: socio, error: sErr } = await admin
      .from("socios")
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();
    if (sErr) return json(500, { error: sErr.message });
    if (!socio) return json(403, { error: "No eres socio" });

    const bytes = new Uint8Array(await file.arrayBuffer());
    const { error: upErr } = await admin.storage
      .from(BUCKET)
      .upload(path, bytes, { contentType: file.type, upsert: true });
    if (upErr) return json(400, { error: upErr.message });

    const { data: { publicUrl } } = admin.storage.from(BUCKET).getPublicUrl(path);
    return json(200, { publicUrl });
  } catch (e) {
    return json(500, { error: String((e as Error)?.message ?? e) });
  }
});
