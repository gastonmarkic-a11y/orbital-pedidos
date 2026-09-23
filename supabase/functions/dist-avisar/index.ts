// dist-avisar — manda un mensaje a un usuario del bot de distribuidores y deja la copia en el grupo interno.
// Así lo que se le manda desde fuera de Telegram (Suite, Claude) queda a la vista del equipo.
//   POST (x-cron-key) {"uid": 2, "texto": "..."}  -> al usuario + copia al grupo
//   POST (x-cron-key) {"texto": "..."}            -> solo al grupo
// Usa el mismo bot que dist-telegram (secret DIST_TELEGRAM_BOT_TOKEN o app_config).

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const H = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };

async function cfg(clave: string): Promise<string> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/app_config?clave=eq.${clave}&select=valor`, { headers: H });
  const f = res.ok ? ((await res.json()) as { valor: string }[]) : [];
  return f[0]?.valor ?? "";
}
const token = async () => Deno.env.get("DIST_TELEGRAM_BOT_TOKEN") || (await cfg("dist_telegram_bot_token"));
const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

async function enviar(chat: number, texto: string) {
  const partes: string[] = [];
  let resto = texto;
  while (resto.length > 3900) {
    const corte = resto.lastIndexOf("\n", 3900);
    partes.push(resto.slice(0, corte > 0 ? corte : 3900));
    resto = resto.slice(corte > 0 ? corte + 1 : 3900);
  }
  partes.push(resto);
  let ok = true;
  for (const p of partes) {
    const res = await fetch(`https://api.telegram.org/bot${await token()}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chat, text: p, parse_mode: "HTML", disable_web_page_preview: true }),
    });
    if (!res.ok) { ok = false; console.error("sendMessage", res.status, await res.text()); }
  }
  return ok;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("ok");
  if (!req.headers.get("x-cron-key") || req.headers.get("x-cron-key") !== (await cfg("cron_key"))) return new Response("no", { status: 401 });
  const b = await req.json().catch(() => null);
  const texto = String(b?.texto ?? "").trim();
  if (!texto) return Response.json({ ok: false, error: "falta texto" });
  const grupo = Number(await cfg("dist_telegram_grupo"));

  if (!b?.uid) return Response.json({ ok: await enviar(grupo, esc(texto)) });

  const res = await fetch(`${SUPABASE_URL}/rest/v1/dist_tg_usuario?id=eq.${Number(b.uid)}&activo=eq.true&select=nombre,chat_id,distribuidores(nombre)`, { headers: H });
  const [d] = res.ok ? ((await res.json()) as { nombre: string; chat_id: number | null; distribuidores: { nombre: string } }[]) : [];
  if (!d?.chat_id) return Response.json({ ok: false, error: "el usuario no entró al bot" });
  const alUsuario = await enviar(d.chat_id, `📣 <b>Orbital</b>\n\n${esc(texto)}`);
  const alGrupo = await enviar(grupo, `✅ Enviado a ${esc(d.nombre)} (${esc(d.distribuidores.nombre)}):\n\n${esc(texto)}\n#d${Number(b.uid)}`);
  return Response.json({ ok: alUsuario, grupo: alGrupo });
});
