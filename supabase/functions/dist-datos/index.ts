import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// dist-datos — ópticas para contactar, por el bot de distribuidores (Cristaldo, 2026-10-08, Gastón).
// Zona en distribuidores.datos_zona; las de la base están en cliente_revendedor con el código datos_rev.
// Primero los leads nuevos de la zona (Meta, redes, IRIS) y después la base. Son compartidas con los
// vendedores: el primero que la activa se la queda. Nunca se le pasa una óptica con la que un vendedor está
// hablando y nunca se le dice quién la trabaja: simplemente no aparece (dist_armar_dia).
//   ?tarea=dia[&dist=1][&forzar=1]  (cron 9 h, L-V) las del día, una por mensaje con botones.
//   ?tarea=boton  POST {callback_query}  dist-telegram le pasa los botones dd|<id>|<resultado>.
// Lo que marca queda en actividad_diaria (base) o en el lead, se ve en el grupo interno del bot
// y, si toma una óptica de un vendedor, Ojo le avisa al vendedor en Ventas para que no la pise.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OJO = `https://api.telegram.org/bot${Deno.env.get("TELEGRAM_BOT_TOKEN")!}`;
const sb = createClient(SUPABASE_URL, SERVICE_KEY);
const H = 3600e3;
const N_DIA = 10;

const RESULTADOS: Record<string, { label: string; act: string }> = {
  hablo: { label: "📞 Hablamos", act: "contacto" },
  reunion: { label: "📅 Reunión", act: "Reunion programada" },
  pedido: { label: "🛒 Va a comprar", act: "cmp" },
  no_interesa: { label: "✖️ No le interesa", act: "no_interesa" },
  no_atiende: { label: "🔕 No atiende", act: "nh" },
};
const NOMBRE: Record<string, string> = { Adrian: "Adrián", Bruno: "Bruno", Lola: "Lola", Mauro: "Mauro" };

const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const json = (b: unknown, status = 200) => Response.json(b, { status });
const horaAR = (d = new Date()) => new Date(d.getTime() - 3 * H);
const hoyAR = () => horaAR().toISOString().slice(0, 10);
const hhmm = () => horaAR().toISOString().slice(11, 16);

async function cfg(clave: string): Promise<string> {
  const { data } = await sb.from("app_config").select("valor").eq("clave", clave).maybeSingle();
  return data?.valor ?? "";
}
let tokDist = "";
async function api(base: string, metodo: string, body: Record<string, unknown>) {
  const r = await fetch(`${base}/${metodo}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (!d?.ok) console.error(metodo, JSON.stringify(d).slice(0, 300));
  return d;
}
async function dist(metodo: string, body: Record<string, unknown>) {
  tokDist ||= Deno.env.get("DIST_TELEGRAM_BOT_TOKEN") || (await cfg("dist_telegram_bot_token"));
  return api(`https://api.telegram.org/bot${tokDist}`, metodo, body);
}
const msg = (chat: number, text: string, extra: Record<string, unknown> = {}) =>
  dist("sendMessage", { chat_id: chat, text: text.slice(0, 4096), parse_mode: "HTML", disable_web_page_preview: true, ...extra });
// Grupo interno del bot de distribuidores: ve todo.
async function espejo(texto: string) {
  const g = Number(await cfg("dist_telegram_grupo"));
  if (g) await msg(g, "👁 " + texto);
}
// Ventas, por Ojo: para que el vendedor sepa que no la tiene que pisar.
async function aVentas(texto: string) {
  const { data } = await sb.rpc("ojo_chat_tema", { p_tema: "ventas" });
  const chat = Number(data);
  if (chat) await api(OJO, "sendMessage", { chat_id: chat, text: texto, parse_mode: "HTML", disable_web_page_preview: true });
}
async function mencion(cod: string): Promise<string> {
  let ids: Record<string, number[]> = {};
  try { ids = JSON.parse(await cfg("tarjetas_tg") || "{}"); } catch { /* sin ids */ }
  const id = ids[cod]?.[0];
  const n = NOMBRE[cod] ?? cod;
  return id ? `<a href="tg://user?id=${id}">${esc(n)}</a>` : `<b>${esc(n)}</b>`;
}

type Dist = { id: number; nombre: string; marca: string | null; datos_rev: string };
type Sug = { id: number; distribuidor_id: number; fuente: "lead" | "base"; cod_cliente: string | null; prospeccion_id: number | null; orden: number; motivo: string; resultado: string | null; resultado_por: string | null };
type Ficha = { nombre: string; lugar: string; tel: string; vend: string | null; razon: string | null; localidad: string | null };

async function ficha(s: Sug): Promise<Ficha> {
  if (s.fuente === "lead" && s.prospeccion_id) {
    const { data: p } = await sb.from("prospeccion_social").select("nombre, zona, telefono, asignado_a, cod_cliente").eq("id", s.prospeccion_id).maybeSingle();
    return { nombre: p?.nombre ?? "Óptica", lugar: String(p?.zona ?? "").replace(/,\s*$/, ""), tel: p?.telefono ?? "", vend: p?.asignado_a ?? null, razon: null, localidad: null };
  }
  const { data: c } = await sb.from("clientes").select("razon, nomcomerc, localidad, provincia, telefono, whatsapp, vendedor_asignado").eq("cod", s.cod_cliente).maybeSingle();
  return {
    nombre: c?.nomcomerc || c?.razon || String(s.cod_cliente), lugar: [c?.localidad, c?.provincia].filter(Boolean).join(", "),
    tel: c?.whatsapp || c?.telefono || "", vend: c?.vendedor_asignado ?? null, razon: c?.razon ?? null, localidad: c?.localidad ?? null,
  };
}

async function tarjeta(s: Sug): Promise<string> {
  const f = await ficha(s);
  const { data: wa } = await sb.rpc("ojo_wa_numero", { p_tel: f.tel });
  const saludo = s.fuente === "lead"
    ? "Hola! Te escribo por la consulta que le hiciste a Orbital Eyewear. Soy su distribuidor en tu zona, ¿te cuento cómo trabajamos?"
    : "Hola! Soy distribuidor de Orbital Eyewear, anteojos de fabricación nacional. ¿Te puedo mostrar la colección?";
  return `<b>${s.orden}. ${esc(f.nombre)}</b>${f.lugar ? ` — ${esc(f.lugar)}` : ""}\n` +
    `${esc(s.motivo)}\n` +
    (f.tel ? `📱 ${esc(f.tel)}` : "") +
    (wa ? ` · <a href="https://wa.me/${wa}?text=${encodeURIComponent(saludo)}">WhatsApp</a>` : "") +
    (s.resultado ? `\n\n✅ <b>${esc(RESULTADOS[s.resultado]?.label ?? s.resultado)}</b>${s.resultado_por ? ` — ${esc(s.resultado_por)}` : ""}` : "\n\nCuando hables, tocá cómo te fue 👇");
}

function botones(id: number) {
  const b = (r: string) => ({ text: RESULTADOS[r].label, callback_data: `dd|${id}|${r}` });
  return { inline_keyboard: [[b("hablo"), b("reunion"), b("pedido")], [b("no_interesa"), b("no_atiende")]] };
}

// ---------- el día ----------
async function mandarDia(d: Dist, forzar: boolean) {
  // al titular del distribuidor (sus vendedores no reciben datos)
  const { data: u } = await sb.from("dist_tg_usuario").select("chat_id").eq("distribuidor_id", d.id).eq("rol", "dueno").eq("activo", true).not("chat_id", "is", null).limit(1).maybeSingle();
  if (!u?.chat_id) return { error: "el titular no entró al bot" };
  const { data: sug, error } = await sb.rpc("dist_armar_dia", { p_dist: d.id, p_n: N_DIA });
  if (error) return { error: error.message };
  const lista = (sug ?? []) as (Sug & { message_id: number | null })[];
  if (!forzar && lista.length && lista.every((s) => s.message_id)) return { ya_enviado: true };
  const chat = Number(u.chat_id);
  const leads = lista.filter((s) => s.fuente === "lead").length;
  let cab = `☀️ <b>Buen día!</b>\n`;
  cab += lista.length
    ? `Hoy te paso <b>${lista.length}</b> ópticas de tu zona para contactar` +
      (leads ? `. Las primeras ${leads === 1 ? "es una que nos consultó" : `${leads} son de las que nos consultaron`} hace poco: conviene escribirles hoy.` : ".") +
      `\n\nCuando hables con cada una, tocá cómo te fue: así la dejamos reservada para vos.`
    : `Hoy no hay ópticas nuevas para pasarte. Seguí con las que tenés en marcha.`;
  await msg(chat, cab);
  for (const s of lista) {
    const r = await msg(chat, await tarjeta(s), { reply_markup: botones(s.id) });
    if (r?.ok) await sb.from("dist_sugerencia").update({ chat_id: chat, message_id: r.result.message_id }).eq("id", s.id);
  }
  if (lista.length) await espejo(`🗂 ${d.marca ?? d.nombre}: se le pasaron ${lista.length} ópticas del día (${leads} leads nuevos, ${lista.length - leads} de la base).`);
  return { ok: true, enviadas: lista.length, leads };
}

async function tareaDia(distId: number | null, forzar: boolean) {
  if (!forzar && [0, 6].includes(horaAR().getUTCDay())) return { fin_de_semana: true };
  let q = sb.from("distribuidores").select("id, nombre, marca, datos_rev").eq("activo", true).not("datos_rev", "is", null);
  if (distId) q = q.eq("id", distId);
  const { data } = await q;
  const out: Record<string, unknown> = {};
  for (const d of (data ?? []) as Dist[]) out[d.marca ?? d.nombre] = await mandarDia(d, forzar);
  return out;
}

// ---------- botones ----------
async function boton(cq: any) {
  const [, idTxt, res] = String(cq.data).split("|");
  const r = RESULTADOS[res];
  const { data: s } = await sb.from("dist_sugerencia").select("*").eq("id", Number(idTxt)).maybeSingle();
  if (!s || !r) { await dist("answerCallbackQuery", { callback_query_id: cq.id, text: "No la encuentro" }); return; }
  const { data: u } = await sb.from("dist_tg_usuario").select("nombre, distribuidor_id").eq("telegram_user_id", cq.from?.id).eq("activo", true).maybeSingle();
  const { data: d } = await sb.from("distribuidores").select("id, nombre, marca, datos_rev").eq("id", s.distribuidor_id).maybeSingle();
  if (!d || !u) { await dist("answerCallbackQuery", { callback_query_id: cq.id }); return; }
  const quien = String(u.nombre ?? cq.from?.first_name ?? "").split(" ")[0];
  await sb.from("dist_sugerencia").update({ resultado: res, resultado_at: new Date().toISOString(), resultado_por: quien }).eq("id", s.id);
  const f = await ficha(s as Sug);
  const marca = d.marca ?? d.nombre;
  const lugar = f.lugar ? ` (${esc(f.lugar)})` : "";

  // «No atiende» no la toma: no hubo contacto.
  if (res !== "no_atiende") {
    let avisar = false;
    if (s.cod_cliente) {
      const { data: antes } = await sb.from("v_cliente_toma").select("dueno").eq("cod_cliente", s.cod_cliente).maybeSingle();
      await sb.from("actividad_diaria").insert({
        fecha: hoyAR(), vendedor: d.datos_rev, cod_cliente: s.cod_cliente, nombre_comercio: f.nombre, razon: f.razon, localidad: f.localidad,
        telefono: f.tel, origen: "revendedor", resultado_contacto: r.act, actividad_desarrollo: `${r.label} — ${quien} (distribuidor ${marca}, Telegram)`,
      });
      avisar = !antes;
    }
    if (s.fuente === "lead" && s.prospeccion_id) {
      // El lead pasa al distribuidor: sale de la cola de los vendedores si todavía nadie lo llamó.
      const { data: lc } = await sb.from("lead_check").select("id, estado, vendedor").eq("prospeccion_id", s.prospeccion_id).maybeSingle();
      if (lc && ["cola", "enviado", "no_atiende"].includes(lc.estado)) {
        await sb.from("lead_check").update({ estado: "otra_zona", resultado: "distribuidor" }).eq("id", lc.id);
        avisar = true;
      }
      const { data: p } = await sb.from("prospeccion_social").select("nota").eq("id", s.prospeccion_id).maybeSingle();
      await sb.from("prospeccion_social").update({
        asignado_a: d.nombre,
        nota: `${p?.nota ? p.nota + "\n" : ""}🔁 ${hoyAR().split("-").reverse().join("/")} lo tomó el distribuidor ${marca}: ${r.label}.`,
      }).eq("id", s.prospeccion_id);
    }
    const vend = f.vend;
    if (avisar && vend && vend !== d.datos_rev && vend !== d.nombre && !["Corporativo", "Marketing", "ProspeccionVenta"].includes(vend)) {
      await aVentas(`🔁 <b>${esc(marca)}</b> (distribuidor) tomó <b>${esc(f.nombre)}</b>${lugar}, que era de ${await mencion(vend)}.\n` +
        `El primero que la activa se la queda: por ahora no la contactes. Se libera si pasan 30 días sin contacto.`);
    }
  }
  if (res === "reunion" || res === "pedido") {
    await aVentas(`🔁 <b>${esc(marca)}</b> (distribuidor) ${res === "reunion" ? "consiguió una <b>reunión</b>" : "dice que <b>va a comprar</b>"} con <b>${esc(f.nombre)}</b>${lugar}.`);
  }
  await espejo(`🗂 ${marca} marcó ${f.nombre}${f.lugar ? ` (${f.lugar})` : ""}: ${r.label} — ${quien}`);

  (s as Sug).resultado = res; (s as Sug).resultado_por = `${quien}, ${hhmm()}`;
  await dist("editMessageText", { chat_id: cq.message.chat.id, message_id: cq.message.message_id, text: await tarjeta(s as Sug), parse_mode: "HTML", disable_web_page_preview: true, reply_markup: botones(s.id) });
  await dist("answerCallbackQuery", { callback_query_id: cq.id, text: `Anotado: ${r.label}` });
  if (res === "pedido") await msg(cq.message.chat.id, `🛒 ¡Bien! Cargá el pedido de ${esc(f.nombre)} con «📦 Cargar pedido».`, { reply_to_message_id: cq.message.message_id });
}

// ---------- entrada ----------
Deno.serve(async (req) => {
  const url = new URL(req.url);
  const cronKey = req.headers.get("x-cron-key");
  const ok = req.headers.get("authorization") === `Bearer ${SERVICE_KEY}` || (cronKey && cronKey === (await cfg("cron_key")));
  if (!ok) return new Response("unauthorized", { status: 401 });
  try {
    const tarea = url.searchParams.get("tarea");
    if (tarea === "dia") return json(await tareaDia(Number(url.searchParams.get("dist")) || null, url.searchParams.get("forzar") === "1"));
    if (tarea === "boton") { const b = await req.json(); await boton(b.callback_query); return json({ ok: true }); }
    // Prueba: la tarjeta de una sugerencia, con botones, al chat de un usuario del bot (ej. el admin).
    if (tarea === "prueba") {
      const { data: u } = await sb.from("dist_tg_usuario").select("chat_id").eq("id", Number(url.searchParams.get("uid"))).maybeSingle();
      const { data: s } = await sb.from("dist_sugerencia").select("*").eq("id", Number(url.searchParams.get("id"))).maybeSingle();
      if (!u?.chat_id || !s) return json({ error: "falta uid o id" }, 400);
      const r = await msg(Number(u.chat_id), "🧪 PRUEBA\n" + await tarjeta(s as Sug), { reply_markup: botones(s.id) });
      return json({ ok: r?.ok, chat_id: u.chat_id, message_id: r?.result?.message_id });
    }
    return json({ error: "tarea?" }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});
