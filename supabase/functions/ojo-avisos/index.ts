import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Ojo — nexo entre el sistema y el grupo de Telegram.
// v5: el aviso de derivacion queda anclado a la conversacion (ojo_hilos).
// v6: la visita al catalogo es una señal: responsable + link wa.me; revendedores aparte.
// v8 (2026-09-09): los avisos que valen (visita larga y carrito) tambien quedan
//   anclados a la conversacion del cliente, asi el vendedor se mete en la charla
//   respondiendo el aviso: el mensaje le aparece EN VIVO en el catalogo, con el mismo
//   mecanismo ya probado de las derivaciones (ojo_hilos -> at-responder -> at_mensajes).
// v9 (2026-09-10, pedido de Gaston):
//   • el aviso de visita sale al MINUTO y ya viene anclado (antes 5 min): hay que poder
//     hablarle mientras todavia esta mirando el catalogo.
//   • a la mañana, a cada vendedor, las opticas que abrieron el catalogo ayer y no
//     compraron: con quien hablar hoy y por que (tiempo adentro, carrito).
//   • la tanda trae impulso a la mañana y, a la tarde, al que no mando nada le deja
//     la orden para mañana. Con un chiste, que el ambiente sea relajado.
// v10 (2026-09-11): en Telegram NO se habla de plata de pedidos, precargas ni carritos:
//   solo cantidades.
// v11 (2026-09-11): dia de sol = dia de vender sol + dato de Triple Proteccion (rotativo).
// v12 (2026-09-11): todo el territorio propio. Pronostico del dia en 16 capitales
//   (Open-Meteo, sin key); la primera vez entre las 9 y las 15 que hay provincias con sol:
//   • aviso al grupo con la mas calurosa arriba ("30° en Mendoza: ideal para vender sol")
//   • de lunes a viernes, TANDA DE SOL: generar_tanda_sol() suma a la tanda de hoy
//     opticas de esas provincias, cada una a quien le toca por zona (pieza tema 'dia_sol').
//   ?preview=sol devuelve clima + tanda SIMULADA + texto, sin mandar ni insertar nada.
// v13 (2026-09-11, Gaston: "si el calor es muy fuerte es la oportunidad"): desde 30° el
//   aviso sube el tono (calor fuerte = LA oportunidad) y la tanda de sol pasa de 10 a 15
//   opticas por persona. ?preview=sol&calor=33 simula la maxima para ver el texto.
// v14 (2026-09-11): tambien avisa los pedidos por FOTO que leyo IRIS (bot_foto_pedido);
//   antes solo avisaba las precargas del catalogo y las de foto no llegaban nunca.
// v15 (2026-09-11): tambien avisa los pedidos cargados directo en la Suite (tabla pedidos,
//   sin Tienda). Los que salieron de una precarga (catalogo/foto) no se repiten.
//   ?desde=<fecha ISO> recorre los pedidos desde esa fecha (recuperar avisos atrasados).
// v16 (2026-09-14, Gaston: "que muestre todos los pedidos que se cargan"): se avisan TODOS
//   los pedidos de la Suite. El filtro de v15 (saltear si el cliente tuvo precarga en los 3
//   dias previos) silenciaba pedidos distintos: una precarga tapaba todo lo que ese cliente
//   comprara en 3 dias (Optisur, Gafas Luxury, Cristaldo...). Ahora solo se aclara en el aviso
//   si tenia precarga reciente. Unico salteo: origen ojo-telegram (se cargo desde el grupo).
// v17 (2026-09-14, Gaston: "no le esta llegando a Ulises"): el 🆘 salia al grupo sin decir
//   a quien le tocaba y a esa persona no le llegaba nada; 3 clientes quedaron 2 dias con
//   "mañana a primera hora te escribe" sin que nadie les escriba. Ahora el 🆘 dice "Para:"
//   y ademas le llega por WhatsApp directo al asignado (vendedores.telefono_remitente).
//   Con header x-internal-key (= meta_webhook_verify_token) acepta POST {accion, derivacion_id}:
//   'avisar_asignado' reenvia ese WhatsApp; 'recontactar' le manda al cliente la plantilla
//   primer_contacto_lead (fuera de las 24 h el texto libre no sale) y la registra en at_mensajes.
// v18 (2026-09-15, Gaston: "que cada usuario tenga su color"): Telegram no deja pintar las
//   burbujas, asi que cada persona lleva su bolita de color delante del nombre (COLORES).
// v19 (2026-09-16, Gaston: "avisar cuando entran a las propuestas y si entra al catalogo
//   tambien, sobre la misma propuesta"):
//   • 📄 aviso cuando una optica abre la propuesta Bienvenida o Canje (landing_visita con token).
//   • si despues entra al catalogo, el aviso sale COMO RESPUESTA a ese mensaje (mismo hilo),
//     sin esperar el minuto adentro. Los mensajes quedan en ojo_propuesta_hilos (7 dias).
// v23 (2026-09-23, Gaston): los avisos del catalogo (propuesta, visita, carrito) que le tocan a
//   Corporativo/Gaston traen botones "Derivar a…" / "Me lo quedo"; los atiende ojo-conteo (drv:*).
// v24 (2026-09-23, Gaston): el aviso de carrito sin confirmar trae "📥 Pasarlo a precarga" (prc:<acceso>,
//   lo atiende ojo-conteo con ojo_carrito_a_precarga) para que el vendedor no dependa de que el cliente cierre.
// v25 (2026-09-25, Gaston): cuando el cliente cierra el catalogo (3 min sin latido) sale en el mismo
//   hilo "🚪 cerró el catálogo — ya no ve el chat" + link para mandarle WhatsApp. No sale si confirmo pedido.
// v21 (2026-09-16, Gaston: "es corporativo"): el responsable de esos avisos es quien le
//   MANDO el link (catalogo_acceso.enviado_por, lo graba catalogo_link_cliente) o la
//   propuesta (envios_propuesta), el mas reciente; recien si no hay, el vendedor asignado.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const WHATSAPP_TOKEN = Deno.env.get("WHATSAPP_TOKEN") ?? "";
const PHONE_NUMBER_ID = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID") ?? "";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const MIN_SEGUNDOS_VISITA = 60;   // aviso + chat anclado desde el minuto
const SEGUNDOS_CALIENTE = 300;    // 🔥 y ofrecer agendar llamada
const MIN_CIERRE_MS = 3 * 60 * 1000; // v25: sin latido hace 3 min = cerro el catalogo
const MAX_RECOS_POR_VENDEDOR = 8;
const CUPO_TANDA_SOL = 10;        // opticas extra por persona los dias de sol
const CALOR_FUERTE = 30;          // °C de maxima: desde aca es LA oportunidad
const CUPO_TANDA_CALOR = 15;      // opticas extra por persona los dias de calor fuerte

// Propuestas con landing que se avisan al abrirse (v19)
const PROPUESTAS: Record<string, string> = { bienvenida: "🎁 Paquete de Bienvenida", canje: "🔄 Plan Canje" };

const NOMBRES: Record<string, string> = {
  Adrian: "Adrián", Damian: "Damián", Martin: "Martín", Gaston: "Gastón",
  Corporativo: "Corporativo (Gastón)", Marketing: "Luna", ProspeccionVenta: "Damián",
};

// Color de cada persona del grupo (primera palabra del nombre, sin acentos).
const COLORES: Record<string, string> = {
  adrian: "🟢", bruno: "🔵", lola: "🔴", ulises: "🟣", mauro: "🟠", gus: "🟡", gustavo: "🟡",
  gaston: "⚫", corporativo: "⚫", administracion: "🟤", orbital: "🟤", postventa: "⚪",
};
function marca(n: string | null | undefined): string {
  const s = String(n ?? "").trim();
  const k = s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().split(/[\s(]+/)[0] ?? "";
  const c = COLORES[k];
  return c ? `${c} ${s}` : s;
}
const nombre = (cod: string | null) => (cod ? marca(NOMBRES[cod] ?? cod) : "Sin vendedor asignado");

const CHISTES = [
  "El que no manda la tanda, después no la ve… y eso que vendemos anteojos 🤓",
  "Tanda que no se manda se empaña como lente en invierno 🥶👓",
  "Si la óptica no ve el catálogo no es miopía: es que no le llegó el link 😅",
  "Café en una mano, tanda en la otra. Multitasking nivel Orbital ☕",
  "Un carrito abandonado también tiene sentimientos. Llamalo 🛒💔",
  "Dato científico: la óptica que no recibe mensaje compra 0%. Lo dice la ciencia (y el Excel) 📈",
  "Hoy es un gran día para vender anteojos. Como todos los días que terminan en 'día' 😎",
];
function chisteDelDia(fecha: string, salto = 0): string {
  const n = fecha.split("-").reduce((s, x) => s + Number(x), 0) + salto;
  return CHISTES[n % CHISTES.length];
}

// ── Dia de sol ──────────────────────────────────────────────────────────────────────────
// Una ciudad por provincia del territorio propio; provs = provincia normalizada
// (lower + sin acento), igual que territorio_propio.provincia_norm.
type Ciudad = { nombre: string; lat: number; lon: number; provs: string[] };
const CIUDADES: Ciudad[] = [
  { nombre: "AMBA", lat: -34.61, lon: -58.38, provs: ["caba", "ciudad autonoma de buenos aires", "buenos aires"] },
  { nombre: "Rosario", lat: -32.95, lon: -60.65, provs: ["santa fe"] },
  { nombre: "Paraná", lat: -31.73, lon: -60.53, provs: ["entre rios"] },
  { nombre: "Mendoza", lat: -32.89, lon: -68.84, provs: ["mendoza"] },
  { nombre: "San Juan", lat: -31.54, lon: -68.54, provs: ["san juan"] },
  { nombre: "San Luis", lat: -33.30, lon: -66.34, provs: ["san luis"] },
  { nombre: "Salta", lat: -24.79, lon: -65.41, provs: ["salta"] },
  { nombre: "Jujuy", lat: -24.19, lon: -65.30, provs: ["jujuy"] },
  { nombre: "Tucumán", lat: -26.82, lon: -65.22, provs: ["tucuman"] },
  { nombre: "Catamarca", lat: -28.47, lon: -65.78, provs: ["catamarca"] },
  { nombre: "La Rioja", lat: -29.41, lon: -66.86, provs: ["la rioja"] },
  { nombre: "Santiago del Estero", lat: -27.80, lon: -64.26, provs: ["santiago del estero"] },
  { nombre: "Resistencia", lat: -27.45, lon: -58.99, provs: ["chaco"] },
  { nombre: "Corrientes", lat: -27.47, lon: -58.83, provs: ["corrientes"] },
  { nombre: "Formosa", lat: -26.18, lon: -58.18, provs: ["formosa"] },
  { nombre: "Posadas", lat: -27.37, lon: -55.90, provs: ["misiones"] },
];
const LINK_TP = "https://ver.orbitaleyewear.com.ar/tripleproteccion";

type Clima = Ciudad & { max: number; uv: number; code: number; lluvia: number; solH: number };

async function climaPais(): Promise<Clima[]> {
  const url = "https://api.open-meteo.com/v1/forecast" +
    `?latitude=${CIUDADES.map((c) => c.lat).join(",")}&longitude=${CIUDADES.map((c) => c.lon).join(",")}` +
    "&daily=weather_code,temperature_2m_max,uv_index_max,precipitation_probability_max,sunshine_duration" +
    "&timezone=America%2FArgentina%2FBuenos_Aires&forecast_days=1";
  try {
    const r = await fetch(url);
    if (!r.ok) { console.error("clima", r.status); return []; }
    const j = await r.json();
    const arr = Array.isArray(j) ? j : [j];
    const out: Clima[] = [];
    CIUDADES.forEach((c, i) => {
      const d = arr[i]?.daily;
      if (!d) return;
      out.push({
        ...c, max: d.temperature_2m_max?.[0] ?? 0, uv: d.uv_index_max?.[0] ?? 0, code: d.weather_code?.[0] ?? 99,
        lluvia: d.precipitation_probability_max?.[0] ?? 100, solH: (d.sunshine_duration?.[0] ?? 0) / 3600,
      });
    });
    return out;
  } catch (e) { console.error("clima", String(e)); return []; }
}

// Dia de sol: pronostico del dia sin lluvia ni tormenta, UV que pega y muchas horas de sol.
// (Las horas de sol solas engañan: un dia con tormenta a la tarde igual suma 9 h.)
const haySol = (c: Clima) =>
  c.lluvia < 40 && c.solH >= 7 && c.uv >= 5 && (c.code <= 3 || (c.code <= 53 && c.lluvia < 25));

const esCalorFuerte = (soleadas: Clima[]) => soleadas.length > 0 && soleadas[0].max >= CALOR_FUERTE;

function nivelUV(uv: number): string {
  if (uv < 3) return "bajo";
  if (uv < 6) return "moderado";
  if (uv < 8) return "alto";
  if (uv < 11) return "muy alto";
  return "extremo";
}

// Datos de Triple Proteccion (fuente: tabla conocimiento + landing /tripleproteccion). Uno por dia.
const DATOS_TP: { dato: string; frase: string }[] = [
  { dato: "🔥 <b>Infrarrojo, el argumento que nadie usa.</b> Todos venden UV400 y blue cut; del IR no habla nadie. Es la radiación que genera el calor y la fatiga visual bajo sol fuerte: justo lo que hay hoy.",
    frase: "Con este sol, lo que cansa la vista es el infrarrojo. Este cristal lo filtra, y casi ningún anteojo del mercado lo tiene." },
  { dato: "🧴 <b>Vendé antiage, no un cristal.</b> El infrarrojo llega más profundo que el UV, hasta la piel del contorno de ojos.",
    frase: "¿Te ponés protector solar en el contorno de ojos? —Nunca. Entonces el anteojo es lo único que protege esa zona." },
  { dato: "☀️ <b>UV400 = 100% de UVA y UVB.</b> Pero que el anteojo diga UV400 no alcanza: la diferencia está en la calidad óptica del cristal. VSL HD: más contraste y nitidez, menos deslumbramiento.",
    frase: "El daño del sol no se ve, se acumula. Por eso importa el cristal, no la etiqueta." },
  { dato: "💠 <b>Un solo par para calle, auto y pantalla.</b> Blue Cut filtra la luz azul hasta 420 nm (pantallas y LED), más UV400 e infrarrojo, todo en el mismo cristal.",
    frase: "Sale al sol, maneja y mira el celular con el mismo anteojo. No tiene que cambiarse." },
  { dato: "⭐ <b>Único en Argentina.</b> Las tres protecciones juntas en un cristal de sol hoy sólo se consiguen en cristal premium a pedido. Nosotros las tenemos en producto de línea, con stock y entrega inmediata.",
    frase: "Esto no lo vas a encontrar en otra marca de línea. Y te lo entrego ya." },
  { dato: "🕶 <b>Toda la línea sol la tiene.</b> Cada modelo de sol, urbano o deportivo, viene con Triple Protección y cristal VSL HD: no hay que elegir modelo para tener la tecnología.",
    frase: "Elegí por diseño: la protección ya viene en todos." },
  { dato: "💬 <b>Si te dicen «está caro».</b> Es premium con Triple Protección: mejor margen y diferenciación real. No se compite por precio, se compite por valor.",
    frase: "No es un anteojo más: es el único con las tres protecciones. Eso tu vendedor lo explica en 10 segundos en el mostrador." },
];

// soleadas: ordenadas por maxima, la mas calurosa primero. tanda: por_usuario de generar_tanda_sol.
function textoSol(soleadas: Clima[], tanda: Record<string, number> | null, hoyAR: string, mes: number): string {
  const d = DATOS_TP[Math.floor(Date.parse(hoyAR) / 86400000) % DATOS_TP.length];
  const temporada = mes >= 9 || mes <= 3;
  const top = soleadas[0];
  const fuerte = esCalorFuerte(soleadas);
  const uvTop = soleadas.reduce((a, c) => (c.uv > a.uv ? c : a), top);
  const uv = Math.round(uvTop.uv);
  const lista = soleadas.slice(0, 10).map((c) => `${c.nombre} ${Math.round(c.max)}°`).join(" · ");
  const calientes = soleadas.filter((c) => c.max >= CALOR_FUERTE).slice(1).map((c) => `${c.nombre} ${Math.round(c.max)}°`);

  const titular = fuerte
    ? `🔥🔥 <b>¡${Math.round(top.max)}° en ${top.nombre}! Calor fuerte = LA oportunidad para vender anteojos de sol</b>\n` +
      (calientes.length ? `Calor fuerte también en: ${calientes.join(" · ")}\n` : "")
    : `☀️ <b>${Math.round(top.max)}° en ${top.nombre}: ideal para vender anteojos de sol!</b>\n`;

  const partes: string[] = [
    titular +
    `Hoy hay sol en: ${lista}\n` +
    `UV ${uv} (${nivelUV(uv)}) en ${uvTop.nombre}.`,
    (temporada
      ? `Estamos en <b>temporada alta de anteojos de sol</b> y el clima acompaña: `
      : `El clima acompaña: `) +
    (fuerte
      ? `con este calor el anteojo de sol deja de ser un gusto y pasa a ser necesidad. <b>Hoy la óptica que tiene sol a la vista vende sola: que sea la nuestra.</b>\n` +
        `• Hoy no se espera a que llamen: llamá y ofrecé reponer sol ya.\n` +
        `• Pedile a la óptica que ponga sol en vidriera y mostrador hoy mismo.\n` +
        `• El argumento del día es el infrarrojo: es justo la radiación del calor, y casi ningún anteojo lo filtra.\n` +
        `• En los WhatsApp usá el calor: «con ${Math.round(top.max)}° la gente entra pidiendo sol…»`
      : `hoy la gente entra a la óptica pidiendo sol. <b>Es el día para empujar la línea sol.</b>\n` +
        `• En cada visita o llamada, arrancá por sol.\n` +
        `• Pedile a la óptica que ponga sol en vidriera y mostrador hoy.\n` +
        `• En los WhatsApp de hoy usá el clima: «con este solazo…»`),
  ];

  const reparto = Object.entries(tanda ?? {}).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
  if (reparto.length > 0) {
    const total = reparto.reduce((s, [, n]) => s + n, 0);
    partes.push(
      `🗺 <b>Tanda de ${fuerte ? "calor" : "sol"}</b> — sumé <b>${total}</b> ópticas de esas zonas a la tanda de hoy, cada una a quien le toca:\n` +
      reparto.map(([v, n]) => `• <b>${nombre(v)}</b>: ${n}`).join("\n") +
      `\nEl mensaje ya está listo en Orbital Suite → Mi tanda. ¡A contactar todos! ${fuerte ? "🔥" : "☀️"}`);
  }

  partes.push(
    `🛡 <b>Dato Triple Protección</b> (UV400 + Infrarrojo + Blue Cut)\n${d.dato}\n` +
    `🗣 Para decir: <i>«${d.frase}»</i>`);
  partes.push(`Para mandarle a una óptica: <a href="${LINK_TP}">ver.orbitaleyewear.com.ar/tripleproteccion</a>`);
  return partes.join("\n\n");
}

const provinciasDe = (soleadas: Clima[]) => [...new Set(soleadas.flatMap((c) => c.provs))];
const cupoSol = (soleadas: Clima[]) => (esCalorFuerte(soleadas) ? CUPO_TANDA_CALOR : CUPO_TANDA_SOL);

async function telegramSend(chatId: number, text: string, replyTo?: number | null, markup?: unknown): Promise<number | null> {
  const body: Record<string, unknown> = { chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true };
  if (replyTo) body.reply_parameters = { message_id: replyTo, allow_sending_without_reply: true };
  if (markup) body.reply_markup = markup;
  const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = await res.json().catch(() => null);
  if (!j?.ok) console.error("Telegram sendMessage error:", JSON.stringify(j));
  return j?.result?.message_id ?? null;
}

async function registrarHilo(chatId: number, messageId: number | null, conversacionId: string | null) {
  if (!messageId || !conversacionId) return;
  await supabase.from("ojo_hilos").upsert(
    { telegram_chat_id: chatId, telegram_message_id: messageId, conversacion_id: conversacionId },
    { onConflict: "telegram_chat_id,telegram_message_id" },
  );
}

// v25: el aviso de visita queda guardado para responderle "cerró el catálogo" en el mismo hilo.
async function guardarHiloVisita(cod: string, dia: string, salidas: { chat: number; messageId: number | null }[]) {
  const filas = salidas.filter((s) => s.messageId).map((s) => ({
    cod_cliente: cod, dia, telegram_chat_id: s.chat, telegram_message_id: s.messageId,
  }));
  if (filas.length) await supabase.from("ojo_visita_hilos").upsert(filas, { onConflict: "cod_cliente,dia,telegram_chat_id", ignoreDuplicates: true });
}

// Conversacion del cliente para que el vendedor le escriba en el chat del catalogo
// respondiendo el aviso. Solo para visitas de mas de un minuto o carritos.
async function conversacionDe(cod: string | null): Promise<string | null> {
  if (!cod) return null;
  const { data, error } = await supabase.rpc("catalogo_chat_conversacion", { p_cod_cliente: cod });
  if (error) { console.error("catalogo_chat_conversacion", JSON.stringify(error)); return null; }
  return (data as string) ?? null;
}

// v21: quien le mando algo al cliente. El mas reciente entre el link con token generado en la
// Suite (catalogo_acceso.enviado_por) y la propuesta registrada (envios_propuesta); si no, el asignado.
async function responsableDe(cod: string, asignado: string | null): Promise<{ cod: string | null; fecha: string | null }> {
  const [{ data: acc }, { data: env }] = await Promise.all([
    supabase.from("catalogo_acceso").select("enviado_por, enviado_at")
      .eq("cod_cliente", cod).eq("tipo", "optica").eq("activo", true).not("enviado_por", "is", null)
      .order("enviado_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("envios_propuesta").select("vendedor, fecha_envio")
      .eq("cod_cliente", cod).order("fecha_envio", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const a = acc as { enviado_por: string | null; enviado_at: string | null } | null;
  const e = env as { vendedor: string | null; fecha_envio: string | null } | null;
  const ta = a?.enviado_at ? Date.parse(a.enviado_at) : 0;
  const te = e?.fecha_envio ? Date.parse(e.fecha_envio) : 0;
  if (a?.enviado_por && ta >= te) return { cod: a.enviado_por, fecha: a.enviado_at };
  if (e?.vendedor) return { cod: e.vendedor, fecha: e.fecha_envio };
  return { cod: asignado, fecha: null };
}

// v23: lo que le toca a Corporativo/Gaston viene con botones para derivarlo (los atiende ojo-conteo).
// 2026-10-01: solo la gente del grupo de Ventas (Adrián, Bruno, Lola); Mauro y Ulises son de Prospección.
const DERIVAR_A = ["Adrian", "Bruno", "Lola"];
function tecladoDerivar(codCliente: string | null | undefined, responsable: string | null | undefined) {
  if (!codCliente || !["Corporativo", "Gaston"].includes(String(responsable))) return undefined;
  const b = (text: string, d: string) => ({ text, callback_data: `drv:${codCliente}:${d}`.slice(0, 64) });
  return {
    inline_keyboard: [
      DERIVAR_A.map((v) => b(`➡️ ${nombre(v)}`, v)),
      [b("✋ Me lo quedo", "yo")],
    ],
  };
}

function tecladoCarrito(acceso: string, codCliente: string | null, responsable: string | null) {
  const der = tecladoDerivar(codCliente, responsable)?.inline_keyboard ?? [];
  return { inline_keyboard: [[{ text: "📥 Pasarlo a precarga", callback_data: `prc:${acceso}`.slice(0, 64) }], ...der] };
}

async function destinos(): Promise<number[]> {
  const { data: grupos } = await supabase
    .from("ojo_grupos").select("telegram_chat_id")
    .eq("activo", true).eq("recibe_avisos", true);
  if (grupos && grupos.length > 0) return grupos.map((g) => g.telegram_chat_id);
  const { data: admins } = await supabase.from("ojo_admins").select("telegram_user_id");
  return (admins ?? []).map((a) => a.telegram_user_id);
}

async function yaAvisado(tipo: string, ref: string): Promise<boolean> {
  const { data } = await supabase.from("ojo_avisos_enviados").select("ref").eq("tipo", tipo).eq("ref", ref).maybeSingle();
  return !!data;
}

async function marcarAvisado(tipo: string, ref: string) {
  await supabase.from("ojo_avisos_enviados").insert({ tipo, ref });
}

async function cfg(clave: string): Promise<string | null> {
  const { data } = await supabase.from("app_config").select("valor").eq("clave", clave).maybeSingle();
  return (data as { valor: string } | null)?.valor ?? null;
}

// ── Derivaciones: a quien le toca y aviso directo por WhatsApp (v17) ───────────────────────────
type Asignado = { nombre: string; telefono: string | null };

async function asignadoDe(derivacionId: string): Promise<Asignado | null> {
  const { data: d } = await supabase.from("derivaciones").select("asignado_a").eq("id", derivacionId).maybeSingle();
  const id = (d as { asignado_a: number | null } | null)?.asignado_a;
  if (!id) return null;
  const { data: v } = await supabase.from("vendedores").select("nombre, telefono_remitente").eq("id", id).maybeSingle();
  const vv = v as { nombre: string; telefono_remitente: string | null } | null;
  return vv ? { nombre: vv.nombre, telefono: vv.telefono_remitente } : null;
}

// Los parametros de plantilla de WhatsApp no aceptan saltos de linea, tabs ni 4+ espacios seguidos.
const paramWA = (s: string) => s.replace(/[\n\r\t]+/g, " ").replace(/ {2,}/g, " ").trim().slice(0, 900) || "-";

async function waSend(body: Record<string, unknown>): Promise<{ ok: boolean; detalle: string }> {
  if (!WHATSAPP_TOKEN || !PHONE_NUMBER_ID) return { ok: false, detalle: "faltan WHATSAPP_TOKEN / WHATSAPP_PHONE_NUMBER_ID" };
  try {
    const r = await fetch(`https://graph.facebook.com/v21.0/${PHONE_NUMBER_ID}/messages`, {
      method: "POST", headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", ...body }),
    });
    return r.ok ? { ok: true, detalle: "" } : { ok: false, detalle: await r.text() };
  } catch (e) { return { ok: false, detalle: String(e) }; }
}

// Fuera de la ventana de 24 h solo sale por plantilla: la de aviso interno (nuevo_lead_b2b,
// 3 variables). Si falla, texto libre (sale si esa persona le escribio al numero central hace < 24 h).
async function avisarAsignadoWA(asig: Asignado, quien: string, consulta: string, tel: string | null): Promise<{ ok: boolean; detalle: string }> {
  const to = (asig.telefono ?? "").replace(/\D/g, "");
  if (to.length < 10) return { ok: false, detalle: `${asig.nombre} no tiene telefono_remitente` };
  const tpl = (await cfg("meta_leads_wa_template")) || "nuevo_lead_b2b";
  const lang = (await cfg("meta_leads_wa_lang")) || "es_AR";
  const r1 = await waSend({
    to, type: "template",
    template: { name: tpl, language: { code: lang }, components: [{ type: "body", parameters: [
      { type: "text", text: paramWA(`🆘 ${asig.nombre}: IRIS te derivó un cliente que espera respuesta. ${quien}${consulta ? ` — «${consulta.slice(0, 250)}»` : ""}. Respondele desde Orbital Suite → Derivaciones`) },
      { type: "text", text: "atención IRIS (WhatsApp)" },
      { type: "text", text: paramWA(tel ?? "s/tel") },
    ] }] },
  });
  if (r1.ok) return r1;
  const r2 = await waSend({
    to, type: "text",
    text: { body: `🆘 ${asig.nombre}: IRIS te derivó un cliente que espera respuesta.\n${quien}${tel ? ` · ${tel}` : ""}\n${consulta ? `«${consulta}»\n` : ""}Respondele desde Orbital Suite → Derivaciones.` },
  });
  return r2.ok ? { ok: true, detalle: "texto libre" } : { ok: false, detalle: `plantilla: ${r1.detalle} | texto: ${r2.detalle}` };
}

function minutos(seg: number): string {
  if (!seg) return "";
  if (seg < 60) return `${seg}s`;
  return `${Math.round(seg / 60)} min`;
}

function haceCuanto(fecha: string | null): string {
  if (!fecha) return "nunca compró";
  const dias = Math.floor((Date.now() - new Date(fecha).getTime()) / 86400000);
  if (dias < 60) return `compró hace ${dias} días`;
  if (dias < 730) return `compró hace ${Math.round(dias / 30)} meses`;
  return `compró hace ${Math.round(dias / 365)} años`;
}

function linkWa(wa: string | null, _razon: string | null, texto: string): string {
  if (!wa) return "";
  return `\n👉 <a href="https://wa.me/${wa}?text=${encodeURIComponent(texto)}">Escribirle por WhatsApp</a>`;
}

const horaAR = (iso: string) => new Date(Date.parse(iso) - 3 * 3600 * 1000).toISOString().slice(11, 16);
const fechaCortaAR = (iso: string) => new Date(Date.parse(iso) - 3 * 3600 * 1000).toISOString().slice(5, 10).split("-").reverse().join("/");

const MOTIVOS: Record<string, string> = {
  llm_error: "el asistente no pudo responder",
  reclamo: "reclamo",
  disputa: "disputa",
  precio_mayorista: "pidió precios mayoristas",
  cierre_pedido: "quiere cerrar un pedido",
  baja_confianza: "no entendió la consulta",
};

const json = (x: unknown, status = 200) =>
  new Response(JSON.stringify(x), { status, headers: { "Content-Type": "application/json; charset=utf-8" } });

// Acciones manuales sobre una derivacion (v17). Solo con header x-internal-key.
async function accionDerivacion(req: Request): Promise<Response> {
  if (req.headers.get("x-internal-key") !== (await cfg("meta_webhook_verify_token"))) return json({ ok: false, error: "key" }, 401);
  let b: { accion?: string; derivacion_id?: string; nombre?: string; simular?: boolean } = {};
  try { b = await req.json(); } catch { /* */ }
  if (!b.derivacion_id) return json({ ok: false, error: "falta derivacion_id" }, 400);

  const { data: dv } = await supabase.from("derivaciones").select("id, conversacion_id, resumen").eq("id", b.derivacion_id).maybeSingle();
  const der = dv as { id: string; conversacion_id: string; resumen: string | null } | null;
  if (!der) return json({ ok: false, error: "derivacion no encontrada" }, 404);
  const { data: cv } = await supabase.from("at_conversaciones").select("canal_origen, contacto_id").eq("id", der.conversacion_id).maybeSingle();
  const conv = cv as { canal_origen: string; contacto_id: string } | null;
  const { data: ct } = conv ? await supabase.from("contactos").select("telefono, nombre").eq("id", conv.contacto_id).maybeSingle() : { data: null };
  const contacto = ct as { telefono: string | null; nombre: string | null } | null;

  if (b.accion === "avisar_asignado") {
    const asig = await asignadoDe(der.id);
    if (!asig) return json({ ok: false, error: "sin asignado" });
    if (b.simular) return json({ ok: true, simulado: true, para: asig.nombre, tel_asignado: asig.telefono });
    const w = await avisarAsignadoWA(asig, contacto?.nombre ?? contacto?.telefono ?? "un contacto", der.resumen ?? "", contacto?.telefono ?? null);
    return json({ ok: w.ok, para: asig.nombre, detalle: w.detalle });
  }

  if (b.accion === "recontactar") {
    if (conv?.canal_origen !== "whatsapp") return json({ ok: false, error: `canal ${conv?.canal_origen ?? "?"}: solo whatsapp` });
    const to = (contacto?.telefono ?? "").replace(/\D/g, "");
    if (to.length < 10) return json({ ok: false, error: "sin telefono" });
    const quien = paramWA(b.nombre || contacto?.nombre || "de nuevo");
    const tpl = (await cfg("meta_lead_tpl_primer")) || "primer_contacto_lead";
    const lang = (await cfg("meta_lead_tpl_lang")) || "es_AR";
    if (b.simular) return json({ ok: true, simulado: true, to, tpl, quien });
    const w = await waSend({
      to, type: "template",
      template: { name: tpl, language: { code: lang }, components: [{ type: "body", parameters: [{ type: "text", text: quien }] }] },
    });
    let registrado = false;
    if (w.ok) {
      const { error } = await supabase.from("at_mensajes").insert({
        conversacion_id: der.conversacion_id, canal: "whatsapp", emisor: "agente",
        contenido: `Ulises (plantilla ${tpl}): Hola ${quien}, ¿cómo estás? Soy Ulises, de Orbital. Tenemos algo distinto para tu óptica: la única línea de sol en Argentina con Triple Protección. Contame, ¿cómo se llama tu óptica? Así te preparo una propuesta.`,
      });
      registrado = !error;
      if (error) console.error("recontactar at_mensajes", error.message);
    }
    return json({ ok: w.ok, to, registrado, detalle: w.detalle });
  }

  return json({ ok: false, error: "accion" }, 400);
}

Deno.serve(async (req: Request) => {
  if (req.headers.get("x-internal-key")) return accionDerivacion(req);

  const ar = new Date(Date.now() - 3 * 3600 * 1000);
  const hoyAR = ar.toISOString().slice(0, 10);
  const horaARnum = ar.getUTCHours();
  const mesAR = ar.getUTCMonth() + 1;
  const diaSemana = ar.getUTCDay(); // 0 domingo … 6 sabado

  // Vista previa del dia de sol: clima + tanda SIMULADA + texto. No manda ni inserta nada.
  // &calor=33 pisa la maxima de la ciudad mas calurosa, para ver el texto de calor fuerte.
  const params = new URL(req.url).searchParams;
  if (params.get("preview") === "sol") {
    const clima = await climaPais();
    const soleadas = clima.filter(haySol).sort((a, b) => b.max - a.max);
    const simCalor = Number(params.get("calor"));
    if (soleadas.length > 0 && simCalor > 0) soleadas[0] = { ...soleadas[0], max: simCalor };
    let sim: { por_usuario?: Record<string, number> } | null = null;
    if (soleadas.length > 0) {
      const { data, error } = await supabase.rpc("generar_tanda_sol", {
        p_provincias: provinciasDe(soleadas), p_cupo: cupoSol(soleadas), p_fecha: hoyAR, p_dry: true,
      });
      sim = error ? { error } as never : data;
    }
    return new Response(JSON.stringify({
      clima: clima.map((c) => ({ ciudad: c.nombre, max: c.max, uv: c.uv, code: c.code, lluvia: c.lluvia, sol_h: Math.round(c.solH * 10) / 10, sol: haySol(c) })),
      calor_fuerte: esCalorFuerte(soleadas),
      tanda_simulada: sim,
      texto: soleadas.length > 0 ? textoSol(soleadas, sim?.por_usuario ?? null, hoyAR, mesAR) : null,
    }), { headers: { "Content-Type": "application/json; charset=utf-8" } });
  }

  const chats = await destinos();
  if (chats.length === 0) {
    return new Response(JSON.stringify({ ok: false, motivo: "sin destino" }), { headers: { "Content-Type": "application/json" } });
  }

  const enviados: string[] = [];
  const desde48h = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
  const desde24h = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const ayerAR = new Date(ar.getTime() - 24 * 3600 * 1000).toISOString().slice(0, 10);
  const inicioAyerUTC = `${ayerAR}T03:00:00Z`; // 00:00 ART de ayer

  // replyTo: por chat, el mensaje al que se responde (para dejar el aviso en el mismo hilo).
  // Ojo por tema (2026-09-30): cada aviso va al grupo de su tema (ventas salvo los 🆘, que van por su motivo);
  // si ese grupo todavía no se creó, a los grupos de avisos de siempre.
  const chatsTema = new Map<string, number[]>();
  async function destinoTema(tema: string): Promise<number[]> {
    if (!chatsTema.has(tema)) {
      const { data } = await supabase.from("ojo_temas").select("chat_id").eq("tema", tema).maybeSingle();
      chatsTema.set(tema, data?.chat_id ? [Number(data.chat_id)] : chats);
    }
    return chatsTema.get(tema)!;
  }
  async function avisar(tipo: string, ref: string, texto: string, replyTo?: Map<number, number>, markup?: unknown, tema = "ventas"): Promise<{ chat: number; messageId: number | null }[]> {
    if (await yaAvisado(tipo, ref)) return [];
    const salidas: { chat: number; messageId: number | null }[] = [];
    for (const chat of await destinoTema(tema)) salidas.push({ chat, messageId: await telegramSend(chat, texto, replyTo?.get(chat), markup) });
    await marcarAvisado(tipo, ref);
    enviados.push(`${tipo}:${ref}`);
    return salidas;
  }

  // Cuantas opticas entraron ayer al catalogo (el argumento de por que mandar la tanda).
  async function entraronAyer(): Promise<number> {
    const { data } = await supabase.from("ojo_v_catalogo_visitas").select("cod_cliente, es_revendedor").eq("dia", ayerAR);
    return new Set((data ?? []).filter((v) => !v.es_revendedor).map((v) => v.cod_cliente)).size;
  }

  // 0) Dia de sol: una vez por dia, la primera vez entre las 9 y las 15 que hay provincias con sol.
  if (horaARnum >= 9 && horaARnum < 15 && !(await yaAvisado("dia_sol", hoyAR))) {
    const soleadas = (await climaPais()).filter(haySol).sort((a, b) => b.max - a.max);
    if (soleadas.length > 0) {
      let tanda: Record<string, number> | null = null;
      if (diaSemana >= 1 && diaSemana <= 5) {
        const { data, error } = await supabase.rpc("generar_tanda_sol", {
          p_provincias: provinciasDe(soleadas), p_cupo: cupoSol(soleadas), p_fecha: hoyAR,
        });
        if (error) console.error("generar_tanda_sol", JSON.stringify(error));
        else tanda = data?.por_usuario ?? null;
      }
      await avisar("dia_sol", hoyAR, textoSol(soleadas, tanda, hoyAR, mesAR));
    }
  }

  // 1) La tanda del dia
  if (horaARnum >= 9 && horaARnum < 20) {
    const { data: tanda } = await supabase.from("ojo_v_tanda_hoy").select("*");
    const filas = (tanda ?? []).filter((t) => (t.total ?? 0) > 0);

    if (filas.length > 0 && horaARnum >= 9 && horaARnum < 11 && !(await yaAvisado("tanda_manana", hoyAR))) {
      const detalle = filas
        .sort((a, b) => (b.total ?? 0) - (a.total ?? 0))
        .map((t) => `• <b>${nombre(t.vendedor)}</b>: ${t.total} contactos`)
        .join("\n");
      const total = filas.reduce((s, t) => s + (t.total ?? 0), 0);
      const n = await entraronAyer();
      const impulso = n > 0
        ? `Ayer entraron <b>${n}</b> ópticas al catálogo: cada envío es una puerta que se abre 🚪`
        : `Cada envío es una óptica más que puede entrar al catálogo 🚪`;
      await avisar("tanda_manana", hoyAR,
        `☀️ <b>Tanda de hoy</b> — ${total} contactos para hacer:\n${detalle}\n\n${impulso}\n` +
        `Se hace desde Orbital Suite → Mi tanda. Temprano rinde más 💪\n\n<i>${chisteDelDia(hoyAR)}</i>`);
    }

    if (horaARnum >= 17 && horaARnum < 19 && !(await yaAvisado("tanda_tarde", hoyAR))) {
      const sinNada = filas.filter((t) => (t.hechos ?? 0) === 0);
      const faltan = filas.filter((t) => (t.hechos ?? 0) > 0 && (t.pendientes ?? 0) > 0);
      const listos = filas.filter((t) => (t.pendientes ?? 0) === 0).map((t) => nombre(t.vendedor));
      if (sinNada.length > 0 || faltan.length > 0) {
        const n = await entraronAyer();
        const partes: string[] = [`⏳ <b>Cómo viene la tanda de hoy</b>`];
        if (faltan.length > 0) {
          partes.push(faltan
            .sort((a, b) => (b.pendientes ?? 0) - (a.pendientes ?? 0))
            .map((t) => `• <b>${nombre(t.vendedor)}</b>: ${t.hechos} hechos, faltan ${t.pendientes} — un último empujón y la cerrás 🏁`)
            .join("\n"));
        }
        if (sinNada.length > 0) {
          partes.push(sinNada
            .map((t) => `🔔 <b>${nombre(t.vendedor)}</b>: hoy no salió ningún envío (${t.total} en la lista). ` +
              `<b>Mañana arrancás con la tanda a primera hora.</b>`)
            .join("\n") +
            `\nEl envío es lo que trae a las ópticas al catálogo${n > 0 ? ` (ayer entraron ${n})` : ""}, y de ahí salen los pedidos. Sin envío no hay visita 🙃`);
        }
        if (listos.length) partes.push(`Ya la terminaron: ${listos.join(", ")} 👏`);
        partes.push(`<i>${chisteDelDia(hoyAR, 3)}</i>`);
        await avisar("tanda_tarde", hoyAR, partes.join("\n\n"));
      }
    }
  }

  // 2) Recomendaciones del dia: opticas que ayer abrieron el catalogo y no compraron
  if (horaARnum >= 9 && horaARnum < 11 && !(await yaAvisado("reco_dia", hoyAR))) {
    const [{ data: visitasAyer }, { data: carritos }, { data: precs }, { data: peds }] = await Promise.all([
      supabase.from("ojo_v_catalogo_visitas").select("*").eq("dia", ayerAR),
      supabase.from("ojo_v_catalogo_carritos").select("*").gte("actualizado_at", inicioAyerUTC),
      supabase.from("catalogo_precarga").select("cod_cliente").gte("created_at", inicioAyerUTC).neq("estado", "descartado"),
      supabase.from("pedidos").select("cod_cliente").gte("created_at", inicioAyerUTC),
    ]);
    const compraron = new Set([...(precs ?? []), ...(peds ?? [])].map((x) => x.cod_cliente).filter(Boolean));

    type Reco = { cod: string; razon: string; vendedor: string | null; seg: number; u: number; wa: string | null; ult: string | null };
    const porCliente = new Map<string, Reco>();
    for (const v of visitasAyer ?? []) {
      if (v.es_revendedor || !v.cod_cliente || compraron.has(v.cod_cliente)) continue;
      const r = porCliente.get(v.cod_cliente) ?? { cod: v.cod_cliente, razon: v.razon ?? v.cod_cliente, vendedor: v.vendedor, seg: 0, u: 0, wa: v.wa, ult: v.ultima_compra_fecha };
      r.seg = Math.max(r.seg, v.segundos_max ?? 0);
      porCliente.set(v.cod_cliente, r);
    }
    for (const c of carritos ?? []) {
      if (c.es_revendedor || !c.cod_cliente || compraron.has(c.cod_cliente)) continue;
      const r = porCliente.get(c.cod_cliente) ?? { cod: c.cod_cliente, razon: c.razon ?? c.cod_cliente, vendedor: c.vendedor, seg: 0, u: 0, wa: c.wa, ult: null };
      r.u = Math.max(r.u, c.unidades ?? 0);
      porCliente.set(c.cod_cliente, r);
    }
    // Solo interés real: carrito o mas de un minuto adentro.
    const recos = [...porCliente.values()].filter((r) => r.u > 0 || r.seg >= MIN_SEGUNDOS_VISITA);

    const porVendedor = new Map<string, Reco[]>();
    for (const r of recos) {
      const k = r.vendedor ?? "";
      porVendedor.set(k, [...(porVendedor.get(k) ?? []), r]);
    }

    let i = 0;
    for (const [vend, lista] of porVendedor) {
      lista.sort((a, b) => (b.u - a.u) || (b.seg - a.seg));
      const lineas = lista.slice(0, MAX_RECOS_POR_VENDEDOR).map((r) => {
        const que = r.u > 0
          ? `estuvo ${minutos(r.seg) || "un rato"} y dejó <b>${r.u} u.</b> en el carrito → ofrecele cerrarlo hoy`
          : `estuvo <b>${minutos(r.seg)}</b> mirando → preguntale qué le gustó`;
        const saludo = r.u > 0
          ? "Hola! Vi que ayer armaste un pedido en el catálogo de Orbital. ¿Lo cerramos hoy?"
          : "Hola! Vi que ayer estuviste mirando el catálogo de Orbital. ¿Te ayudo a armar el pedido?";
        const wa = r.wa ? ` · <a href="https://wa.me/${r.wa}?text=${encodeURIComponent(saludo)}">WhatsApp</a>` : "";
        return `• <b>${r.razon}</b> — ${que} <i>(${haceCuanto(r.ult)})</i>${wa}`;
      });
      const mas = lista.length > MAX_RECOS_POR_VENDEDOR ? `\n…y ${lista.length - MAX_RECOS_POR_VENDEDOR} más.` : "";
      await avisar("reco_dia", `${hoyAR}:${vend || "sin"}`,
        `🎯 <b>${nombre(vend || null)}</b>, hoy te recomiendo hablar con estas ópticas que ayer abrieron el catálogo. ` +
        `Están tibias: no dejes que se enfríen 🔥\n${lineas.join("\n")}${mas}\n\n<i>${chisteDelDia(hoyAR, ++i)}</i>`);
    }
    await marcarAvisado("reco_dia", hoyAR);
  }

  // 3) Lo que IRIS no pudo resolver. v17: dice para quien es y a esa persona le llega por WhatsApp.
  const { data: derivaciones } = await supabase
    .from("ojo_v_derivaciones").select("*")
    .eq("estado", "pendiente").gte("created_at", desde48h)
    .order("created_at", { ascending: true });

  for (const d of derivaciones ?? []) {
    if (await yaAvisado("derivacion", String(d.id))) continue;
    const quien = d.cliente_razon ?? d.contacto_nombre ?? d.contacto_telefono ?? "un contacto";
    const motivo = MOTIVOS[d.motivo] ?? d.motivo ?? "necesita una persona";
    const consulta = (d.ultimo_mensaje ?? d.resumen ?? "").toString().slice(0, 300);
    const asig = await asignadoDe(String(d.id));
    const salidas = await avisar("derivacion", String(d.id),
      `🆘 <b>IRIS no pudo resolver una consulta</b> (${motivo})\n` +
      (asig ? `Para: <b>${marca(asig.nombre)}</b> (le avisé por WhatsApp)\n` : `<b>Sin asignar</b>\n`) +
      `De: <b>${quien}</b>${d.contacto_telefono ? ` · ${d.contacto_telefono}` : ""}\n` +
      (consulta ? `«${consulta}»\n` : "") +
      `\n<i>Respondé este mensaje y se lo mando al cliente.</i>`,
      undefined, undefined, String((await supabase.rpc("ojo_tema_derivacion", { p_derivacion: d.id })).data ?? "ventas"));
    for (const s of salidas) await registrarHilo(s.chat, s.messageId, d.conversacion_id ?? null);
    if (asig) {
      const w = await avisarAsignadoWA(asig, quien, consulta, d.contacto_telefono ?? null);
      if (!w.ok) console.error("aviso WA derivacion", d.id, asig.nombre, w.detalle);
      await supabase.from("ojo_avisos_enviados").insert({ tipo: w.ok ? "derivacion_wa" : "derivacion_wa_error", ref: String(d.id) });
    }
  }

  // 4) Respuestas de clientes de la tanda que escriben al numero central
  const { data: respuestas } = await supabase
    .from("ojo_v_respuestas_tanda").select("*")
    .gte("respondio_at", desde24h).order("respondio_at", { ascending: true });

  for (const r of respuestas ?? []) {
    const quien = r.razon ?? r.contacto_nombre ?? r.cod_cliente;
    const posta = r.posta ? ` · ${r.posta}` : "";
    await avisar("resp_tanda", String(r.mensaje_id),
      `🗣 <b>${quien}</b> respondió a la tanda (${r.vendedor ? nombre(r.vendedor) : "?"}${posta}):\n«${r.texto}»`);
  }

  // 4b) v19: propuestas abiertas (Bienvenida / Canje con el token del cliente).
  //     Un aviso por cliente + propuesta por dia; el mensaje queda guardado para que la
  //     entrada al catalogo posterior salga como respuesta en el mismo hilo.
  const desde3h = new Date(Date.now() - 3 * 3600 * 1000).toISOString();
  const { data: abiertas } = await supabase
    .from("landing_visita").select("slug, cod_cliente, created_at")
    .in("slug", Object.keys(PROPUESTAS)).not("cod_cliente", "is", null)
    .gte("created_at", desde3h).order("created_at", { ascending: true });

  for (const l of abiertas ?? []) {
    const ref = `${l.cod_cliente}:${l.slug}:${hoyAR}`;
    if (await yaAvisado("propuesta_abierta", ref)) continue;
    const [{ data: clr }, { data: rev }] = await Promise.all([
      supabase.from("clientes").select("razon, nomcomerc, vendedor_asignado, whatsapp, telefono, ultima_compra_fecha").eq("cod", l.cod_cliente).maybeSingle(),
      supabase.from("vendedores").select("codigo").eq("rol", "revendedor").eq("cod_cliente", l.cod_cliente).limit(1).maybeSingle(),
    ]);
    if (rev) { await marcarAvisado("propuesta_abierta", ref); continue; }
    const cl = clr as { razon: string | null; nomcomerc: string | null; vendedor_asignado: string | null; whatsapp: string | null; telefono: string | null; ultima_compra_fecha: string | null } | null;
    const quien = cl?.nomcomerc || cl?.razon || l.cod_cliente;
    const resp = await responsableDe(l.cod_cliente, cl?.vendedor_asignado ?? null);
    const { data: wa } = await supabase.rpc("ojo_wa_numero", { p_tel: cl?.whatsapp || cl?.telefono || null });
    const titulo = PROPUESTAS[l.slug];
    const conv = await conversacionDe(l.cod_cliente);
    const enviada = resp.fecha ? ` · se la mandó el ${fechaCortaAR(resp.fecha)}` : "";
    const saludo = `Hola! Vi que estuviste viendo la propuesta ${titulo.replace(/^\S+\s/, "")} de Orbital. ¿Te cuento cómo arrancar?`;
    const salidas = await avisar("propuesta_abierta", ref,
      `📄 <b>${quien}</b> abrió la propuesta <b>${titulo}</b> (${horaAR(l.created_at)} hs).\n` +
      `Responsable: <b>${nombre(resp.cod)}</b>${enviada} · ${haceCuanto(cl?.ultima_compra_fecha ?? null)}` +
      (conv ? `\n💬 <b>Respondé este mensaje y le aparece en el chat del catálogo.</b>` : "") +
      linkWa((wa as string | null) ?? null, quien, saludo).replace("Escribirle por WhatsApp", "O a su WhatsApp (sale desde el tuyo)") +
      `\n<i>Si entra al catálogo te aviso acá abajo.</i>`,
      undefined, tecladoDerivar(l.cod_cliente, resp.cod));
    for (const s of salidas) {
      await registrarHilo(s.chat, s.messageId, conv);
      if (s.messageId) {
        await supabase.from("ojo_propuesta_hilos").insert({
          cod_cliente: l.cod_cliente, slug: l.slug, telegram_chat_id: s.chat, telegram_message_id: s.messageId,
        });
      }
    }
  }

  // Hilos de propuesta de los ultimos 7 dias: el mas reciente por cliente y chat.
  const desde7d = new Date(Date.now() - 7 * 86400000).toISOString();
  const { data: hilosProp } = await supabase
    .from("ojo_propuesta_hilos").select("cod_cliente, slug, telegram_chat_id, telegram_message_id, creado_en")
    .gte("creado_en", desde7d).order("creado_en", { ascending: true });
  type HiloProp = { slug: string; creado: string; porChat: Map<number, number> };
  const hiloDe = new Map<string, HiloProp>();
  for (const h of hilosProp ?? []) {
    const prev = hiloDe.get(h.cod_cliente);
    const x: HiloProp = prev && prev.slug === h.slug && prev.creado.slice(0, 10) === String(h.creado_en).slice(0, 10)
      ? prev : { slug: h.slug, creado: h.creado_en, porChat: new Map() };
    x.porChat.set(Number(h.telegram_chat_id), Number(h.telegram_message_id));
    hiloDe.set(h.cod_cliente, x);
  }

  // 5) Quien esta en el catalogo (aviso al minuto, anclado al chat del catalogo)
  //    v19: si abrio una propuesta antes, sale enseguida y como respuesta a ese aviso.
  const { data: visitas } = await supabase
    .from("ojo_v_catalogo_visitas").select("*")
    .eq("dia", hoyAR).order("ultima_visita", { ascending: true });

  for (const v of visitas ?? []) {
    const quien = v.razon ?? v.cod_cliente;
    const tiempo = v.segundos_max ? ` · ${minutos(v.segundos_max)} adentro` : "";
    const hilo = !v.es_revendedor ? hiloDe.get(v.cod_cliente) : undefined;

    if (hilo && Date.parse(v.ultima_visita) >= Date.parse(hilo.creado)) {
      const refP = `${v.cod_cliente}:${hilo.slug}:${String(hilo.creado).slice(0, 10)}`;
      if (await yaAvisado("catalogo_tras_propuesta", refP)) continue;
      const resp = await responsableDe(v.cod_cliente, v.vendedor ?? null);
      const responsable = resp.cod ? `Responsable: <b>${nombre(resp.cod)}</b>` : "<b>Sin vendedor asignado</b>";
      const conv = await conversacionDe(v.cod_cliente);
      const saludo = `Hola! Vi que después de la propuesta entraste al catálogo de Orbital. ¿Te ayudo a armar el pedido?`;
      const salidas = await avisar("catalogo_tras_propuesta", refP,
        `🛒🔥 <b>${quien}</b> entró al catálogo después de abrir <b>${PROPUESTAS[hilo.slug] ?? hilo.slug}</b> — ${v.visitas} entrada(s)${tiempo}.\n` +
        `${responsable} · Es el momento: está mirando ahora.` +
        (conv ? `\n💬 <b>Respondé este mensaje y le aparece en el chat del catálogo.</b>` : "") +
        linkWa(v.wa, v.razon, saludo).replace("Escribirle por WhatsApp", "O a su WhatsApp (sale desde el tuyo)"),
        hilo.porChat, tecladoDerivar(v.cod_cliente, resp.cod));
      for (const s of salidas) await registrarHilo(s.chat, s.messageId, conv);
      await guardarHiloVisita(v.cod_cliente, v.dia, salidas);
      // No repetir el aviso comun de visita para el mismo dia.
      if (!(await yaAvisado("visita_catalogo", `${v.cod_cliente}:${v.dia}`))) await marcarAvisado("visita_catalogo", `${v.cod_cliente}:${v.dia}`);
      continue;
    }

    if ((v.segundos_max ?? 0) < MIN_SEGUNDOS_VISITA) continue;

    if (v.es_revendedor) {
      await avisar("visita_catalogo", `${v.cod_cliente}:${v.dia}`,
        `👁 <b>${quien}</b> (revendedor) estuvo en el catálogo — ${v.visitas} entrada(s)${tiempo}. Sin acción comercial.`);
      continue;
    }
    if (await yaAvisado("visita_catalogo", `${v.cod_cliente}:${v.dia}`)) continue;

    const caliente = (v.segundos_max ?? 0) >= SEGUNDOS_CALIENTE;
    const responsable = v.vendedor ? `Responsable: <b>${nombre(v.vendedor)}</b>` : "<b>Sin vendedor asignado</b>";
    const saludo = `Hola! Vi que estuviste mirando el catálogo de Orbital. ¿Te ayudo con algo o te armo el pedido?`;
    const conv = await conversacionDe(v.cod_cliente);

    const salidas = await avisar("visita_catalogo", `${v.cod_cliente}:${v.dia}`,
      `${caliente ? "🔥" : "👁"} <b>${quien}</b> está en el catálogo — ${v.visitas} entrada(s)${tiempo}.\n` +
      `${responsable} · ${haceCuanto(v.ultima_compra_fecha)}` +
      (conv ? `\n💬 <b>Respondé este mensaje y le aparece en el chat del catálogo</b> (ahora que está mirando).` : "") +
      linkWa(v.wa, v.razon, saludo).replace("Escribirle por WhatsApp", "O a su WhatsApp (sale desde el tuyo)") +
      (caliente ? `\n📞 ¿Preferís llamarlo? Escribilo acá ("llamar a ${quien} mañana 10") y te lo agendo.` : ""),
      undefined, tecladoDerivar(v.cod_cliente, v.vendedor));
    for (const s of salidas) await registrarHilo(s.chat, s.messageId, conv);
    await guardarHiloVisita(v.cod_cliente, v.dia, salidas);
  }

  // 5b) v25: cerro el catalogo. El chat ya no lo ve: se avisa en el mismo hilo para escribirle por WhatsApp.
  const { data: hilosVisita } = await supabase
    .from("ojo_visita_hilos").select("cod_cliente, dia, telegram_chat_id, telegram_message_id").eq("dia", hoyAR);
  const porCliVisita = new Map<string, Map<number, number>>();
  for (const h of hilosVisita ?? []) {
    const m = porCliVisita.get(h.cod_cliente) ?? new Map<number, number>();
    m.set(Number(h.telegram_chat_id), Number(h.telegram_message_id));
    porCliVisita.set(h.cod_cliente, m);
  }
  for (const [cod, porChat] of porCliVisita) {
    const refC = `${cod}:${hoyAR}`;
    if (await yaAvisado("cierre_catalogo", refC)) continue;
    const { data: ses } = await supabase.from("catalogo_sesion").select("ultimo_latido_at, segundos")
      .eq("cod_cliente", cod).gte("iniciada_at", `${hoyAR}T03:00:00Z`)
      .order("ultimo_latido_at", { ascending: false }).limit(1).maybeSingle();
    const ult = (ses as { ultimo_latido_at: string | null } | null)?.ultimo_latido_at;
    if (!ult || Date.now() - Date.parse(ult) < MIN_CIERRE_MS) continue; // sigue adentro
    const { data: pre } = await supabase.from("catalogo_precarga").select("id")
      .eq("cod_cliente", cod).gte("created_at", `${hoyAR}T03:00:00Z`).neq("estado", "descartado").limit(1).maybeSingle();
    if (pre) { await marcarAvisado("cierre_catalogo", refC); continue; } // confirmo pedido: no hace falta
    const v = (visitas ?? []).find((x) => x.cod_cliente === cod);
    const quien = v?.razon ?? cod;
    const saludo = `Hola! Vi que estuviste mirando el catálogo de Orbital. ¿Te ayudo con algo o te armo el pedido?`;
    const wa = linkWa(v?.wa ?? null, v?.razon ?? null, saludo).replace("Escribirle por WhatsApp", "Mandale un WhatsApp desde acá");
    await avisar("cierre_catalogo", refC,
      `🚪 <b>${quien}</b> cerró el catálogo (${horaAR(ult)} hs) — ya no ve el chat.` +
      (wa || `\n📞 No tiene WhatsApp cargado: llamalo.`) +
      `\n<i>Si respondés acá, lo ve recién cuando vuelva a entrar.</i>`,
      porChat);
  }

  // 6) Carritos sin confirmar (solo cantidades, sin plata)
  const { data: carritos } = await supabase
    .from("ojo_v_catalogo_carritos").select("*")
    .gte("actualizado_at", desde48h).order("actualizado_at", { ascending: true });

  for (const c of carritos ?? []) {
    const quien = c.razon ?? c.cod_cliente ?? c.codigo;
    const dia = String(c.actualizado_at).slice(0, 10);
    if (c.es_revendedor) {
      await avisar("carrito", `${c.codigo}:${dia}`,
        `🛒 <b>${quien}</b> (revendedor) armó un carrito: <b>${c.unidades} u.</b> — sin confirmar.`);
      continue;
    }
    if (await yaAvisado("carrito", `${c.codigo}:${dia}`)) continue;
    const responsable = c.vendedor ? `Responsable: <b>${nombre(c.vendedor)}</b>` : "<b>Sin vendedor asignado</b>";
    const saludo = `Hola! Vi que armaste un pedido en el catálogo de Orbital. ¿Lo cerramos?`;
    const conv = await conversacionDe(c.cod_cliente);
    const salidas = await avisar("carrito", `${c.codigo}:${dia}`,
      `🛒 <b>${quien}</b> armó un carrito y no lo confirmó: <b>${c.unidades} u.</b>\n${responsable}` +
      (conv ? `\n💬 <b>Respondé este mensaje y le aparece en el chat del catálogo.</b>` : "") +
      linkWa(c.wa, c.razon, saludo).replace("Escribirle por WhatsApp", "O a su WhatsApp (sale desde el tuyo)"),
      undefined, tecladoCarrito(c.codigo, c.cod_cliente, c.vendedor));
    for (const s of salidas) await registrarHilo(s.chat, s.messageId, conv);
  }

  // 7) Pedidos generados desde el catalogo (solo cantidades, sin plata)
  const { data: precargas } = await supabase
    .from("catalogo_precarga")
    .select("id, cliente_razon, vendedor, total_units, estado, created_at, obs")
    .gte("created_at", desde48h).order("created_at", { ascending: true });

  for (const p of precargas ?? []) {
    if (p.estado === "descartado") continue;
    const vend = p.vendedor ? ` (${nombre(p.vendedor)})` : "";
    await avisar("precarga", String(p.id),
      String(p.obs ?? "").startsWith("🛒 CARRITO SIN CONFIRMAR")
        ? `📥 <b>${p.cliente_razon}</b>${vend}: su carrito quedó como precarga (<b>${p.total_units} u.</b>) — falta que el cliente lo confirme.`
        : `✅ <b>${p.cliente_razon}</b>${vend} generó un pedido desde el catálogo: <b>${p.total_units} u.</b>`);
  }

  // 8) Pedidos por foto que leyo IRIS (bot_foto_pedido). Solo cantidades, sin plata.
  //    ref = conversacion + huella de los items: pasar de listo a cargado no repite el
  //    aviso, pero un pedido nuevo en la misma conversacion si avisa.
  const { data: fotos } = await supabase
    .from("bot_foto_pedido")
    .select("conversacion_id, cliente_razon, cod_cliente, vendedor, estado, items, updated_at")
    .in("estado", ["listo", "cargado"]).gte("updated_at", desde48h)
    .order("updated_at", { ascending: true });

  for (const f of fotos ?? []) {
    const items = (Array.isArray(f.items) ? f.items : []) as { sku?: string; cantidad?: number }[];
    if (items.length === 0) continue;
    const unidades = items.reduce((s, it) => s + (Number(it.cantidad) || 0), 0);
    const huella = items.map((it) => `${it.sku ?? ""}x${it.cantidad ?? 0}`).sort().join(",");
    let h = 0;
    for (let k = 0; k < huella.length; k++) h = (h * 31 + huella.charCodeAt(k)) | 0;
    const quien = f.cliente_razon ?? f.cod_cliente ?? "Sin cliente identificado";
    const vend = f.vendedor ? ` (${nombre(f.vendedor)})` : "";
    const estado = f.estado === "cargado"
      ? "Ya lo cargaron en Orbital Suite."
      : "Está en Orbital Suite → Nuevo pedido, listo para cargar.";
    await avisar("precarga_foto", `${f.conversacion_id}:${(h >>> 0).toString(36)}`,
      `📸 <b>${quien}</b>${vend} mandó un pedido por foto que leyó IRIS: <b>${unidades} u.</b> en ${items.length} modelos.\n${estado}`);
  }

  // 9) Pedidos cargados en la Suite (solo cantidades, sin plata). Tienda (web) no.
  //    v16: se avisan TODOS. Si el cliente tuvo una precarga (catalogo o foto) en las 24 h
  //    previas, el aviso lo aclara, pero NO se saltea (antes una precarga silenciaba 3 dias
  //    de pedidos de ese cliente). Unico salteo: origen ojo-telegram (se cargo desde el grupo).
  //    ?desde=<fecha ISO> recorre desde esa fecha (recuperar avisos atrasados).
  const desdeParam = params.get("desde");
  const desdePedidos = desdeParam && !isNaN(Date.parse(desdeParam)) ? new Date(desdeParam).toISOString() : desde48h;
  const desdeCruce = new Date(Date.parse(desdePedidos) - 86400000).toISOString();
  const [{ data: pedidosSuite }, { data: precCat }, { data: precFoto }] = await Promise.all([
    supabase.from("pedidos")
      .select("id, cod_cliente, cliente, vendedor, total_units, origen, created_at")
      .neq("vendedor", "Tienda").gte("created_at", desdePedidos)
      .order("created_at", { ascending: true }),
    supabase.from("catalogo_precarga").select("cod_cliente, created_at")
      .neq("estado", "descartado").gte("created_at", desdeCruce),
    supabase.from("bot_foto_pedido").select("cod_cliente, updated_at")
      .eq("estado", "cargado").gte("updated_at", desdeCruce),
  ]);
  const tiemposPor = (filas: { cod: string | null; t: string }[]) => {
    const m = new Map<string, number[]>();
    for (const x of filas) {
      if (!x.cod) continue;
      m.set(x.cod, [...(m.get(x.cod) ?? []), Date.parse(x.t)]);
    }
    return m;
  };
  const catDe = tiemposPor((precCat ?? []).map((c) => ({ cod: c.cod_cliente as string | null, t: c.created_at as string })));
  const fotoDe = tiemposPor((precFoto ?? []).map((f) => ({ cod: f.cod_cliente as string | null, t: f.updated_at as string })));
  const ORIGEN_TXT: Record<string, string> = {
    catalogo: " · salió de una precarga del catálogo",
    precarga: " · salió de una precarga",
    reposicion: " · reposición de consigna",
    consigna: " · venta de consigna",
  };
  for (const p of pedidosSuite ?? []) {
    if (p.origen === "ojo-telegram") continue;
    const t = Date.parse(p.created_at);
    const cerca = (xs?: number[]) => (xs ?? []).some((x) => x >= t - 86400000 && x <= t + 3600000);
    const nota = (p.origen && ORIGEN_TXT[p.origen])
      ? ORIGEN_TXT[p.origen]
      : cerca(catDe.get(p.cod_cliente)) ? " · el cliente tenía precarga del catálogo"
      : cerca(fotoDe.get(p.cod_cliente)) ? " · el cliente tenía pedido por foto"
      : "";
    const vend = p.vendedor ? ` (${nombre(p.vendedor)})` : "";
    await avisar("pedido_suite", String(p.id),
      `📝 <b>${p.cliente ?? p.cod_cliente}</b>${vend}: pedido cargado en Orbital Suite, <b>${p.total_units ?? 0} u.</b>${nota}`);
  }

  return new Response(JSON.stringify({ ok: true, enviados: enviados.length, detalle: enviados }), {
    headers: { "Content-Type": "application/json" },
  });
});
