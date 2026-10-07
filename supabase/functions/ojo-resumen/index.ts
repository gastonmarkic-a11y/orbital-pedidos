// ojo-resumen — resumen de la conversación debajo de cada 🆘 del grupo de Ojo (2026-09-29, Gastón).
// Problema: el 🆘 traía solo el "último mensaje" («No», «20432445667») y quien lo recibía no sabía de qué
// se trataba. Ahora, cuando sale un 🆘, esta función publica como RESPUESTA un resumen: tema (comercial,
// postventa/repuesto, rotura, envío, estado de pedido), qué pide el cliente, pedidos/envíos recientes y una
// respuesta sugerida. El resumen se ancla en ojo_hilos → respondiéndolo en Telegram le llega al cliente
// (ojo-telegram → at-responder), igual que el 🆘.
// Disparo: triggers de base (pg_net) sobre ojo_hilos (🆘 de wa-webhook/ojo-avisos) y ojo_mensajes_log
// (🆘 de /derivar, que trae el teléfono en el link wa.me). Header x-internal-key = app_config meta_webhook_verify_token.
// Body: { chat_id, reply_to, conversacion_id? , telefono?, simular? }
// Regla Telegram: sin plata. Regla clientes: la sugerencia no promete fechas.
import { createClient } from "npm:@supabase/supabase-js@2";

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const TG_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const GROQ_API_KEY = Deno.env.get("GROQ_API_KEY") ?? "";
const OJO_GROQ_MODEL = Deno.env.get("OJO_GROQ_MODEL") ?? "openai/gpt-oss-120b";

const TEMAS: Record<string, string> = {
  comercial: "💼 Comercial",
  postventa_repuesto: "🔧 Postventa / repuesto",
  rotura: "💥 Rotura / garantía",
  envio: "🚚 Envío",
  estado_pedido: "📦 Estado de pedido",
  cuenta: "🧾 Cuenta / pagos",
  otro: "💬 Consulta",
};

const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const ult8 = (t: string) => String(t ?? "").replace(/\D/g, "").slice(-8);
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });

async function askAnthropic(system: string, user: string): Promise<string | null> {
  if (!ANTHROPIC_API_KEY) return null;
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: "claude-sonnet-5", max_tokens: 1200, system, messages: [{ role: "user", content: user }] }),
    });
    const d = await r.json();
    if (d?.error) { console.error("anthropic", JSON.stringify(d.error)); return null; }
    return d?.content?.find((c: { type: string }) => c.type === "text")?.text?.trim() ?? null;
  } catch (e) { console.error("anthropic", String(e)); return null; }
}

async function askGroq(system: string, user: string): Promise<string> {
  if (!GROQ_API_KEY) return "";
  const call = async (forzarJson: boolean) => {
    const body: Record<string, unknown> = {
      model: OJO_GROQ_MODEL, max_tokens: 2000, temperature: 0,
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
    };
    if (forzarJson) body.response_format = { type: "json_object" };
    const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${GROQ_API_KEY}` }, body: JSON.stringify(body),
    });
    return await r.json();
  };
  try {
    let d = await call(true);
    if (d?.error) d = await call(false);
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

const SYSTEM = `Sos el asistente interno de Orbital Eyewear (fábrica argentina de anteojos que vende a ópticas y al público).
Te paso una conversación de un cliente con IRIS (el bot) y con el equipo. Tenés que resumirla para que el vendedor o
Postventa que la recibe en Telegram pueda contestar sin leer todo.
Devolvé SOLO un JSON: {"tema": "comercial|postventa_repuesto|rotura|envio|estado_pedido|cuenta|otro",
"quien": "quién es el cliente en pocas palabras (óptica/consumidor, nombre, localidad si aparece)",
"resumen": "2 o 3 oraciones: qué pasó en la charla",
"pide": "qué necesita AHORA el cliente, una oración",
"datos": "datos concretos que dio (modelo, color, código, CUIT, dirección, nro de pedido) o \\"\\"",
"sugerencia": "respuesta corta para mandarle al cliente, en castellano rioplatense, cordial, 1-3 oraciones"}
Reglas: no inventes nada que no esté en la charla o en los datos del sistema. Sin montos ni precios en resumen/pide/datos.
La sugerencia NUNCA promete fechas de entrega ni de producción, no da precios y no dice que algo ya está hecho si no consta;
si falta un dato para contestar, la sugerencia lo pide. Si el tema es estado de pedido o envío, usá los pedidos/envíos del sistema.`;

async function telegram(chat_id: number, text: string, reply_to?: number) {
  const r = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id, text, parse_mode: "HTML", disable_web_page_preview: true,
      ...(reply_to ? { reply_parameters: { message_id: reply_to, allow_sending_without_reply: true } } : {}) }),
  });
  return await r.json();
}

Deno.serve(async (req) => {
  const { data: cfg } = await supabase.from("app_config").select("valor").eq("clave", "meta_webhook_verify_token").maybeSingle();
  if (!cfg?.valor || req.headers.get("x-internal-key") !== cfg.valor) return json({ error: "no autorizado" }, 401);

  const b = await req.json().catch(() => ({}));
  const chat_id = Number(b.chat_id), reply_to = Number(b.reply_to) || undefined, simular = !!b.simular;
  if (!chat_id) return json({ error: "falta chat_id" }, 400);

  // 1) Conversación: por id o por teléfono (🆘 de /derivar).
  let conversacion_id: string | null = b.conversacion_id ?? null;
  let contacto: any = null;
  if (!conversacion_id && b.telefono) {
    const t8 = ult8(b.telefono);
    if (t8.length < 8) return json({ ok: false, motivo: "telefono inválido" });
    const { data: cs } = await supabase.from("contactos").select("id").ilike("telefono", `%${t8}`).limit(20);
    const ids = (cs ?? []).map((c: any) => c.id);
    if (!ids.length) return json({ ok: false, motivo: "sin contacto" });
    const { data: conv } = await supabase.from("at_conversaciones").select("id")
      .in("contacto_id", ids).order("updated_at", { ascending: false }).limit(1).maybeSingle();
    conversacion_id = conv?.id ?? null;
  }
  if (!conversacion_id) return json({ ok: false, motivo: "sin conversación" });

  const { data: conv } = await supabase.from("at_conversaciones").select("id, contacto_id, canal_origen, estado").eq("id", conversacion_id).maybeSingle();
  if (!conv) return json({ ok: false, motivo: "conversación inexistente" });
  ({ data: contacto } = await supabase.from("contactos").select("nombre, telefono, email, tipo_cliente, cod_cliente").eq("id", conv.contacto_id).maybeSingle());

  const { data: msgsDesc } = await supabase.from("at_mensajes").select("id, emisor, contenido, created_at")
    .eq("conversacion_id", conversacion_id).order("created_at", { ascending: false }).limit(40);
  const msgs = (msgsDesc ?? []).reverse();
  if (!msgs.some((m: any) => m.emisor === "cliente")) return json({ ok: false, motivo: "sin mensajes del cliente" });
  const ultimo = msgs[msgs.length - 1];

  // 2) Uno por conversación: nada si ya hay resumen con el mismo último mensaje o de las últimas 2 h.
  if (!simular) {
    const { data: prev } = await supabase.from("ojo_resumenes").select("ultimo_msg_id, creado_en")
      .eq("conversacion_id", conversacion_id).order("creado_en", { ascending: false }).limit(1).maybeSingle();
    if (prev && (String(prev.ultimo_msg_id) === String(ultimo.id) || Date.now() - new Date(prev.creado_en).getTime() < 2 * 3600e3))
      return json({ ok: false, motivo: "ya resumida" });
  }

  // 3) Datos del sistema: cliente, pedidos y envíos (sin plata).
  const cod = contacto?.cod_cliente ?? null;
  let cliente: any = null, pedidos: any[] = [], envios: any[] = [];
  if (cod) {
    ({ data: cliente } = await supabase.from("clientes").select("cod, razon, nombre_publico, localidad, provincia, vendedor_asignado").eq("cod", cod).maybeSingle());
    const { data: ps } = await supabase.from("pedidos").select("id, fecha, estado, total_units, nro_guia, tipo_transporte, esperando_stock, entrega_parcial, fecha_entrega")
      .eq("cod_cliente", cod).order("created_at", { ascending: false }).limit(3);
    pedidos = ps ?? [];
  }
  const t8 = ult8(contacto?.telefono ?? "");
  if (t8.length === 8) {
    const { data: es } = await supabase.from("envios_envia").select("tracking_number, carrier, estado, shipped_at, delivered_at, consignee_city, carrier_track_url")
      .ilike("consignee_phone", `%${t8}`).order("shipped_at", { ascending: false, nullsFirst: false }).limit(2);
    envios = es ?? [];
  }

  const charla = msgs.map((m: any) => {
    const quien = m.emisor === "cliente" ? "CLIENTE" : m.emisor === "bot" ? "IRIS" : "EQUIPO";
    const f = new Date(m.created_at).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
    return `[${f}] ${quien}: ${String(m.contenido ?? "").slice(0, 600)}`;
  }).join("\n");
  const sistema = JSON.stringify({
    contacto: { nombre: contacto?.nombre, tipo: contacto?.tipo_cliente, canal: conv.canal_origen },
    cliente, pedidos, envios,
  });
  const userMsg = `DATOS DEL SISTEMA:\n${sistema}\n\nCONVERSACIÓN (más vieja arriba):\n${charla}`;

  const raw = (await askAnthropic(SYSTEM, userMsg)) ?? (await askGroq(SYSTEM, userMsg));
  const r = parseJson(raw ?? "");
  if (!r?.resumen) return json({ ok: false, motivo: "LLM sin respuesta", raw: String(raw ?? "").slice(0, 300) });

  // 4) Mensaje.
  const lineas = [
    `📋 <b>Resumen</b> · ${TEMAS[r.tema] ?? TEMAS.otro}`,
    r.quien ? `👤 ${esc(r.quien)}` : "",
    "",
    esc(r.resumen),
    r.pide ? `\n❓ <b>Pide:</b> ${esc(r.pide)}` : "",
    r.datos ? `🔎 ${esc(r.datos)}` : "",
  ];
  if (pedidos.length) {
    lineas.push("", "📦 <b>Pedidos:</b> " + pedidos.map((p: any) =>
      `#${p.id} ${esc(p.estado ?? "")} (${p.total_units ?? "?"} u.${p.nro_guia ? `, guía ${esc(p.nro_guia)}` : ""}${p.esperando_stock ? ", esperando stock" : ""})`).join(" · "));
  }
  if (envios.length) {
    const e = envios[0];
    lineas.push(`🚚 <b>Envío:</b> ${esc(e.carrier ?? "")} ${esc(e.estado ?? "")}${e.carrier_track_url ? ` · <a href="${esc(e.carrier_track_url)}">seguimiento</a>` : ""}`);
  }
  if (r.sugerencia) lineas.push("", `💡 <b>Sugerida:</b> «${esc(r.sugerencia)}»`);
  lineas.push("", "↩️ <i>Respondé ESTE mensaje y le llega al cliente.</i>");
  const texto = lineas.filter((l, i, a) => !(l === "" && a[i - 1] === "")).join("\n");

  if (simular) return json({ ok: true, simulado: true, texto, tema: r.tema });

  const tg = await telegram(chat_id, texto, reply_to);
  if (!tg?.ok) return json({ ok: false, motivo: "telegram", tg }, 502);
  const message_id = tg.result.message_id;

  // Primero ojo_resumenes (el trigger de ojo_hilos lo usa para no resumir su propio resumen).
  await supabase.from("ojo_resumenes").insert({ conversacion_id, ultimo_msg_id: String(ultimo.id), telegram_chat_id: chat_id, telegram_message_id: message_id, tema: r.tema ?? null });
  await supabase.from("ojo_hilos").insert({ telegram_chat_id: chat_id, telegram_message_id: message_id, conversacion_id });
  await supabase.from("ojo_mensajes_log").insert({ telegram_chat_id: chat_id, telegram_message_id: message_id, autor_nombre: "Ojo", texto: texto.slice(0, 4000), es_del_bot: true });

  return json({ ok: true, message_id, tema: r.tema });
});
