import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

Deno.serve(async (req: Request) => {
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const BUCKET = "productos";
  const ESTAB_ID = "4bfbfe32-af2c-42dd-b221-8aa6f841a26c";

  const sb = createClient(SUPABASE_URL, SERVICE_KEY);

  // 1. Buscar productos con URL CDN GloriaFood
  const { data: productos, error: errFetch } = await sb
    .from("productos")
    .select("id, nombre, imagen_url")
    .eq("establecimiento_id", ESTAB_ID)
    .like("imagen_url", "%fbgcdn.com%");

  if (errFetch) {
    return new Response(JSON.stringify({ error: errFetch.message }), { status: 500 });
  }

  const results: any[] = [];
  let ok = 0, fail = 0;

  for (const p of productos || []) {
    try {
      // Descargar imagen del CDN
      const resp = await fetch(p.imagen_url, { headers: { "User-Agent": "Mozilla/5.0" } });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const blob = await resp.arrayBuffer();
      const contentType = resp.headers.get("content-type") || "image/jpeg";
      const ext = contentType.includes("png") ? "png" : "jpg";

      // Subir a Storage
      const path = `${ESTAB_ID}/${p.id}.${ext}`;
      const { error: errUp } = await sb.storage.from(BUCKET).upload(path, blob, {
        contentType,
        upsert: true,
      });
      if (errUp) throw errUp;

      // Obtener URL pública
      const { data: urlData } = sb.storage.from(BUCKET).getPublicUrl(path);
      const publicUrl = urlData.publicUrl;

      // Actualizar producto
      const { error: errUpd } = await sb
        .from("productos")
        .update({ imagen_url: publicUrl })
        .eq("id", p.id);
      if (errUpd) throw errUpd;

      results.push({ id: p.id, nombre: p.nombre, status: "ok", url: publicUrl, size_bytes: blob.byteLength });
      ok++;
    } catch (e) {
      results.push({ id: p.id, nombre: p.nombre, status: "fail", error: String(e) });
      fail++;
    }
  }

  return new Response(JSON.stringify({ total: productos?.length || 0, ok, fail, results }, null, 2), {
    headers: { "Content-Type": "application/json" },
  });
});
