import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// ojo-cabeza-dia — arranque del día de campo de cada vendedor (bot Ojo, Telegram).
//   v1 (2026-10-16, Gastón): a la mañana (cron, lun-vie) asigna la CABEZA DE ZONA del día a cada vendedor
//   (asignar_cabezas_dia: rota los barrios por lo que hay en juego y prefiere los de su agenda) y le manda
//   por privado la ficha completa de esa óptica para arrancar ahí. Con el check-in de la foto en la cabeza,
//   ojo-checkin le pasa las 4 ópticas que siguen. En el mismo mensaje van las acciones del mes que vencen
//   hoy (acciones_seguimiento: empujón comercial a calientes/tibias, branding mensual a frías) con el
//   material sugerido. Antes recalcula las temperaturas (catálogo abierto después de la visita).
//   GET/POST ?tarea=dia  (x-cron-key o Bearer service role)  ·  ?tarea=dia&solo=Bruno para probar con uno.
//   v2 (2026-10-16): objetivo diario 5 visitas + 25 contactos. Genera contactos_dia (ópticas de las zonas de
//   los próximos días del plan) y los manda en un 2º mensaje con link de WhatsApp y el texto armado.
//   &prueba=1 arma los mensajes y los devuelve sin enviar nada (igual asigna la cabeza del día);
//   con &fecha=AAAA-MM-DD prueba otro día sin activar el modo cabeza hoy.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BOT = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const TG = `https://api.telegram.org/bot${BOT}`;
const GRUPO = -5504692394;
const sb = createClient(SUPABASE_URL, SERVICE_KEY);
const esc = (v: unknown) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const NOMBRE: Record<string, string> = { Adrian: "Adrián", Bruno: "Bruno", Lola: "Lola" };

async function cfg(clave: string): Promise<string | null> {
  const { data } = await sb.from("app_config").select("valor").eq("clave", clave).maybeSingle();
  return data?.valor ?? null;
}
async function enviar(chatId: number, text: string): Promise<boolean> {
  const r = await fetch(`${TG}/sendMessage`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true }),
  });
  const d = await r.json().catch(() => ({}));
  if (d?.ok) await sb.from("ojo_mensajes_log").insert({ telegram_chat_id: chatId, telegram_message_id: d.result.message_id, autor_nombre: "Ojo", texto: text.slice(0, 4000), es_del_bot: true });
  else console.error("sendMessage", chatId, JSON.stringify(d));
  return !!d?.ok;
}
async function idsDe(vendedor: string): Promise<number[]> {
  try { return ((JSON.parse(await cfg("tarjetas_tg") ?? "{}")[vendedor]) ?? []).map(Number); } catch { return []; }
}
async function chatVentas(): Promise<number> {
  const { data } = await sb.rpc("ojo_chat_tema", { p_tema: "ventas" });
  return Number(data) || GRUPO;
}
const mapsPunto = (lat: number, lon: number) => `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`;

// misma ficha que ojo-checkin (sale de ficha_optica)
function fichaHtml(f: any): string {
  if (!f) return "";
  const mes = (m: string | null) => (m ? `${m.slice(5, 7)}/${m.slice(2, 4)}` : "—");
  const n = (v: unknown) => Math.round(Number(v ?? 0));
  const dir = [f.direccion, f.barrio || f.localidad].filter(Boolean).join(", ");
  const l: string[] = [];
  l.push(`<b>${esc(f.nombre)}</b> (${esc(f.cod)})${f.estado ? ` — ${esc(f.estado)}` : " — prospecto"}${f.nivel_partner ? ` · ${esc(f.nivel_partner)}` : ""}`);
  if (dir) l.push(`📍 ${esc(dir)}`);
  if (f.contacto || f.tel) l.push(`☎️ ${esc([f.contacto, f.tel].filter(Boolean).join(" · "))}`);
  if (f.horario) l.push(`🕘 ${esc(f.horario)}`);
  if (f.estado) l.push(`🛒 12m: ${n(f.u12)} u (antes ${n(f.u_prev12)}) · mejor año ${n(f.u_mejor_anio)} u · últ. compra ${mes(f.ult_mes)}`);
  if (f.modelos?.length) l.push(`👓 Compra: ${esc(f.modelos.map((m: any) => `${m.modelo} (${m.u})`).join(", "))}`);
  if (f.tiene_orbital != null) l.push(`${f.tiene_orbital ? "🟢 Orbital en vidriera" : "🔴 Sin Orbital en vidriera"}${f.vidriera ? ` — ${esc(String(f.vidriera).replace(/^"|"$/g, "")).slice(0, 160)}` : ""}`);
  if (f.catalogo_30d?.visitas) l.push(`📖 Abrió el catálogo ${f.catalogo_30d.visitas} vez/veces en 30 días${n(f.catalogo_min_30d) ? ` (${n(f.catalogo_min_30d)} min)` : ""}`);
  if (f.ultima_actividad) l.push(`🗒 Último contacto ${esc(String(f.ultima_actividad.fecha).slice(8, 10))}/${esc(String(f.ultima_actividad.fecha).slice(5, 7))}: ${esc(f.ultima_actividad.resultado ?? "")}${f.ultima_actividad.nota ? ` — ${esc(f.ultima_actividad.nota)}` : ""}`);
  if (f.accion_pendiente) l.push(`⏭ Pendiente: ${esc(f.accion_pendiente.titulo)}`);
  if (f.que_ofrecer) l.push(`💡 ${esc(f.que_ofrecer)}`);
  return l.join("\n");
}

// WhatsApp: misma normalización que la app (src/lib/telefono.ts → aNacional): 549 + 10 dígitos.
function waDe(raw: string | null | undefined): string {
  for (const parte of String(raw ?? "").split(/\s*[/,;|]+\s*|\s+[yYoO]\s+/)) {
    let d = parte.replace(/\D/g, "");
    if (d.length < 6) continue;
    d = d.replace(/^00/, "");
    if (d.length > 10 && d.startsWith("54")) d = d.slice(2);
    d = d.replace(/^0+/, "");
    if (d.length === 11 && d.startsWith("9")) d = d.slice(1);
    if (d.length === 12) for (const al of [4, 3, 2]) if (d.slice(al, al + 2) === "15") { d = d.slice(0, al) + d.slice(al + 2); break; }
    if (d.length === 8) d = "11" + d;
    if (d.length === 10) return "549" + d;
  }
  return "";
}
const DIA = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
const fechaCorta = (f: string) => { const d = new Date(f + "T12:00:00"); return `${DIA[d.getDay()]} ${f.slice(8, 10)}/${f.slice(5, 7)}`; };
const MOT_CONTACTO: Record<string, string> = { recuperar: "a recuperar", activo: "activo", prospecto: "prospecto", "sin compras": "sin compras" };

// 2º mensaje: los 25 contactos para ir armando agenda en las zonas de los próximos días.
async function mensajeContactos(vendedor: string, fecha: string): Promise<string[]> {
  const { data: cs } = await sb.from("contactos_dia").select("cod_cliente, micro_zona, fecha_visita, motivo, orden")
    .eq("fecha", fecha).eq("vendedor", vendedor).order("orden");
  if (!cs?.length) return [];
  const { data: clis } = await sb.from("clientes").select("cod, nomcomerc, razon, contacto, whatsapp, telefono").in("cod", cs.map((c) => c.cod_cliente));
  const cli = new Map((clis ?? []).map((x: any) => [x.cod, x]));
  const l: string[] = [`📲 <b>25 contactos para ir armando agenda</b> (ópticas de los barrios de los próximos días). Escribiles hoy para dejar visitas confirmadas:`, ""];
  let k = 0;
  for (const c of cs) {
    const x: any = cli.get(c.cod_cliente);
    if (!x) continue;
    k++;
    const nombre = x.nomcomerc?.trim() || x.razon || c.cod_cliente;
    const { data: txt } = await sb.rpc("mensaje_contacto", { p_vendedor: vendedor, p_motivo: c.motivo, p_zona: c.micro_zona, p_fecha: c.fecha_visita, p_contacto: x.contacto });
    const wa = waDe(x.whatsapp) || waDe(x.telefono);
    const link = wa ? ` · <a href="https://wa.me/${wa}?text=${encodeURIComponent(String(txt ?? ""))}">WhatsApp</a>` : ` · ☎️ ${esc(x.telefono ?? "")}`;
    l.push(`${k}. <b>${esc(nombre)}</b> — ${esc(c.micro_zona)} (${fechaCorta(c.fecha_visita)}) · ${esc(MOT_CONTACTO[c.motivo] ?? c.motivo)}${link}`);
  }
  // en tandas de 10 para no pasar el límite de largo de Telegram
  const items = l.slice(2), partes: string[] = [];
  for (let i = 0; i < items.length; i += 10) partes.push((i === 0 ? l[0] + "\n\n" : "") + items.slice(i, i + 10).join("\n"));
  if (partes.length) partes[partes.length - 1] += "\n\n<i>El link abre WhatsApp con el mensaje armado. Marcá en Suite → Agenda cuáles quedaron agendados: esas ópticas entran primero en tu ruta del día de la visita.</i>";
  return partes;
}

const MOTIVO: Record<string, string> = {
  ancla: "es el cliente ancla del barrio (el que más compra)",
  recuperar: "es el primero a recuperar del barrio",
  prospecto: "es el prospecto más fuerte del barrio",
};
const TEMP: Record<string, string> = { caliente: "🔥", tibia: "🙂", fria: "🌱" };

async function dia(solo: string | null, prueba: boolean, fecha: string | null) {
  if (!prueba) await sb.rpc("actualizar_temperaturas");
  const { data: cabezas, error } = await sb.rpc("asignar_cabezas_dia", fecha ? { p_fecha: fecha } : {});
  if (error) throw new Error("asignar_cabezas_dia: " + error.message);
  const hoy = (cabezas ?? [])[0]?.fecha;
  // los 25 contactos del día (zonas de los próximos días); en prueba solo se leen si ya existen
  if (hoy && !prueba) {
    const { error: e2 } = await sb.rpc("generar_contactos_dia", { p_fecha: hoy });
    if (e2) console.error("generar_contactos_dia", JSON.stringify(e2));
  }
  const salida: Record<string, string> = {};
  for (const c of (cabezas ?? []) as any[]) {
    if (solo && c.vendedor !== solo) continue;
    if (c.enviado_at && !solo) { salida[c.vendedor] = "ya enviado"; continue; }
    const { data: f } = await sb.rpc("ficha_optica", { p_cod: c.cod_cliente });
    const { data: cz } = await sb.from("cabeza_zona").select("lat, lon").eq("vendedor", c.vendedor).eq("micro_zona", c.micro_zona).maybeSingle();
    const { data: acc } = await sb.from("acciones_seguimiento")
      .select("id, cod_cliente, temperatura, titulo, fecha_programada, pieza_id")
      .eq("vendedor", c.vendedor).eq("estado", "pendiente").lte("fecha_programada", hoy).order("fecha_programada").limit(15);
    const cods = (acc ?? []).map((a) => a.cod_cliente);
    const piezasIds = (acc ?? []).map((a) => a.pieza_id).filter(Boolean);
    const { data: clis } = cods.length ? await sb.from("clientes").select("cod, nomcomerc, razon, whatsapp, telefono").in("cod", cods) : { data: [] };
    const { data: pzs } = piezasIds.length ? await sb.from("piezas_marketing").select("id, titulo, url_corta, url_publica, url").in("id", piezasIds) : { data: [] };
    const cli = new Map((clis ?? []).map((x: any) => [x.cod, x]));
    const pz = new Map((pzs ?? []).map((x: any) => [x.id, x]));

    const l: string[] = [];
    l.push(`☀️ <b>Buen día ${esc(NOMBRE[c.vendedor] ?? c.vendedor)}.</b> Hoy arrancás por <b>${esc(c.micro_zona)}</b>.`);
    l.push(`🎯 Objetivo del día: <b>5 visitas</b> (la cabeza + las 4 que siguen) y <b>25 contactos</b> para agendar (te los paso abajo).`);
    l.push(`🎯 Cabeza de zona: ${esc(MOTIVO[c.motivo] ?? c.motivo)}.\n`);
    l.push(fichaHtml(f));
    if (cz?.lat != null) l.push(`🗺 <a href="${mapsPunto(Number(cz.lat), Number(cz.lon))}">Cómo llegar</a>`);
    l.push(`\n📸 Al llegar mandame la <b>foto de la vidriera</b> (mejor como archivo, así va con GPS): te paso las <b>4 ópticas que siguen</b> con toda la info. Al salir de cada una tocá cómo te fue.`);
    if ((acc ?? []).length) {
      l.push(`\n📌 <b>Acciones del mes para hoy (${acc!.length})</b>`);
      for (const a of acc!) {
        const x: any = cli.get(a.cod_cliente);
        const p: any = a.pieza_id ? pz.get(a.pieza_id) : null;
        const url = p ? (p.url_corta || p.url_publica || p.url) : null;
        const tel = x?.whatsapp || x?.telefono;
        l.push(`${TEMP[a.temperatura] ?? "•"} <b>${esc(x?.nomcomerc?.trim() || x?.razon || a.cod_cliente)}</b> — ${esc(a.titulo.replace(/^\S+\s/, ""))}${p ? ` · <a href="${url}">${esc(p.titulo)}</a>` : ""}${tel ? ` · ☎️ ${esc(tel)}` : ""}`);
      }
      l.push(`<i>Mandalo desde Cartera → Enviar (queda registrado y la acción se cierra sola).</i>`);
    }
    const texto = l.join("\n");
    const contactos = await mensajeContactos(c.vendedor, c.fecha);
    if (prueba) { salida[c.vendedor] = [texto, ...contactos].join("\n\n----\n"); continue; }  // arma sin mandar
    let ok = false;
    const ids = await idsDe(c.vendedor);
    for (const id of ids) {
      const ok1 = await enviar(id, texto);
      if (ok1) for (const m of contactos) await enviar(id, m);
      ok = ok1 || ok;
    }
    if (!ok) {
      const grupo = await chatVentas();
      ok = await enviar(grupo, `@${esc(c.vendedor)} (no te pude escribir por privado: mandale /start a Ojo)\n\n${texto}`);
      if (ok) for (const m of contactos) await enviar(grupo, `@${esc(c.vendedor)}\n${m}`);
    }
    if (ok) await sb.from("cabeza_dia").update({ enviado_at: new Date().toISOString() }).eq("fecha", c.fecha).eq("vendedor", c.vendedor);
    salida[c.vendedor] = ok ? `enviado (${c.micro_zona})` : "no se pudo enviar";
  }
  return salida;
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const auth = req.headers.get("authorization") ?? "";
  const cronKey = req.headers.get("x-cron-key");
  const ok = auth === `Bearer ${SERVICE_KEY}` || (cronKey && cronKey === await cfg("cron_key"));
  if (!ok) return new Response("unauthorized", { status: 401 });
  try {
    const tarea = url.searchParams.get("tarea") ?? "dia";
    if (tarea !== "dia") return new Response(JSON.stringify({ error: "tarea desconocida" }), { status: 400 });
    const prueba = url.searchParams.get("prueba") === "1";
    // la fecha solo se acepta en prueba (para ver cómo queda otro día sin activar nada hoy)
    const r = await dia(url.searchParams.get("solo"), prueba, prueba ? url.searchParams.get("fecha") : null);
    return new Response(JSON.stringify({ ok: true, r }), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: String((e as Error).message ?? e) }), { status: 500 });
  }
});
