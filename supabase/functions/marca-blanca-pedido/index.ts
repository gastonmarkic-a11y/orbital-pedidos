// Recibe el pedido de marca blanca que cierra el cliente desde ver.orbitaleyewear.com.ar/marca-blanca.
// Recalcula precios del lado servidor, guarda el logo en Storage, inserta la precarga
// en marca_blanca_pedidos y avisa al grupo Ojo de Telegram con el detalle y el logo.
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TG = `https://api.telegram.org/bot${Deno.env.get("TELEGRAM_BOT_TOKEN")!}`;
const GRUPO_FALLBACK = -5504692394;
const sb = createClient(SUPABASE_URL, SERVICE_KEY);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const FRAME = 10;
const LENS_PRICE: Record<string, number> = { b: 1.5, s: 3, e: 3, p: 5, f: 5 };
const LOGO_OK = ["image/png", "image/jpeg", "image/webp", "image/svg+xml", "application/pdf", "application/postscript", "application/illustrator"];

type Item = { m: number; col: string; lens: string; logo: string; q: number };

async function dolarHoy(): Promise<{ venta: number; fecha: string } | null> {
  try {
    const r = await fetch("https://dolarapi.com/v1/dolares/oficial");
    const j = await r.json();
    const fecha = new Date().toLocaleDateString("sv-SE", { timeZone: "America/Argentina/Buenos_Aires" });
    return j?.venta > 0 ? { venta: Number(j.venta), fecha } : null;
  } catch { return null; }
}

async function grupo(): Promise<number> {
  const { data } = await sb.from("ojo_grupos").select("telegram_chat_id").eq("activo", true).eq("recibe_avisos", true).limit(1).maybeSingle();
  return Number(data?.telegram_chat_id ?? GRUPO_FALLBACK);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "método no permitido" }, 405);
  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return json({ ok: false, error: "datos inválidos" }, 400); }

  const str = (k: string, max = 200) => String(b[k] ?? "").trim().slice(0, max);
  const marca = str("marca"), razon = str("razon_social"), email = str("email").toLowerCase(), tel = str("telefono", 40), obs = str("obs", 1000);
  const cuenta = b.cuenta === "plenorius" ? "plenorius" : "brubank";
  if (!marca || !razon) return json({ ok: false, error: "Completá la marca y la razón social." }, 400);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ ok: false, error: "Revisá el mail." }, 400);
  if (tel.replace(/\D/g, "").length < 8) return json({ ok: false, error: "Revisá el teléfono." }, 400);

  const raw = Array.isArray(b.items) ? (b.items as Item[]).slice(0, 60) : [];
  const items = raw.map((it) => {
    const m = Math.round(Number(it.m)), q = Math.round(Number(it.q));
    const lens = String(it.lens ?? "").slice(0, 80), pre = lens.split("-")[0];
    if (!(m >= 1 && m <= 7) || !(q >= 1 && q <= 100000) || !(pre in LENS_PRICE)) return null;
    const unit = FRAME + LENS_PRICE[pre];
    return {
      modelo: `Modelo 0${m}`, ref: `BR 00${m}`, color: String(it.col ?? "").slice(0, 60),
      cristal: lens.slice(pre.length + 1), logo: it.logo === "laser" ? "láser" : "tampografía",
      cantidad: q, unit_usd: unit, total_usd: +(unit * q).toFixed(2),
    };
  });
  if (!items.length || items.some((x) => !x)) return json({ ok: false, error: "El pedido no tiene líneas válidas." }, 400);
  const lines = items as NonNullable<(typeof items)[number]>[];

  // Freno simple: hasta 5 pedidos por mail por hora.
  const { count } = await sb.from("marca_blanca_pedidos").select("id", { count: "exact", head: true })
    .eq("email", email).gte("created_at", new Date(Date.now() - 3600e3).toISOString());
  if ((count ?? 0) >= 5) return json({ ok: false, error: "Ya recibimos varios pedidos de este mail. Te contactamos a la brevedad." }, 429);

  // Logo (opcional pero recomendado)
  let logo_path: string | null = null, logo_nombre: string | null = null, logoBytes: Uint8Array | null = null, logoType = "";
  const lg = b.logo as { name?: string; type?: string; b64?: string } | undefined;
  if (lg?.b64) {
    logoType = String(lg.type ?? "");
    if (!LOGO_OK.includes(logoType)) return json({ ok: false, error: "El logo tiene que ser PNG, JPG, WEBP, SVG, PDF o AI." }, 400);
    logoBytes = Uint8Array.from(atob(lg.b64), (c) => c.charCodeAt(0));
    if (logoBytes.length > 8 * 1024 * 1024) return json({ ok: false, error: "El logo pesa más de 8 MB." }, 400);
    logo_nombre = String(lg.name ?? "logo").replace(/[^\w.\-]+/g, "_").slice(0, 80);
    logo_path = `${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}-${logo_nombre}`;
    const up = await sb.storage.from("marca-blanca-logos").upload(logo_path, logoBytes, { contentType: logoType });
    if (up.error) { console.error("upload", up.error); return json({ ok: false, error: "No pudimos subir el logo. Probá de nuevo." }, 500); }
  }

  const unidades = lines.reduce((a, l) => a + l.cantidad, 0);
  const subtotal = +lines.reduce((a, l) => a + l.total_usd, 0).toFixed(2);
  const iva = cuenta === "plenorius" ? +(subtotal * 0.21).toFixed(2) : 0;
  const total = +(subtotal + iva).toFixed(2);
  const dol = await dolarHoy();
  const total_ars = dol ? Math.round(total * dol.venta) : null;

  const { data: ins, error } = await sb.from("marca_blanca_pedidos").insert({
    marca, razon_social: razon, email, telefono: tel, logo_path, logo_nombre, cuenta, items: lines, unidades,
    subtotal_usd: subtotal, iva_usd: iva, total_usd: total, dolar: dol?.venta ?? null, dolar_fecha: dol?.fecha ?? null, total_ars, obs: obs || null,
  }).select("id").single();
  if (error) { console.error("insert", error); return json({ ok: false, error: "No pudimos guardar el pedido. Probá de nuevo." }, 500); }

  // Aviso al grupo Ojo
  try {
    const g = await grupo();
    const ars = (v: number) => "$ " + Math.round(v).toLocaleString("es-AR");
    const usd = (v: number) => "USD " + v.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const texto = [
      `🏷️ <b>Marca blanca · precarga #${ins.id}</b>`,
      `<b>${esc(marca)}</b> · ${esc(razon)}`,
      `✉️ ${esc(email)} · 📞 ${esc(tel)}`,
      "",
      ...lines.map((l) => `• ${l.cantidad} × ${l.modelo} (${l.ref}) ${esc(l.color)} · ${esc(l.cristal)} · logo ${l.logo} — ${usd(l.total_usd)}`),
      "",
      `${unidades} u · ${usd(subtotal)}${iva ? ` + IVA ${usd(iva)} = ${usd(total)}` : ""}`,
      dol && total_ars ? `Dólar vendedor ${dol.fecha.split("-").reverse().join("/")}: ${ars(dol.venta)} → <b>${ars(total_ars)}</b>` : "Dólar del día: no disponible",
      `Pago directo por transferencia a ${cuenta === "plenorius" ? "Plenorius S.A. (+IVA)" : "Brubank ($)"} · 50 % adelanto / 50 % contra entrega`,
      obs ? `\n📝 ${esc(obs)}` : "",
      logo_path ? "" : "\n⚠️ No adjuntó logo",
    ].filter((x) => x !== "").join("\n");
    const r = await fetch(`${TG}/sendMessage`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: g, text: texto.slice(0, 4000), parse_mode: "HTML", disable_web_page_preview: true }),
    });
    const d = await r.json();
    if (d?.ok) await sb.from("ojo_mensajes_log").insert({ telegram_chat_id: g, telegram_message_id: d.result.message_id, autor_nombre: "Ojo", texto: texto.slice(0, 4000), es_del_bot: true });
    else console.error("sendMessage", JSON.stringify(d));
    if (logoBytes && logo_nombre) {
      const fd = new FormData();
      fd.append("chat_id", String(g));
      fd.append("caption", `Logo de ${marca} · precarga #${ins.id}`);
      if (d?.ok) fd.append("reply_to_message_id", String(d.result.message_id));
      fd.append("document", new Blob([logoBytes], { type: logoType }), logo_nombre);
      const rd = await fetch(`${TG}/sendDocument`, { method: "POST", body: fd });
      if (!rd.ok) console.error("sendDocument", rd.status, await rd.text());
    }
  } catch (e) { console.error("aviso", e); }

  return json({ ok: true, id: ins.id, total_usd: total, dolar: dol?.venta ?? null, total_ars });
});
