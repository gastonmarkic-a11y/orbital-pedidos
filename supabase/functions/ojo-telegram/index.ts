import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Ojo v29 — asistente interno de Orbital en Telegram.
//   v34 (2026-09-23, Gaston): "/derivar <cliente> a <quien> [nota]" manda al grupo de avisos la ficha
//   (tel + wa.me, mail, localidad, quien lo atiende, ultimo mensaje) para que el asignado contacte.
//   v32 (2026-09-17, Gaston): ojo-escalar escala los 🆘 sin respuesta ("no tengo respuesta de X,
//   ¿algun vendedor puede tomar este caso?", ojo_derivacion_escalada). Respondiendo «yo» a ese
//   mensaje: vendedor -> propuesta tomar_derivacion con SI de Gaston; Gaston -> se aplica directo.
//   Al confirmar: derivacion tomada por el nuevo, WhatsApp al nuevo (ojo-avisos avisar_asignado).
//   v22 (2026-09-10): en la charla del equipo no contesta consultas salvo que le hablen
//   (lo nombran, le responden a el, o la pregunta es para el sistema).
//   v23 (2026-09-10): lee la Suite entera via ojo_consulta_suite (pedidos, precargas,
//   catalogo, carritos, agenda, envios, disponibilidad, clientes, link del catalogo)
//   y guarda sus propias respuestas en ojo_mensajes_log (es_del_bot = true).
//   v24 (2026-09-11): la plata (importes, precios, facturacion) solo con OK de Gaston:
//   si alguien la pide, Ojo le pregunta por privado (SI/NO) y recien ahi contesta.
//   v29 (2026-09-14): unificar clientes duplicados (cliente_unificar, con SI de Gaston); rol
//   "administracion" en ojo_roles pone el numero de cliente sin pasar por Gaston; bandeja ojo_salida
//   para mandar mensajes cargados desde la base (POST {"ojo_salida": true}).
//   v28 (2026-09-14): opera la Suite con el OK de Gaston (tipo suite_op): prospectos (el vendedor
//   carga, Administracion pone el numero respondiendo el aviso), numero de cliente, reasignar vendedor,
//   estado / anular / editar pedido (funciones ojo_op_* en una transaccion, con stock), agenda,
//   recorrido de campo, acceso y dispositivos del catalogo, proyectado y registrar envio de propuesta.
//   Consultas nuevas: cobranzas, envios fisicos, contactados, links del catalogo/landings y piezas.
//   Los pedidos que carga Ojo ahora descuentan stock como la Suite.
//   v27 (2026-09-14): el privado usa el MISMO circuito que el grupo: cargas con SI/NO, pendientes,
//   cierres y consultas. Antes el privado era solo charla y llego a inventar "quedo registrado".
//   v26 (2026-09-14): por privado tambien consulta el sistema (stock/colores/SKU de un modelo, clientes, pedidos).
//   v25 (2026-09-11): un numero de cliente solo ("030440") contesta sus compras
//   (piezas de los ultimos 12 meses); la ficha encuentra nombres mal escritos.
//   Las fotos con texto (caption) ya no se ignoran; la foto en si todavia no se lee.
//   • consultas: stock, cliente y sus pedidos, como viene la tanda, info interna
//   • pendientes del equipo (responsable + plazo + insistencia)
//   • carga con OK de Gaston: pedido ('pendiente'), devolucion ('borrador'),
//     cobranza (sin conciliar), dato de cliente, conocimiento para IRIS
//   • responde al cliente: contestando un mensaje de hilo (ojo_hilos) el texto sale
//     por WhatsApp/IG/Messenger via at-responder y cierra la derivacion.
// NO publica en ninguna tienda.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const GROQ_API_KEY = Deno.env.get("GROQ_API_KEY") ?? "";
const OJO_GROQ_MODEL = Deno.env.get("OJO_GROQ_MODEL") ?? "openai/gpt-oss-120b";
const TELEGRAM_WEBHOOK_SECRET = Deno.env.get("TELEGRAM_WEBHOOK_SECRET") ?? "";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const CAMPOS_EDITABLES_CLIENTE = [
  "telefono", "direccion", "email", "contacto", "whatsapp", "nota",
  "proximo_paso", "proxima_agenda_fecha", "prioridad", "zona", "localidad",
  "provincia", "horario_entrega",
];

const AREAS: Record<string, { label: string; contexto: string; prospecta: boolean; claves: string[] }> = {
  ventas: { label: "Ventas", contexto: "equipo comercial: clientes, pedidos, visitas, prospeccion, cobranza", prospecta: true, claves: ["venta", "comercial", "vendedor"] },
  administracion: { label: "Administracion", contexto: "facturacion, notas de credito, cobranzas, cuentas corrientes, Tango", prospecta: true, claves: ["admin", "factur", "cobranza", "contab"] },
  produccion: { label: "Produccion", contexto: "fabrica: armado, insumos, tiempos de fabricacion, calidad", prospecta: true, claves: ["produc", "fabrica", "planta"] },
  gerencia: { label: "Gerencia", contexto: "direccion: decisiones, objetivos, seguimiento del negocio", prospecta: true, claves: ["gerenc", "direcc", "jefes"] },
  deposito: { label: "Deposito", contexto: "deposito y logistica: stock, armado de pedidos, despachos, envios, devoluciones", prospecta: false, claves: ["deposito", "logistic", "stock", "despacho"] },
  finanzas: { label: "Finanzas", contexto: "tesoreria, cheques, bancos, vencimientos, flujo de caja", prospecta: true, claves: ["finanz", "tesorer", "cheque", "banco"] },
  general: { label: "General", contexto: "grupo de toda la empresa: ventas, administracion, produccion, gerencia y deposito mezclados", prospecta: true, claves: ["general", "orbital", "equipo", "todos"] },
  // Ojo por tema (2026-09-30): estos grupos los da de alta ojo-grupos; las claves no se usan para inferir
  // (van despues de "ventas", que ya matchea "postventa").
  prospeccion: { label: "Prospeccion", contexto: "prospectadores (Mauro, Ulises, Administracion): reuniones conseguidas con opticas, seguimiento de prospectos", prospecta: true, claves: ["prospec"] },
  consumidor: { label: "Consumidor final", contexto: "consumidores finales (Gustavo): consultas de compra, recomendaciones y busquedas de anteojos", prospecta: false, claves: ["consumidor"] },
  postventa: { label: "Postventa", contexto: "postventa: roturas, garantias, repuestos, cambios, devoluciones, demoras y reclamos", prospecta: false, claves: ["postventa"] },
};

const DIAS = ["domingo", "lunes", "martes", "miercoles", "jueves", "viernes", "sabado"];
const DIAS_REGEX: Array<[RegExp, number]> = [
  [/\bdomingo\b/, 0], [/\blunes\b/, 1], [/\bmartes\b/, 2], [/\bmi[eé]rcoles\b/, 3],
  [/\bjueves\b/, 4], [/\bviernes\b/, 5], [/\bs[aá]bado\b/, 6],
];

function ahoraArgentina() {
  const d = new Date(Date.now() - 3 * 3600 * 1000);
  return { d, dia: DIAS[d.getUTCDay()], fecha: d.toISOString().slice(0, 10), hora: d.toISOString().slice(11, 16) };
}

function fechaPedido(): string {
  const d = new Date(Date.now() - 3 * 3600 * 1000);
  return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}, ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}:${String(d.getUTCSeconds()).padStart(2, "0")}`;
}

function plazoValido(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (isNaN(t)) return null;
  const ahora = Date.now();
  if (t < ahora - 12 * 3600 * 1000) return null;
  if (t > ahora + 90 * 86400 * 1000) return null;
  return new Date(t).toISOString();
}

function resolverPlazo(texto: string, plazoModelo: string | null): string | null {
  const t = texto.toLowerCase();
  const base = ahoraArgentina();
  const hoyIdx = base.d.getUTCDay();
  let dias: number | null = null;
  if (/\bpasado ma[nñ]ana\b/.test(t)) dias = 2;
  else if (/\bma[nñ]ana\b/.test(t)) dias = 1;
  else if (/\bhoy\b|\bahora\b/.test(t)) dias = 0;
  else if (/\bsemana que viene\b|\bpr[oó]xima semana\b/.test(t)) dias = 7;
  else {
    for (const [re, idx] of DIAS_REGEX) {
      if (re.test(t)) {
        dias = (idx - hoyIdx + 7) % 7;
        if (dias === 0) dias = 7;
        break;
      }
    }
  }
  const delModelo = plazoValido(plazoModelo);
  if (dias === null) return delModelo;
  let horaAR = 18, minAR = 0;
  if (delModelo) {
    const m = new Date(new Date(delModelo).getTime() - 3 * 3600 * 1000);
    const h = m.getUTCHours();
    if (h >= 6 && h <= 23) { horaAR = h; minAR = m.getUTCMinutes(); }
  }
  const objetivo = new Date(base.d.getTime());
  objetivo.setUTCDate(objetivo.getUTCDate() + dias);
  objetivo.setUTCHours(horaAR, minAR, 0, 0);
  return new Date(objetivo.getTime() + 3 * 3600 * 1000).toISOString();
}

function inferirArea(nombreGrupo: string): string {
  const n = (nombreGrupo ?? "").toLowerCase();
  for (const [tipo, def] of Object.entries(AREAS)) {
    if (def.claves.some((k) => n.includes(k))) return tipo;
  }
  return "general";
}

function fechaLinda(iso: string): string {
  return new Date(iso).toLocaleString("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires",
    weekday: "long", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
  });
}

function plata(n: number | null | undefined): string {
  if (n === null || n === undefined) return "";
  return "$" + Math.round(Number(n)).toLocaleString("es-AR");
}

async function telegramSend(chatId: number | string, text: string, replyToMessageId?: number) {
  text = String(text).replace(/\*\*([^*\n]+?)\*\*/g, "<b>$1</b>");
  const payload: Record<string, unknown> = { chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true };
  if (replyToMessageId) payload.reply_to_message_id = replyToMessageId;
  const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!data?.ok) console.error("Telegram sendMessage error:", JSON.stringify(data));
  else {
    // Se guarda lo que contesta Ojo: para auditar y como contexto del proximo mensaje.
    const { error } = await supabase.from("ojo_mensajes_log").insert({
      telegram_chat_id: Number(chatId), telegram_message_id: data.result?.message_id ?? null,
      autor_nombre: "Ojo", texto: String(text).slice(0, 4000), es_del_bot: true,
    });
    if (error) console.error("log respuesta Ojo", JSON.stringify(error));
  }
  return data;
}

async function askAnthropic(system: string, userMsg: string, maxTokens: number): Promise<string | null> {
  if (!ANTHROPIC_API_KEY) return null;
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: "claude-sonnet-5", max_tokens: maxTokens, system, messages: [{ role: "user", content: userMsg }] }),
    });
    const data = await res.json();
    if (data?.error) { console.error("Anthropic API error:", JSON.stringify(data.error)); return null; }
    const textBlock = data?.content?.find((c: { type: string }) => c.type === "text");
    return textBlock?.text?.trim() ?? null;
  } catch (e) {
    console.error("Anthropic fetch error:", String(e));
    return null;
  }
}

async function groqCall(system: string, userMsg: string, maxTokens: number, json: boolean) {
  const body: Record<string, unknown> = {
    model: OJO_GROQ_MODEL, max_tokens: maxTokens, temperature: 0,
    messages: [{ role: "system", content: system }, { role: "user", content: userMsg }],
  };
  if (json) body.response_format = { type: "json_object" };
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${GROQ_API_KEY}` },
    body: JSON.stringify(body),
  });
  return await res.json();
}

async function askGroq(system: string, userMsg: string, maxTokens: number, json: boolean): Promise<string> {
  if (!GROQ_API_KEY) return "";
  try {
    let data = await groqCall(system, userMsg, maxTokens, json);
    if (data?.error && json) {
      console.error("Groq API error (reintento sin json):", JSON.stringify(data.error));
      data = await groqCall(system, userMsg, maxTokens, false);
    }
    if (data?.error) { console.error("Groq API error:", JSON.stringify(data.error)); return ""; }
    return (data?.choices?.[0]?.message?.content ?? "").trim();
  } catch (e) {
    console.error("Groq fetch error:", String(e));
    return "";
  }
}

async function askLLM(system: string, userMsg: string, maxTokens = 1500, json = false): Promise<string> {
  const claude = await askAnthropic(system, userMsg, maxTokens);
  if (claude) return claude;
  return await askGroq(system, userMsg, maxTokens, json);
}

function parseJsonSafe(raw: string): any {
  const limpio = raw.replace(/```json|```/g, "").replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  try { return JSON.parse(limpio); } catch { /* sigue */ }
  const m = limpio.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch { /* nada */ } }
  return null;
}

function esc(v: unknown): string {
  return String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function sinTilde(v: string): string {
  return v.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

function ddmm(): string {
  const f = ahoraArgentina().fecha;
  return `${f.slice(8, 10)}/${f.slice(5, 7)}`;
}

// Dias habiles salteando fines de semana y la tabla feriados (como SIGUIENTE_PASO en la Suite).
async function sumarDiasHabiles(n: number): Promise<string> {
  const hoy = ahoraArgentina().fecha;
  const { data } = await supabase.from("feriados").select("fecha").gte("fecha", hoy);
  const feriados = new Set((data ?? []).map((f) => String(f.fecha)));
  const d = new Date(`${hoy}T12:00:00Z`);
  let k = 0;
  while (k < n) {
    d.setUTCDate(d.getUTCDate() + 1);
    const iso = d.toISOString().slice(0, 10);
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6 && !feriados.has(iso)) k++;
  }
  return d.toISOString().slice(0, 10);
}

// Usuario de Telegram -> codigo de vendedor. Ulises escribe como "misericordia".
const ALIAS_TELEGRAM: Record<string, string> = { misericordia: "Ulises" };

async function vendedorPorNombre(nombre: string | null | undefined, soloComerciales = true): Promise<any | null> {
  if (!nombre) return null;
  const q = sinTilde(ALIAS_TELEGRAM[sinTilde(nombre)] ?? String(nombre));
  if (!q) return null;
  const { data } = await supabase.from("vendedores").select("codigo, nombre, rol, telefono_remitente").eq("activo", true);
  const lista = (data ?? []).filter((v) => !soloComerciales || ["vendedor", "revendedor"].includes(v.rol) || v.codigo === "Mauro");
  const primera = q.split(/\s+/)[0];
  return lista.find((v) => sinTilde(v.codigo) === q) ??
    lista.find((v) => sinTilde(v.codigo) === primera) ??
    lista.find((v) => sinTilde(String(v.nombre)).split(/[\s(]+/)[0] === primera) ?? null;
}

// Roles que no son admin (hoy: "administracion" = ORBITAL Administracion).
async function tieneRol(telegramUserId: number, rol: string): Promise<boolean> {
  const { data } = await supabase.from("ojo_roles").select("rol").eq("telegram_user_id", telegramUserId).maybeSingle();
  return data?.rol === rol;
}

async function getAdminIds(): Promise<number[]> {
  const { data } = await supabase.from("ojo_admins").select("telegram_user_id");
  return (data ?? []).map((a) => a.telegram_user_id);
}

async function sendToAllAdmins(text: string) {
  const ids = await getAdminIds();
  for (const id of ids) await telegramSend(id, text);
}

type Articulo = { pedido: string; codigo?: string; modelo?: string; descripcion?: string; cantidad?: number; stock?: number; precio?: number };

// Busca TODOS los (NNN-XX) del texto, en una linea o en varias. El modelo es la
// ultima palabra en MAYUSCULAS antes del codigo ("ASCARI", "LE MANS").
async function detectarArticulos(texto: string): Promise<Articulo[]> {
  const salida: Articulo[] = [];
  const vistos = new Set<string>();
  const re = /\((\d{3})\s*-\s*([0-9A-Za-z]{2})\)/g;
  let m: RegExpExecArray | null;

  while ((m = re.exec(texto)) !== null) {
    const sufijo = `${m[1]}${m[2]}`.toUpperCase();
    const antes = texto.slice(Math.max(0, m.index - 200), m.index);
    const mayus = antes.match(/[A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ0-9]{2,}(?:\s+[A-ZÁÉÍÓÚÑ0-9]{2,})*/g);
    const modelo = mayus && mayus.length ? mayus[mayus.length - 1].trim() : "";

    const despues = texto.slice(m.index + m[0].length, m.index + m[0].length + 25);
    const mCant = despues.match(/x\s*(\d{1,3})\b/i) ?? antes.slice(-15).match(/(\d{1,3})\s*x\s*$/i);
    const cantidad = mCant ? parseInt(mCant[1], 10) : 1;

    const clave = `${modelo}|${sufijo}`;
    if (vistos.has(clave)) continue;
    vistos.add(clave);

    const pedido = `${modelo || "?"} (${m[1]}-${m[2]})`;
    const { data } = await supabase.rpc("ojo_buscar_articulo", { p_modelo: modelo, p_sufijo: sufijo });
    const hit = (data ?? [])[0];
    if (!hit) { salida.push({ pedido, cantidad }); continue; }
    salida.push({
      pedido, codigo: hit.codigo, modelo: hit.modelo, descripcion: hit.descripcion,
      cantidad, stock: hit.cantidad, precio: hit.precio ? Number(hit.precio) : undefined,
    });
  }
  return salida;
}

// Para cargar algo se usan los articulos del MENSAJE. Solo si el mensaje no trae
// ninguno (ej: "cargale eso a Gafas Luxury") se mira el contexto anterior; si no,
// una devolucion terminaria arrastrando los items de un pedido de hace 5 minutos.
async function articulosDelPedido(texto: string, contexto: string): Promise<Articulo[]> {
  const propios = (await detectarArticulos(texto)).filter((a) => a.codigo);
  if (propios.length > 0) return propios;
  return (await detectarArticulos(contexto)).filter((a) => a.codigo);
}

async function detalleArticulos(textoCompleto: string): Promise<string> {
  const arts = await detectarArticulos(textoCompleto);
  if (arts.length === 0) return "";
  const lineas = arts.map((a) => {
    if (!a.codigo) return `• ${a.pedido} — <b>no lo encontré</b> en el sistema`;
    const stock = (a.stock ?? 0) > 0 ? `${a.stock} u. en stock` : "<b>sin stock</b>";
    return `• ${a.modelo} ${a.descripcion} (<code>${a.codigo}</code>) — ${stock}`;
  });
  return `\n\nLos busqué en el sistema:\n${lineas.join("\n")}`;
}

async function buscarClientes(termino: string) {
  const { data } = await supabase
    .from("clientes")
    .select("cod, razon, nomcomerc, telefono, direccion, email, localidad, provincia, contacto, whatsapp, nota, prioridad, zona, nro_lista, vendedor_asignado")
    .or(`razon.ilike.%${termino}%,nomcomerc.ilike.%${termino}%,cod.ilike.%${termino}%,telefono.ilike.%${termino}%`)
    .limit(5);
  return data ?? [];
}

async function clienteUnico(termino: string | null | undefined, chatId: number, messageId: number): Promise<any | null> {
  if (!termino) {
    await telegramSend(chatId, "¿De qué cliente se trata? Deciíme el nombre o el código.", messageId);
    return null;
  }
  const clientes = await buscarClientes(termino);
  if (clientes.length === 0) {
    await telegramSend(chatId, `No encontré ningún cliente que coincida con "${termino}".`, messageId);
    return null;
  }
  if (clientes.length > 1) {
    const lista = clientes.map((c) => `• ${c.razon ?? c.nomcomerc} (cod ${c.cod})`).join("\n");
    await telegramSend(chatId, `Encontré varios con "${termino}", ¿cuál es?\n${lista}`, messageId);
    return null;
  }
  return clientes[0];
}

async function resolverCliente(termino: unknown): Promise<{ cliente?: any; error?: string }> {
  const t = String(termino ?? "").trim();
  if (!t) return { error: "¿De qué cliente? Decime el nombre o el código." };
  const campos = "cod, razon, nomcomerc, vendedor_asignado, nota, telefono, whatsapp, localidad, email, contacto, agenda_owner, nro_lista";
  const { data: exacto } = await supabase.from("clientes").select(campos).eq("cod", t.toUpperCase()).maybeSingle();
  if (exacto) return { cliente: exacto };
  const lista = await buscarClientes(t);
  if (lista.length === 1) {
    const { data } = await supabase.from("clientes").select(campos).eq("cod", lista[0].cod).maybeSingle();
    return { cliente: data };
  }
  if (lista.length > 1) {
    return { error: `Encontré varios con "${esc(t)}", ¿cuál es?\n${lista.map((c) => `• ${esc(c.razon ?? c.nomcomerc)} (cod ${c.cod})`).join("\n")}` };
  }
  const { data: ficha } = await supabase.rpc("ojo_ficha_cliente", { p_texto: t });
  const cod = (ficha as any)?.cliente?.cod;
  if (cod) {
    const { data } = await supabase.from("clientes").select(campos).eq("cod", cod).maybeSingle();
    if (data) return { cliente: data };
  }
  return { error: `No encontré ningún cliente que coincida con "${esc(t)}".` };
}

const nombreCliente = (c: any) => c?.nomcomerc?.trim() || c?.razon || c?.cod;

// Numero de cliente solo ("030440", "@bot 030440", "cliente 030440"). Devuelve el cod
// si existe; si no es un cliente (ej: una cantidad suelta) sigue el flujo normal.
async function codigoClienteSolo(texto: string): Promise<string | null> {
  const m = texto.replace(/@\w+/g, " ").replace(/\b(ojo|cliente)\b[,:]?/gi, " ").trim()
    .match(/^(\d{5,6}|AG-[A-Z]{3}-\d{4})$/i);
  if (!m) return null;
  const { data } = await supabase.from("clientes").select("cod").eq("cod", m[1].toUpperCase()).maybeSingle();
  return data?.cod ?? null;
}

const preguntaCompras = (cod: string) => `¿Cuántas piezas compró el cliente ${cod} en el último año?`;

// Preguntas de plata (importes, precios, facturacion): solo con OK de Gaston.
const PIDE_PLATA = /\$|\bplata\b|\bguita\b|importe|\bmonto|\bprecio|\bpesos\b|facturaci[oó]n|cu[aá]nto (sale|sali[oó]|cuesta|cost|fue|cobr|suma|vend|gast|factur)/i;

// Arma la respuesta a una consulta con los datos del sistema. conPlata = false borra
// importes y precios (Gaston no lo autorizo); true los incluye.
async function armarRespuestaConsulta(texto: string, sobreCliente: string | null | undefined, conPlata: boolean): Promise<string | null> {
  const pideTanda = /\btanda\b|\bcontactos\b|\bprospecc/i.test(texto);
  const [stockRes, conocRes, suiteRes, tandaRes] = await Promise.all([
    supabase.rpc("stock_en_mensaje", { p_texto: texto }),
    supabase.rpc("buscar_conocimiento", { q: texto, n: 3 }),
    supabase.rpc(conPlata ? "ojo_consulta_suite_raw" : "ojo_consulta_suite", { p_texto: texto, p_cliente: sobreCliente ?? null }),
    pideTanda ? supabase.rpc("ojo_tanda", { p_vendedor: null }) : Promise.resolve({ data: null }),
  ]);

  const stock = (stockRes.data ?? []).slice(0, 25);
  const conocimiento = conocRes.data ?? [];
  if ((suiteRes as any).error) console.error("ojo_consulta_suite", JSON.stringify((suiteRes as any).error));
  const suite = suiteRes.data ?? null;
  const tanda = tandaRes.data ?? null;
  const articulosTodos = await detectarArticulos(texto);
  const articulos = conPlata ? articulosTodos : articulosTodos.map(({ precio: _p, ...a }) => a);

  // Cliente de la pregunta: codigo escrito o el que detecto el clasificador.
  let codCliente: string | null = texto.match(/\b(\d{6}|AG-[A-Z]{3}-\d{4}|TMP-\d{8})\b/i)?.[1]?.toUpperCase() ?? null;
  if (!codCliente && sobreCliente) {
    const r = await resolverCliente(sobreCliente);
    codCliente = r.cliente?.cod ?? null;
  }
  const { data: extra, error: errExtra } = await supabase.rpc("ojo_consulta_extra", { p_texto: texto, p_cod: codCliente, p_plata: conPlata });
  if (errExtra) console.error("ojo_consulta_extra", JSON.stringify(errExtra));
  let links: Record<string, string> | null = null;
  if (codCliente && /link|landing|propuesta|cat[aá]logo/i.test(texto)) {
    const { data: tk } = await supabase.rpc("catalogo_link_cliente", { p_cod_cliente: codCliente });
    if ((tk as any)?.ok && (tk as any)?.codigo) {
      const k = (tk as any).codigo;
      links = {
        catalogo: `https://ver.orbitaleyewear.com.ar/catalogo?k=${k}`,
        triple_proteccion: `https://ver.orbitaleyewear.com.ar/tripleproteccion?c=${k}`,
        bienvenida: `https://ver.orbitaleyewear.com.ar/bienvenida?c=${k}`,
        canje: `https://ver.orbitaleyewear.com.ar/canje?c=${k}`,
      };
    }
  }

  const hayDatos = stock.length > 0 || conocimiento.length > 0 || tanda ||
    !!suite || articulos.some((a) => a.codigo);
  if (!hayDatos) return null;

  const reglaPlata = conPlata
    ? "Gaston autorizo los datos de plata: podes dar importes y precios. Los precios de stock son de lista 5 (base) en NETO, sin IVA: aclaralo."
    : "NUNCA menciones plata: ni importes, ni precios, ni montos de pedidos o facturacion. Solo cantidades.";

  const system = `Sos "Ojo", el asistente interno de Orbital Eyewear (fabrica de anteojos). Un empleado pregunta algo por el grupo de trabajo.
DATOS DEL SISTEMA (lo unico que podes usar, no inventes nada):
Stock por modelo/color: ${JSON.stringify(stock)}
Articulos mencionados con codigo: ${JSON.stringify(articulos)}
Datos de Orbital Suite (horas de Argentina; resumen del dia + pedidos, precargas del catalogo, visitas al catalogo, carritos, agenda y recorrido, envios, disponibilidad por color con lo proyectado, clientes y ficha del cliente con su link del catalogo): ${JSON.stringify(suite)}
Tanda de hoy (contactos de prospeccion por vendedor; "hechos" son los ya contactados y "pendientes" los que faltan): ${JSON.stringify(tanda)}
Informacion interna cargada: ${JSON.stringify(conocimiento)}
Extras (facturados_sin_cobrar = facturados que no figuran cobrados; cobrados_ultimos_30d; envios_fisicos = seguimiento del correo/transporte; pedidos_para_despachar; contactos_7d_por_vendedor = contactos de prospeccion; propuestas_enviadas_cliente; agenda_vencida_o_hoy; piezas_para_mandar = catalogos PDF, propuestas y listas con su link): ${JSON.stringify(extra ?? null)}
Links personales del cliente (catalogo y landings con SU token, son de uso exclusivo de ese cliente): ${JSON.stringify(links)}

Contesta corto y concreto, en espanol rioplatense, con los numeros exactos. Usa vinetas si hay varios items.
${reglaPlata}
Si el dato que piden no esta en los datos de arriba, decilo en una linea y no inventes.
Antes de decir que no sabes, busca bien en los Datos de Orbital Suite: casi todo lo de pedidos, catalogo, agenda y envios esta ahi.
Si piden el link del catalogo o de una propuesta de un cliente, pasa los Links personales tal cual (o link_catalogo). Si piden una propuesta, catalogo PDF o lista sin cliente, usa piezas_para_mandar con su link.
"contactados" = contactos de prospeccion / tanda; "cobrados" = pedidos facturados marcados como cobrados.
Si piden consejos para la agenda de hoy: maximo 8 clientes en orden de prioridad (primero cierres, quienes entraron al catalogo o tienen carrito, despues agenda vencida, despues llamadas de seguimiento), cada uno con el porque en pocas palabras.
"proyectado" = unidades en produccion que todavia no ingresaron. SKU = codigo del articulo (a veces escriben "sky"): si piden SKU o colores de un modelo, lista cada color con su codigo y stock. Codigos de vendedor: Adrian=Adrián, Gaston=Gastón.
Si preguntan cuanto compro un cliente (piezas/unidades): usa ultimos_12_meses_tango (aclara hasta que mes esta cargado Tango: tango_cargado_hasta) y suma los pedidos de la Suite posteriores a ese mes (total_units). Si cuentas_con_mismo_telefono tiene compras, mencionalas: puede ser el mismo cliente con otro codigo. Si busqueda_aproximada es true, deci el nombre que encontraste ("encontre a X").`;
  return await askLLM(system, texto, 900);
}

async function responderConsulta(
  texto: string, sobreCliente: string | null | undefined, chatId: number, messageId: number,
  autorId: number, autorNombre: string, admins: number[],
) {
  const esAdmin = admins.includes(autorId);
  if (PIDE_PLATA.test(texto) && !esAdmin) {
    await crearPropuesta("consulta_plata", { texto, cliente: sobreCliente ?? null },
      `💰 <b>${autorNombre}</b> pregunta un dato de plata: «${texto.slice(0, 300)}»`,
      chatId, messageId, autorNombre, "Consulta de plata");
    await telegramSend(chatId, "Los datos de plata los autoriza Gastón. Ya le pregunté 👀", messageId);
    return;
  }
  const respuesta = await armarRespuestaConsulta(texto, sobreCliente, esAdmin);
  if (respuesta === null) {
    await telegramSend(chatId, "No encontré eso en el sistema. Probá con el nombre del modelo, el código o la razón social del cliente.", messageId);
    return;
  }
  await telegramSend(chatId, respuesta || "No pude armar la respuesta, probá preguntarlo de otra forma.", messageId);
}

async function ejecutarAccion(accion: any): Promise<string | { detalle: string; extra?: unknown }> {
  const p = accion.payload ?? {};

  if (accion.tipo_accion === "consulta_plata") {
    const r = await armarRespuestaConsulta(String(p.texto ?? ""), p.cliente ?? null, true);
    return r || "No encontré ese dato en el sistema.";
  }

  if (accion.tipo_accion === "actualizar_cliente") {
    const { error } = await supabase.from("clientes")
      .update({ [p.campo]: p.valor_nuevo, actualizado_en: new Date().toISOString() }).eq("cod", p.cod);
    if (error) throw error;
    return accion.descripcion_humana;
  }

  if (accion.tipo_accion === "cargar_conocimiento") {
    const { error } = await supabase.from("conocimiento").insert({ tema: p.tema, titulo: p.titulo, texto: p.texto, activo: true });
    if (error) throw error;
    return accion.descripcion_humana;
  }

  if (accion.tipo_accion === "crear_pedido") {
    const { data, error } = await supabase.rpc("ojo_op_pedido_crear", { p: {
      fecha: fechaPedido(), vendedor: p.vendedor, cod_cliente: p.cod_cliente, cliente: p.cliente,
      items: p.items, nro_lista: p.nro_lista ?? 5, obs: p.obs,
    } });
    if (error) throw error;
    if (!(data as any)?.ok) throw new Error((data as any)?.error ?? "no se pudo cargar");
    const pend = ((data as any).items ?? []).filter((i: any) => Number(i.pendiente) > 0).length;
    return `Pedido #${(data as any).id} cargado como <b>pendiente</b> para ${esc(p.cliente)} (${(data as any).total_units} u.)${pend ? `; ${pend} ítem(s) quedan esperando stock` : ""}. Falta completar condiciones en Orbital Suite.`;
  }

  if (accion.tipo_accion === "suite_op") return await ejecutarOperacion(p);

  if (accion.tipo_accion === "tomar_derivacion") return await aplicarTomaDerivacion(p);

  if (accion.tipo_accion === "crear_devolucion") {
    const { data, error } = await supabase.from("devolucion").insert({
      cod_cliente: p.cod_cliente, cliente_razon: p.cliente_razon, items: p.items,
      estado: "borrador", origen: "ojo", obs: p.obs,
    }).select("id").single();
    if (error) throw error;
    return `Devolución #${data?.id} cargada como <b>borrador</b> para ${p.cliente_razon}. Depósito la completa (depósito 03 / 07) en Devoluciones.`;
  }

  if (accion.tipo_accion === "registrar_pago") {
    const { data, error } = await supabase.from("movimientos_financieros").insert({
      cuenta_id: p.cuenta_id, fecha: p.fecha, monto: p.monto, tipo: p.tipo,
      contraparte: p.contraparte, detalle: p.detalle, conciliado: false, origen: "ojo-telegram",
    }).select("id").single();
    if (error) throw error;
    return `Cobranza #${data?.id} registrada en <b>${p.cuenta_nombre}</b>: ${plata(p.monto)} de ${p.contraparte}. Queda <b>sin conciliar</b> en Finanzas.`;
  }

  throw new Error("tipo_accion no soportado");
}

async function crearPropuesta(
  tipo: string, payload: Record<string, unknown>, descripcion: string,
  chatId: number, messageId: number, quien: string, areaLabel: string,
): Promise<string> {
  const { data: fila, error } = await supabase.from("ojo_acciones_propuestas").insert({
    tipo_accion: tipo, payload, descripcion_humana: descripcion,
    origen_chat_id: chatId, origen_message_id: messageId, solicitado_por_nombre: quien,
  }).select().single();
  if (error) { console.error("propuesta", JSON.stringify(error)); return ""; }
  const cod = fila?.id?.slice(0, 8) ?? "";
  await sendToAllAdmins(`⚠️ <b>Para confirmar</b> (${areaLabel}, pedido por ${quien}):\n\n${descripcion}\n\nRespondé <b>SI ${cod}</b> para hacerlo o <b>NO ${cod}</b> para descartar.`);
  return cod;
}

type Clasificacion = {
  tipo: "responsable_plazo" | "cierre_pendiente" | "detalle_pendiente" | "respuesta_cliente" | "consulta" | "accion_sistema" | "pendiente" | "charla";
  accion?: "cliente_dato" | "conocimiento" | "pedido" | "devolucion" | "pago" | "operacion" | null;
  tema?: string | null;
  responsable?: string | null;
  plazo_iso?: string | null;
  cliente?: string | null;
  interes?: string | null;
  resumen?: string | null;
  info_tema?: string | null;
  info_titulo?: string | null;
  info_texto?: string | null;
  monto?: number | string | null;
  medio?: string | null;
  para_el_bot?: boolean | null;
};

async function clasificar(
  texto: string, areaTipo: string, esperandoTema: string | null,
  pendientesAbiertos: string[], contextoPrevio: string[],
): Promise<Clasificacion> {
  const area = AREAS[areaTipo] ?? AREAS.general;
  const t = ahoraArgentina();
  const system = `Sos el clasificador de "Ojo", el asistente interno de Orbital Eyewear (fabrica de anteojos, Argentina).
Estas leyendo el grupo de ${area.label} (${area.contexto}).
Hoy es ${t.dia} ${t.fecha}, son las ${t.hora} en Argentina (UTC-3).
${contextoPrevio.length ? `Mensajes anteriores del grupo (del mas viejo al mas nuevo):\n${contextoPrevio.map((m) => `- ${m}`).join("\n")}\n` : ""}
${esperandoTema ? `Hay un pendiente esperando responsable: "${esperandoTema}".` : ""}
${pendientesAbiertos.length ? `Pendientes ya asignados: ${pendientesAbiertos.map((x) => `"${x}"`).join(", ")}.` : ""}

En los grupos de trabajo el detalle y el pedido vienen en mensajes SEPARADOS: primero pegan una lista de modelos y despues dicen que hacer con eso. Eso es UNA sola cosa.

Tipos:
- "consulta": PREGUNTAN algo que el sistema (Orbital Suite) sabe: stock, colores y disponibilidad de un modelo; datos o busqueda de clientes; pedidos (del dia, de un vendedor, de un cliente, si se cargo, en que estado esta); precargas del catalogo; quien entro al catalogo; carritos; el link del catalogo de un cliente; agenda y recorrido; envios y tanda; cartera de un vendedor; politicas o informacion interna; cobranzas y cobrados; envios fisicos y tracking; contactados; links del catalogo o de propuestas de un cliente; catalogos, propuestas o listas para mandar; consejos para la agenda del dia. Si preguntan por un cliente, completa "cliente" (nombre, codigo o telefono).
- "responsable_plazo": alguien se compromete a resolver algo ("lo veo yo", "el viernes lo tengo").
- "cierre_pendiente": confirma que algo YA se hizo.
- "detalle_pendiente": completa un pendiente que ya esta esperando responsable, o es una lista suelta sin instruccion todavia.
- "respuesta_cliente": cuenta lo que le CONTESTO un cliente u optica al contacto de la tanda.
- "accion_sistema": piden CARGAR o CAMBIAR algo en el sistema. Completa "accion":
    "pedido" = cargar un pedido de un cliente (hay modelos y cantidades). Completa "cliente".
    "devolucion" = cargar una devolucion o canje de un cliente. Completa "cliente".
    "pago" = registrar una cobranza o pago recibido. Completa "cliente" (quien pago), "monto" (solo el numero) y "medio" (efectivo | transferencia | mercado pago | cheque). El "medio" sale de como pagaron, NO de la palabra "pago".
    "cliente_dato" = cambiar un dato de un cliente (telefono, direccion, email, contacto, whatsapp, nota, proximo paso, prioridad, zona, localidad, provincia, horario de entrega).
    "conocimiento" = guardar informacion util de la empresa para que el asistente la sepa (politicas, plazos, garantia, formas de pago, datos de producto).
    "operacion" = cualquier otro cambio en la Suite: cargar un prospecto o cliente nuevo (o mandar sus datos para cargarlo), asignar el numero de cliente a un prospecto, pasar un cliente a otro vendedor, unificar clientes duplicados, cambiar estado / anular / editar un pedido ya cargado, agendar un proximo contacto o recordatorio, mover un dia o marcar una visita del recorrido de campo, habilitar o cortar el acceso al catalogo, liberar o autorizar dispositivos, cargar / confirmar / anular unidades proyectadas, registrar que ya se le mando una propuesta o el catalogo a un cliente.
- "pendiente": hay algo para resolver que necesita manos humanas (subir modelos a una tienda, fabricar, mandar algo).
- "charla": saludos y todo lo demas.

"para_el_bot": true SOLO si le hablan a Ojo / al bot / al sistema (lo nombran, o es una pregunta de datos dirigida al sistema y no a una persona del grupo). false si es una conversacion entre personas del equipo, una pregunta dirigida a un companero ("como se llama el cliente?", "adrian lo cargaste?") o un comentario. Si preguntan un dato de la Suite sin dirigirselo a un companero por su nombre, para_el_bot = true.

REGLAS:
- Preguntar NO es pendiente: "cuanto stock hay de ADELAIDA" es "consulta"; "nos quedamos sin ADELAIDA" es "pendiente".
- Contar que un cliente compro o pago NO es pedir que se cargue: solo es accion_sistema si piden "carga", "anota", "registra".
- Si hay un pendiente esperando responsable y el mensaje promete hacerlo o da fecha, es "responsable_plazo".
- El "tema" tiene que entenderse sin leer el chat: concreto y con los datos de los mensajes anteriores.
- Si accion="conocimiento", completa info_tema (envios, garantia, precios, producto, pagos, general), info_titulo e info_texto.
No expliques nada: contesta el JSON directamente, sin razonar.

{"tipo":"...","accion":null,"tema":null,"responsable":null,"plazo_iso":null,"cliente":null,"interes":"otro","resumen":null,"info_tema":null,"info_titulo":null,"info_texto":null,"monto":null,"medio":null,"para_el_bot":false}`;
  const parsed = parseJsonSafe(await askLLM(system, texto, 2000, true));
  if (!parsed?.tipo) return { tipo: "charla" };
  return parsed as Clasificacion;
}

async function armarPropuestaCliente(texto: string, cliente: Record<string, unknown>) {
  const system = `Tenes este cliente de Orbital Eyewear (JSON): ${JSON.stringify(cliente)}
Campos modificables: ${CAMPOS_EDITABLES_CLIENTE.join(", ")}. Si es agregar informacion al historial (no reemplazar), va como nota nueva concatenada al campo "nota" existente.
Contesta el JSON directamente, sin explicar: {"campo":"<campo permitido>","valor_nuevo":"<valor final>","descripcion":"<una linea en espanol>"}
Si no se puede mapear a un campo permitido: {"campo": null}`;
  const parsed = parseJsonSafe(await askLLM(system, texto, 2000, true));
  if (!parsed?.campo || !CAMPOS_EDITABLES_CLIENTE.includes(parsed.campo)) return null;
  return {
    payload: { cod: cliente.cod, campo: parsed.campo, valor_nuevo: parsed.valor_nuevo },
    descripcion: parsed.descripcion ?? `Actualizar ${parsed.campo} de ${cliente.razon ?? cliente.cod}`,
  };
}

async function accionClienteDato(texto: string, termino: string | null | undefined, chatId: number, messageId: number, quien: string, areaLabel: string) {
  const cliente = await clienteUnico(termino, chatId, messageId);
  if (!cliente) return;
  const p = await armarPropuestaCliente(texto, cliente);
  if (!p) {
    await telegramSend(chatId, "No pude interpretar qué cambio exacto hay que hacer. Probá reformular.", messageId);
    return;
  }
  await crearPropuesta("actualizar_cliente", p.payload, p.descripcion, chatId, messageId, quien, areaLabel);
  await telegramSend(chatId, `Lo puedo hacer: <b>${p.descripcion}</b>. Se lo consulté a Gastón, apenas confirma lo aplico.`, messageId);
}

async function accionConocimiento(c: Clasificacion, texto: string, chatId: number, messageId: number, quien: string) {
  const tema = (c.info_tema ?? "general").toLowerCase().slice(0, 40);
  const titulo = c.info_titulo ?? (c.resumen ?? texto).slice(0, 80);
  const cuerpo = c.info_texto ?? texto;
  const { error } = await supabase.from("conocimiento").insert({ tema, titulo, texto: cuerpo, activo: true });
  if (error) {
    console.error("conocimiento insert", JSON.stringify(error));
    await telegramSend(chatId, "Quise guardarlo en el sistema pero falló. Lo dejo anotado acá.", messageId);
    return;
  }
  await telegramSend(chatId, `📚 Lo incorporé al sistema (tema <b>${tema}</b>): "${titulo}". IRIS ya lo puede usar para contestarles a los clientes.`, messageId);
  await sendToAllAdmins(`📚 ${quien} cargó información nueva (${tema}): ${titulo}`);
}

async function accionPedido(texto: string, contexto: string, c: Clasificacion, chatId: number, messageId: number, quien: string, areaLabel: string, tieneFoto = false) {
  const cliente = await clienteUnico(c.cliente, chatId, messageId);
  if (!cliente) return;
  const arts = await articulosDelPedido(texto, contexto);
  if (arts.length === 0) {
    await telegramSend(chatId, tieneFoto
      ? `Tengo el cliente (<b>${cliente.razon}</b>) pero todavía no leo fotos 📷. Pasame los artículos escritos, uno por línea, como <code>ADELAIDA (000-83) x 2</code>, y lo cargo.`
      : "No identifiqué los artículos. Pasamelos como <code>ADELAIDA (000-83) x 2</code> y lo cargo.", messageId);
    return;
  }
  const items = arts.map((a) => ({
    codigo: a.codigo, modelo: a.modelo, descripcion: a.descripcion,
    cantidad: a.cantidad ?? 1, precio: a.precio ?? 0, sku_shopify: a.codigo,
  }));
  const total = items.reduce((s, i) => s + (i.cantidad ?? 0), 0);
  const sinStock = arts.filter((a) => (a.stock ?? 0) < (a.cantidad ?? 1));
  const lineas = arts.map((a) => `• ${a.modelo} ${a.descripcion} × ${a.cantidad}${(a.stock ?? 0) < (a.cantidad ?? 1) ? ` ⚠️ solo ${a.stock} en stock` : ""}`).join("\n");
  const desc = `Cargar pedido de <b>${cliente.razon}</b> (${total} u.):\n${lineas}`;

  await crearPropuesta("crear_pedido", {
    cod_cliente: cliente.cod, cliente: `${cliente.cod} - ${cliente.razon}`,
    vendedor: cliente.vendedor_asignado ?? (await vendedorPorNombre(quien, false))?.codigo ?? quien, items, total_units: total,
    nro_lista: cliente.nro_lista ?? 5,
    obs: `Cargado por ${quien} desde Telegram: ${texto.slice(0, 400)}`,
  }, desc, chatId, messageId, quien, areaLabel);

  await telegramSend(chatId,
    `📝 Armé el pedido de <b>${cliente.razon}</b> — ${total} u.:\n${lineas}` +
    (sinStock.length ? `\n\n⚠️ Ojo con el stock de ${sinStock.length} ítem(s).` : "") +
    `\n\nSe lo pasé a Gastón; con su OK queda cargado como pendiente para completar condiciones.`, messageId);
}

async function accionDevolucion(texto: string, contexto: string, c: Clasificacion, chatId: number, messageId: number, quien: string, areaLabel: string) {
  const cliente = await clienteUnico(c.cliente, chatId, messageId);
  if (!cliente) return;
  const arts = await articulosDelPedido(texto, contexto);
  if (arts.length === 0) {
    await telegramSend(chatId, "No identifiqué los artículos a devolver. Pasamelos como <code>ADELAIDA (000-83) x 2</code>.", messageId);
    return;
  }
  const items = arts.map((a) => ({ sku: a.codigo, modelo: a.modelo, color: a.descripcion, cant_03: a.cantidad ?? 1, cant_07: 0 }));
  const total = items.reduce((s, i) => s + (i.cant_03 ?? 0), 0);
  const lineas = arts.map((a) => `• ${a.modelo} ${a.descripcion} × ${a.cantidad}`).join("\n");
  const desc = `Cargar devolución de <b>${cliente.razon}</b> (${total} u.):\n${lineas}`;

  await crearPropuesta("crear_devolucion", {
    cod_cliente: cliente.cod, cliente_razon: cliente.razon, items,
    obs: `Cargada por ${quien} desde Telegram: ${texto.slice(0, 400)}`,
  }, desc, chatId, messageId, quien, areaLabel);

  await telegramSend(chatId,
    `↩️ Armé la devolución de <b>${cliente.razon}</b> — ${total} u.:\n${lineas}\n\n` +
    `Se lo pasé a Gastón; con su OK queda como borrador y Depósito reparte entre depósito 03 (apto venta) y 07 (fallados).`, messageId);
}

// La cuenta sale del MEDIO de pago, no de palabras sueltas del mensaje: "pago" no
// puede hacer que una cobranza en efectivo termine en Mercado Pago.
async function accionPago(texto: string, c: Clasificacion, chatId: number, messageId: number, quien: string, areaLabel: string) {
  const monto = Number(String(c.monto ?? "").replace(/[^0-9.]/g, ""));
  if (!monto || monto <= 0) {
    await telegramSend(chatId, "¿Por qué monto fue? Deciímelo en números y lo registro.", messageId);
    return;
  }
  const t = `${texto} ${c.medio ?? ""}`.toLowerCase();
  if (/\bcheque/.test(t)) {
    await telegramSend(chatId, "Los cheques se cargan en Finanzas → Cartera de cheques (hacen falta número, banco y vencimiento). Yo registro efectivo, transferencias y Mercado Pago.", messageId);
    return;
  }

  const { data: cuentas } = await supabase.from("cuentas_financieras").select("id, nombre, tipo").order("id");
  const lista = cuentas ?? [];
  let cuenta: any = null;

  for (const cu of lista) {
    const palabras = String(cu.nombre).toLowerCase().split(/\s+/).filter((w) => w.length >= 5 && !/(banco|cuenta)/.test(w));
    if (palabras.some((w) => t.includes(w))) { cuenta = cu; break; }
  }
  if (!cuenta) {
    if (/\befectivo\b|\bcash\b/.test(t)) cuenta = lista.find((x) => x.tipo === "efectivo");
    else if (/mercado\s*pago|\bmp\b/.test(t)) cuenta = lista.find((x) => x.tipo === "mp");
  }
  if (!cuenta) {
    const opciones = lista.map((x) => `• ${x.nombre}`).join("\n");
    await telegramSend(chatId, `¿En qué cuenta entró?\n${opciones}`, messageId);
    return;
  }

  const clientes = c.cliente ? await buscarClientes(c.cliente) : [];
  const contraparte = clientes.length === 1 ? clientes[0].razon : (c.cliente ?? "sin identificar");
  const tipoMov = cuenta.tipo === "efectivo" ? "cobranza en efectivo"
    : cuenta.tipo === "mp" ? "cobro Mercado Pago" : "transferencia recibida";
  const hoy = ahoraArgentina().fecha;

  const desc = `Registrar cobranza de <b>${contraparte}</b>: ${plata(monto)} en <b>${cuenta.nombre}</b> (${tipoMov}, ${hoy})`;
  await crearPropuesta("registrar_pago", {
    cuenta_id: cuenta.id, cuenta_nombre: cuenta.nombre, fecha: hoy, monto,
    tipo: tipoMov, contraparte, detalle: `${texto.slice(0, 300)} — cargado por ${quien} desde Telegram`,
  }, desc, chatId, messageId, quien, areaLabel);

  await telegramSend(chatId,
    `💰 Anoté: <b>${plata(monto)}</b> de <b>${contraparte}</b> en ${cuenta.nombre}.\n` +
    `Se lo pasé a Gastón; con su OK queda registrado en Finanzas sin conciliar.`, messageId);
}

async function manejarConfirmacion(texto: string, autorId: number, chatId: number): Promise<boolean> {
  const t = texto.trim().toLowerCase();
  const m = t.match(/^(si|sí|confirmar|confirmo|dale|ok|okay|no|cancelar|cancelo|descartar)\s*([0-9a-f-]{4,8})?$/);
  if (!m) return false;
  const esNo = ["no", "cancelar", "cancelo", "descartar"].includes(m[1]);
  const codigo = m[2];

  const { data: abiertas } = await supabase
    .from("ojo_acciones_propuestas").select("*").eq("estado", "propuesta")
    .order("creado_en", { ascending: false }).limit(10);
  if (!abiertas || abiertas.length === 0) return false;

  let pendiente = abiertas[0];
  if (codigo) {
    const match = abiertas.find((a) => a.id.startsWith(codigo));
    if (!match) {
      await telegramSend(autorId, `No encontré ninguna acción pendiente con el código ${codigo}.`);
      return true;
    }
    pendiente = match;
  } else if (abiertas[0].tipo_accion === "suite_op") {
    // Un "ok" suelto no puede anular un pedido: los cambios en la Suite van con su codigo.
    if (chatId !== autorId) return false;
    await telegramSend(autorId, `Para cambios en la Suite contestá con el código: <b>SI ${abiertas[0].id.slice(0, 8)}</b> o <b>NO ${abiertas[0].id.slice(0, 8)}</b>.\n\n${abiertas[0].descripcion_humana}`);
    return true;
  } else if (abiertas.length > 1) {
    const lista = abiertas.map((a) => `• <b>${a.id.slice(0, 8)}</b> — ${a.descripcion_humana} (${a.solicitado_por_nombre ?? "?"})`).join("\n");
    await telegramSend(autorId, `Hay ${abiertas.length} cosas esperando confirmación. Contestá con el código, ej <b>SI ${abiertas[0].id.slice(0, 8)}</b>:\n${lista}`);
    return true;
  }

  if (esNo) {
    await supabase.from("ojo_acciones_propuestas").update({ estado: "rechazada", resuelto_en: new Date().toISOString() }).eq("id", pendiente.id);
    await telegramSend(autorId, "Descartado, no toqué nada.");
    if (pendiente.origen_chat_id !== autorId) await telegramSend(pendiente.origen_chat_id,
      pendiente.tipo_accion === "consulta_plata" ? "Gastón no autorizó compartir ese dato 🙅" : "Gastón descartó esa carga, no se hizo.");
    return true;
  }

  try {
    const salida = await ejecutarAccion(pendiente);
    const detalle = typeof salida === "string" ? salida : salida.detalle;
    const extra = typeof salida === "string" ? null : (salida.extra ?? null);
    await supabase.from("ojo_acciones_propuestas").update({ estado: "ejecutada", resuelto_en: new Date().toISOString(), resultado: { ok: true, detalle, extra } }).eq("id", pendiente.id);
    await telegramSend(autorId, `Listo ✅ ${detalle}`);
    if (pendiente.origen_chat_id !== autorId) await telegramSend(pendiente.origen_chat_id, `Confirmado por Gastón ✅ ${detalle}`);
  } catch (e) {
    await supabase.from("ojo_acciones_propuestas").update({ estado: "error", resuelto_en: new Date().toISOString(), resultado: { error: String(e) } }).eq("id", pendiente.id);
    await telegramSend(autorId, `Hubo un error al ejecutarlo, no se aplicó: ${String(e).slice(0, 200)}`);
  }
  return true;
}

async function registrarRespuestaCliente(c: Clasificacion, texto: string, chatId: number, messageId: number, autorNombre: string) {
  const cliente = await clienteUnico(c.cliente, chatId, messageId);
  if (!cliente) return;

  const { data: tanda } = await supabase
    .from("tanda_diaria").select("id, vendedor, posta, fecha")
    .eq("cod_cliente", cliente.cod).in("estado", ["enviado", "vencido"])
    .gte("fecha", new Date(Date.now() - 21 * 86400000).toISOString().slice(0, 10))
    .order("fecha", { ascending: false }).limit(1).maybeSingle();

  await supabase.from("ojo_respuestas_tanda").insert({
    tanda_id: tanda?.id ?? null, cod_cliente: cliente.cod, razon: cliente.razon,
    vendedor: tanda?.vendedor ?? null, posta: tanda?.posta ?? null,
    interes: c.interes ?? "otro", texto: c.resumen ?? texto,
    reportado_por: autorNombre, telegram_chat_id: chatId, telegram_message_id: messageId,
  });

  const etiqueta: Record<string, string> = {
    interesado: "interesado 🟢", pidio_precios: "pidió precios 💰", pidio_catalogo: "pidió catálogo 📖",
    va_a_comprar: "va a comprar 🟢", no_interesado: "no interesado 🔴", sin_respuesta: "sin respuesta ⚪", otro: "anotado",
  };
  const ctx = tanda ? ` (venía de ${tanda.posta}, ${tanda.fecha})` : "";
  await telegramSend(chatId, `📝 Anotado: <b>${cliente.razon}</b> — ${etiqueta[c.interes ?? "otro"] ?? "anotado"}${ctx}.`, messageId);
}

// Le contesta al cliente por el canal real (WhatsApp / IG / Messenger) reusando
// at-responder, que ya sabe manejar la ventana de 24 h de Meta y deja el mensaje
// registrado en at_mensajes para que IRIS tenga el historial completo.
// Solo se llega aca respondiendo un mensaje de hilo: un mensaje suelto del grupo
// NUNCA sale para afuera.
async function responderAlCliente(
  conversacionId: string, texto: string, chatId: number, messageId: number, autorNombre: string,
) {
  let r: { ok?: boolean; enviado?: boolean; canal?: string; detalle?: string; registrado?: boolean } = {};
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/at-responder`, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
      body: JSON.stringify({ conversacion_id: conversacionId, texto, agente: autorNombre }),
    });
    if (!res.ok) {
      await telegramSend(chatId, `❌ at-responder rechazó el envío (HTTP ${res.status}). Avisale a Gastón.`, messageId);
      return;
    }
    r = await res.json();
  } catch (e) {
    await telegramSend(chatId, `❌ No pude mandarlo: ${(e as Error).message}`, messageId);
    return;
  }

  // El propio mensaje del vendedor pasa a ser parte del hilo: asi se puede seguir
  // la conversacion respondiendo el ultimo mensaje, no siempre el original.
  await supabase.from("ojo_hilos").upsert(
    { telegram_chat_id: chatId, telegram_message_id: messageId, conversacion_id: conversacionId },
    { onConflict: "telegram_chat_id,telegram_message_id" },
  );

  if (r.enviado) {
    await supabase.from("derivaciones").update({ estado: "resuelta" })
      .eq("conversacion_id", conversacionId).eq("estado", "pendiente");
    const nota = r.detalle ? ` — ${r.detalle}` : "";
    await telegramSend(chatId, `✅ Enviado por ${r.canal ?? "el canal"}${nota}`, messageId);
  } else {
    const motivo = (r.detalle || "no me dijo por que").slice(0, 400);
    await telegramSend(chatId,
      `❌ <b>No le llegó al cliente</b> (${r.canal ?? "canal desconocido"}).\n${motivo}\n\n` +
      (r.registrado ? "Quedó registrado en la conversación." : "Tampoco quedó registrado.") +
      " Probá desde Orbital Suite → Conversaciones.", messageId);
  }
}

// ===================== Operaciones sobre la Suite (v28) =====================
// Ojo interpreta el pedido, lo valida contra la base y arma una propuesta "suite_op": no se
// escribe nada hasta el SI de Gaston. Excepciones: cargar un prospecto (la Suite tambien deja
// que el vendedor lo cargue solo) y el numero de cliente cuando lo pasa un admin.

const ESTADOS_PEDIDO = ["pendiente", "en_preparacion", "observado", "listo", "facturado", "listo_despachar", "despachado"];
const TRANSICIONES = ["pendiente>en_preparacion", "en_preparacion>listo", "en_preparacion>observado", "observado>en_preparacion",
  "listo>facturado", "facturado>listo_despachar", "listo_despachar>despachado"];
const TRANSPORTES = ["Moto", "Expreso / Transporte", "Comisionista", "Retira el cliente", "Correo", "Otro"];
const RESULTADOS_CAMPO = ["vendio", "visito", "no_estaba", "reagendar"];
const ESTADO_LINDO: Record<string, string> = {
  pendiente: "pendiente", en_preparacion: "en preparación", observado: "observado", listo: "listo",
  facturado: "facturado", listo_despachar: "listo para despachar", despachado: "despachado",
};

const OPS_DOC = `Operaciones (elegi UNA en "op"):
- "prospecto_alta": cargar un prospecto o cliente nuevo, o mandar sus datos para cargarlo. datos: razon (nombre del comercio), telefono, localidad, provincia, contacto, email, cuit, vendedor (solo si lo nombran).
- "cliente_codigo": ponerle el numero de cliente definitivo a un prospecto (codigo TMP-...). datos: cliente, cod_nuevo, nro_lista.
- "cliente_reasignar": pasar un cliente a otro vendedor. datos: cliente, vendedor, motivo.
- "pedido_estado": cambiar el estado de un pedido. datos: pedido_id, estado (pendiente | en_preparacion | observado | listo | facturado | listo_despachar | despachado), motivo (si es observado), nro_factura, importe_neto, nro_remito, tipo_transporte (Moto | Expreso / Transporte | Comisionista | Retira el cliente | Correo | Otro), nro_guia.
- "pedido_anular": anular un pedido cargado por error. datos: pedido_id.
- "pedido_editar": cambiar articulos o cantidades de un pedido. datos: pedido_id, cambios: lista de {"articulo": codigo NNN-XX o modelo, "cantidad": nueva cantidad total, 0 = sacarlo}.
- "agenda": agendar un proximo contacto, visita o recordatorio de un cliente. datos: cliente, fecha_iso (YYYY-MM-DD), paso (que hay que hacer), vendedor (de quien es la agenda, solo si lo dicen).
- "campo_mover": mover un dia del recorrido de campo. datos: vendedor, dia (numero), hasta (numero de dia destino; null = al final).
- "campo_visita": marcar la visita a un cliente del recorrido. datos: vendedor, cliente, resultado (vendio | visito | no_estaba | reagendar), nota.
- "catalogo_acceso": habilitar o cortar el acceso al catalogo de un cliente. datos: cliente, activo (true = habilitar, false = cortar).
- "catalogo_dispositivos": dispositivos del catalogo de un cliente. datos: cliente, accion (liberar = borrar para que entre de cero | autorizar = aprobar los pendientes).
- "proyectado_cargar" / "proyectado_confirmar" / "proyectado_anular": unidades en produccion (cargar nuevas, confirmar que ingresaron, anular). datos: cantidad, nota. El articulo va en el mensaje con su (NNN-XX).
- "registrar_envio": registrar que YA se le mando a un cliente una propuesta o el catalogo por fuera del sistema. datos: cliente, propuesta (Plan Canje | Clientes Perdidos | Paquete de Bienvenida | Preventa Coleccion 2026 | Propuesta Especial | catalogo), canal (whatsapp | mail | llamada), vendedor (quien lo mando).
- "cliente_unificar": juntar dos fichas del mismo cliente duplicado (pedidos, historial y catalogo pasan a una y la otra se borra). datos: cliente_1, cliente_2 (codigo o nombre de cada uno), queda ("1" | "2" | null si no dicen cual queda).
- "ninguna": no es ninguna de estas.`;

type Preparada = { payload: Record<string, unknown>; descripcion: string };

function num(v: unknown): number | null {
  const t = String(v ?? "").trim();
  if (!t) return null;
  const n = Number(t.replace(/[^\d.]/g, ""));
  return Number.isFinite(n) && /\d/.test(t) ? n : null;
}

async function vendedorDelAutor(quien: string, autorUser: string | null, soloComerciales = true): Promise<any | null> {
  return (autorUser ? await vendedorPorNombre(autorUser, soloComerciales) : null) ?? await vendedorPorNombre(quien, soloComerciales);
}

function esSufijo(q: string): string | null {
  const suf = q.replace(/[^0-9A-Za-z]/g, "").toUpperCase().slice(-5);
  return /^\d{3}[0-9A-Z]{2}$/.test(suf) ? suf : null;
}

async function accionOperacion(
  texto: string, contexto: string, chatId: number, messageId: number, quien: string,
  autorUser: string | null, areaLabel: string, chatType: string, autorId: number, admins: number[],
) {
  const t = ahoraArgentina();
  const system = `Sos el interprete de operaciones de "Ojo", el asistente interno de Orbital Eyewear (fabrica de anteojos). Hoy es ${t.dia} ${t.fecha} (Argentina).
${contexto ? `Mensajes anteriores del chat (pueden traer datos que faltan):\n${contexto}\n` : ""}
${OPS_DOC}
No inventes datos: lo que no esta en el mensaje ni en los anteriores va en null.
Contesta el JSON directamente, sin explicar: {"op":"...","datos":{...}}`;
  const parsed = parseJsonSafe(await askLLM(system, texto, 2000, true));
  const op = String(parsed?.op ?? "ninguna");
  const d = (parsed?.datos ?? {}) as Record<string, any>;

  if (op === "prospecto_alta") {
    await altaProspecto(d, chatId, messageId, quien, autorUser, chatType);
    return;
  }

  let prep: Preparada | string;
  try {
    prep = await prepararOperacion(op, d, texto, quien, autorUser);
  } catch (e) {
    console.error("prepararOperacion", op, String(e));
    prep = `No pude armar ese cambio: ${esc(String((e as Error)?.message ?? e).slice(0, 200))}`;
  }
  if (typeof prep === "string") {
    await telegramSend(chatId, prep, messageId);
    return;
  }
  if (op === "cliente_codigo" && (admins.includes(autorId) || await tieneRol(autorId, "administracion"))) {
    try {
      const r = await ejecutarOperacion(prep.payload);
      await telegramSend(chatId, `✅ ${r.detalle}`, messageId);
    } catch (e) {
      await telegramSend(chatId, `❌ No se pudo: ${esc(String((e as Error)?.message ?? e).slice(0, 200))}`, messageId);
    }
    return;
  }
  const cod = await crearPropuesta("suite_op", prep.payload, prep.descripcion, chatId, messageId, quien, areaLabel);
  if (!cod) {
    await telegramSend(chatId, "No pude dejarlo para confirmar. Probá de nuevo.", messageId);
    return;
  }
  await telegramSend(chatId, `📝 ${prep.descripcion}\n\nSe lo pasé a Gastón; con su OK lo aplico en la Suite.`, messageId);
}

async function prepararOperacion(
  op: string, d: Record<string, any>, texto: string, quien: string, autorUser: string | null,
): Promise<Preparada | string> {
  switch (op) {
    case "cliente_codigo": {
      const r = await resolverCliente(d.cliente);
      if (!r.cliente) return r.error!;
      const c = r.cliente;
      if (!String(c.cod).startsWith("TMP-")) return `${esc(nombreCliente(c))} ya tiene número de cliente (${c.cod}).`;
      const nuevo = String(d.cod_nuevo ?? "").trim().toUpperCase();
      if (!nuevo) return `¿Qué número de cliente le pongo a ${esc(nombreCliente(c))}?`;
      const { data: ya } = await supabase.from("clientes").select("razon").eq("cod", nuevo).maybeSingle();
      if (ya) return `El número ${esc(nuevo)} ya es de ${esc(ya.razon)}.`;
      const lista = num(d.nro_lista);
      return {
        payload: { op, cod_actual: c.cod, cod_nuevo: nuevo, nro_lista: lista },
        descripcion: `Asignar el número de cliente <b>${esc(nuevo)}</b> a <b>${esc(nombreCliente(c))}</b> (hoy ${c.cod})${lista ? `, lista ${lista}` : ""}`,
      };
    }

    case "cliente_unificar": {
      if (!d.cliente_1 || !d.cliente_2) {
        return "¿Cuáles son los clientes duplicados? Pasame los dos (código o nombre de cada uno) y cuál queda, así los busco y lo hacemos.";
      }
      const r1 = await resolverCliente(d.cliente_1);
      if (!r1.cliente) return r1.error!;
      const r2 = await resolverCliente(d.cliente_2);
      if (!r2.cliente) return r2.error!;
      if (r1.cliente.cod === r2.cliente.cod) return "Es el mismo cliente: pasame los dos códigos distintos.";
      const [{ data: s1 }, { data: s2 }] = await Promise.all([
        supabase.rpc("ojo_resumen_duplicado", { p_cod: r1.cliente.cod }),
        supabase.rpc("ojo_resumen_duplicado", { p_cod: r2.cliente.cod }),
      ]);
      // Si no dijeron cual queda: el que tiene numero definitivo y mas historia.
      const peso = (c: any, r: any) => (String(c.cod).startsWith("TMP-") ? 0 : 1e9) + Number(r?.pedidos ?? 0) * 1e5 + Number(r?.unidades_historicas ?? 0);
      const dijo = String(d.queda ?? "").trim();
      const quedaEl1 = dijo === "1" ? true : dijo === "2" ? false : peso(r1.cliente, s1) >= peso(r2.cliente, s2);
      const [keep, sk, drop, sd] = quedaEl1 ? [r1.cliente, s1, r2.cliente, s2] : [r2.cliente, s2, r1.cliente, s1];
      const linea = (c: any, r: any) =>
        `${esc(nombreCliente(c))} (${c.cod}) — ${r?.pedidos ?? 0} pedido(s), ${r?.unidades_historicas ?? 0} u. históricas${r?.vendedor ? `, de ${esc(r.vendedor)}` : ""}${r?.link_catalogo ? ", con link de catálogo" : ""}`;
      return {
        payload: { op, keep: keep.cod, drop: drop.cod },
        descripcion: `Unificar clientes duplicados:\n• Queda: <b>${linea(keep, sk)}</b>\n• Se borra: ${linea(drop, sd)}\nPedidos, historial, catálogo y contactos pasan al que queda y los datos que le falten se completan con los del otro.${dijo === "1" || dijo === "2" ? "" : " (Elegí cuál queda por número definitivo e historia.)"}`,
      };
    }

    case "cliente_reasignar": {
      const r = await resolverCliente(d.cliente);
      if (!r.cliente) return r.error!;
      const c = r.cliente;
      const destino = await vendedorPorNombre(d.vendedor, true);
      if (!destino) {
        const { data: vs } = await supabase.from("vendedores").select("codigo").eq("activo", true).in("rol", ["vendedor", "revendedor"]);
        return `¿A qué vendedor? Opciones: ${[...(vs ?? []).map((v) => v.codigo), "Mauro"].join(", ")}.`;
      }
      if (c.vendedor_asignado === destino.codigo) return `${esc(nombreCliente(c))} ya es de ${destino.codigo}.`;
      return {
        payload: { op, cod: c.cod, desde: c.vendedor_asignado ?? null, hasta: destino.codigo, motivo: d.motivo ?? null },
        descripcion: `Pasar a <b>${esc(nombreCliente(c))}</b> (${c.cod}) de ${esc(c.vendedor_asignado ?? "sin asignar")} a <b>${destino.codigo}</b>${d.motivo ? `. Motivo: ${esc(d.motivo)}` : ""}`,
      };
    }

    case "pedido_estado": {
      const id = num(d.pedido_id);
      if (!id) return "¿Qué número de pedido?";
      const { data: ped } = await supabase.from("pedidos").select("id, cliente, estado, total_units, cod_cliente").eq("id", id).maybeSingle();
      if (!ped) return `No existe el pedido #${id}.`;
      const estado = sinTilde(String(d.estado ?? "")).replace(/\s+/g, "_").replace(/^listo_para_despachar$/, "listo_despachar");
      if (!ESTADOS_PEDIDO.includes(estado)) return `¿A qué estado? ${ESTADOS_PEDIDO.map((e) => ESTADO_LINDO[e]).join(", ")}.`;
      const actual = ped.estado ?? "pendiente";
      if (estado === actual) return `El pedido #${id} ya está ${ESTADO_LINDO[estado]}.`;
      if (estado !== "pendiente" && !TRANSICIONES.includes(`${actual}>${estado}`)) {
        return `El pedido #${id} está ${ESTADO_LINDO[actual] ?? actual}: de ahí no puede pasar a ${ESTADO_LINDO[estado]}.`;
      }
      const extra: Record<string, unknown> = {};
      if (estado === "observado") {
        if (!d.motivo) return "¿Cuál es el motivo de la observación?";
        extra.obs_deposito = String(d.motivo);
      }
      if (estado === "facturado") {
        if (!d.nro_factura) return `¿Número de factura del pedido #${id}?`;
        if (String(ped.cod_cliente ?? "").startsWith("TMP-")) return "El cliente tiene código provisorio: primero hay que ponerle el número de cliente.";
        extra.nro_factura = String(d.nro_factura);
        if (num(d.importe_neto) !== null) extra.importe_neto = num(d.importe_neto);
        if (d.nro_remito) extra.nro_remito = String(d.nro_remito);
      }
      if (estado === "despachado") {
        const pedido = sinTilde(String(d.tipo_transporte ?? "")).split(/\s+/)[0];
        const tr = pedido ? TRANSPORTES.find((x) => sinTilde(x).startsWith(pedido)) : undefined;
        if (!tr) return `¿Con qué transporte? ${TRANSPORTES.join(", ")}.`;
        extra.tipo_transporte = tr;
        if (d.nro_guia) extra.nro_guia = String(d.nro_guia);
      }
      // El importe no va en la descripcion: esa linea tambien vuelve al grupo.
      const detalle = Object.entries(extra).filter(([k]) => k !== "importe_neto")
        .map(([k, v]) => `${k.replace(/_/g, " ")}: ${esc(v)}`).join(", ");
      return {
        payload: { op, pedido_id: id, estado, extra },
        descripcion: `Pasar el pedido <b>#${id}</b> de ${esc(ped.cliente)} (${ped.total_units} u.) de ${ESTADO_LINDO[actual] ?? actual} a <b>${ESTADO_LINDO[estado]}</b>${detalle ? ` (${detalle})` : ""}`,
      };
    }

    case "pedido_anular": {
      const id = num(d.pedido_id);
      if (!id) return "¿Qué número de pedido?";
      const { data: ped } = await supabase.from("pedidos").select("id, cliente, estado, total_units").eq("id", id).maybeSingle();
      if (!ped) return `No existe el pedido #${id}.`;
      const est = ped.estado ?? "pendiente";
      if (!["pendiente", "en_preparacion", "observado"].includes(est)) {
        return `El pedido #${id} está ${ESTADO_LINDO[est] ?? est}: solo se anula en pendiente, en preparación u observado.`;
      }
      return {
        payload: { op, pedido_id: id },
        descripcion: `⚠️ <b>Anular</b> el pedido <b>#${id}</b> de ${esc(ped.cliente)} (${ped.total_units} u., ${ESTADO_LINDO[est]}). Se borra y el stock vuelve.`,
      };
    }

    case "pedido_editar": {
      const id = num(d.pedido_id);
      if (!id) return "¿Qué número de pedido?";
      const { data: ped } = await supabase.from("pedidos").select("id, cliente, estado, items").eq("id", id).maybeSingle();
      if (!ped) return `No existe el pedido #${id}.`;
      const est = ped.estado ?? "pendiente";
      if (!["pendiente", "en_preparacion", "observado"].includes(est)) return `El pedido #${id} está ${ESTADO_LINDO[est] ?? est}: ya no se puede editar.`;

      const originales = (ped.items ?? []) as any[];
      const items = originales.map(({ pendiente: _p, ...i }) => ({ ...i }));
      const arts = (await detectarArticulos(texto)).filter((a) => a.codigo);
      const cambios = (Array.isArray(d.cambios) ? d.cambios : []) as any[];

      const buscar = (q: string): any[] => {
        const suf = esSufijo(q);
        if (suf) return items.filter((i) => String(i.codigo).toUpperCase().endsWith(suf));
        return items.filter((i) => sinTilde(String(i.modelo ?? "")) === sinTilde(q));
      };
      const usados = new Set<string>();
      for (const cb of cambios) {
        const q = String(cb?.articulo ?? "");
        const cant = num(cb?.cantidad);
        if (!q || cant === null) continue;
        const hits = buscar(q);
        if (hits.length > 1) return `En el pedido #${id} hay varios ${esc(q)}: decime el código (NNN-XX).`;
        if (hits.length === 1) {
          hits[0].cantidad = cant;
          usados.add(hits[0].codigo);
          continue;
        }
        const suf = esSufijo(q);
        const art = arts.find((a) => suf && String(a.codigo).toUpperCase().endsWith(suf));
        if (!art) return `No encontré ${esc(q)} en el pedido. Para agregarlo pasalo como <code>MODELO (NNN-XX) x N</code>.`;
        if (cant > 0) items.push({ codigo: art.codigo, modelo: art.modelo, descripcion: art.descripcion, cantidad: cant, precio: art.precio ?? 0, sku_shopify: art.codigo });
        usados.add(String(art.codigo));
      }
      // Articulos escritos con (NNN-XX) x N que el interprete no listo: se agregan o se actualizan.
      for (const a of arts) {
        if (usados.has(String(a.codigo))) continue;
        const ex = items.find((i) => i.codigo === a.codigo);
        if (ex) ex.cantidad = a.cantidad ?? ex.cantidad;
        else items.push({ codigo: a.codigo, modelo: a.modelo, descripcion: a.descripcion, cantidad: a.cantidad ?? 1, precio: a.precio ?? 0, sku_shopify: a.codigo });
      }

      const final = items.filter((i) => Number(i.cantidad) > 0);
      if (final.length === 0) return "El pedido quedaría vacío: para eso pedí anularlo.";
      const antes = new Map(originales.map((i) => [String(i.codigo), Number(i.cantidad)]));
      const lineas = [
        ...final.filter((i) => antes.get(String(i.codigo)) !== Number(i.cantidad))
          .map((i) => `• ${esc(i.modelo)} ${esc(i.descripcion ?? "")}: ${antes.get(String(i.codigo)) ?? 0} → ${i.cantidad}`),
        ...originales.filter((i) => !final.some((f) => f.codigo === i.codigo))
          .map((i) => `• ${esc(i.modelo)} ${esc(i.descripcion ?? "")}: sale (${i.cantidad})`),
      ];
      if (lineas.length === 0) return "¿Qué cambio en el pedido? Pasame los artículos como <code>ASCARI (038-04) x 3</code> o decime cuál sacar.";
      const total = final.reduce((s, i) => s + Number(i.cantidad), 0);
      return {
        payload: { op, pedido_id: id, items: final },
        descripcion: `Editar el pedido <b>#${id}</b> de ${esc(ped.cliente)} (queda en ${total} u. y vuelve a pendiente):\n${lineas.join("\n")}`,
      };
    }

    case "agenda": {
      const r = await resolverCliente(d.cliente);
      if (!r.cliente) return r.error!;
      const c = r.cliente;
      const paso = String(d.paso ?? "").trim();
      if (!paso) return `¿Qué hay que hacer con ${esc(nombreCliente(c))}?`;
      const plazo = resolverPlazo(texto, d.fecha_iso ? `${String(d.fecha_iso).slice(0, 10)}T15:00:00Z` : null);
      if (!plazo) return "¿Para qué fecha lo agendo?";
      const fecha = new Date(new Date(plazo).getTime() - 3 * 3600 * 1000).toISOString().slice(0, 10);
      const duenio = (await vendedorPorNombre(d.vendedor, false))?.codigo ?? c.agenda_owner ?? c.vendedor_asignado ??
        (await vendedorDelAutor(quien, autorUser, false))?.codigo;
      if (!duenio) return "¿En la agenda de qué vendedor lo pongo?";
      return {
        payload: { op, cod: c.cod, fecha, paso, duenio },
        descripcion: `Agendar a <b>${esc(nombreCliente(c))}</b> (${c.cod}) para el <b>${fecha.slice(8, 10)}/${fecha.slice(5, 7)}</b> en la agenda de ${esc(duenio)}: ${esc(paso)}`,
      };
    }

    case "campo_mover": {
      const v = (await vendedorPorNombre(d.vendedor, true)) ?? (await vendedorDelAutor(quien, autorUser, true));
      if (!v) return "¿El recorrido de qué vendedor?";
      const { data: dias } = await supabase.from("agenda_campo").select("dia_num").eq("vendedor", v.codigo).eq("bloque", "ba_gba");
      const max = (dias ?? []).reduce((m, x) => Math.max(m, Number(x.dia_num)), 0);
      if (!max) return `${v.codigo} no tiene recorrido de campo cargado.`;
      const dia = num(d.dia);
      if (!dia || dia < 1 || dia > max) return `¿Qué día del recorrido? ${v.codigo} tiene del 1 al ${max}.`;
      const hasta = num(d.hasta);
      if (hasta !== null && (hasta < 1 || hasta > max)) return `El recorrido de ${v.codigo} va del día 1 al ${max}.`;
      if (hasta === dia || (hasta === null && dia === max)) return "Ese día ya está en ese lugar.";
      return {
        payload: { op, vendedor: v.codigo, dia, hasta },
        descripcion: `Mover el <b>día ${dia}</b> del recorrido de ${v.codigo} ${hasta ? `al <b>día ${hasta}</b>` : "<b>al final</b>"} (se corren los demás)`,
      };
    }

    case "campo_visita": {
      const r = await resolverCliente(d.cliente);
      if (!r.cliente) return r.error!;
      const c = r.cliente;
      const res = sinTilde(String(d.resultado ?? "")).replace(/\s+/g, "_");
      if (!RESULTADOS_CAMPO.includes(res)) return "¿Cómo le fue? vendió, visitó, no estaba o reagendar.";
      const v = (await vendedorPorNombre(d.vendedor, true)) ?? (await vendedorDelAutor(quien, autorUser, true));
      const base = supabase.from("agenda_campo").select("vendedor, dia_num").eq("cod_cliente", c.cod);
      const { data: filas } = v ? await base.eq("vendedor", v.codigo) : await base;
      if (!filas?.length) return `${esc(nombreCliente(c))} no está en el recorrido de campo${v ? ` de ${v.codigo}` : ""}.`;
      if (filas.length > 1 && !v) return `${esc(nombreCliente(c))} está en el recorrido de varios: ¿de qué vendedor?`;
      const f = filas[0];
      return {
        payload: { op, vendedor: f.vendedor, cod: c.cod, resultado: res, nota: d.nota ?? null },
        descripcion: `Marcar la visita a <b>${esc(nombreCliente(c))}</b> en el recorrido de ${f.vendedor} (día ${f.dia_num}): <b>${res.replace("_", " ")}</b>${d.nota ? ` — ${esc(d.nota)}` : ""}`,
      };
    }

    case "catalogo_acceso": {
      const r = await resolverCliente(d.cliente);
      if (!r.cliente) return r.error!;
      const c = r.cliente;
      const activo = d.activo === true || /^(true|si|sí|habilit|activ|abr)/i.test(String(d.activo ?? ""));
      const { data: acc } = await supabase.from("catalogo_acceso").select("codigo, activo").eq("cod_cliente", c.cod).eq("tipo", "optica");
      const hay = (acc ?? []).some((a) => a.activo);
      if (activo && hay) return `${esc(nombreCliente(c))} ya tiene el catálogo habilitado.`;
      if (!activo && !hay) return `${esc(nombreCliente(c))} no tiene un acceso activo al catálogo.`;
      return {
        payload: { op, cod: c.cod, activo },
        descripcion: activo
          ? `Habilitar el catálogo de <b>${esc(nombreCliente(c))}</b> (${c.cod})${(acc ?? []).length ? ", reactivando su link" : ", generando su link"}`
          : `⚠️ <b>Cortar</b> el acceso al catálogo de <b>${esc(nombreCliente(c))}</b> (${c.cod}): su link deja de funcionar`,
      };
    }

    case "catalogo_dispositivos": {
      const r = await resolverCliente(d.cliente);
      if (!r.cliente) return r.error!;
      const c = r.cliente;
      const pide = String(d.accion ?? "");
      const accion = /autoriz|habilit|permit|aprob/i.test(pide) ? "autorizar" : /liber|reset|borr|limpi/i.test(pide) ? "liberar" : null;
      if (!accion) return "¿Libero los dispositivos (entra de cero) o autorizo los que están pendientes?";
      const { data: disp } = await supabase.from("catalogo_dispositivos").select("estado").eq("cod_cliente", c.cod);
      const total = (disp ?? []).length;
      const pend = (disp ?? []).filter((x) => x.estado === "pendiente").length;
      if (accion === "autorizar" && !pend) return `${esc(nombreCliente(c))} no tiene dispositivos pendientes.`;
      if (accion === "liberar" && !total) return `${esc(nombreCliente(c))} no tiene dispositivos registrados.`;
      return {
        payload: { op, cod: c.cod, accion },
        descripcion: accion === "autorizar"
          ? `Autorizar ${pend} dispositivo(s) pendiente(s) del catálogo de <b>${esc(nombreCliente(c))}</b>`
          : `Liberar los ${total} dispositivo(s) del catálogo de <b>${esc(nombreCliente(c))}</b> (vuelve a entrar desde cero)`,
      };
    }

    case "proyectado_cargar":
    case "proyectado_confirmar":
    case "proyectado_anular": {
      const arts = (await detectarArticulos(texto)).filter((a) => a.codigo);
      if (arts.length !== 1) return "Pasame UN artículo con su código, como <code>ASCARI (038-04) x 20</code>.";
      const a = arts[0];
      const cant = num(d.cantidad) ?? (/x\s*\d/i.test(texto) ? (a.cantidad ?? null) : null);
      const nombreArt = `${esc(a.modelo)} ${esc(a.descripcion)}`;
      if (op === "proyectado_cargar") {
        if (!cant || cant <= 0) return `¿Cuántas unidades de ${nombreArt} entran en producción?`;
        return {
          payload: { op, codigo: a.codigo, modelo: a.modelo, descripcion: a.descripcion, precio: a.precio ?? null, cantidad: cant, nota: d.nota ?? null },
          descripcion: `Cargar <b>${cant} u. proyectadas</b> de ${nombreArt} (<code>${a.codigo}</code>)${d.nota ? ` — ${esc(d.nota)}` : ""}`,
        };
      }
      const { data: filas } = await supabase.from("stock_ingresos").select("id, cantidad").eq("codigo", a.codigo).eq("estado", "proyectado").order("created_at");
      if (!filas?.length) return `${nombreArt} no tiene unidades proyectadas.`;
      const f = filas[0];
      if (op === "proyectado_confirmar") {
        const ingresan = Math.min(cant ?? f.cantidad, f.cantidad);
        return {
          payload: { op, id: f.id, cantidad: ingresan },
          descripcion: `Confirmar el ingreso de <b>${ingresan} u.</b> de ${nombreArt} (de ${f.cantidad} proyectadas): pasan al stock real`,
        };
      }
      return {
        payload: { op, id: f.id },
        descripcion: `Anular ${f.cantidad} u. proyectadas de ${nombreArt} (<code>${a.codigo}</code>)${filas.length > 1 ? ` (la tanda más vieja de ${filas.length})` : ""}`,
      };
    }

    case "registrar_envio": {
      const r = await resolverCliente(d.cliente);
      if (!r.cliente) return r.error!;
      const c = r.cliente;
      const canal = /llam/i.test(String(d.canal ?? "")) ? "llamada" : /mail|correo/i.test(String(d.canal ?? "")) ? "mailto" : "wa_me";
      const pq = sinTilde(String(d.propuesta ?? ""));
      if (!pq) return `¿Qué le mandaron a ${esc(nombreCliente(c))}? Plan Canje, Clientes Perdidos, Paquete de Bienvenida, Preventa, Propuesta Especial o el catálogo.`;
      let propuesta: any = null;
      if (!/catalog/.test(pq)) {
        const { data: props } = await supabase.from("propuestas_julio").select("id, nombre").eq("activa", true);
        const puntaje = (n: string) => sinTilde(n).split(/\s+/).filter((w) => w.length >= 4 && pq.includes(w)).length;
        propuesta = (props ?? []).map((p) => ({ ...p, s: puntaje(p.nombre) })).sort((x, y) => y.s - x.s)[0];
        if (!propuesta?.s) return `No encontré la propuesta "${esc(d.propuesta)}". Activas: ${(props ?? []).map((p) => p.nombre).join(", ")}.`;
      }
      const v = (await vendedorPorNombre(d.vendedor, false)) ?? (await vendedorDelAutor(quien, autorUser, false)) ??
        (await vendedorPorNombre(c.vendedor_asignado, false));
      if (!v) return "¿Quién se lo mandó?";
      const que = propuesta ? propuesta.nombre : "el catálogo con su token";
      const via = canal === "llamada" ? "llamada" : canal === "mailto" ? "mail" : "WhatsApp";
      return {
        payload: {
          op, cod: c.cod, vendedor: v.codigo, telefono_remitente: v.telefono_remitente ?? null,
          propuesta_id: propuesta?.id ?? null, propuesta_nombre: propuesta?.nombre ?? null, canal,
        },
        descripcion: `Registrar que ${v.codigo} le mandó <b>${esc(que)}</b> a <b>${esc(nombreCliente(c))}</b> por ${via} (queda en su historial y se agenda el seguimiento a 2 días hábiles)`,
      };
    }
  }
  return "No entendí qué cambio hay que hacer en la Suite. Decímelo concreto, por ejemplo: «pasá el pedido 340 a en preparación» o «agendá a Óptica Cristal para el jueves: llamar por el canje».";
}

async function registrarActividad(fila: Record<string, unknown>, obligatoria = false) {
  const { error } = await supabase.from("actividad_diaria").insert({ fecha: ahoraArgentina().fecha, ...fila });
  if (error) {
    console.error("actividad_diaria", JSON.stringify(error));
    if (obligatoria) throw error;
  }
}

async function notaConLinea(cod: string, linea: string): Promise<string> {
  const { data } = await supabase.from("clientes").select("nota").eq("cod", cod).maybeSingle();
  return `${linea}\n${data?.nota ?? ""}`.trim();
}

async function ejecutarOperacion(p: any): Promise<{ detalle: string; extra?: unknown }> {
  const ok = (r: { data: any; error: any }) => {
    if (r.error) throw r.error;
    if (r.data && r.data.ok === false) throw new Error(r.data.error ?? "la base lo rechazó");
    return r.data;
  };
  const cli: any = p.cod
    ? (await supabase.from("clientes").select("cod, razon, nomcomerc, contacto, telefono, whatsapp, localidad, email").eq("cod", p.cod).maybeSingle()).data
    : null;
  const nombre = esc(nombreCliente(cli) ?? p.cod);
  const contactoCli = cli ? { nombre_comercio: nombreCliente(cli), contacto: cli.contacto, telefono: cli.whatsapp ?? cli.telefono, localidad: cli.localidad } : {};
  const ahora = new Date().toISOString();

  switch (p.op) {
    case "cliente_codigo": {
      ok(await supabase.rpc("ojo_op_cliente_aprobar", { p_cod_actual: p.cod_actual, p_cod_nuevo: p.cod_nuevo, p_nro_lista: p.nro_lista ?? null }));
      await supabase.from("ojo_prospectos_aviso").update({ resuelto_en: ahora }).eq("cod_tmp", p.cod_actual);
      return { detalle: `${esc(p.cod_actual)} ahora es el cliente <b>${esc(p.cod_nuevo)}</b>; sus pedidos, actividad y envíos quedaron asociados.` };
    }

    case "cliente_unificar": {
      const r = ok(await supabase.rpc("ojo_op_cliente_unificar", { p_keep: p.keep, p_drop: p.drop }));
      const m = r.moved ?? {};
      return {
        detalle: `Unificados: ${esc(p.drop)} quedó dentro de <b>${esc(p.keep)}</b>${r.razon_keep ? ` (${esc(r.razon_keep)})` : ""}; pasaron ${m.pedidos ?? 0} pedido(s) y ${m.actividad ?? 0} registro(s) de actividad.`,
        extra: { respaldo: r.respaldo },
      };
    }

    case "cliente_reasignar": {
      const nota = await notaConLinea(p.cod, `🔄 ${ddmm()} — reasignado de ${p.desde ?? "sin asignar"} a ${p.hasta}${p.motivo ? `. Motivo: ${p.motivo}` : ""} (Telegram)`);
      const { error } = await supabase.from("clientes").update({ vendedor_asignado: p.hasta, origen: "asignado", nota, actualizado_en: ahora }).eq("cod", p.cod);
      if (error) throw error;
      await registrarActividad({ vendedor: p.hasta, cod_cliente: p.cod, ...contactoCli, actividad_desarrollo: `Cliente reasignado a ${p.hasta}` });
      return { detalle: `<b>${nombre}</b> ahora es de <b>${esc(p.hasta)}</b>.` };
    }

    case "pedido_estado": {
      const r = ok(await supabase.rpc("ojo_op_pedido_estado", { p_id: p.pedido_id, p_estado: p.estado, p_extra: p.extra ?? {} }));
      return { detalle: `Pedido <b>#${p.pedido_id}</b> (${esc(r.cliente)}) pasó de ${ESTADO_LINDO[r.antes] ?? r.antes} a <b>${ESTADO_LINDO[r.despues] ?? r.despues}</b>.` };
    }

    case "pedido_anular": {
      const r = ok(await supabase.rpc("ojo_op_pedido_anular", { p_id: p.pedido_id }));
      return { detalle: `Pedido <b>#${p.pedido_id}</b> de ${esc(r.cliente)} anulado; ${r.unidades} u. volvieron al stock.`, extra: { respaldo: r.respaldo } };
    }

    case "pedido_editar": {
      const r = ok(await supabase.rpc("ojo_op_pedido_items", { p_id: p.pedido_id, p_items: p.items }));
      const pend = (r.despues ?? []).filter((i: any) => Number(i.pendiente) > 0).length;
      return { detalle: `Pedido <b>#${p.pedido_id}</b> editado: ${r.total_units} u., vuelve a pendiente${pend ? `; ${pend} ítem(s) esperan stock` : ""}.`, extra: { antes: r.antes } };
    }

    case "agenda": {
      const lindo = `${p.fecha.slice(8, 10)}/${p.fecha.slice(5, 7)}`;
      const nota = await notaConLinea(p.cod, `📅 ${ddmm()} — agendado para el ${lindo}: ${p.paso} (Telegram)`);
      const { error } = await supabase.from("clientes").update({
        proximo_paso: p.paso, proxima_agenda_fecha: p.fecha, agenda_owner: p.duenio, nota, actualizado_en: ahora,
      }).eq("cod", p.cod);
      if (error) throw error;
      await registrarActividad({
        vendedor: p.duenio, cod_cliente: p.cod, ...contactoCli, actividad_desarrollo: `🔔 Recordatorio agendado: ${p.paso}`,
        actividad_futura: p.paso, proximo_paso_fecha: p.fecha,
      });
      return { detalle: `Agendado: <b>${nombre}</b> el ${lindo} en la agenda de ${esc(p.duenio)} — ${esc(p.paso)}.` };
    }

    case "campo_mover": {
      const r = p.hasta
        ? await supabase.rpc("mover_dia_campo", { p_vendedor: p.vendedor, p_desde: p.dia, p_hasta: p.hasta })
        : await supabase.rpc("posponer_dia_campo", { p_vendedor: p.vendedor, p_dia: p.dia });
      if (r.error) throw r.error;
      return { detalle: `Recorrido de ${esc(p.vendedor)}: el día ${p.dia} pasó ${p.hasta ? `al día ${p.hasta}` : "al final"}.` };
    }

    case "campo_visita": {
      const lindo = String(p.resultado).replace("_", " ");
      await registrarActividad({
        vendedor: p.vendedor, cod_cliente: p.cod, ...contactoCli, origen: "agenda_campo", resultado_contacto: p.resultado,
        actividad_desarrollo: `Visita de campo: ${lindo}${p.nota ? ` — ${p.nota}` : ""}`,
      }, true);
      const { error } = await supabase.from("agenda_campo").update({ visitado: true, resultado: p.resultado })
        .eq("vendedor", p.vendedor).eq("cod_cliente", p.cod);
      if (error) throw error;
      return { detalle: `Visita registrada: <b>${nombre}</b> (${esc(p.vendedor)}) — ${lindo}.` };
    }

    case "catalogo_acceso": {
      if (p.activo) {
        const { data: acc } = await supabase.from("catalogo_acceso").select("codigo").eq("cod_cliente", p.cod).eq("tipo", "optica")
          .order("created_at", { ascending: false }).limit(1);
        let k = acc?.[0]?.codigo;
        if (k) {
          const { error } = await supabase.from("catalogo_acceso").update({ activo: true }).eq("codigo", k);
          if (error) throw error;
        } else {
          k = ok(await supabase.rpc("catalogo_link_cliente", { p_cod_cliente: p.cod })).codigo;
        }
        return { detalle: `Catálogo de <b>${nombre}</b> habilitado: https://ver.orbitaleyewear.com.ar/catalogo?k=${k}` };
      }
      const { error } = await supabase.from("catalogo_acceso").update({ activo: false }).eq("cod_cliente", p.cod).eq("tipo", "optica").eq("activo", true);
      if (error) throw error;
      return { detalle: `Acceso al catálogo de <b>${nombre}</b> cortado.` };
    }

    case "catalogo_dispositivos": {
      if (p.accion === "autorizar") {
        const r = ok(await supabase.rpc("catalogo_autorizar_pendientes", { p_cod_cliente: p.cod }));
        return { detalle: `Autoricé ${r.autorizados} dispositivo(s) del catálogo de <b>${nombre}</b>.` };
      }
      ok(await supabase.rpc("catalogo_reset_dispositivos", { p_cod_cliente: p.cod }));
      return { detalle: `Dispositivos del catálogo de <b>${nombre}</b> liberados: vuelve a entrar desde cero.` };
    }

    case "proyectado_cargar": {
      const { error } = await supabase.from("stock_ingresos").insert({
        codigo: p.codigo, modelo: p.modelo, descripcion: p.descripcion, cantidad: p.cantidad, precio: p.precio,
        estado: "proyectado", creado_por: "ojo-telegram", nota: p.nota,
      });
      if (error) throw error;
      return { detalle: `Cargadas ${p.cantidad} u. proyectadas de ${esc(p.modelo)} ${esc(p.descripcion)}.` };
    }

    case "proyectado_confirmar": {
      const { data: f } = await supabase.from("stock_ingresos").select("estado").eq("id", p.id).maybeSingle();
      if (f?.estado !== "proyectado") throw new Error("ese proyectado ya no está pendiente");
      const r = await supabase.rpc("confirmar_ingreso_parcial", { p_id: p.id, p_por: "Gaston (Ojo)", p_cant: p.cantidad });
      if (r.error) throw r.error;
      return { detalle: `Ingreso confirmado: ${p.cantidad} u. pasaron al stock.` };
    }

    case "proyectado_anular": {
      const { data, error } = await supabase.from("stock_ingresos").update({ estado: "anulado" })
        .eq("id", p.id).eq("estado", "proyectado").select("cantidad, modelo, descripcion");
      if (error) throw error;
      if (!data?.length) throw new Error("ese proyectado ya no está pendiente");
      return { detalle: `Anuladas ${data[0].cantidad} u. proyectadas de ${esc(data[0].modelo)} ${esc(data[0].descripcion ?? "")}.` };
    }

    case "registrar_envio": {
      const proxima = await sumarDiasHabiles(2);
      const siguiente = p.canal === "llamada" ? "📤 Enviar la propuesta detallada + coordinar visita" : "📞 Llamar para explicar la propuesta";
      const via = p.canal === "llamada" ? "llamada" : p.canal === "mailto" ? "envío mail" : "envío WhatsApp";
      let envioId: number | null = null;
      if (p.propuesta_id) {
        const { data, error } = await supabase.from("envios_propuesta").insert({
          cod_cliente: p.cod, vendedor: p.vendedor, propuesta_id: p.propuesta_id, canal: p.canal,
          telefono_remitente: p.telefono_remitente, mensaje: "Registrado desde Telegram (Ojo)", piezas: [],
          estado: "enviado", fecha_envio: ahora,
        }).select("id").single();
        if (error) throw error;
        envioId = data?.id ?? null;
      }
      const desarrollo = p.canal === "llamada"
        ? `Llamada telefónica: ${p.propuesta_nombre ?? "catálogo B2B"}`
        : p.propuesta_id ? `Propuesta enviada: ${p.propuesta_nombre} (${via})` : `🛒 Envío catálogo B2B (con token) (${via})`;
      await registrarActividad({
        vendedor: p.vendedor, cod_cliente: p.cod, ...contactoCli, email: cli?.email ?? null,
        actividad_desarrollo: desarrollo, actividad_futura: siguiente, proximo_paso_fecha: proxima,
        propuesta_enviada_id: p.propuesta_id ?? null, nota_contexto: "Registrado desde Telegram (Ojo)",
      }, true);
      const { error } = await supabase.from("clientes").update({
        proximo_paso: siguiente, proxima_agenda_fecha: proxima, agenda_owner: p.vendedor, derivado_por: null, actualizado_en: ahora,
      }).eq("cod", p.cod);
      if (error) throw error;
      return {
        detalle: `Registrado: ${esc(p.vendedor)} le mandó ${esc(p.propuesta_nombre ?? "el catálogo")} a <b>${nombre}</b>. Seguimiento el ${proxima.slice(8, 10)}/${proxima.slice(5, 7)}: ${siguiente}.`,
        extra: { envio_id: envioId },
      };
    }
  }
  throw new Error(`operación desconocida: ${p.op}`);
}

async function altaProspecto(d: Record<string, any>, chatId: number, messageId: number, quien: string, autorUser: string | null, chatType: string) {
  const razon = String(d.razon ?? "").trim();
  const telefono = String(d.telefono ?? "").trim();
  const localidad = String(d.localidad ?? "").trim();
  const provincia = String(d.provincia ?? "").trim();
  if (!razon || (!telefono && !localidad)) {
    const tengo = [razon, telefono, localidad, provincia].filter(Boolean).map(esc).join(" · ");
    await telegramSend(chatId,
      `Dale, lo cargo. Pasame en un mensaje:\n• <b>Nombre del comercio</b>\n• <b>Teléfono / WhatsApp</b>\n• <b>Localidad y provincia</b>\n• Contacto (opcional)\n• Email y CUIT (opcional)` +
      (tengo ? `\n\nPor ahora tengo: ${tengo}` : ""), messageId);
    return;
  }

  // No duplicar: mismo telefono (la ficha busca por los ultimos 8 digitos) o mismo nombre.
  const existentes: any[] = [];
  const dig = telefono.replace(/\D/g, "").slice(-8);
  if (dig.length === 8) {
    const { data: f } = await supabase.rpc("ojo_ficha_cliente", { p_texto: dig });
    if ((f as any)?.cliente?.cod && !(f as any)?.busqueda_aproximada) existentes.push((f as any).cliente);
  }
  const limpio = razon.replace(/[,()"%*]/g, " ").replace(/\s+/g, " ").trim();
  const { data: porNombre } = await supabase.from("clientes").select("cod, razon, nomcomerc, vendedor_asignado, localidad")
    .or(`razon.ilike."${limpio}",nomcomerc.ilike."${limpio}"`).limit(3);
  existentes.push(...(porNombre ?? []));
  if (existentes.length) {
    const c = existentes[0];
    await telegramSend(chatId,
      `Ya existe: <b>${esc(nombreCliente(c))}</b> (cod ${c.cod}${c.vendedor_asignado ? `, de ${esc(c.vendedor_asignado)}` : ""}${c.localidad ? `, ${esc(c.localidad)}` : ""}). No lo cargo de nuevo.`,
      messageId);
    return;
  }

  const vendedor = (await vendedorPorNombre(d.vendedor, false)) ?? (await vendedorDelAutor(quien, autorUser, false));
  if (!vendedor) {
    await telegramSend(chatId, "¿Para qué vendedor es el prospecto?", messageId);
    return;
  }
  const cod = `TMP-${Date.now().toString().slice(-8)}`;
  const { error } = await supabase.from("clientes").insert({
    cod, razon, nomcomerc: razon, telefono: telefono || null, whatsapp: telefono || null,
    localidad: localidad || null, provincia: provincia || null, contacto: d.contacto ?? null,
    email: d.email ?? null, cuit: d.cuit ?? null, vendedor_asignado: vendedor.codigo,
    origen: "propio", clasificacion_recupero: "sin_historial", nro_lista: 5,
    nota: `⏳ Código de cliente pendiente — pedir a Administración. Cargado desde Telegram por ${quien}.`,
    actualizado_en: new Date().toISOString(),
  });
  if (error) {
    console.error("alta prospecto", JSON.stringify(error));
    await telegramSend(chatId, `No pude cargarlo: ${esc(error.message)}`, messageId);
    return;
  }
  const lugar = [localidad, provincia].filter(Boolean).map(esc).join(", ");
  await telegramSend(chatId,
    `✅ Prospecto cargado: <b>${esc(razon)}</b>${lugar ? ` (${lugar})` : ""} para ${vendedor.codigo}, código provisorio <code>${cod}</code>. Ya se puede usar en la Suite; le pedí el número de cliente a Administración.`,
    messageId);

  // El pedido del numero va al grupo (desde el privado, al grupo que recibe avisos).
  let destino = chatId;
  if (chatType === "private") {
    const { data: g } = await supabase.from("ojo_grupos").select("telegram_chat_id").eq("recibe_avisos", true).eq("activo", true).limit(1).maybeSingle();
    if (g?.telegram_chat_id) destino = Number(g.telegram_chat_id);
  }
  const aviso = await telegramSend(destino,
    `🆕 <b>Administración</b>: ${esc(quien)} cargó el prospecto <b>${esc(razon)}</b>${lugar ? ` (${lugar})` : ""} para ${vendedor.codigo} — provisorio <code>${cod}</code>.\n\n¿Me pasan el número de cliente? <b>Respondé este mensaje</b> con el número (y «lista N» si no es la 5).`);
  const mid = aviso?.result?.message_id;
  if (mid) {
    const { error: e2 } = await supabase.from("ojo_prospectos_aviso").insert({ telegram_chat_id: destino, telegram_message_id: mid, cod_tmp: cod, cargado_por: quien });
    if (e2) console.error("ojo_prospectos_aviso", JSON.stringify(e2));
  }
}

// Respuesta al aviso de prospecto con el numero de cliente. Si responde un admin o Administracion
// (ojo_roles) se aplica; si no, pasa por el SI de Gaston.
async function asignarNumeroProspecto(
  codTmp: string, texto: string, chatId: number, messageId: number, autorId: number,
  autorNombre: string, admins: number[], areaLabel: string,
) {
  const m = texto.match(/\b(\d{5,6}|AG-[A-Z]{3}-\d{4})\b/i);
  if (!m) {
    await telegramSend(chatId, "Respondé el aviso con el número de cliente (ej: 031050).", messageId);
    return;
  }
  const nuevo = m[1].toUpperCase();
  const lista = Number(texto.match(/lista\s*(\d{1,2})/i)?.[1] ?? "") || null;
  const { data: tmp } = await supabase.from("clientes").select("cod, razon, nomcomerc").eq("cod", codTmp).maybeSingle();
  if (!tmp) {
    await telegramSend(chatId, `El prospecto ${codTmp} ya no está pendiente (¿ya tiene número?).`, messageId);
    return;
  }
  const { data: ya } = await supabase.from("clientes").select("razon").eq("cod", nuevo).maybeSingle();
  if (ya) {
    await telegramSend(chatId, `El número ${nuevo} ya es de ${esc(ya.razon)}. Revisalo.`, messageId);
    return;
  }
  const payload = { op: "cliente_codigo", cod_actual: codTmp, cod_nuevo: nuevo, nro_lista: lista };
  if (admins.includes(autorId) || await tieneRol(autorId, "administracion")) {
    try {
      const r = await ejecutarOperacion(payload);
      await telegramSend(chatId, `✅ ${r.detalle}`, messageId);
    } catch (e) {
      await telegramSend(chatId, `❌ No se pudo: ${esc(String((e as Error)?.message ?? e).slice(0, 200))}`, messageId);
    }
    return;
  }
  const desc = `Asignar el número de cliente <b>${esc(nuevo)}</b> a <b>${esc(nombreCliente(tmp))}</b> (hoy ${codTmp})${lista ? `, lista ${lista}` : ""} — lo pasó ${esc(autorNombre)}`;
  await crearPropuesta("suite_op", payload, desc, chatId, messageId, autorNombre, areaLabel);
  await telegramSend(chatId, `Anotado ${nuevo} para ${esc(nombreCliente(tmp))}. Se lo pasé a Gastón; con su OK queda asociado.`, messageId);
}

// Charla 1:1 con Gaston (resumenes de pendientes y tanda). NO carga nada: las cargas van por
// el circuito de acciones con SI/NO, asi que nunca puede decir que registro algo.
async function charlaPrivada(texto: string, chatId: number) {
  const { data: abiertos } = await supabase.from("ojo_pendientes").select("*").neq("estado", "cerrado").order("creado_en", { ascending: false }).limit(40);
  const { data: respuestas } = await supabase.from("ojo_respuestas_tanda").select("razon, vendedor, posta, interes, texto, creado_en").order("creado_en", { ascending: false }).limit(30);
  const { data: tanda } = await supabase.rpc("ojo_tanda", { p_vendedor: null });
  const t = ahoraArgentina();
  const system = `Sos "Ojo", el asistente interno de Orbital Eyewear. Gaston te habla por Telegram 1:1. Hoy es ${t.dia} ${t.fecha}.
Pendientes activos (JSON, grupo_origen = area): ${JSON.stringify(abiertos ?? [])}
Respuestas de clientes a la tanda (JSON): ${JSON.stringify(respuestas ?? [])}
Tanda de hoy por vendedor (JSON): ${JSON.stringify(tanda)}
Areas: ${Object.entries(AREAS).map(([k, v]) => `${k}=${v.label}`).join(", ")}.
Responde breve y directo, en espanol rioplatense. Si pide un resumen, organizalo por area o por vendedor segun lo que pregunte.
PROHIBIDO decir que registraste, cargaste, guardaste o cambiaste algo, y PROHIBIDO inventar IDs: desde esta respuesta no se escribe nada. Si pide cargar o cambiar algo, pedile que lo diga concreto (ej: "cargale a Gafas Luxury ASCARI (038-04) x 5", "anota como pendiente X para Adrian el viernes", "cambia el telefono de 030440 a ...").`;
  const respuesta = await askLLM(system, texto, 1200);
  await telegramSend(chatId, respuesta || "No pude generar respuesta, probá reformular.");
}

// Mensajes cargados en ojo_salida (solo service_role puede escribirla). Cada fila se reclama
// antes de mandarla para que dos llamadas juntas no la manden dos veces.
async function enviarSalida(): Promise<number> {
  const { data } = await supabase.from("ojo_salida").select("id, chat_id, texto, reply_to").is("enviado_en", null).order("creado_en").limit(20);
  let enviados = 0;
  for (const fila of data ?? []) {
    const { data: tomada } = await supabase.from("ojo_salida").update({ enviado_en: new Date().toISOString() })
      .eq("id", fila.id).is("enviado_en", null).select("id");
    if (!tomada?.length) continue;
    const r = await telegramSend(Number(fila.chat_id), fila.texto, fila.reply_to ? Number(fila.reply_to) : undefined);
    await supabase.from("ojo_salida").update({ resultado: r?.ok ? "ok" : JSON.stringify(r).slice(0, 300) }).eq("id", fila.id);
    if (r?.ok) enviados++;
  }
  return enviados;
}

// v34: "/derivar <cliente> a <quien> [nota]" que escribe Gaston (privado o grupo). Antes el
// clasificador lo tomaba como pendiente y no le llegaba a nadie. Ahora va al grupo de avisos
// con la ficha para que el asignado contacte. No se ancla a ojo_hilos: el contacto sale por wa.me.
function waDeTelefono(tel: unknown): string | null {
  let s = String(tel ?? "").replace(/\D/g, "");
  if (!s) return null;
  if (s.startsWith("549") && s.length === 13) return s;
  if (s.startsWith("54")) s = s.slice(2);
  if (s.startsWith("0")) s = s.slice(1);
  if (s.length === 12) {
    // Numero con el 15 despues de la caracteristica (2, 3 o 4 digitos): 2478 15 472138.
    for (const n of [2, 3, 4]) {
      if (s.slice(n, n + 2) === "15") { s = s.slice(0, n) + s.slice(n + 2); break; }
    }
  }
  return s.length === 10 ? "549" + s : null;
}

async function derivarManual(texto: string, chatId: number, chatType: string, messageId: number, quien: string) {
  const cuerpo = texto.replace(/^\/?derivar(?:@\w+)?\s*/i, "").replace(/^a\s+/i, "").trim();
  // Se prueba cada " a " hasta que lo que sigue sea un vendedor/area: "X a Administracion para que...".
  let termino = "", destino: any = null, nota = "";
  const partes = cuerpo.split(/\s+a\s+/i);
  for (let i = 1; i < partes.length && !destino; i++) {
    const resto = partes.slice(i).join(" a ");
    const v = await vendedorPorNombre(resto, false);
    if (v) {
      destino = v;
      termino = partes.slice(0, i).join(" a ");
      nota = resto.split(/\s+/).slice(1).join(" ").replace(/^[,:.\-\s]+/, "");
    }
  }
  if (!destino || !termino) {
    await telegramSend(chatId, "Escribilo así: <code>/derivar Manitto a Administración</code> (y si querés, una nota al final).", messageId);
    return;
  }
  const r = await resolverCliente(termino);
  if (!r.cliente) {
    await telegramSend(chatId, r.error ?? "No encontré el cliente.", messageId);
    return;
  }
  const cl = r.cliente;
  const { data: ficha } = await supabase.rpc("ojo_ficha_cliente", { p_texto: cl.cod });
  const f = (ficha as any)?.cliente ?? {};
  const tel = cl.whatsapp || cl.telefono || f.telefono;
  const wa = waDeTelefono(cl.whatsapp) ?? waDeTelefono(cl.telefono);

  // Lo ultimo que escribio el cliente por IRIS/catalogo (30 dias), si hay.
  let ultimo = "";
  const { data: cts } = await supabase.from("contactos").select("id").eq("cod_cliente", cl.cod);
  const ids = (cts ?? []).map((x) => x.id);
  if (ids.length) {
    const { data: convs } = await supabase.from("at_conversaciones").select("id").in("contacto_id", ids);
    const cids = (convs ?? []).map((x) => x.id);
    if (cids.length) {
      const { data: m } = await supabase.from("at_mensajes").select("contenido, created_at")
        .in("conversacion_id", cids).eq("emisor", "cliente")
        .gte("created_at", new Date(Date.now() - 30 * 86400000).toISOString())
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (m?.contenido) ultimo = `💬 Último mensaje (${fechaLinda(m.created_at)}): «${esc(String(m.contenido).slice(0, 300))}»`;
    }
  }

  const lugar = [cl.localidad || f.localidad, f.provincia].filter(Boolean).join(", ");
  const lineas = [
    `🆘 <b>Derivación de ${esc(quien)}</b> — Para: <b>${esc(destino.nombre ?? destino.codigo)}</b>`,
    "",
    `<b>${esc(nombreCliente(cl))}</b> (cod ${esc(cl.cod)})${lugar ? ` · ${esc(lugar)}` : ""}`,
    cl.contacto ? `👤 ${esc(cl.contacto)}` : "",
    tel ? `📞 ${esc(tel)}${wa ? ` · <a href="https://wa.me/${wa}">WhatsApp</a>` : ""}` : "📞 sin teléfono cargado",
    cl.email ? `✉️ ${esc(cl.email)}` : "",
    f.direccion ? `📍 ${esc(f.direccion)}` : "",
    `Lo atiende: ${esc(f.lo_atiende_hoy ?? cl.vendedor_asignado ?? "—")} · Lista ${esc(cl.nro_lista ?? 5)}${f.ultima_compra_fecha ? ` · Última compra ${esc(f.ultima_compra_fecha)}` : ""}`,
    ultimo,
    nota ? `📝 ${esc(nota)}` : "",
    "",
    `👉 ${esc(destino.nombre ?? destino.codigo)}, contactala/o y avisá acá cuando esté.`,
  ].filter((l, i, a) => l !== "" || (i > 0 && a[i - 1] !== ""));

  let destinoChat: number = chatId;
  if (chatType === "private") {
    const { data: g } = await supabase.from("ojo_grupos").select("telegram_chat_id").eq("recibe_avisos", true).eq("activo", true).limit(1).maybeSingle();
    if (g?.telegram_chat_id) destinoChat = Number(g.telegram_chat_id);
  }
  const env = await telegramSend(destinoChat, lineas.join("\n"));
  if (destinoChat !== chatId) {
    await telegramSend(chatId, env?.ok
      ? `✅ Mandé al grupo la derivación de <b>${esc(nombreCliente(cl))}</b> para ${esc(destino.nombre ?? destino.codigo)}.`
      : "No pude mandarla al grupo, probá de nuevo.", messageId);
  }
}

async function manejarAltaDeGrupo(update: any): Promise<void> {
  const cm = update.my_chat_member;
  const chat = cm.chat;
  if (!chat || (chat.type !== "group" && chat.type !== "supergroup")) return;
  const estado = cm.new_chat_member?.status;
  const quien = cm.from?.first_name ?? "alguien";

  if (estado === "left" || estado === "kicked") {
    await supabase.from("ojo_grupos").update({ activo: false }).eq("telegram_chat_id", chat.id);
    return;
  }
  if (estado !== "member" && estado !== "administrator") return;

  const { data: existente } = await supabase.from("ojo_grupos").select("tipo").eq("telegram_chat_id", chat.id).maybeSingle();
  const tipo = existente?.tipo ?? inferirArea(chat.title ?? "");
  const area = AREAS[tipo] ?? AREAS.general;
  const { count } = await supabase.from("ojo_grupos").select("telegram_chat_id", { count: "exact", head: true }).eq("recibe_avisos", true);

  await supabase.from("ojo_grupos").upsert({
    telegram_chat_id: chat.id, nombre: chat.title ?? `grupo ${chat.id}`, tipo,
    activo: true, agregado_por: quien, prospecta: area.prospecta, recibe_avisos: (count ?? 0) === 0,
  }, { onConflict: "telegram_chat_id" });

  await telegramSend(chat.id, `👀 Hola, soy <b>Ojo</b>.\n\n• <b>Preguntáme</b>: stock y colores de un modelo, datos de un cliente, sus últimos pedidos, cómo viene la tanda del día.\n• <b>Pedime que cargue</b>: un pedido, una devolución, una cobranza o un dato de cliente. Lo armo y lo aplico con el OK de Gastón.\n• Tomo nota de los pendientes: pregunto quién se encarga y para cuándo, y vuelvo a preguntar si se cumplió.\n• Guardo la información útil que pasen para que IRIS conteste mejor.\n• Traigo acá lo que IRIS no pudo contestar y aviso quién abre el catálogo o genera un pedido.\n• <b>Contestale al cliente</b>: respondé un mensaje de cliente y se lo mando por su canal.\n\nÁrea detectada: <b>${area.label}</b> (se cambia con <code>/area &lt;area&gt;</code>).`);
  await sendToAllAdmins(`👀 Me agregaron al grupo <b>${chat.title}</b> (${quien}), registrado como <b>${area.label}</b> — chat_id <code>${chat.id}</code>.`);
}

// ── v32: casos 🆘 sin respuesta que otro vendedor pide tomar ─────────────────────────────────
const RE_TOMAR = /(^|[^a-záéíóúñ])(yo|lo tomo|tomo yo|me lo quedo|lo agarro|le respondo)([^a-záéíóúñ]|$)/i;

async function aplicarTomaDerivacion(p: any): Promise<string> {
  const { data: d } = await supabase.from("derivaciones").select("estado").eq("id", p.derivacion_id).maybeSingle();
  if (!d) throw new Error("la derivación ya no existe");
  if (d.estado === "resuelta") throw new Error("ese caso ya se resolvió");
  const { error } = await supabase.from("derivaciones")
    .update({ estado: "tomada", asignado_a: p.vendedor_id }).eq("id", p.derivacion_id);
  if (error) throw error;
  await supabase.from("ojo_derivacion_escalada")
    .update({ tomado_por_codigo: p.vendedor_codigo, resuelto_en: new Date().toISOString() }).eq("derivacion_id", p.derivacion_id);
  // WhatsApp al que lo tomo, con el mismo aviso que recibe un asignado (ojo-avisos v17).
  let wa = "";
  try {
    const { data: k } = await supabase.from("app_config").select("valor").eq("clave", "meta_webhook_verify_token").maybeSingle();
    const r = await fetch(`${SUPABASE_URL}/functions/v1/ojo-avisos`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-internal-key": String(k?.valor ?? "") },
      body: JSON.stringify({ accion: "avisar_asignado", derivacion_id: p.derivacion_id }),
    });
    const j = await r.json().catch(() => null);
    wa = j?.ok ? " Le mandé el caso por WhatsApp." : "";
    if (!j?.ok) console.error("avisar_asignado toma", JSON.stringify(j));
  } catch (e) { console.error("avisar_asignado toma", String(e)); }
  return `El caso de <b>${esc(p.cliente)}</b> ahora es de <b>${esc(p.vendedor_nombre)}</b>. Respondé el 🆘 y le llega al cliente.${wa}`;
}

async function tomarCasoEscalado(
  e: any, texto: string, chatId: number, messageId: number, autorId: number,
  autorNombre: string, autorUser: string | null, admins: number[], areaLabel: string,
) {
  if (!RE_TOMAR.test(texto) || /(^|\s)no(\s|$)/i.test(texto)) return; // otro comentario sobre el caso: no se toca nada
  if (e.resuelto_en) {
    await telegramSend(chatId, `Ese caso ya lo tomó <b>${esc(e.tomado_por_codigo ?? "otra persona")}</b> 👍`, messageId);
    return;
  }
  const { data: d } = await supabase.from("derivaciones").select("estado").eq("id", e.derivacion_id).maybeSingle();
  if (!d || d.estado !== "pendiente") {
    await supabase.from("ojo_derivacion_escalada").update({ resuelto_en: new Date().toISOString() }).eq("derivacion_id", e.derivacion_id);
    await telegramSend(chatId, "Ese caso ya lo están atendiendo ✅", messageId);
    return;
  }
  if (e.propuesta_id) {
    const { data: prop } = await supabase.from("ojo_acciones_propuestas").select("estado").eq("id", e.propuesta_id).maybeSingle();
    if (prop?.estado === "propuesta") {
      await telegramSend(chatId, `Ya lo pidió <b>${esc(e.pedido_por_nombre)}</b>, espero el OK de Gastón.`, messageId);
      return;
    }
  }
  const v = await vendedorDelAutor(autorNombre, autorUser, false);
  const { data: vf } = v ? await supabase.from("vendedores").select("id, codigo, nombre").eq("codigo", v.codigo).maybeSingle() : { data: null };
  if (!vf) {
    await telegramSend(chatId, "No te reconozco como vendedor 🤔 Pedile a Gastón que te asigne el caso.", messageId);
    return;
  }
  if (vf.codigo === e.asignado_original) {
    await supabase.from("ojo_derivacion_escalada").update({ tomado_por_codigo: vf.codigo, resuelto_en: new Date().toISOString() }).eq("derivacion_id", e.derivacion_id);
    await telegramSend(chatId, "Dale, es tuyo 👍 Respondé el 🆘 y le llega al cliente.", messageId);
    return;
  }
  const payload = {
    derivacion_id: e.derivacion_id, vendedor_id: vf.id, vendedor_codigo: vf.codigo,
    vendedor_nombre: vf.nombre, cliente: e.cliente ?? "el cliente",
  };
  if (admins.includes(autorId)) {
    const detalle = await aplicarTomaDerivacion(payload);
    await telegramSend(chatId, `Listo ✅ ${detalle}`, messageId);
    return;
  }
  const desc = `🙋 <b>${esc(vf.nombre)}</b> quiere tomar el caso de <b>${esc(e.cliente ?? "un cliente")}</b>` +
    ` (era de ${esc(e.asignado_original ?? "nadie")} y no tuvo respuesta).`;
  const cod = await crearPropuesta("tomar_derivacion", payload, desc, chatId, messageId, autorNombre, areaLabel);
  if (!cod) {
    await telegramSend(chatId, "No pude pedir el OK, avisale a Gastón.", messageId);
    return;
  }
  const { data: nueva } = await supabase.from("ojo_acciones_propuestas").select("id")
    .eq("tipo_accion", "tomar_derivacion").eq("origen_message_id", messageId).eq("origen_chat_id", chatId)
    .order("creado_en", { ascending: false }).limit(1).maybeSingle();
  await supabase.from("ojo_derivacion_escalada").update({
    propuesta_id: nueva?.id ?? null, pedido_por_codigo: vf.codigo, pedido_por_nombre: vf.nombre,
  }).eq("derivacion_id", e.derivacion_id);
  await telegramSend(chatId, `Le pedí el OK a Gastón ✋ Apenas confirme, el caso pasa a <b>${esc(vf.nombre)}</b>.`, messageId);
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("ok", { status: 200 });
  const update = await req.json().catch(() => ({}));
  // Disparador de la bandeja: solo manda lo que ya esta en ojo_salida, por eso no pide el secreto.
  if (update?.ojo_salida === true) {
    const enviados = await enviarSalida();
    return new Response(JSON.stringify({ enviados }), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  if (TELEGRAM_WEBHOOK_SECRET) {
    const secretHeader = req.headers.get("x-telegram-bot-api-secret-token");
    if (secretHeader !== TELEGRAM_WEBHOOK_SECRET) return new Response("unauthorized", { status: 401 });
  }

  if (update.my_chat_member) {
    await manejarAltaDeGrupo(update);
    return new Response("ok", { status: 200 });
  }

  const message = update.message;
  // Las fotos traen el texto en caption (ej: foto del presupuesto + "ojo cargame este pedido").
  if (!message || !(message.text || message.caption)) return new Response("ok", { status: 200 });
  const tieneFoto = Array.isArray(message.photo) && message.photo.length > 0;

  const chatId: number = message.chat.id;
  const chatType: string = message.chat.type;
  const texto: string = message.text ?? message.caption;
  const autorNombre: string = message.from?.first_name ?? "desconocido";
  const autorId: number = message.from?.id;
  const autorUser: string | null = message.from?.username ?? null;
  const messageId: number = message.message_id;
  // Le hablan al bot si lo nombran o le responden un mensaje suyo. Entre ellos, Ojo no se mete.
  const mencionaBot = /\bojo\b|@\w*bot\b/i.test(texto) || !!message.reply_to_message?.from?.is_bot;

  const { data: previos } = await supabase
    .from("ojo_mensajes_log").select("autor_nombre, texto, creado_en")
    .eq("telegram_chat_id", chatId)
    .gte("creado_en", new Date(Date.now() - 3 * 3600 * 1000).toISOString())
    .order("creado_en", { ascending: false }).limit(6);
  const contextoPrevio = (previos ?? []).reverse().map((m) => `${m.autor_nombre}: ${String(m.texto ?? "").slice(0, 300)}`);
  const contextoCorto = contextoPrevio.slice(-2).map((m) => m.replace(/^[^:]+:\s*/, "")).join("\n");
  const textoConContexto = [...contextoPrevio.map((m) => m.replace(/^[^:]+:\s*/, "")), texto].join("\n");

  await supabase.from("ojo_mensajes_log").insert({ telegram_chat_id: chatId, telegram_message_id: messageId, autor_nombre: autorNombre, autor_telegram_id: autorId, texto });

  const admins = await getAdminIds();

  if (chatType === "private") {
    if (admins.length === 0) {
      await telegramSend(chatId, "Hola, todavía no estoy activado para vos. Pedile a Gastón que te habilite.");
      return new Response("ok", { status: 200 });
    }
    if (!admins.includes(autorId)) {
      await telegramSend(chatId, "No tenés acceso a este asistente.");
      return new Response("ok", { status: 200 });
    }

    if (texto.trim().toLowerCase().startsWith("/grupos")) {
      const { data: grupos } = await supabase.from("ojo_grupos").select("*").order("creado_en");
      const lista = (grupos ?? []).map((g) => `• <b>${g.nombre}</b> — ${AREAS[g.tipo]?.label ?? g.tipo}${g.activo ? "" : " (inactivo)"}${g.recibe_avisos ? " · recibe avisos" : ""}`).join("\n");
      await telegramSend(chatId, lista ? `Grupos que escucho:\n${lista}` : "Todavía no estoy en ningún grupo.");
      return new Response("ok", { status: 200 });
    }

  }

  const cmdArea = chatType === "private" ? null : texto.trim().toLowerCase().match(/^\/area(?:@\w+)?\s+(\w+)/);
  if (cmdArea) {
    if (!admins.includes(autorId)) {
      await telegramSend(chatId, "Sólo un admin puede cambiar el área del grupo.", messageId);
      return new Response("ok", { status: 200 });
    }
    const nuevo = cmdArea[1];
    if (!AREAS[nuevo]) {
      await telegramSend(chatId, `Área desconocida. Opciones: ${Object.keys(AREAS).join(" | ")}`, messageId);
      return new Response("ok", { status: 200 });
    }
    await supabase.from("ojo_grupos").upsert({
      telegram_chat_id: chatId, nombre: message.chat.title ?? `grupo ${chatId}`,
      tipo: nuevo, activo: true, prospecta: AREAS[nuevo].prospecta,
    }, { onConflict: "telegram_chat_id" });
    await telegramSend(chatId, `Listo ✅ este grupo quedó como <b>${AREAS[nuevo].label}</b>.`, messageId);
    return new Response("ok", { status: 200 });
  }

  const cmdAvisos = chatType === "private" ? null : texto.trim().toLowerCase().match(/^\/avisos(?:@\w+)?\s+(on|off)/);
  if (cmdAvisos) {
    if (!admins.includes(autorId)) {
      await telegramSend(chatId, "Sólo un admin puede cambiar esto.", messageId);
      return new Response("ok", { status: 200 });
    }
    const on = cmdAvisos[1] === "on";
    if (on) await supabase.from("ojo_grupos").update({ recibe_avisos: false }).neq("telegram_chat_id", chatId);
    await supabase.from("ojo_grupos").update({ recibe_avisos: on }).eq("telegram_chat_id", chatId);
    await telegramSend(chatId, on ? "Listo ✅ los avisos caen acá." : "Listo, dejo de mandar avisos acá.", messageId);
    return new Response("ok", { status: 200 });
  }

  if (/^\/?derivar\b/i.test(texto.trim()) && admins.includes(autorId)) {
    await derivarManual(texto.trim(), chatId, chatType, messageId, autorNombre);
    return new Response("ok", { status: 200 });
  }

  let grupo: any = chatType === "private" ? { tipo: "gerencia" } : null;
  if (!grupo) {
    const { data } = await supabase.from("ojo_grupos").select("*").eq("telegram_chat_id", chatId).eq("activo", true).maybeSingle();
    grupo = data;
  }

  if (!grupo) {
    const tipo = inferirArea(message.chat.title ?? "");
    const { count } = await supabase.from("ojo_grupos").select("telegram_chat_id", { count: "exact", head: true }).eq("recibe_avisos", true);
    const { data: alta } = await supabase.from("ojo_grupos").upsert({
      telegram_chat_id: chatId, nombre: message.chat.title ?? `grupo ${chatId}`, tipo,
      activo: true, prospecta: AREAS[tipo].prospecta, recibe_avisos: (count ?? 0) === 0,
    }, { onConflict: "telegram_chat_id" }).select().single();
    grupo = alta;
    await sendToAllAdmins(`👀 Empecé a escuchar el grupo <b>${message.chat.title}</b> como <b>${AREAS[tipo].label}</b> (chat_id <code>${chatId}</code>).`);
    if (!grupo) return new Response("ok", { status: 200 });
  }

  const areaLabel = AREAS[grupo.tipo]?.label ?? grupo.tipo;

  // ¿Es una respuesta a un mensaje de cliente? Entonces es para el cliente.
  // Va primero que todo lo demas: responder un mensaje puntual es un gesto explicito
  // y no tiene que competir con el clasificador ni con las confirmaciones pendientes.
  const respondeA = message.reply_to_message?.message_id;
  if (respondeA) {
    const { data: hilo } = await supabase.from("ojo_hilos")
      .select("conversacion_id")
      .eq("telegram_chat_id", chatId).eq("telegram_message_id", respondeA)
      .maybeSingle();
    if (hilo?.conversacion_id) {
      await responderAlCliente(hilo.conversacion_id, texto, chatId, messageId, autorNombre);
      return new Response("ok", { status: 200 });
    }
    const { data: avisoPros } = await supabase.from("ojo_prospectos_aviso")
      .select("cod_tmp").eq("telegram_chat_id", chatId).eq("telegram_message_id", respondeA).maybeSingle();
    if (avisoPros?.cod_tmp) {
      await asignarNumeroProspecto(avisoPros.cod_tmp, texto, chatId, messageId, autorId, autorNombre, admins, areaLabel);
      return new Response("ok", { status: 200 });
    }
    const { data: escalada } = await supabase.from("ojo_derivacion_escalada")
      .select("*").eq("telegram_chat_id", chatId).eq("telegram_message_id", respondeA).maybeSingle();
    if (escalada) {
      await tomarCasoEscalado(escalada, texto, chatId, messageId, autorId, autorNombre, autorUser, admins, areaLabel);
      return new Response("ok", { status: 200 });
    }
  }

  if (admins.includes(autorId) && await manejarConfirmacion(texto, autorId, chatId)) {
    return new Response("ok", { status: 200 });
  }

  // Un codigo suelto el clasificador no lo toma como consulta: se contesta directo.
  const codCliente = await codigoClienteSolo(texto);
  if (codCliente) {
    await responderConsulta(preguntaCompras(codCliente), codCliente, chatId, messageId, autorId, autorNombre, admins);
    return new Response("ok", { status: 200 });
  }

  const { data: esperandoResp } = await supabase.from("ojo_pendientes").select("*")
    .eq("telegram_chat_id", chatId).eq("estado", "esperando_responsable")
    .order("creado_en", { ascending: false }).limit(1).maybeSingle();

  const { data: abiertosGrupo } = await supabase.from("ojo_pendientes").select("id, tema, estado, responsable_nombre, plazo_comprometido")
    .eq("telegram_chat_id", chatId).in("estado", ["abierto", "vencido_sin_confirmar"])
    .order("plazo_comprometido", { ascending: true }).limit(10);

  const c = await clasificar(texto, grupo.tipo, esperandoResp?.tema ?? null, (abiertosGrupo ?? []).map((p) => p.tema), contextoPrevio);
  const ahora = new Date().toISOString();

  if (chatType === "private" && c.tipo === "charla") {
    const { data: stockPriv } = await supabase.rpc("stock_en_mensaje", { p_texto: texto });
    if ((stockPriv ?? []).length > 0) c.tipo = "consulta";
  }

  if (c.tipo === "consulta") {
    // Charla entre el equipo: silencio. Solo contesta si le hablan a el (en privado, siempre).
    if (chatType !== "private" && !mencionaBot && !c.para_el_bot) return new Response("ok", { status: 200 });
    await responderConsulta(texto, c.cliente, chatId, messageId, autorId, autorNombre, admins);
    return new Response("ok", { status: 200 });
  }

  if (c.tipo === "responsable_plazo" && esperandoResp) {
    const plazo = resolverPlazo(texto, c.plazo_iso ?? null);
    const historial = [...(esperandoResp.historial ?? []), { fecha: ahora, accion: "responsable_asignado", detalle: texto }];
    await supabase.from("ojo_pendientes").update({
      responsable_nombre: c.responsable ?? autorNombre, plazo_comprometido: plazo,
      estado: "abierto", historial, updated_at: ahora,
    }).eq("id", esperandoResp.id);
    const cuando = plazo ? ` para el ${fechaLinda(plazo)}` : "";
    const cola = plazo ? " Vuelvo a preguntar." : " ¿Para cuándo lo tendrías?";
    await telegramSend(chatId, `Anotado ✅ <b>${c.responsable ?? autorNombre}</b> se encarga de "${esperandoResp.tema}"${cuando}.${cola}`, messageId);
    return new Response("ok", { status: 200 });
  }

  if (c.tipo === "accion_sistema") {
    if (c.accion === "conocimiento") await accionConocimiento(c, texto, chatId, messageId, autorNombre);
    else if (c.accion === "pedido") await accionPedido(texto, contextoCorto, c, chatId, messageId, autorNombre, areaLabel, tieneFoto);
    else if (c.accion === "devolucion") await accionDevolucion(texto, contextoCorto, c, chatId, messageId, autorNombre, areaLabel);
    else if (c.accion === "pago") await accionPago(texto, c, chatId, messageId, autorNombre, areaLabel);
    else if (c.accion === "operacion") await accionOperacion(texto, contextoPrevio.join("\n"), chatId, messageId, autorNombre, autorUser, areaLabel, chatType, autorId, admins);
    else await accionClienteDato(texto, c.cliente, chatId, messageId, autorNombre, areaLabel);
    return new Response("ok", { status: 200 });
  }

  if (c.tipo === "detalle_pendiente") {
    if (esperandoResp) {
      const historial = [...(esperandoResp.historial ?? []), { fecha: ahora, accion: "detalle", detalle: texto }];
      const temaFinal = c.tema && c.tema.length > (esperandoResp.tema ?? "").length ? c.tema : esperandoResp.tema;
      await supabase.from("ojo_pendientes").update({
        tema: temaFinal, mensaje_original: `${esperandoResp.mensaje_original}\n---\n${texto}`,
        historial, updated_at: ahora,
      }).eq("id", esperandoResp.id);
      await telegramSend(chatId, `👀 Anotado como: "${temaFinal}". ¿Quién se encarga y para cuándo?`, messageId);
    }
    return new Response("ok", { status: 200 });
  }

  if (c.tipo === "cierre_pendiente") {
    const candidatos: any[] = [...(abiertosGrupo ?? [])];
    if (candidatos.length === 0 && esperandoResp) candidatos.push(esperandoResp);
    if (candidatos.length > 0) {
      const pend = candidatos[0];
      const { data: full } = await supabase.from("ojo_pendientes").select("historial").eq("id", pend.id).single();
      const historial = [...((full?.historial as any[]) ?? []), { fecha: ahora, accion: "cerrado", detalle: texto }];
      await supabase.from("ojo_pendientes").update({ estado: "cerrado", cerrado_en: ahora, historial, updated_at: ahora }).eq("id", pend.id);
      await telegramSend(chatId, `Bien, cierro "${pend.tema}" como resuelto 👍`, messageId);
      return new Response("ok", { status: 200 });
    }
  }

  if (c.tipo === "respuesta_cliente") {
    await registrarRespuestaCliente(c, texto, chatId, messageId, autorNombre);
    return new Response("ok", { status: 200 });
  }

  if (c.tipo === "pendiente" && c.tema) {
    const { data: nuevo } = await supabase.from("ojo_pendientes").insert({
      grupo_origen: grupo.tipo, telegram_chat_id: chatId, tema: c.tema,
      mensaje_original: contextoPrevio.length ? `${contextoPrevio.slice(-2).join("\n")}\n---\n${texto}` : texto,
      estado: "esperando_responsable", telegram_message_id_origen: messageId,
      historial: [{ fecha: ahora, accion: "detectado", detalle: texto }],
    }).select().single();
    if (nuevo) {
      const detalle = await detalleArticulos(textoConContexto);
      await telegramSend(chatId, `👀 Tomo nota: "${c.tema}".${detalle}\n\n¿Quién se encarga y para cuándo?`, messageId);
    }
    return new Response("ok", { status: 200 });
  }

  if (chatType === "private") await charlaPrivada(texto, chatId);
  return new Response("ok", { status: 200 });
});
