// RETIRADA el 2026-09-18. NO volver a deployar así.
//
// Estaba activa con verify_jwt=false y el mismo secreto en el código que
// admin-setpass. Generaba un magic link para cualquier mail: con eso se entraba
// como cualquier usuario, incluido un admin. Hoy los accesos se manejan desde
// Accesos en la Suite (botón Clave → Edge Function admin-usuario-clave).
// Se guarda solo como referencia de lo que hacía.

// Genera un link de acceso (magic link) para un usuario SIN depender del email. Protegido por secreto.
import { createClient } from "jsr:@supabase/supabase-js@2";
const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const SECRET = "<secreto retirado — estaba escrito en el codigo>";
const REDIRECT = "https://orbital-pedidos-zu5qorbital-suite.vercel.app/";
Deno.serve(async (req: Request) => {
  try {
    const { email, secret } = await req.json();
    if (secret !== SECRET) return new Response("forbidden", { status: 403 });
    const mail = String(email || "").trim().toLowerCase();
    if (!mail) return new Response(JSON.stringify({ error: "falta email" }), { headers: { "content-type": "application/json" } });
    let res = await supabase.auth.admin.generateLink({ type: "magiclink", email: mail, options: { redirectTo: REDIRECT } });
    if (res.error && /not found|no user|does not exist|user_not_found/i.test(res.error.message || "")) {
      await supabase.auth.admin.createUser({ email: mail, email_confirm: true });
      res = await supabase.auth.admin.generateLink({ type: "magiclink", email: mail, options: { redirectTo: REDIRECT } });
    }
    if (res.error) return new Response(JSON.stringify({ error: res.error.message }), { headers: { "content-type": "application/json" } });
    return new Response(JSON.stringify({ email: mail, link: res.data?.properties?.action_link ?? null }), { headers: { "content-type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { headers: { "content-type": "application/json" } });
  }
});
