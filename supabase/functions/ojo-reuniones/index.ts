import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// ojo-reuniones v9 — reunión que consigue un prospectador.
//
// Cualquiera del equipo avisa en el grupo que la consiguió, con sus palabras:
//   "Conseguí reunión en La Porteña el lunes a las 10, ¿puede ir Bruno?"
// Un prefiltro barato descarta el ruido y el LLM saca cliente / día / vendedor.
// También entiende el formato explícito, que no gasta LLM:
//   REUNIÓN / Cliente: 15012 ... / Día: lunes 21/09 10:00 / Vendedor: Bruno / Contacto: / Nota:
//
// El OK es del VENDEDOR, no de Gastón. Ojo le muestra lo que ya tenía asignado ese día y le
// ofrece traerle a ese día el recorrido de la zona de la reunión. Si dice que sí: intercambia los
// días, agenda el turno (agenda_turnos + agenda_eventos + proxima_agenda_fecha), le GENERA las
// visitas de campo cerca (si alguna no le sirve, la saca por número) y le avisa al que la consiguió
// que la confirme con la óptica. Si nadie dice quién va, pregunta al grupo. Si el vendedor propone
// otro día, se lo pasa al que la consiguió. Todo queda en ojo_reuniones.
//
// v9 (2026-09-29): (1) el cliente se busca sin "óptica"/"centro óptico" y por palabras; si hay
// varios (Longchamps I y II) pregunta cuál en vez de "no encontré"; (2) cualquier respuesta de
// error se contesta UNA vez (antes repetía "No encontré" cada 2 min); (3) en vez de correr toda la
// agenda un día, trae al día de la reunión el día del recorrido más cercano a la óptica
// (ojo_reunion_dia_cercano / ojo_reunion_traer_dia); (4) ronda a 3 km, hasta 8.
// ojo_dia_num cuenta desde el 28/9/2026 (INICIO_AGENDA de AgendaCampo.tsx).
//
// Va aparte de ojo-telegram para no redeployar el webhook: lee los mensajes que ojo-telegram
// ya guarda en ojo_mensajes_log. Corre por cron cada 2 minutos.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const GROQ_API_KEY = Deno.env.get("GROQ_API_KEY") ?? "";
const OJO_GROQ_MODEL = Deno.env.get("OJO_GROQ_MODEL") ?? "openai/gpt-oss-120b";
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const DIAS = ["domingo", "lunes", "martes", "miercoles", "jueves", "viernes", "sabado"];
const DIAS_REGEX: Array<[RegExp, number]> = [
  [/\bdomingo\b/, 0], [/\blunes\b/, 1], [/\bmartes\b/, 2], [/\bmi[eé]rcoles\b/, 3],
  [/\bjueves\b/, 4], [/\bviernes\b/, 5], [/\bs[aá]bado\b/, 6],
];
const SI_REUNION = /\b(si|sii+|dale|ok|okey|oka|listo|perfecto|va|confirmo|confirmado|de una|joya|barbaro|buenisimo|genial)\b|👍|✅|🙌/;
// "dale, no hay problema" es un sí: el no tiene que abrir la frase o ser explícito.
const NO_REUNION = /^\s*(no|nop|negativo)\b|\bno\s+(puedo|llego|va|voy|me sirve|da)\b|\bimposible\b|\bcancel/;
// Toma la reunión pero no quiere que le toque el recorrido. Se evalúa ANTES del no.
const SOLO_REUNION = /solo\s+(la\s+)?reunion|no\s+(muevas|corras|toques|cambies)|deja\s+(el|la|lo)|dejalo\s+como|sin\s+mover/;
const HORAS_ESPERA = 6;
// Si el día de la reunión ya queda a menos de esto (mediana) de la óptica, no se ofrece mover nada.
const METROS_ZONA_OK = 5000;

function esc(v: unknown): string {
  return String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function sinTilde(v: string): string {
  return v.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}
function ahoraArgentina(): Date {
  return new Date(Date.now() - 3 * 3600 * 1000);
}

async function telegramSend(chatId: number | string, text: string, replyToMessageId?: number) {
  const payload: Record<string, unknown> = { chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true };
  if (replyToMessageId) payload.reply_to_message_id = replyToMessageId;
  const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!data?.ok) { console.error("telegram", JSON.stringify(data)); return null; }
  // Se registra como lo hace ojo-telegram, para que el contexto del grupo quede completo.
  await supabase.from("ojo_mensajes_log").insert({
    telegram_chat_id: Number(chatId), telegram_message_id: data.result?.message_id ?? null,
    autor_nombre: "Ojo", texto: String(text).slice(0, 4000), es_del_bot: true,
  });
  return data.result?.message_id as number | undefined;
}

// ── LLM (mismo esquema que ojo-telegram: Claude y si no hay, Groq) ────────────

async function askAnthropic(system: string, userMsg: string, maxTokens: number): Promise<string | null> {
  if (!ANTHROPIC_API_KEY) return null;
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: "claude-sonnet-5", max_tokens: maxTokens, temperature: 0, system, messages: [{ role: "user", content: userMsg }] }),
    });
    const data = await res.json();
    if (data?.error) { console.error("Anthropic", JSON.stringify(data.error)); return null; }
    return data?.content?.find((c: { type: string }) => c.type === "text")?.text?.trim() ?? null;
  } catch (e) {
    console.error("Anthropic fetch", String(e));
    return null;
  }
}

async function askGroq(system: string, userMsg: string, maxTokens: number): Promise<string> {
  if (!GROQ_API_KEY) return "";
  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${GROQ_API_KEY}` },
      body: JSON.stringify({
        model: OJO_GROQ_MODEL, max_tokens: maxTokens, temperature: 0,
        response_format: { type: "json_object" },
        messages: [{ role: "system", content: system }, { role: "user", content: userMsg }],
      }),
    });
    const data = await res.json();
    if (data?.error) { console.error("Groq", JSON.stringify(data.error)); return ""; }
    return (data?.choices?.[0]?.message?.content ?? "").trim();
  } catch (e) {
    console.error("Groq fetch", String(e));
    return "";
  }
}

async function askLLM(system: string, userMsg: string, maxTokens = 600): Promise<string> {
  return (await askAnthropic(system, userMsg, maxTokens)) || (await askGroq(system, userMsg, maxTokens));
}

function parseJsonSafe(raw: string): any {
  const limpio = raw.replace(/```json|```/g, "").replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  try { return JSON.parse(limpio); } catch { /* sigue */ }
  const m = limpio.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch { /* nada */ } }
  return null;
}

// ── parseo del mensaje ────────────────────────────────────────────────────────

// Formato explícito (no gasta LLM). Tolera que lo arranquen nombrando al bot.
function parecePedidoReunion(texto: string): boolean {
  const t = sinTilde(texto).replace(/^\s*(hola\s+)?(ojo|@\w+)\b[\s,:.-]*/, "");
  if (!/^\s*(?:📅\s*)?reunion\b/.test(t)) return false;
  return /\bcliente\s*:/.test(t) && /\bdia\s*:/.test(t);
}

// Prefiltro barato: sin esto no se llama al LLM por cada mensaje del grupo.
function puedeSerReunion(texto: string): boolean {
  const t = sinTilde(texto);
  if (t.length < 15 || t.length > 600) return false;
  if (!/\breunion|\bentrevista|\bvisita\b|\bcita\b|nos recibe|me recibe|nos espera|acepto (la|una)/.test(t)) return false;
  return /\b(lunes|martes|miercoles|jueves|viernes|sabado|manana|pasado|hoy|\d{1,2}[\/\-]\d{1,2}|\d{1,2}\s*(hs|horas|:\d{2}))/.test(t);
}

const SISTEMA_REUNION = `Sos el asistente interno de Orbital Eyewear (fábrica de anteojos, Argentina).
El equipo prospecta ópticas y avisa en un grupo de Telegram cuando CONSIGUE una reunión o visita.
Te paso un mensaje del grupo. Decidí si alguien está avisando que YA consiguió una reunión concreta
con una óptica o comercio, con un día definido.

NO es una reunión conseguida si: la están pidiendo, la están evaluando, hablan de una reunión interna
del equipo, la comentan en pasado ("estuve ayer"), o no hay un cliente identificable.

Respondé SOLO un JSON:
{"es_reunion": true|false,
 "cliente": "nombre o código del cliente tal como aparece, o null",
 "dia_texto": "la parte del mensaje que dice cuándo, ej 'lunes 21/09 a las 10' o null",
 "vendedor": "nombre del vendedor que iría, si lo nombran, o null",
 "contacto": "nombre y/o teléfono de quien los recibe, o null",
 "nota": "algo útil para la visita, o null"}`;

async function interpretarReunion(texto: string): Promise<any | null> {
  const raw = await askLLM(SISTEMA_REUNION, texto, 500);
  if (!raw) return null;
  const j = parseJsonSafe(raw);
  if (!j || j.es_reunion !== true) return null;
  return j;
}

function campoReunion(texto: string, etiqueta: string): string | null {
  for (const linea of texto.split(/\n+/)) {
    if (new RegExp(`^\\s*${etiqueta}\\s*:`).test(sinTilde(linea))) {
      return linea.slice(linea.indexOf(":") + 1).trim() || null;
    }
  }
  return null;
}

// "lunes 21/09 10:00" / "21/9 10hs" / "lunes 10hs" -> fecha ISO + hora HH:MM.
function fechaHoraReunion(txt: string): { fecha: string | null; hora: string | null } {
  const t = sinTilde(txt);
  const hoy = ahoraArgentina();
  let fecha: string | null = null;

  const dmy = t.match(/\b(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?\b/);
  if (dmy) {
    const dia = Number(dmy[1]);
    const mes = Number(dmy[2]) - 1;
    const anio = dmy[3] ? Number(dmy[3].length === 2 ? `20${dmy[3]}` : dmy[3]) : hoy.getUTCFullYear();
    let d = new Date(Date.UTC(anio, mes, dia));
    if (!dmy[3] && d.getTime() < hoy.getTime() - 7 * 86400000) d = new Date(Date.UTC(anio + 1, mes, dia));
    if (!isNaN(d.getTime())) fecha = d.toISOString().slice(0, 10);
  } else {
    const dow = DIAS_REGEX.find(([re]) => re.test(t));
    if (dow) {
      const d = new Date(hoy.getTime());
      let saltos = (dow[1] - d.getUTCDay() + 7) % 7;
      if (saltos === 0) saltos = 7; // "lunes" dicho un lunes es el que viene
      d.setUTCDate(d.getUTCDate() + saltos);
      fecha = d.toISOString().slice(0, 10);
    }
  }

  let hora: string | null = null;
  const h = t.replace(/\b\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{2,4})?\b/, " ")
    .match(/\b(\d{1,2})(?:[:.](\d{2}))?\s*(?:hs?\b|horas\b)?/);
  if (h) {
    const hh = Number(h[1]);
    if (hh >= 6 && hh <= 21) hora = `${String(hh).padStart(2, "0")}:${h[2] ?? "00"}`;
  }
  return { fecha, hora };
}

function fechaLindaCorta(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  return `${DIAS[d.getUTCDay()]} ${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

// Fecha del día N de la agenda (N-ésimo hábil desde el 28/9/2026, igual que ojo_dia_num).
function fechaDeDiaNum(n: number): string {
  const d = new Date(Date.UTC(2026, 8, 28, 12));
  let k = 1;
  while (k < n) { d.setUTCDate(d.getUTCDate() + 1); if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) k++; }
  return d.toISOString().slice(0, 10);
}

// El día hábil siguiente, para decirle a dónde le paso el recorrido.
function habilSiguiente(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  do { d.setUTCDate(d.getUTCDate() + 1); } while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
  return d.toISOString().slice(0, 10);
}

// Lo que el vendedor ya tenía asignado ese día, con nombre.
async function paradasDelDia(vendedor: string, diaNum: number) {
  const { data: ruta } = await supabase.from("agenda_campo")
    .select("cod_cliente, localidad, subzona, orden_en_dia")
    .eq("vendedor", vendedor).eq("dia_num", diaNum).eq("bloque", "ba_gba").eq("visitado", false)
    .order("orden_en_dia");
  const filas = ruta ?? [];
  if (filas.length === 0) return [];
  const { data: cli } = await supabase.from("clientes")
    .select("cod, razon, nomcomerc").in("cod", filas.map((f) => f.cod_cliente));
  const porCod = new Map((cli ?? []).map((c) => [c.cod, nombreCliente(c)]));
  return filas.map((f) => ({ ...f, nombre: porCod.get(f.cod_cliente) ?? f.cod_cliente }));
}

function estadoCorto(c: any): string {
  if (c.ultima_compra_fecha) return `compró ${String(c.ultima_compra_fecha).slice(0, 7)}`;
  if (c.clasificacion_recupero === "sin_historial") return "nunca compró";
  return "sin compras cargadas";
}

const GENERICAS = new Set(["optica", "opticas", "centro", "optico", "opticos", "la", "el", "de", "del", "los", "las", "y", "sa", "srl"]);

// Devuelve el cliente, o la lista de candidatos si hay más de uno (para preguntar cuál).
async function buscarCliente(termino: string): Promise<{ cliente: any | null; candidatos: any[] }> {
  const t = termino.replace(/[()]/g, " ").trim();
  const cod = t.match(/\b(\d{5,6}|TMP-[0-9A-F]+|AG-[A-Z]{3}-\d{4})\b/i)?.[1];
  const campos = "cod, razon, nomcomerc, direccion, barrio, localidad, provincia, telefono, whatsapp, lat, lon, vendedor_asignado";
  if (cod) {
    const { data } = await supabase.from("clientes").select(campos).eq("cod", cod.toUpperCase()).maybeSingle();
    if (data) return { cliente: data, candidatos: [] };
  }
  const nombre = t.replace(/\b(\d{5,6}|TMP-[0-9A-F]+|AG-[A-Z]{3}-\d{4})\b/i, "").trim();
  // Palabras que distinguen: sin "óptica", "centro óptico", artículos.
  const palabras = sinTilde(nombre).split(/[^a-z0-9]+/).filter((p) => p.length >= 2 && !GENERICAS.has(p));
  if (palabras.length === 0) return { cliente: null, candidatos: [] };
  // La palabra más larga filtra en la base; el resto de las palabras se exige acá (sin tildes).
  const clave = [...palabras].sort((a, b) => b.length - a.length)[0];
  const { data } = await supabase.from("clientes").select(campos)
    .or(`razon.ilike.%${clave}%,nomcomerc.ilike.%${clave}%`).limit(60);
  const lista = (data ?? []).filter((c) => {
    const txt = sinTilde(`${c.razon ?? ""} ${c.nomcomerc ?? ""}`);
    return palabras.every((p) => txt.includes(p));
  }).slice(0, 6);
  if (lista.length === 1) return { cliente: lista[0], candidatos: [] };
  // Si alguno coincide exacto con lo escrito (sin "óptica"), ese.
  const exacto = lista.filter((c) => {
    const n = sinTilde(nombreCliente(c)).split(/[^a-z0-9]+/).filter((p) => p && !GENERICAS.has(p)).join(" ");
    return n === palabras.join(" ");
  });
  if (exacto.length === 1) return { cliente: exacto[0], candidatos: [] };
  return { cliente: null, candidatos: lista };
}

async function vendedorPorNombre(nombre: string): Promise<any | null> {
  const q = sinTilde(nombre).split(/\s+/)[0];
  const { data } = await supabase.from("vendedores").select("codigo, nombre, rol").eq("activo", true);
  const lista = (data ?? []).filter((v) => ["vendedor", "revendedor"].includes(v.rol));
  return lista.find((v) => sinTilde(v.codigo) === q) ??
    lista.find((v) => sinTilde(String(v.nombre)).split(/[\s(]+/)[0] === q) ?? null;
}

const nombreCliente = (c: any) => c?.nomcomerc?.trim() || c?.razon || c?.cod;

// Ojo por tema (2026-09-30): la reunión se le pregunta al vendedor en el grupo de Ventas; si todavía no
// existe, como antes: en el mismo grupo, o si la cargaron por privado, en el grupo de avisos.
async function grupoDeAvisos(chatOrigen: number): Promise<number> {
  const { data: v } = await supabase.from("ojo_temas").select("chat_id").eq("tema", "ventas").maybeSingle();
  if (v?.chat_id) return Number(v.chat_id);
  if (chatOrigen < 0) return chatOrigen;
  const { data: g } = await supabase.from("ojo_grupos")
    .select("telegram_chat_id").eq("recibe_avisos", true).eq("activo", true).limit(1).maybeSingle();
  return g?.telegram_chat_id ? Number(g.telegram_chat_id) : chatOrigen;
}

// Lo que es para el que la consiguió también le llega a su grupo (Prospección), si no es el mismo.
async function avisarAlQueLaConsiguio(r: any, texto: string) {
  const origen = Number(r.origen_chat_id);
  if (!origen || origen === Number(r.telegram_chat_id)) return;
  await telegramSend(origen, texto, Number(r.origen_message_id) || undefined);
}

// Queda registrado quién la consiguió, con el nombre que usa el equipo y no el de Telegram
// ("ORBITAL" es la cuenta de Administración).
async function quienLaConsiguio(telegramId: number | null, autorNombre: string): Promise<string> {
  if (telegramId) {
    const { data: rol } = await supabase.from("ojo_roles")
      .select("nombre, rol").eq("telegram_user_id", telegramId).maybeSingle();
    if (rol?.rol === "administracion") return "Administración";
    if (rol?.nombre) return rol.nombre;
  }
  const v = await vendedorPorNombre(autorNombre);
  return v?.codigo ?? autorNombre;
}

// ── 1. alta: el prospectador cargó la reunión en el grupo ─────────────────────

async function altaReuniones(): Promise<number> {
  const desde = new Date(Date.now() - 6 * 3600 * 1000).toISOString();
  const { data: msgs } = await supabase.from("ojo_mensajes_log")
    .select("telegram_chat_id, telegram_message_id, autor_nombre, autor_telegram_id, texto")
    .eq("es_del_bot", false).gte("creado_en", desde).order("creado_en").limit(200);

  let hechas = 0;
  for (const m of msgs ?? []) {
    const texto = String(m.texto ?? "");
    const estructurado = parecePedidoReunion(texto);
    if (!estructurado && !puedeSerReunion(texto)) continue;
    const { data: ya } = await supabase.from("ojo_reuniones").select("id")
      .eq("origen_chat_id", m.telegram_chat_id).eq("origen_message_id", m.telegram_message_id).maybeSingle();
    if (ya) continue;
    const { data: descartado } = await supabase.from("ojo_reunion_descartes").select("telegram_message_id")
      .eq("telegram_chat_id", m.telegram_chat_id).eq("telegram_message_id", m.telegram_message_id).maybeSingle();
    if (descartado) continue;

    const descartar = () => supabase.from("ojo_reunion_descartes")
      .insert({ telegram_chat_id: m.telegram_chat_id, telegram_message_id: m.telegram_message_id });
    // Cualquier respuesta de error se da UNA vez: el mensaje queda descartado y hay que mandarlo de nuevo corregido.
    const responder = async (t: string) => {
      await descartar();
      return telegramSend(Number(m.telegram_chat_id), t, Number(m.telegram_message_id));
    };

    let termCliente: string | null, termDia: string | null, termVend: string | null;
    let termContacto: string | null, termNota: string | null;
    if (estructurado) {
      termCliente = campoReunion(texto, "cliente");
      termDia = campoReunion(texto, "dia");
      termVend = campoReunion(texto, "vendedor");
      termContacto = campoReunion(texto, "contacto");
      termNota = campoReunion(texto, "nota");
      if (!termCliente || !termDia) {
        await responder("Para cargar la reunión necesito al menos <b>Cliente</b> y <b>Día</b>.");
        continue;
      }
    } else {
      // Lo dijeron con sus palabras: lo interpreta el LLM.
      const j = await interpretarReunion(texto);
      if (!j || !j.cliente || !j.dia_texto) { await descartar(); continue; }
      termCliente = String(j.cliente);
      termDia = String(j.dia_texto);
      termVend = j.vendedor ? String(j.vendedor) : null;
      termContacto = j.contacto ? String(j.contacto) : null;
      termNota = j.nota ? String(j.nota) : null;
    }

    const { cliente, candidatos } = await buscarCliente(termCliente);
    if (!cliente) {
      if (!estructurado && candidatos.length === 0) { await descartar(); continue; }
      if (candidatos.length > 1) {
        const lista = candidatos.map((c) => `• <code>${esc(c.cod)}</code> ${esc(nombreCliente(c))} — ${esc(c.direccion ?? "")} ${esc(c.localidad ?? "")}`).join("\n");
        await responder(`Hay ${candidatos.length} que coinciden con "${esc(termCliente)}":\n${lista}\n\nMandá la reunión de nuevo con el código en <b>Cliente:</b>.`);
      } else {
        await responder(`No encontré el cliente "${esc(termCliente)}". Mandá la reunión de nuevo con el código (ej: <code>15012</code>).`);
      }
      continue;
    }
    const { fecha, hora } = fechaHoraReunion(termDia);
    if (!fecha) {
      if (!estructurado) { await descartar(); continue; }
      await responder("No entendí el día. Mandala de nuevo con algo como <b>Día: lunes 21/09 10:00</b>.");
      continue;
    }

    // Vendedor: el que nombraron; si no, el asignado del cliente, siempre que haga calle.
    let vendedor = termVend ? await vendedorPorNombre(termVend) : null;
    if (!vendedor && cliente.vendedor_asignado) vendedor = await vendedorPorNombre(cliente.vendedor_asignado);
    if (!vendedor) {
      const quien = await quienLaConsiguio(m.autor_telegram_id, m.autor_nombre);
      const { data: sinVend } = await supabase.from("ojo_reuniones").insert({
        cod_cliente: cliente.cod, cliente_nombre: nombreCliente(cliente), vendedor: "?",
        fecha, hora, dia_num: null, contacto: termContacto, nota: termNota,
        conseguida_por: quien, conseguida_por_telegram_id: m.autor_telegram_id,
        origen: "telegram", origen_texto: texto.slice(0, 2000),
        origen_chat_id: m.telegram_chat_id, origen_message_id: m.telegram_message_id,
        estado: "sin_vendedor",
      }).select().single();
      if (sinVend) {
        const destinoSV = await grupoDeAvisos(Number(m.telegram_chat_id));
        const mid = await telegramSend(destinoSV,
          `📅 Reunión en <b>${esc(nombreCliente(cliente))}</b> (<code>${esc(cliente.cod)}</code>) el ${fechaLindaCorta(fecha)}${hora ? ` a las ${hora}` : ""} — la consiguió ${esc(quien)}.\n\n¿Quién la toma? Contestame con el nombre, o «yo» si vas vos.`);
        if (mid) {
          await supabase.from("ojo_reuniones")
            .update({ telegram_chat_id: destinoSV, telegram_message_id: mid }).eq("id", sinVend.id);
        }
        hechas++;
      }
      continue;
    }

    const { data: diaNum } = await supabase.rpc("ojo_dia_num", { p_fecha: fecha });
    const quien = await quienLaConsiguio(m.autor_telegram_id, m.autor_nombre);
    const { data: reunion, error } = await supabase.from("ojo_reuniones").insert({
      cod_cliente: cliente.cod, cliente_nombre: nombreCliente(cliente), vendedor: vendedor.codigo,
      fecha, hora, dia_num: typeof diaNum === "number" ? diaNum : null,
      contacto: termContacto, nota: termNota,
      conseguida_por: quien, conseguida_por_telegram_id: m.autor_telegram_id,
      origen: "telegram", origen_texto: texto.slice(0, 2000),
      origen_chat_id: m.telegram_chat_id, origen_message_id: m.telegram_message_id,
    }).select().single();
    if (error || !reunion) { console.error("alta reunion", JSON.stringify(error)); continue; }

    const destino = await grupoDeAvisos(Number(m.telegram_chat_id));
    await avisarReunion(reunion.id, destino);
    if (destino !== Number(m.telegram_chat_id)) {
      await telegramSend(Number(m.telegram_chat_id), `Listo, le pregunté a <b>${esc(vendedor.codigo)}</b> en el grupo por la reunión en ${esc(nombreCliente(cliente))}.`, Number(m.telegram_message_id));
    }
    hechas++;
  }
  return hechas;
}

// El aviso al vendedor: la reunión + lo que ya tenía ese día + qué puede contestar.
async function avisarReunion(id: string, destino: number, replyTo?: number) {
  const { data: r } = await supabase.from("ojo_reuniones").select("*").eq("id", id).maybeSingle();
  if (!r) return;
  const { data: cliente } = await supabase.from("clientes")
    .select("cod, razon, nomcomerc, direccion, barrio, localidad, provincia").eq("cod", r.cod_cliente).maybeSingle();

  // Lo que ya tenía asignado ese día. Si queda lejos de la óptica, le ofrezco traer a ese día
  // el recorrido de la zona de la reunión (y pasar lo de ese día al día de donde vino).
  let choque = "";
  let ofrecerCorrer = false;
  let propuesta: any = null;
  if (r.dia_num !== null) {
    const paradas = await paradasDelDia(r.vendedor, r.dia_num);
    const { data: cerca } = await supabase.rpc("ojo_reunion_dia_cercano", {
      p_vendedor: r.vendedor, p_cod: r.cod_cliente, p_dia: r.dia_num,
    });
    const mejor = (cerca as any)?.mejor ?? null;
    const actual = (cerca as any)?.actual ?? null;
    const lejos = !actual || Number(actual.metros) > METROS_ZONA_OK;
    if (paradas.length > 0) {
      const zonas = [...new Set(paradas.map((p) => p.localidad).filter(Boolean))];
      const detalle = paradas.slice(0, 8).map((p) => `• ${esc(p.nombre)} — ${esc(p.localidad ?? "")}`).join("\n");
      choque = `\n\nEse día tenías asignadas ${paradas.length} para ver${zonas.length ? ` en ${zonas.map(esc).join(" / ")}` : ""}:\n${detalle}`;
    }
    if (lejos && mejor && mejor.dia_num !== r.dia_num && Number(mejor.metros) < (actual ? Number(actual.metros) : Infinity)) {
      ofrecerCorrer = true;
      propuesta = { propuesta_desde: mejor.dia_num, zonas: mejor.zonas };
      choque += `\n\n¿Querés que te traiga a ese día el recorrido de <b>${esc(mejor.zonas)}</b> (lo tenías el ${fechaLindaCorta(fechaDeDiaNum(mejor.dia_num))}, a ~${Math.round(Number(mejor.metros) / 100) / 10} km de la óptica)${paradas.length ? ` y pase lo de ese día al ${fechaLindaCorta(fechaDeDiaNum(mejor.dia_num))}` : ""}?`;
    } else if (lejos && paradas.length > 0 && !mejor) {
      // Sin coordenadas para comparar: se ofrece correr el día como antes.
      ofrecerCorrer = true;
      choque += `\n\n¿Querés que te pase ese recorrido al ${fechaLindaCorta(habilSiguiente(r.fecha))} y te deje el día para la reunión?`;
    }
  }

  const donde = [cliente?.direccion, cliente?.barrio ?? cliente?.localidad].filter(Boolean).map(esc).join(", ");
  const cuerpo = [
    `📅 <b>${esc(r.vendedor)}</b> — reunión que consiguió ${esc(r.conseguida_por)}`,
    "",
    `<b>${esc(r.cliente_nombre)}</b> (<code>${esc(r.cod_cliente)}</code>)`,
    donde ? `📍 ${donde}` : null,
    `🕘 ${fechaLindaCorta(r.fecha)}${r.hora ? ` a las ${r.hora}` : ""}`,
    r.contacto ? `👤 ${esc(r.contacto)}` : null,
    r.nota ? `📝 ${esc(r.nota)}` : null,
  ].filter(Boolean).join("\n");

  const opciones = ofrecerCorrer
    ? `${esc(r.vendedor)}, contestá acá:\n<b>SÍ</b> = tomo la reunión y me armás el día en la zona\n<b>SOLO REUNIÓN</b> = la agendo y no te muevo nada\n<b>NO</b> = no va\nO decime otro día y se lo paso a ${esc(r.conseguida_por)}.`
    : `${esc(r.vendedor)}, ¿la tomás? Contestá <b>SÍ</b>, <b>NO</b>, o decime otro día y se lo paso a ${esc(r.conseguida_por)}.`;

  const mid = await telegramSend(destino, `${cuerpo}${choque}\n\n${opciones}`, replyTo);
  if (mid) {
    await supabase.from("ojo_reuniones").update({
      telegram_chat_id: destino, telegram_message_id: mid, correr_ofrecido: ofrecerCorrer,
      ...(propuesta ? { corrimiento: propuesta } : {}),
    }).eq("id", id);
  }
}

// ── 1b. nadie dijo quién va ───────────────────────────────────────────────────

// Acá contesta cualquiera del grupo, no sólo el vendedor: todavía no hay dueño.
async function resolverSinVendedor(): Promise<number> {
  const { data: pendientes } = await supabase.from("ojo_reuniones").select("*")
    .eq("estado", "sin_vendedor").not("telegram_message_id", "is", null)
    .gte("creado_en", new Date(Date.now() - HORAS_ESPERA * 3600 * 1000).toISOString());

  let hechas = 0;
  for (const r of pendientes ?? []) {
    const { data: msgs } = await supabase.from("ojo_mensajes_log")
      .select("telegram_message_id, autor_nombre, texto")
      .eq("telegram_chat_id", r.telegram_chat_id).eq("es_del_bot", false)
      .gt("telegram_message_id", Number(r.telegram_message_id))
      .order("telegram_message_id").limit(20);
    let elegido: any = null;
    let msgElegido: any = null;
    for (const m of msgs ?? []) {
      const t = String(m.texto ?? "").trim();
      if (t.length > 40) continue;
      // "yo", "la tomo", "voy yo": se la queda el que lo dice.
      if (/^\s*(yo|la tomo|lo tomo|voy yo|voy)\b/.test(sinTilde(t)) && !/\bno\b/.test(sinTilde(t))) {
        const v = await vendedorPorNombre(String(m.autor_nombre ?? ""));
        if (v) { elegido = v; msgElegido = m; break; }
      }
      for (const palabra of sinTilde(t).split(/[^a-z]+/).filter(Boolean)) {
        const v = await vendedorPorNombre(palabra);
        if (v) { elegido = v; msgElegido = m; break; }
      }
      if (elegido) break;
    }
    if (!elegido) continue;

    const { data: diaNum } = await supabase.rpc("ojo_dia_num", { p_fecha: r.fecha });
    await supabase.from("ojo_reuniones").update({
      vendedor: elegido.codigo, dia_num: typeof diaNum === "number" ? diaNum : null,
      estado: "propuesta", telegram_message_id: null,
    }).eq("id", r.id);
    await avisarReunion(r.id, Number(r.telegram_chat_id), Number(msgElegido.telegram_message_id));
    hechas++;
  }
  return hechas;
}

// El mensaje del vendedor que vino después del aviso. Corto, para no tomar
// cualquier charla como respuesta.
async function respuestaDelVendedor(r: any, desdeMessageId: number, largoMax: number) {
  const { data: msgs } = await supabase.from("ojo_mensajes_log")
    .select("telegram_message_id, autor_nombre, autor_telegram_id, texto, creado_en")
    .eq("telegram_chat_id", r.telegram_chat_id).eq("es_del_bot", false)
    .gt("telegram_message_id", desdeMessageId)
    .gte("creado_en", new Date(Date.now() - HORAS_ESPERA * 3600 * 1000).toISOString())
    .order("telegram_message_id").limit(40);
  const suyo = sinTilde(String(r.vendedor)).split(/\s+/)[0];
  for (const m of msgs ?? []) {
    if (sinTilde(String(m.autor_nombre ?? "")).split(/\s+/)[0] !== suyo) continue;
    const t = String(m.texto ?? "").trim();
    if (t.length > largoMax) continue;
    return { ...m, texto: t };
  }
  return null;
}

// ── 2. el vendedor contesta el aviso ──────────────────────────────────────────

async function resolverPropuestas(): Promise<number> {
  const { data: pendientes } = await supabase.from("ojo_reuniones").select("*")
    .eq("estado", "propuesta").not("telegram_message_id", "is", null)
    .gte("creado_en", new Date(Date.now() - HORAS_ESPERA * 3600 * 1000).toISOString());

  let hechas = 0;
  for (const r of pendientes ?? []) {
    const msg = await respuestaDelVendedor(r, Number(r.telegram_message_id), 80);
    if (!msg) continue;
    const t = sinTilde(msg.texto);
    // "no muevas nada" abre con no pero es un sí a la reunión: se mira primero.
    const soloReunion = SOLO_REUNION.test(t);
    const dijoNo = !soloReunion && NO_REUNION.test(t);
    const dijoSi = soloReunion || (SI_REUNION.test(t) && !dijoNo);

    // Ni sí ni no: si propone otro día, se lo paso al que la consiguió.
    if (!dijoSi && !dijoNo) {
      const otro = fechaHoraReunion(msg.texto);
      if (!otro.fecha || otro.fecha === r.fecha) continue;
      await supabase.from("ojo_reuniones").update({
        estado: "reprogramar", respuesta_texto: msg.texto.slice(0, 500),
        respondida_por: msg.autor_nombre, respondida_en: new Date().toISOString(),
      }).eq("id", r.id);
      const txtOtro = `📅 <b>${esc(r.conseguida_por)}</b>: ${esc(r.vendedor)} propone <b>${fechaLindaCorta(otro.fecha)}${otro.hora ? ` ${otro.hora}` : ""}</b> para ${esc(r.cliente_nombre)}, en vez del ${fechaLindaCorta(r.fecha)}.\nSi la óptica acepta, avisámelo y la cargo con la fecha nueva.`;
      await telegramSend(Number(r.telegram_chat_id), txtOtro, Number(msg.telegram_message_id));
      await avisarAlQueLaConsiguio(r, txtOtro);
      hechas++;
      continue;
    }

    if (dijoNo) {
      await supabase.from("ojo_reuniones").update({
        estado: "rechazada", respuesta_texto: msg.texto.slice(0, 500),
        respondida_por: msg.autor_nombre, respondida_en: new Date().toISOString(),
      }).eq("id", r.id);
      const txtNo = `Anotado, ${esc(r.vendedor)} no puede. <b>${esc(r.conseguida_por)}</b>: hay que reprogramar la de ${esc(r.cliente_nombre)}.`;
      await telegramSend(Number(r.telegram_chat_id), txtNo, Number(msg.telegram_message_id));
      await avisarAlQueLaConsiguio(r, txtNo);
      hechas++;
      continue;
    }

    // Primero se arma el día (el turno tiene que caer en el día ya armado), después se agenda.
    let corrido = "";
    if (r.correr_ofrecido && !soloReunion && r.dia_num !== null) {
      const desde = r.corrimiento?.propuesta_desde;
      if (desde) {
        // Trae al día de la reunión el recorrido de la zona y pasa lo que había a ese otro día.
        const { data: mov, error: eMov } = await supabase.rpc("ojo_reunion_traer_dia", {
          p_vendedor: r.vendedor, p_dia: r.dia_num, p_desde: desde,
        });
        if (eMov || !(mov as any)?.ok) {
          console.error("traer dia", JSON.stringify(eMov ?? mov));
        } else {
          await supabase.from("ojo_reuniones").update({ corrimiento: { ...r.corrimiento, ...(mov as any) } }).eq("id", r.id);
          corrido = `\n\n🔀 Ese día ahora es tu recorrido de <b>${esc(r.corrimiento.zonas ?? "la zona")}</b>; lo que tenías pasó al ${fechaLindaCorta(fechaDeDiaNum(desde))}.`;
        }
      } else {
        const { data: mov, error: eMov } = await supabase.rpc("ojo_reunion_correr_dia", {
          p_vendedor: r.vendedor, p_dia: r.dia_num, p_pasos: 1,
        });
        if (eMov || !(mov as any)?.ok) {
          console.error("correr dia", JSON.stringify(eMov ?? mov));
        } else {
          await supabase.from("ojo_reuniones").update({ corrimiento: mov }).eq("id", r.id);
          corrido = `\n\n🔀 Te pasé las visitas de campo de ese día al ${fechaLindaCorta(habilSiguiente(r.fecha))} (${(mov as any).campo} paradas); lo que venía después se corrió un día.`;
        }
      }
    }

    const { data: res, error } = await supabase.rpc("ojo_reunion_confirmar", {
      p_id: r.id, p_quien: msg.autor_nombre, p_texto: msg.texto.slice(0, 500),
    });
    if (error || !(res as any)?.ok) {
      console.error("confirmar", JSON.stringify(error ?? res));
      continue;
    }
    const diaNum = (res as any).dia_num;

    // El que la consiguió tiene que cerrarla con la óptica: así quedan todos comunicados.
    const { data: cli } = await supabase.from("clientes")
      .select("telefono, whatsapp, contacto").eq("cod", r.cod_cliente).maybeSingle();
    const tel = (cli?.whatsapp ?? cli?.telefono ?? "").toString().replace(/\D/g, "");
    const link = tel.length >= 8 ? `\n<a href="https://wa.me/${tel.length <= 11 ? `549${tel.replace(/^0/, "").replace(/^15/, "")}` : tel}">Escribirle por WhatsApp</a>` : "";
    const txtOk = `📣 <b>${esc(r.conseguida_por)}</b>: ${esc(r.vendedor)} confirmó. Confirmale a <b>${esc(r.cliente_nombre)}</b> que el ${fechaLindaCorta(r.fecha)}${r.hora ? ` a las ${r.hora}` : ""} pasa ${esc(r.vendedor)}.` +
      `${cli?.contacto ? `\n👤 ${esc(cli.contacto)}` : ""}${cli?.telefono || cli?.whatsapp ? `\n📞 ${esc(cli.whatsapp ?? cli.telefono)}` : ""}${link}`;
    await telegramSend(Number(r.telegram_chat_id), txtOk, Number(msg.telegram_message_id));
    await avisarAlQueLaConsiguio(r, txtOk);

    const { data: zona } = await supabase.rpc("ojo_reunion_zona", {
      p_cod: r.cod_cliente, p_vendedor: r.vendedor, p_km: 3, p_limite: 8, p_dia_num: diaNum,
    });
    const lista: any[] = Array.isArray(zona) ? zona : [];
    const cabeza = `✅ Agendada: <b>${esc(r.cliente_nombre)}</b>, ${fechaLindaCorta(r.fecha)}${r.hora ? ` ${r.hora}` : ""}. Quedó en la agenda de ${esc(r.vendedor)} y en la ficha del cliente.${corrido}`;

    if (lista.length === 0) {
      await telegramSend(Number(r.telegram_chat_id),
        `${cabeza}\n\nNo tengo otras ópticas con dirección cargada a menos de 3 km.`, Number(msg.telegram_message_id));
      hechas++;
      continue;
    }

    // Se le generan las visitas de la zona: no hay que pedirle que elija.
    const { data: sum } = await supabase.rpc("ojo_reunion_sumar", {
      p_id: r.id, p_cods: lista.map((c) => String(c.cod)), p_quien: msg.autor_nombre,
    });
    const filas = lista.map((c, i) =>
      `${i + 1}. <b>${esc(c.nombre)}</b> — ${esc(c.direccion ?? c.barrio ?? "")} (${Math.round(c.metros)} m) · ${estadoCorto(c)}`).join("\n");
    const movidas = ((sum as any)?.movidos ?? []).length
      ? `\n(${((sum as any).movidos as string[]).map(esc).join(", ")} ${((sum as any).movidos as string[]).length === 1 ? "la traje" : "las traje"} de otro día.)`
      : "";
    const mid = await telegramSend(Number(r.telegram_chat_id),
      `${cabeza}\n\nY ese día te sumé estas visitas cerca de la óptica:\n${filas}${movidas}\n\nSi alguna no te sirve, contestá este mensaje con su número y la saco.`,
      Number(msg.telegram_message_id));
    if (mid) await supabase.from("ojo_reuniones").update({ ronda: lista, ronda_message_id: mid }).eq("id", r.id);
    hechas++;
  }
  return hechas;
}

// ── 3. el vendedor saca alguna de las que se le generaron ─────────────────────

async function resolverRondas(): Promise<number> {
  const { data: abiertas } = await supabase.from("ojo_reuniones").select("*")
    .eq("estado", "confirmada").not("ronda_message_id", "is", null).is("ronda_elegidos", null)
    .gte("creado_en", new Date(Date.now() - 24 * 3600 * 1000).toISOString());

  let hechas = 0;
  for (const r of abiertas ?? []) {
    const msg = await respuestaDelVendedor(r, Number(r.ronda_message_id), 60);
    if (!msg) continue;
    const lista: any[] = Array.isArray(r.ronda) ? r.ronda : [];
    const t = sinTilde(msg.texto);
    const nums = [...t.matchAll(/\d+/g)].map((m) => Number(m[0])).filter((n) => n >= 1 && n <= lista.length);
    const sacar = [...new Set(nums)].map((n) => String(lista[n - 1].cod));
    if (sacar.length === 0) {
      // "está bien", "listo": deja de esperar.
      if (!/\bok\b|dale|listo|perfecto|esta bien|joya|ninguna|todas? bien/.test(t)) continue;
      await supabase.from("ojo_reuniones").update({ ronda_elegidos: to_keep(lista) }).eq("id", r.id);
      hechas++;
      continue;
    }

    const { data: res, error } = await supabase.rpc("ojo_reunion_quitar", {
      p_id: r.id, p_cods: sacar, p_quien: msg.autor_nombre,
    });
    if (error || !(res as any)?.ok) { console.error("quitar", JSON.stringify(error ?? res)); continue; }
    const sacadas: string[] = (res as any).sacadas ?? [];
    await supabase.from("ojo_reuniones").update({ ronda_elegidos: to_keep(lista, sacar) }).eq("id", r.id);
    await telegramSend(Number(r.telegram_chat_id),
      sacadas.length ? `Listo, saqué del día ${(res as any).dia_num}: ${sacadas.map(esc).join(", ")}.` : "Esas ya no estaban en el día.",
      Number(msg.telegram_message_id));
    hechas++;
  }
  return hechas;
}

// Lo que queda en el día después de sacar, para no volver a procesar la misma respuesta.
function to_keep(lista: any[], sacadas: string[] = []): string[] {
  return lista.map((c) => String(c.cod)).filter((cod) => !sacadas.includes(cod));
}

// ── 4. nadie contestó ───────────────────────────────────────────────────────

async function avisarSinRespuesta(): Promise<number> {
  const limite = new Date(Date.now() - 3 * 3600 * 1000).toISOString();
  const { data: mudas } = await supabase.from("ojo_reuniones").select("*")
    .in("estado", ["propuesta", "sin_vendedor"]).not("telegram_message_id", "is", null)
    .is("aviso_mudo_en", null).lt("creado_en", limite)
    .gte("creado_en", new Date(Date.now() - 24 * 3600 * 1000).toISOString());
  let hechas = 0;
  for (const r of mudas ?? []) {
    const txtMudo = `⏰ <b>${esc(r.conseguida_por)}</b>: todavía nadie me confirmó la reunión en ${esc(r.cliente_nombre)} (${fechaLindaCorta(r.fecha)}${r.hora ? ` ${r.hora}` : ""}).`;
    await telegramSend(Number(r.telegram_chat_id), txtMudo, Number(r.telegram_message_id));
    await avisarAlQueLaConsiguio(r, txtMudo);
    await supabase.from("ojo_reuniones").update({ aviso_mudo_en: new Date().toISOString() }).eq("id", r.id);
    hechas++;
  }
  return hechas;
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const solo = url.searchParams.get("solo");
  try {
    const altas = solo && solo !== "alta" ? 0 : await altaReuniones();
    const duenos = solo && solo !== "dueno" ? 0 : await resolverSinVendedor();
    const propuestas = solo && solo !== "propuesta" ? 0 : await resolverPropuestas();
    const rondas = solo && solo !== "ronda" ? 0 : await resolverRondas();
    const avisos = solo && solo !== "aviso" ? 0 : await avisarSinRespuesta();
    return new Response(JSON.stringify({ altas, duenos, propuestas, rondas, avisos }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("ojo-reuniones", String((e as Error)?.stack ?? e));
    return new Response(JSON.stringify({ error: String((e as Error)?.message ?? e) }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
});
