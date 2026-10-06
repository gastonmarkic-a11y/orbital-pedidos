// campana-ascari — lanzamiento ASCARI (2026-10-06, Gastón) a quienes abrieron el catálogo en los
// últimos 30 días, sobre el circuito de campañas (campana + campana_envio, proveedor wa_meta).
// Todas las tareas con x-cron-key.
//   POST ?tarea=subir&nombre=ascari-teaser.mp4  (body = bytes) sube un archivo a catalogo/campanas/ascari/
//   ?tarea=plantilla   da de alta en Meta la plantilla ascari_temporada (video arriba + texto + botón al catálogo)
//   ?tarea=estado      estado de la plantilla en Meta
//   ?tarea=cargar      crea la campaña y carga la lista (pendiente / baja / descartado sin WhatsApp)
//   ?tarea=prueba&a=549...  manda la plantilla a UN número (no toca la lista)
//   ?tarea=enviar&max=50    manda a los pendientes (solo con la plantilla APPROVED)
//   ?tarea=telegram&prueba=1  kit + listas por vendedor a Ventas y Prospección (prueba=1: no manda, muestra)
// En Telegram no se habla de plata.

import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const sb = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const WA_TOKEN = Deno.env.get("WHATSAPP_TOKEN") ?? "";
const TG = `https://api.telegram.org/bot${Deno.env.get("TELEGRAM_BOT_TOKEN")!}`;
const GV = "v21.0";
const PLANTILLA = "ascari_temporada";
const CAMPANA = "ASCARI · Temporada 2026 · abrieron el catálogo";
const BUCKET = "catalogo";
const CARPETA = "campanas/ascari";
const pub = (n: string) => `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${CARPETA}/${n}`;
const URL_BOTON = "https://ver.orbitaleyewear.com.ar/catalogo?ver=ascari&k=";

const CUERPO =
  "Hola {{1}} 👋 Vimos que estuviste mirando el catálogo y arranca la temporada, así que te mostramos el modelo que la va a marcar:\n\n" +
  "👓 *ASCARI*\nUn formato que hoy es ícono de la moda en el mundo, con una silueta protagonista, moderna y sofisticada: de esas que alguien se prueba frente al espejo y ya no se saca.\n\n" +
  "☀️ UV400: 100% UVA y UVB\n💻 Blue Cut: filtra el 98% de la luz azul de 420 nm\n🪶 Ultra liviano\n\n" +
  "🛡️ *¿Querés ir por más?* ASCARI también viene con cristales *Triple Protección*, que suman 🔥 filtrado infrarrojo. Única en el mercado.\n\n" +
  "🌙 *Y cuando baja el sol, ASCARI sigue.* Su luz cálida suaviza pantallas, LEDs y reflejos: descanso visual y un look de noche que nadie más tiene.\n\n" +
  "¿Te lo sumo al pedido para tenerlo en la vidriera desde el primer día de sol? ☀️";

// El mismo mensaje, para que el vendedor lo copie (Telegram, HTML).
const TEXTO_TG =
  "Hola 👋 Vimos que estuviste mirando el catálogo y arranca la temporada, así que te mostramos el modelo que la va a marcar:\n\n" +
  "👓 <b>ASCARI</b>\nUn formato que hoy es ícono de la moda en el mundo. Llega a Orbital con una silueta protagonista, moderna y sofisticada, de esas que alguien se prueba frente al espejo y ya no se saca.\n\n" +
  "Pero ASCARI no es solo diseño.\n\n" +
  "☀️ UV400: 100% UVA y UVB\n💻 BLUE CUT: filtra el 98% de la luz azul de 420 nm\n🪶 Ultra liviano: lo llevás todo el día y te olvidás de que lo tenés puesto\n\n" +
  "🛡️ <b>¿Querés ir por más? ÚNICA TRIPLE PROTECCIÓN</b>\nASCARI también viene con cristales Triple Protección, que suman 🔥 FILTRADO INFRARROJO para cuidar la piel delicada alrededor de los ojos. Una tecnología que no tiene nadie más en el mercado.\n\n" +
  "🌙 <b>Y cuando baja el sol, ASCARI sigue.</b>\nEl lente naranja es tendencia de noche en todo el mundo. Su luz cálida suaviza pantallas, LEDs y reflejos: menos encandilamiento, más descanso visual y un look de noche que nadie más tiene.\n\n" +
  "Diseño + protección + innovación, con lentes VSL™ HD Real.\n\n" +
  "¿Te lo sumo al pedido para tenerlo en la vidriera desde el primer día de sol? ☀️";

type Fila = { codigo: string; tipo: string; cod_cliente: string | null; nombre: string | null; vendedor: string; wa: string | null; ultima_visita: string; de_baja: boolean };

async function cfg(clave: string): Promise<string | null> {
  const { data } = await sb.from("app_config").select("valor").eq("clave", clave).maybeSingle();
  return data?.valor ?? null;
}
const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const graph = (path: string, init?: RequestInit) =>
  fetch(`https://graph.facebook.com/${GV}/${path}`, { ...init, headers: { Authorization: `Bearer ${WA_TOKEN}`, "Content-Type": "application/json", ...(init?.headers ?? {}) } })
    .then(async (r) => ({ ok: r.ok, status: r.status, d: await r.json().catch(() => null) }));
const phoneId = async () => Deno.env.get("WHATSAPP_PHONE_NUMBER_ID") || (await cfg("whatsapp_phone_number_id")) || "";
// Nombre para la lista del vendedor: sin códigos internos (123 - , TMP-xxx - , AG-ADR-0159 - ) ni prefijos de prospecto.
function nombreLista(n: string | null) {
  let s = (n ?? "").trim().replace(/^\d+\s*-\s*/, "").replace(/^[A-Z]{2,4}-[\w-]+\s*-\s*/, "");
  if (/^Prospecto IG/i.test(s)) { const p = s.split(" · "); s = p[p.length - 1]; } else s = s.replace(/^Prospecto · /, "");
  return s.replace(/\s*\(.*$/, "").trim();
}
// Nombre para el saludo del WhatsApp: si lo que cargaron no es un nombre ("no nunca trabaje con ustedes",
// "Contacto WhatsApp 11...", "Óptica" a secas) va un saludo genérico.
const NO_ES_NOMBRE = /(nunca|no hemos|no tengo|trabaj|todav|a[uú]n\b|contacto whatsapp|^comercio |^emprendimiento |^[oó]ptica$|^visi[oó]n$|\d{6,})/i;
function primerNombre(n: string | null) {
  const s = nombreLista(n);
  return !s || s.length > 40 || NO_ES_NOMBRE.test(s) ? "¿cómo estás?" : s;
}

// ── archivos ────────────────────────────────────────────────────────────────
async function subir(req: Request, nombre: string) {
  if (!/^[\w.-]+$/.test(nombre)) return { ok: false, error: "nombre" };
  const bytes = new Uint8Array(await req.arrayBuffer());
  const tipo = nombre.endsWith(".mp4") ? "video/mp4" : nombre.endsWith(".webp") ? "image/webp" : "image/jpeg";
  const { error } = await sb.storage.from(BUCKET).upload(`${CARPETA}/${nombre}`, bytes, { contentType: tipo, upsert: true });
  return error ? { ok: false, error: error.message } : { ok: true, url: pub(nombre), bytes: bytes.length };
}

// ── plantilla ───────────────────────────────────────────────────────────────
// Para una plantilla con video, Meta pide un ejemplo subido por la API de carga reanudable (header_handle).
async function plantilla() {
  const waba = await cfg("meta_waba_id");
  const app = await graph("app");
  const appId = app.d?.id;
  if (!appId) return { ok: false, paso: "app", respuesta: app.d };
  const video = new Uint8Array(await (await fetch(pub("ascari-teaser.mp4"))).arrayBuffer());
  const ses = await graph(`${appId}/uploads?file_length=${video.length}&file_type=video/mp4&file_name=ascari-teaser.mp4`, { method: "POST" });
  if (!ses.d?.id) return { ok: false, paso: "sesion", respuesta: ses.d };
  const up = await fetch(`https://graph.facebook.com/${GV}/${ses.d.id}`, {
    method: "POST", headers: { Authorization: `OAuth ${WA_TOKEN}`, file_offset: "0" }, body: video,
  }).then(async (r) => ({ ok: r.ok, d: await r.json().catch(() => null) }));
  if (!up.d?.h) return { ok: false, paso: "carga", respuesta: up.d };
  const r = await graph(`${waba}/message_templates`, {
    method: "POST",
    body: JSON.stringify({
      name: PLANTILLA, language: "es_AR", category: "MARKETING",
      components: [
        { type: "HEADER", format: "VIDEO", example: { header_handle: [up.d.h] } },
        { type: "BODY", text: CUERPO, example: { body_text: [["Óptica Ejemplo"]] } },
        { type: "FOOTER", text: "Orbital® Eyewear · Temporada 2026" },
        { type: "BUTTONS", buttons: [{ type: "URL", text: "Ver ASCARI en mi catálogo", url: URL_BOTON + "{{1}}", example: [URL_BOTON + "opticaej12345"] }] },
      ],
    }),
  });
  return { ok: r.ok, largo_cuerpo: CUERPO.length, respuesta: r.d };
}
async function estado() {
  const waba = await cfg("meta_waba_id");
  const r = await graph(`${waba}/message_templates?name=${PLANTILLA}&fields=name,status,rejected_reason,quality_score`);
  return r.d;
}

// ── lista ───────────────────────────────────────────────────────────────────
async function campanaId(crear: boolean): Promise<number | null> {
  const { data } = await sb.from("campana").select("id").eq("nombre", CAMPANA).maybeSingle();
  if (data?.id || !crear) return data?.id ?? null;
  const { data: n, error } = await sb.from("campana").insert({
    nombre: CAMPANA, canal: "whatsapp", proveedor: "wa_meta", estado: "borrador", plantilla: PLANTILLA, plantilla_lang: "es_AR", creada_por: "campana-ascari",
  }).select("id").single();
  if (error) throw new Error(error.message);
  return n.id;
}
async function lista(): Promise<Fila[]> {
  const { data, error } = await sb.rpc("campana_catalogo_abrieron", { p_dias: 30 });
  if (error) throw new Error(error.message);
  return (data ?? []) as Fila[];
}
async function cargar() {
  const id = await campanaId(true);
  const filas = await lista();
  const { data: ya } = await sb.from("campana_envio").select("cod_cliente, telefono").eq("campana_id", id);
  // campana_envio pide cod_cliente: el prospecto va como "prospecto:<su acceso>".
  const cod = (f: Fila) => f.cod_cliente ?? `prospecto:${f.codigo}`;
  const vistos = new Set((ya ?? []).map((e) => e.cod_cliente));
  const nuevos = filas.filter((f) => !vistos.has(cod(f))).map((f) => ({
    campana_id: id, cod_cliente: cod(f), nombre: f.nombre, telefono: f.wa, codigo_acceso: f.codigo, vendedor: f.vendedor,
    estado: f.de_baja ? "baja" : f.wa ? "pendiente" : "descartado", motivo: f.de_baja ? "dado de baja de WhatsApp" : f.wa ? null : "sin WhatsApp cargado",
  }));
  if (nuevos.length) { const { error } = await sb.from("campana_envio").insert(nuevos); if (error) throw new Error(error.message); }
  const cuenta: Record<string, number> = {};
  for (const n of nuevos) cuenta[n.estado] = (cuenta[n.estado] ?? 0) + 1;
  return { campana_id: id, cargados: nuevos.length, ...cuenta };
}

// ── WhatsApp ────────────────────────────────────────────────────────────────
async function mandar(to: string, nombre: string, codigo: string) {
  const r = await graph(`${await phoneId()}/messages`, {
    method: "POST",
    body: JSON.stringify({
      messaging_product: "whatsapp", to, type: "template",
      template: {
        name: PLANTILLA, language: { code: "es_AR" },
        components: [
          { type: "header", parameters: [{ type: "video", video: { link: pub("ascari-teaser.mp4") } }] },
          { type: "body", parameters: [{ type: "text", text: nombre }] },
          { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: codigo }] },
        ],
      },
    }),
  });
  return { ok: r.ok && !!r.d?.messages?.[0]?.id, id: r.d?.messages?.[0]?.id as string | undefined, error: r.d?.error };
}
async function aprobada() {
  const e = await estado();
  return e?.data?.[0]?.status === "APPROVED" ? null : (e?.data?.[0]?.status ?? "sin plantilla");
}
async function prueba(a: string) {
  const falta = await aprobada();
  if (falta) return { ok: false, esperando_plantilla: falta };
  return await mandar(a.replace(/\D/g, ""), "Óptica Prueba", "pruebagus2026");
}
async function enviar(max: number) {
  const falta = await aprobada();
  if (falta) return { ok: false, esperando_plantilla: falta };
  const id = await campanaId(false);
  if (!id) return { ok: false, error: "primero ?tarea=cargar" };
  const { data: pend } = await sb.from("campana_envio").select("id, telefono, nombre, codigo_acceso")
    .eq("campana_id", id).eq("estado", "pendiente").limit(max);
  await sb.from("campana").update({ estado: "enviando" }).eq("id", id);
  let ok = 0, err = 0;
  for (const p of pend ?? []) {
    const r = await mandar(p.telefono, primerNombre(p.nombre), p.codigo_acceso);
    await sb.from("campana_envio").update(r.ok
      ? { estado: "enviado", enviado_at: new Date().toISOString(), wa_message_id: r.id }
      : { estado: "error", motivo: JSON.stringify(r.error ?? "").slice(0, 300) }).eq("id", p.id);
    r.ok ? ok++ : err++;
  }
  const { count } = await sb.from("campana_envio").select("id", { count: "exact", head: true }).eq("campana_id", id).eq("estado", "pendiente");
  if (!count) await sb.from("campana").update({ estado: "enviada", cerrada_at: new Date().toISOString() }).eq("id", id);
  return { ok: true, enviados: ok, errores: err, quedan: count ?? 0 };
}

// ── Telegram ────────────────────────────────────────────────────────────────
// Ventas: Adrián, Bruno, Lola y lo corporativo. Prospección: Mauro, Ulises, Administración.
const GRUPO_DE: Record<string, string> = { adrian: "ventas", bruno: "ventas", lola: "ventas", corporativo: "ventas", mauro: "prospeccion", ulises: "prospeccion", administracion: "prospeccion" };
const clave = (v: string) => v.split(/\s+/)[0].normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

async function tg(metodo: string, body: unknown) {
  const r = await fetch(`${TG}/${metodo}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (!d?.ok) throw new Error(`${metodo}: ${d?.description ?? r.status}`);
  return d.result;
}
async function log(chat: number, id: number, texto: string) {
  await sb.from("ojo_mensajes_log").insert({ telegram_chat_id: chat, telegram_message_id: id, autor_nombre: "Ojo", texto: texto.slice(0, 4000), es_del_bot: true });
}

async function telegram(probar: boolean) {
  const { data: temas } = await sb.from("ojo_temas").select("tema, chat_id").in("tema", ["ventas", "prospeccion"]);
  const chats = Object.fromEntries((temas ?? []).map((t) => [t.tema, Number(t.chat_id)]));
  const filas = await lista();
  const porVend = new Map<string, Fila[]>();
  for (const f of filas) porVend.set(f.vendedor, [...(porVend.get(f.vendedor) ?? []), f]);

  const listas: { tema: string; texto: string; botones: { text: string; url: string }[][] }[] = [];
  for (const [vend, fs] of porVend) {
    const tema = GRUPO_DE[clave(vend)] ?? "ventas";
    fs.sort((a, b) => b.ultima_visita.localeCompare(a.ultima_visita));
    const conWa = fs.filter((f) => f.wa && !f.de_baja);
    const sinWa = fs.filter((f) => !f.wa);
    const lineas = fs.slice(0, 40).map((f, i) =>
      `${i + 1}. ${esc(nombreLista(f.nombre) || "(sin nombre)")}${f.tipo === "prospecto" ? " · 🎯 prospecto" : ""}${f.wa ? "" : " · ☎️ sin WhatsApp"}`);
    const texto = `👓 <b>ASCARI · tu lista</b> · ${esc(vend)}\n` +
      `${fs.length} abrieron el catálogo en los últimos 30 días (${conWa.length} con WhatsApp${sinWa.length ? `, ${sinWa.length} sin WhatsApp: a esos llamalos` : ""}).\n` +
      `IRIS les va a mandar el video oficial por WhatsApp en estos días. Después de eso hacé vos el seguimiento personal: reenviales el video y las fotos de arriba y preguntales si lo suman al pedido.\n\n` +
      lineas.join("\n") + (fs.length > 40 ? `\n… y ${fs.length - 40} más` : "");
    const saludo = (f: Fila) => { const n = primerNombre(f.nombre); return `Hola${n.startsWith("¿") ? "" : " " + n}! Te escribo de Orbital: ¿viste el ASCARI, el modelo de la temporada? Te paso el video y las fotos 👇`; };
    const botones = conWa.slice(0, 12).map((f, i) => [{ text: `💬 ${i + 1}. ${(nombreLista(f.nombre) || f.wa || "").slice(0, 28)}`, url: `https://wa.me/${f.wa}?text=${encodeURIComponent(saludo(f))}` }]);
    listas.push({ tema, texto, botones });
  }
  if (probar) return { prueba: true, chats, listas: listas.map((l) => ({ tema: l.tema, texto: l.texto, botones: l.botones.length })) };

  const enviados: Record<string, number> = {};
  for (const tema of ["ventas", "prospeccion"]) {
    const chat = chats[tema];
    if (!chat) continue;
    const v = await tg("sendVideo", { chat_id: chat, video: pub("ascari-teaser.mp4"), supports_streaming: true,
      caption: "🚀 <b>Lanzamiento ASCARI · Temporada 2026</b>\nEl kit para mandarle a tus ópticas: este video, las 3 fotos y el texto de abajo, listo para copiar.", parse_mode: "HTML" });
    await log(chat, v.message_id, "Lanzamiento ASCARI: video");
    const fotos = await tg("sendMediaGroup", { chat_id: chat, media: [1, 2, 3].map((i) => ({ type: "photo", media: pub(`ascari-${i}.jpg`) })) });
    await log(chat, fotos[0].message_id, "Lanzamiento ASCARI: fotos");
    const t = await tg("sendMessage", { chat_id: chat, text: TEXTO_TG, parse_mode: "HTML", disable_web_page_preview: true });
    await log(chat, t.message_id, TEXTO_TG);
    enviados[tema] = 3;
    for (const l of listas.filter((x) => x.tema === tema)) {
      const m = await tg("sendMessage", { chat_id: chat, text: l.texto, parse_mode: "HTML", disable_web_page_preview: true, reply_markup: { inline_keyboard: l.botones } });
      await log(chat, m.message_id, l.texto);
      enviados[tema]++;
    }
  }
  return { ok: true, mensajes: enviados };
}

Deno.serve(async (req) => {
  if (!req.headers.get("x-cron-key") || req.headers.get("x-cron-key") !== (await cfg("cron_key"))) return new Response("no", { status: 401 });
  const u = new URL(req.url);
  const tarea = u.searchParams.get("tarea");
  try {
    if (tarea === "subir") return Response.json(await subir(req, u.searchParams.get("nombre") ?? ""));
    if (tarea === "plantilla") return Response.json(await plantilla());
    if (tarea === "estado") return Response.json(await estado());
    if (tarea === "cargar") return Response.json(await cargar());
    if (tarea === "prueba") return Response.json(await prueba(u.searchParams.get("a") ?? ""));
    if (tarea === "enviar") return Response.json(await enviar(Math.min(Number(u.searchParams.get("max")) || 50, 250)));
    if (tarea === "telegram") return Response.json(await telegram(u.searchParams.get("prueba") === "1"));
    return Response.json({ ok: false, error: "tarea: subir | plantilla | estado | cargar | prueba | enviar | telegram" });
  } catch (e) {
    console.error(e);
    return Response.json({ ok: false, error: String(e) }, { status: 500 });
  }
});
