import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// ojo-conteo — conteo cíclico de depósito por Telegram (bot Ojo) + alertas de stock.
//   ?tarea=enviar   (cron L-V 9:30 ART) vence lo de ayer sin responder y manda los N artículos del día.
//   ?tarea=recordar (cron 15:00 ART)    si quedan sin responder, lo recuerda sobre el mismo mensaje.
//   ?tarea=resumen  (cron 18:30 ART)    resumen del día a los admins (ok / ajustados / sin respuesta).
//   ?tarea=alertas  (cron cada 10 min)  cambios manuales de stock (Gestión de Stock / carga masiva) a los admins.
//   POST {update}   ojo-telegram le reenvía los botones cnt:* y las respuestas al conteo.
// Depósito toca ✅ (coincide) o ✏️ y dice cuántos hay: la Suite ajusta sola (stock_conteo_responder).
// El esperado = libre + lo separado en pedidos no despachados (vista stock_reservado_deposito).
// v4 (2026-09-23): también atiende los botones "Derivar a…" (drv:*) de los avisos de ojo-avisos.
// v5 (2026-09-23): y el "📥 Pasarlo a precarga" (prc:<acceso>) del aviso de carrito sin confirmar.
// v7 (2026-09-30): los botones lck:* (checklist de leads) van a ojo-leads.
// v8 (2026-09-30): y las respuestas con texto a esas tarjetas también.
// v9 (2026-09-30): botones tj:* y respuestas a tarjetas de ojo-tarjetas (derivación, carrito, agenda, pedido, reunión).
// v10 (2026-10-01): check-in de visitas → ojo-checkin: fotos sin texto, ubicaciones, botones ck:* y la respuesta con el nombre.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TG = `https://api.telegram.org/bot${Deno.env.get("TELEGRAM_BOT_TOKEN")!}`;
const GRUPO_FALLBACK = -5504692394;
const sb = createClient(SUPABASE_URL, SERVICE_KEY);

const hoyAR = () => new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);

async function cfg(clave: string): Promise<string | null> {
  const { data } = await sb.from("app_config").select("valor").eq("clave", clave).maybeSingle();
  return data?.valor ?? null;
}
async function responsables(): Promise<number[]> {
  return String(await cfg("conteo_responsables") ?? "").split(/[,\s]+/).filter(Boolean).map(Number);
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
const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const signo = (n: number) => (n > 0 ? `+${n}` : String(n));

type Conteo = {
  id: number; fecha: string; orden: number; codigo: string; modelo: string; descripcion: string;
  sistema: number; reservado: number; esperado: number; contado: number | null; diferencia: number | null;
  estado: string; telegram_chat_id: number; telegram_message_id: number; pregunta_message_id: number | null;
};

function linea(c: Conteo): string {
  const art = `<b>${esc(c.modelo)}</b> ${esc(c.descripcion)}`;
  if (c.estado === "ok") return `${c.orden}. ✅ ${art} — ${c.contado}`;
  if (c.estado === "ajustado") return `${c.orden}. ✏️ ${art} — contó <b>${c.contado}</b> (sistema ${(c.contado ?? 0) - (c.diferencia ?? 0)}, ${signo(c.diferencia ?? 0)}) · ajustado`;
  if (c.estado === "vencido") return `${c.orden}. ⌛ ${art} — sin respuesta`;
  const det = c.reservado > 0 ? ` (${c.sistema} libres + ${c.reservado} separados)` : "";
  const esp = c.estado === "esperando_cantidad" ? " · ✏️ esperando el número" : "";
  return `${c.orden}. ${art}\n    <code>${esc(c.codigo)}</code> → deberían haber <b>${c.esperado}</b>${det}${esp}`;
}

function texto(lista: Conteo[]): string {
  const f = new Date(lista[0].fecha + "T12:00:00Z").toLocaleDateString("es-AR", { weekday: "long", day: "2-digit", month: "2-digit", timeZone: "UTC" });
  const faltan = lista.filter((c) => c.estado === "pendiente" || c.estado === "esperando_cantidad").length;
  const pie = faltan
    ? "\nContá <b>todo lo físico</b>, incluido lo separado para pedidos sin despachar.\nTocá ✅ si coincide o ✏️ para decirme cuántos hay (o escribí «3 = 70»)."
    : "\n✔️ Conteo del día terminado. Gracias!";
  return `📦 <b>Conteo de depósito</b> — ${f}\n\n${lista.map(linea).join("\n")}\n${pie}`;
}

function teclado(lista: Conteo[]) {
  const btns: { text: string; callback_data: string }[][] = [];
  let fila: { text: string; callback_data: string }[] = [];
  for (const c of lista) {
    if (c.estado !== "pendiente" && c.estado !== "esperando_cantidad") continue;
    fila.push({ text: `${c.orden} ✅`, callback_data: `cnt:ok:${c.id}` }, { text: `${c.orden} ✏️`, callback_data: `cnt:ed:${c.id}` });
    if (fila.length === 4) { btns.push(fila); fila = []; }
  }
  if (fila.length) btns.push(fila);
  return { inline_keyboard: btns };
}

async function listaDe(chatId: number, messageId: number): Promise<Conteo[]> {
  const { data } = await sb.from("stock_conteos").select("*").eq("telegram_chat_id", chatId).eq("telegram_message_id", messageId).order("orden");
  return (data ?? []) as Conteo[];
}

async function refrescar(chatId: number, messageId: number) {
  const lista = await listaDe(chatId, messageId);
  if (!lista.length) return;
  await tg("editMessageText", { chat_id: chatId, message_id: messageId, text: texto(lista), parse_mode: "HTML", reply_markup: teclado(lista) });
}

// ---------- tareas programadas ----------

// modelo = conteo puntual de un modelo entero (todos sus colores, aunque figuren en 0).
async function tareaEnviar(forzar = false, modelo: string | null = null) {
  const hoy = hoyAR();
  const { count } = await sb.from("stock_conteos").select("id", { count: "exact", head: true }).eq("fecha", hoy);
  if ((count ?? 0) > 0 && !forzar && !modelo) return { ya_enviado: true };
  await sb.from("stock_conteos").update({ estado: "vencido" }).lt("fecha", hoy).in("estado", ["pendiente", "esperando_cantidad"]);

  let elegidos: any[] = [];
  if (modelo) {
    const { data: st } = await sb.from("stock").select("codigo, modelo, descripcion, cantidad").ilike("modelo", modelo).order("descripcion");
    const { data: res } = await sb.from("stock_reservado_deposito").select("codigo, reservado").in("codigo", (st ?? []).map((s) => s.codigo));
    const r = new Map((res ?? []).map((x) => [x.codigo, x.reservado]));
    elegidos = (st ?? []).map((s) => ({ ...s, sistema: s.cantidad ?? 0, reservado: r.get(s.codigo) ?? 0 }));
  } else {
    const n = Number(await cfg("conteo_por_dia") ?? 10);
    const { data, error } = await sb.rpc("stock_conteo_elegir", { p_n: n });
    if (error) throw error;
    elegidos = data ?? [];
  }
  if (!elegidos.length) return { enviados: 0 };

  const filas = elegidos.map((e: any, i: number) => ({
    fecha: hoy, orden: i + 1, codigo: e.codigo, modelo: e.modelo, descripcion: e.descripcion,
    sistema: e.sistema, reservado: e.reservado, esperado: e.sistema + e.reservado,
  }));
  const { data: ins, error: e2 } = await sb.from("stock_conteos").insert(filas).select();
  if (e2) throw e2;
  const lista = (ins as Conteo[]).sort((a, b) => a.orden - b.orden);

  // Primero por privado a Depósito; si nunca abrió el bot, al grupo mencionándolo.
  const [resp] = await responsables();
  let chatId = resp;
  let d = await enviar(chatId, texto(lista), { reply_markup: teclado(lista) });
  if (!d?.ok) {
    const { data: dep } = await sb.rpc("ojo_chat_tema", { p_tema: "deposito" }); // grupo de Depósito (o el general)
    chatId = Number(dep) || GRUPO_FALLBACK;
    const menc = resp ? `<a href="tg://user?id=${resp}">Depósito</a>, ` : "";
    d = await enviar(chatId, `${menc}${texto(lista)}`, { reply_markup: teclado(lista) });
  }
  if (!d?.ok) throw new Error("no se pudo mandar el conteo");
  await sb.from("stock_conteos").update({ telegram_chat_id: chatId, telegram_message_id: d.result.message_id }).in("id", lista.map((c) => c.id));
  return { enviados: lista.length, chat: chatId === resp ? "privado" : "grupo" };
}

async function tareaRecordar() {
  const { data } = await sb.from("stock_conteos").select("*").eq("fecha", hoyAR()).in("estado", ["pendiente", "esperando_cantidad"]);
  const lista = (data ?? []) as Conteo[];
  if (!lista.length) return { faltan: 0 };
  const { telegram_chat_id: chat, telegram_message_id: msg } = lista[0];
  await enviar(chat, `⏰ Faltan <b>${lista.length}</b> artículos del conteo de hoy (${lista.map((c) => c.orden).join(", ")}).`, { reply_to_message_id: msg });
  return { faltan: lista.length };
}

async function tareaResumen() {
  const hoy = hoyAR();
  const { data } = await sb.from("stock_conteos").select("*").eq("fecha", hoy).order("orden");
  const lista = (data ?? []) as Conteo[];
  const desde = `${hoy}T03:00:00Z`;
  const { data: man } = await sb.from("stock_movimientos").select("codigo, delta, origen, usuario").in("origen", ["manual", "carga_masiva"]).gte("creado_en", desde);
  if (!lista.length && !man?.length) return { nada: true };

  const ok = lista.filter((c) => c.estado === "ok");
  const aj = lista.filter((c) => c.estado === "ajustado");
  const sin = lista.filter((c) => c.estado === "pendiente" || c.estado === "esperando_cantidad");
  const unidades = aj.reduce((s, c) => s + (c.diferencia ?? 0), 0);
  let t = `📦 <b>Conteo de depósito — resumen del día</b>\n`;
  if (lista.length) {
    t += `\n✅ Coinciden: ${ok.length} · ✏️ Ajustados: ${aj.length} · ⌛ Sin responder: ${sin.length}`;
    if (aj.length) {
      t += `\n\n<b>Ajustes</b> (neto ${signo(unidades)} u.):\n` + aj.map((c) =>
        `• ${esc(c.modelo)} ${esc(c.descripcion)}: sistema ${c.esperado} → contó ${c.contado} (<b>${signo(c.diferencia ?? 0)}</b>)`).join("\n");
    }
    if (sin.length) t += `\n\n<b>Sin responder</b> (pasan a mañana): ` + sin.map((c) => `${esc(c.modelo)} ${esc(c.descripcion)}`).join(" · ");
  }
  if (man?.length) {
    const porUsuario: Record<string, number> = {};
    for (const m of man) porUsuario[`${m.usuario} (${m.origen === "manual" ? "a mano" : "carga masiva"})`] = (porUsuario[`${m.usuario} (${m.origen === "manual" ? "a mano" : "carga masiva"})`] ?? 0) + 1;
    t += `\n\n<b>Cambios manuales de stock hoy</b>: ` + Object.entries(porUsuario).map(([u, n]) => `${esc(u)} ${n}`).join(" · ");
  }
  for (const a of await admins()) await enviar(a, t);
  return { ok: ok.length, ajustados: aj.length, sin: sin.length };
}

async function tareaAlertas() {
  const { data } = await sb.from("stock_movimientos").select("id, codigo, antes, despues, delta, origen, usuario, ref, creado_en")
    .eq("alertado", false).order("id").limit(500);
  const movs = data ?? [];
  if (!movs.length) return { alertas: 0 };
  const cods = [...new Set(movs.map((m) => m.codigo))];
  const { data: st } = await sb.from("stock").select("codigo, modelo, descripcion").in("codigo", cods);
  const nom = new Map((st ?? []).map((s) => [s.codigo, `${s.modelo} ${s.descripcion ?? ""}`.trim()]));

  const grupos: Record<string, typeof movs> = {};
  for (const m of movs) (grupos[`${m.origen}|${m.usuario}`] ??= []).push(m);
  const textos: string[] = [];
  for (const [k, ms] of Object.entries(grupos)) {
    const [origen, usuario] = k.split("|");
    if (origen === "carga_masiva") {
      const neto = ms.reduce((s, m) => s + (m.delta ?? 0), 0);
      const grandes = [...ms].sort((a, b) => Math.abs(b.delta ?? 0) - Math.abs(a.delta ?? 0)).slice(0, 8);
      textos.push(`⚠️ <b>Carga masiva de stock</b> — ${esc(usuario)}\n${ms.length} artículos cambiados, neto ${signo(neto)} u.\nLos más grandes:\n` +
        grandes.map((m) => `• ${esc(nom.get(m.codigo) ?? m.codigo)}: ${m.antes ?? "—"} → ${m.despues ?? "—"} (${signo(m.delta ?? 0)})`).join("\n"));
    } else {
      textos.push(`⚠️ <b>Cambio manual de stock</b> — ${esc(usuario)}\n` +
        ms.slice(0, 15).map((m) => `• ${esc(nom.get(m.codigo) ?? m.codigo)}: ${m.antes ?? "—"} → ${m.despues ?? "—"} (${signo(m.delta ?? 0)})${m.ref ? ` · ${esc(m.ref)}` : ""}`).join("\n") +
        (ms.length > 15 ? `\n… y ${ms.length - 15} más` : ""));
    }
  }
  const ad = await admins();
  for (const t of textos) for (const a of ad) await enviar(a, t);
  await sb.from("stock_movimientos").update({ alertado: true }).in("id", movs.map((m) => m.id));
  return { alertas: movs.length };
}

// ---------- respuestas de Depósito ----------

async function asentar(c: Conteo, contado: number | null, por: string, chatId: number, replyTo?: number) {
  const { data, error } = await sb.rpc("stock_conteo_responder", { p_id: c.id, p_contado: contado, p_por: por });
  if (error) { await enviar(chatId, `No pude asentar el ${c.orden}: ${esc(error.message)}`); return; }
  if (c.telegram_message_id) await refrescar(c.telegram_chat_id, c.telegram_message_id);
  if (data?.ya) { await enviar(chatId, `El ${c.orden} ya estaba asentado (${data.contado}).`, replyTo ? { reply_to_message_id: replyTo } : {}); return; }
  if (data?.estado === "ajustado") {
    await enviar(chatId, `✏️ Listo: <b>${esc(c.modelo)} ${esc(c.descripcion)}</b> de ${data.esperado} a ${data.contado} (${signo(data.diferencia)}). Ajustado en la Suite.`, replyTo ? { reply_to_message_id: replyTo } : {});
  } else if (contado !== null) {
    await enviar(chatId, `✅ ${esc(c.modelo)}: coincide (${data.esperado}). Asentado.`, replyTo ? { reply_to_message_id: replyTo } : {});
  }
}

async function manejarCallback(cq: any) {
  const [, accion, idStr] = String(cq.data).split(":");
  const quien = Number(cq.from?.id);
  const permitidos = [...await responsables(), ...await admins()];
  if (!permitidos.includes(quien)) {
    await tg("answerCallbackQuery", { callback_query_id: cq.id, text: "Esto lo responde Depósito 🙂", show_alert: false });
    return;
  }
  const { data } = await sb.from("stock_conteos").select("*").eq("id", Number(idStr)).maybeSingle();
  const c = data as Conteo | null;
  if (!c) { await tg("answerCallbackQuery", { callback_query_id: cq.id, text: "No lo encuentro" }); return; }
  if (c.estado === "ok" || c.estado === "ajustado") {
    await tg("answerCallbackQuery", { callback_query_id: cq.id, text: `Ya estaba asentado (${c.contado})` });
    return;
  }
  const por = cq.from?.first_name ?? "Depósito";
  if (accion === "ok") {
    await tg("answerCallbackQuery", { callback_query_id: cq.id, text: `✅ ${c.orden} asentado` });
    await asentar(c, null, por, cq.message.chat.id);
    return;
  }
  // ✏️ pide el número con respuesta forzada
  await tg("answerCallbackQuery", { callback_query_id: cq.id });
  const d = await enviar(cq.message.chat.id,
    `✏️ <b>${c.orden}. ${esc(c.modelo)} ${esc(c.descripcion)}</b>\nEl sistema dice ${c.esperado}. ¿Cuántos contaste en total? Respondé este mensaje con el número.`,
    { reply_markup: { force_reply: true, selective: true, input_field_placeholder: "cantidad contada" }, reply_to_message_id: cq.message.message_id });
  if (d?.ok) {
    await sb.from("stock_conteos").update({ estado: "esperando_cantidad", pregunta_message_id: d.result.message_id }).eq("id", c.id);
    await refrescar(c.telegram_chat_id, c.telegram_message_id);
  }
}

async function manejarMensaje(m: any) {
  const chatId = Number(m.chat.id);
  const quien = Number(m.from?.id);
  const txt = String(m.text ?? "").trim();
  const por = m.from?.first_name ?? "Depósito";
  const resp = await responsables();
  const permitidos = [...resp, ...await admins()];

  if (/^\/start/.test(txt)) {
    await enviar(chatId, resp.includes(quien)
      ? "Hola 👋 Todos los días hábiles a las 9:30 te mando acá los artículos para contar. Tocá ✅ si coincide o ✏️ y me decís cuántos hay."
      : "Hola 👋");
    return;
  }
  if (!permitidos.includes(quien)) return;

  const replyId = m.reply_to_message?.message_id;
  // 1) respuesta a la pregunta "¿cuántos contaste?"
  if (replyId) {
    const { data: preg } = await sb.from("stock_conteos").select("*").eq("telegram_chat_id", chatId).eq("pregunta_message_id", replyId).maybeSingle();
    if (preg) {
      const n = txt.match(/-?\d+/);
      if (!n) { await enviar(chatId, "Mandame solo el número que contaste 🙏", { reply_to_message_id: m.message_id }); return; }
      await asentar(preg as Conteo, Number(n[0]), por, chatId, m.message_id);
      return;
    }
  }
  // 2) «3 = 70» (respondiendo la lista o en el privado)
  const par = txt.match(/^(\d{1,2})\s*[=:\-]\s*(\d+)$|^(\d{1,2})\s+(\d+)$/);
  let lista: Conteo[] = [];
  if (replyId) lista = await listaDe(chatId, replyId);
  if (!lista.length) {
    const { data } = await sb.from("stock_conteos").select("*").eq("telegram_chat_id", chatId).eq("fecha", hoyAR()).order("orden");
    lista = (data ?? []) as Conteo[];
  }
  if (par && lista.length) {
    const orden = Number(par[1] ?? par[3]);
    const cant = Number(par[2] ?? par[4]);
    const c = lista.find((x) => x.orden === orden);
    if (!c) { await enviar(chatId, `No hay artículo ${orden} en el conteo.`); return; }
    await asentar(c, cant, por, chatId, m.message_id);
    return;
  }
  // 3) solo un número y hay uno solo esperando
  const solo = txt.match(/^-?\d+$/);
  const esperando = lista.filter((c) => c.estado === "esperando_cantidad");
  if (solo && esperando.length === 1) { await asentar(esperando[0], Number(txt), por, chatId, m.message_id); return; }
  if (solo && esperando.length > 1) { await enviar(chatId, "Tengo varios esperando número: respondé el mensaje de cada uno, o escribí «3 = 70»."); return; }
  if (chatId > 0 && resp.includes(quien)) {
    await enviar(chatId, "Para el conteo: tocá ✅ / ✏️ en la lista, o escribí «número de artículo = cantidad» (ej: 3 = 70).");
  }
}

// ---------- botones "Derivar a…" (v4) ----------
// ojo-avisos pone drv:<cod_cliente>:<vendedor|yo> en los avisos del catálogo que le tocan a
// Corporativo/Gastón. Solo admins. Deriva como si el admin escribiera "/derivar <cod> a <vendedor>"
// (la ficha la arma ojo-telegram) y el aviso queda sin botones.
async function manejarDerivar(cq: any) {
  const [, cod, destino] = String(cq.data).split(":");
  const chat = cq.message?.chat;
  const msgId = cq.message?.message_id;
  if (!(await admins()).includes(Number(cq.from?.id))) {
    await tg("answerCallbackQuery", { callback_query_id: cq.id, text: "Esto lo decide Gastón 🙂" });
    return;
  }
  await tg("editMessageReplyMarkup", { chat_id: chat.id, message_id: msgId, reply_markup: { inline_keyboard: [] } });
  if (destino === "yo") {
    await tg("answerCallbackQuery", { callback_query_id: cq.id, text: "👍 Queda con vos" });
    await enviar(chat.id, `✋ Lo sigue ${esc(cq.from?.first_name ?? "Gastón")}.`, { reply_to_message_id: msgId });
    return;
  }
  await tg("answerCallbackQuery", { callback_query_id: cq.id, text: `➡️ Derivando a ${destino}…` });
  const update = {
    update_id: 0,
    message: { message_id: msgId, date: Math.floor(Date.now() / 1000), chat, from: cq.from, text: `/derivar ${cod} a ${destino}` },
  };
  const r = await fetch(`${SUPABASE_URL}/functions/v1/ojo-telegram`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(TG_SECRET ? { "x-telegram-bot-api-secret-token": TG_SECRET } : {}) },
    body: JSON.stringify(update),
  });
  if (!r.ok) console.error("derivar", r.status, await r.text());
}

// ---------- botón "Pasarlo a precarga" (v5) ----------
// Cualquiera del grupo puede tocarlo (crea una precarga pendiente, que se descarta en la Suite si no va).
async function manejarPrecarga(cq: any) {
  const acceso = String(cq.data).slice(4);
  const chat = cq.message?.chat;
  const msgId = cq.message?.message_id;
  const por = cq.from?.first_name ?? "Telegram";
  const { data, error } = await sb.rpc("ojo_carrito_a_precarga", { p_codigo: acceso, p_por: por });
  if (error) {
    await tg("answerCallbackQuery", { callback_query_id: cq.id, text: "No pude pasarlo, avisale a Gastón" });
    console.error("precarga", JSON.stringify(error));
    return;
  }
  const r = data as { ok: boolean; error?: string; precarga_id?: number; total_units?: number; vendedor?: string; recorte?: string };
  if (!r.ok) {
    await tg("answerCallbackQuery", { callback_query_id: cq.id, text: r.error ?? "No se pudo", show_alert: true });
    return;
  }
  await tg("answerCallbackQuery", { callback_query_id: cq.id, text: `📥 Precarga #${r.precarga_id}` });
  // saca solo el botón de precarga; los de derivar quedan
  const filas = (cq.message?.reply_markup?.inline_keyboard ?? []).filter((f: any[]) => !f.some((b) => String(b.callback_data ?? "").startsWith("prc:")));
  await tg("editMessageReplyMarkup", { chat_id: chat.id, message_id: msgId, reply_markup: { inline_keyboard: filas } });
  await enviar(chat.id,
    `📥 <b>Precarga #${r.precarga_id}</b> (${r.total_units} u.) — la pasó ${esc(por)}.\n` +
    (r.recorte ? `⚠️ Sin stock, quedó afuera: ${esc(r.recorte)}\n` : "") +
    `👉 ${esc(r.vendedor ?? "Vendedor")}: confirmalo con el cliente y cerralo en la Suite → Nuevo pedido.`,
    { reply_to_message_id: msgId });
}

// ---------- puerta del webhook de Telegram ----------
// El webhook de Ojo apunta acá: lo del conteo se atiende en esta función y todo lo demás
// pasa sin tocar a ojo-telegram (mismo body, mismo secreto).
const TG_SECRET = Deno.env.get("TELEGRAM_WEBHOOK_SECRET") ?? "";

async function esDeConteo(u: any): Promise<boolean> {
  if (String(u?.callback_query?.data ?? "").startsWith("cnt:")) return true;
  const m = u?.message;
  if (!m?.text) return false;
  if (m.chat?.type === "private" && (await responsables()).includes(Number(m.from?.id))) return true;
  const r = m.reply_to_message?.message_id;
  if (!r) return false;
  const { data } = await sb.from("stock_conteos").select("id")
    .eq("telegram_chat_id", m.chat.id).or(`pregunta_message_id.eq.${r},telegram_message_id.eq.${r}`).limit(1);
  return !!data?.length;
}

// Respuesta con texto a una tarjeta de lead (o a la pregunta de la fecha de visita) → ojo-leads.
async function esDeLead(u: any): Promise<boolean> {
  const m = u?.message;
  const r = m?.reply_to_message?.message_id;
  if (!m?.text || !r || !m.reply_to_message?.from?.is_bot) return false;
  const { data } = await sb.from("lead_check").select("id").eq("chat_id", m.chat.id).or(`message_id.eq.${r},espera_msg.eq.${r}`).limit(1);
  return !!data?.length;
}

// Respuesta con texto a una tarjeta de ojo-tarjetas (derivación, carrito, agenda, pedido, reunión).
async function esDeTarjeta(u: any): Promise<boolean> {
  const m = u?.message;
  const r = m?.reply_to_message?.message_id;
  if (!m?.text || !r || !m.reply_to_message?.from?.is_bot) return false;
  const { data } = await sb.from("ojo_tarjeta").select("id").eq("chat_id", m.chat.id).eq("message_id", r).limit(1);
  return !!data?.length;
}

// Ojo por tema (2026-09-30) → ojo-grupos: alta de un grupo de tema, cambio de id (supergrupo), /start por
// privado del equipo y el puente entre grupos («Ojo, preguntale a Depósito…» y la respuesta a esa pregunta).
async function esDeGrupos(u: any): Promise<boolean> {
  const cm = u?.my_chat_member;
  if (cm) return ["group", "supergroup"].includes(cm.chat?.type) && ["member", "administrator"].includes(cm.new_chat_member?.status);
  const m = u?.message;
  if (!m) return false;
  if (m.migrate_to_chat_id) return true;
  if (m.chat?.type === "private") return /^\/start\b/.test(m.text ?? "");
  if (!m.text) return false;
  if (/^\/tema\b/i.test(m.text) || /^\s*@?\w*ojo\w*\b[\s,:]*(pregunt|consult|pas[aá]|avis|dec[ií])/i.test(m.text)) return true;
  const r = m.reply_to_message?.message_id;
  if (!r || !m.reply_to_message?.from?.is_bot) return false;
  const { data } = await sb.from("ojo_puente").select("id").eq("destino_chat", m.chat.id).eq("destino_msg", r).limit(1);
  return !!data?.length;
}

// Check-in de visitas (2026-10-01) → ojo-checkin: una FOTO sin texto (o con un texto que no pide
// cargar nada), una UBICACIÓN compartida, los botones ck:* y la respuesta con el nombre de la óptica.
async function esDeCheckin(u: any): Promise<boolean> {
  if (String(u?.callback_query?.data ?? "").startsWith("ck:")) return true;
  const m = u?.message;
  if (!m) return false;
  if (m.location) return true;
  // foto comprimida, o foto mandada como archivo (conserva el GPS del EXIF; 2026-10-05)
  if ((Array.isArray(m.photo) && m.photo.length) || /^image\//.test(m.document?.mime_type ?? "")) {
    const cap = String(m.caption ?? "").trim();
    // con texto que pide una carga ("ojo cargame este pedido") sigue el circuito de ojo-telegram
    return !cap || !/pedido|carg|devoluci|anot|registr|cobr|pag[oó]/i.test(cap) || /vidriera|check|visita|estoy en|llegu/i.test(cap);
  }
  const r = m.reply_to_message?.message_id;
  if (!m.text || !r || !m.reply_to_message?.from?.is_bot) return false;
  const { data } = await sb.from("visitas_checkin").select("id").eq("telegram_chat_id", m.chat.id).eq("aviso_message_id", r).eq("estado", "esperando_nombre").limit(1);
  return !!data?.length;
}

async function puertaTelegram(req: Request): Promise<Response> {
  const raw = await req.text();
  let u: any = {};
  try { u = JSON.parse(raw); } catch { /* se reenvía igual */ }
  try {
    if (await esDeGrupos(u)) {
      const r = await fetch(`${SUPABASE_URL}/functions/v1/ojo-grupos`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}` },
        body: JSON.stringify({ update: u }),
      });
      const j = await r.json().catch(() => ({}));
      if (j?.manejado) return new Response("ok");
    }
  } catch (e) { console.error("ojo-grupos", e); }
  try {
    if (await esDeCheckin(u)) {
      const r = await fetch(`${SUPABASE_URL}/functions/v1/ojo-checkin`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}` },
        body: JSON.stringify({ update: u }),
      });
      if (!r.ok) console.error("ojo-checkin", r.status, await r.text());
      return new Response("ok");
    }
  } catch (e) { console.error("ojo-checkin", e); }
  if (String(u?.callback_query?.data ?? "").startsWith("tj:") || (await esDeTarjeta(u))) {
    try {
      const r = await fetch(`${SUPABASE_URL}/functions/v1/ojo-tarjetas`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}` },
        body: JSON.stringify({ update: u }),
      });
      if (!r.ok) console.error("ojo-tarjetas", r.status, await r.text());
    } catch (e) { console.error("ojo-tarjetas", e); }
    return new Response("ok");
  }
  if (String(u?.callback_query?.data ?? "").startsWith("lck:") || (await esDeLead(u))) {
    try {
      const r = await fetch(`${SUPABASE_URL}/functions/v1/ojo-leads`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}` },
        body: JSON.stringify({ update: u }),
      });
      if (!r.ok) console.error("ojo-leads", r.status, await r.text());
    } catch (e) { console.error("ojo-leads", e); }
    return new Response("ok");
  }
  if (String(u?.callback_query?.data ?? "").startsWith("prc:")) {
    try { await manejarPrecarga(u.callback_query); } catch (e) { console.error("precarga", e); }
    return new Response("ok");
  }
  if (String(u?.callback_query?.data ?? "").startsWith("drv:")) {
    try { await manejarDerivar(u.callback_query); } catch (e) { console.error("derivar", e); }
    return new Response("ok");
  }
  try {
    if (await esDeConteo(u)) {
      if (u.callback_query) await manejarCallback(u.callback_query);
      else await manejarMensaje(u.message);
      return new Response("ok");
    }
  } catch (e) {
    console.error("conteo", e);
    if (String(u?.callback_query?.data ?? "").startsWith("cnt:")) return new Response("ok");
  }
  const r = await fetch(`${SUPABASE_URL}/functions/v1/ojo-telegram`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(TG_SECRET ? { "x-telegram-bot-api-secret-token": TG_SECRET } : {}) },
    body: raw,
  });
  return new Response(await r.text(), { status: r.status });
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  if (req.headers.has("x-telegram-bot-api-secret-token") || url.searchParams.get("tg") === "1") {
    if (TG_SECRET && req.headers.get("x-telegram-bot-api-secret-token") !== TG_SECRET) return new Response("unauthorized", { status: 401 });
    return await puertaTelegram(req);
  }
  const auth = req.headers.get("authorization") ?? "";
  const cronKey = req.headers.get("x-cron-key");
  const okAuth = auth === `Bearer ${SERVICE_KEY}` || (cronKey && cronKey === await cfg("cron_key"));
  if (!okAuth) return new Response("unauthorized", { status: 401 });
  try {
    const tarea = url.searchParams.get("tarea");
    let out: unknown = { ok: true };
    if (tarea === "enviar") out = await tareaEnviar(url.searchParams.get("forzar") === "1", url.searchParams.get("modelo"));
    else if (tarea === "recordar") out = await tareaRecordar();
    else if (tarea === "resumen") out = await tareaResumen();
    else if (tarea === "alertas") out = await tareaAlertas();
    else if (tarea === "webhook") {
      // Los botones necesitan callback_query en allowed_updates del webhook de Ojo.
      const info = (await tg("getWebhookInfo", {}))?.result ?? {};
      const permitidos: string[] | undefined = info.allowed_updates;
      // ?apuntar=conteo -> webhook a esta función (puerta) · ?apuntar=ojo -> vuelve directo a ojo-telegram
      const destino = url.searchParams.get("apuntar");
      let cambiado: unknown = false;
      if (destino === "conteo" || destino === "ojo") {
        const nueva = `${SUPABASE_URL}/functions/v1/${destino === "conteo" ? "ojo-conteo?tg=1" : "ojo-telegram"}`;
        cambiado = (await tg("setWebhook", { url: nueva, ...(permitidos?.length ? { allowed_updates: permitidos } : {}), ...(TG_SECRET ? { secret_token: TG_SECRET } : {}) }))?.ok ? nueva : "error";
      }
      out = { url: String(info.url ?? "").replace(/\?.*/, "") + (String(info.url ?? "").includes("?") ? "?…" : ""), allowed_updates: permitidos ?? "todos (default)", pendientes: info.pending_update_count, ultimo_error: info.last_error_message ?? null, cambiado };
    }
    else {
      const body = await req.json().catch(() => ({}));
      const u = body.update ?? {};
      if (u.callback_query) await manejarCallback(u.callback_query);
      else if (u.message) await manejarMensaje(u.message);
    }
    return new Response(JSON.stringify(out), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: String((e as Error).message ?? e) }), { status: 500 });
  }
});
