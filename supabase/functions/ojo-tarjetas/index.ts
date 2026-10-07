import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// ojo-tarjetas — tarjetas de un toque en el grupo de Ojo para todo lo que tiene que hacer alguien del equipo.
// Pedido de Gastón (2026-09-30): "generalas en cada acción que puedas, con un toque se genera la acción".
//   ?tarea=tick   (cron cada 5 min, L-S 8-20 ART) arma las tarjetas nuevas, sincroniza con la Suite,
//                 recuerda al responsable y escala a los admins lo que queda colgado.
//   ?tarea=estado resumen de tarjetas abiertas (no manda nada).
//   POST {update} ojo-conteo le reenvía los botones tj:* y las respuestas a una tarjeta.
// Tipos:
//   deriv   🆘 de IRIS          → 🙋 Lo tomo · ✅ Ya le respondí · ➡️ Pasar a… (solo admins)       → derivaciones
//   carrito 🛒 carrito sin cerrar → 📞 Lo llamé (→ ¿cómo quedó?) · 📥 A precarga · 🚫 No va          → clientes/actividad
//   agenda  📍 visitas del día   → por visita ✅ visité · 🛒 vendió · 🚪 no estaba · 📅 mañana      → agenda_campo/turnos + actividad_diaria
//   pedido  📦 pedido B2B nuevo  → botón al paso siguiente (preparación, listo, falta stock, despachado) → pedidos.estado
//   reunion 🤝 reunión que ya pasó → ¿cómo fue? (compra, catálogo, lo piensa, no va, no se hizo)    → clientes/actividad
// Los resultados "va a comprar / catálogo / lo piensa" programan un seguimiento que vuelve como tarjeta.
// Responder una tarjeta con texto la anota en la ficha del cliente (o en obs_deposito si es un pedido).

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TG = `https://api.telegram.org/bot${Deno.env.get("TELEGRAM_BOT_TOKEN")!}`;
const GRUPO = -5504692394;
const sb = createClient(SUPABASE_URL, SERVICE_KEY);
const H = 3600e3, DIA = 24 * H;

const NOMBRE: Record<string, string> = { Adrian: "Adrián", Bruno: "Bruno", Lola: "Lola", Mauro: "Mauro", Postventa: "Postventa", Administracion: "Administración", Deposito: "Depósito", Gaston: "Gastón", Corporativo: "Gastón" };
const COLOR: Record<string, string> = { Adrian: "🟢", Bruno: "🔵", Lola: "🟣", Mauro: "🟠", Gaston: "⚫", Corporativo: "⚫", Administracion: "🟤", Postventa: "⚪" };
// cuándo recordar / escalar, por tipo (horas)
const PLAZOS: Record<string, [number, number]> = { deriv: [1, 4], carrito: [3, 24], reunion: [3, 24], pedido: [24, 48], seguimiento: [3, 24] };
const TRANSPORTES = ["Moto", "Expreso / Transporte", "Comisionista", "Retira el cliente", "Correo", "Otro"];
const MOTIVO: Record<string, string> = {
  acceso_catalogo: "pide el catálogo", cierre_pedido: "quiere cerrar un pedido", friccion_bot: "se trabó con IRIS", iris_deriva: "IRIS lo pasa",
  lead_propuesta: "lead con propuesta", optica_tienda: "óptica desde la tienda", postventa_repuesto: "postventa / repuesto", precio_mayorista: "pide precios",
  reclamo_excepcion: "reclamo", recuperar_llamada: "recuperar (llamada)", sin_segmento: "no dijo qué es", pide_vendedor: "pide un vendedor",
  pagos_cobranza: "pagos / cobranza", entrega: "entrega", revendedor: "revendedor", llm_error: "IRIS no pudo contestar",
};

const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const horaAR = (d = new Date()) => new Date(d.getTime() - 3 * H);
const hhmm = (d = new Date()) => horaAR(d).toISOString().slice(11, 16);
const hoyAR = () => horaAR().toISOString().slice(0, 10);
const ddmm = (d = new Date()) => { const a = horaAR(d).toISOString(); return `${a.slice(8, 10)}/${a.slice(5, 7)}`; };
const iso = (ms: number) => new Date(ms).toISOString();
// Solo celulares argentinos (54 9 + 10 dígitos); un fijo o dos números pegados no llevan link.
const wa = (tel: string | null | undefined) => {
  let d = String(tel ?? "").replace(/\D/g, "").replace(/^0/, "");
  if (d.startsWith("54") && !d.startsWith("549") && d.length === 12) d = "549" + d.slice(2);
  else if (d.length === 10) d = "549" + d;
  else if (d.length === 11 && d.startsWith("15")) return "";
  return /^549\d{10}$/.test(d) ? `wa.me/${d}` : "";
};

async function cfg(clave: string): Promise<string | null> {
  const { data } = await sb.from("app_config").select("valor").eq("clave", clave).maybeSingle();
  return data?.valor ?? null;
}
let _ids: Record<string, number[]> | null = null;
async function ids(): Promise<Record<string, number[]>> {
  if (!_ids) { try { _ids = JSON.parse(await cfg("tarjetas_tg") ?? "{}"); } catch { _ids = {}; } }
  return _ids!;
}
async function admins(): Promise<number[]> {
  const { data } = await sb.from("ojo_admins").select("telegram_user_id");
  return (data ?? []).map((a) => Number(a.telegram_user_id));
}
async function tg(metodo: string, body: Record<string, unknown>) {
  const r = await fetch(`${TG}/${metodo}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (!d?.ok && !String(d?.description ?? "").includes("not modified")) console.error(metodo, JSON.stringify(d));
  return d;
}
async function enviar(chatId: number, text: string, extra: Record<string, unknown> = {}) {
  const d = await tg("sendMessage", { chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true, ...extra });
  if (d?.ok) await sb.from("ojo_mensajes_log").insert({ telegram_chat_id: chatId, telegram_message_id: d.result.message_id, autor_nombre: "Ojo", texto: text.slice(0, 4000), es_del_bot: true });
  return d;
}
async function mencion(cod: string | null) {
  const c = cod ?? "";
  const id = (await ids())[c === "Corporativo" ? "Gaston" : c]?.[0];
  const n = `${COLOR[c] ?? ""} ${NOMBRE[c] ?? c}`.trim();
  return id ? `<a href="tg://user?id=${id}">${esc(n)}</a>` : esc(n);
}
type Btn = { text: string; callback_data: string };
const kb = (filas: Btn[][]) => ({ inline_keyboard: filas });

type Tarjeta = {
  id: number; tipo: string; ref: string; vendedor: string | null; chat_id: number | null; message_id: number | null;
  estado: string; paso: string | null; datos: Record<string, any>; espera_desde: string | null; espera_msg: number | null;
  recordado_at: string | null; escalado_at: string | null; seguimiento_at: string | null; resultado: string | null; creado_en: string;
};
async function guardar(id: number, cambios: Record<string, unknown>) { await sb.from("ojo_tarjeta").update(cambios).eq("id", id); }
async function refrescar(t: Tarjeta) {
  if (!t.chat_id || !t.message_id) return;
  const { texto, teclado } = await render(t);
  await tg("editMessageText", { chat_id: t.chat_id, message_id: t.message_id, text: texto, parse_mode: "HTML", disable_web_page_preview: true, reply_markup: teclado ?? kb([]) });
}
// Ojo por tema (2026-09-30): cada tarjeta va al grupo de su tema (ojo_temas); si todavía no se creó, al general.
async function temaDe(tipo: string, ref: string): Promise<string> {
  if (tipo === "deriv") { const { data } = await sb.rpc("ojo_tema_derivacion", { p_derivacion: ref }); return String(data ?? "ventas"); }
  return tipo === "pedido" ? "deposito" : "ventas";
}
async function chatTema(tema: string): Promise<number> {
  const { data } = await sb.rpc("ojo_chat_tema", { p_tema: tema });
  return Number(data) || GRUPO;
}
const chatDe = async (tipo: string, ref: string) => chatTema(await temaDe(tipo, ref));

async function crear(tipo: string, ref: string, vendedor: string | null, datos: Record<string, any>, replyTo?: number | null, paso: string | null = null) {
  const { data, error } = await sb.from("ojo_tarjeta").insert({ tipo, ref, vendedor, datos, paso }).select().single();
  if (error) return null; // ya existía (unique tipo+ref)
  const t = data as Tarjeta;
  const chat = await chatDe(tipo, ref);
  const { texto, teclado } = await render(t);
  const d = await enviar(chat, texto, { reply_markup: teclado ?? kb([]), ...(replyTo ? { reply_to_message_id: replyTo, allow_sending_without_reply: true } : {}) });
  if (!d?.ok) { await sb.from("ojo_tarjeta").delete().eq("id", t.id); return null; }
  await guardar(t.id, { chat_id: chat, message_id: d.result.message_id, espera_desde: new Date().toISOString() });
  return t.id;
}

// Cuando se crea el grupo de un tema, sus tarjetas abiertas se mudan ahí (la vieja queda con la nota, sin botones).
async function tareaMover(tema: string) {
  const destino = await chatTema(tema);
  const { data } = await sb.from("ojo_tarjeta").select("*").in("estado", ["abierta", "seguimiento"]).order("creado_en");
  const { data: t0 } = await sb.from("ojo_temas").select("emoji, label").eq("tema", tema).maybeSingle();
  let n = 0;
  for (const t of (data ?? []) as Tarjeta[]) {
    if (t.chat_id === destino || (await temaDe(t.tipo, t.ref)) !== tema) continue;
    const { texto, teclado } = await render(t);
    const d = await enviar(destino, texto, { reply_markup: teclado ?? kb([]) });
    if (!d?.ok) continue;
    if (t.chat_id && t.message_id) {
      const viejo = await render({ ...t, estado: "cerrada" });
      await tg("editMessageText", { chat_id: t.chat_id, message_id: t.message_id, text: `${viejo.texto}\n\n➡️ <i>Pasó al grupo ${esc(t0?.emoji ?? "")} ${esc(t0?.label ?? tema)}</i>`, parse_mode: "HTML", disable_web_page_preview: true, reply_markup: kb([]) });
    }
    await guardar(t.id, { chat_id: destino, message_id: d.result.message_id });
    n++;
  }
  return { tema, movidas: n };
}

// ---------- ficha del cliente ----------
async function anotarCliente(cod: string | null, linea: string, extra: Record<string, unknown> = {}) {
  if (!cod) return false;
  const { data } = await sb.from("clientes").select("nota").eq("cod", cod).maybeSingle();
  if (!data) return false;
  await sb.from("clientes").update({ nota: `${data.nota ?? ""}\n${linea}`.trim(), ...extra }).eq("cod", cod);
  return true;
}
async function actividad(cod: string | null, vendedor: string | null, origen: string, resultado: string, texto: string, nombre?: string | null) {
  if (!cod || !vendedor) return;
  await sb.from("actividad_diaria").insert({ fecha: hoyAR(), vendedor, cod_cliente: cod, nombre_comercio: nombre ?? null, origen, resultado_contacto: resultado, actividad_desarrollo: texto });
}

// Resultado de una charla (carrito llamado, reunión, seguimiento): qué se anota y cuándo se vuelve a preguntar.
const RES: Record<string, { txt: string; paso?: string; dias?: number; cierra?: boolean }> = {
  ya: { txt: "✅ Compró", cierra: true },
  cmp: { txt: "🛒 Va a comprar", paso: "Cerrar pedido", dias: 2 },
  cat: { txt: "📖 Le mandó catálogo", paso: "Seguimiento del catálogo", dias: 3 },
  pie: { txt: "🤔 Lo piensa", paso: "Volver a llamar", dias: 5 },
  no: { txt: "🚫 No va", cierra: true },
  nh: { txt: "📅 No se hizo", paso: "Reprogramar reunión", dias: 1 },
};
const PREG: Record<string, string> = { cmp: "¿Se cerró el pedido?", cat: "¿Vio el catálogo? ¿Qué te dijo?", pie: "¿Ya lo decidió?", nh: "¿Se reprogramó la reunión?" };
const tecladoRes = (id: number, reunion = false): Btn[][] => [
  [{ text: "✅ Compró", callback_data: `tj:${id}:r:ya` }, { text: "🛒 Va a comprar", callback_data: `tj:${id}:r:cmp` }],
  [{ text: "📖 Le mandé catálogo", callback_data: `tj:${id}:r:cat` }, { text: "🤔 Lo piensa", callback_data: `tj:${id}:r:pie` }],
  [{ text: "🚫 No va", callback_data: `tj:${id}:r:no` }, ...(reunion ? [{ text: "📅 No se hizo", callback_data: `tj:${id}:r:nh` }] : [])],
];

// ---------- cómo se ve cada tarjeta ----------
async function render(t: Tarjeta): Promise<{ texto: string; teclado?: ReturnType<typeof kb> }> {
  const d = t.datos ?? {};
  const para = await mencion(t.vendedor);
  const pie = d.historial?.length ? `\n\n${(d.historial as string[]).map(esc).join("\n")}` : "";
  const cerrada = t.estado === "cerrada";

  if (t.tipo === "deriv") {
    const cab = `🆘 Para: ${para} · ${esc(MOTIVO[d.motivo] ?? d.motivo ?? "consulta")}\n<b>${esc(d.nombre || "Cliente")}</b>${d.tel ? ` · ${wa(d.tel)}` : ""}\n📝 ${esc(String(d.resumen ?? "").slice(0, 350))}`;
    if (cerrada) return { texto: cab + pie };
    if (t.paso === "menu") {
      const vs = ["Adrian", "Bruno", "Lola", "Mauro", "Postventa", "Administracion", "Gaston"].filter((v) => v !== t.vendedor);
      const filas: Btn[][] = [];
      for (let i = 0; i < vs.length; i += 3) filas.push(vs.slice(i, i + 3).map((v) => ({ text: `${COLOR[v] ?? ""} ${NOMBRE[v]}`.trim(), callback_data: `tj:${t.id}:a:${v}` })));
      filas.push([{ text: "↩ Volver", callback_data: `tj:${t.id}:back` }]);
      return { texto: cab + pie + "\n\n¿A quién se lo paso?", teclado: kb(filas) };
    }
    const filas: Btn[][] = t.paso === "tomada"
      ? [[{ text: "✅ Ya le respondí", callback_data: `tj:${t.id}:resp` }, { text: "➡️ Pasar a…", callback_data: `tj:${t.id}:menu` }]]
      : [[{ text: "🙋 Lo tomo", callback_data: `tj:${t.id}:tomo` }, { text: "✅ Ya le respondí", callback_data: `tj:${t.id}:resp` }], [{ text: "➡️ Pasar a…", callback_data: `tj:${t.id}:menu` }]];
    return { texto: cab + pie, teclado: kb(filas) };
  }

  if (t.tipo === "carrito") {
    const cab = `🛒 Para: ${para} · carrito sin cerrar\n<b>${esc(d.razon ?? d.cod)}</b> (${esc(d.cod)})\n${d.unidades} u.: ${esc(String(d.modelos ?? "").slice(0, 200))}${d.wa ? `\n📲 ${wa(d.wa)}` : ""}`;
    if (cerrada) return { texto: cab + pie };
    if (t.paso === "resultado") return { texto: cab + pie + "\n\n¿Cómo quedó? 👇", teclado: kb(tecladoRes(t.id)) };
    return { texto: cab + pie + "\n\nLlamalo y marcá 👇", teclado: kb([[{ text: "📞 Lo llamé", callback_data: `tj:${t.id}:llame` }, { text: "📥 A precarga", callback_data: `tj:${t.id}:prc` }], [{ text: "🚫 No va", callback_data: `tj:${t.id}:r:no` }]]) };
  }

  if (t.tipo === "reunion") {
    const cab = `🤝 Para: ${para} · reunión del ${esc(d.fecha_txt)}\n<b>${esc(d.cliente)}</b>${d.cod ? ` (${esc(d.cod)})` : ""}${d.conseguida_por ? ` · la consiguió ${esc(d.conseguida_por)}` : ""}`;
    if (cerrada) return { texto: cab + pie };
    return { texto: cab + pie + "\n\n¿Cómo fue? 👇", teclado: kb(tecladoRes(t.id, true)) };
  }

  if (t.tipo === "pedido") {
    const est = d.estado as string;
    const ETQ: Record<string, string> = { pendiente: "🕐 pendiente", en_preparacion: "🔧 en preparación", observado: "⚠️ observado", listo: "✅ listo — falta facturar", facturado: "🧾 facturado", listo_despachar: "📦 listo para despachar", despachado: "🚚 despachado", anulado: "❌ anulado" };
    const quien = ["listo", "facturado"].includes(est) ? await mencion("Administracion") : await mencion("Deposito");
    const cab = `📦 Pedido <b>#${t.ref}</b> · ${esc(d.cliente)}\n${d.unidades} u. · vendedor ${esc(NOMBRE[d.vendedor] ?? d.vendedor)}\nEstado: <b>${ETQ[est] ?? est}</b>${d.obs ? `\n⚠️ ${esc(d.obs)}` : ""}`;
    if (cerrada) return { texto: cab + pie };
    if (t.paso === "transporte") {
      const filas: Btn[][] = [];
      for (let i = 0; i < TRANSPORTES.length; i += 2) filas.push(TRANSPORTES.slice(i, i + 2).map((x, j) => ({ text: x, callback_data: `tj:${t.id}:dt:${i + j}` })));
      filas.push([{ text: "↩ Volver", callback_data: `tj:${t.id}:back` }]);
      return { texto: cab + pie + "\n\n¿Cómo sale?", teclado: kb(filas) };
    }
    const b: Record<string, Btn[][]> = {
      pendiente: [[{ text: "🔧 A preparación", callback_data: `tj:${t.id}:e:en_preparacion` }, { text: "⚠️ Falta stock", callback_data: `tj:${t.id}:fs` }]],
      en_preparacion: [[{ text: "✅ Listo", callback_data: `tj:${t.id}:e:listo` }, { text: "⚠️ Falta stock", callback_data: `tj:${t.id}:fs` }]],
      observado: [[{ text: "🔧 Retomar preparación", callback_data: `tj:${t.id}:e:en_preparacion` }]],
      facturado: [[{ text: "📦 Listo para despachar", callback_data: `tj:${t.id}:e:listo_despachar` }]],
      listo_despachar: [[{ text: "🚚 Despachado", callback_data: `tj:${t.id}:desp` }]],
    };
    const nota = est === "listo" ? `\n\n👉 ${quien}: facturalo en la Suite (número de factura e importe).` : `\n\n👉 ${quien}`;
    return { texto: cab + pie + nota, teclado: b[est] ? kb(b[est]) : undefined };
  }

  if (t.tipo === "agenda") {
    const items = (d.items ?? []) as any[];
    const EMO: Record<string, string> = { visito: "✅", vendio: "🛒", no_estaba: "🚪", reagendar: "📅" };
    const lineas = items.map((it, i) => `${i + 1}. ${it.st ? EMO[it.st] + " " : ""}<b>${esc(it.nombre)}</b>${it.loc ? ` — ${esc(it.loc)}` : ""}${it.k === "t" ? " · turno" : ""}${!it.st && it.tel ? ` · ${wa(it.tel)}` : ""}`);
    const faltan = items.filter((it) => !it.st).length;
    const cab = `📍 Para: ${para} · visitas del ${esc(d.fecha_txt)}\n\n${lineas.join("\n")}`;
    if (cerrada || !faltan) return { texto: cab + (faltan ? "" : "\n\n✔️ Día registrado. ¡Gracias!") };
    const filas: Btn[][] = [];
    items.forEach((it, i) => {
      if (it.st) return;
      const n = i + 1;
      filas.push([{ text: `${n} ✅`, callback_data: `tj:${t.id}:v:${i}:visito` }, { text: `${n} 🛒`, callback_data: `tj:${t.id}:v:${i}:vendio` }, { text: `${n} 🚪`, callback_data: `tj:${t.id}:v:${i}:no_estaba` }, { text: `${n} 📅`, callback_data: `tj:${t.id}:v:${i}:reagendar` }]);
    });
    return { texto: cab + "\n\n✅ visité · 🛒 vendió · 🚪 no estaba · 📅 pasa a mañana", teclado: kb(filas) };
  }
  return { texto: "?" };
}

// ---------- detectar lo nuevo ----------
async function nuevasDeriv(desde: string) {
  const { data } = await sb.from("derivaciones").select("id, conversacion_id, motivo, resumen, estado, asignado_a, created_at")
    .eq("estado", "pendiente").gte("created_at", iso(new Date(desde).getTime() - 3 * DIA)).order("created_at");
  const rows = data ?? [];
  if (!rows.length) return 0;
  const { data: ya } = await sb.from("ojo_tarjeta").select("ref").eq("tipo", "deriv").in("ref", rows.map((r) => r.id));
  const hay = new Set((ya ?? []).map((x) => x.ref));
  const { data: vs } = await sb.from("vendedores").select("id, codigo");
  const cod = new Map((vs ?? []).map((v) => [v.id, v.codigo]));
  let n = 0;
  for (const r of rows) {
    if (hay.has(r.id)) continue;
    const vendedor = cod.get(r.asignado_a) ?? "Gaston";
    const { data: c } = await sb.from("at_conversaciones").select("contactos(nombre, telefono, cod_cliente)").eq("id", r.conversacion_id).maybeSingle();
    const k = (c as any)?.contactos ?? {};
    const { data: h } = await sb.from("ojo_hilos").select("telegram_message_id").eq("conversacion_id", r.conversacion_id).eq("telegram_chat_id", await chatDe("deriv", r.id)).order("creado_en", { ascending: false }).limit(1);
    if (await crear("deriv", r.id, vendedor, { motivo: r.motivo, resumen: r.resumen, nombre: k.nombre, tel: k.telefono, cod: k.cod_cliente, conversacion_id: r.conversacion_id }, h?.[0]?.telegram_message_id, "pendiente")) n++;
  }
  return n;
}

async function nuevosCarritos() {
  const { data } = await sb.rpc("carrito_abandonado_lista", { p_desde: "3 days", p_hasta: "2 hours" });
  let n = 0;
  const yaEste = new Set<string>(); // de a una por vendedor en cada tanda
  for (const c of (data ?? []) as any[]) {
    if (c.de_baja || !c.vendedor || yaEste.has(c.vendedor)) continue;
    const ref = `${c.codigo}:${new Date(c.actualizado_at).getTime()}`;
    const { count } = await sb.from("ojo_tarjeta").select("id", { count: "exact", head: true }).eq("tipo", "carrito").like("ref", `${c.codigo}:%`).gte("creado_en", iso(Date.now() - 3 * DIA));
    if (count) continue; // una tarjeta por carrito cada 3 días
    if (await crear("carrito", ref, c.vendedor, { codigo: c.codigo, cod: c.cod_cliente, razon: c.razon, unidades: c.unidades, modelos: c.modelos, wa: c.wa })) { n++; yaEste.add(c.vendedor); }
  }
  return n;
}

async function nuevosPedidos(desde: string) {
  const { data } = await sb.from("pedidos").select("id, cliente, cod_cliente, vendedor, total_units, estado, obs_deposito")
    .gte("created_at", desde).neq("vendedor", "Tienda").not("estado", "in", "(despachado,anulado)").order("id");
  let n = 0;
  for (const p of data ?? []) {
    const { count } = await sb.from("ojo_tarjeta").select("id", { count: "exact", head: true }).eq("tipo", "pedido").eq("ref", String(p.id));
    if (count) continue;
    if (await crear("pedido", String(p.id), "Deposito", { cliente: p.cliente, cod: p.cod_cliente, vendedor: p.vendedor, unidades: p.total_units, estado: p.estado, obs: p.obs_deposito, estado_desde: new Date().toISOString() })) n++;
  }
  return n;
}

function horaDe(h: string | null): [number, number] {
  const m = String(h ?? "").match(/(\d{1,2})(?::(\d{2}))?/);
  return m ? [Number(m[1]), Number(m[2] ?? 0)] : [12, 0];
}
async function nuevasReuniones(desde: string) {
  const { data } = await sb.from("ojo_reuniones").select("id, cod_cliente, cliente_nombre, vendedor, fecha, hora, conseguida_por, telegram_message_id")
    .eq("estado", "confirmada").gte("fecha", new Date(new Date(desde).getTime() - DIA).toISOString().slice(0, 10));
  let n = 0;
  for (const r of data ?? []) {
    const [hh, mm] = horaDe(r.hora);
    const cuando = new Date(`${r.fecha}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00-03:00`).getTime();
    if (Date.now() < cuando + 2 * H) continue; // le preguntamos 2 h después
    const fecha_txt = `${r.fecha.slice(8, 10)}/${r.fecha.slice(5, 7)}${r.hora ? " " + r.hora : ""}`;
    if (await crear("reunion", r.id, r.vendedor, { cod: r.cod_cliente, cliente: r.cliente_nombre, fecha_txt, conseguida_por: r.conseguida_por }, r.telegram_message_id)) n++;
  }
  return n;
}

async function agendaDelDia() {
  const a = horaAR();
  if (a.getUTCHours() < 9) return 0;
  const hoy = hoyAR();
  const { data: dn } = await sb.rpc("ojo_dia_num", { p_fecha: hoy });
  const dia = Number(dn);
  if (!dia) return 0;
  const { data: campo } = await sb.from("agenda_campo").select("vendedor, cod_cliente, localidad, orden_en_dia").eq("dia_num", dia).eq("bloque", "ba_gba").eq("visitado", false).order("orden_en_dia");
  const { data: turnos } = await sb.from("agenda_turnos").select("id, vendedor, cliente, cod_cliente, telefono, localidad").eq("dia_num", dia);
  const vendedores = [...new Set([...(campo ?? []).map((c) => c.vendedor), ...(turnos ?? []).map((t) => t.vendedor)])];
  const cods = (campo ?? []).map((c) => c.cod_cliente);
  const { data: cl } = cods.length ? await sb.from("clientes").select("cod, nomcomerc, razon, barrio, localidad, telefono").in("cod", cods) : { data: [] };
  const fc = new Map((cl ?? []).map((c: any) => [c.cod, c]));
  let n = 0;
  for (const v of vendedores) {
    const ref = `${v}:${hoy}`;
    const { count } = await sb.from("ojo_tarjeta").select("id", { count: "exact", head: true }).eq("tipo", "agenda").eq("ref", ref);
    if (count) continue;
    // lo que quedó sin registrar del día anterior → a los admins, y se cierra
    const { data: prev } = await sb.from("ojo_tarjeta").select("*").eq("tipo", "agenda").eq("vendedor", v).eq("estado", "abierta").neq("ref", ref);
    for (const p of (prev ?? []) as Tarjeta[]) {
      const sin = ((p.datos?.items ?? []) as any[]).filter((it) => !it.st);
      if (sin.length) for (const ad of await admins()) await enviar(ad, `⚠️ ${esc(NOMBRE[v] ?? v)} no registró ${sin.length} visita(s) del ${esc(p.datos?.fecha_txt)}: ${sin.map((it) => esc(it.nombre)).join(", ")}`);
      await guardar(p.id, { estado: "cerrada" });
      await refrescar({ ...p, estado: "cerrada" });
    }
    const items = [
      ...(campo ?? []).filter((c) => c.vendedor === v).map((c) => { const f: any = fc.get(c.cod_cliente) ?? {}; return { k: "c", cod: c.cod_cliente, nombre: f.nomcomerc || f.razon || c.cod_cliente, loc: f.barrio || f.localidad || c.localidad, tel: f.telefono }; }),
      ...(turnos ?? []).filter((t) => t.vendedor === v).map((t) => ({ k: "t", id: t.id, cod: t.cod_cliente, nombre: t.cliente, loc: t.localidad, tel: t.telefono })),
    ].slice(0, 20);
    if (!items.length) continue;
    if (await crear("agenda", ref, v, { fecha: hoy, fecha_txt: ddmm(), dia, items })) n++;
  }
  return n;
}

// ---------- sincronizar con la Suite y recordar ----------
async function sincronizar() {
  const { data } = await sb.from("ojo_tarjeta").select("*").in("estado", ["abierta", "seguimiento"]);
  const ts = (data ?? []) as Tarjeta[];
  let cambios = 0;
  for (const t of ts.filter((x) => x.tipo === "deriv" && x.estado === "abierta")) {
    const { data: d } = await sb.from("derivaciones").select("estado").eq("id", t.ref).maybeSingle();
    if (d?.estado === "resuelta") {
      t.datos.historial = [...(t.datos.historial ?? []), `✅ Resuelta ${hhmm()}`];
      await guardar(t.id, { estado: "cerrada", datos: t.datos }); await refrescar({ ...t, estado: "cerrada" }); cambios++;
    } else if (d?.estado === "tomada" && t.paso === "pendiente") {
      await guardar(t.id, { paso: "tomada" }); await refrescar({ ...t, paso: "tomada" }); cambios++;
    }
  }
  for (const t of ts.filter((x) => x.tipo === "pedido" && x.estado === "abierta")) {
    const { data: p } = await sb.from("pedidos").select("estado, obs_deposito").eq("id", Number(t.ref)).maybeSingle();
    if (!p) continue;
    if (p.estado !== t.datos.estado || (p.obs_deposito ?? null) !== (t.datos.obs ?? null)) {
      const cerr = ["despachado", "anulado"].includes(p.estado);
      const nuevo = p.estado !== t.datos.estado;
      t.datos = { ...t.datos, estado: p.estado, obs: p.obs_deposito, ...(nuevo ? { estado_desde: new Date().toISOString() } : {}) };
      await guardar(t.id, { datos: t.datos, ...(cerr ? { estado: "cerrada" } : {}), ...(nuevo ? { recordado_at: null, escalado_at: null, espera_desde: new Date().toISOString() } : {}) });
      await refrescar({ ...t, estado: cerr ? "cerrada" : t.estado }); cambios++;
      // Listo en Depósito → lo tiene que facturar Administración, que tiene su propio grupo.
      if (nuevo && p.estado === "listo") {
        const adm = await chatTema("administracion");
        if (adm !== t.chat_id) await enviar(adm, `🧾 ${await mencion("Administracion")}: el pedido <b>#${t.ref}</b> de ${esc(t.datos.cliente)} (${t.datos.unidades} u.) quedó <b>listo</b> en Depósito. Facturalo en la Suite (número de factura e importe).`);
      }
    }
  }
  return cambios;
}

async function recordar() {
  const { data } = await sb.from("ojo_tarjeta").select("*").eq("estado", "abierta");
  const ahora = Date.now();
  const escalar: string[] = [];
  let rec = 0;
  for (const t of (data ?? []) as Tarjeta[]) {
    if (t.tipo === "agenda") {
      // a las 17 h, si quedan visitas sin marcar
      const faltan = ((t.datos?.items ?? []) as any[]).filter((it) => !it.st).length;
      if (faltan && !t.recordado_at && horaAR().getUTCHours() >= 17 && t.message_id) {
        await enviar(t.chat_id ?? GRUPO, `⏰ ${await mencion(t.vendedor)}, te faltan ${faltan} visita(s) de hoy por marcar 👆`, { reply_to_message_id: t.message_id });
        await guardar(t.id, { recordado_at: new Date().toISOString() }); rec++;
      }
      continue;
    }
    const clave = t.datos?.seg ? "seguimiento" : t.tipo;
    const [hRec, hEsc] = PLAZOS[clave] ?? [3, 24];
    const desde = new Date(t.espera_desde ?? t.creado_en).getTime();
    if (t.tipo === "pedido" && ["despachado", "anulado"].includes(t.datos.estado)) continue;
    const responsable = t.tipo === "pedido" ? (["listo", "facturado"].includes(t.datos.estado) ? "Administracion" : "Deposito") : t.vendedor;
    if (!t.recordado_at && ahora - desde > hRec * H && t.message_id && responsable !== "Gaston" && responsable !== "Corporativo") {
      await enviar(t.chat_id ?? GRUPO, `⏰ ${await mencion(responsable)}, esto sigue esperando 👆`, { reply_to_message_id: t.message_id });
      await guardar(t.id, { recordado_at: new Date().toISOString() }); rec++;
    }
    if (!t.escalado_at && ahora - desde > hEsc * H) {
      const que = t.tipo === "deriv" ? `🆘 ${t.datos.nombre ?? "cliente"} (${MOTIVO[t.datos.motivo] ?? t.datos.motivo})`
        : t.tipo === "carrito" ? `🛒 carrito de ${t.datos.razon ?? t.datos.cod}`
        : t.tipo === "reunion" ? `🤝 reunión con ${t.datos.cliente}`
        : `📦 pedido #${t.ref} en ${t.datos.estado}`;
      escalar.push(`• ${esc(NOMBRE[responsable ?? ""] ?? responsable)}: ${esc(que)}`);
      await guardar(t.id, { escalado_at: new Date().toISOString() });
    }
  }
  if (escalar.length) for (const ad of await admins()) await enviar(ad, `⚠️ <b>Tarjetas de Ojo sin respuesta</b>\n\n${escalar.join("\n")}`);
  return { recordados: rec, escalados: escalar.length };
}

async function seguimientos() {
  const { data } = await sb.from("ojo_tarjeta").select("*").eq("estado", "seguimiento").lte("seguimiento_at", new Date().toISOString());
  let n = 0;
  for (const t of (data ?? []) as Tarjeta[]) {
    const quien = t.datos.razon ?? t.datos.cliente ?? t.datos.cod;
    const txt = `🔔 Seguimiento para ${await mencion(t.vendedor)}\n<b>${esc(quien)}</b>${t.datos.cod ? ` (${esc(t.datos.cod)})` : ""}\nQuedó: ${esc(RES[t.resultado ?? ""]?.txt ?? "")}\n\n<b>${esc(PREG[t.resultado ?? ""] ?? "¿Cómo sigue?")}</b>`;
    const chat = await chatDe(t.tipo, t.ref);
    const d = await enviar(chat, txt, { reply_markup: kb(tecladoRes(t.id, t.tipo === "reunion")), ...(chat === t.chat_id ? { reply_to_message_id: t.message_id, allow_sending_without_reply: true } : {}) });
    if (!d?.ok) continue;
    await guardar(t.id, { estado: "abierta", paso: "resultado", chat_id: chat, message_id: d.result.message_id, espera_desde: new Date().toISOString(), recordado_at: null, escalado_at: null, seguimiento_at: null, datos: { ...t.datos, seg: true, historial: [] } });
    n++;
  }
  return n;
}

function enHorario() { const a = horaAR(); return a.getUTCDay() !== 0 && a.getUTCHours() >= 8 && a.getUTCHours() < 20; }

async function tareaTick(forzar = false) {
  if (!forzar && !enHorario()) return { fuera_de_horario: true };
  const desde = await cfg("tarjetas_desde") ?? new Date().toISOString();
  const out: Record<string, unknown> = {};
  const paso = async (k: string, f: () => Promise<unknown>) => { try { out[k] = await f(); } catch (e) { out[k] = `error: ${(e as Error).message}`; console.error(k, e); } };
  await paso("sync", sincronizar);
  await paso("deriv", () => nuevasDeriv(desde));
  await paso("pedidos", () => nuevosPedidos(desde));
  await paso("carritos", nuevosCarritos);
  await paso("reuniones", () => nuevasReuniones(desde));
  await paso("agenda", agendaDelDia);
  await paso("seguimientos", seguimientos);
  await paso("recordar", recordar);
  return out;
}

// ---------- botones ----------
async function puede(t: Tarjeta, quien: number): Promise<boolean> {
  if ((await admins()).includes(quien)) return true;
  const m = await ids();
  const resp = t.tipo === "pedido" ? ["Deposito", "Administracion"] : [t.vendedor === "Corporativo" ? "Gaston" : t.vendedor ?? ""];
  return resp.some((r) => (m[r] ?? []).includes(quien));
}
const hist = (t: Tarjeta, s: string) => { t.datos.historial = [...(t.datos.historial ?? []), s]; };

async function manejarCallback(cq: any) {
  const [, idStr, accion, a1, a2] = String(cq.data).split(":");
  const { data } = await sb.from("ojo_tarjeta").select("*").eq("id", Number(idStr)).maybeSingle();
  const t = data as Tarjeta | null;
  const resp = (text: string, alert = false) => tg("answerCallbackQuery", { callback_query_id: cq.id, text, show_alert: alert });
  if (!t) return resp("No la encuentro");
  if (t.estado === "cerrada") return resp("Ya estaba cerrada");
  const quien = Number(cq.from?.id);
  const por = cq.from?.first_name ?? "Telegram";
  if (!(await puede(t, quien))) {
    const q = t.tipo === "pedido" ? "Depósito / Administración" : (NOMBRE[t.vendedor ?? ""] ?? t.vendedor);
    return resp(`Esto lo marca ${q} 🙂`);
  }
  const ahoraIso = new Date().toISOString();
  const base = { espera_desde: ahoraIso, recordado_at: null, escalado_at: null, resuelta_por: por };

  // --- derivaciones ---
  if (t.tipo === "deriv") {
    if (accion === "tomo") {
      await sb.from("derivaciones").update({ estado: "tomada" }).eq("id", t.ref);
      hist(t, `🙋 La tomó ${por} ${hhmm()}`);
      await guardar(t.id, { ...base, paso: "tomada", datos: t.datos }); await resp("🙋 Tomada");
      return refrescar({ ...t, paso: "tomada" });
    }
    if (accion === "resp") {
      await sb.from("derivaciones").update({ estado: "resuelta", resuelta_at: ahoraIso }).eq("id", t.ref);
      hist(t, `✅ Respondida por ${por} ${hhmm()}`);
      await guardar(t.id, { ...base, estado: "cerrada", resuelta_en: ahoraIso, datos: t.datos }); await resp("✅ Listo");
      return refrescar({ ...t, estado: "cerrada" });
    }
    if (accion === "menu") { t.datos.paso_prev = t.paso; await guardar(t.id, { paso: "menu", datos: t.datos }); await resp(""); return refrescar({ ...t, paso: "menu" }); }
    if (accion === "back") { const p = t.datos.paso_prev ?? "pendiente"; await guardar(t.id, { paso: p }); await resp(""); return refrescar({ ...t, paso: p }); }
    if (accion === "a" && a1) {
      const { data: v } = await sb.from("vendedores").select("id").eq("codigo", a1).maybeSingle();
      if (!v) return resp("No encuentro a ese vendedor", true);
      await sb.from("derivaciones").update({ asignado_a: v.id, estado: "pendiente" }).eq("id", t.ref);
      hist(t, `➡️ ${por} se la pasó a ${NOMBRE[a1] ?? a1} ${hhmm()}`);
      await guardar(t.id, { ...base, vendedor: a1, paso: "pendiente", datos: t.datos }); await resp(`➡️ A ${NOMBRE[a1] ?? a1}`);
      return refrescar({ ...t, vendedor: a1, paso: "pendiente" });
    }
  }

  // --- pedidos ---
  if (t.tipo === "pedido") {
    const id = Number(t.ref);
    if (accion === "e" && a1) {
      const extra = a1 === "en_preparacion" ? { esperando_stock: false } : {};
      const { error } = await sb.from("pedidos").update({ estado: a1, ...extra }).eq("id", id);
      if (error) return resp("No pude cambiarlo: " + error.message, true);
      hist(t, `${por} → ${a1.replace("_", " ")} ${hhmm()}`);
      t.datos = { ...t.datos, estado: a1, estado_desde: ahoraIso };
      await guardar(t.id, { ...base, paso: null, datos: t.datos }); await resp("✓");
      return refrescar({ ...t, paso: null });
    }
    if (accion === "fs") {
      const obs = `Falta stock (marcado por ${por} desde Telegram)`;
      await sb.from("pedidos").update({ estado: "observado", esperando_stock: true, obs_deposito: obs }).eq("id", id);
      hist(t, `⚠️ ${por}: falta stock ${hhmm()} — respondé esta tarjeta con qué falta`);
      t.datos = { ...t.datos, estado: "observado", obs, estado_desde: ahoraIso };
      await guardar(t.id, { ...base, datos: t.datos }); await resp("⚠️ Observado");
      return refrescar(t);
    }
    if (accion === "desp") { await guardar(t.id, { paso: "transporte" }); await resp(""); return refrescar({ ...t, paso: "transporte" }); }
    if (accion === "back") { await guardar(t.id, { paso: null }); await resp(""); return refrescar({ ...t, paso: null }); }
    if (accion === "dt" && a1) {
      const tr = TRANSPORTES[Number(a1)] ?? "Otro";
      const { error } = await sb.from("pedidos").update({ estado: "despachado", tipo_transporte: tr }).eq("id", id);
      if (error) return resp("No pude: " + error.message, true);
      hist(t, `🚚 Despachado por ${por} (${tr}) ${hhmm()} — si hay guía, respondé la tarjeta con el número`);
      t.datos = { ...t.datos, estado: "despachado" };
      await guardar(t.id, { ...base, estado: "cerrada", paso: null, datos: t.datos, resuelta_en: ahoraIso }); await resp("🚚 Despachado");
      return refrescar({ ...t, estado: "cerrada", paso: null });
    }
  }

  // --- carrito ---
  if (t.tipo === "carrito") {
    if (accion === "llame") {
      hist(t, `📞 Lo llamó ${por} ${hhmm()}`);
      await guardar(t.id, { ...base, paso: "resultado", datos: t.datos }); await resp("📞");
      await anotarCliente(t.datos.cod, `📞 ${ddmm()} ${por}: llamado por el carrito sin cerrar (Ojo)`);
      return refrescar({ ...t, paso: "resultado" });
    }
    if (accion === "prc") {
      const { data: r, error } = await sb.rpc("ojo_carrito_a_precarga", { p_codigo: t.datos.codigo, p_por: por });
      const x = r as any;
      if (error || !x?.ok) return resp(x?.error ?? error?.message ?? "No se pudo", true);
      hist(t, `📥 Precarga #${x.precarga_id} (${x.total_units} u.) — ${por} ${hhmm()}${x.recorte ? ` · sin stock: ${x.recorte}` : ""}. Cerrala en Nuevo pedido.`);
      await guardar(t.id, { ...base, estado: "cerrada", resultado: "prc", datos: t.datos, resuelta_en: ahoraIso }); await resp(`📥 Precarga #${x.precarga_id}`);
      return refrescar({ ...t, estado: "cerrada" });
    }
  }

  // --- resultado (carrito llamado, reunión, seguimiento) ---
  if (accion === "r" && a1 && RES[a1]) {
    const r = RES[a1];
    const vend = t.vendedor;
    const quienTxt = r.txt.replace(/^\S+\s/, "").toLowerCase();
    const extra: Record<string, unknown> = {};
    if (r.paso) extra.proximo_paso = `${r.paso} (Ojo)`;
    if (r.dias) extra.proxima_agenda_fecha = horaAR(new Date(Date.now() + r.dias * DIA)).toISOString().slice(0, 10);
    const origenTxt = t.tipo === "reunion" ? "reunión" : t.tipo === "carrito" ? "carrito" : "seguimiento";
    const enFicha = await anotarCliente(t.datos.cod, `📞 ${ddmm()} ${hhmm()} ${por}: ${origenTxt} → ${quienTxt} (Ojo)`, extra);
    await actividad(t.datos.cod, vend, t.tipo === "reunion" ? "reunion" : "ojo_tarjeta", a1 === "ya" ? "vendio" : a1 === "no" ? "no_interesa" : a1, `${origenTxt}: ${quienTxt} (Telegram)`, t.datos.razon ?? t.datos.cliente);
    hist(t, `${r.txt} — ${por} ${hhmm()}${enFicha ? " · ficha actualizada" : ""}${r.dias ? ` · 🔔 vuelvo a preguntar el ${ddmm(new Date(Date.now() + r.dias * DIA))}` : ""}`);
    const cierra = !!r.cierra;
    await guardar(t.id, { ...base, estado: cierra ? "cerrada" : "seguimiento", resultado: a1, paso: null, datos: t.datos, seguimiento_at: cierra ? null : iso(Date.now() + (r.dias ?? 3) * DIA), ...(cierra ? { resuelta_en: ahoraIso } : {}) });
    await resp(r.txt);
    return refrescar({ ...t, estado: "cerrada" }); // la tarjeta queda con el historial; el seguimiento sale como tarjeta nueva
  }

  // --- agenda ---
  if (t.tipo === "agenda" && accion === "v") {
    const i = Number(a1), res = a2;
    const it = (t.datos.items ?? [])[i];
    if (!it || it.st) return resp("Ya estaba marcada");
    const vend = t.vendedor!;
    if (it.k === "c") {
      if (res === "reagendar") await sb.from("agenda_campo").update({ dia_num: Number(t.datos.dia) + 1, visitado: false, resultado: "reagendar" }).eq("vendedor", vend).eq("cod_cliente", it.cod);
      else await sb.from("agenda_campo").update({ visitado: true, resultado: res }).eq("vendedor", vend).eq("cod_cliente", it.cod);
    } else if (it.id) {
      if (res === "reagendar") await sb.from("agenda_turnos").update({ dia_num: Number(t.datos.dia) + 1 }).eq("id", it.id);
      else await sb.from("agenda_turnos").update({ estado: res === "no_estaba" ? "no_estaba" : "hecho" }).eq("id", it.id);
    }
    const TXT: Record<string, string> = { visito: "Visita de campo", vendio: "Visita de campo: vendió", no_estaba: "Visita de campo: no estaba", reagendar: "Visita pasada al día siguiente" };
    await actividad(it.cod, vend, "agenda_campo", res, `${TXT[res]} (Telegram)`, it.nombre);
    await anotarCliente(it.cod, `📍 ${ddmm()} ${hhmm()} ${por}: ${TXT[res].toLowerCase()} (Ojo)`);
    it.st = res;
    await guardar(t.id, { datos: t.datos, ...((t.datos.items as any[]).every((x) => x.st) ? { estado: "cerrada", resuelta_en: ahoraIso, resuelta_por: por } : {}) });
    await resp("✓");
    if (res === "vendio") await enviar(t.chat_id ?? GRUPO, `🛒 ¡Bien ${esc(por)}! Cargá el pedido de <b>${esc(it.nombre)}</b> en la Suite → Nuevo pedido.`, { reply_to_message_id: t.message_id });
    return refrescar(t);
  }
  return resp("");
}

// ---------- respuestas con texto ----------
async function manejarMensaje(m: any) {
  const r = m.reply_to_message?.message_id;
  const txt = String(m.text ?? "").trim();
  if (!r || !txt) return;
  const { data } = await sb.from("ojo_tarjeta").select("*").eq("chat_id", Number(m.chat.id)).eq("message_id", r).limit(1);
  const t = (data ?? [])[0] as Tarjeta | undefined;
  if (!t) return;
  const quien = Number(m.from?.id);
  if (!(await puede(t, quien))) return;
  const por = m.from?.first_name ?? "Telegram";
  if (t.tipo === "pedido") {
    const { data: p } = await sb.from("pedidos").select("obs_deposito, estado").eq("id", Number(t.ref)).maybeSingle();
    if (p?.estado === "despachado" && /^[\w\-]{5,}$/.test(txt)) await sb.from("pedidos").update({ nro_guia: txt }).eq("id", Number(t.ref));
    else await sb.from("pedidos").update({ obs_deposito: `${p?.obs_deposito ? p.obs_deposito + " · " : ""}${txt} (${por})` }).eq("id", Number(t.ref));
  } else {
    await anotarCliente(t.datos.cod, `📝 ${ddmm()} ${hhmm()} ${por}: ${txt} (Ojo)`);
    if (t.tipo === "deriv") await sb.from("derivaciones").update({ resumen: `${t.datos.resumen ?? ""}\n— ${por}: ${txt}` }).eq("id", t.ref);
  }
  await tg("setMessageReaction", { chat_id: m.chat.id, message_id: m.message_id, reaction: [{ type: "emoji", emoji: "✍" }] });
}

async function tareaEstado() {
  const { data } = await sb.from("ojo_tarjeta").select("tipo, estado, vendedor");
  const r: Record<string, Record<string, number>> = {};
  for (const x of data ?? []) { const k = `${x.tipo}`; r[k] ??= {}; r[k][`${x.estado}:${x.vendedor}`] = (r[k][`${x.estado}:${x.vendedor}`] ?? 0) + 1; }
  return r;
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const auth = req.headers.get("authorization") ?? "";
  const cronKey = req.headers.get("x-cron-key");
  const ok = auth === `Bearer ${SERVICE_KEY}` || (cronKey && cronKey === await cfg("cron_key"));
  if (!ok) return new Response("unauthorized", { status: 401 });
  try {
    const tarea = url.searchParams.get("tarea");
    let out: unknown = { ok: true };
    if (tarea === "tick") out = await tareaTick(url.searchParams.get("forzar") === "1");
    else if (tarea === "estado") out = await tareaEstado();
    else if (tarea === "mover") out = await tareaMover(url.searchParams.get("tema") ?? "");
    else {
      const body = await req.json().catch(() => ({}));
      const u = body.update ?? body;
      if (u.callback_query) await manejarCallback(u.callback_query);
      else if (u.message) await manejarMensaje(u.message);
    }
    return new Response(JSON.stringify(out), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: String((e as Error).message ?? e) }), { status: 500 });
  }
});
