// dist-telegram — bot de Telegram para los distribuidores (Cristaldo 010001, Optisur 010002).
// Chat privado con el dueño y con sus vendedores. Entran con su teléfono.
//   POST /             -> webhook de Telegram
//   GET  ?tarea=setup  -> (x-cron-key) conecta el webhook con el token de app_config
// Dueño: todo. Vendedor del distribuidor: sin precios ni cuenta corriente.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GROQ_KEY = Deno.env.get("GROQ_API_KEY") ?? "";
const MODELO_TEXTO = Deno.env.get("DIST_GROQ_MODEL") ?? "openai/gpt-oss-120b";
const MODELO_VISION = "qwen/qwen3.6-27b";

const H = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };

const cacheCfg: Record<string, string> = {};
async function cfg(clave: string): Promise<string> {
  if (cacheCfg[clave] !== undefined) return cacheCfg[clave];
  const res = await fetch(`${SUPABASE_URL}/rest/v1/app_config?clave=eq.${clave}&select=valor`, { headers: H });
  const filas = res.ok ? ((await res.json()) as { valor: string }[]) : [];
  cacheCfg[clave] = filas[0]?.valor ?? "";
  return cacheCfg[clave];
}
async function guardarCfg(clave: string, valor: string) {
  await fetch(`${SUPABASE_URL}/rest/v1/app_config`, {
    method: "POST",
    headers: { ...H, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({ clave, valor }),
  });
  cacheCfg[clave] = valor;
}
// El token: primero el secret de Edge Functions, si no, app_config
const token = async () => Deno.env.get("DIST_TELEGRAM_BOT_TOKEN") || (await cfg("dist_telegram_bot_token"));

// ————— base de datos (PostgREST con service role) —————

async function sel<T>(path: string): Promise<T[]> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: H });
  if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
  return (await res.json()) as T[];
}
async function ins<T>(tabla: string, fila: unknown): Promise<T[]> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${tabla}`, {
    method: "POST",
    headers: { ...H, "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify(fila),
  });
  if (!res.ok) throw new Error(`${tabla}: ${res.status} ${await res.text()}`);
  return (await res.json()) as T[];
}
async function upd(tabla: string, filtro: string, cambios: unknown) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${tabla}?${filtro}`, {
    method: "PATCH",
    headers: { ...H, "Content-Type": "application/json" },
    body: JSON.stringify(cambios),
  });
  if (!res.ok) throw new Error(`${tabla}: ${res.status} ${await res.text()}`);
}
async function rpc(fn: string, args: Record<string, unknown>) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { ...H, "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  if (!res.ok) console.error(fn, res.status, await res.text());
}
// Grupo interno del bot (Gastón, Gustavo, Administración, Mauro, Postventa): ve todo.
// La marca #d<id> al pie sirve para contestarle a ESE usuario respondiendo el mensaje.
async function espejo(texto: string, uid?: number) {
  const g = await cfg("dist_telegram_grupo");
  if (g) await tg("sendMessage", { chat_id: Number(g), text: "👁 " + texto + (uid ? `\n#d${uid}` : ""), disable_web_page_preview: true });
}
// Lo que tiene que gestionar alguien va además al grupo del Ojo
const avisoOjo = async (texto: string, uid?: number) => { await rpc("dist_aviso_ojo", { p_texto: texto }); await espejo(texto, uid); };

// ————— Telegram —————

type Boton = { text: string; callback_data: string };

async function tg(metodo: string, body: unknown) {
  const res = await fetch(`https://api.telegram.org/bot${await token()}/${metodo}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) console.error(metodo, res.status, JSON.stringify(j));
  return j;
}
async function enviar(chat: number, texto: string, botones?: Boton[][], teclado?: unknown) {
  // Telegram corta en 4096 caracteres
  const partes: string[] = [];
  let resto = texto;
  while (resto.length > 3900) {
    const corte = resto.lastIndexOf("\n", 3900);
    partes.push(resto.slice(0, corte > 0 ? corte : 3900));
    resto = resto.slice(corte > 0 ? corte + 1 : 3900);
  }
  partes.push(resto);
  for (let i = 0; i < partes.length; i++) {
    const ultimo = i === partes.length - 1;
    await tg("sendMessage", {
      chat_id: chat,
      text: partes[i],
      parse_mode: "HTML",
      disable_web_page_preview: true,
      ...(ultimo && botones ? { reply_markup: { inline_keyboard: botones } } : {}),
      ...(ultimo && teclado ? { reply_markup: teclado } : {}),
    });
  }
}
const responderCallback = (id: string, texto?: string) =>
  tg("answerCallbackQuery", { callback_query_id: id, ...(texto ? { text: texto } : {}) });

const PEDIR_TEL = {
  keyboard: [[{ text: "📱 Entrar con mi teléfono", request_contact: true }]],
  resize_keyboard: true,
  one_time_keyboard: true,
};

const B = {
  cargar: "📦 Cargar pedido",
  pedidos: "📋 Mis pedidos",
  envios: "🚚 Envíos",
  cc: "💰 Cuenta corriente",
  especial: "✨ Pedido especial",
  postventa: "🔧 Postventa",
  vendedores: "👥 Mis vendedores",
  cambiar: "🔄 Cambiar distribuidor",
};
// Admin de Orbital: ve como titular y cambia de distribuidor
const menu = (u: { rol: string }) => ({
  keyboard: u.rol === "admin"
    ? [[{ text: B.cargar }, { text: B.pedidos }], [{ text: B.envios }, { text: B.cc }], [{ text: B.especial }, { text: B.postventa }], [{ text: B.vendedores }, { text: B.cambiar }]]
    : u.rol === "dueno"
    ? [[{ text: B.cargar }, { text: B.pedidos }], [{ text: B.envios }, { text: B.cc }], [{ text: B.especial }, { text: B.postventa }], [{ text: B.vendedores }]]
    : [[{ text: B.cargar }, { text: B.pedidos }], [{ text: B.envios }, { text: B.especial }], [{ text: B.postventa }]],
  resize_keyboard: true,
  is_persistent: true,
});

// ————— utilidades —————

const esc = (s: unknown) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const sinTilde = (s: string) =>
  (s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
const clave = (s: string) => sinTilde(s).replace(/[^a-z0-9]/g, "");
const pesos = (n: number) => "$" + Math.round(Number(n) || 0).toLocaleString("es-AR");
const precioDist = (p: number) => Math.round((Number(p) || 0) / 1.41);
const fecha = (s?: string | null) => {
  if (!s) return "";
  const d = new Date(s.length <= 10 ? s + "T12:00:00" : s);
  return isNaN(d.getTime()) ? s : d.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", timeZone: "America/Argentina/Buenos_Aires" });
};

// ————— quién escribe —————

type Usuario = {
  id: number; nombre: string; telefono: string; rol: "dueno" | "vendedor" | "admin";
  distribuidor_id: number; chat_id: number | null;
  distribuidores: { nombre: string; cod_cliente: string };
};
const esDueno = (u: { rol: string }) => u.rol === "dueno" || u.rol === "admin";
const esAdmin = (u: { rol: string }) => u.rol === "admin";
const cod = (u: Usuario) => u.distribuidores.cod_cliente;

async function usuarioPorTelegram(tgId: number): Promise<Usuario | null> {
  const f = await sel<Usuario>(
    `dist_tg_usuario?telegram_user_id=eq.${tgId}&activo=eq.true&select=id,nombre,telefono,rol,distribuidor_id,chat_id,distribuidores(nombre,cod_cliente)&limit=1`,
  );
  return f[0] ?? null;
}

// ————— paso de la charla —————

type Estado = { paso: string | null; data: Record<string, unknown> };
async function leerEstado(chat: number): Promise<Estado> {
  const f = await sel<Estado & { updated_at: string }>(`dist_tg_estado?chat_id=eq.${chat}&select=paso,data,updated_at`);
  if (!f[0]) return { paso: null, data: {} };
  // una carga a medias vence a las 12 h
  if (Date.now() - new Date(f[0].updated_at).getTime() > 12 * 3600e3) return { paso: null, data: {} };
  return { paso: f[0].paso, data: f[0].data ?? {} };
}
async function guardarEstado(chat: number, paso: string | null, data: Record<string, unknown> = {}) {
  await fetch(`${SUPABASE_URL}/rest/v1/dist_tg_estado`, {
    method: "POST",
    headers: { ...H, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({ chat_id: chat, paso, data, updated_at: new Date().toISOString() }),
  });
}

// ————— IA (Groq) —————

async function groq(model: string, messages: unknown[], maxTokens: number, json: boolean): Promise<string> {
  if (!GROQ_KEY) return "";
  for (const forzarJson of json ? [true, false] : [false]) {
    try {
      const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${GROQ_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model, messages, max_tokens: maxTokens, temperature: 0,
          ...(forzarJson ? { response_format: { type: "json_object" } } : {}),
        }),
      });
      const j = await res.json();
      if (!res.ok) { console.error("groq", model, res.status, JSON.stringify(j).slice(0, 300)); continue; }
      const t = String(j.choices?.[0]?.message?.content ?? "");
      return t.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
    } catch (e) {
      console.error("groq", model, String(e));
    }
  }
  return "";
}
function jsonDe(t: string): Record<string, unknown> | null {
  const i = t.indexOf("{"), f = t.lastIndexOf("}");
  if (i < 0 || f < i) return null;
  try { return JSON.parse(t.slice(i, f + 1)); } catch { return null; }
}

// Foto de Telegram -> bytes
async function bajarFoto(fileId: string): Promise<Uint8Array | null> {
  const j = await tg("getFile", { file_id: fileId });
  const path = j?.result?.file_path;
  if (!path) return null;
  const res = await fetch(`https://api.telegram.org/file/bot${await token()}/${path}`);
  return res.ok ? new Uint8Array(await res.arrayBuffer()) : null;
}
function base64(b: Uint8Array) {
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}
// La foto va a storage: el link de Telegram lleva el token del bot adentro
async function subirFoto(b: Uint8Array, codCli: string): Promise<string | null> {
  const nombre = `dist/${codCli}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/optica-fotos/${nombre}`, {
    method: "POST",
    headers: { ...H, "Content-Type": "image/jpeg" },
    body: b,
  });
  if (!res.ok) { console.error("storage", res.status, await res.text()); return null; }
  return `${SUPABASE_URL}/storage/v1/object/public/optica-fotos/${nombre}`;
}
async function leerFoto(b: Uint8Array, que: string): Promise<string> {
  return await groq(MODELO_VISION, [{
    role: "user",
    content: [
      { type: "text", text: que },
      { type: "image_url", image_url: { url: `data:image/jpeg;base64,${base64(b)}` } },
    ],
  }], 2500, false);
}
const LEER_PEDIDO = "Es la foto de un pedido de anteojos (impreso o a mano). Transcribí cada artículo en un renglón: MODELO, color, código de color si aparece, y cantidad. Solo los renglones, sin comentarios.";
const LEER_REPUESTOS = "Es la foto de un pedido de repuestos o arreglos de anteojos. Transcribí cada renglón: modelo/producto, qué repuesto o problema, y cantidad. Solo los renglones, sin comentarios.";

// ————— catálogo y resolución de artículos —————

type Sku = { codigo: string; modelo: string; descripcion: string; stock: number; proy: number; precio: number };

async function catalogo(): Promise<Sku[]> {
  const [st, pr] = await Promise.all([
    sel<{ codigo: string; modelo: string; descripcion: string; cantidad: number; precio: number }>(
      "stock?select=codigo,modelo,descripcion,cantidad,precio&limit=5000"),
    sel<{ codigo: string; modelo: string; descripcion: string; cantidad: number; precio: number }>(
      "stock_ingresos?estado=eq.proyectado&select=codigo,modelo,descripcion,cantidad,precio&limit=5000"),
  ]);
  const m = new Map<string, Sku>();
  for (const s of st) {
    if (!s.codigo || !s.modelo) continue;
    m.set(s.codigo, { codigo: s.codigo, modelo: s.modelo, descripcion: s.descripcion ?? "", stock: Math.max(0, s.cantidad ?? 0), proy: 0, precio: Number(s.precio) || 0 });
  }
  for (const p of pr) {
    if (!p.codigo) continue;
    const x = m.get(p.codigo);
    if (x) x.proy += p.cantidad ?? 0;
    else if (p.modelo) m.set(p.codigo, { codigo: p.codigo, modelo: p.modelo, descripcion: p.descripcion ?? "", stock: 0, proy: p.cantidad ?? 0, precio: Number(p.precio) || 0 });
  }
  return [...m.values()];
}

// Abreviaturas de las descripciones de stock
const ABREV: Record<string, string[]> = {
  ngb: ["negro", "brillo"], ngm: ["negro", "mate"], cl: ["clear"], ha: ["habano"], ma: ["marron"],
  crmel: ["caramelo"], crmelo: ["caramelo"], ce: ["celeste"], na: ["naranja"], ve: ["verde"],
  az: ["azul"], azosc: ["azul", "oscuro"], gr: ["gris"], deg: ["degrade"], degr: ["degrade"],
  pol: ["polarizado"], polar: ["polarizado"], espejo: ["flash"], espejado: ["flash"], transparente: ["clear"],
};
const VACIAS = new Set(["con", "de", "y", "el", "la", "color", "marco", "cristal", "lente"]);
function tokensColor(s: string): string[] {
  const out: string[] = [];
  for (const t of sinTilde(s).replace(/[^a-z0-9 ]/g, " ").split(/\s+/)) {
    if (!t || VACIAS.has(t)) continue;
    if (ABREV[t]) out.push(...ABREV[t]);
    else if (t.length >= 3) out.push(t);
  }
  return out;
}
function puntaje(color: string, desc: string): number {
  const d = tokensColor(desc);
  let p = 0;
  for (const c of tokensColor(color)) if (d.some((x) => x.startsWith(c) || (x.length >= 4 && c.startsWith(x)))) p++;
  return p;
}

type Linea = {
  texto: string; modelo: string; color: string; codigo_color: string; cantidad: number;
  estado: "ok" | "amb" | "nf";
  sku?: Sku; opciones?: Sku[];
};

function buscarModelo(nombre: string, modelos: string[]): string | null {
  const k = clave(nombre);
  if (!k) return null;
  const exacto = modelos.find((m) => clave(m) === k);
  if (exacto) return exacto;
  const cand = modelos.filter((m) => {
    const km = clave(m);
    return km.length >= 4 && k.length >= 4 && (km.startsWith(k) || k.startsWith(km));
  }).sort((a, b) => clave(b).length - clave(a).length);
  if (cand[0]) return cand[0];
  const primera = clave(sinTilde(nombre).split(/\s+/)[0] ?? "");
  return primera.length >= 4 ? modelos.find((m) => clave(m) === primera) ?? null : null;
}

function resolver(it: { texto?: string; modelo?: string; color?: string; codigo?: string; cantidad?: number }, cat: Sku[], modelos: string[]): Linea {
  const l: Linea = {
    texto: String(it.texto ?? `${it.modelo ?? ""} ${it.color ?? ""}`).trim(),
    modelo: String(it.modelo ?? "").trim(),
    color: String(it.color ?? "").trim(),
    codigo_color: String(it.codigo ?? "").trim(),
    cantidad: Math.max(1, Math.round(Number(it.cantidad) || 1)),
    estado: "nf",
  };
  // código completo pegado tal cual
  const directo = cat.find((s) => clave(s.codigo) === clave(l.codigo_color) && l.codigo_color.length >= 10);
  if (directo) return { ...l, estado: "ok", sku: directo, modelo: directo.modelo };

  const mod = buscarModelo(l.modelo, modelos) ?? buscarModelo(l.texto, modelos);
  if (!mod) return l;
  l.modelo = mod;
  const skus = cat.filter((s) => s.modelo === mod);
  if (skus.length === 1) return { ...l, estado: "ok", sku: skus[0] };

  // "(038-04)" = últimos 5 caracteres del código
  const suf = l.codigo_color.replace(/[^0-9a-z]/gi, "").toUpperCase();
  if (suf.length >= 3) {
    const porSuf = skus.filter((s) => s.codigo.toUpperCase().endsWith(suf));
    if (porSuf.length === 1) return { ...l, estado: "ok", sku: porSuf[0] };
  }
  if (l.color) {
    const ranking = skus.map((s) => ({ s, p: puntaje(l.color, s.descripcion) })).sort((a, b) => b.p - a.p);
    if (ranking[0]?.p > 0 && ranking[0].p > (ranking[1]?.p ?? 0)) return { ...l, estado: "ok", sku: ranking[0].s };
    const top = ranking[0]?.p > 0 ? ranking.filter((r) => r.p === ranking[0].p).map((r) => r.s) : [];
    if (top.length > 1) return { ...l, estado: "amb", opciones: top };
  }
  const opciones = [...skus].sort((a, b) => (b.stock + b.proy > 0 ? 1 : 0) - (a.stock + a.proy > 0 ? 1 : 0) || b.stock - a.stock);
  return { ...l, estado: "amb", opciones };
}

async function extraerPedido(texto: string, modelos: string[]): Promise<Linea[] | null> {
  const sys =
    "Convertís pedidos de anteojos en JSON. Devolvé SOLO " +
    '{"items":[{"texto":"renglón original","modelo":"MODELO","color":"color tal cual lo escribió","codigo":"código de color si aparece (ej 038-04), si no vacío","cantidad":1}]}. ' +
    "Un item por artículo y color. Si no dice cantidad, 1. Ignorá saludos y comentarios. " +
    "Si un renglón dice 'x 5', '5 u', '5 unidades' o empieza con el número, esa es la cantidad. " +
    "Modelos que existen: " + modelos.join(", ");
  const out = await groq(MODELO_TEXTO, [{ role: "system", content: sys }, { role: "user", content: texto }], 3000, true);
  const j = jsonDe(out);
  if (!j || !Array.isArray(j.items)) return null;
  const cat = await catalogo();
  return (j.items as Record<string, unknown>[]).map((it) => resolver(it, cat, modelos));
}

async function listaModelos(): Promise<string[]> {
  const cat = await catalogo();
  return [...new Set(cat.map((s) => s.modelo))].sort();
}

// ————— pedido: resumen y confirmación —————

const iconoLinea = (l: Linea) => {
  if (l.estado !== "ok" || !l.sku) return "❔";
  if (l.sku.stock >= l.cantidad) return "✅";
  if (l.sku.stock > 0) return "⚠️";
  if (l.sku.proy > 0) return "🕐";
  return "✨";
};
const vaAlPedido = (l: Linea) => l.estado === "ok" && !!l.sku && (l.sku.stock > 0 || l.sku.proy > 0);

function resumenPedido(lineas: Linea[], dueno: boolean): string {
  const r: string[] = ["🧾 <b>Así quedaría el pedido</b>", ""];
  let unidades = 0, importe = 0;
  for (const l of lineas) {
    const ic = iconoLinea(l);
    if (l.estado === "ok" && l.sku) {
      const s = l.sku;
      let nota = "";
      if (ic === "⚠️") nota = ` — hay ${s.stock} en stock${s.proy > 0 ? `, el resto del proyectado` : ", el resto queda pendiente"}`;
      if (ic === "🕐") nota = " — proyectado";
      if (ic === "✨") nota = " — sin stock ni proyectado → pedido especial";
      const precio = dueno && vaAlPedido(l) ? ` · ${pesos(precioDist(s.precio))} c/u` : "";
      r.push(`${ic} ${esc(s.modelo)} ${esc(s.descripcion)} <code>${esc(s.codigo.slice(-5))}</code> × ${l.cantidad}${precio}${nota}`);
      if (vaAlPedido(l)) { unidades += l.cantidad; importe += l.cantidad * precioDist(s.precio); }
    } else {
      r.push(`❔ "${esc(l.texto)}" — no lo encontré → pedido especial`);
    }
  }
  r.push("");
  r.push(`<b>Al pedido: ${unidades} u.</b>${dueno && unidades ? ` · ${pesos(importe)} + IVA (precio distribuidor)` : ""}`);
  if (lineas.some((l) => !vaAlPedido(l))) r.push("Lo marcado con ✨ o ❔ se lo paso a Orbital como <b>pedido especial</b>.");
  r.push("");
  r.push("✅ disponible · ⚠️ stock parcial · 🕐 proyectado");
  r.push("Si querés sumar artículos, mandámelos ahora.");
  return r.join("\n");
}

const BOT_PEDIDO: Boton[][] = [[{ text: "✅ Confirmar pedido", callback_data: "ped|ok" }], [{ text: "❌ Cancelar", callback_data: "ped|no" }]];

// Si hay artículos con varios colores posibles, pregunta de a uno
async function seguirPedido(chat: number, u: Usuario, lineas: Linea[]) {
  const i = lineas.findIndex((l) => l.estado === "amb");
  await guardarEstado(chat, "pedido", { lineas });
  if (i >= 0) {
    const l = lineas[i];
    const ops = (l.opciones ?? []).slice(0, 12);
    const botones: Boton[][] = ops.map((s) => [{
      text: `${s.descripcion.slice(0, 40)} ${s.stock > 0 ? "✅" : s.proy > 0 ? "🕐" : "✨"}`,
      callback_data: `col|${i}|${s.codigo}`,
    }]);
    botones.push([{ text: "No está / saltear", callback_data: `col|${i}|x` }]);
    await enviar(chat, `🎨 <b>${esc(l.modelo)}</b> × ${l.cantidad}${l.color ? ` ("${esc(l.color)}")` : ""}: ¿qué color?`, botones);
    return;
  }
  await enviar(chat, resumenPedido(lineas, esDueno(u)), BOT_PEDIDO);
}

async function recibirPedido(chat: number, u: Usuario, texto: string, previas: Linea[]) {
  await enviar(chat, "⏳ Leyendo el pedido…");
  const modelos = await listaModelos();
  const nuevas = await extraerPedido(texto, modelos);
  if (!nuevas || !nuevas.length) {
    await enviar(chat, "No pude leer artículos en eso. Mandame un renglón por artículo, por ejemplo:\n<code>ASCARI 038-04 x5\nPALERMO negro brillo polarizado x10</code>");
    return;
  }
  await seguirPedido(chat, u, [...previas, ...nuevas]);
}

async function confirmarPedido(chat: number, u: Usuario, lineas: Linea[]) {
  const alPedido = lineas.filter(vaAlPedido);
  const especiales = lineas.filter((l) => !vaAlPedido(l));
  const cli = (await sel<{ cod: string; razon: string; vendedor_asignado: string | null }>(
    `clientes?cod=eq.${cod(u)}&select=cod,razon,vendedor_asignado`))[0];
  const partes: string[] = [];

  if (alPedido.length) {
    const items = alPedido.map((l) => ({
      codigo: l.sku!.codigo, modelo: l.sku!.modelo, descripcion: l.sku!.descripcion,
      cantidad: l.cantidad, precio: precioDist(l.sku!.precio),
    }));
    const proy = alPedido.filter((l) => l.sku!.stock < l.cantidad).map((l) => `${l.sku!.modelo} ${l.sku!.codigo.slice(-5)}`);
    const obs = [
      `🤖 BOT TELEGRAM DISTRIBUIDORES — cargó ${u.nombre} (${esDueno(u) ? "dueño" : "vendedor del distribuidor"})`,
      proy.length ? `Sin stock completo (proyectado/pendiente): ${proy.join(", ")}` : "",
    ].filter(Boolean).join(" · ");
    const [pre] = await ins<{ id: number }>("catalogo_precarga", {
      cod_cliente: cod(u),
      cliente_razon: `${cod(u)} - ${cli?.razon ?? u.distribuidores.nombre}`,
      vendedor: cli?.vendedor_asignado || "Corporativo",
      contacto: u.nombre,
      wsp: u.telefono,
      obs,
      items,
      total_units: items.reduce((a, i) => a + i.cantidad, 0),
      importe: items.reduce((a, i) => a + i.cantidad * i.precio, 0),
    });
    await espejo(
      `📦 PEDIDO #P${pre.id} (precarga) — ${u.distribuidores.nombre} (${cod(u)})\nCargó: ${u.nombre}\n` +
      items.map((i) => `• ${i.modelo} ${i.descripcion} (${i.codigo.slice(-5)}) × ${i.cantidad}`).join("\n") +
      `\nTotal: ${items.reduce((a, i) => a + i.cantidad, 0)} u. · ${pesos(items.reduce((a, i) => a + i.cantidad * i.precio, 0))}` +
      (proy.length ? `\nSin stock completo: ${proy.join(", ")}` : "") + "\nSe confirma en la Suite.",
      u.id,
    );
    partes.push(`✅ Pedido recibido <b>#P${pre.id}</b> · ${items.reduce((a, i) => a + i.cantidad, 0)} u. Orbital lo revisa y lo confirma; lo seguís en ${B.pedidos}.`);
  }
  if (especiales.length) {
    const detalle = especiales.map((l) => l.sku
      ? `${l.sku.modelo} ${l.sku.descripcion} (${l.sku.codigo}) × ${l.cantidad}`
      : `"${l.texto}" × ${l.cantidad}`).join("\n");
    const id = await crearEspecial(u, detalle, especiales.map((l) => ({ texto: l.texto, codigo: l.sku?.codigo ?? null, cantidad: l.cantidad })));
    partes.push(`✨ Lo que no está en stock ni en el proyectado va como <b>pedido especial #E${id}</b>. Orbital lo evalúa y te avisa.`);
  }
  await guardarEstado(chat, null);
  await enviar(chat, partes.join("\n\n") || "No quedó nada para cargar.", undefined, menu(u));
}

// ————— pedido especial —————

async function crearEspecial(u: Usuario, detalle: string, items: unknown[] = []): Promise<number> {
  const [e] = await ins<{ id: number }>("dist_solicitud_especial", { cod_cliente: cod(u), usuario_id: u.id, detalle, items });
  await avisoOjo(
    `✨ PEDIDO ESPECIAL #E${e.id} (bot distribuidores)\nPara: Gastón\n` +
    `Distribuidor: ${u.distribuidores.nombre} (${cod(u)})\nCargó: ${u.nombre} · +${u.telefono}\n` +
    `Fuera de stock y del proyectado:\n${detalle}`,
  );
  return e.id;
}

// ————— consultas —————

const ESTADO_PEDIDO: Record<string, string> = {
  pendiente: "📥 Recibido", observado: "🔎 En revisión", en_preparacion: "🛠 En preparación",
  listo: "📦 Preparado", listo_despachar: "📦 Listo para despachar", despachado: "🚚 Despachado",
  facturado: "🧾 Facturado", consignacion: "Consignación",
};

type Pedido = {
  id: number; fecha: string | null; created_at: string; estado: string; total_units: number;
  importe_neto: number | null; nro_factura: string | null; fecha_factura: string | null; nro_remito: string | null;
  tipo_transporte: string | null; nro_guia: string | null; entrega_canal: string | null; fecha_entrega: string | null;
  cond_pago: string | null; cobrado: boolean | null; items: Record<string, unknown>[];
};
const COLS_PED = "id,fecha,created_at,estado,total_units,importe_neto,nro_factura,fecha_factura,nro_remito,tipo_transporte,nro_guia,entrega_canal,fecha_entrega,cond_pago,cobrado,items";

async function misPedidos(chat: number, u: Usuario) {
  const [pre, peds] = await Promise.all([
    sel<{ id: number; created_at: string; total_units: number; importe: number }>(
      `catalogo_precarga?cod_cliente=eq.${cod(u)}&estado=eq.pendiente&select=id,created_at,total_units,importe&order=id.desc`),
    sel<Pedido>(`pedidos?cod_cliente=eq.${cod(u)}&select=${COLS_PED}&order=id.desc&limit=8`),
  ]);
  const esp = await sel<{ id: number; created_at: string; estado: string; respuesta: string | null }>(
    `dist_solicitud_especial?cod_cliente=eq.${cod(u)}&estado=in.(abierta,evaluando)&select=id,created_at,estado,respuesta&order=id.desc&limit=5`);
  const r: string[] = [`📋 <b>Pedidos de ${esc(u.distribuidores.nombre)}</b>`, ""];
  for (const p of pre) r.push(`📥 <b>#P${p.id}</b> · ${fecha(p.created_at)} · ${p.total_units} u. · esperando confirmación de Orbital`);
  for (const p of peds) {
    const pend = (p.items ?? []).reduce((a, i) => a + (Number(i.pendiente) || 0), 0);
    r.push(`${ESTADO_PEDIDO[p.estado] ?? p.estado} · <b>#${p.id}</b> · ${fecha(p.fecha || p.created_at)} · ${p.total_units ?? 0} u.` +
      (pend ? ` · falta entregar ${pend}` : "") +
      (esDueno(u) && p.importe_neto ? ` · ${pesos(p.importe_neto)}` : "") +
      (p.nro_factura ? ` · Fact. ${esc(p.nro_factura)}` : ""));
  }
  for (const e of esp) r.push(`✨ Especial <b>#E${e.id}</b> · ${fecha(e.created_at)} · ${e.estado === "evaluando" ? "en evaluación" : "recibido"}${e.respuesta ? ` · ${esc(e.respuesta)}` : ""}`);
  if (r.length === 2) r.push("Todavía no hay pedidos.");
  const botones: Boton[][] = [];
  for (let i = 0; i < peds.length; i += 4) {
    botones.push(peds.slice(i, i + 4).map((p) => ({ text: `#${p.id}`, callback_data: `p|${p.id}` })));
  }
  if (botones.length) r.push("", "Tocá un número para ver el detalle.");
  await enviar(chat, r.join("\n"), botones.length ? botones : undefined);
}

async function detallePedido(chat: number, u: Usuario, id: number) {
  const p = (await sel<Pedido>(`pedidos?id=eq.${id}&cod_cliente=eq.${cod(u)}&select=${COLS_PED}`))[0];
  if (!p) { await enviar(chat, "No encontré ese pedido."); return; }
  const r = [`<b>Pedido #${p.id}</b> · ${ESTADO_PEDIDO[p.estado] ?? p.estado}`, `Fecha: ${fecha(p.fecha || p.created_at)}`];
  if (p.nro_factura) r.push(`Factura: ${esc(p.nro_factura)}${p.fecha_factura ? ` (${fecha(p.fecha_factura)})` : ""}`);
  if (p.nro_remito) r.push(`Remito: ${esc(p.nro_remito)}`);
  if (esDueno(u) && p.importe_neto) r.push(`Importe: ${pesos(p.importe_neto)}${p.cond_pago ? ` · ${esc(p.cond_pago)}` : ""}`);
  r.push("");
  for (const i of p.items ?? []) {
    const pend = Number(i.pendiente) || 0;
    r.push(`• ${esc(i.modelo)} ${esc(i.descripcion)} × ${i.cantidad}${pend ? ` (falta ${pend})` : ""}${i.regalo ? " 🎁" : ""}`);
  }
  await enviar(chat, r.join("\n"));
}

async function envios(chat: number, u: Usuario) {
  const peds = await sel<Pedido>(
    `pedidos?cod_cliente=eq.${cod(u)}&estado=in.(listo,listo_despachar,despachado)&select=${COLS_PED}&order=id.desc&limit=8`);
  if (!peds.length) { await enviar(chat, "🚚 No hay pedidos preparados ni despachados todavía."); return; }
  const guias = peds.map((p) => p.nro_guia).filter(Boolean) as string[];
  const envia = guias.length
    ? await sel<{ tracking_number: string; estado: string; carrier: string; carrier_track_url: string | null }>(
        `envios_envia?tracking_number=in.(${guias.map((g) => `"${g}"`).join(",")})&select=tracking_number,estado,carrier,carrier_track_url`)
    : [];
  const r = ["🚚 <b>Envíos</b>", ""];
  for (const p of peds) {
    const e = envia.find((x) => x.tracking_number === p.nro_guia);
    const como = [p.entrega_canal, p.tipo_transporte].filter(Boolean).join(" · ");
    r.push(`<b>#${p.id}</b> · ${ESTADO_PEDIDO[p.estado] ?? p.estado} · ${p.total_units ?? 0} u.` +
      (p.fecha_entrega ? ` · entrega ${fecha(p.fecha_entrega)}` : "") +
      (como ? `\n   ${esc(como)}` : "") +
      (p.nro_guia ? `\n   Guía: <code>${esc(p.nro_guia)}</code>${e ? ` · ${esc(e.carrier)} ${esc(e.estado)}` : ""}${e?.carrier_track_url ? `\n   ${esc(e.carrier_track_url)}` : ""}` : "") +
      (p.nro_remito ? `\n   Remito ${esc(p.nro_remito)}` : ""));
  }
  await enviar(chat, r.join("\n"));
}

async function cuentaCorriente(chat: number, u: Usuario) {
  if (!esDueno(u)) { await enviar(chat, "La cuenta corriente la ve el titular del distribuidor."); return; }
  const peds = await sel<Pedido>(
    `pedidos?cod_cliente=eq.${cod(u)}&nro_factura=not.is.null&cobrado=is.false&select=${COLS_PED}&order=id.asc`);
  if (!peds.length) { await enviar(chat, "💰 No hay facturas pendientes de cobro."); return; }
  const r = ["💰 <b>Cuenta corriente</b> — facturas pendientes de cobro", ""];
  let total = 0;
  for (const p of peds) {
    total += Number(p.importe_neto) || 0;
    r.push(`• Fact. ${esc(p.nro_factura)} · ${fecha(p.fecha_factura || p.fecha || p.created_at)} · <b>${pesos(p.importe_neto ?? 0)}</b>` +
      (p.cond_pago ? ` · ${esc(p.cond_pago)}` : "") + ` (pedido #${p.id})`);
  }
  r.push("", `<b>Saldo: ${pesos(total)}</b>`, "Si ves una diferencia, consultalo con Administración de Orbital.");
  await enviar(chat, r.join("\n"));
}

// ————— postventa y repuestos —————

const ESTADO_PV: Record<string, string> = { abierto: "📥 Recibido", en_proceso: "🛠 En proceso", resuelto: "✅ Resuelto" };

async function estadoPostventa(chat: number, u: Usuario) {
  const f = await sel<{ id: number; tipo: string; producto: string | null; cantidad: number | null; detalle: string; estado: string; created_at: string }>(
    `optica_postventa?cod_cliente=eq.${cod(u)}&select=id,tipo,producto,cantidad,detalle,estado,created_at&order=id.desc&limit=20`);
  if (!f.length) { await enviar(chat, "🔧 No hay reclamos ni repuestos cargados."); return; }
  const r = ["🔧 <b>Postventa y repuestos</b>", ""];
  for (const x of f) {
    r.push(`${ESTADO_PV[x.estado] ?? x.estado} · <b>#${x.id}</b> · ${fecha(x.created_at)} · ${x.tipo === "repuesto" ? "Repuesto" : "Reclamo"}` +
      (x.producto ? ` · ${esc(x.producto)}` : "") + (x.cantidad ? ` × ${x.cantidad}` : "") +
      `\n   ${esc(x.detalle.slice(0, 120))}`);
  }
  await enviar(chat, r.join("\n"));
}

type Repuesto = { producto: string; cantidad: number; detalle: string };

async function extraerRepuestos(texto: string): Promise<Repuesto[] | null> {
  const sys =
    "Convertís una lista de pedidos de repuestos o arreglos de anteojos en JSON. Devolvé SOLO " +
    '{"items":[{"producto":"modelo y color si lo dice","cantidad":1,"detalle":"qué repuesto o arreglo"}]}. ' +
    "Un item por renglón. Si no dice cantidad, 1. Ignorá saludos.";
  const j = jsonDe(await groq(MODELO_TEXTO, [{ role: "system", content: sys }, { role: "user", content: texto }], 2500, true));
  if (!j || !Array.isArray(j.items)) return null;
  return (j.items as Record<string, unknown>[])
    .map((i) => ({ producto: String(i.producto ?? "").trim(), cantidad: Math.max(1, Math.round(Number(i.cantidad) || 1)), detalle: String(i.detalle ?? "").trim() }))
    .filter((i) => i.producto || i.detalle);
}

async function recibirRepuestos(chat: number, u: Usuario, texto: string, previos: Repuesto[]) {
  await enviar(chat, "⏳ Leyendo la lista…");
  const nuevos = await extraerRepuestos(texto);
  if (!nuevos?.length) { await enviar(chat, "No pude leer repuestos ahí. Mandame un renglón por repuesto, ej:\n<code>ASCARI 038-04 x2 patilla izquierda</code>"); return; }
  const items = [...previos, ...nuevos];
  await guardarEstado(chat, "rep", { items });
  const r = [`🔩 <b>${items.length} pedido${items.length > 1 ? "s" : ""} de repuesto</b>`, ""];
  items.forEach((i, n) => r.push(`${n + 1}. ${esc(i.producto)} × ${i.cantidad}${i.detalle ? ` — ${esc(i.detalle)}` : ""}`));
  r.push("", "Si falta alguno, mandámelo ahora.");
  await enviar(chat, r.join("\n"), [[{ text: "✅ Enviar todo", callback_data: "rep|ok" }], [{ text: "❌ Cancelar", callback_data: "rep|no" }]]);
}

async function confirmarRepuestos(chat: number, u: Usuario, items: Repuesto[]) {
  const lote = `dtg-${Date.now()}`;
  const quien = `Bot distribuidor · ${u.nombre}`;
  const filas = await ins<{ id: number }>("optica_postventa", items.map((i) => ({
    cod_cliente: cod(u), tipo: "repuesto", producto: i.producto || null, cantidad: i.cantidad,
    detalle: i.detalle || "Repuesto", estado: "abierto", solicitado_por: quien, lote,
  })));
  await avisoOjo(
    `🔩 PEDIDO DE REPUESTOS (${filas.length}) — bot distribuidores\nPara: Postventa\n` +
    `Distribuidor: ${u.distribuidores.nombre} (${cod(u)})\nCargó: ${u.nombre} · +${u.telefono}\n` +
    items.map((i, n) => `#${filas[n]?.id} ${i.producto} × ${i.cantidad}${i.detalle ? ` — ${i.detalle}` : ""}`).join("\n") +
    "\nSe gestiona en Orbital Suite → Red de ópticas → Postventa",
  );
  await guardarEstado(chat, null);
  await enviar(chat, `✅ Cargué ${filas.length} pedido${filas.length > 1 ? "s" : ""} de repuesto (#${filas[0].id}${filas.length > 1 ? `–#${filas[filas.length - 1].id}` : ""}). Los seguís en ${B.postventa} → Estado.`, undefined, menu(u));
}

async function crearReclamo(chat: number, u: Usuario, detalle: string, fotos: string[]) {
  const [f] = await ins<{ id: number }>("optica_postventa", {
    cod_cliente: cod(u), tipo: "postventa", detalle, estado: "abierto",
    solicitado_por: `Bot distribuidor · ${u.nombre}`, fotos,
  });
  await espejo(`🔧 RECLAMO #${f.id} — ${u.distribuidores.nombre} (${cod(u)})\nCargó: ${u.nombre}\n${detalle}` +
    (fotos.length ? `\n📷 ${fotos.join("\n")}` : ""), u.id);
  await guardarEstado(chat, null);
  await enviar(chat, `✅ Reclamo <b>#${f.id}</b> cargado. Postventa de Orbital lo revisa; el estado lo ves en ${B.postventa}.`, undefined, menu(u));
}

// ————— vendedores del distribuidor (lo maneja el dueño) —————

async function misVendedores(chat: number, u: Usuario) {
  if (!esDueno(u)) return;
  const f = await sel<{ id: number; nombre: string; telefono: string; chat_id: number | null }>(
    `dist_tg_usuario?distribuidor_id=eq.${u.distribuidor_id}&rol=eq.vendedor&activo=eq.true&select=id,nombre,telefono,chat_id&order=nombre`);
  const r = ["👥 <b>Vendedores con acceso al bot</b>", ""];
  for (const v of f) r.push(`• ${esc(v.nombre)} · ${esc(v.telefono)} · ${v.chat_id ? "conectado" : "todavía no entró"}`);
  if (!f.length) r.push("Todavía no sumaste vendedores.");
  r.push("", "Tus vendedores cargan pedidos y postventa, pero no ven precios ni cuenta corriente.");
  const botones: Boton[][] = [[{ text: "➕ Sumar vendedor", callback_data: "v|add" }]];
  for (const v of f) botones.push([{ text: `🗑 Quitar a ${v.nombre}`, callback_data: `v|del|${v.id}` }]);
  await enviar(chat, r.join("\n"), botones);
}

async function altaVendedor(chat: number, u: Usuario, texto: string) {
  const tel = texto.replace(/\D/g, "");
  const nombre = texto.replace(/[\d+\-()]/g, " ").replace(/\s+/g, " ").trim();
  if (tel.length < 10 || !nombre) {
    await enviar(chat, "Mandame nombre y teléfono con característica, ej:\n<code>Juan Pérez 2231234567</code>");
    return;
  }
  const ya = await sel<{ id: number }>(`dist_tg_usuario?activo=eq.true&telefono=like.*${tel.slice(-10)}&select=id`);
  if (ya.length) { await enviar(chat, "Ese teléfono ya tiene acceso."); return; }
  await ins("dist_tg_usuario", { distribuidor_id: u.distribuidor_id, nombre, telefono: tel, rol: "vendedor", alta_por: u.nombre });
  await guardarEstado(chat, null);
  await enviar(chat, `✅ Listo. ${esc(nombre)} ya puede entrar: que abra este bot, toque /start y comparta su teléfono.`, undefined, menu(u));
  await avisoOjo(`👥 Bot distribuidores: ${u.nombre} (${u.distribuidores.nombre}) sumó al vendedor ${nombre} · +${tel}`, u.id);
}

// ————— webhook —————

type Msg = {
  chat: { id: number; type: string }; from: { id: number; is_bot?: boolean; first_name?: string };
  text?: string; caption?: string; photo?: { file_id: string }[];
  contact?: { phone_number: string; user_id?: number };
  reply_to_message?: { text?: string };
};

async function onMensaje(m: Msg) {
  if (m.from.is_bot) return;
  // En un grupo: alta del grupo interno y, ya dado de alta, hablarle a los distribuidores
  if (m.chat.type !== "private") {
    const crudo = (m.text ?? "").trim();
    const [cmd0, ...resto] = crudo.split(/\s+/);
    const cmd = cmd0?.split("@")[0];
    if (cmd === "/panel") {
      if (resto[0] && resto[0] === (await cfg("dist_telegram_grupo_clave"))) {
        await guardarCfg("dist_telegram_grupo", String(m.chat.id));
        await tg("sendMessage", { chat_id: m.chat.id, text: "✅ Listo: este grupo ve todo lo que pasa en el bot de distribuidores.\n\n/quienes — quién está conectado\n/cristaldo <texto> · /optisur <texto> — al titular de ese distribuidor\n/decile <distribuidor o id> <texto> — a uno\n/aviso <texto> — a todos\nTambién podés responder un mensaje 👁 y le llega a esa persona." });
      } else {
        await tg("sendMessage", { chat_id: m.chat.id, text: "Clave incorrecta." });
      }
      return;
    }
    if (String(m.chat.id) !== (await cfg("dist_telegram_grupo"))) return;

    const escribirle = async (uid: number, texto: string) => {
      const [d] = await sel<{ nombre: string; chat_id: number | null; distribuidores: { nombre: string } }>(
        `dist_tg_usuario?id=eq.${uid}&activo=eq.true&select=nombre,chat_id,distribuidores(nombre)`);
      if (!d?.chat_id) { await tg("sendMessage", { chat_id: m.chat.id, text: "Esa persona todavía no entró al bot." }); return; }
      await enviar(d.chat_id, `📣 <b>Orbital</b>\n\n${esc(texto)}`);
      await tg("sendMessage", { chat_id: m.chat.id, text: `✅ Enviado a ${d.nombre} (${d.distribuidores.nombre}).` });
    };

    if (cmd === "/quienes") {
      const f = await sel<{ id: number; nombre: string; rol: string; chat_id: number | null; distribuidores: { nombre: string } }>(
        "dist_tg_usuario?activo=eq.true&select=id,nombre,rol,chat_id,distribuidores(nombre)&order=distribuidor_id");
      const r = f.map((x) => `#d${x.id} · ${x.nombre} · ${x.distribuidores.nombre} · ${x.rol === "vendedor" ? "vendedor" : "titular"} · ${x.chat_id ? "conectado" : "no entró"}`);
      await tg("sendMessage", { chat_id: m.chat.id, text: "👥 Usuarios del bot\n" + (r.join("\n") || "todavía no hay") + "\n\nPara escribirle: /decile optisur <texto>, /cristaldo <texto> o /decile <id> <texto>" });
      return;
    }
    // Por id (#d2), por nombre del distribuidor (cristaldo) o por nombre de la persona
    const buscarUid = async (quien: string): Promise<number | null> => {
      const n = Number(quien.replace(/\D/g, ""));
      if (/^#?d?\d+$/.test(quien) && n) return n;
      const k = clave(quien);
      if (k.length < 3) return null;
      const f = await sel<{ id: number; nombre: string; rol: string; distribuidores: { nombre: string } }>(
        "dist_tg_usuario?activo=eq.true&chat_id=not.is.null&select=id,nombre,rol,distribuidores(nombre)");
      const porDist = f.filter((x) => clave(x.distribuidores.nombre).startsWith(k) && x.rol !== "admin");
      const titular = porDist.find((x) => x.rol === "dueno");
      if (titular) return titular.id;
      if (porDist.length === 1) return porDist[0].id;
      const porNombre = f.filter((x) => clave(x.nombre).includes(k));
      return porNombre.length === 1 ? porNombre[0].id : null;
    };
    if (cmd === "/decile") {
      const texto = resto.slice(1).join(" ");
      const uid = await buscarUid(String(resto[0] ?? ""));
      if (!uid || !texto) { await tg("sendMessage", { chat_id: m.chat.id, text: "Se usa así: /decile optisur Mañana sale tu pedido\nTambién sirve el id: /decile 2 …" }); return; }
      await escribirle(uid, texto);
      return;
    }
    if (cmd === "/aviso") {
      const texto = resto.join(" ");
      if (!texto) { await tg("sendMessage", { chat_id: m.chat.id, text: "Se usa así: /aviso Esta semana no despachamos el viernes" }); return; }
      const f = await sel<{ chat_id: number }>("dist_tg_usuario?activo=eq.true&chat_id=not.is.null&select=chat_id");
      for (const x of f) await enviar(x.chat_id, `📣 <b>Orbital</b>\n\n${esc(texto)}`);
      await tg("sendMessage", { chat_id: m.chat.id, text: `✅ Enviado a ${f.length} ${f.length === 1 ? "persona" : "personas"}.` });
      return;
    }
    // /cristaldo <texto>, /optisur <texto>: derecho al titular de ese distribuidor
    if (cmd?.startsWith("/") && resto.length) {
      const uid = await buscarUid(cmd.slice(1));
      if (uid) { await escribirle(uid, resto.join(" ")); return; }
    }
    // Responder un 👁 del bot: le llega a esa persona
    const ref = m.reply_to_message?.text ?? "";
    const marca = ref.match(/#d(\d+)/);
    if (marca && crudo) await escribirle(Number(marca[1]), crudo);
    return;
  }
  const chat = m.chat.id;

  // Alta por teléfono: solo vale el contacto propio
  if (m.contact) {
    if (m.contact.user_id !== m.from.id) { await enviar(chat, "Tocá el botón para compartir TU teléfono.", undefined, PEDIR_TEL); return; }
    const tel = m.contact.phone_number.replace(/\D/g, "").slice(-10);
    const f = await sel<{ id: number; nombre: string; rol: string; distribuidores: { nombre: string } }>(
      `dist_tg_usuario?activo=eq.true&telefono=like.*${tel}&select=id,nombre,rol,distribuidores(nombre)`);
    if (f.length !== 1) {
      await enviar(chat, "Tu teléfono no figura como distribuidor de Orbital. Si trabajás con un distribuidor, pedile al titular que te sume desde el bot.");
      await avisoOjo(`👥 Bot distribuidores: intentó entrar un teléfono que no figura: +${m.contact.phone_number.replace(/\D/g, "")} (${m.from.first_name ?? ""})`);
      return;
    }
    await upd("dist_tg_usuario", `id=eq.${f[0].id}`, { telegram_user_id: m.from.id, chat_id: chat, vinculado_at: new Date().toISOString() });
    const dueno = esDueno(f[0]);
    await enviar(chat,
      `👋 Hola ${esc(f[0].nombre)}, ya estás conectado como ${dueno ? "titular" : "vendedor"} de <b>${esc(f[0].distribuidores.nombre)}</b>.\n\n` +
      `Por acá podés:\n• cargar pedidos (texto o foto)\n• ver tus pedidos y envíos\n${dueno ? "• ver tu cuenta corriente\n" : ""}` +
      `• pedir mercadería fuera de stock (pedido especial)\n• cargar postventa y varios repuestos de una vez` +
      (dueno ? "\n• sumar a tus vendedores" : ""),
      undefined, menu(f[0]));
    await avisoOjo(`👥 Bot distribuidores: se conectó ${f[0].nombre} (${dueno ? "titular" : "vendedor"} de ${f[0].distribuidores.nombre})`);
    return;
  }

  const u = await usuarioPorTelegram(m.from.id);
  if (!u) {
    await enviar(chat, "👋 Este es el bot de Orbital para distribuidores. Para entrar, compartí tu teléfono.", undefined, PEDIR_TEL);
    return;
  }
  const texto = (m.text ?? m.caption ?? "").trim();
  const dueno = esDueno(u);

  // botones del menú: siempre cortan lo que estaba a medias
  if (texto === "/start" || texto === "/menu") { await guardarEstado(chat, null); await enviar(chat, "¿Qué necesitás?", undefined, menu(u)); return; }
  if (texto === B.cargar) {
    await guardarEstado(chat, "pedido", { lineas: [] });
    await enviar(chat, "📦 Escribí el pedido abajo, en el cuadro de mensaje (o mandá una foto). Un renglón por artículo, ej:\n<code>ASCARI 038-04 x5\nPALERMO negro brillo polarizado x10</code>");
    return;
  }
  const miro = (que: string) => espejo(`🔎 ${u.nombre} (${u.distribuidores.nombre}) consultó ${que}`, u.id);
  if (texto === B.pedidos) { await guardarEstado(chat, null); await misPedidos(chat, u); await miro("sus pedidos"); return; }
  if (texto === B.envios) { await guardarEstado(chat, null); await envios(chat, u); await miro("envíos"); return; }
  if (texto === B.cc) { await guardarEstado(chat, null); await cuentaCorriente(chat, u); await miro("la cuenta corriente"); return; }
  if (texto === B.especial) {
    await guardarEstado(chat, "especial");
    await enviar(chat, "✨ Contame qué necesitás que no está en stock ni en el proyectado (modelo, color, cantidad, para cuándo). Podés mandar una foto.");
    return;
  }
  if (texto === B.postventa) {
    await guardarEstado(chat, null);
    await enviar(chat, "🔧 Postventa", [
      [{ text: "📝 Cargar un reclamo", callback_data: "pv|rec" }],
      [{ text: "🔩 Pedir repuestos (varios juntos)", callback_data: "pv|rep" }],
      [{ text: "📋 Estado de postventa", callback_data: "pv|est" }],
    ]);
    return;
  }
  if (texto === B.vendedores && dueno) { await guardarEstado(chat, null); await misVendedores(chat, u); return; }
  if (texto === B.cambiar && esAdmin(u)) {
    await guardarEstado(chat, null);
    const ds = await sel<{ id: number; nombre: string }>("distribuidores?activo=eq.true&select=id,nombre&order=id");
    await enviar(chat, `Estás en <b>${esc(u.distribuidores.nombre)}</b>. ¿A cuál pasás?`,
      ds.map((d) => [{ text: `${d.id === u.distribuidor_id ? "● " : ""}${d.nombre}`, callback_data: `d|${d.id}` }]));
    return;
  }

  const est = await leerEstado(chat);
  const foto = m.photo?.length ? m.photo[m.photo.length - 1].file_id : null;

  if (est.paso === "pedido") {
    const previas = (est.data.lineas as Linea[]) ?? [];
    if (foto) {
      const b = await bajarFoto(foto);
      const leido = b ? await leerFoto(b, LEER_PEDIDO) : "";
      if (!leido) { await enviar(chat, "No pude leer la foto. Probá con otra más nítida o mandalo escrito."); return; }
      await recibirPedido(chat, u, leido + (texto ? `\n${texto}` : ""), previas);
      return;
    }
    if (texto) { await recibirPedido(chat, u, texto, previas); return; }
  }
  if (est.paso === "rep") {
    const previos = (est.data.items as Repuesto[]) ?? [];
    if (foto) {
      const b = await bajarFoto(foto);
      const leido = b ? await leerFoto(b, LEER_REPUESTOS) : "";
      if (!leido) { await enviar(chat, "No pude leer la foto. Probá con otra o mandalo escrito."); return; }
      await recibirRepuestos(chat, u, leido + (texto ? `\n${texto}` : ""), previos);
      return;
    }
    if (texto) { await recibirRepuestos(chat, u, texto, previos); return; }
  }
  if (est.paso === "pv") {
    const fotos = (est.data.fotos as string[]) ?? [];
    if (foto) {
      const b = await bajarFoto(foto);
      const url = b ? await subirFoto(b, cod(u)) : null;
      if (url) fotos.push(url);
      if (!texto) {
        await guardarEstado(chat, "pv", { fotos });
        await enviar(chat, `📷 Foto guardada (${fotos.length}). Ahora contame qué pasó: modelo, color y el problema.`);
        return;
      }
    }
    if (texto) { await crearReclamo(chat, u, texto, fotos); return; }
  }
  if (est.paso === "especial") {
    let detalle = texto;
    if (foto) {
      const b = await bajarFoto(foto);
      const url = b ? await subirFoto(b, cod(u)) : null;
      detalle = [texto, url ? `📷 ${url}` : ""].filter(Boolean).join("\n");
    }
    if (detalle) {
      const id = await crearEspecial(u, detalle);
      await guardarEstado(chat, null);
      await enviar(chat, `✨ Pedido especial <b>#E${id}</b> recibido. Orbital lo evalúa y te avisa; lo ves en ${B.pedidos}.`, undefined, menu(u));
      return;
    }
  }
  if (est.paso === "alta_vend" && dueno && texto) { await altaVendedor(chat, u, texto); return; }

  // Sin paso: si parece un pedido, lo toma como pedido
  if (foto || /\d/.test(texto)) {
    await guardarEstado(chat, "pedido", { lineas: [] });
    if (foto) {
      const b = await bajarFoto(foto);
      const leido = b ? await leerFoto(b, LEER_PEDIDO) : "";
      if (leido) { await recibirPedido(chat, u, leido + (texto ? `\n${texto}` : ""), []); return; }
    } else { await recibirPedido(chat, u, texto, []); return; }
  }
  // No entendió: lo pasa al grupo interno, donde se le puede contestar respondiendo el 👁
  if (texto) await espejo(`💬 ${u.nombre} (${u.distribuidores.nombre}) escribió: "${texto}"`, u.id);
  await enviar(chat, "Elegí una opción del menú de abajo 👇", undefined, menu(u));
}

async function onCallback(q: { id: string; from: { id: number }; message?: { chat: { id: number }; message_id: number }; data?: string }) {
  const chat = q.message?.chat.id;
  const u = await usuarioPorTelegram(q.from.id);
  if (!chat || !u) { await responderCallback(q.id); return; }
  const [acc, a1, a2] = (q.data ?? "").split("|");
  const est = await leerEstado(chat);
  // Botones de pedido/color/repuestos: se usan una sola vez
  const sacarBotones = () =>
    tg("editMessageReplyMarkup", { chat_id: chat, message_id: q.message!.message_id, reply_markup: { inline_keyboard: [] } });
  if (["col", "ped", "rep"].includes(acc)) {
    const abierto = acc === "rep" ? est.paso === "rep" : est.paso === "pedido";
    if (!abierto) { await responderCallback(q.id, "Eso ya se envió"); await sacarBotones(); return; }
    await sacarBotones();
  }
  await responderCallback(q.id);

  if (acc === "col") {
    const lineas = (est.data.lineas as Linea[]) ?? [];
    const l = lineas[Number(a1)];
    if (!l) return;
    if (a2 === "x") l.estado = "nf";
    else {
      const s = (l.opciones ?? []).find((o) => o.codigo === a2);
      if (s) { l.estado = "ok"; l.sku = s; }
    }
    l.opciones = undefined;
    await seguirPedido(chat, u, lineas);
    return;
  }
  if (acc === "ped") {
    if (a1 === "no") { await guardarEstado(chat, null); await enviar(chat, "Pedido cancelado.", undefined, menu(u)); return; }
    const lineas = (est.data.lineas as Linea[]) ?? [];
    if (!lineas.length) return;
    if (lineas.some((l) => l.estado === "amb")) { await seguirPedido(chat, u, lineas); return; }
    await guardarEstado(chat, "pedido_confirmando", {}); // evita doble toque
    await confirmarPedido(chat, u, lineas);
    return;
  }
  if (acc === "p") { await detallePedido(chat, u, Number(a1)); return; }
  if (acc === "d" && esAdmin(u)) {
    await upd("dist_tg_usuario", `id=eq.${u.id}`, { distribuidor_id: Number(a1) });
    await guardarEstado(chat, null);
    const nuevo = await usuarioPorTelegram(q.from.id);
    await enviar(chat, `🔄 Ahora estás en <b>${esc(nuevo?.distribuidores.nombre)}</b> (${esc(nuevo?.distribuidores.cod_cliente)}).`, undefined, menu(u));
    return;
  }
  if (acc === "pv") {
    if (a1 === "rec") { await guardarEstado(chat, "pv", { fotos: [] }); await enviar(chat, "📝 Contame el reclamo: modelo, color y qué pasó. Podés mandar fotos."); }
    if (a1 === "rep") { await guardarEstado(chat, "rep", { items: [] }); await enviar(chat, "🔩 Escribí abajo, en el cuadro de mensaje, todos los repuestos juntos: un renglón por cada uno (o mandá una foto de la lista), ej:\n<code>ASCARI 038-04 x2 patilla izquierda\nPALERMO negro x1 bisagra</code>"); }
    if (a1 === "est") { await estadoPostventa(chat, u); await espejo(`🔎 ${u.nombre} (${u.distribuidores.nombre}) consultó el estado de postventa`); }
    return;
  }
  if (acc === "rep") {
    if (a1 === "no") { await guardarEstado(chat, null); await enviar(chat, "Cancelado.", undefined, menu(u)); return; }
    const items = (est.data.items as Repuesto[]) ?? [];
    if (!items.length) return;
    await guardarEstado(chat, "rep_confirmando", {});
    await confirmarRepuestos(chat, u, items);
    return;
  }
  if (acc === "v" && esDueno(u)) {
    if (a1 === "add") { await guardarEstado(chat, "alta_vend"); await enviar(chat, "Mandame nombre y teléfono del vendedor, ej:\n<code>Juan Pérez 2231234567</code>"); }
    if (a1 === "del") {
      await upd("dist_tg_usuario", `id=eq.${Number(a2)}&distribuidor_id=eq.${u.distribuidor_id}&rol=eq.vendedor`, { activo: false });
      await misVendedores(chat, u);
    }
  }
}

Deno.serve(async (req) => {
  const url = new URL(req.url);

  // Conecta el webhook sin que el token pase por ningún lado
  if (url.searchParams.get("tarea") === "setup") {
    if (!req.headers.get("x-cron-key") || req.headers.get("x-cron-key") !== (await cfg("cron_key"))) return new Response("no", { status: 401 });
    if (!(await token())) return Response.json({ ok: false, error: "falta dist_telegram_bot_token en app_config" });
    let secreto = await cfg("dist_telegram_webhook_secret");
    if (!secreto) { secreto = crypto.randomUUID().replace(/-/g, ""); await guardarCfg("dist_telegram_webhook_secret", secreto); }
    const hook = await tg("setWebhook", {
      url: `${SUPABASE_URL}/functions/v1/dist-telegram`, secret_token: secreto,
      allowed_updates: ["message", "callback_query"],
    });
    const me = await tg("getMe", {});
    return Response.json({ webhook: hook, bot: me?.result?.username });
  }

  if (req.method !== "POST") return new Response("ok");
  const secreto = await cfg("dist_telegram_webhook_secret");
  if (!secreto || req.headers.get("x-telegram-bot-api-secret-token") !== secreto) return new Response("no", { status: 401 });

  const up = await req.json().catch(() => null);
  try {
    if (up?.message) await onMensaje(up.message);
    else if (up?.callback_query) await onCallback(up.callback_query);
  } catch (e) {
    console.error("dist-telegram", String(e));
    const chat = up?.message?.chat?.id ?? up?.callback_query?.message?.chat?.id;
    if (chat) await enviar(chat, "Uy, algo falló de mi lado. Probá de nuevo en un rato.");
  }
  return new Response("ok");
});
