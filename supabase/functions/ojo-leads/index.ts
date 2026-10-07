import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// ojo-leads — checklist de leads "Nos buscaron" por Telegram (bot Ojo): nadie queda sin contactar.
//   ?tarea=tick      (cron cada 20 min, L-S 9-19 ART)
//                    1) lead_check_sync(): todo lo nuevo de la cola (y lo que IRIS deriva a un vendedor) entra al checklist
//                    2) recuerda a las 2 h lo que espera respuesta del vendedor y escala a los admins a las 24 h
//                    3) manda los seguimientos que vencieron (visita, catálogo, lo piensa, va a comprar)
//                    4) una tarjeta nueva por vendedor, si no tiene 2 esperando
//   ?tarea=estado    resumen por vendedor (sin mandar nada).
//   ?tarea=responder {conversacion_id, texto, agente} → al cliente vía at-responder.
//   POST {update}    ojo-conteo le reenvía los botones lck:* y las respuestas a las tarjetas.
// Tarjeta: ✅ Hablé · 📵 No atiende (reintenta al día siguiente, máx 3) · 🚫 No le interesa · 🔀 Otra zona.
// Después de ✅: ¿cómo quedó? 📅 Visita (pide la fecha) · 🛒 Va a comprar · 📖 Catálogo · 🤔 Lo piensa · ✅ Compró · 🚫 No va.
// Cada resultado actualiza la Suite (prospeccion_social etapa/estado/nota + ficha del cliente: próximo paso,
// fecha de agenda, nota) y programa el seguimiento. Respondiendo la tarjeta con texto, queda anotado.
// Cada tarjeta trae el catálogo propio del lead y el botón 📖 Mandar catálogo por WhatsApp (mensaje ya escrito).
// v3 (2026-09-30).

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TG = `https://api.telegram.org/bot${Deno.env.get("TELEGRAM_BOT_TOKEN")!}`;
const GRUPO = -5504692394;
const sb = createClient(SUPABASE_URL, SERVICE_KEY);
// Ojo por tema (2026-09-30): los leads van al grupo de Ventas; mientras no exista, al general.
async function chatVentas(): Promise<number> {
  const { data } = await sb.rpc("ojo_chat_tema", { p_tema: "ventas" });
  return Number(data) || GRUPO;
}

const MAX_ABIERTAS = 2;
const RECORDAR_MS = 2 * 3600e3;
const ESCALAR_MS = 24 * 3600e3;
const MAX_INTENTOS = 3;
const DIA = 24 * 3600e3;

const COLOR: Record<string, string> = { Adrian: "🟢", Bruno: "🔵", Lola: "🟣", Mauro: "🟠" };
const NOMBRE: Record<string, string> = { Adrian: "Adrián", Bruno: "Bruno", Lola: "Lola", Mauro: "Mauro" };
const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const horaAR = (d = new Date()) => new Date(d.getTime() - 3 * 3600e3);
const hhmm = (d = new Date()) => horaAR(d).toISOString().slice(11, 16);
const ddmm = (d = new Date()) => { const a = horaAR(d).toISOString(); return `${a.slice(8, 10)}/${a.slice(5, 7)}`; };
const iso = (ms: number) => new Date(ms).toISOString();

async function cfg(clave: string): Promise<string | null> {
  const { data } = await sb.from("app_config").select("valor").eq("clave", clave).maybeSingle();
  return data?.valor ?? null;
}
async function tgIds(): Promise<Record<string, number[]>> {
  try { return JSON.parse(await cfg("lead_check_tg") ?? "{}"); } catch { return {}; }
}
async function admins(): Promise<number[]> {
  const { data } = await sb.from("ojo_admins").select("telegram_user_id");
  return (data ?? []).map((a) => Number(a.telegram_user_id));
}
async function tg(metodo: string, body: Record<string, unknown>) {
  const r = await fetch(`${TG}/${metodo}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (!d?.ok) console.error(metodo, JSON.stringify(d));
  return d;
}
async function enviar(chatId: number, text: string, extra: Record<string, unknown> = {}) {
  const d = await tg("sendMessage", { chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true, ...extra });
  if (d?.ok) {
    await sb.from("ojo_mensajes_log").insert({ telegram_chat_id: chatId, telegram_message_id: d.result.message_id, autor_nombre: "Ojo", texto: text.slice(0, 4000), es_del_bot: true });
  }
  return d;
}

type Lead = {
  id: number; prospeccion_id: number; vendedor: string; orden: number; resumen: string | null; estado: string;
  intentos: number; proximo_envio: string | null; chat_id: number | null; message_id: number | null;
  enviado_at: string | null; recordado_at: string | null; escalado_at: string | null;
  espera: string | null; espera_desde: string | null; espera_msg: number | null;
  seguimiento_at: string | null; resultado: string | null; fecha_visita: string | null;
};
type Prosp = { id: number; nombre: string; zona: string | null; telefono: string | null; conversacion_id: string | null; nota: string | null; created_at: string; etapa: string | null; estado: string };

function origen(p: Prosp): string {
  const f = ddmm(new Date(p.created_at));
  const n = p.nota ?? "";
  if (n.includes("directo al WhatsApp") || n.includes("Entró por WhatsApp")) return `escribió al WhatsApp desde el anuncio (${f})`;
  if (!p.conversacion_id) return `formulario del anuncio de Meta (${f}), no contestó el primer mensaje`;
  return `anuncio de Meta (${f}) + charló con IRIS`;
}
const wa = (tel: string | null) => {
  const d = String(tel ?? "").replace(/\D/g, "");
  return d ? `wa.me/${d.startsWith("54") ? d : "54" + d}` : "sin teléfono";
};
function mencion(vend: string, ids: Record<string, number[]>) {
  const id = ids[vend]?.[0];
  const n = `${COLOR[vend] ?? ""} ${NOMBRE[vend] ?? vend}`.trim();
  return id ? `<a href="tg://user?id=${id}">${esc(n)}</a>` : esc(n);
}
// Botón que abre WhatsApp con el prospecto y el mensaje ya escrito con SU catálogo.
type BotonUrl = { text: string; url: string };
const filaCat = (cat?: BotonUrl | null) => (cat ? [[cat]] : []);
const tecladoMarca = (id: number, cat?: BotonUrl | null) => ({
  inline_keyboard: [
    ...filaCat(cat),
    [{ text: "✅ Hablé", callback_data: `lck:ok:${id}` }, { text: "📵 No atiende", callback_data: `lck:na:${id}` }],
    [{ text: "🚫 No le interesa", callback_data: `lck:ni:${id}` }, { text: "🔀 Otra zona", callback_data: `lck:oz:${id}` }],
  ],
});
const tecladoResultado = (id: number, cat?: BotonUrl | null) => ({
  inline_keyboard: [
    ...filaCat(cat),
    [{ text: "📅 Visita", callback_data: `lck:r:vis:${id}` }, { text: "🛒 Va a comprar", callback_data: `lck:r:cmp:${id}` }],
    [{ text: "📖 Le mandé catálogo", callback_data: `lck:r:cat:${id}` }, { text: "🤔 Lo piensa", callback_data: `lck:r:pie:${id}` }],
    [{ text: "✅ Compró", callback_data: `lck:r:ya:${id}` }, { text: "🚫 No va", callback_data: `lck:r:no:${id}` }],
  ],
});

// Resultado → etapa en la cola, próximo paso en la ficha y cuándo volver a preguntar.
const RES: Record<string, { txt: string; etapa?: string; paso?: string; dias?: number; cierra?: boolean; descarta?: boolean }> = {
  vis: { txt: "📅 Visita agendada", etapa: "evaluacion", paso: "Visita comercial (lead Meta)" },
  cmp: { txt: "🛒 Va a comprar", etapa: "conversion", paso: "Cerrar pedido (lead Meta)", dias: 2 },
  cat: { txt: "📖 Le mandó catálogo", etapa: "evaluacion", paso: "Seguimiento del catálogo (lead Meta)", dias: 3 },
  pie: { txt: "🤔 Lo piensa", etapa: "evaluacion", paso: "Volver a llamar (lead Meta)", dias: 5 },
  ya: { txt: "✅ Compró", etapa: "cliente", cierra: true },
  no: { txt: "🚫 No va", cierra: true, descarta: true },
};
const PREGUNTA_SEG: Record<string, string> = {
  vis: "¿Cómo te fue en la visita?",
  cmp: "¿Se cerró el pedido?",
  cat: "¿Vio el catálogo? ¿Qué te dijo?",
  pie: "¿Ya lo decidió?",
};

// ---------- Suite ----------
async function prosp(id: number): Promise<Prosp> {
  const { data } = await sb.from("prospeccion_social").select("id,nombre,zona,telefono,conversacion_id,nota,created_at,etapa,estado").eq("id", id).single();
  return data as Prosp;
}
async function fichaCliente(tel: string | null): Promise<{ cod: string; nota: string | null } | null> {
  const d = String(tel ?? "").replace(/\D/g, "").slice(-10);
  if (d.length < 8) return null;
  const { data } = await sb.from("clientes").select("cod, nota, telefono, whatsapp").or(`telefono.ilike.*${d},whatsapp.ilike.*${d}`).limit(1);
  return (data?.[0] as { cod: string; nota: string | null }) ?? null;
}
async function anotar(l: Lead, p: Prosp, por: string, texto: string, extraProsp: Record<string, unknown> = {}, extraCliente: Record<string, unknown> = {}) {
  const linea = `📞 ${ddmm()} ${hhmm()} ${por}: ${texto} (Ojo)`;
  await sb.from("prospeccion_social").update({ nota: `${p.nota ?? ""}\n${linea}`.trim(), ...extraProsp }).eq("id", p.id);
  const c = await fichaCliente(p.telefono);
  if (c) await sb.from("clientes").update({ nota: `${c.nota ?? ""}\n${linea}`.trim(), ...extraCliente }).eq("cod", c.cod);
  return !!c;
}

// ---------- catálogo del lead ----------
// Cada lead tiene su propio link (catalogo_link_lead): cliente → el de su óptica; prospecto → uno
// a nombre del vendedor. Así se sabe quién lo abrió y el pedido cae en la cola del vendedor.
const CATALOGO = "https://ver.orbitaleyewear.com.ar/catalogo?k=";
async function catalogo(l: Lead, p: Prosp): Promise<{ url: string; boton: BotonUrl | null } | null> {
  const { data, error } = await sb.rpc("catalogo_link_lead", { p_prospeccion_id: p.id });
  if (error || !data) { if (error) console.error("catalogo_link_lead", error.message); return null; }
  const url = CATALOGO + data;
  const d = String(p.telefono ?? "").replace(/\D/g, "");
  if (!d) return { url, boton: null };
  const texto = `Hola! Soy ${NOMBRE[l.vendedor] ?? l.vendedor} de Orbital. Te paso el catálogo con precios mayoristas: ${url}\n\n` +
    `Si armás el pedido ahí mismo me llega directo. Cualquier duda escribime por acá.`;
  return { url, boton: { text: "📖 Mandar catálogo por WhatsApp", url: `https://wa.me/${d.startsWith("54") ? d : "54" + d}?text=${encodeURIComponent(texto)}` } };
}

// ---------- tarjetas ----------
async function tarjeta(l: Lead, p: Prosp, ids: Record<string, number[]>, total: number, cat?: string) {
  const intento = l.intentos > 0 ? ` · intento ${l.intentos + 1}` : "";
  return `📇 Para: ${mencion(l.vendedor, ids)} · contacto ${l.orden}/${total}${intento}\n\n` +
    `<b>${esc(p.nombre)}</b>${p.zona ? ` — ${esc(p.zona)}` : ""}\n` +
    `📍 De dónde viene: ${esc(origen(p))}\n` +
    `📝 ${esc(l.resumen ?? "")}\n` +
    `📲 ${wa(p.telefono)}\n` +
    (cat ? `📖 Su catálogo: ${cat}\n` : "") + `\n` +
    `Llamalo/a y marcá cómo te fue 👇 (respondé esta tarjeta para anotar algo en la Suite)`;
}
async function tarjetaSeguimiento(l: Lead, p: Prosp, ids: Record<string, number[]>, cat?: string) {
  const cuando = l.resultado === "vis" && l.fecha_visita ? `visita del ${l.fecha_visita.slice(8, 10)}/${l.fecha_visita.slice(5, 7)}` : (RES[l.resultado ?? ""]?.txt ?? "✅ hablaste, pero no me contaste cómo quedó");
  return `🔔 Seguimiento para ${mencion(l.vendedor, ids)}\n\n<b>${esc(p.nombre)}</b>${p.zona ? ` — ${esc(p.zona)}` : ""}\n` +
    `Quedó: ${esc(cuando)}\n📲 ${wa(p.telefono)}\n` + (cat ? `📖 Su catálogo: ${cat}\n` : "") +
    `\n<b>${esc(PREGUNTA_SEG[l.resultado ?? ""] ?? "¿Cómo quedó?")}</b>`;
}
async function esperar(id: number, que: string, msg: number, extra: Record<string, unknown> = {}) {
  await sb.from("lead_check").update({ espera: que, espera_desde: new Date().toISOString(), espera_msg: msg, recordado_at: null, escalado_at: null, ...extra }).eq("id", id);
}

// ---------- tick ----------
function enHorario(d = new Date()) {
  const a = horaAR(d);
  return a.getUTCDay() !== 0 && a.getUTCHours() >= 9 && a.getUTCHours() < 19;
}

async function tareaTick(forzar = false) {
  if (!forzar && !enHorario()) return { fuera_de_horario: true };
  const out: Record<string, unknown> = {};
  const { data: sync, error: eSync } = await sb.rpc("lead_check_sync");
  out.sync = eSync ? eSync.message : sync;
  const ids = await tgIds();
  const ahora = Date.now();

  // 1) recordatorios y escalamiento
  const { data: esperando } = await sb.from("lead_check").select("*").not("espera", "is", null);
  const escalar: Lead[] = [];
  const QUE: Record<string, string> = { marca: "marcar cómo te fue (✅ / 📵 / 🚫 / 🔀)", resultado: "contarme cómo quedó", fecha: "decirme la fecha de la visita" };
  for (const l of (esperando ?? []) as Lead[]) {
    const t = new Date(l.espera_desde ?? 0).getTime();
    if (!l.recordado_at && ahora - t > RECORDAR_MS && l.chat_id && l.espera_msg) {
      await enviar(l.chat_id, `⏰ ${mencion(l.vendedor, ids)}, te falta ${QUE[l.espera ?? ""] ?? "responder"} acá 👆`, { reply_to_message_id: l.espera_msg });
      await sb.from("lead_check").update({ recordado_at: new Date().toISOString() }).eq("id", l.id);
    }
    if (!l.escalado_at && ahora - t > ESCALAR_MS) escalar.push(l);
  }
  if (escalar.length) {
    const { data: ps } = await sb.from("prospeccion_social").select("id,nombre").in("id", escalar.map((l) => l.prospeccion_id));
    const nom = new Map((ps ?? []).map((p) => [p.id, p.nombre]));
    const porV: Record<string, string[]> = {};
    for (const l of escalar) (porV[l.vendedor] ??= []).push(`• ${esc(nom.get(l.prospeccion_id) ?? l.prospeccion_id)} (${l.espera === "marca" ? "sin llamar" : "sin contar cómo quedó"})`);
    const txt = `⚠️ <b>Leads sin respuesta del vendedor hace más de 24 h</b>\n\n` +
      Object.entries(porV).map(([v, ls]) => `${esc(NOMBRE[v] ?? v)} (${ls.length}):\n${ls.join("\n")}`).join("\n\n");
    for (const a of await admins()) await enviar(a, txt);
    await sb.from("lead_check").update({ escalado_at: new Date().toISOString() }).in("id", escalar.map((l) => l.id));
    out.escalados = escalar.length;
  }

  const abiertas: Record<string, number> = {};
  for (const l of (esperando ?? []) as Lead[]) abiertas[l.vendedor] = (abiertas[l.vendedor] ?? 0) + 1;

  // 2) seguimientos vencidos (tienen prioridad sobre las tarjetas nuevas)
  const { data: segs } = await sb.from("lead_check").select("*").eq("estado", "seguimiento").is("espera", null)
    .lte("seguimiento_at", new Date().toISOString()).order("seguimiento_at");
  const ventas = await chatVentas();
  let nSeg = 0;
  for (const l of (segs ?? []) as Lead[]) {
    if ((abiertas[l.vendedor] ?? 0) >= MAX_ABIERTAS) continue;
    const p = await prosp(l.prospeccion_id);
    const cat = await catalogo(l, p);
    const d = await enviar(ventas, await tarjetaSeguimiento(l, p, ids, cat?.url), { reply_markup: tecladoResultado(l.id, cat?.boton) });
    if (!d?.ok) continue;
    await esperar(l.id, "resultado", d.result.message_id, { chat_id: ventas, message_id: d.result.message_id });
    abiertas[l.vendedor] = (abiertas[l.vendedor] ?? 0) + 1;
    nSeg++;
  }
  if (nSeg) out.seguimientos = nSeg;

  // 3) una tarjeta nueva por vendedor
  const { data: todos } = await sb.from("lead_check").select("vendedor");
  const totales: Record<string, number> = {};
  for (const x of todos ?? []) totales[x.vendedor] = (totales[x.vendedor] ?? 0) + 1;
  for (const v of Object.keys(totales)) {
    if ((abiertas[v] ?? 0) >= MAX_ABIERTAS) { out[v] = `frenado (${abiertas[v]} esperando)`; continue; }
    const { data: prox } = await sb.from("lead_check").select("*").eq("vendedor", v)
      .or(`estado.eq.cola,and(estado.eq.no_atiende,proximo_envio.lte.${new Date().toISOString()},intentos.lt.${MAX_INTENTOS})`)
      .order("intentos").order("orden").limit(1);
    const l = (prox ?? [])[0] as Lead | undefined;
    if (!l) { out[v] = "sin pendientes"; continue; }
    const p = await prosp(l.prospeccion_id);
    const cat = await catalogo(l, p);
    const d = await enviar(ventas, await tarjeta(l, p, ids, totales[v], cat?.url), { reply_markup: tecladoMarca(l.id, cat?.boton) });
    if (!d?.ok) { out[v] = "error al mandar"; continue; }
    await sb.from("lead_check").update({ estado: "enviado", chat_id: ventas, message_id: d.result.message_id, enviado_at: new Date().toISOString() }).eq("id", l.id);
    await esperar(l.id, "marca", d.result.message_id);
    out[v] = `mandado #${l.orden}`;
  }
  return out;
}

async function tareaEstado() {
  const { data } = await sb.from("lead_check").select("vendedor, estado, espera, resultado");
  const r: Record<string, Record<string, number>> = {};
  for (const x of data ?? []) {
    r[x.vendedor] ??= {};
    const k = x.espera ? `esperando_${x.espera}` : x.estado + (x.resultado ? `:${x.resultado}` : "");
    r[x.vendedor][k] = (r[x.vendedor][k] ?? 0) + 1;
  }
  return r;
}

// ---------- botones ----------
const ETIQ: Record<string, string> = { ok: "✅ Hablé", na: "📵 No atiende", ni: "🚫 No le interesa", oz: "🔀 Otra zona" };

async function editar(msg: any, extra: string, teclado: unknown = { inline_keyboard: [] }) {
  const base = String(msg?.text ?? "")
    .replace(/\n*Llamalo\/a y marcá cómo te fue 👇.*$/s, "")
    .replace(/\n*¿Cómo quedó\? 👇\s*$/s, "");
  await tg("editMessageText", { chat_id: msg.chat.id, message_id: msg.message_id, disable_web_page_preview: true, text: `${base}\n\n${extra}`, reply_markup: teclado });
}

async function manejarCallback(cq: any) {
  const partes = String(cq.data).split(":");
  const esRes = partes[1] === "r";
  const accion = esRes ? partes[2] : partes[1];
  const idStr = esRes ? partes[3] : partes[2];
  const quien = Number(cq.from?.id);
  const { data } = await sb.from("lead_check").select("*").eq("id", Number(idStr)).maybeSingle();
  const l = data as Lead | null;
  if (!l) { await tg("answerCallbackQuery", { callback_query_id: cq.id, text: "No lo encuentro" }); return; }
  const ids = await tgIds();
  if (![...(ids[l.vendedor] ?? []), ...await admins()].includes(quien)) {
    await tg("answerCallbackQuery", { callback_query_id: cq.id, text: `Esto lo marca ${NOMBRE[l.vendedor] ?? l.vendedor} 🙂` });
    return;
  }
  const por = cq.from?.first_name ?? NOMBRE[l.vendedor] ?? "Telegram";
  const p = await prosp(l.prospeccion_id);
  const msg = cq.message;

  if (!esRes) {
    if (l.espera !== "marca") { await tg("answerCallbackQuery", { callback_query_id: cq.id, text: "Ya estaba marcado" }); return; }
    await tg("answerCallbackQuery", { callback_query_id: cq.id, text: ETIQ[accion] ?? "" });
    const base = { respondido_at: new Date().toISOString(), respondido_por: por, espera: null, espera_msg: null };
    if (accion === "ok") {
      await anotar(l, p, por, "hablé", p.etapa === "presentacion" ? { etapa: "interaccion" } : {});
      await sb.from("lead_check").update({ ...base, estado: "contactado" }).eq("id", l.id);
      await editar(msg, `✅ Habló ${por} ${hhmm()}\n¿Cómo quedó? 👇`, tecladoResultado(l.id, (await catalogo(l, p))?.boton));
      await esperar(l.id, "resultado", msg.message_id);
    } else if (accion === "na") {
      const intentos = l.intentos + 1;
      const cierra = intentos >= MAX_INTENTOS;
      await anotar(l, p, por, cierra ? `no atiende (${intentos}° intento, se cierra)` : `no atiende (intento ${intentos})`);
      await sb.from("lead_check").update({ ...base, estado: "no_atiende", intentos, ...(cierra ? {} : { proximo_envio: iso(Date.now() + 20 * 3600e3) }) }).eq("id", l.id);
      await editar(msg, `📵 No atendió — ${por} ${hhmm()}\n${cierra ? `No atendió ${intentos} veces: queda cerrado.` : `Te lo vuelvo a mandar mañana (intento ${intentos + 1} de ${MAX_INTENTOS}).`}`);
    } else if (accion === "ni") {
      await anotar(l, p, por, "no le interesa", { estado: "descartado" });
      await sb.from("lead_check").update({ ...base, estado: "no_interesa" }).eq("id", l.id);
      await editar(msg, `🚫 No le interesa — ${por} ${hhmm()}`);
    } else if (accion === "oz") {
      await anotar(l, p, por, "es de otra zona");
      await sb.from("lead_check").update({ ...base, estado: "otra_zona" }).eq("id", l.id);
      await editar(msg, `🔀 Otra zona — ${por} ${hhmm()}\nGastón: decí a quién va (o /derivar).`);
    }
    return;
  }

  // resultado
  if (l.espera !== "resultado") { await tg("answerCallbackQuery", { callback_query_id: cq.id, text: "Ya estaba anotado" }); return; }
  const r = RES[accion];
  if (!r) { await tg("answerCallbackQuery", { callback_query_id: cq.id }); return; }
  await tg("answerCallbackQuery", { callback_query_id: cq.id, text: r.txt });
  const extraP: Record<string, unknown> = {};
  if (r.etapa) extraP.etapa = r.etapa;
  if (r.descarta) extraP.estado = "descartado";
  if (accion === "ya") extraP.estado = "cerrado";
  const extraC: Record<string, unknown> = {};
  if (r.paso) extraC.proximo_paso = r.paso;
  if (r.dias) extraC.proxima_agenda_fecha = horaAR(new Date(Date.now() + r.dias * DIA)).toISOString().slice(0, 10);
  const enFicha = await anotar(l, p, por, r.txt.replace(/^\S+\s/, "").toLowerCase(), extraP, extraC);
  const ficha = enFicha ? " · ficha actualizada" : "";

  if (accion === "vis") {
    await sb.from("lead_check").update({ estado: "seguimiento", resultado: "vis" }).eq("id", l.id);
    await editar(msg, `📅 Visita — ${por} ${hhmm()}`);
    const d = await enviar(msg.chat.id, `📅 ${mencion(l.vendedor, ids)}, ¿qué día es la visita a <b>${esc(p.nombre)}</b>? Respondé este mensaje con la fecha (ej: 3/10).`,
      { reply_to_message_id: msg.message_id, reply_markup: { force_reply: true, selective: true, input_field_placeholder: "dd/mm" } });
    if (d?.ok) await esperar(l.id, "fecha", d.result.message_id);
    return;
  }
  if (r.cierra) {
    await sb.from("lead_check").update({ estado: "cerrado", resultado: accion, espera: null, espera_msg: null, seguimiento_at: null }).eq("id", l.id);
    await editar(msg, `${r.txt} — ${por} ${hhmm()}${ficha}\n${accion === "ya" ? "🎉 Pasa a cliente en la cola." : "Queda descartado en la cola."}`);
    return;
  }
  const seg = Date.now() + (r.dias ?? 3) * DIA;
  await sb.from("lead_check").update({ estado: "seguimiento", resultado: accion, espera: null, espera_msg: null, seguimiento_at: iso(seg) }).eq("id", l.id);
  await editar(msg, `${r.txt} — ${por} ${hhmm()}${ficha}\n🔔 Te pregunto de nuevo el ${ddmm(new Date(seg))}.`);
}

// ---------- respuestas con texto a una tarjeta ----------
function parseFecha(t: string): string | null {
  const m = t.match(/(\d{1,2})[\/\-.](\d{1,2})(?:[\/\-.](\d{2,4}))?/);
  const hoy = horaAR();
  if (/hoy/i.test(t)) return hoy.toISOString().slice(0, 10);
  if (/mañana|manana/i.test(t)) return new Date(hoy.getTime() + DIA).toISOString().slice(0, 10);
  if (!m) return null;
  const d = Number(m[1]), mes = Number(m[2]);
  let a = m[3] ? Number(m[3]) : hoy.getUTCFullYear();
  if (a < 100) a += 2000;
  if (d < 1 || d > 31 || mes < 1 || mes > 12) return null;
  const f = () => `${a}-${String(mes).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  // sin año y ya pasó hace más de una semana → es del año que viene (ej. en diciembre dicen 5/1)
  if (!m[3] && new Date(`${f()}T12:00:00Z`).getTime() < hoy.getTime() - 7 * DIA) a += 1;
  return f();
}

async function manejarMensaje(m: any) {
  const r = m.reply_to_message?.message_id;
  if (!r) return;
  const { data } = await sb.from("lead_check").select("*").eq("chat_id", Number(m.chat.id)).or(`message_id.eq.${r},espera_msg.eq.${r}`).limit(1);
  const l = (data ?? [])[0] as Lead | undefined;
  if (!l) return;
  const ids = await tgIds();
  if (![...(ids[l.vendedor] ?? []), ...await admins()].includes(Number(m.from?.id))) return;
  const por = m.from?.first_name ?? NOMBRE[l.vendedor] ?? "Telegram";
  const txt = String(m.text ?? "").trim();
  if (!txt) return;
  const p = await prosp(l.prospeccion_id);

  if (l.espera === "fecha" && l.espera_msg === r) {
    const f = parseFecha(txt);
    if (!f) { await enviar(m.chat.id, "No entendí la fecha 🙏 Mandámela así: 3/10", { reply_to_message_id: m.message_id }); return; }
    const enFicha = await anotar(l, p, por, `visita el ${f.slice(8, 10)}/${f.slice(5, 7)}`, {}, { proxima_agenda_fecha: f, proximo_paso: "Visita comercial (lead Meta)" });
    const seg = new Date(`${f}T23:00:00Z`).getTime(); // 20 h ART del día de la visita
    await sb.from("lead_check").update({ fecha_visita: f, seguimiento_at: iso(seg), espera: null, espera_msg: null }).eq("id", l.id);
    await enviar(m.chat.id, `📅 Anotado: visita a <b>${esc(p.nombre)}</b> el ${f.slice(8, 10)}/${f.slice(5, 7)}${enFicha ? " (en su agenda de la Suite)" : ""}. Ese día a la noche te pregunto cómo te fue.`, { reply_to_message_id: m.message_id });
    return;
  }
  const enFicha = await anotar(l, p, por, txt);
  await tg("setMessageReaction", { chat_id: m.chat.id, message_id: m.message_id, reaction: [{ type: "emoji", emoji: "✍" }] });
  if (!enFicha) await enviar(m.chat.id, `📝 Anotado en la cola de ${esc(p.nombre)}.`, { reply_to_message_id: m.message_id });
}

// ---------- responder a un cliente (vía at-responder) ----------
async function responder(b: { conversacion_id?: string; texto?: string; agente?: string }) {
  const r = await fetch(`${SUPABASE_URL}/functions/v1/at-responder`, {
    method: "POST",
    headers: { "content-type": "application/json", Authorization: `Bearer ${SERVICE_KEY}` },
    body: JSON.stringify({ conversacion_id: b.conversacion_id, texto: b.texto, agente: b.agente }),
  });
  return { status: r.status, ...(await r.json().catch(() => ({}))) };
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const auth = req.headers.get("authorization") ?? "";
  const cronKey = req.headers.get("x-cron-key");
  const okAuth = auth === `Bearer ${SERVICE_KEY}` || (cronKey && cronKey === await cfg("cron_key"));
  if (!okAuth) return new Response("unauthorized", { status: 401 });
  try {
    const tarea = url.searchParams.get("tarea");
    let out: unknown = { ok: true };
    if (tarea === "tick") out = await tareaTick(url.searchParams.get("forzar") === "1");
    else if (tarea === "estado") out = await tareaEstado();
    else if (tarea === "responder") out = await responder(await req.json().catch(() => ({})));
    else {
      const body = await req.json().catch(() => ({}));
      const u = body.update ?? body;
      if (u.callback_query) await manejarCallback(u.callback_query);
      else if (u.message) await manejarMensaje(u.message);
    }
    return new Response(JSON.stringify(out), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: String((e as Error).message ?? e) }), { status: 500 });
  }
});
