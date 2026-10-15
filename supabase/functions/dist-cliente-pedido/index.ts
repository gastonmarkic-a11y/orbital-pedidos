// dist-cliente-pedido — pedido que arma un cliente de un distribuidor desde su link del catálogo
// (catalogo_acceso tipo 'dist_cli', primero Cristaldo). Lo graba con dist_cli_pedido_crear (precios
// recalculados en el servidor) y se lo manda al distribuidor por el bot de Telegram de distribuidores,
// con los datos de la óptica y el botón para escribirle por WhatsApp. Copia al grupo interno del bot.
// No entra al circuito de Orbital: ni precarga, ni reserva de stock, ni vendedores.
//   POST { clave, optica, cuit, localidad, contacto, wsp, obs, items: [{codigo, cantidad}], device }

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const H = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" };

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const ars = (n: number) => "$" + Math.round(n).toLocaleString("es-AR");
const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

async function cfg(clave: string): Promise<string> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/app_config?clave=eq.${clave}&select=valor`, { headers: H });
  const f = res.ok ? ((await res.json()) as { valor: string }[]) : [];
  return f[0]?.valor ?? "";
}
const token = async () => Deno.env.get("DIST_TELEGRAM_BOT_TOKEN") || (await cfg("dist_telegram_bot_token"));

async function tg(tk: string, body: Record<string, unknown>) {
  const res = await fetch(`https://api.telegram.org/bot${tk}/sendMessage`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ parse_mode: "HTML", disable_web_page_preview: true, ...body }),
  });
  const j = await res.json().catch(() => ({}));
  if (!j?.ok) console.error("sendMessage", res.status, JSON.stringify(j));
  return !!j?.ok;
}

// Número de WhatsApp argentino para wa.me (549 + área + número)
function waNum(t: string) {
  let d = t.replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  if (d.startsWith("54")) d = d.slice(2);
  if (d.startsWith("9")) d = d.slice(1);
  if (d.startsWith("0")) d = d.slice(1);
  d = d.replace(/^(\d{2,4})15(\d{6,8})$/, "$1$2");
  return d.length === 10 ? "549" + d : "";
}

type Item = { codigo: string; modelo: string; descripcion: string | null; cantidad: number; precio: number };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "método" }, 405);
  const b = await req.json().catch(() => null);
  if (!b || typeof b.clave !== "string" || !Array.isArray(b.items)) return json({ ok: false, error: "Datos incompletos" }, 400);

  const items = (b.items as { codigo?: unknown; cantidad?: unknown }[]).slice(0, 300)
    .map((i) => ({ codigo: str(i?.codigo, 40), cantidad: Math.max(0, Math.min(999, Math.floor(Number(i?.cantidad) || 0))) }))
    .filter((i) => i.codigo && i.cantidad > 0);
  const d = {
    optica: str(b.optica, 120), cuit: str(b.cuit, 20), localidad: str(b.localidad, 80),
    contacto: str(b.contacto, 80), wsp: str(b.wsp, 30), obs: str(b.obs, 500),
  };

  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/dist_cli_pedido_crear`, {
    method: "POST", headers: H,
    body: JSON.stringify({
      p_clave: b.clave, p_optica: d.optica, p_cuit: d.cuit, p_localidad: d.localidad, p_contacto: d.contacto,
      p_wsp: d.wsp, p_obs: d.obs, p_items: items, p_device: str(b.device, 80) || null,
    }),
  });
  if (!res.ok) { console.error("rpc", res.status, await res.text()); return json({ ok: false, error: "No se pudo registrar el pedido." }, 500); }
  const r = await res.json() as { ok: boolean; error?: string; id?: number; cod_distribuidor?: string; items?: Item[]; unidades?: number; importe_ref?: number };
  if (!r.ok) return json(r);

  // Distribuidor y a quién de su lado le llega (titular/administración con el bot abierto)
  const dres = await fetch(`${SUPABASE_URL}/rest/v1/distribuidores?cod_cliente=eq.${r.cod_distribuidor}&select=id,nombre,marca,dist_tg_usuario(chat_id,rol,activo)`, { headers: H });
  const [dist] = dres.ok ? ((await dres.json()) as { id: number; nombre: string; marca: string | null; dist_tg_usuario: { chat_id: number | null; rol: string; activo: boolean }[] }[]) : [];
  const chats = [...new Set((dist?.dist_tg_usuario ?? []).filter((u) => u.activo && u.chat_id && ["dueno", "admin"].includes(u.rol)).map((u) => Number(u.chat_id)))];

  const lineas = (r.items ?? []).map((i) => `• ${i.cantidad} × <b>${esc(i.modelo)}</b> ${esc(i.descripcion ?? "")} · ${ars(i.precio)}`);
  const cuerpo = [
    `🛒 <b>Pedido de un cliente tuyo</b> · catálogo online #${r.id}`,
    "",
    `<b>${esc(d.optica)}</b>${d.localidad ? ` · ${esc(d.localidad)}` : ""}`,
    d.cuit ? `CUIT: ${esc(d.cuit)}` : null,
    d.contacto ? `Contacto: ${esc(d.contacto)}` : null,
    `WhatsApp: ${esc(d.wsp)}`,
    d.obs ? `📝 ${esc(d.obs)}` : null,
    "",
    ...lineas,
    "",
    `<b>${r.unidades} unidades</b> · ${ars(r.importe_ref ?? 0)} + IVA a precio óptica de referencia de Orbital`,
    "El cliente sabe que el precio final y las condiciones se los confirmás vos.",
  ].filter((l) => l !== null).join("\n");

  const tk = await token();
  const wa = waNum(d.wsp);
  const saludo = `Hola${d.contacto ? " " + d.contacto.split(" ")[0] : ""}! Recibí tu pedido de Orbital (${r.unidades} u.) del catálogo online. Te paso precio y condiciones:`;
  const botones = wa ? { reply_markup: { inline_keyboard: [[{ text: "💬 Escribirle por WhatsApp", url: `https://wa.me/${wa}?text=${encodeURIComponent(saludo)}` }]] } } : {};

  let llego = false;
  if (tk) for (const c of chats) llego = (await tg(tk, { chat_id: c, text: cuerpo, ...botones })) || llego;
  // Copia al grupo interno del bot de distribuidores (Orbital ve todo lo que pasa con ellos)
  const grupo = await cfg("dist_telegram_grupo");
  if (tk && grupo) await tg(tk, { chat_id: Number(grupo), text: `👁 Para ${esc(dist?.marca || dist?.nombre || r.cod_distribuidor || "")}${llego ? "" : " ⚠️ NO LE LLEGÓ (no tiene el bot abierto)"}\n\n${cuerpo}` });

  await fetch(`${SUPABASE_URL}/rest/v1/dist_cli_pedido?id=eq.${r.id}`, {
    method: "PATCH", headers: H,
    body: JSON.stringify(llego ? { avisado_at: new Date().toISOString() } : { aviso_error: chats.length ? "telegram" : "sin chat" }),
  });

  return json({ ok: true, id: r.id, distribuidor: dist?.marca || dist?.nombre || null, unidades: r.unidades });
});
