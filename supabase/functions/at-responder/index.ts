// at-responder — respuesta centralizada del equipo a una conversación.
// Registra la respuesta en at_mensajes y la envía por el canal que corresponda.
// v2: CORS + manejo de OPTIONS (se llama desde el navegador).
// v3 (2026-09-09): antes solo sabía mandar por WhatsApp — en Instagram y Messenger el
//   vendedor escribía, veía su mensaje en pantalla y al cliente no le llegaba nada.
//   Ahora envía por Graph (me/messages) en esos dos canales, con reintento etiquetado
//   HUMAN_AGENT cuando ya pasó la ventana de 24 h, y devuelve el motivo real si no sale.
//   Además chequea el error del insert: el emisor 'agente' no pasaba el CHECK de la tabla
//   y la respuesta no quedaba registrada en ningún lado (fallaba en silencio).
// v4 (2026-09-09): el canal 'web' ya NO es un callejón sin salida. El catálogo B2B tiene
//   chat en vivo y lee estos mensajes, así que la respuesta SÍ le llega al cliente
//   (al toque si está navegando, o cuando vuelve a entrar). Decía "❌ No le llegó" y
//   hacía pensar que había fallado cuando en realidad estaba entregada.
// v5 (2026-09-25): el canal 'web' también es el chat de la tienda online (iris-tienda.js):
//   la confirmación dice en cuál de los dos le aparece.
// v6 (2026-10-16): cerrada a la anon key. verify_jwt solo chequea que el JWT sea válido y la
//   anon key es pública (está en la web): cualquiera podía mandarle mensajes a cualquier
//   conversación como si fuera el equipo. Ahora exige la service role (ojo-telegram,
//   ig-comentarios, ojo-leads) o el JWT de un usuario logueado de la Suite (Conversaciones,
//   Derivaciones, Postventa). Mismo patrón que meta-insights-sync.
import { createClient } from "jsr:@supabase/supabase-js@2";

const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(Deno.env.get("SUPABASE_URL")!, SERVICE_KEY);
const WHATSAPP_TOKEN = Deno.env.get("WHATSAPP_TOKEN") ?? "";
const PHONE_NUMBER_ID = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID") ?? "";
const PAGE_TOKEN = Deno.env.get("IG_PAGE_TOKEN") ?? "";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };

async function enviarWA(to: string, texto: string): Promise<{ ok: boolean; detalle: string }> {
  const r = await fetch(`https://graph.facebook.com/v21.0/${PHONE_NUMBER_ID}/messages`, {
    method: "POST", headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body: texto } }),
  });
  if (r.ok) return { ok: true, detalle: "" };
  return { ok: false, detalle: await r.text() };
}

// Instagram y Messenger comparten endpoint: cambia solo quién es el destinatario.
// Fuera de las 24 h desde el último mensaje del cliente, Meta rechaza el envío común;
// la etiqueta HUMAN_AGENT es la que habilita contestar hasta 7 días después.
async function enviarMeta(psid: string, texto: string): Promise<{ ok: boolean; detalle: string }> {
  if (!PAGE_TOKEN) return { ok: false, detalle: "falta IG_PAGE_TOKEN" };
  const url = `https://graph.facebook.com/v21.0/me/messages?access_token=${PAGE_TOKEN}`;
  const base = { recipient: { id: psid }, message: { text: texto } };
  let r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(base) });
  if (r.ok) return { ok: true, detalle: "" };
  const primerError = await r.text();
  r = await fetch(url, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...base, messaging_type: "MESSAGE_TAG", tag: "HUMAN_AGENT" }),
  });
  if (r.ok) return { ok: true, detalle: "enviado fuera de la ventana de 24 h (HUMAN_AGENT)" };
  return { ok: false, detalle: `${primerError} | con HUMAN_AGENT: ${await r.text()}` };
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const j = (x: unknown, s = 200) => new Response(JSON.stringify(x), { status: s, headers: { "content-type": "application/json", ...cors } });
  if (req.method !== "POST") return j({ error: "method" }, 405);

  // --- Guarda de acceso: service role o usuario logueado (nunca la anon key) ---
  const jwt = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  // La firma ya la validó el gateway (verify_jwt): acá alcanza con leer el rol del payload.
  const rolJwt = (() => {
    try { return JSON.parse(atob(jwt.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).role as string; }
    catch { return ""; }
  })();
  let autorizado = !!jwt && (jwt === SERVICE_KEY || rolJwt === "service_role");
  if (!autorizado && jwt && rolJwt !== "anon") {
    const { data: u } = await supabase.auth.getUser(jwt);
    if (u?.user && u.user.role !== "anon" && !u.user.is_anonymous) autorizado = true;
  }
  if (!autorizado) return j({ error: "no_autorizado" }, 401);
  let body: { conversacion_id?: string; texto?: string; agente?: string } = {};
  try { body = await req.json(); } catch { /* */ }
  const { conversacion_id, texto, agente } = body;
  if (!conversacion_id || !texto?.trim()) return j({ error: "faltan datos" }, 400);

  const { data: conv } = await supabase.from("at_conversaciones").select("canal_origen, contacto_id").eq("id", conversacion_id).maybeSingle();
  if (!conv) return j({ error: "conversacion no encontrada" }, 404);

  const { data: ct } = await supabase.from("contactos")
    .select("telefono, instagram_handle, messenger_psid, email").eq("id", conv.contacto_id).maybeSingle();
  const contacto = ct as { telefono: string | null; instagram_handle: string | null; messenger_psid: string | null; email: string | null } | null;

  const limpio = texto.trim();
  let enviado = false; let detalle = "";
  if (conv.canal_origen === "whatsapp") {
    if (contacto?.telefono) { const r = await enviarWA(contacto.telefono, limpio); enviado = r.ok; detalle = r.detalle; }
    else detalle = "sin teléfono del contacto";
  } else if (conv.canal_origen === "instagram" || conv.canal_origen === "messenger") {
    const psid = conv.canal_origen === "instagram" ? contacto?.instagram_handle : contacto?.messenger_psid;
    if (psid) { const r = await enviarMeta(psid, limpio); enviado = r.ok; detalle = r.detalle; }
    else detalle = `sin identificador de ${conv.canal_origen} para este contacto`;
  } else if (conv.canal_origen === "web") {
    // El chat del catálogo y el de la tienda leen estos mensajes: si el cliente está navegando
    // le aparece en unos segundos, y si no, lo ve la próxima vez que entre.
    enviado = true;
    const tienda = (contacto?.email ?? "").startsWith("anon:");
    detalle = `le aparece en el chat ${tienda ? "de la tienda online" : "del catálogo"} (al toque si está navegando)`;
  } else {
    detalle = `El canal ${conv.canal_origen} no envía push directo; la respuesta queda registrada en la conversación.`;
  }

  const { error: errIns } = await supabase.from("at_mensajes").insert({
    conversacion_id, canal: conv.canal_origen, emisor: "agente",
    contenido: `${agente ? agente + ": " : ""}${limpio}`,
  });
  if (errIns) console.error("no se pudo registrar la respuesta", errIns.message);

  return j({ ok: true, enviado, canal: conv.canal_origen, detalle, registrado: !errIns });
});
