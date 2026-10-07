import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// ojo-grupos — Ojo dividido por tema (2026-09-30, Gastón).
// Seis grupos (ojo_temas): 🛒 Ventas · 🎯 Prospección · 🛍️ Consumidor final · 🔧 Postventa · 📦 Depósito ·
// 🧾 Administración. Gastón está en todos; Gustavo y Mauro reciben el resumen del día por privado.
// Mientras un grupo no se creó, lo suyo sigue cayendo en el grupo general (ojo_chat_tema).
//   ?tarea=anuncio        (30/09 22 h) Ojo explica el cambio, el porqué, las ventajas y los 6 grupos en el grupo
//                         general, y le escribe a cada creador: los grupos se crean el 01/10 a las 9.
//   ?tarea=recordar&modo=manana  (01/10 8:30) recordatorio a los creadores.
//   ?tarea=recordar&modo=favor   (10 h, L-S) al que todavía no lo creó, se le pide el favor.
//   ?tarea=resumen        (cron 19 h, L-S) resumen del día por privado a Gustavo y Mauro.
//   ?tarea=estado         qué grupos ya están.
//   ?tarea=invitar&tema=x vuelve a mandar los links de ese grupo (también sale solo al hacer admin a Ojo).
//   POST {update}         ojo-conteo (la puerta del webhook) le pasa:
//     • Ojo agregado a un grupo → si es de un tema: bienvenida, qué cambia, resumen de lo que pasó y lo
//       pendiente, y se mudan las tarjetas abiertas del tema.
//     • puente: «Ojo, preguntale a Depósito …» lleva la pregunta al grupo de Depósito; respondiendo ese
//       mensaje, la respuesta vuelve al grupo de origen (y se puede seguir ida y vuelta).
//     • /start por privado de alguien del equipo (Gustavo, Ulises…): queda habilitado para el privado.
// Responde {manejado: bool}: si es false, la puerta sigue a ojo-telegram como siempre.
// Regla Telegram: sin plata.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TG = `https://api.telegram.org/bot${Deno.env.get("TELEGRAM_BOT_TOKEN")!}`;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const GROQ_API_KEY = Deno.env.get("GROQ_API_KEY") ?? "";
const OJO_GROQ_MODEL = Deno.env.get("OJO_GROQ_MODEL") ?? "openai/gpt-oss-120b";
const GENERAL_FALLBACK = -5504692394;
const sb = createClient(SUPABASE_URL, SERVICE_KEY);
const H = 3600e3;

const NOMBRE: Record<string, string> = {
  Adrian: "Adrián", Bruno: "Bruno", Lola: "Lola", Mauro: "Mauro", Postventa: "Postventa", Administracion: "Administración",
  Deposito: "Depósito", Gaston: "Gastón", Gustavo: "Gustavo", Ulises: "Ulises",
};
// Los que reciben el resumen del día por privado.
const RESUMEN_PARA = ["Gustavo", "Mauro"];
// Qué tiene que hacer cada grupo, en una línea.
const HACER: Record<string, string> = {
  ventas: "tocar las tarjetas de visitas, carritos, reuniones y leads, y contestar los 🆘 de ópticas (respondiendo el mensaje le llega al cliente).",
  prospeccion: "avisar acá cada reunión que consiguen, con sus palabras. Yo se la paso al vendedor en Ventas y les traigo la confirmación acá para que se la confirmen a la óptica.",
  consumidor: "contestar a los consumidores lo que IRIS no pudo: qué comprar, recomendaciones, búsquedas. Respondiendo el 🆘 le llega al cliente. Estado de pedido y datos los contesta IRIS sola.",
  postventa: "resolver roturas, garantías, repuestos, cambios, devoluciones y demoras, de ópticas y de consumidores. Respondiendo el 🆘 le llega al cliente.",
  deposito: "mover los pedidos con los botones (preparación, listo, despacho), avisar faltantes y hacer los conteos.",
  administracion: "facturar los pedidos que Depósito deja listos, las cobranzas y los números de cliente.",
};

const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
const horaAR = (d = new Date()) => new Date(d.getTime() - 3 * H);
const hoyAR = () => horaAR().toISOString().slice(0, 10);
const fechaHora = (iso: string) => { const a = horaAR(new Date(iso)).toISOString(); return `${a.slice(8, 10)}/${a.slice(5, 7)} ${a.slice(11, 16)}`; };
const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

type Tema = {
  tema: string; label: string; emoji: string; creador: string; creador_tg: number | null; miembros: string[];
  para_que: string; claves: string[]; orden: number; chat_id: number | null; creado_at: string | null; recordado_at: string | null;
};

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
// Mensajes largos: se parten por línea para no pasar el límite de Telegram.
async function enviarLargo(chatId: number, text: string) {
  const partes: string[] = [];
  let actual = "";
  for (const l of text.split("\n")) {
    if ((actual + "\n" + l).length > 3800) { partes.push(actual); actual = l; } else actual = actual ? `${actual}\n${l}` : l;
  }
  if (actual) partes.push(actual);
  for (const p of partes) await enviar(chatId, p);
}

let _ids: Record<string, number[]> | null = null;
async function ids(): Promise<Record<string, number[]>> {
  if (!_ids) { try { _ids = JSON.parse(await cfg("tarjetas_tg") ?? "{}"); } catch { _ids = {}; } }
  return _ids!;
}
async function mencion(cod: string): Promise<string> {
  const id = (await ids())[cod]?.[0];
  const n = NOMBRE[cod] ?? cod;
  return id ? `<a href="tg://user?id=${id}">${esc(n)}</a>` : `<b>${esc(n)}</b>`;
}
async function admins(): Promise<number[]> {
  const { data } = await sb.from("ojo_admins").select("telegram_user_id");
  return (data ?? []).map((a) => Number(a.telegram_user_id));
}
async function temas(): Promise<Tema[]> {
  const { data } = await sb.from("ojo_temas").select("*").order("orden");
  return (data ?? []) as Tema[];
}
async function grupoGeneral(): Promise<number> {
  const { data } = await sb.from("ojo_grupos").select("telegram_chat_id").eq("recibe_avisos", true).eq("activo", true).limit(1).maybeSingle();
  return Number(data?.telegram_chat_id) || GENERAL_FALLBACK;
}
async function chatTema(tema: string): Promise<number> {
  const { data } = await sb.rpc("ojo_chat_tema", { p_tema: tema });
  return Number(data) || GENERAL_FALLBACK;
}
let _bot: string | null = null;
async function botUser(): Promise<string> {
  if (!_bot) _bot = (await tg("getMe", {}))?.result?.username ?? "";
  return _bot!;
}

// ---------- LLM ----------
async function askLLM(system: string, user: string, max = 1500): Promise<string> {
  if (ANTHROPIC_API_KEY) {
    try {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model: "claude-sonnet-5", max_tokens: max, system, messages: [{ role: "user", content: user }] }),
      });
      const d = await r.json();
      const t = d?.content?.find((c: { type: string }) => c.type === "text")?.text?.trim();
      if (t) return t;
      console.error("anthropic", JSON.stringify(d?.error ?? d).slice(0, 300));
    } catch (e) { console.error("anthropic", String(e)); }
  }
  if (!GROQ_API_KEY) return "";
  try {
    const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${GROQ_API_KEY}` },
      body: JSON.stringify({ model: OJO_GROQ_MODEL, max_tokens: max * 2, temperature: 0, messages: [{ role: "system", content: system }, { role: "user", content: user.slice(-60000) }] }),
    });
    const d = await r.json();
    return (d?.choices?.[0]?.message?.content ?? "").trim();
  } catch (e) { console.error("groq", String(e)); return ""; }
}
function parseJson(raw: string): any {
  const limpio = raw.replace(/```json|```/g, "").replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  try { return JSON.parse(limpio); } catch { /* sigue */ }
  const m = limpio.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch { /* nada */ } }
  return null;
}
async function charla(chats: number[] | null, desde: string, max = 500): Promise<string> {
  let q = sb.from("ojo_mensajes_log").select("telegram_chat_id, autor_nombre, texto, creado_en, es_del_bot")
    .gte("creado_en", desde).order("creado_en", { ascending: false }).limit(max);
  q = chats ? q.in("telegram_chat_id", chats) : q.lt("telegram_chat_id", 0);
  const { data } = await q;
  return (data ?? []).reverse()
    .map((m) => `[${fechaHora(m.creado_en)}] ${m.es_del_bot ? "Ojo" : m.autor_nombre}: ${String(m.texto ?? "").replace(/\s+/g, " ").slice(0, m.es_del_bot ? 220 : 350)}`)
    .join("\n");
}

// ---------- 1. anuncio (la noche anterior) ----------
function pasos(t: Tema, bot: string) {
  return `1. En Telegram: ✏️ → <b>Nuevo grupo</b>.\n` +
    `2. Ponele de nombre <b>«Ojo · ${esc(t.label)}»</b>.\n` +
    `3. Agregá a <b>Ojo</b>${bot ? ` (@${esc(bot)})` : ""}, a <b>Gastón</b> y a ${t.miembros.filter((m) => m !== t.creador).map((m) => esc(NOMBRE[m] ?? m)).join(", ") || "quien corresponda"}.\n` +
    `4. Listo. Apenas entro me presento, explico qué se hace ahí y les paso todo lo pendiente de ${esc(t.label)}.`;
}

async function tareaAnuncio(chatForzado?: number) {
  const ts = await temas();
  const bot = await botUser();
  const general = chatForzado ?? await grupoGeneral();
  const filas: string[] = [];
  for (const t of ts) {
    const miembros = t.miembros.map((m) => esc(NOMBRE[m] ?? m)).join(", ");
    filas.push(`${t.emoji} <b>${esc(t.label)}</b> — ${esc(t.para_que)}.\n     👥 ${miembros} y Gastón · 🛠 lo crea ${await mencion(t.creador)}${t.chat_id ? " ✅ ya está" : ""}`);
  }
  const partes = [
    `📣 <b>Cambio en Ojo: desde mañana, un grupo por tema</b>\n\n` +
    `<b>¿Por qué?</b>\n` +
    `Hoy en este grupo pasa todo junto: 🆘 de clientes, carritos, pedidos, reuniones, leads, stock, facturas… Son decenas de mensajes por día, ` +
    `cada uno tiene que buscar lo suyo entre lo de los demás y así se pierden cosas: un 🆘 que nadie vio, un pedido que quedó sin facturar, una reunión sin confirmar.\n\n` +
    `<b>¿Qué ganamos?</b>\n` +
    `✅ <b>Cada uno ve lo suyo</b>: menos ruido, nada tapado.\n` +
    `✅ <b>Todo llega a quien lo resuelve</b>: las roturas a Postventa, los pedidos a Depósito, lo que hay que facturar a Administración, las reuniones de Prospección al vendedor.\n` +
    `✅ <b>Los grupos están conectados</b>: yo llevo las preguntas de un grupo a otro y traigo la respuesta. Nadie tiene que estar en todos lados.\n` +
    `✅ <b>Nadie arranca de cero</b>: cuando se crea cada grupo, les paso el resumen de lo que pasó y todo lo pendiente de ese tema.\n` +
    `✅ Gastón sigue viendo todos los grupos, y Gustavo y Mauro reciben un resumen del día a las 19.`,

    `🗂 <b>Los 6 grupos</b>\n\n${filas.join("\n\n")}`,

    `📅 <b>Mañana a las 9:00 cada responsable crea su grupo</b>\n` +
    `1. En Telegram: ✏️ → <b>Nuevo grupo</b>.\n` +
    `2. Nombre: <b>«Ojo · »</b> y el tema (ej. «Ojo · Postventa», «Ojo · Ventas»).\n` +
    `3. Agregá a <b>Ojo</b>${bot ? ` (@${esc(bot)})` : ""}, a <b>Gastón</b> y a los de tu grupo (arriba dice quiénes).\n` +
    `4. Listo: me presento, explico qué se hace ahí y paso todo lo pendiente.\n\n` +
    `<b>Cómo se trabaja desde mañana</b>\n` +
    `• Igual que hoy: botones de las tarjetas, respondiendo un 🆘 le llega al cliente, y me pueden preguntar o pedir que cargue cosas.\n` +
    `• ¿Necesitan algo de otra área? En su grupo: <i>«Ojo, preguntale a Depósito si salió el pedido de Óptica X»</i>. Lo llevo y la respuesta vuelve al mismo hilo.\n` +
    `• Mientras un grupo no esté creado, lo suyo sigue llegando acá. No se pierde nada.\n` +
    `• Este grupo queda para lo general de toda la empresa.\n\n` +
    `📲 ${await mencion("Gustavo")} y <b>Ulises</b>: abran el chat privado conmigo${bot ? ` (@${esc(bot)})` : ""} y toquen <b>Iniciar</b>, así quedan cargados.\n\n` +
    `Mañana a las 8:30 les mando un recordatorio. ¡Gracias a todos! 🙌`,
  ];
  for (const p of partes) await enviarLargo(general, p);

  // A cada creador, también por privado (si nunca abrió el chat con Ojo no sale: para eso está el grupo).
  const privados: Record<string, boolean> = {};
  for (const t of ts.filter((x) => !x.chat_id)) {
    const id = t.creador_tg ?? (await ids())[t.creador]?.[0];
    if (!id) { privados[t.creador] = false; continue; }
    const d = await tg("sendMessage", {
      chat_id: id, parse_mode: "HTML", disable_web_page_preview: true,
      text: `👋 Hola ${esc(NOMBRE[t.creador] ?? t.creador)}. Desde mañana Ojo trabaja con un grupo por tema (lo explico en el grupo de siempre) y a vos te toca crear el de ${t.emoji} <b>${esc(t.label)}</b>: ${esc(t.para_que)}.\n\n<b>Mañana a las 9:00:</b>\n${pasos(t, bot)}\n\nMientras no esté, todo sigue llegando al grupo de siempre. ¡Gracias!`,
    });
    privados[t.creador] = !!d?.ok;
  }
  return { ok: true, general, privados };
}

// ---------- 2. recordatorios ----------
// modo "manana" (8:30 del día de la creación): a todos los que les falta.
// modo "favor"  (10:00 y después cada día, L-S): al que todavía no lo creó, se le pide el favor.
async function tareaRecordar(modo: string, forzar = false) {
  const a = horaAR();
  if (!forzar && (a.getUTCDay() === 0 || a.getUTCHours() < 8 || a.getUTCHours() >= 20)) return { fuera_de_horario: true };
  const ts = await temas();
  const faltan = ts.filter((t) => !t.chat_id);
  if (!faltan.length) return { ok: true, faltan: 0 };
  const bot = await botUser();
  const listos = ts.filter((t) => t.chat_id).map((t) => `${t.emoji} ${esc(t.label)}`);
  const lineas: string[] = [];
  for (const t of faltan) {
    lineas.push(`• ${t.emoji} <b>${esc(t.label)}</b> → ${await mencion(t.creador)}`);
    const id = t.creador_tg ?? (await ids())[t.creador]?.[0];
    const txt = modo === "favor"
      ? `🙏 ${esc(NOMBRE[t.creador] ?? t.creador)}, te pido el favor: creá el grupo de ${t.emoji} <b>${esc(t.label)}</b> así podemos empezar a conectar todos los grupos. Son 2 minutos:\n\n${pasos(t, bot)}`
      : `⏰ Buen día ${esc(NOMBRE[t.creador] ?? t.creador)}. Hoy a las 9:00 creamos los grupos: te toca ${t.emoji} <b>${esc(t.label)}</b>.\n\n${pasos(t, bot)}`;
    if (id) await tg("sendMessage", { chat_id: id, parse_mode: "HTML", disable_web_page_preview: true, text: txt });
    await sb.from("ojo_temas").update({ recordado_at: new Date().toISOString() }).eq("tema", t.tema);
  }
  const pie = `\n\nNuevo grupo → nombre «Ojo · <i>tema</i>» → agregan a Ojo${bot ? ` (@${esc(bot)})` : ""}, a Gastón y a su equipo. Yo hago el resto 👌`;
  await enviar(await grupoGeneral(), modo === "favor"
    ? `🙏 <b>Les pido el favor</b> a los que faltan: sin estos grupos no puedo conectar todo entre sí.\n${lineas.join("\n")}` +
      (listos.length ? `\n\nYa están: ${listos.join(" · ")} ✅` : "") + pie
    : `⏰ <b>¡Buen día!</b> Hoy a las <b>9:00</b> creamos los grupos de Ojo:\n${lineas.join("\n")}` + pie);
  return { ok: true, modo, faltan: faltan.map((t) => t.tema) };
}

// ---------- 3. alta de un grupo de tema ----------
function temaPorNombre(ts: Tema[], titulo: string): Tema | null {
  const n = titulo.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  // "postventa" contiene "venta": los temas más específicos primero, Ventas al final.
  const orden = [...ts].sort((a, b) => (a.tema === "ventas" ? 1 : 0) - (b.tema === "ventas" ? 1 : 0));
  for (const t of orden) {
    if (t.claves.some((k) => n.includes(k.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")))) return t;
  }
  return null;
}

async function bienvenida(t: Tema, chat: number) {
  const miembros: string[] = [];
  for (const m of t.miembros) miembros.push(await mencion(m));
  const otros = (await temas()).filter((x) => x.tema !== t.tema).map((x) => `${x.emoji} ${esc(x.label)}`).join(" · ");
  await enviar(chat,
    `👋 ¡Hola! Soy <b>Ojo</b>. Desde hoy cada tema tiene su grupo, así cada uno ve lo suyo y no se pierde nada entre tantos mensajes.\n\n` +
    `${t.emoji} <b>Este es el grupo de ${esc(t.label)}</b>: ${esc(t.para_que)}.\n` +
    `👥 Tienen que estar: ${miembros.join(", ")} y Gastón. Si falta alguien, agréguenlo.\n\n` +
    `<b>Qué cambia:</b>\n` +
    `• Todo lo de ${esc(t.label)} llega acá: tarjetas, 🆘 y avisos. Lo de los otros temas va a su grupo.\n` +
    `• Se trabaja igual que antes. Acá les toca: ${esc(HACER[t.tema] ?? "lo de este tema")}\n` +
    `• ¿Necesitan algo de otra área? Escríbanme acá: <i>«Ojo, preguntale a Administración si ya se facturó el pedido de Óptica X»</i>. Lo llevo a ese grupo y les traigo la respuesta en este mismo hilo.\n` +
    `• Me pueden seguir preguntando todo (stock, clientes, pedidos) y pedirme que cargue cosas, como siempre.\n` +
    `• Gastón ve todos los grupos.\n\n` +
    `Los otros grupos: ${otros}.\n\n` +
    `Ahora les paso lo que pasó y lo que quedó pendiente de ${esc(t.label)}, para que no se pierda nada 👇`);
}

// Números del sistema de cada tema, para el resumen (sin plata).
async function datosTema(tema: string): Promise<string[]> {
  const out: string[] = [];
  try {
    if (tema === "deposito" || tema === "administracion") {
      const { data } = await sb.from("pedidos").select("id, cliente, estado").neq("vendedor", "Tienda").not("estado", "in", "(despachado,anulado)").gte("created_at", new Date(Date.now() - 30 * 24 * H).toISOString());
      const ps = data ?? [];
      if (tema === "deposito") {
        const por: Record<string, number> = {};
        for (const p of ps) por[p.estado] = (por[p.estado] ?? 0) + 1;
        if (ps.length) out.push(`Pedidos sin despachar: ${Object.entries(por).map(([e, n]) => `${n} ${e.replace(/_/g, " ")}`).join(", ")}.`);
      } else {
        const listos = ps.filter((p) => p.estado === "listo");
        if (listos.length) out.push(`Pedidos listos para facturar: ${listos.slice(0, 10).map((p) => `#${p.id} ${p.cliente}`).join(", ")}${listos.length > 10 ? "…" : ""}.`);
      }
    }
    if (tema === "prospeccion" || tema === "ventas") {
      const { data } = await sb.from("ojo_reuniones").select("cliente_nombre, vendedor, fecha, estado, conseguida_por").in("estado", ["propuesta", "sin_vendedor", "reprogramar"]).gte("fecha", hoyAR());
      for (const r of data ?? []) out.push(`Reunión en ${r.cliente_nombre} (${r.fecha.slice(8, 10)}/${r.fecha.slice(5, 7)}) de ${r.conseguida_por}: ${r.estado === "sin_vendedor" ? "falta quién la toma" : r.estado === "reprogramar" ? "hay que reprogramarla" : `esperando que ${r.vendedor} confirme`}.`);
    }
    if (["postventa", "consumidor", "ventas", "administracion"].includes(tema)) {
      const { data } = await sb.from("derivaciones").select("id").eq("estado", "pendiente").gte("created_at", new Date(Date.now() - 7 * 24 * H).toISOString());
      let n = 0;
      for (const d of data ?? []) { const { data: tm } = await sb.rpc("ojo_tema_derivacion", { p_derivacion: d.id }); if (tm === tema) n++; }
      if (n) out.push(`🆘 sin resolver de los últimos 7 días: ${n}.`);
    }
  } catch (e) { console.error("datosTema", e); }
  return out;
}

async function resumenPasado(t: Tema, chat: number) {
  const general = await grupoGeneral();
  const desde = new Date(Date.now() - 7 * 24 * H).toISOString();
  const log = await charla([general], desde, 600);
  const { data: pend } = await sb.from("ojo_pendientes").select("id, tema, estado, responsable_nombre, plazo_comprometido, creado_en")
    .eq("telegram_chat_id", general).in("estado", ["esperando_responsable", "abierto", "vencido_sin_confirmar"]);
  const sistema = await datosTema(t.tema);
  const system = `Sos Ojo, el asistente interno de Orbital Eyewear (fábrica argentina de anteojos). El equipo trabajaba en un solo grupo de Telegram y ahora se divide por tema.
Te paso los mensajes de los últimos 7 días del grupo general, los pendientes anotados y datos del sistema.
Quedate SOLO con lo que corresponde al tema "${t.label}" (${t.para_que}). Ignorá lo de otros temas.
Devolvé SOLO un JSON: {"paso": ["hasta 8 puntos cortos con lo más importante que pasó de este tema, con nombres de clientes y personas"],
"pendientes": [{"que": "qué quedó por hacer, concreto", "quien": "quién se encarga o '' si nadie", "desde": "dd/mm"}],
"ids_pendientes": [ids de la lista de pendientes anotados que son de este tema]}.
Reglas: español rioplatense, sin montos ni precios, no inventes nada que no esté en los mensajes. Si algo ya se resolvió, no va en pendientes. Si no hay nada, listas vacías.`;
  const user = `PENDIENTES ANOTADOS (JSON): ${JSON.stringify(pend ?? [])}\n\nDATOS DEL SISTEMA:\n${sistema.join("\n") || "(nada)"}\n\nMENSAJES (más viejo arriba):\n${log || "(sin mensajes)"}`;
  const r = parseJson(await askLLM(system, user, 2000)) ?? { paso: [], pendientes: [], ids_pendientes: [] };

  const paso = (r.paso ?? []) as string[];
  const pendientes = (r.pendientes ?? []) as { que: string; quien?: string; desde?: string }[];
  let texto = `📚 <b>Para que no se pierda nada — ${esc(t.label)}, últimos 7 días</b>\n\n`;
  texto += paso.length ? paso.map((p) => `• ${esc(p)}`).join("\n") : "• No encontré movimiento de este tema en el grupo general.";
  texto += `\n\n📌 <b>Quedó pendiente</b>\n`;
  const lineasPend = pendientes.map((p) => `• ${esc(p.que)}${p.quien ? ` — <b>${esc(p.quien)}</b>` : ""}${p.desde ? ` (desde ${esc(p.desde)})` : ""}`);
  lineasPend.push(...sistema.map((s) => `• ${esc(s)}`));
  texto += lineasPend.length ? lineasPend.join("\n") : "• Nada pendiente 🎉";
  await enviarLargo(chat, texto);

  // Los pendientes anotados de este tema se mudan: los recordatorios siguen acá.
  const validos = new Set((pend ?? []).map((p) => p.id));
  const mover = ((r.ids_pendientes ?? []) as unknown[]).filter((id) => validos.has(id as never));
  if (mover.length) await sb.from("ojo_pendientes").update({ telegram_chat_id: chat, grupo_origen: t.tema }).in("id", mover as never[]);
  return { paso: paso.length, pendientes: pendientes.length, movidos: mover.length };
}

async function moverTarjetas(tema: string) {
  try {
    const r = await fetch(`${SUPABASE_URL}/functions/v1/ojo-tarjetas?tarea=mover&tema=${tema}`, {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}` }, body: "{}",
    });
    return await r.json().catch(() => ({}));
  } catch (e) { console.error("mover tarjetas", e); return { error: String(e) }; }
}

async function altaGrupo(u: any): Promise<boolean> {
  const cm = u.my_chat_member;
  const chat = cm?.chat;
  if (!chat || (chat.type !== "group" && chat.type !== "supergroup")) return false;
  if (!["member", "administrator"].includes(cm.new_chat_member?.status)) return false;
  const ts = await temas();
  const t = temaPorNombre(ts, chat.title ?? "") ?? ts.find((x) => !x.chat_id && Number(x.creador_tg) === Number(cm.from?.id)) ?? null;
  if (!t) return false; // un grupo cualquiera: sigue ojo-telegram como siempre
  const esAdmin = cm.new_chat_member?.status === "administrator";
  if (t.chat_id === Number(chat.id)) { // ya estaba: si lo hicieron admin, invita a los del tema
    if (esAdmin) await invitar(t, Number(chat.id));
    return true;
  }
  // Hacerlo admin o tocar el historial pasa el grupo a supergrupo (id nuevo): si se acaba de crear, es el mismo.
  const reciente = t.chat_id && t.creado_at && Date.now() - new Date(t.creado_at).getTime() < 30 * 60e3;
  if (reciente && chat.type === "supergroup") {
    await sb.from("ojo_temas").update({ chat_id: chat.id }).eq("tema", t.tema);
    if (esAdmin) await invitar(t, Number(chat.id));
    return true;
  }
  await activarTema(t, chat, cm.from?.first_name ?? "alguien");
  if (esAdmin) await invitar(t, Number(chat.id));
  return true;
}

// Ojo admin del grupo: le manda a cada uno del tema su link por privado (uno por persona, de un solo uso).
// A quien no tiene el privado abierto con Ojo, el link le llega a Gastón para reenviárselo.
async function invitar(t: Tema, chat: number) {
  const mapa = await ids();
  const ads = await admins();
  const llegaron: string[] = [], yaEstan: string[] = [], reenviar: string[] = [];
  for (const cod of t.miembros) {
    const tgIds = (mapa[cod] ?? []).map(Number);
    const n = NOMBRE[cod] ?? cod;
    let dentro = false;
    for (const id of tgIds) {
      const m = await tg("getChatMember", { chat_id: chat, user_id: id });
      if (["creator", "administrator", "member"].includes(m?.result?.status)) dentro = true;
    }
    if (dentro) { yaEstan.push(n); continue; }
    const l = await tg("createChatInviteLink", { chat_id: chat, name: n.slice(0, 32), member_limit: 1 });
    const link = l?.result?.invite_link;
    if (!link) { reenviar.push(`${esc(n)}: no pude crear el link (¿Ojo tiene permiso de invitar?)`); continue; }
    let ok = false;
    for (const id of tgIds) {
      const d = await tg("sendMessage", {
        chat_id: id, parse_mode: "HTML", disable_web_page_preview: true,
        text: `👋 Hola ${esc(n)}. Ya está el grupo ${t.emoji} <b>Ojo · ${esc(t.label)}</b>: ${esc(t.para_que)}.\n\n👉 Tocá para entrar: ${link}\n\nAdentro está el resumen de lo pendiente. Desde ahora lo de ${esc(t.label)} llega ahí.`,
      });
      if (d?.ok) { ok = true; break; }
    }
    if (ok) llegaron.push(n); else reenviar.push(`${esc(n)}: ${link}`);
  }
  const txt = `🔗 ${t.emoji} <b>${esc(t.label)}</b> — invitaciones` +
    (llegaron.length ? `\n✅ Les mandé el link: ${llegaron.map(esc).join(", ")}` : "") +
    (yaEstan.length ? `\n👥 Ya estaban: ${yaEstan.map(esc).join(", ")}` : "") +
    (reenviar.length ? `\n⚠️ No les pude escribir, reenviales vos:\n${reenviar.join("\n")}` : "");
  for (const ad of ads) await tg("sendMessage", { chat_id: ad, text: txt, parse_mode: "HTML", disable_web_page_preview: true });
  return { llegaron, yaEstan, reenviar: reenviar.length };
}

// /tema <tema> (solo admins): el grupo donde se escribe pasa a ser el de ese tema, sin depender del nombre.
async function comandoTema(m: any): Promise<boolean> {
  const x = String(m.text ?? "").match(/^\/tema(?:@\w+)?\s+(.+)$/i);
  if (!x || !["group", "supergroup"].includes(m.chat?.type)) return false;
  if (!(await admins()).includes(Number(m.from?.id))) {
    await enviar(m.chat.id, "Sólo Gastón puede asignar el tema del grupo.", { reply_to_message_id: m.message_id });
    return true;
  }
  const tema = temaDeAlias(x[1]);
  const t = tema ? (await temas()).find((y) => y.tema === tema) : null;
  if (!t) {
    await enviar(m.chat.id, "No conozco ese tema. Opciones: ventas, prospeccion, consumidor, postventa, deposito, administracion.", { reply_to_message_id: m.message_id });
    return true;
  }
  if (t.chat_id === Number(m.chat.id)) {
    await enviar(m.chat.id, `Este ya es el grupo de ${t.emoji} ${esc(t.label)} 👍`, { reply_to_message_id: m.message_id });
    return true;
  }
  await activarTema(t, m.chat, m.from?.first_name ?? "alguien");
  return true;
}

async function activarTema(t: Tema, chat: any, quien: string) {
  const anterior = t.chat_id;
  await sb.from("ojo_grupos").upsert({
    telegram_chat_id: chat.id, nombre: chat.title ?? `grupo ${chat.id}`, tipo: t.tema,
    activo: true, agregado_por: quien, prospecta: t.tema === "prospeccion" || t.tema === "ventas", recibe_avisos: false,
  }, { onConflict: "telegram_chat_id" });
  await sb.from("ojo_temas").update({ chat_id: chat.id, creado_at: new Date().toISOString() }).eq("tema", t.tema);

  await bienvenida(t, chat.id);
  let res: unknown = null;
  try { res = await resumenPasado(t, chat.id); } catch (e) { console.error("resumen pasado", e); await enviar(chat.id, "📚 No pude armar el resumen de lo que pasó; Gastón te lo paso aparte."); }
  const mov = await moverTarjetas(t.tema);
  const n = Number((mov as any)?.movidas ?? 0);
  if (n) await enviar(chat.id, `🗂 Arriba les dejé las <b>${n}</b> tarjeta(s) abierta(s) de ${esc(t.label)} que estaban en el grupo general. Tóquenlas acá.`);

  const general = await grupoGeneral();
  await enviar(general, `✅ ${t.emoji} <b>${esc(t.label)}</b> ya tiene su grupo (lo creó ${esc(quien)}). Desde ahora lo de ${esc(t.label)} va allá.`);
  for (const ad of await admins()) {
    await tg("sendMessage", { chat_id: ad, parse_mode: "HTML", text: `👀 Se creó el grupo ${t.emoji} <b>${esc(chat.title ?? t.label)}</b> (${esc(quien)}) — chat_id <code>${chat.id}</code>.${anterior ? ` Reemplaza al anterior (<code>${anterior}</code>).` : ""}\nResumen: ${esc(JSON.stringify(res))} · tarjetas movidas: ${n}` });
  }
}

// Un grupo que pasa a supergrupo cambia de id.
async function migrar(m: any) {
  const viejo = Number(m.chat?.id), nuevo = Number(m.migrate_to_chat_id);
  if (!viejo || !nuevo) return;
  await sb.from("ojo_temas").update({ chat_id: nuevo }).eq("chat_id", viejo);
  const { data: g } = await sb.from("ojo_grupos").select("*").eq("telegram_chat_id", viejo).maybeSingle();
  if (g) {
    await sb.from("ojo_grupos").upsert({ ...g, telegram_chat_id: nuevo }, { onConflict: "telegram_chat_id" });
    await sb.from("ojo_grupos").update({ activo: false, recibe_avisos: false }).eq("telegram_chat_id", viejo);
  }
  await sb.from("ojo_tarjeta").update({ chat_id: nuevo }).eq("chat_id", viejo);
  await sb.from("ojo_pendientes").update({ telegram_chat_id: nuevo }).eq("telegram_chat_id", viejo);
}

// ---------- 4. puente entre grupos ----------
const ALIAS: [RegExp, string][] = [
  [/^post\s*-?\s*venta/, "postventa"], [/^prospecci/, "prospeccion"], [/^consumidor|^tienda|^gustavo/, "consumidor"],
  [/^dep[oó]sito/, "deposito"], [/^admin/, "administracion"], [/^ventas?\b|^vendedores/, "ventas"],
];
// Tiene que hablarle a Ojo («Ojo, preguntale a Depósito …»): entre ellos pueden decirse "preguntale a…" sin que se mande.
const RE_PUENTE = /^\s*@?\w*ojo\w*\b[\s,:]*(?:pregunt[aá](?:le)?|consult[aá](?:le)?|pas[aá](?:le|selo)|avis[aá](?:le)?|dec[ií](?:le)?)\s+(?:a\s+|al\s+)?(?:(?:el\s+)?grupo\s+de\s+|los\s+de\s+)?(post\s*-?\s*venta|prospecci[oó]n|consumidor(?:\s+final)?|tienda|gustavo|dep[oó]sito|administraci[oó]n|admin|ventas?|vendedores)\b[\s:,\-]*([\s\S]+)$/i;

// El mensaje no pasa por ojo-telegram: se registra acá para que el contexto del grupo quede completo.
async function registrar(m: any) {
  await sb.from("ojo_mensajes_log").insert({ telegram_chat_id: m.chat.id, telegram_message_id: m.message_id, autor_nombre: m.from?.first_name ?? "desconocido", autor_telegram_id: m.from?.id, texto: String(m.text ?? "").slice(0, 4000) });
}

function temaDeAlias(s: string): string | null {
  const n = s.trim().toLowerCase();
  for (const [re, t] of ALIAS) if (re.test(n)) return t;
  return null;
}
async function etiquetaChat(chat: number): Promise<string> {
  const { data } = await sb.from("ojo_temas").select("emoji, label").eq("chat_id", chat).maybeSingle();
  return data ? `${data.emoji} ${esc(data.label)}` : "el grupo general";
}

async function puentePregunta(m: any): Promise<boolean> {
  const x = String(m.text ?? "").match(RE_PUENTE);
  if (!x) return false;
  const tema = temaDeAlias(x[1]);
  if (!tema) return false;
  const pregunta = x[2].trim();
  await registrar(m);
  const origen = Number(m.chat.id);
  const destino = await chatTema(tema);
  const { data: t } = await sb.from("ojo_temas").select("*").eq("tema", tema).maybeSingle();
  const autor = m.from?.first_name ?? "Alguien";
  if (destino === origen) {
    // Ese grupo todavía no existe (o es este mismo): se le avisa acá a los del tema.
    const menc: string[] = [];
    for (const c of (t?.miembros ?? []) as string[]) menc.push(await mencion(c));
    await enviar(origen, `👆 ${menc.join(", ")}: ${esc(autor)} pregunta esto.${t && !t.chat_id ? ` (${esc(t.label)} todavía no tiene su grupo.)` : ""}`, { reply_to_message_id: m.message_id });
    return true;
  }
  const d = await enviar(destino,
    `❓ <b>${esc(autor)}</b> desde ${await etiquetaChat(origen)} pregunta:\n«${esc(pregunta)}»\n\n<i>Respondé este mensaje y se lo llevo.</i>`);
  if (!d?.ok) { await enviar(origen, "No pude pasarla, probá de nuevo.", { reply_to_message_id: m.message_id }); return true; }
  await sb.from("ojo_puente").insert({ origen_chat: origen, origen_msg: m.message_id, destino_chat: destino, destino_msg: d.result.message_id, autor, texto: pregunta.slice(0, 2000) });
  await enviar(origen, `📨 Se lo pasé a ${t ? `${t.emoji} ${esc(t.label)}` : "ese grupo"}. Les traigo la respuesta acá.`, { reply_to_message_id: m.message_id });
  return true;
}

async function puenteRespuesta(m: any): Promise<boolean> {
  const r = m.reply_to_message?.message_id;
  if (!r || !m.text) return false;
  const { data: p } = await sb.from("ojo_puente").select("*").eq("destino_chat", m.chat.id).eq("destino_msg", r).order("id", { ascending: false }).limit(1).maybeSingle();
  if (!p) return false;
  await registrar(m);
  const autor = m.from?.first_name ?? "Alguien";
  const d = await enviar(Number(p.origen_chat),
    `💬 <b>${esc(autor)}</b> (${await etiquetaChat(Number(m.chat.id))}) responde:\n«${esc(m.text)}»\n\n<i>Si hace falta, respondé este mensaje y se lo llevo.</i>`,
    { reply_to_message_id: Number(p.origen_msg), allow_sending_without_reply: true });
  if (d?.ok) {
    await sb.from("ojo_puente").update({ respondido_at: new Date().toISOString() }).eq("id", p.id);
    // Ida y vuelta: respondiendo este mensaje en el origen, vuelve al grupo que contestó.
    await sb.from("ojo_puente").insert({ origen_chat: m.chat.id, origen_msg: m.message_id, destino_chat: p.origen_chat, destino_msg: d.result.message_id, autor, texto: String(m.text).slice(0, 2000) });
    await tg("setMessageReaction", { chat_id: m.chat.id, message_id: m.message_id, reaction: [{ type: "emoji", emoji: "👍" }] });
  }
  return true;
}

// ---------- 5. /start por privado ----------
async function start(m: any): Promise<boolean> {
  const id = Number(m.from?.id);
  const nombreTg = `${m.from?.first_name ?? ""} ${m.from?.last_name ?? ""}`.trim();
  const mapa = await ids();
  let cod = Object.entries(mapa).find(([, v]) => v.map(Number).includes(id))?.[0] ?? null;
  if (!cod) {
    const n = nombreTg.toLowerCase();
    cod = /\bgus(tavo)?\b/.test(n) ? "Gustavo" : /\bulises\b/.test(n) ? "Ulises" : null;
    if (!cod) return false; // alguien que no es del equipo: lo atiende ojo-telegram
    mapa[cod] = [...(mapa[cod] ?? []), id];
    await sb.from("app_config").upsert({ clave: "tarjetas_tg", valor: JSON.stringify(mapa) }, { onConflict: "clave" });
    _ids = mapa;
  }
  if ((await admins()).includes(id)) return false;
  const { data: suyo } = await sb.from("ojo_temas").select("emoji, label, chat_id").eq("creador", cod).is("chat_id", null);
  let txt = `👋 ¡Listo ${esc(NOMBRE[cod] ?? nombreTg)}! Ya te puedo escribir por acá.`;
  if (RESUMEN_PARA.includes(cod)) txt += `\n\n🌙 Todos los días a las 19 te mando el resumen de lo que pasó en todos los grupos de Ojo.`;
  for (const t of suyo ?? []) txt += `\n\n📌 Te toca crear el grupo ${t.emoji} <b>${esc(t.label)}</b>: Nuevo grupo → nombre «Ojo · ${esc(t.label)}» → agregá a Ojo, a Gastón y a tu equipo.`;
  txt += `\n\nLas consultas y cargas hacelas en tu grupo, así queda todo a la vista.`;
  await tg("sendMessage", { chat_id: id, text: txt, parse_mode: "HTML" });
  for (const ad of await admins()) await tg("sendMessage", { chat_id: ad, parse_mode: "HTML", text: `✅ <b>${esc(NOMBRE[cod] ?? cod)}</b> abrió el privado con Ojo (id <code>${id}</code>).` });
  return true;
}

// ---------- 6. resumen del día (Gustavo y Mauro) ----------
// Cada línea lleva la acción concreta (qué hay que hacer y quién), no solo los números (2026-10-01, Gastón).
const ACCION: Record<string, string> = {
  ventas: "tocar las tarjetas abiertas (visitas, carritos, reuniones, leads) y contestar los 🆘 de ópticas",
  prospeccion: "confirmarle a la óptica las reuniones que Ventas ya aceptó y avisar las nuevas",
  consumidor: "contestar los 🆘 de consumidores que siguen sin respuesta",
  postventa: "resolver los casos abiertos (roturas, garantías, cambios, demoras) y avisarle al cliente",
  deposito: "mover los pedidos con los botones hasta despacho y avisar faltantes",
  administracion: "facturar lo que Depósito dejó listo y dar número a los clientes nuevos",
};
async function tareaResumen(forzar = false, soloA?: number, simular = false) {
  const a = horaAR();
  if (!forzar && a.getUTCDay() === 0) return { domingo: true };
  const hoy = hoyAR();
  const desde = new Date(`${hoy}T00:00:00-03:00`).toISOString();
  const ts = await temas();
  const lineas: string[] = [];

  // Tarjetas por tema: nuevas, resueltas, abiertas.
  const { data: tj } = await sb.from("ojo_tarjeta").select("id, tipo, ref, estado, creado_en, vendedor, datos").or(`creado_en.gte.${desde},estado.in.(abierta,seguimiento)`);
  const temaDe = async (t: any) => t.tipo === "deriv" ? String((await sb.rpc("ojo_tema_derivacion", { p_derivacion: t.ref })).data ?? "ventas") : t.tipo === "pedido" ? "deposito" : "ventas";
  const por: Record<string, { nuevas: number; cerradas: number; abiertas: number; viejas: string[] }> = {};
  for (const t of tj ?? []) {
    const k = await temaDe(t);
    const x = por[k] ??= { nuevas: 0, cerradas: 0, abiertas: 0, viejas: [] };
    if (t.creado_en >= desde) x.nuevas++;
    if (t.estado === "cerrada" && t.creado_en >= desde) x.cerradas++;
    if (t.estado === "abierta") {
      x.abiertas++;
      if (Date.now() - new Date(t.creado_en).getTime() > 24 * H) {
        const quien = t.datos?.nombre ?? t.datos?.razon ?? t.datos?.cliente ?? (t.tipo === "pedido" ? `pedido #${t.ref}` : t.tipo);
        x.viejas.push(`${quien} (${NOMBRE[t.vendedor] ?? t.vendedor ?? "?"}, desde ${fechaHora(t.creado_en).slice(0, 5)})`);
      }
    }
  }
  for (const t of ts) {
    const x = por[t.tema];
    const extra: string[] = [];
    if (t.tema === "prospeccion") {
      const { data: rs } = await sb.from("ojo_reuniones").select("conseguida_por").gte("creado_en", desde);
      const c: Record<string, number> = {};
      for (const r of rs ?? []) c[r.conseguida_por ?? "?"] = (c[r.conseguida_por ?? "?"] ?? 0) + 1;
      extra.push(Object.keys(c).length ? `reuniones conseguidas: ${Object.entries(c).map(([k, n]) => `${esc(k)} ${n}`).join(", ")}` : "sin reuniones nuevas");
    }
    if (t.tema === "deposito") {
      const { count } = await sb.from("pedidos").select("id", { count: "exact", head: true }).gte("created_at", desde).neq("vendedor", "Tienda");
      extra.push(`pedidos nuevos: ${count ?? 0}`);
    }
    const base = x ? `${x.nuevas} nuevas · ${x.cerradas} resueltas · ${x.abiertas} abiertas` : "sin tarjetas";
    lineas.push(`${t.emoji} <b>${esc(t.label)}</b>${t.chat_id ? "" : " <i>(sin grupo todavía)</i>"}: ${base}${extra.length ? ` · ${extra.join(" · ")}` : ""}`);
    if (x?.viejas.length) lineas.push(`    ⚠️ Colgadas hace +1 día: ${x.viejas.slice(0, 5).map(esc).join("; ")}${x.viejas.length > 5 ? "…" : ""}`);
    if (x?.abiertas) {
      const quien = (t.miembros?.length ? t.miembros : [t.creador]).map((m) => NOMBRE[m] ?? m).join(", ");
      lineas.push(`    👉 <b>Acción</b> (${esc(quien)}): ${ACCION[t.tema] ?? "resolver lo abierto"}${x.viejas.length ? ", empezando por las colgadas" : ""}.`);
    }
  }

  // Check-ins de campo (foto de vidriera + ubicación): quién visitó a quién y qué hay que llevar.
  const { data: cks } = await sb.from("v_visitas_checkin")
    .select("vendedor, cliente, cod_cliente, localidad, tiene_orbital, pop_nombre, es_prospecto_nuevo, estado")
    .gte("creado_en", desde).in("estado", ["confirmado", "pendiente", "esperando_nombre"]).order("creado_en");
  const conf = (cks ?? []).filter((c: any) => c.estado === "confirmado");
  const sinConf = (cks ?? []).filter((c: any) => c.estado !== "confirmado");
  if (conf.length || sinConf.length) {
    const porV: Record<string, number> = {};
    for (const c of conf) porV[c.vendedor ?? "?"] = (porV[c.vendedor ?? "?"] ?? 0) + 1;
    lineas.push("", `📍 <b>Visitas con foto</b>: ${conf.length ? Object.entries(porV).map(([v, n]) => `${esc(NOMBRE[v] ?? v)} ${n}`).join(", ") : "ninguna confirmada"}`);
    for (const c of conf.slice(0, 8)) {
      const orb = c.tiene_orbital === "true" ? "con Orbital" : c.tiene_orbital === "false" ? "sin Orbital" : "";
      lineas.push(`    • ${esc(c.cliente ?? c.cod_cliente ?? "?")}${c.localidad && !String(c.cliente ?? "").includes(c.localidad) ? ` (${esc(c.localidad)})` : ""}${c.es_prospecto_nuevo ? " 🆕" : ""}${orb ? ` · ${orb}` : ""}${c.pop_nombre ? ` → llevar <b>${esc(c.pop_nombre)}</b>` : ""}`);
    }
    if (conf.length > 8) lineas.push(`    … y ${conf.length - 8} más`);
    const nuevos = conf.filter((c: any) => c.es_prospecto_nuevo).length;
    const acc: string[] = [];
    if (conf.some((c: any) => c.pop_nombre)) acc.push("el vendedor lleva el POP sugerido en la próxima visita");
    if (nuevos) acc.push(`Administración da número de cliente a ${nuevos === 1 ? "1 prospecto nuevo" : `${nuevos} prospectos nuevos`} 🆕`);
    if (sinConf.length) {
      const quienes = [...new Set(sinConf.map((c: any) => NOMBRE[c.vendedor] ?? c.vendedor ?? "?"))].map(esc).join(", ");
      acc.push(`${quienes}: ${sinConf.length === 1 ? "1 check-in sin confirmar" : `${sinConf.length} check-ins sin confirmar`}, tocar el botón del cliente`);
    }
    if (acc.length) lineas.push(`    👉 <b>Acción</b>: ${acc.join("; ")}.`);
  }

  // Lo importante del día, leyendo todos los grupos.
  const log = await charla(null, desde, 500);
  let clave: string[] = [];
  if (log) {
    const raw = await askLLM(
      `Sos Ojo, asistente interno de Orbital Eyewear. Te paso los mensajes de hoy de todos los grupos de Telegram del equipo.
Devolvé SOLO un JSON {"clave": [{"que": "qué pasó o qué quedó trabado, con nombres, una oración", "accion": "qué hay que hacer ahora, empezando con un verbo (llamar, confirmar, facturar, mandar…); vacío si no hace falta nada", "quien": "quién tiene que hacerlo"}]}.
Hasta 6 puntos, lo más importante primero. Sin montos ni precios. No inventes: la acción sale de lo que se habló.`,
      log, 2000);
    const r = parseJson(raw);
    if (!r?.clave) console.error("resumen sin clave", log.length, raw.slice(0, 300));
    // El modelo a veces cambia el nombre del campo: vale la primera lista que traiga.
    const lista = (r?.clave ?? Object.values(r ?? {}).find(Array.isArray) ?? []) as any[];
    clave = lista.map((c) => {
      if (typeof c === "string") return `• ${esc(c)}`;
      const acc = String(c?.accion ?? "").trim();
      return `• ${esc(c?.que ?? "")}` + (acc ? `\n   👉 ${c?.quien ? `<b>${esc(c.quien)}</b>: ` : ""}${esc(acc)}` : "");
    }).filter((l) => l.length > 2);
  }
  const dia = DIAS[horaAR().getUTCDay()];
  const texto = `🌙 <b>Resumen de Ojo — ${dia} ${hoy.slice(8, 10)}/${hoy.slice(5, 7)}</b>\n\n${lineas.join("\n")}` +
    (clave.length ? `\n\n🧠 <b>Lo importante y qué hacer</b>\n${clave.join("\n")}` : "");

  if (simular) return { ok: true, simulado: true, texto };
  const destinos = soloA ? [soloA] : (await Promise.all(RESUMEN_PARA.map(async (c) => (await ids())[c]?.[0] ?? null))).filter(Boolean) as number[];
  const env: Record<string, boolean> = {};
  for (const id of destinos) {
    const d = await tg("sendMessage", { chat_id: id, text: texto.slice(0, 4096), parse_mode: "HTML", disable_web_page_preview: true });
    env[String(id)] = !!d?.ok;
  }
  return { ok: true, enviados: env, texto };
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
    const forzar = url.searchParams.get("forzar") === "1";
    if (tarea === "anuncio") return json(await tareaAnuncio(Number(url.searchParams.get("chat")) || undefined));
    if (tarea === "recordar") return json(await tareaRecordar(url.searchParams.get("modo") ?? "favor", forzar));
    if (tarea === "resumen") return json(await tareaResumen(forzar, Number(url.searchParams.get("a")) || undefined, url.searchParams.get("simular") === "1"));
    if (tarea === "estado") return json(await temas());
    if (tarea === "invitar") {
      const t = (await temas()).find((x) => x.tema === url.searchParams.get("tema"));
      if (!t?.chat_id) return json({ error: "ese tema no tiene grupo" }, 400);
      return json(await invitar(t, t.chat_id));
    }
    const body = await req.json().catch(() => ({}));
    const u = body.update ?? {};
    let manejado = false;
    if (u.my_chat_member) manejado = await altaGrupo(u);
    else if (u.message?.migrate_to_chat_id) { await migrar(u.message); manejado = false; }
    else if (u.message?.chat?.type === "private") manejado = /^\/start\b/.test(u.message.text ?? "") ? await start(u.message) : false;
    else if (u.message?.text) manejado = (await comandoTema(u.message)) || (await puenteRespuesta(u.message)) || (await puentePregunta(u.message));
    return json({ manejado });
  } catch (e) {
    console.error(e);
    return json({ error: String((e as Error).message ?? e), manejado: false }, 500);
  }
});
