// webhook-web — adaptador del widget publico (ChatWidget). Self-contained + CORS.
//
// v26 (2026-09-25): chat de IRIS embebido en la tienda Shopify (public/iris-tienda.js).
//  • identidad.origen = 'shopify' → el contacto anónimo queda como consumidor final
//    (tipo_cliente 'minorista'): IRIS no pregunta "¿sos óptica o consumidor?" y cotiza
//    con el precio de Shopify.
//  • accion 'escuchar': el widget pregunta cada tanto si el equipo le escribió
//    (mensajes 'agente'/'humano' desde la Suite o Telegram). Solo devuelve mensajes de
//    la conversación de ESE sesionId — no alcanza con conocer el conversacionId.
//
// v23 (2026-09-15): el "Para:" lleva la bolita de color del vendedor (mismo mapa que ojo-avisos).
//
// v22 (2026-09-15): si un VENDEDOR ya le escribió al cliente en esta conversación
//  (mensaje 'agente'/'humano' en las últimas 12 h — p.ej. Adrián respondiendo un aviso
//  de Ojo), lo que conteste el cliente NO va a IRIS: se guarda en at_mensajes y cae en
//  el grupo de Telegram colgado del hilo del aviso. Respondiendo ese mensaje, el
//  vendedor le contesta (ojo-telegram → at-responder → chat del catálogo). Antes el
//  cliente contestaba y le respondía IRIS; el vendedor no se enteraba.
//  Devuelve { silencio: true } para que el catálogo no muestre respuesta automática
//  (solo el primer mensaje recibe un acuse corto).
//
// v21 (2026-09-09):
//  • El chat puede venir IDENTIFICADO (catalogo B2B): el contacto se crea con su
//    cod_cliente y como mayorista, asi IRIS no pregunta "sos optica o consumidor",
//    cotiza con la regla correcta y, si deriva, la consulta llega al grupo de
//    Telegram con la razon social.
//  • Se saco el registro del mensaje saliente: bot-central YA lo guarda (quedaba
//    duplicado en el historial y por lo tanto en el contexto que lee IRIS).
//  • SEGURIDAD: el conversacionId que manda el navegador ya no se usa a ciegas. Se
//    valida que exista y que sea de ESE contacto; si no, se usa/crea la suya. Antes,
//    un id cualquiera (o el de otro cliente) se aceptaba tal cual.
import { createClient } from "jsr:@supabase/supabase-js@2";

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
// Mismo plazo con el que bot-central reabre una conversación derivada.
const TOMA_VENDEDOR_HORAS = 12;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Identidad = { cod_cliente?: string | null; label?: string | null; vendedor?: string | null; origen?: string | null };

async function obtenerOCrearContacto(email: string, tienda = false) {
  const { data: ex } = await supabase.from("contactos").select("id, tipo_cliente").eq("email", email).maybeSingle();
  if (ex) {
    // Quien chatea desde la tienda es consumidor final, aunque antes haya usado otro widget.
    if (tienda && !ex.tipo_cliente) await supabase.from("contactos").update({ tipo_cliente: "minorista" }).eq("id", ex.id);
    return ex;
  }
  const nuevo: Record<string, unknown> = { email };
  if (tienda) { nuevo.tipo_cliente = "minorista"; nuevo.nombre = "Visitante tienda online"; }
  const { data, error } = await supabase.from("contactos").insert(nuevo).select("id").single();
  if (error) throw error;
  return data;
}

async function contactoIdentificado(ident: Identidad) {
  const cod = String(ident.cod_cliente);
  const { data: ex } = await supabase.from("contactos").select("id").eq("cod_cliente", cod).maybeSingle();
  if (ex) return ex;

  const { data: cli } = await supabase.from("clientes")
    .select("razon, telefono, whatsapp, email").eq("cod", cod).maybeSingle();

  const nombre = cli?.razon ?? (ident.label ?? cod);
  const { data, error } = await supabase.from("contactos").insert({
    cod_cliente: cod,
    nombre,
    telefono: cli?.whatsapp ?? cli?.telefono ?? null,
    email: cli?.email ?? `catalogo:${cod}`,
    tipo_cliente: "mayorista",
  }).select("id").single();
  if (error) throw error;
  return data;
}

async function conversacionDelContacto(contactoId: string, pedida: string | null) {
  if (pedida) {
    const { data } = await supabase.from("at_conversaciones").select("id")
      .eq("id", pedida).eq("contacto_id", contactoId).maybeSingle();
    if (data) return data;
  }
  const { data: ex } = await supabase.from("at_conversaciones").select("id")
    .eq("contacto_id", contactoId).in("estado", ["bot_activo", "derivada"]).maybeSingle();
  if (ex) return ex;
  const { data, error } = await supabase.from("at_conversaciones")
    .insert({ contacto_id: contactoId, canal_origen: "web" }).select("id").single();
  if (error) throw error;
  return data;
}

async function consultarBotCentral(params: { conversacionId: string; contactoId: string; canal: string; texto: string }) {
  const res = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/bot-central`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(params),
  });
  return res.json();
}

// ---------- Escuchar respuestas del equipo (v26) ----------
async function escuchar(sesionId: string, conversacionId: string | null, desde: string | null) {
  if (!conversacionId) return [];
  const { data: ct } = await supabase.from("contactos").select("id").eq("email", `anon:${sesionId}`).maybeSingle();
  if (!ct) return [];
  const { data: conv } = await supabase.from("at_conversaciones").select("id")
    .eq("id", conversacionId).eq("contacto_id", ct.id).maybeSingle();
  if (!conv) return [];
  let q = supabase.from("at_mensajes").select("contenido, created_at")
    .eq("conversacion_id", conv.id).in("emisor", ["agente", "humano"])
    .order("created_at", { ascending: true }).limit(20);
  if (desde) q = q.gt("created_at", desde);
  const { data } = await q;
  return data ?? [];
}

// ---------- Charla con el vendedor (v22) ----------

// Devuelve el nombre del vendedor que escribió en las últimas horas, o null si nadie.
async function vendedorEnCharla(convId: string): Promise<string | null> {
  const desde = new Date(Date.now() - TOMA_VENDEDOR_HORAS * 36e5).toISOString();
  const { data } = await supabase.from("at_mensajes").select("contenido")
    .eq("conversacion_id", convId).in("emisor", ["agente", "humano"]).gte("created_at", desde)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!data) return null;
  // at-responder guarda "Adrian: texto"
  const m = /^([^:\n]{2,30}):\s/.exec(String(data.contenido ?? ""));
  return m ? m[1].trim() : "el vendedor";
}

// Color de cada persona del grupo (mismo mapa que ojo-avisos).
const COLORES: Record<string, string> = {
  adrian: "🟢", bruno: "🔵", ulises: "🟣", mauro: "🟠", gus: "🟡", gustavo: "🟡",
  gaston: "⚫", corporativo: "⚫", administracion: "🟤", orbital: "🟤", postventa: "⚪",
};
function marca(n: string): string {
  const k = n.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().split(/[\s(]+/)[0] ?? "";
  return COLORES[k] ? `${COLORES[k]} ${n}` : n;
}

function escapar(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function tgSend(chatId: number, text: string, replyTo?: number): Promise<number | null> {
  if (!TELEGRAM_BOT_TOKEN) return null;
  const payload: Record<string, unknown> = { chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true };
  if (replyTo) payload.reply_to_message_id = replyTo;
  let r = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
  });
  let j = await r.json().catch(() => null);
  if (!j?.ok && replyTo) {
    // Si el mensaje ancla ya no existe, igual lo mando suelto (queda anclado igual por ojo_hilos).
    delete payload.reply_to_message_id;
    r = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
    });
    j = await r.json().catch(() => null);
  }
  if (!j?.ok) console.error("tgSend", JSON.stringify(j));
  return j?.result?.message_id ?? null;
}

async function quienEs(contactoId: string): Promise<string> {
  const { data: ct } = await supabase.from("contactos").select("nombre, cod_cliente").eq("id", contactoId).maybeSingle();
  if (ct?.cod_cliente) {
    const { data: cl } = await supabase.from("clientes").select("razon, nomcomerc").eq("cod", ct.cod_cliente).maybeSingle();
    if (cl) return cl.nomcomerc || cl.razon || ct.cod_cliente;
  }
  return ct?.nombre || "Cliente del catálogo";
}

async function pasarAlVendedor(convId: string, contactoId: string, vendedor: string, texto: string) {
  const { data: grupos } = await supabase.from("ojo_grupos")
    .select("telegram_chat_id").eq("activo", true).eq("recibe_avisos", true).limit(1);
  const chatId = grupos?.[0]?.telegram_chat_id as number | undefined;
  if (!chatId) return;

  // Se cuelga del último mensaje del hilo: así queda seguido de lo que escribió el vendedor.
  const { data: ancla } = await supabase.from("ojo_hilos")
    .select("telegram_message_id").eq("conversacion_id", convId).eq("telegram_chat_id", chatId)
    .order("creado_en", { ascending: false }).limit(1).maybeSingle();

  const quien = await quienEs(contactoId);
  const enviado = await tgSend(chatId,
    `💬 <b>${escapar(quien)}</b> te contestó en el catálogo · Para: <b>${escapar(marca(vendedor))}</b>\n` +
    `«${escapar(texto.slice(0, 1500))}»\n\n` +
    `<i>Respondé este mensaje y le aparece en el chat del catálogo.</i>`,
    ancla?.telegram_message_id);

  if (enviado) {
    await supabase.from("ojo_hilos").upsert(
      { telegram_chat_id: chatId, telegram_message_id: enviado, conversacion_id: convId },
      { onConflict: "telegram_chat_id,telegram_message_id" },
    );
  }
}
// ---------- fin charla con el vendedor ----------

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (x: unknown, status = 200) => new Response(JSON.stringify(x), { status, headers: { ...cors, "content-type": "application/json" } });
  try {
    const { conversacionId, sesionId, texto, identidad, accion, desde } = await req.json();

    if (accion === "escuchar") {
      if (!sesionId) return json({ error: "falta sesionId" }, 400);
      return json({ mensajes: await escuchar(String(sesionId), conversacionId ?? null, desde ?? null) });
    }

    if (!texto || !sesionId) return json({ error: "falta sesionId o texto" }, 400);

    const ident: Identidad | null = identidad ?? null;
    const contacto = ident?.cod_cliente
      ? await contactoIdentificado(ident)
      : await obtenerOCrearContacto(`anon:${sesionId}`, ident?.origen === "shopify");

    const conversacion = await conversacionDelContacto(contacto.id, conversacionId ?? null);

    // Solo el chat identificado del catálogo: el widget público anónimo sigue con IRIS.
    const vendedor = ident?.cod_cliente ? await vendedorEnCharla(conversacion.id) : null;
    if (vendedor) {
      // ¿Ya le contestó algo al vendedor en esta charla? Entonces sin acuse (no repetir).
      const { data: vendMsg } = await supabase.from("at_mensajes").select("created_at")
        .eq("conversacion_id", conversacion.id).in("emisor", ["agente", "humano"])
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      const { count: yaContesto } = await supabase.from("at_mensajes").select("id", { count: "exact", head: true })
        .eq("conversacion_id", conversacion.id).eq("emisor", "cliente").gt("created_at", vendMsg?.created_at ?? new Date().toISOString());

      const { error: errIns } = await supabase.from("at_mensajes").insert({
        conversacion_id: conversacion.id, canal: "web", emisor: "cliente", contenido: texto,
      });
      if (errIns) console.error("no se pudo registrar el mensaje del cliente", errIns.message);

      try { await pasarAlVendedor(conversacion.id, contacto.id, vendedor, texto); }
      catch (e) { console.error("pasar al vendedor", (e as Error).message); }

      const acuse = yaContesto ? "" : `Le pasé tu mensaje a ${vendedor}, te contesta por acá 🙌`;
      return json({ conversacionId: conversacion.id, texto: acuse, silencio: !acuse, vendedor });
    }

    const respuesta = await consultarBotCentral({ conversacionId: conversacion.id, contactoId: contacto.id, canal: "web", texto });

    return json({ conversacionId: conversacion.id, ...respuesta });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
