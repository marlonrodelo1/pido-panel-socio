import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// migrate-product-images v1
// Migra imagenes de productos alojadas en un CDN externo (por defecto el Cloudinary
// de last.shop) al Storage propio de Pidoo (bucket "productos") y actualiza
// productos.imagen_url a la URL publica de Supabase. Idempotente: las ya migradas a
// supabase no coinciden con el patron y no se reprocesan. Procesa por lotes (limit)
// y devuelve cuantas quedan, para poder reinvocar hasta remaining=0.
// Escalable: lo invoca import-menu-from-url tras importar un restaurante nuevo, y
// puede ejecutarse a mano para todo el catalogo o un establecimiento concreto.

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const BUCKET = "productos";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const body = await req.json().catch(() => ({}));
    const establecimientoId: string | null = body.establecimiento_id || null;
    const pattern: string = body.pattern || "%res.cloudinary.com%";
    const limit = Math.min(Number(body.limit) || 50, 200);

    let q = admin.from("productos")
      .select("id, nombre, establecimiento_id, imagen_url")
      .ilike("imagen_url", pattern)
      .limit(limit);
    if (establecimientoId) q = q.eq("establecimiento_id", establecimientoId);
    const { data: productos, error } = await q;
    if (error) return json(500, { error: error.message });

    let ok = 0, fail = 0;
    const fails: any[] = [];
    for (const p of productos || []) {
      try {
        const resp = await fetch(p.imagen_url, { headers: { "User-Agent": "Mozilla/5.0" } });
        if (!resp.ok) throw new Error(`fetch HTTP ${resp.status}`);
        const buf = await resp.arrayBuffer();
        const ct = resp.headers.get("content-type") || "image/jpeg";
        const ext = ct.includes("png") ? "png" : ct.includes("webp") ? "webp" : ct.includes("gif") ? "gif" : "jpg";
        const path = `${p.establecimiento_id}/${p.id}.${ext}`;
        const { error: upErr } = await admin.storage.from(BUCKET).upload(path, buf, { contentType: ct, upsert: true });
        if (upErr) throw upErr;
        const { data: { publicUrl } } = admin.storage.from(BUCKET).getPublicUrl(path);
        const { error: updErr } = await admin.from("productos").update({ imagen_url: publicUrl }).eq("id", p.id);
        if (updErr) throw updErr;
        ok++;
      } catch (e) {
        fail++;
        fails.push({ id: p.id, nombre: p.nombre, error: String((e as Error)?.message ?? e) });
      }
    }

    let cq = admin.from("productos").select("*", { count: "exact", head: true }).ilike("imagen_url", pattern);
    if (establecimientoId) cq = cq.eq("establecimiento_id", establecimientoId);
    const { count: remaining } = await cq;

    return json(200, { procesados: productos?.length || 0, ok, fail, remaining: remaining ?? null, fails: fails.slice(0, 10) });
  } catch (e) {
    return json(500, { error: String((e as Error)?.message ?? e) });
  }
});
