import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// admin-usuario-clave — le pone contraseña a un usuario de la Suite desde Accesos.
//
// Es lo único que no se puede hacer desde el navegador: cambiar la clave de OTRA
// persona necesita la service_role, que nunca viaja al front. El flujo es:
//   1. la RPC admin_clave_preparar valida que quien pide sea admin (con SU token)
//      y devuelve el mail del vendedor y su cuenta de Auth si ya la tiene;
//   2. acá se crea la cuenta (con el mail ya confirmado) o se le cambia la clave;
//   3. se vincula user_id en vendedores, así entra sin depender del link por mail.
//
// El mail queda confirmado a mano a propósito: hay usuarios con dominio propio que
// no reciben los mails de Supabase, y ese era justamente el problema a resolver.
// La clave la elige el admin y se la pasa a la persona; ella puede cambiarla después.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "Método no permitido" }, 405);

  const auth = req.headers.get("Authorization") ?? "";
  if (!auth) return json({ ok: false, error: "Sin sesión" }, 401);

  let body: { codigo?: string; password?: string };
  try { body = await req.json(); } catch { return json({ ok: false, error: "Pedido inválido" }, 400); }

  const codigo = String(body?.codigo ?? "").trim();
  const password = String(body?.password ?? "");
  if (!codigo) return json({ ok: false, error: "Falta el usuario" }, 400);
  if (password.length < 8) return json({ ok: false, error: "La contraseña necesita al menos 8 caracteres" }, 400);

  // Con el token del admin: si no es admin, la RPC no devuelve nada.
  const comoAdmin = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false },
  });
  const { data: prep, error: errPrep } = await comoAdmin.rpc("admin_clave_preparar", { p_codigo: codigo });
  if (errPrep) {
    console.error("admin_clave_preparar", JSON.stringify(errPrep));
    return json({ ok: false, error: "No se pudo verificar el permiso" }, 500);
  }
  const p = prep as { ok?: boolean; error?: string; email?: string; uid?: string | null } | null;
  if (!p?.ok) return json({ ok: false, error: p?.error ?? "No autorizado" }, 403);

  const email = p.email!;
  const service = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  let uid = p.uid ?? null;
  let creado = false;

  if (uid) {
    const { error } = await service.auth.admin.updateUserById(uid, { password, email_confirm: true });
    if (error) {
      console.error("updateUserById", error.message);
      return json({ ok: false, error: error.message }, 400);
    }
  } else {
    const { data, error } = await service.auth.admin.createUser({ email, password, email_confirm: true });
    if (error || !data?.user) {
      console.error("createUser", error?.message);
      return json({ ok: false, error: error?.message ?? "No se pudo crear la cuenta" }, 400);
    }
    uid = data.user.id;
    creado = true;
  }

  // Todas las filas con ese mail: hay gente con más de un rol (Logística + Producción).
  const { error: errLink } = await service.from("vendedores").update({ user_id: uid }).ilike("email", email);
  if (errLink) console.error("vincular vendedores", JSON.stringify(errLink));

  return json({ ok: true, creado, email });
});
