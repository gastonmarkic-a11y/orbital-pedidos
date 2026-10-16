// webhook-instagram — adaptador de Instagram DM y Messenger al cerebro único (bot-central).
// GET  = verificación del webhook de Meta (hub.challenge). Acepta IG_VERIFY_TOKEN o el
//        verify token de leads (app_config.meta_webhook_verify_token).
// POST = mensajería entrante (objeto 'instagram' = DM de IG, objeto 'page' = Messenger)
//        -> bot-central; changes 'leadgen' -> se derivan a webhook-meta-leads;
//        changes 'comments' (IG) -> respuesta privada por DM + aviso público corto.
//
// v18 (2026-09-09), antes de publicar la app. Lo que arregla de la v17:
//  - valida la firma X-Hub-Signature-256 (el endpoint estaba abierto a cualquiera);
//  - descarta reintentos por `mid` (Meta reenvía si tardamos: contestaba dos veces);
//  - NO vuelve a insertar la respuesta en at_mensajes (bot-central ya la registra,
//    junto con el mensaje del cliente) — antes cada respuesta quedaba duplicada;
//  - distingue Messenger de Instagram en vez de etiquetar todo como 'instagram';
//  - no se rompe si el contacto tiene más de una conversación abierta;
//  - registra los adjuntos sin texto en vez de tirarlos al silencio;
//  - avisa en el log si el envío a Meta falla (antes fallaba sin dejar rastro).
//
// v23 (2026-10-08): comentarios de Instagram (requiere instagram_manage_comments y el
// campo 'comments' suscripto). Solo comentarios que parecen consulta (precio, info, "?"…):
// IRIS le escribe por privado (private reply) y deja "te escribimos por privado" en el
// comentario. Los elogios, emojis y etiquetas a amigos no se tocan. Se apaga con
// app_config.ig_comentarios = 'off'.
//
// v24 (2026-10-08): menciones en historias. Quien etiqueta a @orbital.eyewear en su
// historia recibe un agradecimiento por DM (una vez cada 24 h por persona, y no si la
// charla está en manos de una persona). Queda en Conversaciones con el link de la
// historia. Se apaga con app_config.ig_menciones = 'off'.
//
// v25 (2026-10-08): fotos y audios por DM. El audio se transcribe (Groq Whisper) y sigue a IRIS como texto.
// La foto la mira Claude: anteojo con modelo legible que existe en el catálogo → IRIS (link + óptica);
// anteojo sin modelo → se le pide el nombre o la localidad; roto → IRIS (Postventa); comprobante → IRIS;
// otra cosa → respuesta corta. En Conversaciones quedan como 🎤/📷 con la transcripción o la descripción.
import { createClient } from "jsr:@supabase/supabase-js@2";

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const VERIFY_TOKEN = Deno.env.get("IG_VERIFY_TOKEN") ?? "";
const PAGE_TOKEN = Deno.env.get("IG_PAGE_TOKEN") ?? "";
const APP_SECRET = Deno.env.get("APP_SECRET") ?? "";

type Canal = "instagram" | "messenger";

// Mismo criterio que wa-webhook: sin firma válida no se procesa nada.
async function firmaValida(raw: string, header: string | null): Promise<boolean> {
  if (!header || !APP_SECRET) return false;
  const recibido = header.startsWith("sha256=") ? header.slice(7) : header;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(APP_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw));
  const esperado = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
  if (esperado.length !== recibido.length) return false;
  let diff = 0; for (let i = 0; i < esperado.length; i++) diff |= esperado.charCodeAt(i) ^ recibido.charCodeAt(i);
  return diff === 0;
}

async function cfg(clave: string): Promise<string | null> {
  const { data } = await supabase.from("app_config").select("valor").eq("clave", clave).maybeSingle();
  return (data as { valor: string } | null)?.valor ?? null;
}

// El PSID de Messenger y el de Instagram son espacios distintos: si se guardan en la
// misma columna, dos personas distintas terminan siendo el mismo contacto.
async function contactoPorPsid(psid: string, canal: Canal) {
  const col = canal === "instagram" ? "instagram_handle" : "messenger_psid";
  const { data: ex } = await supabase.from("contactos").select("id").eq(col, psid).maybeSingle();
  if (ex) return ex;
  const { data, error } = await supabase.from("contactos").insert({ [col]: psid }).select("id").single();
  if (error) throw error;
  return data;
}

// limit(1) y no maybeSingle(): un contacto puede tener más de una conversación abierta
// y maybeSingle() en ese caso tira error y el mensaje se pierde entero.
async function obtenerOCrearConversacion(contactoId: string, canal: Canal) {
  const { data: abiertas } = await supabase.from("at_conversaciones").select("id, estado")
    .eq("contacto_id", contactoId).in("estado", ["bot_activo", "derivada"])
    .order("updated_at", { ascending: false, nullsFirst: false }).limit(1);
  if (abiertas && abiertas.length) return abiertas[0] as { id: string; estado: string };
  const { data, error } = await supabase.from("at_conversaciones")
    .insert({ contacto_id: contactoId, canal_origen: canal }).select("id, estado").single();
  if (error) throw error;
  return data as { id: string; estado: string };
}

async function consultarBotCentral(params: { conversacionId: string; contactoId: string; canal: string; texto: string }) {
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/bot-central`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(params),
    });
    return await res.json();
  } catch (e) {
    console.error("bot-central no respondió", (e as Error).message);
    return null;
  }
}

async function enviarMeta(destinatarioId: string, texto: string, canal: Canal): Promise<boolean> {
  if (!PAGE_TOKEN) { console.error("no hay IG_PAGE_TOKEN: no se pudo responder por", canal); return false; }
  try {
    const r = await fetch(`https://graph.facebook.com/v21.0/me/messages?access_token=${PAGE_TOKEN}`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ recipient: { id: destinatarioId }, message: { text: texto } }),
    });
    if (!r.ok) { console.error("envío a Meta falló", canal, r.status, await r.text()); return false; }
    return true;
  } catch (e) {
    console.error("envío a Meta falló", canal, (e as Error).message);
    return false;
  }
}

// Deriva un change 'leadgen' a la función de leads (mismo proyecto), con clave interna.
async function derivarLeadgen(value: unknown) {
  const key = await cfg("meta_webhook_verify_token");
  if (!key) return;
  try {
    await fetch(`${SUPABASE_URL}/functions/v1/webhook-meta-leads`, {
      method: "POST", headers: { "content-type": "application/json", "x-internal-key": key },
      body: JSON.stringify({ change: value }),
    });
  } catch (e) { console.error("derivarLeadgen error", (e as Error).message); }
}

// ── Menciones en historias ───────────────────────────────────────────────────
const TXT_MENCION = "¡Gracias por compartirnos en tu historia! 🙌 Nos encanta verte con Orbital. Si necesitás algo — un modelo, dónde conseguirlo o cómo cuidar tus anteojos — escribime por acá. Soy IRIS, la asistente de Orbital 🤍";

// Devuelve true si se agradeció. Una vez cada 24 h por conversación, y nunca si la
// charla la tiene una persona (estado 'derivada').
async function agradecerMencion(senderId: string, conversacion: { id: string; estado: string }): Promise<boolean> {
  if (conversacion.estado === "derivada") return false;
  if ((await cfg("ig_menciones")) === "off") return false;
  const desde = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { data: previo } = await supabase.from("at_mensajes").select("id")
    .eq("conversacion_id", conversacion.id).eq("emisor", "bot").eq("contenido", TXT_MENCION)
    .gte("created_at", desde).limit(1);
  if (previo && previo.length) return false;
  return await enviarMeta(senderId, TXT_MENCION, "instagram");
}

// ── Fotos y audios (v25) ─────────────────────────────────────────────────────
const GROQ_KEY = Deno.env.get("GROQ_API_KEY") ?? "";
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const MAX_FOTO = 3_700_000; // bytes: en base64 queda por debajo de los 5 MB que acepta Claude
const TXT_AUDIO_FALLA = "¡Recibí tu audio! 🙏 No lo pude escuchar bien, ¿me lo escribís así te ayudo?";
const TXT_FOTO_ANTEOJO = "¡Qué buena elección! 😎 Por la foto no llego a reconocer el modelo exacto. ¿Me decís el nombre del modelo o en qué localidad estás? Así te paso el link o una óptica donde probártelo.";
const TXT_FOTO_OTRA = "¡Gracias por la foto! 🙌 Contame en qué te puedo ayudar.";

async function bajar(url: string): Promise<{ buf: Uint8Array; mime: string } | null> {
  try {
    const r = await fetch(url);
    if (!r.ok) { console.error("bajar media", r.status); return null; }
    return { buf: new Uint8Array(await r.arrayBuffer()), mime: (r.headers.get("content-type") ?? "").split(";")[0] };
  } catch (e) { console.error("bajar media", (e as Error).message); return null; }
}
function b64(buf: Uint8Array): string {
  let s = ""; const chunk = 0x8000;
  for (let i = 0; i < buf.length; i += chunk) s += String.fromCharCode(...buf.subarray(i, i + chunk));
  return btoa(s);
}

async function transcribir(url: string): Promise<string | null> {
  if (!GROQ_KEY) return null;
  const a = await bajar(url);
  if (!a) return null;
  const fd = new FormData();
  fd.append("file", new Blob([a.buf], { type: a.mime || "audio/mp4" }), "audio.mp4");
  fd.append("model", "whisper-large-v3-turbo");
  fd.append("language", "es");
  fd.append("response_format", "json");
  try {
    const r = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", { method: "POST", headers: { Authorization: `Bearer ${GROQ_KEY}` }, body: fd });
    if (!r.ok) { console.error("transcribir", r.status, await r.text()); return null; }
    const t = String((await r.json())?.text ?? "").trim();
    return t || null;
  } catch (e) { console.error("transcribir", (e as Error).message); return null; }
}

type Foto = { tipo: "anteojo" | "roto" | "comprobante" | "otro"; descripcion: string; texto_visible: string };
async function mirarFoto(url: string): Promise<Foto | null> {
  if (!ANTHROPIC_API_KEY) return null;
  const f = await bajar(url);
  if (!f || f.buf.length > MAX_FOTO) return null;
  const mime = ["image/jpeg", "image/png", "image/webp", "image/gif"].includes(f.mime) ? f.mime : "image/jpeg";
  const consigna = "Un cliente le mandó esta foto por Instagram a Orbital, una marca argentina de anteojos de sol y armazones. " +
    "Clasificala: 'anteojo' (un anteojo o una captura de un producto que le gusta), 'roto' (un anteojo roto, con una pieza suelta o una falla), " +
    "'comprobante' (comprobante de pago o transferencia) u 'otro'. En 'descripcion' poné en una frase corta qué se ve (forma, color, material). " +
    "En 'texto_visible' copiá cualquier nombre de modelo o texto legible del producto (patilla, caja, etiqueta, captura); si no hay, vacío. " +
    'Respondé SOLO con JSON: {"tipo": "...", "descripcion": "...", "texto_visible": "..."}';
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: "claude-sonnet-5", max_tokens: 400, messages: [{ role: "user", content: [
        { type: "image", source: { type: "base64", media_type: mime, data: b64(f.buf) } }, { type: "text", text: consigna }] }] }),
    });
    if (!r.ok) { console.error("mirarFoto", r.status, await r.text()); return null; }
    const txt = ((await r.json())?.content ?? []).map((c: any) => c?.text ?? "").join("");
    const m = txt.match(/\{[\s\S]*\}/);
    const j = m ? JSON.parse(m[0]) : null;
    if (!j) return null;
    const tipo = ["anteojo", "roto", "comprobante"].includes(j.tipo) ? j.tipo : "otro";
    return { tipo, descripcion: String(j.descripcion ?? "").slice(0, 200), texto_visible: String(j.texto_visible ?? "").slice(0, 120) };
  } catch (e) { console.error("mirarFoto", (e as Error).message); return null; }
}

// bot-central registra el texto que le pasamos como mensaje del cliente: después se le pone la etiqueta
// de lo que realmente mandó (🎤 audio / 📷 foto), para que en Conversaciones se lea bien.
async function etiquetarUltimoCliente(conversacionId: string, enviado: string, contenido: string, metadata: Record<string, unknown>) {
  const { data } = await supabase.from("at_mensajes").select("id").eq("conversacion_id", conversacionId)
    .eq("emisor", "cliente").eq("contenido", enviado).order("created_at", { ascending: false }).limit(1);
  const id = (data ?? [])[0]?.id;
  if (id) await supabase.from("at_mensajes").update({ contenido, metadata }).eq("id", id);
}

async function manejarMedia(senderId: string, contactoId: string, conv: { id: string; estado: string }, tipo: "audio" | "foto", url: string) {
  const responderFijo = async (cliente: string, bot: string | null, metadata: Record<string, unknown>) => {
    await supabase.from("at_mensajes").insert({ conversacion_id: conv.id, canal: "instagram", emisor: "cliente", contenido: cliente, metadata });
    // Si la charla la tiene una persona, no se mete IRIS: queda anotado para que lo vea.
    if (!bot || conv.estado === "derivada") return;
    if (await enviarMeta(senderId, bot, "instagram")) {
      await supabase.from("at_mensajes").insert({ conversacion_id: conv.id, canal: "instagram", emisor: "bot", contenido: bot, metadata: { origen: tipo } });
    }
  };
  const aIris = async (texto: string, etiqueta: string, metadata: Record<string, unknown>) => {
    const respuesta = await consultarBotCentral({ conversacionId: conv.id, contactoId, canal: "instagram", texto });
    await etiquetarUltimoCliente(conv.id, texto, etiqueta, metadata);
    const salida = respuesta?.texto ?? "";
    if (salida) await enviarMeta(senderId, salida, "instagram");
  };

  if (tipo === "audio") {
    const t = await transcribir(url);
    if (!t) return responderFijo("🎤 [audio que no se pudo transcribir]", TXT_AUDIO_FALLA, { origen: "audio", url });
    return aIris(t, `🎤 ${t}`, { origen: "audio", url, transcripcion: t });
  }

  const f = await mirarFoto(url);
  const meta = { origen: "foto", url, ...(f ?? {}) };
  if (!f) return responderFijo("📷 [foto]", TXT_FOTO_OTRA, meta);
  const etiqueta = `📷 [foto: ${f.descripcion}]${f.texto_visible ? ` «${f.texto_visible}»` : ""}`;
  if (f.tipo === "roto") return aIris(`Se me rompió el anteojo. ${f.descripcion}`, etiqueta, meta);
  if (f.tipo === "comprobante") return aIris(`Te mando el comprobante de pago. ${f.texto_visible}`.trim(), etiqueta, meta);
  if (f.tipo === "anteojo") {
    // Solo se nombra un modelo si existe en el catálogo (lo que leyó la IA puede ser otra marca).
    const { data } = await supabase.rpc("stock_colores_en_mensaje", { p_texto: f.texto_visible });
    const modelo = ((data ?? []) as { modelo: string }[])[0]?.modelo ?? null;
    if (modelo) return aIris(`Me interesa el modelo ${modelo}`, etiqueta, meta);
    return responderFijo(etiqueta, TXT_FOTO_ANTEOJO, meta);
  }
  return responderFijo(etiqueta, TXT_FOTO_OTRA, meta);
}

// ── Comentarios de Instagram ─────────────────────────────────────────────────
// Solo lo que parece una consulta. "Hermosos 😍" o "@amiga mirá" no reciben nada.
const RE_CONSULTA = /\?|precio|valor|vale|cu[aá]nto|info|venden|venta|mayor|env[ií]o|envian|stock|d[oó]nde|comprar|compro|quiero|link|cuotas|medida|graduad|receta|polariz|local|direcci[oó]n|tienen|disponib|\$|\bdm\b|\bmd\b|privado|interesa|consulta/i;
const TXT_PRIVADO = "¡Hola! 😊 Soy IRIS, de Orbital. Vi tu comentario y te escribo por acá así te ayudo mejor. ¿Los anteojos son para vos o para regalar? Contame qué estilo te gusta 😎\n(Si tenés una óptica, avisame y te paso con el equipo comercial 🙌)";
const TXT_PUBLICO = "¡Hola! Te escribimos por privado 🙌";

async function manejarComentario(cuentaId: string, v: any) {
  const commentId = v?.id ? String(v.id) : "";
  const texto: string = v?.text ?? "";
  const autorId = v?.from?.id ? String(v.from.id) : "";
  if (!commentId || !texto || !autorId) return;
  if (autorId === cuentaId) return; // nuestras propias respuestas
  if ((await cfg("ig_comentarios")) === "off") return;

  const { error: dup } = await supabase.from("meta_msg_procesados").insert({ mid: `comment:${commentId}` });
  if (dup) return;
  if (!RE_CONSULTA.test(texto)) return;
  if (!PAGE_TOKEN) { console.error("no hay IG_PAGE_TOKEN: no se pudo responder el comentario"); return; }

  // 1) Respuesta privada: llega como DM a quien comentó; si contesta, sigue IRIS normal.
  let recipientId = "";
  try {
    const r = await fetch(`https://graph.facebook.com/v21.0/me/messages?access_token=${PAGE_TOKEN}`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ recipient: { comment_id: commentId }, message: { text: TXT_PRIVADO } }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { console.error("private reply falló", r.status, JSON.stringify(j)); return; }
    recipientId = j?.recipient_id ? String(j.recipient_id) : "";
  } catch (e) {
    console.error("private reply falló", (e as Error).message);
    return;
  }

  // 2) Aviso público corto en el comentario.
  try {
    const r = await fetch(`https://graph.facebook.com/v21.0/${commentId}/replies?access_token=${PAGE_TOKEN}`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: TXT_PUBLICO }),
    });
    if (!r.ok) console.error("respuesta pública falló", r.status, await r.text());
  } catch (e) { console.error("respuesta pública falló", (e as Error).message); }

  // 3) Queda en Conversaciones como cualquier charla de IG, con el comentario de origen.
  if (!recipientId) return;
  const contacto = await contactoPorPsid(recipientId, "instagram");
  const conversacion = await obtenerOCrearConversacion(contacto.id, "instagram");
  const origen = { origen: "comentario", comment_id: commentId, media_id: v?.media?.id ?? null, username: v?.from?.username ?? null };
  await supabase.from("at_mensajes").insert([
    { conversacion_id: conversacion.id, canal: "instagram", emisor: "cliente", contenido: `[comentario en publicación] ${texto}`, metadata: origen },
    { conversacion_id: conversacion.id, canal: "instagram", emisor: "bot", contenido: TXT_PRIVADO, metadata: origen },
  ]);
}

Deno.serve(async (req: Request): Promise<Response> => {
  const url = new URL(req.url);
  if (req.method === "GET") {
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    const leadsToken = await cfg("meta_webhook_verify_token");
    if (mode === "subscribe" && challenge && (token === VERIFY_TOKEN || (leadsToken && token === leadsToken))) {
      return new Response(challenge, { status: 200 });
    }
    return new Response("forbidden", { status: 403 });
  }
  if (req.method !== "POST") return new Response("ok");

  const raw = await req.text();
  if (!(await firmaValida(raw, req.headers.get("x-hub-signature-256")))) {
    return new Response("Invalid signature", { status: 401 });
  }
  let body: any = {};
  try { body = JSON.parse(raw); } catch { /* vacío */ }

  // El objeto dice de dónde viene: 'instagram' son los DM de IG, 'page' es Messenger.
  const canal: Canal = body?.object === "instagram" ? "instagram" : "messenger";

  try {
    for (const entry of body?.entry ?? []) {
      // (a) Mensajería (Instagram DM / Messenger)
      for (const ev of entry?.messaging ?? []) {
        const senderId = ev?.sender?.id;
        const msg = ev?.message;
        if (!senderId || !msg || msg.is_echo) continue;

        // Meta reintenta el envío si no contestamos rápido: sin esto responde de nuevo.
        const mid = msg.mid ?? `${senderId}:${ev.timestamp ?? ""}`;
        const { error: dup } = await supabase.from("meta_msg_procesados").insert({ mid });
        if (dup) continue;

        const texto: string | null = msg.text ?? null;
        const adjuntos = Array.isArray(msg.attachments) ? msg.attachments : [];
        if (!texto && adjuntos.length === 0) continue;

        const contacto = await contactoPorPsid(String(senderId), canal);
        const conversacion = await obtenerOCrearConversacion(contacto.id, canal);

        // v25: fotos y audios. El audio se transcribe y sigue como texto; la foto se mira y, según lo que
        // muestra, sigue a IRIS (modelo reconocido, rotura, comprobante) o recibe una respuesta corta.
        if (!texto && canal === "instagram") {
          const foto = adjuntos.find((a: any) => a?.type === "image" && a?.payload?.url);
          const audio = adjuntos.find((a: any) => a?.type === "audio" && a?.payload?.url);
          if (audio || foto) {
            try {
              await manejarMedia(String(senderId), contacto.id, conversacion, audio ? "audio" : "foto", String((audio ?? foto).payload.url));
            } catch (e) { console.error("media IG", (e as Error).message); }
            continue;
          }
        }

        // Sin texto no hay nada que el bot pueda leer, pero el mensaje existió:
        // se deja anotado para que aparezca en Conversaciones y alguien lo mire.
        if (!texto) {
          const tipos = adjuntos.map((a: any) => a?.type ?? "archivo").join(", ");
          const mencion = canal === "instagram" ? adjuntos.find((a: any) => a?.type === "story_mention") : null;
          await supabase.from("at_mensajes").insert({
            conversacion_id: conversacion.id, canal, emisor: "cliente", contenido: `[adjunto: ${tipos}]`,
            ...(mencion ? { metadata: { origen: "story_mention", url: mencion?.payload?.url ?? null } } : {}),
          });
          if (mencion && await agradecerMencion(String(senderId), conversacion)) {
            await supabase.from("at_mensajes").insert({
              conversacion_id: conversacion.id, canal, emisor: "bot", contenido: TXT_MENCION, metadata: { origen: "story_mention" },
            });
          }
          continue;
        }

        // bot-central registra en at_mensajes tanto el mensaje del cliente como su
        // respuesta: acá no hay que insertar nada o queda todo duplicado.
        const respuesta = await consultarBotCentral({
          conversacionId: conversacion.id, contactoId: contacto.id, canal, texto,
        });
        const salida = respuesta?.texto ?? "";
        if (salida) await enviarMeta(String(senderId), salida, canal);
      }
      // (b) Changes: leadgen (page) -> función de leads; comments (instagram) -> IRIS
      for (const ch of entry?.changes ?? []) {
        if (ch?.field === "leadgen" && ch?.value) await derivarLeadgen(ch.value);
        else if (ch?.field === "comments" && canal === "instagram" && ch?.value) {
          try { await manejarComentario(String(entry?.id ?? ""), ch.value); }
          catch (e) { console.error("comentario IG error", (e as Error).message); }
        }
      }
    }
  } catch (e) {
    console.error("webhook-instagram error", (e as Error).message);
  }
  return new Response("EVENT_RECEIVED", { status: 200 });
});
