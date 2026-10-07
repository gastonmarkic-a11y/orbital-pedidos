import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// ojo-checkin — check-in de visitas por foto de vidriera y/o ubicación (bot Ojo, Telegram).
//   v1 (2026-10-01, Gastón): el vendedor manda la FOTO de la vidriera (sin texto) y/o comparte
//   su UBICACIÓN. Ojo: baja la foto a storage (optica-fotos/checkin), la lee con Claude Vision
//   (nombre del cartel, si hay Orbital, marcas, exhibidores/POP, espacio libre, nivel del local),
//   geocodifica la ubicación (Nominatim) y propone el cliente con botones:
//     1º la agenda de campo del día del vendedor · 2º clientes a menos de 150 m · 3º nombre leído.
//   Con el botón queda la visita (actividad_diaria + agenda_campo visitado), la foto y el análisis
//   en la ficha del cliente, y el POP sugerido según pop_niveles. "No es cliente" → prospecto TMP-.
//   Entra por ojo-conteo (puerta del webhook): botones ck:*, fotos sin texto, ubicaciones y las
//   respuestas con el nombre a "¿Cómo se llama?". POST {update} con Bearer service role.
//   v2 (2026-10-05, Gastón): la foto GENERA el check-in sola cuando la óptica es clara (a menos de
//   60 m, o el cartel coincide con un único cliente), con botón "No es esta" para deshacer. Con el
//   PRIMER check-in del día arma la RUTA del día (ruta_dia) con las ópticas de la zona de la foto:
//   la agenda de campo queda como sugerida y la ruta real sale de las fotos. La zona sale del GPS
//   del EXIF (foto mandada como archivo — Telegram borra el GPS de las fotos comprimidas), de la
//   ubicación compartida o de las coordenadas del cliente reconocido por el cartel. Si el vendedor
//   aparece a más de 4 km de lo que le queda, se rearma la ruta desde ahí.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BOT = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const TG = `https://api.telegram.org/bot${BOT}`;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const sb = createClient(SUPABASE_URL, SERVICE_KEY);

const RADIO_M = 150;          // "estoy en la puerta"
const VENTANA_MIN = 20;       // foto y ubicación del mismo vendedor dentro de 20 min son la misma visita
const hoyAR = () => new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);
const esc = (v: unknown) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const sinTilde = (v: string) => v.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

async function tg(metodo: string, body: Record<string, unknown>) {
  const r = await fetch(`${TG}/${metodo}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (!d?.ok && !String(d?.description ?? "").includes("not modified")) console.error(metodo, JSON.stringify(d));
  return d;
}
async function enviar(chatId: number, text: string, extra: Record<string, unknown> = {}) {
  const d = await tg("sendMessage", { chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true, ...extra });
  if (d?.ok) await sb.from("ojo_mensajes_log").insert({ telegram_chat_id: chatId, telegram_message_id: d.result.message_id, autor_nombre: "Ojo", texto: text.slice(0, 4000), es_del_bot: true });
  return d?.result?.message_id as number | undefined;
}
async function cfg(clave: string): Promise<string | null> {
  const { data } = await sb.from("app_config").select("valor").eq("clave", clave).maybeSingle();
  return data?.valor ?? null;
}

// ---------- quién manda ----------
async function vendedorDe(from: any): Promise<string | null> {
  const id = Number(from?.id);
  try {
    const mapa: Record<string, number[]> = JSON.parse(await cfg("tarjetas_tg") ?? "{}");
    for (const [cod, ids] of Object.entries(mapa)) if ((ids ?? []).map(Number).includes(id)) return cod;
  } catch { /* sigue */ }
  const { data: vs } = await sb.from("vendedores").select("codigo, nombre").eq("activo", true);
  const cands = [from?.username, from?.first_name].filter(Boolean).map((x: string) => sinTilde(x).split(/\s+/)[0]);
  for (const v of vs ?? []) {
    const c = sinTilde(v.codigo), n = sinTilde(String(v.nombre ?? "")).split(/[\s(]+/)[0];
    if (cands.some((q) => q === c || q === n)) return v.codigo;
  }
  return null;
}

// ---------- foto ----------
const VISION_MAX = 3_700_000;   // bytes crudos que entran en Vision (5 MB en base64)
async function bajarArchivo(fileId: string): Promise<Uint8Array | null> {
  const j = await tg("getFile", { file_id: fileId });
  const path = j?.result?.file_path;
  if (!path) return null;
  const res = await fetch(`https://api.telegram.org/file/bot${BOT}/${path}`);
  if (!res.ok) return null;
  return new Uint8Array(await res.arrayBuffer());
}
// Foto comprimida (m.photo) o foto mandada como archivo (m.document image/*, conserva el EXIF con GPS).
async function bajarFoto(m: any): Promise<{ bytes: Uint8Array; fileId: string; mime: string; gps: { lat: number; lon: number } | null } | null> {
  if (m.document) {
    const bytes = await bajarArchivo(m.document.file_id);
    if (!bytes) return null;
    return { bytes, fileId: m.document.file_id, mime: m.document.mime_type ?? "image/jpeg", gps: gpsExif(bytes) };
  }
  // la más grande que entre cómoda en Vision
  const ordenadas = [...m.photo].sort((a: any, b: any) => (b.file_size ?? 0) - (a.file_size ?? 0));
  const elegida = ordenadas.find((p: any) => (p.file_size ?? 0) <= VISION_MAX) ?? ordenadas[ordenadas.length - 1];
  const bytes = await bajarArchivo(elegida.file_id);
  return bytes ? { bytes, fileId: elegida.file_id, mime: "image/jpeg", gps: null } : null;
}

// GPS del EXIF de un JPEG (APP1 "Exif" → IFD0 → GPS IFD). null si no tiene.
function gpsExif(b: Uint8Array): { lat: number; lon: number } | null {
  try {
    if (b[0] !== 0xff || b[1] !== 0xd8) return null;
    let p = 2;
    while (p + 4 < b.length && b[p] === 0xff) {
      const marca = b[p + 1], largo = (b[p + 2] << 8) | b[p + 3];
      if (marca === 0xe1 && b[p + 4] === 0x45 && b[p + 5] === 0x78 && b[p + 6] === 0x69 && b[p + 7] === 0x66) {
        const t = p + 10;                                   // inicio del TIFF
        const le = b[t] === 0x49;                           // "II" little endian
        const u16 = (o: number) => le ? b[t + o] | (b[t + o + 1] << 8) : (b[t + o] << 8) | b[t + o + 1];
        const u32 = (o: number) => (le ? (b[t + o] | (b[t + o + 1] << 8) | (b[t + o + 2] << 16) | (b[t + o + 3] << 24)) : ((b[t + o] << 24) | (b[t + o + 1] << 16) | (b[t + o + 2] << 8) | b[t + o + 3])) >>> 0;
        const ifd0 = u32(4);
        let gpsOff = 0;
        for (let i = 0, n = u16(ifd0); i < n; i++) { const e = ifd0 + 2 + i * 12; if (u16(e) === 0x8825) gpsOff = u32(e + 8); }
        if (!gpsOff) return null;
        const tags: Record<number, number> = {};
        for (let i = 0, n = u16(gpsOff); i < n; i++) { const e = gpsOff + 2 + i * 12; tags[u16(e)] = e; }
        const ref = (tag: number) => tags[tag] ? String.fromCharCode(b[t + tags[tag] + 8]) : "";
        const grados = (tag: number) => {
          if (!tags[tag]) return null;
          const o = u32(tags[tag] + 8);
          const r = (k: number) => { const d = u32(o + k * 8 + 4); return d ? u32(o + k * 8) / d : 0; };
          return r(0) + r(1) / 60 + r(2) / 3600;
        };
        const lat = grados(2), lon = grados(4);
        if (lat == null || lon == null || (lat === 0 && lon === 0)) return null;
        return { lat: ref(1) === "S" ? -lat : lat, lon: ref(3) === "W" ? -lon : lon };
      }
      if (marca === 0xda) break;                            // empieza la imagen: no hay EXIF
      p += 2 + largo;
    }
  } catch { /* EXIF roto */ }
  return null;
}
function base64(b: Uint8Array) {
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}
async function subirFoto(b: Uint8Array, vendedor: string, mime = "image/jpeg"): Promise<string | null> {
  const ext = mime.includes("png") ? "png" : mime.includes("webp") ? "webp" : mime.includes("heic") ? "heic" : "jpg";
  const nombre = `checkin/${vendedor}/${hoyAR()}-${Date.now().toString(36)}.${ext}`;
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/optica-fotos/${nombre}`, {
    method: "POST", headers: { Authorization: `Bearer ${SERVICE_KEY}`, apikey: SERVICE_KEY, "Content-Type": mime }, body: b,
  });
  if (!res.ok) { console.error("storage", res.status, await res.text()); return null; }
  return `${SUPABASE_URL}/storage/v1/object/public/optica-fotos/${nombre}`;
}

type Analisis = {
  es_optica: boolean; nombre_cartel: string | null; tiene_orbital: boolean; donde_orbital: string | null;
  marcas_visibles: string[]; exhibidores_pop: string[]; espacio_vidriera: "bajo" | "medio" | "alto";
  espacio_mostrador: "bajo" | "medio" | "alto" | "no_se_ve"; nivel_local: "economico" | "medio" | "premium";
  estado_vidriera: string; observaciones: string; pop_sugerido: number; pop_motivo: string; confianza: number;
};

async function leerVidriera(b: Uint8Array, niveles: any[], contextoCliente: string, mime = "image/jpeg"): Promise<Analisis | null> {
  if (!ANTHROPIC_API_KEY || b.length > VISION_MAX || !/jpeg|png|webp|gif/.test(mime)) return null;
  const menu = niveles.map((n) => `${n.nivel} = ${n.nombre}: ${n.descripcion}. Condición: ${n.condicion}`).join("\n");
  const prompt = `Sos el auditor de puntos de venta de Orbital Eyewear (marca argentina premium de anteojos, con lentes Blue Cut + infrarrojo "Triple Protección"). Un vendedor sacó esta foto de la vidriera o del interior de una óptica.
${contextoCliente}
Analizá la foto y contestá SOLO un JSON con estas claves:
- es_optica (bool): si el local parece una óptica / casa de anteojos.
- nombre_cartel (string|null): el nombre del comercio tal como se lee en cartel, toldo o vidrio (null si no se lee).
- tiene_orbital (bool) y donde_orbital (string|null): si se ve producto, cartelería o exhibidor de Orbital y dónde.
- marcas_visibles (string[]): marcas de anteojos que se distinguen (logos, cartelería, exhibidores). Vacío si ninguna.
- exhibidores_pop (string[]): material de exhibición que se ve (displays, exhibidores de mostrador, vinilos, carteles iluminados, de qué marca si se sabe).
- espacio_vidriera ("bajo"|"medio"|"alto"): cuánto espacio libre o aprovechable hay en la vidriera para sumar un display.
- espacio_mostrador ("bajo"|"medio"|"alto"|"no_se_ve").
- nivel_local ("economico"|"medio"|"premium"): por fachada, vidriera, iluminación, marcas.
- estado_vidriera (string, máx 120 caracteres): descripción corta (orden, iluminación, cantidad de producto, estilo).
- observaciones (string, máx 200 caracteres): lo que un gerente comercial querría saber.
- pop_sugerido (int) y pop_motivo (string, máx 160 caracteres): qué nivel de POP conviene ofrecerle, eligiendo del menú:
${menu}
Regla: si no hay nada de Orbital, arrancá por un nivel que se pueda poner hoy mismo; si ya tiene Orbital y hay espacio, subí un nivel. Si no es óptica, pop_sugerido = 1.
- confianza (0 a 1): qué tan segura es la lectura del nombre.
Español rioplatense. Sin texto fuera del JSON.`;
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: "claude-sonnet-5-5", max_tokens: 1200,
        messages: [{ role: "user", content: [
          { type: "image", source: { type: "base64", media_type: mime, data: base64(b) } },
          { type: "text", text: prompt },
        ] }],
      }),
    });
    const d = await r.json();
    if (d?.error) { console.error("anthropic", JSON.stringify(d.error)); return null; }
    const txt: string = d?.content?.find((c: any) => c.type === "text")?.text ?? "";
    const m = txt.replace(/```json|```/g, "").match(/\{[\s\S]*\}/);
    return m ? JSON.parse(m[0]) : null;
  } catch (e) { console.error("vision", String(e)); return null; }
}

// ---------- ubicación ----------
async function direccionDe(lat: number, lon: number): Promise<string | null> {
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}&zoom=18&accept-language=es`, {
      headers: { "User-Agent": "OrbitalSuite/1.0 (orbitaleyewear.com.ar)" },
    });
    const j = await r.json();
    const a = j?.address ?? {};
    const calle = [a.road, a.house_number].filter(Boolean).join(" ");
    const loc = a.city || a.town || a.village || a.suburb || a.city_district || "";
    return [calle, a.neighbourhood || a.suburb, loc].filter(Boolean).join(", ") || j?.display_name?.split(",").slice(0, 3).join(",") || null;
  } catch { return null; }
}

// ---------- candidatos ----------
// fuerte = el cartel coincide con este cliente y con ningún otro de la zona (sirve para el check-in automático)
type Cand = { cod: string; nombre: string; motivo: string; distancia_m?: number; localidad?: string | null; fuerte?: boolean };

async function candidatos(vendedor: string | null, lat: number | null, lon: number | null, nombre: string | null): Promise<Cand[]> {
  const out: Cand[] = [];
  const visto = new Set<string>();
  const push = (c: Cand) => { if (!visto.has(c.cod)) { visto.add(c.cod); out.push(c); } };
  const nombreCli = (c: any) => (c?.nomcomerc?.trim() || c?.razon || c?.cod) as string;
  const tokens = nombre ? sinTilde(nombre).replace(/\boptica\b|\bopticas\b|\bcasa\b|\bde\b|\bla\b|\bel\b|\blos\b/g, " ").split(/\s+/).filter((t) => t.length >= 3) : [];
  const parecido = (c: any) => {
    if (!tokens.length) return false;
    const n = sinTilde(`${c.nomcomerc ?? ""} ${c.razon ?? ""}`);
    return tokens.filter((t) => n.includes(t)).length >= Math.min(2, tokens.length);
  };

  // 1) ruta del día (armada por la primera foto) + agenda de campo sugerida del vendedor
  if (vendedor) {
    const cods = [...new Set([...(await rutaPendiente(vendedor)).map((r) => r.cod_cliente), ...(await agendaHoy(vendedor))])];
    {
      if (cods.length) {
        const { data: cl } = await sb.from("clientes").select("cod, nomcomerc, razon, localidad, lat, lon").in("cod", cods);
        const conDist = (cl ?? []).map((c: any) => {
          const d = (lat != null && lon != null && c.lat != null) ? distM(lat, lon, Number(c.lat), Number(c.lon)) : null;
          return { c, d };
        });
        // si hay GPS: los de la agenda que están a menos de 300 m, primero; si no, los que se parecen al cartel; si no hay nada de eso, toda la agenda (máx 4)
        const cerca = conDist.filter((x) => x.d != null && x.d <= 300).sort((a, b) => a.d! - b.d!);
        for (const x of cerca) push({ cod: x.c.cod, nombre: nombreCli(x.c), motivo: `en tu ruta de hoy · ${Math.round(x.d!)} m`, distancia_m: x.d!, localidad: x.c.localidad });
        const conCartel = conDist.filter((x) => parecido(x.c));
        for (const x of conCartel) push({ cod: x.c.cod, nombre: nombreCli(x.c), motivo: "en tu ruta de hoy · coincide el cartel", localidad: x.c.localidad, fuerte: conCartel.length === 1 });
        if (!out.length && lat == null && !tokens.length) for (const x of conDist.slice(0, 4)) push({ cod: x.c.cod, nombre: nombreCli(x.c), motivo: "en tu agenda de hoy", localidad: x.c.localidad });
      }
    }
  }
  // 2) clientes cerca
  if (lat != null && lon != null) {
    const { data: cerca } = await sb.rpc("checkin_clientes_cerca", { p_lat: lat, p_lon: lon, p_radio_m: RADIO_M, p_limit: 4 });
    for (const c of (cerca ?? []) as any[]) if (Number(c.distancia_m) <= RADIO_M) push({ cod: c.cod, nombre: c.nombre, motivo: `a ${c.distancia_m} m${c.geo_aproximado ? " (ubicación aprox.)" : ""}`, distancia_m: Number(c.distancia_m), localidad: c.localidad });
  }
  // 3) nombre leído en el cartel
  if (tokens.length && out.length < 4) {
    const ors = tokens.slice(0, 3).map((t) => `nomcomerc.ilike.%${t}%,razon.ilike.%${t}%`).join(",");
    const { data: porNombre } = await sb.from("clientes").select("cod, nomcomerc, razon, localidad, lat, lon").or(ors).limit(30);
    const lista = (porNombre ?? []).filter((c: any) => parecido(c) && !["888888", "888889"].includes(c.cod));
    // con GPS, sólo los de la zona (10 km) o sin geo
    const filtrada = lat != null ? lista.filter((c: any) => c.lat == null || distM(lat, lon!, Number(c.lat), Number(c.lon)) <= 10_000) : lista;
    for (const c of filtrada.slice(0, 3)) push({ cod: c.cod, nombre: nombreCli(c), motivo: `coincide el cartel${c.localidad ? ` · ${c.localidad}` : ""}`, localidad: c.localidad, fuerte: filtrada.length === 1 });
  }
  return out.slice(0, 4);
}
function distM(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371000, r = Math.PI / 180;
  const a = Math.sin((lat2 - lat1) * r / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin((lon2 - lon1) * r / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// ---------- el check-in pendiente del vendedor ----------
async function pendienteDe(userId: number, chatId: number) {
  const desde = new Date(Date.now() - VENTANA_MIN * 60_000).toISOString();
  const { data } = await sb.from("visitas_checkin").select("*").eq("telegram_user_id", userId).eq("telegram_chat_id", chatId)
    .in("estado", ["pendiente", "esperando_nombre"]).gte("creado_en", desde).order("creado_en", { ascending: false }).limit(1).maybeSingle();
  return data;
}

function resumenAnalisis(a: Analisis | null, direccion: string | null): string {
  if (!a) return direccion ? `📍 ${esc(direccion)}` : "";
  const partes: string[] = [];
  if (a.nombre_cartel) partes.push(`🏪 Cartel: <b>${esc(a.nombre_cartel)}</b>`);
  if (direccion) partes.push(`📍 ${esc(direccion)}`);
  partes.push(a.tiene_orbital ? `🟢 Orbital presente${a.donde_orbital ? ` (${esc(a.donde_orbital)})` : ""}` : "🔴 Sin presencia de Orbital");
  if (a.marcas_visibles?.length) partes.push(`👓 Marcas: ${esc(a.marcas_visibles.slice(0, 6).join(", "))}`);
  if (a.exhibidores_pop?.length) partes.push(`🧱 POP visible: ${esc(a.exhibidores_pop.slice(0, 4).join(", "))}`);
  partes.push(`🪟 Espacio en vidriera: ${a.espacio_vidriera} · mostrador: ${a.espacio_mostrador?.replace("_", " ")} · local ${a.nivel_local}`);
  if (a.estado_vidriera) partes.push(`📝 ${esc(a.estado_vidriera)}`);
  return partes.join("\n");
}

// Check-in automático: sólo cuando no hay dudas. Si no, botones.
function elegirAuto(cands: Cand[], a: Analisis | null): Cand | null {
  if (!cands.length) return null;
  const pegados = cands.filter((c) => c.distancia_m != null && c.distancia_m <= 60);
  if (pegados.length === 1) return pegados[0];
  const fuertes = cands.filter((c) => c.fuerte);
  if (fuertes.length === 1 && (a?.confianza ?? 0) >= 0.7 && a?.es_optica !== false) return fuertes[0];
  return null;
}

async function proponer(ck: any, vendedor: string | null, chatId: number, replyTo: number) {
  const cands = await candidatos(vendedor, ck.lat != null ? Number(ck.lat) : null, ck.lon != null ? Number(ck.lon) : null, ck.nombre_detectado);
  const a = ck.analisis as Analisis | null;
  const auto = elegirAuto(cands, a);
  if (auto) {
    await sb.from("visitas_checkin").update({ candidatos: cands }).eq("id", ck.id);
    await confirmar({ ...ck, candidatos: cands }, auto.cod, chatId, replyTo, false, true);
    return;
  }
  await proponerConBotones(ck, vendedor, chatId, replyTo, null, cands);
}

async function proponerConBotones(ck: any, vendedor: string | null, chatId: number, replyTo: number, excluir: string | null, candsPrevios?: Cand[]) {
  const cands = (candsPrevios ?? await candidatos(vendedor, ck.lat != null ? Number(ck.lat) : null, ck.lon != null ? Number(ck.lon) : null, ck.nombre_detectado))
    .filter((c) => c.cod !== excluir);
  const a = ck.analisis as Analisis | null;
  const botones = cands.map((c) => [{ text: `✅ ${c.nombre.slice(0, 40)} — ${c.motivo.slice(0, 30)}`, callback_data: `ck:${ck.id}:${c.cod}` }]);
  botones.push([{ text: "🆕 No es cliente → cargar prospecto", callback_data: `ck:${ck.id}:NUEVO` }, { text: "✏️ Es otro", callback_data: `ck:${ck.id}:OTRO` }]);
  if (ck.lat != null && ck.vendedor) botones.push([{ text: "🗺️ No es una óptica: solo armame la ruta desde acá", callback_data: `ck:${ck.id}:RUTA` }]);
  botones.push([{ text: "🗑 Descartar", callback_data: `ck:${ck.id}:NO` }]);
  const noEsOptica = a?.es_optica === false;
  const falta = ck.lat == null && !ck.foto_url ? ""
    : ck.lat == null ? (noEsOptica
      ? "\n\n👉 <b>Compartí tu ubicación</b> (📎 → Ubicación) y te armo la ruta del día con las ópticas de la zona."
      : "\n\n<i>Si compartís tu ubicación 📎→Ubicación afino la búsqueda y te armo la ruta del día.</i>")
    : !ck.foto_url ? "\n\n<i>Mandame la foto de la vidriera 📷 y la leo.</i>" : "";
  const titulo = noEsOptica && !cands.length ? "Esto no parece una óptica 🤔" : cands.length ? "¿En qué óptica estás?" : "No encuentro un cliente que coincida. ¿Es un local nuevo?";
  const texto = `📍 <b>Check-in${vendedor ? ` de ${esc(vendedor)}` : ""}</b>\n${resumenAnalisis(a, ck.direccion_geo)}\n\n${titulo}${falta}`;
  const mid = await enviar(chatId, texto, { reply_to_message_id: replyTo, reply_markup: { inline_keyboard: botones } });
  await sb.from("visitas_checkin").update({ candidatos: cands, aviso_message_id: mid ?? null, estado: "pendiente" }).eq("id", ck.id);
}

// ---------- mensajes ----------
async function manejarMensaje(m: any) {
  const chatId = Number(m.chat.id), userId = Number(m.from?.id), messageId = Number(m.message_id);
  const vendedor = await vendedorDe(m.from);
  const esFoto = (Array.isArray(m.photo) && m.photo.length > 0) || /^image\//.test(m.document?.mime_type ?? "");
  const esUbic = !!m.location;

  if (!vendedor && (esFoto || esUbic)) {
    await enviar(chatId, "No sé de qué vendedor es este check-in 🤔. Pedile a Gastón que te sume a la lista de vendedores de Ojo.", { reply_to_message_id: messageId });
    return;
  }

  // Respuesta con el nombre ("¿Cómo se llama?")
  if (m.text && m.reply_to_message?.message_id) {
    const { data: ck } = await sb.from("visitas_checkin").select("*").eq("telegram_chat_id", chatId).eq("aviso_message_id", m.reply_to_message.message_id).eq("estado", "esperando_nombre").maybeSingle();
    if (!ck) return;
    const nombre = String(m.text).trim();
    const { data: ficha } = await sb.rpc("ojo_ficha_cliente", { p_texto: nombre });
    const cod = (ficha as any)?.cliente?.cod;
    if (cod) {
      await confirmar(ck, cod, chatId, messageId, false);
      return;
    }
    await sb.from("visitas_checkin").update({ nombre_detectado: nombre }).eq("id", ck.id);
    const botones = [[{ text: `🆕 Cargar "${nombre.slice(0, 30)}" como prospecto`, callback_data: `ck:${ck.id}:NUEVO` }], [{ text: "🗑 Descartar", callback_data: `ck:${ck.id}:NO` }]];
    const mid = await enviar(chatId, `No tengo ningún cliente que se llame <b>${esc(nombre)}</b>. ¿Lo cargo como prospecto?`, { reply_to_message_id: messageId, reply_markup: { inline_keyboard: botones } });
    await sb.from("visitas_checkin").update({ aviso_message_id: mid ?? null, estado: "pendiente" }).eq("id", ck.id);
    return;
  }

  if (!esFoto && !esUbic) return;
  // Lo que falta de un check-in que ya se confirmó solo (ubicación → confirmado → llega la foto, o al revés).
  const reciente = await confirmadoReciente(userId, chatId);
  if (reciente && ((esFoto && !reciente.foto_url) || (esUbic && reciente.lat == null))) {
    await completarConfirmado(reciente, m, esFoto, chatId, messageId);
    return;
  }
  let ck = await pendienteDe(userId, chatId);
  // Si lo pendiente ya tiene lo que llega (otra foto, otra ubicación), es una visita nueva.
  if (ck && ((esFoto && ck.foto_url) || (esUbic && ck.lat != null))) ck = null;
  if (!ck) {
    const { data } = await sb.from("visitas_checkin").insert({ vendedor, telegram_user_id: userId, telegram_chat_id: chatId, telegram_message_id: messageId }).select().single();
    ck = data;
  }
  if (ck.aviso_message_id) await tg("editMessageReplyMarkup", { chat_id: chatId, message_id: ck.aviso_message_id, reply_markup: { inline_keyboard: [] } });

  const cambios: Record<string, unknown> = {};
  if (esUbic) {
    cambios.lat = m.location.latitude; cambios.lon = m.location.longitude;
    cambios.precision_m = m.location.horizontal_accuracy ?? null;
    cambios.direccion_geo = await direccionDe(m.location.latitude, m.location.longitude);
  }
  if (esUbic) cambios.gps_origen = "ubicacion";
  if (esFoto) {
    const f = await bajarFoto(m);
    if (!f) { await enviar(chatId, "No pude bajar la foto de Telegram, probá mandarla de nuevo.", { reply_to_message_id: messageId }); return; }
    if (f.gps && ck.lat == null && !esUbic) {
      cambios.lat = f.gps.lat; cambios.lon = f.gps.lon; cambios.gps_origen = "exif";
      cambios.direccion_geo = await direccionDe(f.gps.lat, f.gps.lon);
    }
    const [url, niveles] = await Promise.all([subirFoto(f.bytes, vendedor!, f.mime), sb.from("pop_niveles").select("*").eq("activo", true).order("nivel")]);
    const dir = (cambios.direccion_geo as string | undefined) ?? ck.direccion_geo;
    const ctx = dir ? `El vendedor está en: ${dir}.` : "";
    const a = await leerVidriera(f.bytes, niveles.data ?? [], ctx, f.mime);
    cambios.foto_url = url; cambios.foto_file_id = f.fileId; cambios.analisis = a;
    cambios.nombre_detectado = a?.nombre_cartel ?? ck.nombre_detectado ?? null;
    cambios.pop_sugerido = a?.pop_sugerido ?? null; cambios.pop_motivo = a?.pop_motivo ?? null;
    if (m.caption) cambios.nombre_detectado = cambios.nombre_detectado ?? String(m.caption).slice(0, 80);
  }
  const { data: actualizado } = await sb.from("visitas_checkin").update(cambios).eq("id", ck.id).select().single();
  await proponer(actualizado ?? { ...ck, ...cambios }, vendedor, chatId, messageId);
}

// ---------- botones ----------
async function manejarCallback(cq: any) {
  const [, idStr, eleccion] = String(cq.data ?? "").split(":");
  const chatId = Number(cq.message?.chat?.id), msgId = Number(cq.message?.message_id);
  const { data: ck } = await sb.from("visitas_checkin").select("*").eq("id", Number(idStr)).maybeSingle();
  if (!ck) { await tg("answerCallbackQuery", { callback_query_id: cq.id, text: "Ese check-in ya no está" }); return; }
  if (Number(cq.from?.id) !== Number(ck.telegram_user_id) && !(await esAdmin(Number(cq.from?.id)))) {
    await tg("answerCallbackQuery", { callback_query_id: cq.id, text: "Esto lo confirma quien hizo el check-in 🙂" }); return;
  }
  if (eleccion === "DESHACER") {
    if (ck.estado !== "confirmado") { await tg("answerCallbackQuery", { callback_query_id: cq.id, text: "Ya estaba abierto" }); return; }
    await tg("editMessageReplyMarkup", { chat_id: chatId, message_id: msgId, reply_markup: { inline_keyboard: [] } });
    await tg("answerCallbackQuery", { callback_query_id: cq.id, text: "Deshecho, elegí la óptica" });
    const abierto = await deshacer(ck);
    await proponerConBotones(abierto, ck.vendedor, chatId, msgId, ck.cod_cliente);
    return;
  }
  if (ck.estado === "confirmado" || ck.estado === "descartado") { await tg("answerCallbackQuery", { callback_query_id: cq.id, text: "Ya estaba cerrado" }); return; }
  await tg("editMessageReplyMarkup", { chat_id: chatId, message_id: msgId, reply_markup: { inline_keyboard: [] } });

  if (eleccion === "NO") {
    await sb.from("visitas_checkin").update({ estado: "descartado" }).eq("id", ck.id);
    await tg("answerCallbackQuery", { callback_query_id: cq.id, text: "Descartado" });
    return;
  }
  if (eleccion === "RUTA") {
    // arranque desde un lugar que no es óptica (casa, fábrica, estación): no hay visita, sólo la ruta
    await sb.from("visitas_checkin").update({ estado: "descartado" }).eq("id", ck.id);
    await tg("answerCallbackQuery", { callback_query_id: cq.id, text: "Armando la ruta…" });
    const hoy = hoyAR();
    const { count } = await sb.from("ruta_dia").select("id", { count: "exact", head: true }).eq("vendedor", ck.vendedor).eq("fecha", hoy);
    if (count) await sb.from("ruta_dia").delete().eq("vendedor", ck.vendedor).eq("fecha", hoy).eq("visitado", false);
    const texto = await armarRuta(ck.vendedor, ck.id, Number(ck.lat), Number(ck.lon), ck.direccion_geo?.split(",").pop()?.trim() ?? null, !!count);
    await enviar(chatId, texto, { reply_to_message_id: msgId });
    return;
  }
  if (eleccion === "OTRO") {
    const mid = await enviar(chatId, "¿Cómo se llama la óptica? <b>Respondé este mensaje</b> con el nombre (o el código de cliente).", { reply_to_message_id: msgId });
    await sb.from("visitas_checkin").update({ estado: "esperando_nombre", aviso_message_id: mid ?? null }).eq("id", ck.id);
    await tg("answerCallbackQuery", { callback_query_id: cq.id });
    return;
  }
  if (eleccion === "NUEVO") {
    await tg("answerCallbackQuery", { callback_query_id: cq.id, text: "Cargando prospecto…" });
    const cod = await altaProspecto(ck);
    if (!cod) { await enviar(chatId, "No pude cargar el prospecto. Avisale a Gastón.", { reply_to_message_id: msgId }); return; }
    await confirmar(ck, cod, chatId, msgId, true);
    return;
  }
  await tg("answerCallbackQuery", { callback_query_id: cq.id, text: "✅ Visita registrada" });
  await confirmar(ck, eleccion, chatId, msgId, false);
}

async function esAdmin(id: number) {
  const { data } = await sb.from("ojo_admins").select("telegram_user_id").eq("telegram_user_id", id).maybeSingle();
  return !!data;
}

async function altaProspecto(ck: any): Promise<string | null> {
  const nombre = (ck.nombre_detectado && String(ck.nombre_detectado).trim()) || `Óptica sin nombre (${ck.direccion_geo ?? hoyAR()})`;
  const cod = `TMP-${Date.now().toString().slice(-8)}`;
  const a = ck.analisis as Analisis | null;
  const partes = (ck.direccion_geo ?? "").split(",").map((s: string) => s.trim());
  const { error } = await sb.from("clientes").insert({
    cod, razon: nombre, nomcomerc: nombre,
    direccion: partes[0] || null, barrio: partes.length > 2 ? partes[1] : null, localidad: partes[partes.length - 1] || null,
    lat: ck.lat, lon: ck.lon, geo_aproximado: false, geo_intentado: ck.lat != null,
    vendedor_asignado: ck.vendedor, origen: "propio", clasificacion_recupero: "sin_historial", nro_lista: 5,
    foto_vidriera_url: ck.foto_url, vidriera_analisis: a, vidriera_fecha: new Date().toISOString(),
    tiene_orbital: a?.tiene_orbital ?? null, pop_nivel: null,
    nota: `⏳ Código de cliente pendiente — pedir a Administración. Prospecto por check-in de ${ck.vendedor} (foto de vidriera).`,
    actualizado_en: new Date().toISOString(),
  });
  if (error) { console.error("alta prospecto", JSON.stringify(error)); return null; }
  return cod;
}

async function confirmar(ck: any, cod: string, chatId: number, replyTo: number, nuevo: boolean, auto = false) {
  const { data: cli } = await sb.from("clientes").select("cod, nomcomerc, razon, localidad, lat, lon, unidades_2025, ultima_compra_fecha, vendedor_asignado, tiene_orbital, pop_nivel, foto_vidriera_url, vidriera_analisis, vidriera_fecha").eq("cod", cod).maybeSingle();
  if (!cli) { await enviar(chatId, `No encuentro el cliente ${esc(cod)}.`, { reply_to_message_id: replyTo }); return; }
  const nombre = cli.nomcomerc?.trim() || cli.razon || cli.cod;
  const a = ck.analisis as Analisis | null;
  const ahora = new Date().toISOString();

  // ficha del cliente: foto, análisis, coordenadas si no tenía (lo anterior se guarda para poder deshacer)
  const previo = { foto_vidriera_url: cli.foto_vidriera_url, vidriera_analisis: cli.vidriera_analisis, vidriera_fecha: cli.vidriera_fecha, tiene_orbital: cli.tiene_orbital, lat: cli.lat, lon: cli.lon };
  const upd: Record<string, unknown> = { actualizado_en: ahora };
  if (ck.foto_url) { upd.foto_vidriera_url = ck.foto_url; upd.vidriera_analisis = a; upd.vidriera_fecha = ahora; upd.tiene_orbital = a?.tiene_orbital ?? null; }
  if (ck.lat != null && cli.lat == null) { upd.lat = ck.lat; upd.lon = ck.lon; upd.geo_aproximado = false; upd.geo_intentado = true; }
  await sb.from("clientes").update(upd).eq("cod", cod);

  // visita: agenda de campo (sugerida) + actividad diaria
  const { data: enAgenda } = await sb.from("agenda_campo").select("id").eq("vendedor", ck.vendedor).eq("cod_cliente", cod).eq("visitado", false).limit(1);
  const agendaId = enAgenda?.[0]?.id ?? null;
  if (agendaId) await sb.from("agenda_campo").update({ visitado: true, resultado: "visito" }).eq("id", agendaId);
  const detalle = a ? `${a.tiene_orbital ? "con Orbital" : "sin Orbital"}; marcas: ${(a.marcas_visibles ?? []).slice(0, 5).join(", ") || "-"}; vidriera ${a.espacio_vidriera}` : "";
  const { data: act } = await sb.from("actividad_diaria").insert({
    fecha: hoyAR(), vendedor: ck.vendedor, cod_cliente: cod, nombre_comercio: nombre, localidad: cli.localidad,
    origen: "checkin", resultado_contacto: "visito",
    actividad_desarrollo: `📍 Check-in ${ck.foto_url ? "con foto de vidriera" : "por ubicación"}${nuevo ? " (prospecto nuevo)" : ""}. ${detalle}`.trim(),
    nota_contexto: ck.foto_url ?? null,
  }).select("id").single();

  await sb.from("visitas_checkin").update({
    cod_cliente: cod, estado: "confirmado", es_prospecto_nuevo: nuevo, confirmado_en: ahora, automatico: auto,
    actividad_id: act?.id ?? null, agenda_campo_id: agendaId, cliente_previo: previo,
    gps_origen: ck.gps_origen ?? (ck.lat == null && cli.lat != null ? "cliente" : null),
  }).eq("id", ck.id);

  // POP sugerido, cruzado con lo que compra
  const { data: niveles } = await sb.from("pop_niveles").select("*").eq("activo", true).order("nivel");
  let nivel = a?.pop_sugerido ?? 1;
  const compra = Number(cli.unidades_2025 ?? 0);
  if (nuevo || cli.cod.startsWith("TMP-")) nivel = Math.min(nivel, 1);
  else if (!cli.ultima_compra_fecha && nivel > 2) nivel = 2;
  else if (compra >= 60 && a?.tiene_orbital && a.espacio_vidriera !== "bajo") nivel = Math.max(nivel, 3);
  const pop = (niveles ?? []).find((n) => n.nivel === nivel) ?? (niveles ?? [])[0];
  await sb.from("visitas_checkin").update({ pop_sugerido: pop?.nivel ?? null }).eq("id", ck.id);

  const lineas = [
    `✅ <b>Visita registrada</b>: ${esc(nombre)} (${esc(cod)})${nuevo ? " — prospecto nuevo cargado, Administración le pone el número" : ""}`,
  ];
  if (a) {
    lineas.push(a.tiene_orbital ? `🟢 Orbital presente${a.donde_orbital ? ` (${esc(a.donde_orbital)})` : ""}` : "🔴 Sin presencia de Orbital en el local");
    if (a.marcas_visibles?.length) lineas.push(`👓 Competencia visible: ${esc(a.marcas_visibles.slice(0, 6).join(", "))}`);
  }
  if (!nuevo) lineas.push(`🛒 Compró ${compra} u. en 2025${cli.ultima_compra_fecha ? ` · última compra ${String(cli.ultima_compra_fecha).slice(8, 10)}/${String(cli.ultima_compra_fecha).slice(5, 7)}/${String(cli.ultima_compra_fecha).slice(0, 4)}` : ""}`);
  if (pop) lineas.push(`\n🎁 <b>Para ofrecerle: nivel ${pop.nivel} — ${esc(pop.nombre)}</b>\n${esc(pop.descripcion ?? "")}${a?.pop_motivo ? `\n<i>${esc(a.pop_motivo)}</i>` : ""}`);
  if (a?.observaciones) lineas.push(`\n📝 ${esc(a.observaciones)}`);
  if (ck.foto_url) lineas.push(`\n<a href="${ck.foto_url}">Ver foto</a>`);

  // ruta del día: la arma el primer check-in, los siguientes la tachan
  const lat = ck.lat != null ? Number(ck.lat) : cli.lat != null ? Number(cli.lat) : null;
  const lon = ck.lon != null ? Number(ck.lon) : cli.lon != null ? Number(cli.lon) : null;
  const ruta = await rutaTrasVisita(ck, cod, lat, lon, cli.localidad);
  if (ruta.texto) lineas.push(`\n${ruta.texto}`);

  const extra: Record<string, unknown> = { reply_to_message_id: replyTo };
  if (auto) extra.reply_markup = { inline_keyboard: [[{ text: "✏️ No es esta óptica", callback_data: `ck:${ck.id}:DESHACER` }]] };
  if (auto) lineas[0] = lineas[0].replace("Visita registrada", "Check-in automático");
  await enviar(chatId, lineas.join("\n"), extra);
  if (ruta.nueva) await enviar(chatId, ruta.nueva, { disable_web_page_preview: true });
}

// ---------- deshacer un check-in automático ----------
async function deshacer(ck: any) {
  if (ck.actividad_id) await sb.from("actividad_diaria").delete().eq("id", ck.actividad_id);
  if (ck.agenda_campo_id) await sb.from("agenda_campo").update({ visitado: false, resultado: null }).eq("id", ck.agenda_campo_id);
  if (ck.cod_cliente && ck.cliente_previo) await sb.from("clientes").update(ck.cliente_previo).eq("cod", ck.cod_cliente);
  await sb.from("ruta_dia").update({ visitado: false, visitado_checkin_id: null, visitado_en: null }).eq("visitado_checkin_id", ck.id);
  // si esta visita armó la ruta, la ruta estaba anclada en el lugar equivocado: se rearma con el próximo check-in
  await sb.from("ruta_dia").delete().eq("origen_checkin_id", ck.id);
  const { data } = await sb.from("visitas_checkin").update({
    estado: "pendiente", cod_cliente: null, confirmado_en: null, automatico: false, actividad_id: null, agenda_campo_id: null, cliente_previo: null,
  }).eq("id", ck.id).select().single();
  return data ?? ck;
}

// ---------- check-in confirmado hace poco al que le llega lo que faltaba ----------
async function confirmadoReciente(userId: number, chatId: number) {
  const desde = new Date(Date.now() - VENTANA_MIN * 60_000).toISOString();
  const { data } = await sb.from("visitas_checkin").select("*").eq("telegram_user_id", userId).eq("telegram_chat_id", chatId)
    .eq("estado", "confirmado").gte("confirmado_en", desde).order("confirmado_en", { ascending: false }).limit(1).maybeSingle();
  return data;
}
async function completarConfirmado(ck: any, m: any, esFoto: boolean, chatId: number, messageId: number) {
  const cambios: Record<string, unknown> = {};
  let texto = "";
  if (esFoto) {
    const f = await bajarFoto(m);
    if (!f) { await enviar(chatId, "No pude bajar la foto de Telegram, probá mandarla de nuevo.", { reply_to_message_id: messageId }); return; }
    const { data: niveles } = await sb.from("pop_niveles").select("*").eq("activo", true).order("nivel");
    const url = await subirFoto(f.bytes, ck.vendedor, f.mime);
    const a = await leerVidriera(f.bytes, niveles ?? [], ck.direccion_geo ? `El vendedor está en: ${ck.direccion_geo}.` : "", f.mime);
    Object.assign(cambios, { foto_url: url, foto_file_id: f.fileId, analisis: a, nombre_detectado: a?.nombre_cartel ?? ck.nombre_detectado });
    if (a?.pop_sugerido) { cambios.pop_sugerido = a.pop_sugerido; cambios.pop_motivo = a.pop_motivo; }
    const ahora = new Date().toISOString();
    await sb.from("clientes").update({ foto_vidriera_url: url, vidriera_analisis: a, vidriera_fecha: ahora, tiene_orbital: a?.tiene_orbital ?? null, actualizado_en: ahora }).eq("cod", ck.cod_cliente);
    if (ck.actividad_id && a) await sb.from("actividad_diaria").update({
      actividad_desarrollo: `📍 Check-in con foto de vidriera. ${a.tiene_orbital ? "con Orbital" : "sin Orbital"}; marcas: ${(a.marcas_visibles ?? []).slice(0, 5).join(", ") || "-"}; vidriera ${a.espacio_vidriera}`,
      nota_contexto: url,
    }).eq("id", ck.actividad_id);
    texto = `📷 Foto sumada a la visita.\n${resumenAnalisis(a, null)}${a?.pop_motivo ? `\n🎁 <i>${esc(a.pop_motivo)}</i>` : ""}`;
  } else {
    cambios.lat = m.location.latitude; cambios.lon = m.location.longitude; cambios.gps_origen = "ubicacion";
    texto = "📍 Ubicación sumada a la visita.";
    // si no había ruta porque faltaba la zona, ahora se arma
    const r = await rutaTrasVisita({ ...ck, ...cambios }, ck.cod_cliente, m.location.latitude, m.location.longitude, null);
    if (r.nueva) texto += `\n\n${r.nueva}`;
  }
  await sb.from("visitas_checkin").update(cambios).eq("id", ck.id);
  await enviar(chatId, texto, { reply_to_message_id: messageId });
}

// ---------- ruta del día ----------
const RUTA_PARADAS = 11;     // + la visita que la arma = 12 de campo por día
const RUTA_RADIO_M = 2500;   // zona de la foto; si hay pocas se agranda
const REARMAR_M = 4000;      // si aparece a más de esto de lo que le queda, se rearma desde ahí
const PRIORIDAD: Record<string, number> = { activo: 40, fidelizacion: 35, "2024": 30, "2022_2023": 22, "2021_o_antes": 15, sin_historial: 10 };

async function agendaHoy(vendedor: string): Promise<string[]> {
  const { data: dn } = await sb.rpc("ojo_dia_num", { p_fecha: hoyAR() });
  const dia = Number(dn);
  if (!dia) return [];
  const { data } = await sb.from("agenda_campo").select("cod_cliente").eq("vendedor", vendedor).eq("dia_num", dia).eq("visitado", false).order("orden_en_dia");
  return (data ?? []).map((r) => r.cod_cliente);
}
async function rutaPendiente(vendedor: string) {
  const { data } = await sb.from("ruta_dia").select("cod_cliente, orden").eq("vendedor", vendedor).eq("fecha", hoyAR()).eq("visitado", false).order("orden");
  return data ?? [];
}
const mapsPunto = (lat: number, lon: number) => `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`;

// Marca la visita en la ruta; si no hay ruta hoy (o el vendedor se fue lejos de lo que le queda), la arma.
// texto = línea de avance para el mensaje de la visita; nueva = mensaje aparte con la ruta armada.
async function rutaTrasVisita(ck: any, cod: string, lat: number | null, lon: number | null, localidad: string | null): Promise<{ texto?: string; nueva?: string }> {
  const vendedor = ck.vendedor as string;
  const hoy = hoyAR();
  const ahora = new Date().toISOString();
  const { data: rutaHoy } = await sb.from("ruta_dia").select("id, cod_cliente, orden, visitado").eq("vendedor", vendedor).eq("fecha", hoy).order("orden");
  const enRuta = (rutaHoy ?? []).find((r) => r.cod_cliente === cod);
  if (enRuta && !enRuta.visitado) await sb.from("ruta_dia").update({ visitado: true, visitado_checkin_id: ck.id, visitado_en: ahora }).eq("id", enRuta.id);

  let rearmar = !(rutaHoy ?? []).length;
  if (!rearmar && !enRuta && lat != null && lon != null) {
    const pend = (rutaHoy ?? []).filter((r) => !r.visitado).map((r) => r.cod_cliente);
    if (pend.length) {
      const { data: cl } = await sb.from("clientes").select("lat, lon").in("cod", pend).not("lat", "is", null);
      const masCerca = Math.min(...(cl ?? []).map((c: any) => distM(lat, lon, Number(c.lat), Number(c.lon))));
      rearmar = Number.isFinite(masCerca) && masCerca > REARMAR_M;
    }
  }
  if (rearmar) {
    if (lat == null || lon == null) {
      return { texto: "🗺️ Para armarte la ruta de hoy con las ópticas de la zona necesito saber dónde estás: compartí tu <b>ubicación</b> (📎 → Ubicación) o mandá la foto como <b>archivo</b>." };
    }
    if ((rutaHoy ?? []).length) await sb.from("ruta_dia").delete().eq("vendedor", vendedor).eq("fecha", hoy).eq("visitado", false);
    if (!enRuta) await sb.from("ruta_dia").upsert({ fecha: hoy, vendedor, cod_cliente: cod, orden: 0, distancia_m: 0, motivo: "arranque (foto)", origen_checkin_id: ck.id, visitado: true, visitado_checkin_id: ck.id, visitado_en: ahora }, { onConflict: "fecha,vendedor,cod_cliente" });
    const nueva = await armarRuta(vendedor, ck.id, lat, lon, localidad, (rutaHoy ?? []).length > 0);
    return { nueva };
  }
  // avance
  const { data: r2 } = await sb.from("ruta_dia").select("cod_cliente, orden, visitado").eq("vendedor", vendedor).eq("fecha", hoy).order("orden");
  const total = (r2 ?? []).length, hechas = (r2 ?? []).filter((r) => r.visitado).length;
  const prox = (r2 ?? []).find((r) => !r.visitado);
  let proxTxt = "";
  if (prox) {
    const { data: pc } = await sb.from("clientes").select("nomcomerc, razon, direccion, lat, lon").eq("cod", prox.cod_cliente).maybeSingle();
    const d = pc?.lat != null && lat != null && lon != null ? ` (${Math.round(distM(lat, lon, Number(pc.lat), Number(pc.lon)))} m)` : "";
    proxTxt = pc ? ` · próxima: <b>${esc(pc.nomcomerc?.trim() || pc.razon)}</b>${d}${pc.lat != null ? ` <a href="${mapsPunto(Number(pc.lat), Number(pc.lon))}">mapa</a>` : ""}` : "";
  }
  return { texto: `🗺️ Ruta de hoy: <b>${hechas}/${total}</b>${enRuta ? "" : " (esta no estaba en la ruta, suma igual)"}${proxTxt}` };
}

async function armarRuta(vendedor: string, checkinId: number, lat: number, lon: number, localidad: string | null, esRearmado: boolean): Promise<string> {
  const hoy = hoyAR();
  const agenda = new Set(await agendaHoy(vendedor));
  const { data: ya } = await sb.from("ruta_dia").select("cod_cliente").eq("vendedor", vendedor).eq("fecha", hoy);
  const excluir = new Set((ya ?? []).map((r) => r.cod_cliente));

  let zona: any[] = [];
  for (const radio of [RUTA_RADIO_M, 5000, 10000]) {
    const { data } = await sb.rpc("ruta_opticas_zona", { p_lat: lat, p_lon: lon, p_radio_m: radio, p_limit: 120 });
    // las cuentas corporativas (cadenas) no se visitan en la calle
    zona = ((data ?? []) as any[]).filter((c) => !excluir.has(c.cod) && !c.visitado_reciente && c.vendedor_asignado !== "Corporativo");
    if (!localidad && data?.length) localidad = (data as any[])[0].localidad ?? null;
    if (zona.length >= RUTA_PARADAS * 2) break;
  }
  // cartera propia y sin dueño primero; las de otro vendedor sólo si no alcanza
  const propias = zona.filter((c) => !c.vendedor_asignado || c.vendedor_asignado === vendedor || agenda.has(c.cod));
  const ajenas = zona.filter((c) => !propias.includes(c));
  const puntaje = (c: any) => (agenda.has(c.cod) ? 100 : 0) + (PRIORIDAD[c.clasificacion_recupero] ?? 10)
    + (c.cod.startsWith("TMP-") ? 5 : 0) + (c.tiene_orbital === false ? 5 : 0) - Number(c.distancia_m) / 1000 * 8;
  let elegidas = [...propias].sort((a, b) => puntaje(b) - puntaje(a)).slice(0, RUTA_PARADAS);
  if (elegidas.length < RUTA_PARADAS) elegidas = elegidas.concat([...ajenas].sort((a, b) => puntaje(b) - puntaje(a)).slice(0, RUTA_PARADAS - elegidas.length));

  if (!elegidas.length) {
    return `🗺️ No tengo ópticas cargadas con ubicación cerca de ${localidad ? esc(localidad) : "acá"} (10 km) que no hayas visitado en las últimas 3 semanas. Seguí mandando fotos de cada óptica que visites y las voy sumando.`;
  }
  // orden de recorrido: el vecino más cercano desde la foto
  const orden: any[] = [];
  let px = lat, py = lon;
  const resto = [...elegidas];
  while (resto.length) {
    let i = 0, mejor = Infinity;
    resto.forEach((c, k) => { const d = distM(px, py, Number(c.lat), Number(c.lon)); if (d < mejor) { mejor = d; i = k; } });
    const [c] = resto.splice(i, 1);
    orden.push(c); px = Number(c.lat); py = Number(c.lon);
  }
  const motivoDe = (c: any) => agenda.has(c.cod) ? "estaba en tu agenda"
    : c.cod.startsWith("TMP-") ? "prospecto"
    : c.vendedor_asignado && c.vendedor_asignado !== vendedor ? `cartera de ${c.vendedor_asignado}`
    : ({ activo: "cliente activo", fidelizacion: "fidelizar", "2024": "compró en 2024", "2022_2023": "recuperar (22-23)", "2021_o_antes": "recuperar (≤2021)", sin_historial: "sin compras" } as Record<string, string>)[c.clasificacion_recupero] ?? "cartera";
  await sb.from("ruta_dia").upsert(orden.map((c, k) => ({
    fecha: hoy, vendedor, cod_cliente: c.cod, orden: k + 1, distancia_m: c.distancia_m, motivo: motivoDe(c),
    de_agenda: agenda.has(c.cod), origen_checkin_id: checkinId,
  })), { onConflict: "fecha,vendedor,cod_cliente" });

  const lineas = orden.map((c, k) =>
    `${k + 1}. <a href="${mapsPunto(Number(c.lat), Number(c.lon))}">${esc(c.nombre)}</a> — ${esc([c.direccion, c.localidad].filter(Boolean).join(", "))} · ${c.distancia_m < 1000 ? `${c.distancia_m} m` : `${(c.distancia_m / 1000).toFixed(1)} km`} · <i>${esc(motivoDe(c))}</i>`);
  const pts = orden.map((c) => `${c.lat},${c.lon}`);
  const recorrido = `https://www.google.com/maps/dir/?api=1&origin=${lat},${lon}&destination=${pts[pts.length - 1]}&travelmode=walking${pts.length > 1 ? `&waypoints=${encodeURIComponent(pts.slice(0, -1).slice(0, 9).join("|"))}` : ""}`;
  const deAgenda = orden.filter((c) => agenda.has(c.cod)).length;
  return [
    `🗺️ <b>${esRearmado ? "Te rearmé la ruta desde acá" : "Tu ruta de hoy"}</b> — ${orden.length} ópticas cerca de ${localidad ? esc(localidad) : "donde estás"}${deAgenda ? ` (${deAgenda} de tu agenda)` : ""}`,
    "",
    ...lineas,
    "",
    `🧭 <a href="${recorrido}">Abrir el recorrido en Google Maps</a>`,
    "<i>En cada una mandame la foto de la vidriera y la tacho. Si vas a otra que no está, también vale.</i>",
  ].join("\n");
}

// ---------- entrada ----------
Deno.serve(async (req: Request) => {
  const auth = req.headers.get("authorization") ?? "";
  const cronKey = req.headers.get("x-cron-key");
  const ok = auth === `Bearer ${SERVICE_KEY}` || (cronKey && cronKey === await cfg("cron_key"));
  if (!ok) return new Response("unauthorized", { status: 401 });
  try {
    const body = await req.json().catch(() => ({}));
    const u = body.update ?? body;
    if (u.callback_query) await manejarCallback(u.callback_query);
    else if (u.message) await manejarMensaje(u.message);
    return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: String((e as Error).message ?? e) }), { status: 500 });
  }
});
