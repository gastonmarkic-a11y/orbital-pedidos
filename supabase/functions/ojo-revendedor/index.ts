import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// ojo-revendedor — el grupo de Telegram de un revendedor (Omar y Pancho, 2026-10-08, Gastón).
// Los clientes son compartidos con los vendedores (cliente_revendedor): quien vende se lo queda.
// Para no pisarse, Ojo les dice con quién les conviene hablar hoy (nadie del equipo habló en 30 días)
// y les avisa con quién NO, porque lo está trabajando un vendedor.
//   ?tarea=dia[&rev=X][&forzar=1]   (cron 9 h, L-V) las ópticas del día, una por mensaje con botones.
//   ?tarea=registrar&rev=X&chat=ID  conecta un grupo a mano.
//   POST {update}                   ojo-conteo (la puerta del webhook) le pasa todo lo del grupo:
//     • Ojo agregado a un grupo «… Revendedor …» → lo conecta y da la bienvenida.
//     • /revendedor <codigo> (solo admins) → conecta el grupo donde se escribe.
//     • botones rv:<id>:<resultado> → queda en actividad_diaria (lo ven todos) y, si hay reunión o
//       pedido, se avisa en Ventas para que el vendedor de esa óptica sepa.
//     • cualquier otro mensaje → se lleva al grupo de Ventas (ojo_puente) y la respuesta vuelve acá.
// Nada de este grupo llega a ojo-telegram: el revendedor no ve datos internos ni precios.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TG = `https://api.telegram.org/bot${Deno.env.get("TELEGRAM_BOT_TOKEN")!}`;
const sb = createClient(SUPABASE_URL, SERVICE_KEY);
const H = 3600e3;

const RESULTADOS: Record<string, { label: string; act: string }> = {
  hablo: { label: "📞 Hablamos", act: "contacto" },
  reunion: { label: "📅 Reunión", act: "Reunion programada" },
  pedido: { label: "🛒 Va a comprar", act: "cmp" },
  no_interesa: { label: "✖️ No le interesa", act: "no_interesa" },
  no_atiende: { label: "🔕 No atiende", act: "nh" },
};

const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
const horaAR = (d = new Date()) => new Date(d.getTime() - 3 * H);
const hoyAR = () => horaAR().toISOString().slice(0, 10);
const ddmm = (iso: string) => { const a = horaAR(new Date(iso)).toISOString(); return `${a.slice(8, 10)}/${a.slice(5, 7)}`; };
const hhmm = () => horaAR().toISOString().slice(11, 16);

async function cfg(clave: string): Promise<string | null> {
  const { data } = await sb.from("app_config").select("valor").eq("clave", clave).maybeSingle();
  return data?.valor ?? null;
}
async function tg(metodo: string, body: Record<string, unknown>) {
  const r = await fetch(`${TG}/${metodo}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (!d?.ok) console.error(metodo, JSON.stringify(d).slice(0, 300));
  return d;
}
async function enviar(chatId: number, text: string, extra: Record<string, unknown> = {}) {
  const d = await tg("sendMessage", { chat_id: chatId, text: text.slice(0, 4096), parse_mode: "HTML", disable_web_page_preview: true, ...extra });
  if (d?.ok) await sb.from("ojo_mensajes_log").insert({ telegram_chat_id: chatId, telegram_message_id: d.result.message_id, autor_nombre: "Ojo", texto: text.slice(0, 4000), es_del_bot: true });
  return d;
}
async function admins(): Promise<number[]> {
  const { data } = await sb.from("ojo_admins").select("telegram_user_id");
  return (data ?? []).map((a) => Number(a.telegram_user_id));
}
const NOMBRE: Record<string, string> = {
  Adrian: "Adrián", Bruno: "Bruno", Lola: "Lola", Mauro: "Mauro", Gaston: "Gastón", Gustavo: "Gustavo", Ulises: "Ulises", Damian: "Damián",
};
async function idsEquipo(): Promise<Record<string, number[]>> {
  try { return JSON.parse(await cfg("tarjetas_tg") ?? "{}"); } catch { return {}; }
}
async function esDelEquipo(id: number): Promise<boolean> {
  if ((await admins()).includes(id)) return true;
  return Object.values(await idsEquipo()).some((ids) => ids.map(Number).includes(id));
}
// Nombre con mención de Telegram, para que al vendedor le llegue la notificación.
async function mencion(cod: string): Promise<string> {
  const id = (await idsEquipo())[cod]?.[0];
  const n = NOMBRE[cod] ?? cod;
  return id ? `<a href="tg://user?id=${id}">${esc(n)}</a>` : `<b>${esc(n)}</b>`;
}
async function chatTema(tema: string): Promise<number | null> {
  const { data } = await sb.rpc("ojo_chat_tema", { p_tema: tema });
  return Number(data) || null;
}

type Grupo = { revendedor: string; chat_id: number; nombre: string | null };
async function grupoDeChat(chat: number): Promise<Grupo | null> {
  const { data } = await sb.from("revendedor_grupo").select("*").eq("chat_id", chat).maybeSingle();
  return data as Grupo | null;
}
// "Omar y Pancho": el nombre del cliente del revendedor (Omar Cejas → Omar).
async function nombreRev(rev: string): Promise<string> {
  const { data: v } = await sb.from("vendedores").select("nombre, cod_cliente").eq("codigo", rev).maybeSingle();
  if (v?.cod_cliente) {
    const { data: c } = await sb.from("clientes").select("razon").eq("cod", v.cod_cliente).maybeSingle();
    if (c?.razon) return String(c.razon).split(/\s+/)[0];
  }
  return String(v?.nombre ?? rev).replace(/\s*\(.*\)\s*/g, "");
}

// ---------- el día ----------
type Charla = { cod_cliente: string; razon: string | null; localidad: string | null; vendedor: string | null; ultima: string };
async function charlaReciente(rev: string, dias: number): Promise<Charla[]> {
  const { data } = await sb.from("v_cliente_revendedor_charla").select("cod_cliente, razon, localidad, vendedor, ultima")
    .eq("revendedor", rev).gte("ultima", new Date(Date.now() - dias * 24 * H).toISOString()).order("ultima", { ascending: false });
  const vistos = new Set<string>();
  return ((data ?? []) as Charla[]).filter((c) => !vistos.has(c.cod_cliente) && vistos.add(c.cod_cliente));
}

function botones(id: number) {
  const b = (r: string) => ({ text: RESULTADOS[r].label, callback_data: `rv:${id}:${r}` });
  return { inline_keyboard: [[b("hablo"), b("reunion"), b("pedido")], [b("no_interesa"), b("no_atiende")]] };
}

async function tarjeta(s: any): Promise<string> {
  const { data: c } = await sb.from("clientes").select("razon, nomcomerc, localidad, telefono, whatsapp, vendedor_asignado").eq("cod", s.cod_cliente).maybeSingle();
  const tel = c?.whatsapp || c?.telefono || "";
  const { data: wa } = await sb.rpc("ojo_wa_numero", { p_tel: tel });
  const nombre = c?.nomcomerc || c?.razon || s.cod_cliente;
  const saludo = `Hola! Te escribo de parte de Orbital Eyewear, anteojos de fabricación nacional.`;
  return `<b>${s.orden}. ${esc(nombre)}</b>${c?.localidad ? ` — ${esc(c.localidad)}` : ""}\n` +
    `${esc(s.motivo)}\n` +
    (tel ? `📱 ${esc(tel)}` : "") +
    (wa ? ` · <a href="https://wa.me/${wa}?text=${encodeURIComponent(saludo)}">WhatsApp</a>` : "") +
    (s.resultado ? `\n\n✅ <b>${esc(RESULTADOS[s.resultado]?.label ?? s.resultado)}</b>${s.resultado_por ? ` — ${esc(s.resultado_por)}` : ""}` : "\n\nCuando hablen, toquen cómo les fue 👇");
}

async function mandarDia(g: Grupo, forzar = false) {
  const { data: sug } = await sb.rpc("revendedor_armar_dia", { p_rev: g.revendedor, p_n: 6 });
  const lista = (sug ?? []) as any[];
  if (!forzar && lista.length && lista.every((s) => s.message_id)) return { ya_enviado: true };
  const quien = await nombreRev(g.revendedor);
  const charla = await charlaReciente(g.revendedor, 14);

  let cab = `☀️ <b>Buen día ${esc(quien)}${quien === "Omar" ? " y Pancho" : ""}</b>\n`;
  cab += lista.length
    ? `Hoy les conviene hablar con estas <b>${lista.length}</b> ópticas. Ningún vendedor de Orbital habló con ellas en el último mes, así que están libres.`
    : `Hoy no hay ópticas nuevas para sugerir. Sigan con las que tienen en marcha.`;
  if (charla.length) {
    cab += `\n\n🚫 <b>Por ahora no las contacten</b> (las está trabajando un vendedor):\n` +
      charla.slice(0, 8).map((c) => `• ${esc(c.razon ?? c.cod_cliente)}${c.localidad ? ` (${esc(c.localidad)})` : ""} — ${esc(c.vendedor)}, ${ddmm(c.ultima)}`).join("\n") +
      (charla.length > 8 ? `\n… y ${charla.length - 8} más. La lista completa está en la Suite, en «Mis ópticas».` : "");
  }
  await enviar(g.chat_id, cab);
  for (const s of lista) {
    const d = await enviar(g.chat_id, await tarjeta(s), { reply_markup: botones(s.id) });
    if (d?.ok) await sb.from("revendedor_sugerencia").update({ message_id: d.result.message_id }).eq("id", s.id);
  }
  return { ok: true, enviadas: lista.length, no_tocar: charla.length };
}

async function tareaDia(rev: string | null, forzar: boolean) {
  const a = horaAR();
  if (!forzar && [0, 6].includes(a.getUTCDay())) return { fin_de_semana: true };
  let q = sb.from("revendedor_grupo").select("*");
  if (rev) q = q.eq("revendedor", rev);
  const { data } = await q;
  const out: Record<string, unknown> = {};
  for (const g of (data ?? []) as Grupo[]) out[g.revendedor] = await mandarDia(g, forzar);
  return out;
}

// ---------- alta del grupo ----------
async function registrar(rev: string, chat: number, titulo: string | null, quien: string) {
  const { data: v } = await sb.from("vendedores").select("codigo, rol").eq("codigo", rev).maybeSingle();
  if (v?.rol !== "revendedor") return { error: `${rev} no es un revendedor` };
  await sb.from("revendedor_grupo").delete().eq("chat_id", chat).neq("revendedor", rev);
  await sb.from("revendedor_grupo").upsert({ revendedor: rev, chat_id: chat, nombre: titulo }, { onConflict: "revendedor" });
  const nombre = await nombreRev(rev);
  const { count } = await sb.from("cliente_revendedor").select("cod_cliente", { count: "exact", head: true }).eq("revendedor", rev).eq("activo", true);
  await enviar(chat,
    `👋 ¡Hola! Soy <b>Ojo</b>, el asistente de Orbital. Desde hoy este es el grupo de trabajo con ${esc(nombre)}${nombre === "Omar" ? " y Pancho" : ""}.\n\n` +
    `<b>Qué van a recibir acá</b>\n` +
    `• De lunes a viernes a las 9, las ópticas con las que les conviene hablar ese día. Tienen ${count ?? 0} ópticas de su zona compartidas con nosotros.\n` +
    `• Cuáles no tocar por ahora porque las está trabajando un vendedor, así no nos pisamos.\n` +
    `• Las campañas de marketing y las promociones apenas salen.\n\n` +
    `<b>Cómo se trabaja</b>\n` +
    `• Hablan con la óptica y tocan el botón de cómo les fue. Lo ve todo el equipo.\n` +
    `• La óptica es compartida: quien le vende se la queda.\n` +
    `• ¿Una consulta? Escríbanla acá y se la paso al equipo de Ventas. La respuesta vuelve a este grupo.\n` +
    `• La lista completa está en la Suite, en «Mis ópticas».`);
  for (const ad of await admins()) {
    await tg("sendMessage", { chat_id: ad, parse_mode: "HTML", text: `🔁 Grupo de revendedor conectado: <b>${esc(titulo ?? rev)}</b> → ${esc(rev)} (lo agregó ${esc(quien)}) — chat_id <code>${chat}</code>.` });
  }
  if (![0, 6].includes(horaAR().getUTCDay())) await mandarDia({ revendedor: rev, chat_id: chat, nombre: titulo });
  return { ok: true };
}

// Del título del grupo («Ojo · Revendedor Omar») al revendedor: por su código, su nombre o el de su cliente.
async function revDeTitulo(titulo: string): Promise<string | null> {
  const t = titulo.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const { data } = await sb.from("vendedores").select("codigo, nombre, cod_cliente").eq("rol", "revendedor").eq("activo", true);
  for (const v of data ?? []) {
    const nombres = [v.codigo, String(v.nombre ?? "").replace(/\(.*\)/, "")];
    if (v.cod_cliente) {
      const { data: c } = await sb.from("clientes").select("razon").eq("cod", v.cod_cliente).maybeSingle();
      if (c?.razon) nombres.push(...String(c.razon).split(/\s+/));
    }
    if (nombres.some((n) => { const k = String(n).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim(); return k.length >= 3 && t.includes(k); })) return v.codigo;
  }
  return null;
}

async function altaGrupo(u: any) {
  const cm = u.my_chat_member;
  const chat = cm.chat;
  const titulo = String(chat.title ?? "");
  const rev = await revDeTitulo(titulo);
  const quien = cm.from?.first_name ?? "alguien";
  if (!rev) {
    for (const ad of await admins()) await tg("sendMessage", { chat_id: ad, parse_mode: "HTML", text: `🔁 Me agregaron a «${esc(titulo)}» pero no sé de qué revendedor es. Escribí ahí <code>/revendedor CODIGO</code> (ej. RevCuyoSF).` });
    return;
  }
  if ((await grupoDeChat(Number(chat.id)))?.revendedor === rev) return;
  await registrar(rev, Number(chat.id), titulo, quien);
}

// ---------- botones ----------
async function boton(cq: any) {
  const [, idTxt, res] = String(cq.data).split(":");
  const r = RESULTADOS[res];
  const { data: s } = await sb.from("revendedor_sugerencia").select("*").eq("id", Number(idTxt)).maybeSingle();
  if (!s || !r) { await tg("answerCallbackQuery", { callback_query_id: cq.id, text: "No la encuentro" }); return; }
  const g = await grupoDeChat(Number(cq.message?.chat?.id));
  if (!g || g.revendedor !== s.revendedor) { await tg("answerCallbackQuery", { callback_query_id: cq.id, text: "Esto es del grupo del revendedor 🙂" }); return; }
  const quien = cq.from?.first_name ?? "alguien";
  await sb.from("revendedor_sugerencia").update({ resultado: res, resultado_at: new Date().toISOString(), resultado_por: quien }).eq("id", s.id);

  const { data: c } = await sb.from("clientes").select("razon, nomcomerc, localidad, telefono, whatsapp, vendedor_asignado").eq("cod", s.cod_cliente).maybeSingle();
  const optica = c?.nomcomerc || c?.razon || s.cod_cliente;
  // Queda como actividad del revendedor: así el vendedor ve que la óptica se está trabajando y
  // el primero que la activa se la queda (v_cliente_toma). «No atiende» no la toma: no hubo contacto.
  if (res !== "no_atiende") {
    const { data: antes } = await sb.from("v_cliente_toma").select("dueno").eq("cod_cliente", s.cod_cliente).maybeSingle();
    await sb.from("actividad_diaria").insert({
      fecha: hoyAR(), vendedor: s.revendedor, cod_cliente: s.cod_cliente,
      nombre_comercio: optica, razon: c?.razon, localidad: c?.localidad, telefono: c?.whatsapp || c?.telefono,
      origen: "revendedor", resultado_contacto: r.act, actividad_desarrollo: `${r.label} — ${quien} (revendedor, Telegram)`,
    });
    // La tomó recién: que el vendedor asignado lo sepa para no pisarla.
    const vend = c?.vendedor_asignado;
    if (!antes && vend && vend !== s.revendedor && !["Corporativo", "Marketing"].includes(vend)) {
      const ventas = await chatTema("ventas");
      if (ventas) await enviar(ventas,
        `🔁 <b>${esc(await nombreRev(s.revendedor))}</b> (revendedor) tomó <b>${esc(optica)}</b>${c?.localidad ? ` (${esc(c.localidad)})` : ""}, asignada a ${await mencion(vend)}.\n` +
        `El primero que la activa se la queda: por ahora no la contactes. Se libera si pasan 30 días sin contacto.`);
    }
  }

  s.resultado = res; s.resultado_por = `${quien}, ${hhmm()}`;
  await tg("editMessageText", { chat_id: cq.message.chat.id, message_id: cq.message.message_id, text: await tarjeta(s), parse_mode: "HTML", disable_web_page_preview: true, reply_markup: botones(s.id) });
  await tg("answerCallbackQuery", { callback_query_id: cq.id, text: `Anotado: ${r.label}` });

  // Reunión o compra: que el vendedor de la óptica lo sepa (quien vende se lo queda).
  if (res === "reunion" || res === "pedido") {
    const ventas = await chatTema("ventas");
    const nombre = await nombreRev(s.revendedor);
    if (ventas) await enviar(ventas,
      `🔁 <b>${esc(nombre)}</b> (revendedor) ${res === "reunion" ? "consiguió una <b>reunión</b>" : "dice que <b>va a comprar</b>"} con <b>${esc(optica)}</b>${c?.localidad ? ` (${esc(c.localidad)})` : ""}.\n` +
      `La óptica es de ${esc(c?.vendedor_asignado ?? "nadie")} y está compartida con el revendedor: quien vende se la queda. Si la estás trabajando, avisá acá.`);
    if (res === "pedido") await enviar(g.chat_id, `🛒 ¡Bien! Carguen el pedido de ${esc(optica)} en la Suite y Adrián lo aprueba.`, { reply_to_message_id: cq.message.message_id });
  }
}

// ---------- pisada: alguien tocó una compartida que ya es de otro (trigger en actividad_diaria) ----------
async function pisada(b: { cod: string; quien: string; dueno: string }) {
  const { data: c } = await sb.from("clientes").select("razon, nomcomerc, localidad").eq("cod", b.cod).maybeSingle();
  const { data: t } = await sb.from("v_cliente_toma").select("desde").eq("cod_cliente", b.cod).maybeSingle();
  const optica = `<b>${esc(c?.nomcomerc || c?.razon || b.cod)}</b>${c?.localidad ? ` (${esc(c.localidad)})` : ""}`;
  const desde = t?.desde ? ` desde el ${ddmm(t.desde)}` : "";
  const { data: gq } = await sb.from("revendedor_grupo").select("*").eq("revendedor", b.quien).maybeSingle();
  const { data: gd } = await sb.from("revendedor_grupo").select("*").eq("revendedor", b.dueno).maybeSingle();
  if (gq) {
    // El revendedor tocó una que ya trabaja un vendedor.
    await enviar(Number(gq.chat_id), `⚠️ ${optica} la está trabajando ${esc(NOMBRE[b.dueno] ?? b.dueno)}, de Orbital${desde}. El primero que la activa se la queda: no sigan con esta por ahora.`);
    return { avisado: "revendedor" };
  }
  if (gd) {
    // Un vendedor tocó una que ya tomó el revendedor.
    const ventas = await chatTema("ventas");
    if (ventas) await enviar(ventas, `⚠️ ${await mencion(b.quien)}: ${optica} la está trabajando <b>${esc(await nombreRev(b.dueno))}</b> (revendedor)${desde}. El primero que la activa se la queda: dejala por ahora.`);
    return { avisado: "vendedor" };
  }
  return { avisado: null };
}

// Mensaje libre al grupo de un revendedor (promos, campañas, avisos). Texto en HTML de Telegram.
async function mensaje(rev: string, b: { texto?: string; foto?: string; documento?: string }) {
  const { data: g } = await sb.from("revendedor_grupo").select("chat_id").eq("revendedor", rev).maybeSingle();
  if (!g) return { error: "ese revendedor no tiene grupo" };
  const chat = Number(g.chat_id);
  if (b.foto) return await tg("sendPhoto", { chat_id: chat, photo: b.foto, caption: (b.texto ?? "").slice(0, 1024), parse_mode: "HTML" });
  if (b.documento) return await tg("sendDocument", { chat_id: chat, document: b.documento, caption: (b.texto ?? "").slice(0, 1024), parse_mode: "HTML" });
  if (!b.texto) return { error: "falta texto" };
  return await enviar(chat, b.texto);
}

// ---------- consultas del grupo → Ventas ----------
async function consulta(m: any, g: Grupo) {
  await sb.from("ojo_mensajes_log").insert({ telegram_chat_id: m.chat.id, telegram_message_id: m.message_id, autor_nombre: m.from?.first_name ?? "desconocido", autor_telegram_id: m.from?.id, texto: String(m.text ?? m.caption ?? "").slice(0, 4000) });
  const texto = String(m.text ?? m.caption ?? "").trim();
  if (!texto) { await enviar(m.chat.id, "Mándenmelo por escrito así se lo paso al equipo 🙂", { reply_to_message_id: m.message_id }); return; }
  const ventas = await chatTema("ventas");
  if (!ventas) return;
  const autor = m.from?.first_name ?? "Alguien";
  const nombre = await nombreRev(g.revendedor);
  const d = await enviar(ventas, `❓ <b>${esc(autor)}</b> (revendedor ${esc(nombre)}) pregunta:\n«${esc(texto)}»\n\n<i>Respondé este mensaje y se lo llevo.</i>`);
  if (!d?.ok) { await enviar(m.chat.id, "No pude pasarla, probá de nuevo.", { reply_to_message_id: m.message_id }); return; }
  await sb.from("ojo_puente").insert({ origen_chat: m.chat.id, origen_msg: m.message_id, destino_chat: ventas, destino_msg: d.result.message_id, autor, texto: texto.slice(0, 2000) });
  await tg("setMessageReaction", { chat_id: m.chat.id, message_id: m.message_id, reaction: [{ type: "emoji", emoji: "👀" }] });
}

async function comando(m: any): Promise<boolean> {
  const x = String(m.text ?? "").match(/^\/revendedor(?:@\w+)?\s+(\S+)/i);
  if (!x) return false;
  if (!(await admins()).includes(Number(m.from?.id))) {
    await enviar(m.chat.id, "Sólo Gastón puede conectar el grupo.", { reply_to_message_id: m.message_id });
    return true;
  }
  const r = await registrar(x[1], Number(m.chat.id), m.chat.title ?? null, m.from?.first_name ?? "Gastón");
  if ((r as any).error) await enviar(m.chat.id, esc((r as any).error), { reply_to_message_id: m.message_id });
  return true;
}

// ---------- entrada ----------
Deno.serve(async (req) => {
  const url = new URL(req.url);
  const auth = req.headers.get("authorization") ?? "";
  const cronKey = req.headers.get("x-cron-key");
  const ok = auth === `Bearer ${SERVICE_KEY}` || (cronKey && cronKey === await cfg("cron_key"));
  if (!ok) return new Response("unauthorized", { status: 401 });
  try {
    const tarea = url.searchParams.get("tarea");
    if (tarea === "dia") return json(await tareaDia(url.searchParams.get("rev"), url.searchParams.get("forzar") === "1"));
    if (tarea === "pisada") return json(await pisada(await req.json()));
    if (tarea === "mensaje") return json(await mensaje(url.searchParams.get("rev") ?? "", await req.json()));
    // Un link de invitación por persona (de un solo uso). Ojo tiene que ser admin del grupo.
    if (tarea === "link") {
      const { data: g } = await sb.from("revendedor_grupo").select("chat_id").eq("revendedor", url.searchParams.get("rev") ?? "").maybeSingle();
      if (!g) return json({ error: "ese revendedor no tiene grupo" }, 400);
      const nombre = (url.searchParams.get("nombre") ?? "invitado").slice(0, 32);
      const d = await tg("createChatInviteLink", { chat_id: g.chat_id, name: nombre, member_limit: 1 });
      return json(d?.ok ? { link: d.result.invite_link } : { error: d?.description ?? "no pude crear el link" });
    }
    if (tarea === "registrar") {
      const rev = url.searchParams.get("rev"), chat = Number(url.searchParams.get("chat"));
      if (!rev || !chat) return json({ error: "falta rev o chat" }, 400);
      return json(await registrar(rev, chat, null, "Gastón"));
    }
    const body = await req.json().catch(() => ({}));
    const u = body.update ?? {};
    if (u.my_chat_member) await altaGrupo(u);
    else if (u.callback_query && String(u.callback_query.data ?? "").startsWith("rv:")) await boton(u.callback_query);
    else if (u.message?.migrate_to_chat_id) {
      // Pasó a supergrupo: cambia el id del chat.
      await sb.from("revendedor_grupo").update({ chat_id: u.message.migrate_to_chat_id }).eq("chat_id", u.message.chat.id);
    } else if (u.message) {
      if (!(await comando(u.message))) {
        const g = await grupoDeChat(Number(u.message.chat?.id));
        // Lo que escribe el equipo (Gastón, Adrián…) en el grupo es para el revendedor: no se reenvía.
        if (g && !u.message.from?.is_bot && !u.message.new_chat_members && !u.message.left_chat_member && !(await esDelEquipo(Number(u.message.from?.id)))) await consulta(u.message, g);
      }
    }
    return json({ manejado: true });
  } catch (e) {
    console.error(e);
    return json({ error: String((e as Error).message ?? e), manejado: true }, 500);
  }
});
