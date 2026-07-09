// ============================================================================
// Orbital Eyewear · Edge Function `wa-webhook` — Fase 1 (Esqueleto sin LLM)
// ----------------------------------------------------------------------------
// GET  → verificación del webhook (hub.challenge)
// POST → recepción de mensajes, con validación de firma HMAC, cola idempotente,
//        resolución de segmento en SQL, y cascada de resolución escalones 1-2 + 5.
//
// El LLM (escalones 3-4) llega en Fase 3. Acá todo el tráfico muere en el menú,
// las reglas/regex, respuestas curadas de base_conocimiento, o escala a humano.
// ============================================================================

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { firmaValida } from "./firma.ts";
import { crearCliente } from "./db.ts";
import * as db from "./db.ts";
import { construirMenu } from "./menu.ts";
import { clasificarTexto, detectarEscalamiento } from "./reglas.ts";
import { enviarLista, enviarTexto } from "./whatsapp.ts";
import { extraerEntrante, type EntranteNormalizado, type Segmento, type WaWebhookPayload } from "./types.ts";

const VERIFY_TOKEN = Deno.env.get("VERIFY_TOKEN") ?? "";
const APP_SECRET = Deno.env.get("APP_SECRET") ?? "";
const WHATSAPP_TOKEN = Deno.env.get("WHATSAPP_TOKEN") ?? "";
const PHONE_NUMBER_ID = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID") ?? "";
const RATE_LIMIT = Number(Deno.env.get("RATE_LIMIT_POR_MINUTO") ?? "15");

const MSG_TRANSICION = "Dejame que te pase con alguien del equipo, en un rato te escriben.";
const MSG_NO_ENTENDI = "No te entendí del todo. Te dejo el menú para que elijas 👇";

// Intenciones que dependen de datos vivos (precios/stock/pedidos) → Fase 4.
const INTENCIONES_DATOS = new Set(["precios", "stock", "estado_pedido"]);
// Intenciones/menú que piden humano explícito.
const PIDE_HUMANO = new Set(["hablar_humano"]);

// Log seguro: nunca el contenido completo del mensaje en nivel info.
function log(evento: string, extra: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ evento, ...extra }));
}

Deno.serve(async (req: Request): Promise<Response> => {
  const url = new URL(req.url);

  // ---- Verificación del webhook (GET) -------------------------------------
  if (req.method === "GET") {
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    if (mode === "subscribe" && token === VERIFY_TOKEN && challenge) {
      return new Response(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
    }
    return new Response("Forbidden", { status: 403 });
  }

  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  // ---- Firma HMAC sobre el body CRUDO -------------------------------------
  const rawBody = await req.text();
  const firmaOk = await firmaValida(rawBody, req.headers.get("x-hub-signature-256"), APP_SECRET);
  if (!firmaOk) {
    log("firma_invalida");
    return new Response("Invalid signature", { status: 401 });
  }

  // A partir de acá siempre respondemos 200 rápido: Meta reintenta si no.
  // El procesamiento (sin LLM en Fase 1) es liviano y corre inline.
  let payload: WaWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as WaWebhookPayload;
  } catch {
    log("body_no_json");
    return new Response("Bad Request", { status: 400 });
  }

  try {
    const supabase = crearCliente();
    for (const entry of payload.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const value = change.value;
        // Ignoramos statuses (delivered/read) en Fase 1; sólo mensajes entrantes.
        for (const msg of value?.messages ?? []) {
          await procesarMensaje(supabase, extraerEntrante(msg));
        }
      }
    }
  } catch (e) {
    // Nunca tragamos la excepción en silencio: queda en logs. El 200 evita
    // que Meta reintente y duplique; el mensaje quedó persistido en la cola
    // y su estado refleja el error para reproceso.
    log("error_procesamiento", { detalle: (e as Error).message });
  }

  return new Response("EVENT_RECEIVED", { status: 200 });
});

async function procesarMensaje(
  supabase: ReturnType<typeof crearCliente>,
  e: EntranteNormalizado,
): Promise<void> {
  // 1) Persistencia idempotente en cola (id de Meta único).
  const mensajeId = await db.insertarEntranteIdempotente(supabase, {
    wa_message_id: e.waMessageId,
    telefono: e.from,
    tipo: e.tipo,
    contenido: e.texto,
    payload: e.payload,
  });
  if (mensajeId === null) {
    log("duplicado_ignorado", { wa_id: e.waMessageId });
    return; // reintento de Meta → no reprocesar ni responder
  }

  try {
    // 2) Rate limit por teléfono.
    const recientes = await db.contarEntrantesRecientes(supabase, e.from, 60);
    if (recientes > RATE_LIMIT) {
      log("rate_limit", { telefono_hash: hash(e.from), recientes });
      await db.marcarProcesado(supabase, mensajeId, null, null);
      return;
    }

    // 3) Segmento (filtro en SQL) + conversación.
    const res = await db.resolverSegmento(supabase, e.from);
    const conv = await db.upsertConversacion(supabase, res, e.from);
    log("entrante", {
      telefono_hash: hash(e.from),
      segmento: conv.segmento,
      tipo: e.tipo,
      requiere_humano: conv.requiere_humano,
    });

    // 4) Escalamiento de una sola vía: si ya está con humano, el bot se calla.
    if (conv.requiere_humano) {
      await db.marcarProcesado(supabase, mensajeId, null, "humano");
      return;
    }

    // 5) Determinar intención: reply de menú (id) o clasificación por texto.
    const intencion = e.replyId ?? (e.texto ? clasificarTexto(e.texto) : null);

    // 6) Escalamiento por contenido / intención.
    const motivo = decidirEscalamiento(e.texto, intencion, conv.segmento);
    if (motivo) {
      await db.escalarConversacion(supabase, conv.id, motivo);
      await enviar(supabase, conv.id, e.from, MSG_TRANSICION, intencion, "humano");
      await db.marcarProcesado(supabase, mensajeId, intencion, "humano");
      log("escalado", { telefono_hash: hash(e.from), motivo });
      return;
    }

    // 7) Datos vivos (precios/stock/pedido) para b2b_inactivo / b2c → redirect seguro.
    if (intencion && INTENCIONES_DATOS.has(intencion)) {
      const texto = redirectDatos(intencion, conv.segmento);
      await enviar(supabase, conv.id, e.from, texto, intencion, "regla");
      await db.marcarProcesado(supabase, mensajeId, intencion, "regla");
      return;
    }

    // 8) Saludo / sin intención → menú (escalón 1).
    if (!intencion || intencion === "saludo") {
      await enviarMenu(supabase, conv.id, e.from, conv.segmento);
      await db.marcarProcesado(supabase, mensajeId, intencion ?? "saludo", "menu");
      return;
    }

    // 9) Respuesta curada con filtro de segmento en SQL (escalón 2/3-curado).
    const respuesta = await db.buscarRespuestaCurada(supabase, intencion, conv.segmento);
    if (respuesta) {
      const escalon = e.replyId ? "menu" : "regla";
      await enviar(supabase, conv.id, e.from, respuesta, intencion, escalon);
      await db.marcarProcesado(supabase, mensajeId, intencion, escalon);
      return;
    }

    // 10) Intención reconocida pero no permitida/curada para este segmento → menú.
    await enviarMenu(supabase, conv.id, e.from, conv.segmento, MSG_NO_ENTENDI);
    await db.marcarProcesado(supabase, mensajeId, intencion, "menu");
  } catch (err) {
    await db.marcarError(supabase, mensajeId, (err as Error).message);
    log("error_mensaje", { wa_id: e.waMessageId, detalle: (err as Error).message });
  }
}

// Decide si corresponde escalar a humano. Devuelve el motivo o null.
function decidirEscalamiento(
  texto: string | null,
  intencion: string | null,
  segmento: Segmento,
): string | null {
  if (intencion && PIDE_HUMANO.has(intencion)) return "pedido_humano";
  if (texto) {
    const m = detectarEscalamiento(texto);
    if (m) return m;
  }
  // Un b2b_activo consultando datos vivos: en Fase 1 aún no hay tabla conectada,
  // así que lo atiende una persona. En Fase 4 esto lo resuelve function calling.
  if (segmento === "b2b_activo" && intencion && INTENCIONES_DATOS.has(intencion)) {
    return "consulta_datos_b2b";
  }
  return null;
}

// Redirect seguro para precios/stock/pedido cuando NO es b2b_activo.
// Nunca expone precios mayoristas: el contenido restringido no existe acá.
function redirectDatos(intencion: string, segmento: Segmento): string {
  if (segmento === "b2b_inactivo") {
    return "La lista de precios y el stock te los pasa directamente el vendedor de tu zona. " +
      "Contame de dónde sos y te digo quién te atiende.";
  }
  // b2c
  if (intencion === "precios") {
    return "Orbital se vende a través de ópticas, así que no manejamos precio de venta directa. " +
      "Escribinos tu localidad y te decimos qué óptica cerca tuyo tiene la colección.";
  }
  return "Eso lo maneja cada óptica que trabaja con Orbital. Decime tu localidad y te oriento " +
    "sobre dónde encontrar los modelos.";
}

async function enviarMenu(
  supabase: ReturnType<typeof crearCliente>,
  conversacionId: number,
  telefono: string,
  segmento: Segmento,
  prefijo?: string,
): Promise<void> {
  const menu = construirMenu(segmento);
  const cuerpo = prefijo ? `${prefijo}\n\n${menu.cuerpo}` : menu.cuerpo;
  const r = await enviarLista(WHATSAPP_TOKEN, PHONE_NUMBER_ID, telefono, cuerpo, menu.boton, menu.secciones, menu.header);
  if (!r.ok) throw new Error(`envío menú falló: ${r.status} ${JSON.stringify(r.body)}`);
  await db.registrarSaliente(supabase, conversacionId, telefono, "[menú interactivo]", "menu", "menu");
}

async function enviar(
  supabase: ReturnType<typeof crearCliente>,
  conversacionId: number,
  telefono: string,
  texto: string,
  intencion: string | null,
  escalon: string,
): Promise<void> {
  const r = await enviarTexto(WHATSAPP_TOKEN, PHONE_NUMBER_ID, telefono, texto);
  if (!r.ok) throw new Error(`envío texto falló: ${r.status} ${JSON.stringify(r.body)}`);
  await db.registrarSaliente(supabase, conversacionId, telefono, texto, intencion, escalon);
}

// Hash corto no reversible para loggear el teléfono sin exponerlo.
function hash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16);
}
