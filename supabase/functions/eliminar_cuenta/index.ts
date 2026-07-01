import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: CORS });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace("Bearer ", "").trim();
    if (!token || token === ANON) return json({ error: "Falta token de autenticación del usuario" }, 401);

    // Validar JWT del usuario usando service role para bypass de JWT settings
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: userData, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !userData?.user) {
      console.error("[eliminar_cuenta] auth error:", userErr?.message);
      return json({ error: "Usuario no autenticado o token inválido" }, 401);
    }
    const userId = userData.user.id;
    console.log(`[eliminar_cuenta] userId=${userId}`);

    const errors: string[] = [];

    // Anonimizar pedidos (no borrar — histórico legal/financiero)
    const { error: pedErr } = await admin
      .from("pedidos")
      .update({ usuario_id: null })
      .eq("usuario_id", userId);
    if (pedErr) { console.error("[pedidos]", pedErr.message); errors.push(`pedidos: ${pedErr.message}`); }

    // Borrar push subscriptions
    const { error: pushErr } = await admin
      .from("push_subscriptions")
      .delete()
      .eq("user_id", userId);
    if (pushErr) { console.error("[push_subscriptions]", pushErr.message); errors.push(`push_subscriptions: ${pushErr.message}`); }

    // Borrar direcciones
    const { error: dirErr } = await admin
      .from("direcciones_usuario")
      .delete()
      .eq("usuario_id", userId);
    if (dirErr) { console.error("[direcciones]", dirErr.message); errors.push(`direcciones: ${dirErr.message}`); }

    // Borrar notificaciones
    const { error: notErr } = await admin
      .from("notificaciones")
      .delete()
      .eq("usuario_id", userId);
    if (notErr) { console.error("[notificaciones]", notErr.message); errors.push(`notificaciones: ${notErr.message}`); }

    // Borrar reseñas
    const { error: resErr } = await admin
      .from("resenas")
      .delete()
      .eq("usuario_id", userId);
    if (resErr) { console.error("[resenas]", resErr.message); errors.push(`resenas: ${resErr.message}`); }

    // Borrar fila usuarios
    const { error: usrErr } = await admin
      .from("usuarios")
      .delete()
      .eq("id", userId);
    if (usrErr) { console.error("[usuarios]", usrErr.message); errors.push(`usuarios: ${usrErr.message}`); }

    // Borrar cuenta de Auth
    const { error: authErr } = await admin.auth.admin.deleteUser(userId);
    if (authErr) {
      console.error("[auth.deleteUser]", authErr.message);
      return json({ error: `No se pudo eliminar la cuenta de Auth: ${authErr.message}`, partial: errors }, 500);
    }

    console.log(`[eliminar_cuenta] OK userId=${userId} warnings=${errors.length}`);
    return json({ ok: true, warnings: errors.length ? errors : undefined });
  } catch (e) {
    console.error("[eliminar_cuenta] fatal:", e);
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
