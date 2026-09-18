// RETIRADA el 2026-09-18. NO volver a deployar así.
//
// Estaba activa con verify_jwt=false y protegida solo por este texto escrito en el
// propio código: cualquiera con la URL y el string podía cambiarle la contraseña a
// cualquier mail del sistema, incluido un admin. La reemplaza la Edge Function
// admin-usuario-clave, que valida contra es_admin() con el token de quien pide.
// Se guarda solo como referencia de lo que hacía.

// Setea la contraseña de un usuario (admin). Protegido por secreto. Crea el usuario si no existe.
import { createClient } from "jsr:@supabase/supabase-js@2";
const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const SECRET = "<secreto retirado — estaba escrito en el codigo>";
function json(o: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });
}
Deno.serve(async (req: Request): Promise<Response> => {
  try {
    const { email, password, secret } = await req.json();
    if (secret !== SECRET) return json({ error: "forbidden" }, 403);
    const mail = String(email || "").trim().toLowerCase();
    if (!mail || !password || String(password).length < 6) return json({ error: "email o password invalido" });
    const { data: list, error: le } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (le) return json({ error: le.message });
    const u = (list?.users ?? []).find((x) => (x.email ?? "").toLowerCase() === mail);
    if (u) {
      const { error } = await supabase.auth.admin.updateUserById(u.id, { password: String(password), email_confirm: true });
      if (error) return json({ error: error.message });
      return json({ ok: true, email: mail, action: "updated" });
    }
    const { error } = await supabase.auth.admin.createUser({ email: mail, password: String(password), email_confirm: true });
    if (error) return json({ error: error.message });
    return json({ ok: true, email: mail, action: "created" });
  } catch (e) {
    return json({ error: String(e) });
  }
});
