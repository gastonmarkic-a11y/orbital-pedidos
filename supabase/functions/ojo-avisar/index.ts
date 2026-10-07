// ojo-avisar — publica un mensaje de Ojo en el grupo interno (o en otro chat) desde fuera de Telegram (Suite, Claude).
//   POST (x-cron-key) {"texto": "..."}                 -> al grupo interno de Ojo
//   POST (x-cron-key) {"texto": "...", "chat": 123}    -> a ese chat
//   + {"documento_b64": "...", "nombre": "x.pdf"}      -> manda el archivo con el texto de pie
//   + {"foto_url": "https://..."}                      -> manda la foto con el texto de pie
// Queda registrado en ojo_mensajes_log como mensaje del bot.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const H = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };
const TG = `https://api.telegram.org/bot${Deno.env.get("TELEGRAM_BOT_TOKEN")!}`;
const GRUPO = -5504692394;

async function cfg(clave: string): Promise<string> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/app_config?clave=eq.${clave}&select=valor`, { headers: H });
  const f = res.ok ? ((await res.json()) as { valor: string }[]) : [];
  return f[0]?.valor ?? "";
}
const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("ok");
  if (!req.headers.get("x-cron-key") || req.headers.get("x-cron-key") !== (await cfg("cron_key"))) return new Response("no", { status: 401 });
  const b = await req.json().catch(() => null);
  const texto = String(b?.texto ?? "").trim();
  if (!texto) return Response.json({ ok: false, error: "falta texto" });
  const chat = Number(b?.chat) || GRUPO;
  let res: Response;
  if (b?.foto_url) {
    // Con foto (URL pública): se ve como imagen, el texto va de pie (máx. 1024).
    res = await fetch(`${TG}/sendPhoto`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chat, photo: String(b.foto_url), caption: esc(texto).slice(0, 1024), parse_mode: "HTML" }),
    });
  } else if (b?.documento_b64) {
    // Con archivo: el texto va de pie (máx. 1024).
    const fd = new FormData();
    fd.append("chat_id", String(chat));
    fd.append("caption", esc(texto).slice(0, 1024));
    fd.append("parse_mode", "HTML");
    const bytes = Uint8Array.from(atob(String(b.documento_b64)), (c) => c.charCodeAt(0));
    fd.append("document", new Blob([bytes]), String(b?.nombre ?? "archivo.pdf"));
    res = await fetch(`${TG}/sendDocument`, { method: "POST", body: fd });
  } else {
    res = await fetch(`${TG}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chat, text: esc(texto).slice(0, 4000), parse_mode: "HTML", disable_web_page_preview: true }),
    });
  }
  const d = await res.json().catch(() => ({}));
  if (!d?.ok) return Response.json({ ok: false, error: d?.description ?? res.status });
  await fetch(`${SUPABASE_URL}/rest/v1/ojo_mensajes_log`, {
    method: "POST",
    headers: { ...H, "Content-Type": "application/json" },
    body: JSON.stringify({ telegram_chat_id: chat, telegram_message_id: d.result.message_id, autor_nombre: "Ojo", texto: texto.slice(0, 4000), es_del_bot: true }),
  });
  return Response.json({ ok: true, message_id: d.result.message_id });
});
