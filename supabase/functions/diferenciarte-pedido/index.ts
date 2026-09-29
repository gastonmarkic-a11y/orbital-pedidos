// diferenciarte-pedido — campaña "Diferenciarte v2" (compra digital con bono en %).
// accion=detalle: al confirmar el pedido en el catálogo, manda por WhatsApp el detalle con las condiciones
//   y, si la ficha no tiene CUIT, se lo pide (IRIS lo captura con bot_lead_flujo paso 'pide_cuit').
// accion=recordatorio: a la semana sin compra, renueva el bono 72 h y le recuerda la propuesta.
// accion=crear_plantilla: crea la plantilla de recordatorio (fuera de la ventana de 24 h solo sale por plantilla).
// Protegida con header x-internal-key = app_config.meta_webhook_verify_token.
import { createClient } from "jsr:@supabase/supabase-js@2";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const WT = Deno.env.get("WHATSAPP_TOKEN") ?? "";
const PHONE_ID = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID") ?? "";
const GV = "v21.0";
const TPL_RECORDATORIO = "recordatorio_propuesta_catalogo";
const J = (x: unknown, s = 200) => new Response(JSON.stringify(x), { status: s, headers: { "content-type": "application/json" } });
const ars = (n: number) => "$" + Math.round(n || 0).toLocaleString("es-AR");
const dig = (t: string | null | undefined) => (t ?? "").replace(/\D/g, "");

async function cfg(c: string): Promise<string | null> {
  const { data } = await db.from("app_config").select("valor").eq("clave", c).maybeSingle();
  return (data as { valor: string } | null)?.valor ?? null;
}
function waTo(tel: string): string {
  let d = dig(tel);
  if (d.startsWith("0")) d = d.slice(1);
  if (!d.startsWith("54")) d = "54" + (d.startsWith("9") ? "" : "9") + d;
  return d;
}
async function enviar(body: unknown): Promise<{ ok: boolean; resp: unknown }> {
  const r = await fetch(`https://graph.facebook.com/${GV}/${PHONE_ID}/messages`, {
    method: "POST", headers: { Authorization: `Bearer ${WT}`, "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  return { ok: r.ok, resp: await r.json().catch(() => null) };
}
const texto = (to: string, body: string) => enviar({ messaging_product: "whatsapp", to, type: "text", text: { body, preview_url: true } });

async function conversacionDe(tel: string): Promise<string | null> {
  const t = dig(tel).slice(-10);
  if (t.length < 8) return null;
  const { data: cs } = await db.from("contactos").select("id").ilike("telefono", `%${t}`).limit(5);
  const ids = ((cs ?? []) as { id: string }[]).map((c) => c.id);
  if (!ids.length) return null;
  const { data: cv } = await db.from("at_conversaciones").select("id").in("contacto_id", ids).order("updated_at", { ascending: false }).limit(1);
  return ((cv ?? [])[0] as { id: string } | undefined)?.id ?? null;
}
async function logBot(conv: string | null, contenido: string) {
  if (!conv) return;
  try { await db.from("at_mensajes").insert({ conversacion_id: conv, canal: "whatsapp", emisor: "bot", contenido }); } catch { /* */ }
}

interface Precarga { id: number; cod_cliente: string | null; cliente_razon: string | null; wsp: string | null; items: { modelo: string; descripcion: string | null; cantidad: number; precio: number }[]; total_units: number; importe: number; condiciones: Record<string, unknown> | null }

async function detalle(precargaId: number) {
  const { data } = await db.from("catalogo_precarga").select("id, cod_cliente, cliente_razon, wsp, items, total_units, importe, condiciones").eq("id", precargaId).maybeSingle();
  const p = data as Precarga | null;
  if (!p?.condiciones) return { ok: false, motivo: "sin_precarga" };
  const c = p.condiciones as Record<string, number | boolean | string>;
  const { data: cli } = p.cod_cliente
    ? await db.from("clientes").select("razon, nomcomerc, whatsapp, telefono, cuit").eq("cod", p.cod_cliente).maybeSingle()
    : { data: null };
  const ficha = cli as { razon: string | null; nomcomerc: string | null; whatsapp: string | null; telefono: string | null; cuit: string | null } | null;
  // Fichas sin teléfono (ej. las de prueba de circuito): se usa el teléfono de la charla de IRIS.
  let telFlujo: string | null = null;
  if (p.cod_cliente && !ficha?.whatsapp && !ficha?.telefono) {
    const { data: fl } = await db.from("bot_lead_flujo").select("telefono").eq("cod_cliente", p.cod_cliente).limit(1);
    telFlujo = ((fl ?? [])[0] as { telefono: string | null } | undefined)?.telefono ?? null;
  }
  const tel = ficha?.whatsapp || telFlujo || p.wsp || ficha?.telefono;
  if (!tel) return { ok: false, motivo: "sin_telefono" };
  const to = waTo(tel);
  const nombre = ficha?.nomcomerc || ficha?.razon || p.cliente_razon || "tu óptica";

  const lineas = (p.items ?? []).map((it) => `• ${it.modelo}${it.descripcion ? " " + it.descripcion : ""} × ${it.cantidad}`).join("\n");
  const sc = Number(c.sin_cargo_importe || 0), scU = Number(c.sin_cargo_unidades || 0);
  const contado = c.contado === true;
  const pl = String(c.plazo || "30/60/90").split("/");
  const plazo = pl.slice(0, -1).join(", ") + " y " + pl[pl.length - 1] + " días";
  const vend = String(c.vendedor_contacto || "Gastón");
  const vwsp = dig(String(c.vendedor_wsp || ""));
  const msg = [
    `✅ *Recibimos tu pedido* — ${nombre}`, "",
    lineas, "",
    `Subtotal (${p.total_units} u.): ${ars(p.importe)} + IVA`,
    scU > 0 ? `🎁 Piezas sin cargo (${scU}): − ${ars(sc)}` : "",
    `💻 Bono compra por catálogo: − ${ars(Number(c.bono || 0))}`,
    `*Total: ${ars(Number(c.neto || 0))} + IVA*`,
    contado ? `💵 Pagando por transferencia o contado (${c.contado_pct}% extra): *${ars(Number(c.total_contado || 0))} + IVA*` : "",
    Number(c.volumen_pct || 0) > 0 ? `📊 Bonificación por volumen: ${c.volumen_pct}% (la aplica tu vendedor al confirmar)` : "",
    `📅 Forma de pago: ${plazo}`, "",
    `Tu vendedor es *${vend}*${vwsp ? ` — WhatsApp wa.me/${vwsp}` : ""}. Vas a poder estar en contacto con él en todo lo relacionado a tu pedido.`,
  ].filter((l) => l !== "").join("\n").replace(/\n{3,}/g, "\n\n");

  const conv = await conversacionDe(tel);
  const r1 = await texto(to, msg);
  if (r1.ok) await logBot(conv, msg);

  let r2: unknown = null;
  if (!dig(ficha?.cuit)) {
    const pide = "Para cerrar tu pedido necesitaríamos tu *CUIT*, así te damos de alta como cliente. ¿Me lo pasás? 🙌";
    const s = await texto(to, pide);
    r2 = s;
    if (s.ok) {
      await logBot(conv, pide);
      if (conv) {
        await db.from("bot_lead_flujo").upsert({ conversacion_id: conv, paso: "pide_cuit", campana: "diferenciarte_v2", cod_cliente: p.cod_cliente, actualizado_en: new Date().toISOString() }, { onConflict: "conversacion_id" });
      }
    }
  }
  await db.from("catalogo_precarga").update({ condiciones: { ...p.condiciones, wa_detalle: r1.ok, wa_cuit: r2 ? (r2 as { ok: boolean }).ok : null } }).eq("id", p.id);
  return { ok: r1.ok, detalle: r1, cuit: r2 };
}

async function recordatorio(codigo: string, cod: string | null) {
  const { data: cli } = cod ? await db.from("clientes").select("nomcomerc, razon, whatsapp, telefono").eq("cod", cod).maybeSingle() : { data: null };
  const f = cli as { nomcomerc: string | null; razon: string | null; whatsapp: string | null; telefono: string | null } | null;
  const tel = f?.whatsapp || f?.telefono;
  if (!tel) return { ok: false, motivo: "sin_telefono" };
  const { data: nb } = await db.rpc("bot_bono_diferenciarte", { p_token: codigo, p_cod: cod });
  const base = (await cfg("url_landings")) || "https://ver.orbitaleyewear.com.ar";
  const link = `${base}/catalogo?k=${codigo}&pack=bienvenida`;
  const nombre = f?.nomcomerc || f?.razon || "";
  const to = waTo(tel);
  // Fuera de la ventana de 24 h solo sale por plantilla; si no está aprobada, se intenta texto.
  const viaTpl = await enviar({ messaging_product: "whatsapp", to, type: "template", template: { name: TPL_RECORDATORIO, language: { code: "es_AR" },
    components: [{ type: "body", parameters: [{ type: "text", text: nombre || "¡Hola!" }, { type: "text", text: link }] }] } });
  const msg = `Hola${nombre ? " " + nombre : ""} 👋 Te renovamos por 72 h tu propuesta exclusiva: bono de hasta $300.000 comprando por el catálogo + Pack de Bienvenida.\n\n${link}\n\nCualquier duda, escribime por acá.`;
  const viaTexto = viaTpl.ok ? null : await texto(to, msg);
  if (viaTpl.ok || viaTexto?.ok) await logBot(await conversacionDe(tel), msg);
  return { ok: viaTpl.ok || !!viaTexto?.ok, bono: nb, viaTpl, viaTexto };
}

async function crearPlantilla() {
  const waba = await cfg("meta_waba_id");
  const tpl = { name: TPL_RECORDATORIO, language: "es_AR", category: "MARKETING",
    components: [{ type: "BODY",
      text: "Hola {{1}} 👋 Te renovamos por 72 horas tu propuesta exclusiva de Orbital: bono de hasta $300.000 comprando por el catálogo + Pack de Bienvenida.\n\nEntrá acá: {{2}}\n\nCualquier duda, respondé este mensaje.",
      example: { body_text: [["Óptica Ejemplo", "https://ver.orbitaleyewear.com.ar/catalogo?k=ejemplo&pack=bienvenida"]] } }] };
  const r = await fetch(`https://graph.facebook.com/${GV}/${waba}/message_templates`, {
    method: "POST", headers: { Authorization: `Bearer ${WT}`, "Content-Type": "application/json" }, body: JSON.stringify(tpl) });
  return { ok: r.ok, resp: await r.json().catch(() => null) };
}

Deno.serve(async (req) => {
  if (req.headers.get("x-internal-key") !== (await cfg("meta_webhook_verify_token"))) return J({ ok: false }, 403);
  const b = await req.json().catch(() => ({})) as { accion?: string; precarga_id?: number; codigo?: string; cod_cliente?: string | null };
  try {
    if (b.accion === "detalle" && b.precarga_id) return J(await detalle(b.precarga_id));
    if (b.accion === "recordatorio" && b.codigo) return J(await recordatorio(b.codigo, b.cod_cliente ?? null));
    if (b.accion === "crear_plantilla") return J(await crearPlantilla());
    return J({ ok: false, error: "accion" }, 400);
  } catch (e) {
    return J({ ok: false, error: String(e) }, 500);
  }
});
