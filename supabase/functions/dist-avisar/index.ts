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

async function enviar(chat: number, texto: string, botones?: { text: string; callback_data: string }[][]) {
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
      body: JSON.stringify({ chat_id: chat, text: p, parse_mode: "HTML", disable_web_page_preview: true, ...(botones ? { reply_markup: { inline_keyboard: botones } } : {}) }),
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
  // preguntas: un mensaje por ítem con Sí / No (la respuesta la toma dist-telegram, acción "rsp")
  //   string                -> solo avisa la respuesta en el grupo
  //   {texto, sku, cant_produccion, cant_cliente, pedido_id, especial_id, orden_id?, fecha_estimada?}
  //                         -> al tocar Sí se carga solo (dist_pregunta_responder)
  type P = { texto: string; sku?: string; cant_produccion?: number; cant_cliente?: number; pedido_id?: number; especial_id?: number; orden_id?: number; fecha_estimada?: string };
  const crudas = Array.isArray(b.preguntas) ? (b.preguntas as unknown[]) : [];
  const lista_p: P[] = crudas
    .map((p) => (typeof p === "object" && p ? { ...(p as P), texto: String((p as P).texto ?? "").trim() } : { texto: String(p).trim() }))
    .filter((p) => p.texto);
  // lo que el distribuidor acepta con "Sí" es la cantidad que ve en el texto ("— 24 u."):
  // si falta cant_cliente se toma de ahí; si no coincide, no se manda nada (pasó con Optisur #E2: decía 24, cargó 10)
  const choques: string[] = [];
  for (const p of lista_p) {
    const m = p.sku ? [...p.texto.matchAll(/(\d+)\s*u\b/gi)].pop() : undefined;
    if (!m) continue;
    const n = Number(m[1]);
    if (p.cant_cliente == null) p.cant_cliente = n;
    else if (p.cant_cliente > 0 && p.cant_cliente !== n) choques.push(`${p.sku}: texto dice ${n} u., cant_cliente=${p.cant_cliente}`);
  }
  if (choques.length) return Response.json({ ok: false, error: "cantidad del texto ≠ cant_cliente", choques });
  const alUsuario = await enviar(d.chat_id, `📣 <b>Orbital</b>\n\n${esc(texto)}`);
  const preguntas = lista_p.map((p) => p.texto);
  for (const p of lista_p) {
    let data = "";
    if (p.sku) {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/dist_preguntas`, {
        method: "POST",
        headers: { ...H, "Content-Type": "application/json", Prefer: "return=representation" },
        body: JSON.stringify({
          uid: Number(b.uid), texto: p.texto, sku: p.sku, cant_produccion: p.cant_produccion ?? 0, cant_cliente: p.cant_cliente ?? 0,
          pedido_id: p.pedido_id ?? null, especial_id: p.especial_id ?? null, orden_id: p.orden_id ?? null, fecha_estimada: p.fecha_estimada ?? null,
        }),
      });
      const [f] = res.ok ? ((await res.json()) as { id: number }[]) : [];
      if (!res.ok) console.error("dist_preguntas", res.status, await res.text());
      if (f?.id) data = `|${f.id}`;
    }
    await enviar(d.chat_id, esc(p.texto), [[{ text: "✅ Sí", callback_data: `rsp|si${data}` }, { text: "❌ No", callback_data: `rsp|no${data}` }]]);
  }
  const lista = preguntas.length ? `\n\n${preguntas.map((p) => `• ${esc(p)} [Sí / No]`).join("\n")}` : "";
  const alGrupo = await enviar(grupo, `✅ Enviado a ${esc(d.nombre)} (${esc(d.distribuidores.nombre)}):\n\n${esc(texto)}${lista}\n#d${Number(b.uid)}`);
  return Response.json({ ok: alUsuario, grupo: alGrupo, preguntas: preguntas.length });
});
