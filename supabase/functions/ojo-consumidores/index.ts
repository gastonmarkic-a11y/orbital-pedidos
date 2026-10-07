// ojo-consumidores — resumen diario de las preguntas de consumidores finales (2026-09-30, Gastón).
// Problema: Gustavo le pidió a Ojo «las preguntas de consumidores finales sin responder de hoy» y Ojo no tenía
// esos datos: las charlas de la tienda online / WhatsApp con el público viven en at_conversaciones/at_mensajes.
// Qué hace: junta las charlas del día con clientes que no son ópticas (contactos.tipo_cliente <> mayorista y sin
// cod_cliente), le pide al LLM que separe consumidores de ópticas y marque cada pregunta como respondida por el
// equipo, resuelta por IRIS, esperando al cliente, sin responder o mal respondida por IRIS. Publica en el grupo:
//   1) un encabezado con los números del día y
//   2) una tarjeta por cada charla con algo pendiente, anclada en ojo_hilos → respondiéndola le llega al cliente.
// Disparo: cron lun-sáb 19:30 (AR). POST (x-cron-key) body opcional {fecha:"YYYY-MM-DD", simular:true, chat:123}.
// Regla Telegram: sin plata. Regla clientes: la sugerencia no promete fechas ni da precios.
import { createClient } from "npm:@supabase/supabase-js@2";

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const TG_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const GROQ_API_KEY = Deno.env.get("GROQ_API_KEY") ?? "";
const OJO_GROQ_MODEL = Deno.env.get("OJO_GROQ_MODEL") ?? "openai/gpt-oss-120b";
const GRUPO = -5504692394;
const TZ = "America/Argentina/Buenos_Aires";

const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
const hora = (iso: string) => new Date(iso).toLocaleTimeString("es-AR", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false });
// Saludo automático de los anuncios de Meta: si el cliente no escribió nada más, no hay pregunta.
const SOLO_SALUDO = /^[¡!\s]*hola[!.\s]*(quiero m[aá]s informaci[oó]n[.\s]*)?(cat[aá]logo)?[.!\s]*$/i;

async function askAnthropic(system: string, user: string): Promise<string | null> {
  if (!ANTHROPIC_API_KEY) return null;
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: "claude-sonnet-5-5", max_tokens: 3500, system, messages: [{ role: "user", content: user }] }),
    });
    const d = await r.json();
    if (d?.error) { console.error("anthropic", JSON.stringify(d.error)); return null; }
    return d?.content?.find((c: { type: string }) => c.type === "text")?.text?.trim() ?? null;
  } catch (e) { console.error("anthropic", String(e)); return null; }
}

async function askGroq(system: string, user: string): Promise<string> {
  if (!GROQ_API_KEY) return "";
  try {
    const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${GROQ_API_KEY}` },
      body: JSON.stringify({ model: OJO_GROQ_MODEL, max_tokens: 4000, temperature: 0, response_format: { type: "json_object" },
        messages: [{ role: "system", content: system }, { role: "user", content: user }] }),
    });
    const d = await r.json();
    if (d?.error) { console.error("groq", JSON.stringify(d.error)); return ""; }
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

const SYSTEM = `Sos el asistente interno de Orbital Eyewear (fábrica argentina de anteojos). Orbital vende marcos y anteojos de sol
al público en su tienda online y a ópticas por mayor; no tiene locales propios y los cristales con aumento los hace una óptica.
Te paso una conversación del día de clientes con IRIS (el bot) y con el EQUIPO (vendedores/Postventa).
Para cada conversación decidí si el cliente es consumidor final y listá las preguntas o pedidos concretos que hizo.
Devolvé SOLO un JSON: {"charlas":[{"id":"<id>","consumidor":"si|no|dudoso","quien":"quién es en pocas palabras (nombre, localidad si aparece)",
"preguntas":[{"pregunta":"lo que preguntó o pidió, corto y con sus palabras","estado":"respondida_equipo|resuelta_iris|esperando_cliente|sin_responder|mal_respondida",
"nota":"por qué ese estado, una oración","sugerencia":"solo si estado es sin_responder o mal_respondida: respuesta corta para mandarle, rioplatense y cordial"}]}]}
Criterios de estado:
- respondida_equipo: alguien del EQUIPO la contestó y no quedó nada prometido sin cumplir.
- resuelta_iris: IRIS la contestó bien y completa, con información que suena correcta, y el cliente no insistió.
  Sé exigente: ante la duda, NO es resuelta_iris.
- esperando_cliente: IRIS o el equipo pidió un dato (localidad, modelo, foto) y el cliente no volvió a escribir.
- sin_responder: nadie la contestó, o IRIS dijo que alguien le iba a escribir y el EQUIPO no escribió, o el equipo prometió
  confirmar algo y no lo confirmó.
- mal_respondida: IRIS contestó otra cosa, dio datos que no corresponden (ej. ópticas de otra ciudad), se contradijo, no pudo
  ver una foto (IRIS NO ve fotos: si el cliente mandó o quiso mandar una foto para identificar un modelo, no está resuelta),
  o el cliente se quejó («nunca me respondieron», «no es ese»).
Mandar a la tienda online (orbitaleyewear.com.ar) para ver precios, cuotas, medios de pago o comprar ES una buena respuesta.
Un link a un producto o búsqueda concreta que responde lo que pidió también. Marcá mal_respondida solo cuando un vendedor
tendría que escribirle para corregir o completar; no por detalles de estilo.
Listá TODAS las preguntas distintas del cliente, no solo la primera.
Reglas: no inventes nada que no esté en la charla. Si el cliente solo saludó, "preguntas" va vacío. Una óptica, comercio o
revendedor es consumidor "no". La sugerencia NUNCA promete fechas, no da precios ni confirma stock que no conste; si falta un
dato para contestar, lo pide.`;

async function telegram(chat_id: number, text: string) {
  const r = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id, text: text.slice(0, 4000), parse_mode: "HTML", disable_web_page_preview: true }),
  });
  return await r.json();
}

async function log(chat_id: number, message_id: number, texto: string) {
  await supabase.from("ojo_mensajes_log").insert({ telegram_chat_id: chat_id, telegram_message_id: message_id, autor_nombre: "Ojo", texto: texto.slice(0, 4000), es_del_bot: true });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("ok");
  const { data: cfg } = await supabase.from("app_config").select("valor").eq("clave", "cron_key").maybeSingle();
  if (!cfg?.valor || req.headers.get("x-cron-key") !== cfg.valor) return json({ error: "no autorizado" }, 401);

  const b = await req.json().catch(() => ({}));
  const simular = !!b?.simular;
  // Ojo por tema (2026-09-30): va al grupo de Consumidor final (Gustavo); mientras no exista, al general.
  const { data: chatC } = await supabase.rpc("ojo_chat_tema", { p_tema: "consumidor" });
  const chat = Number(b?.chat) || Number(chatC) || GRUPO;
  const fecha = /^\d{4}-\d{2}-\d{2}$/.test(String(b?.fecha ?? "")) ? String(b.fecha)
    : new Date().toLocaleDateString("sv-SE", { timeZone: TZ });
  const desde = new Date(`${fecha}T00:00:00-03:00`).toISOString();
  const hasta = new Date(new Date(desde).getTime() + 24 * 3600e3).toISOString();

  // 1) Charlas del día con mensajes del cliente, de contactos que no son ópticas cargadas.
  const { data: delDia } = await supabase.from("at_mensajes").select("conversacion_id")
    .eq("emisor", "cliente").gte("created_at", desde).lt("created_at", hasta).limit(2000);
  const convIds = [...new Set((delDia ?? []).map((m: any) => m.conversacion_id))];
  if (!convIds.length) return json({ ok: true, fecha, charlas: 0 });

  const { data: convs } = await supabase.from("at_conversaciones").select("id, contacto_id, canal_origen").in("id", convIds);
  const contactoIds = [...new Set((convs ?? []).map((c: any) => c.contacto_id))];
  const { data: contactos } = await supabase.from("contactos").select("id, nombre, telefono, tipo_cliente, cod_cliente").in("id", contactoIds);
  const contactoDe = new Map((contactos ?? []).map((c: any) => [c.id, c]));

  const candidatas: any[] = [];
  for (const cv of convs ?? []) {
    const ct: any = contactoDe.get(cv.contacto_id);
    if (!ct || ct.tipo_cliente === "mayorista" || ct.cod_cliente) continue;
    const { data: msgs } = await supabase.from("at_mensajes").select("id, emisor, contenido, created_at")
      .eq("conversacion_id", cv.id).gte("created_at", desde).lt("created_at", hasta).order("created_at").limit(60);
    const delCliente = (msgs ?? []).filter((m: any) => m.emisor === "cliente");
    if (!delCliente.length || delCliente.every((m: any) => SOLO_SALUDO.test(String(m.contenido ?? "").trim()))) continue;
    candidatas.push({ conv: cv, contacto: ct, msgs: msgs ?? [] });
  }
  // {solo:[ids]}: manda solo las tarjetas de esas charlas, sin encabezado (para reenviar una que faltó).
  const solo: string[] = Array.isArray(b?.solo) ? b.solo.map(String) : [];
  if (solo.length) candidatas.splice(0, candidatas.length, ...candidatas.filter((c) => solo.includes(String(c.conv.id))));
  if (!candidatas.length) return json({ ok: true, fecha, charlas: 0 });

  // 2) LLM: una charla por llamada (en tandas de 8 se salteaba charlas), de a 5 en paralelo.
  const analisis = new Map<string, any>();
  const sinAnalizar: string[] = [];
  const analizar = async (c: any) => {
    const charla = c.msgs.map((m: any) => {
      const quien = m.emisor === "cliente" ? "CLIENTE" : m.emisor === "bot" ? "IRIS" : "EQUIPO";
      return `[${hora(m.created_at)}] ${quien}: ${String(m.contenido ?? "").replace(/\s+/g, " ").slice(0, 700)}`;
    }).join("\n");
    const userMsg = `=== CONVERSACIÓN id=${c.conv.id} · canal ${c.conv.canal_origen} · contacto «${c.contacto.nombre ?? "sin nombre"}» (${c.contacto.tipo_cliente}) ===\n${charla}`;
    let ch: any = null;
    for (let intento = 0; intento < 2 && !ch; intento++) {
      const raw = (await askAnthropic(SYSTEM, userMsg)) ?? (await askGroq(SYSTEM, userMsg));
      ch = parseJson(raw ?? "")?.charlas?.[0];
    }
    if (ch) analisis.set(String(c.conv.id), ch); else sinAnalizar.push(c.conv.id);
  };
  for (let i = 0; i < candidatas.length; i += 5) await Promise.all(candidatas.slice(i, i + 5).map(analizar));

  // 3) Armar mensajes.
  const PEND = new Set(["sin_responder", "mal_respondida"]);
  const cuenta: Record<string, number> = { respondida_equipo: 0, resuelta_iris: 0, esperando_cliente: 0, sin_responder: 0, mal_respondida: 0 };
  let nConsumidores = 0;
  const tarjetas: { conv: any; texto: string; ultimoMsg: any }[] = [];
  const resueltas: string[] = [];

  for (const c of candidatas) {
    const a = analisis.get(String(c.conv.id));
    const canalC = c.conv.canal_origen === "web" ? "tienda online" : c.conv.canal_origen;
    if (!a) {
      // El LLM no pudo con esta charla: igual sale la tarjeta, con los últimos mensajes tal cual, para que alguien la mire.
      const tel = String(c.contacto.telefono ?? "").replace(/\D/g, "");
      const ult = c.msgs.slice(-8).map((m: any) => {
        const quien = m.emisor === "cliente" ? "👤" : m.emisor === "bot" ? "🤖" : "🧑‍💼";
        return `${hora(m.created_at)} ${quien} ${esc(String(m.contenido ?? "").replace(/\s+/g, " ").slice(0, 220))}`;
      });
      tarjetas.push({
        conv: c.conv, ultimoMsg: c.msgs[c.msgs.length - 1],
        texto: [
          `🛍️ <b>Charla sin revisar</b> · ${esc(canalC)} · ${esc(c.contacto.nombre ?? "sin nombre")}${tel ? ` · wa.me/${tel}` : ""}`,
          "No la pude analizar sola: fijate si quedó algo por responder. Últimos mensajes:",
          "",
          ...ult,
          "",
          "↩️ <i>Respondé ESTE mensaje y le llega al cliente.</i>",
        ].join("\n"),
      });
      continue;
    }
    if (a.consumidor === "no" || !(a.preguntas ?? []).length) continue;
    nConsumidores++;
    const pendientes = (a.preguntas as any[]).filter((p) => PEND.has(p.estado));
    for (const p of a.preguntas as any[]) if (p.estado in cuenta) cuenta[p.estado]++;
    const canal = c.conv.canal_origen === "web" ? "tienda online" : c.conv.canal_origen;
    const quien = a.quien || c.contacto.nombre || "Consumidor";
    if (!pendientes.length) {
      resueltas.push(`• ${esc(quien)} (${esc(canal)}): ${a.preguntas.map((p: any) => esc(p.pregunta)).join(" / ")}`);
      continue;
    }
    const primera = c.msgs.find((m: any) => m.emisor === "cliente");
    const tel = String(c.contacto.telefono ?? "").replace(/\D/g, "");
    const lineas = [
      `🛍️ <b>Consumidor final</b> · ${esc(canal)} · desde las ${hora(primera.created_at)}${a.consumidor === "dudoso" ? " · (¿consumidor?)" : ""}`,
      `👤 ${esc(quien)}${tel ? ` · wa.me/${tel}` : ""}`,
      "",
      ...pendientes.flatMap((p) => [
        `${p.estado === "mal_respondida" ? "⚠️ <b>IRIS contestó mal</b>" : "❗ <b>Sin responder</b>"}: «${esc(p.pregunta)}»`,
        p.nota ? `   <i>${esc(p.nota)}</i>` : "",
        p.sugerencia ? `   💡 «${esc(p.sugerencia)}»` : "",
      ]),
      "",
      "↩️ <i>Respondé ESTE mensaje y le llega al cliente.</i>",
    ];
    tarjetas.push({ conv: c.conv, texto: lineas.join("\n").replace(/\n{3,}/g, "\n\n"), ultimoMsg: c.msgs[c.msgs.length - 1] });
  }

  const nPend = cuenta.sin_responder + cuenta.mal_respondida;
  const [, mm, dd] = fecha.split("-");
  const encabezado = [
    `🛍️ <b>Consumidores finales — ${dd}/${mm}</b>`,
    `${nConsumidores} charla(s) con preguntas del público (tienda online y WhatsApp).`,
    "",
    "Preguntas:",
    `❗ Sin responder: <b>${cuenta.sin_responder}</b>`,
    `⚠️ IRIS contestó mal: <b>${cuenta.mal_respondida}</b>`,
    `⏳ Esperando al cliente: ${cuenta.esperando_cliente}`,
    `🤖 Resueltas por IRIS: ${cuenta.resuelta_iris}`,
    `✅ Respondidas por el equipo: ${cuenta.respondida_equipo}`,
    "",
    nPend ? `Abajo va una tarjeta por cada charla con algo pendiente 👇` : `No quedó ninguna pregunta del público sin responder 🙌`,
    ...(resueltas.length ? ["", "<b>Ya resueltas:</b>", ...resueltas.slice(0, 15)] : []),
  ].join("\n");

  if (simular) return json({ ok: true, simulado: true, fecha, encabezado, tarjetas: tarjetas.map((t) => t.texto), cuenta, sinAnalizar });

  if (!solo.length) {
    const h = await telegram(chat, encabezado);
    if (!h?.ok) return json({ ok: false, motivo: "telegram", tg: h }, 502);
    await log(chat, h.result.message_id, encabezado);
  }

  for (const t of tarjetas) {
    const tg = await telegram(chat, t.texto);
    if (!tg?.ok) { console.error("telegram tarjeta", JSON.stringify(tg)); continue; }
    const message_id = tg.result.message_id;
    // Primero ojo_resumenes: así el trigger de ojo_hilos no le cuelga un 📋 Resumen abajo a la tarjeta.
    await supabase.from("ojo_resumenes").insert({ conversacion_id: t.conv.id, ultimo_msg_id: String(t.ultimoMsg.id), telegram_chat_id: chat, telegram_message_id: message_id, tema: "consumidor" });
    await supabase.from("ojo_hilos").insert({ telegram_chat_id: chat, telegram_message_id: message_id, conversacion_id: t.conv.id });
    await log(chat, message_id, t.texto);
  }

  return json({ ok: true, fecha, consumidores: nConsumidores, pendientes: tarjetas.length, cuenta, sinAnalizar });
});
