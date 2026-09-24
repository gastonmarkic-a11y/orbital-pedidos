import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// pedido-seguimiento — el cliente (óptica o revendedor) recibe por WhatsApp (IRIS) cada cambio de su pedido,
// lo haya cargado él en el catálogo o su vendedor en la Suite, hasta que le llega:
// recibido → confirmado → en preparación → listo → despachado (con guía) → entregado (Envia).
//   ?tarea=enviar    (cron cada 10 min, 8 a 20 ART, L-S) manda la etapa actual de cada pedido si todavía no se la
//                    mandó. Si saltó varias etapas juntas manda solo la última. Nunca vuelve para atrás.
//   ?tarea=plantilla (a mano, una vez) da de alta la plantilla en Meta.
//   ?tarea=estado    estado de la plantilla en Meta.
//   ?prueba=1        no manda nada: devuelve qué mandaría.
// Cada tanda enviada se copia al grupo de Ojo (Telegram), agrupada por vendedor.
// Solo pedidos/precargas desde app_config.seguimiento_pedido_desde. Sin fechas de entrega en los mensajes.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WA_TOKEN = Deno.env.get("WHATSAPP_TOKEN") ?? "";
const TG = `https://api.telegram.org/bot${Deno.env.get("TELEGRAM_BOT_TOKEN")!}`;
const GRUPO_FALLBACK = -5504692394;
const PLANTILLA = "pedido_seguimiento";
const sb = createClient(SUPABASE_URL, SERVICE_KEY);

type Pend = {
  precarga_id: number | null; pedido_id: number | null; cod_cliente: string; nombre: string | null; wa: string;
  unidades: number | null; vendedor: string | null; etapa: string; rango: number; tipo_transporte: string | null; nro_guia: string | null;
  track_url: string | null; ultimo_rango: number;
};

async function cfg(clave: string): Promise<string | null> {
  const { data } = await sb.from("app_config").select("valor").eq("clave", clave).maybeSingle();
  return data?.valor ?? null;
}

function referencia(p: Pend) {
  const u = p.unidades ? `${p.unidades} u.` : "";
  return p.pedido_id ? `N° ${p.pedido_id}${u ? ` (${u})` : ""}` : u ? `de ${u}` : "";
}

function estadoTexto(p: Pend): string {
  switch (p.etapa) {
    case "recibido":
      return "✅ Lo recibimos. Tu vendedor lo revisa y te lo confirma.";
    case "confirmado":
      return "✅ Tu pedido quedó confirmado y pasa a preparación en nuestro depósito.";
    case "en_preparacion":
      return "📦 Estamos preparando tu pedido en el depósito.";
    case "listo":
      return "📦 Tu pedido ya está armado y listo para salir.";
    case "despachado": {
      const t = (p.tipo_transporte ?? "").trim();
      if (/retira/i.test(t)) return "📦 Tu pedido está listo para que lo retires.";
      const via = /moto/i.test(t) ? "en moto" : /correo/i.test(t) ? "por correo"
        : /expreso|transporte/i.test(t) ? "por expreso" : /comisionista/i.test(t) ? "por comisionista" : "";
      let s = `🚚 Tu pedido ya salió${via ? ` ${via}` : ""}.`;
      if (p.nro_guia) s += ` Número de guía: ${p.nro_guia}.`;
      if (p.track_url) s += ` Podés seguirlo acá: ${p.track_url}`;
      return s;
    }
    case "entregado":
      return "🏁 Tu pedido figura entregado. ¡Gracias por tu compra! Si falta algo o llegó con algún problema, respondé este mensaje.";
  }
  return "";
}

async function waPhoneId() {
  return Deno.env.get("WHATSAPP_PHONE_NUMBER_ID") || (await cfg("whatsapp_phone_number_id")) || "";
}

async function enviar(prueba: boolean) {
  const { data, error } = await sb.rpc("pedido_seguimiento_pendientes");
  if (error) throw new Error(error.message);
  const pend = (data ?? []) as Pend[];
  const armados = pend.map((p) => ({ p, nombre: (p.nombre ?? "").trim() || "¿cómo estás?", ref: referencia(p), texto: estadoTexto(p) }));
  if (prueba) return { prueba: true, mandaria: armados.map((a) => ({ precarga: a.p.precarga_id, pedido: a.p.pedido_id, vendedor: a.p.vendedor, etapa: a.p.etapa, a: a.nombre, ref: a.ref, texto: a.texto })) };
  if (!armados.length) return { mandados: [] };

  // Hasta que Meta apruebe la plantilla no se intenta nada (no ensucia el registro con errores).
  const status = (await estadoPlantilla())?.data?.[0]?.status;
  if (status !== "APPROVED") return { esperando_plantilla: status ?? "sin plantilla", pendientes: armados.length };

  const phone = await waPhoneId();
  const res: Enviado[] = [];
  for (const a of armados) {
    const r = await fetch(`https://graph.facebook.com/v21.0/${phone}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${WA_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp", to: a.p.wa, type: "template",
        template: {
          name: PLANTILLA, language: { code: "es_AR" },
          components: [{ type: "body", parameters: [a.nombre, a.ref || "web", a.texto].map((text) => ({ type: "text", text })) }],
        },
      }),
    });
    const d = await r.json().catch(() => ({}));
    const ok = r.ok && d?.messages?.[0]?.id;
    await sb.from("pedido_seguimiento_aviso").insert({
      precarga_id: a.p.precarga_id, pedido_id: a.p.pedido_id, cod_cliente: a.p.cod_cliente, vendedor: a.p.vendedor, etapa: a.p.etapa, rango: a.p.rango,
      wa: a.p.wa, texto: a.texto, estado: ok ? "enviado" : "error",
      error: ok ? null : JSON.stringify(d?.error ?? d).slice(0, 500), wa_message_id: ok ? d.messages[0].id : null,
    });
    res.push({ ...a, ok: !!ok });
  }
  await copiaGrupo(res);
  return { mandados: res.map((r) => ({ precarga: r.p.precarga_id, pedido: r.p.pedido_id, etapa: r.p.etapa, ok: r.ok })) };
}

// ── copia al grupo de Ojo ───────────────────────────────────────────────────
const ETAPA: Record<string, string> = {
  recibido: "✅ recibido", confirmado: "✅ confirmado", en_preparacion: "📦 en preparación",
  listo: "📦 listo para salir", despachado: "🚚 despachado", entregado: "🏁 entregado",
};
const COLORES: Record<string, string> = { adrian: "🟢", bruno: "🔵", ulises: "🟣", mauro: "🟠", gus: "🟡", gustavo: "🟡" };
const marca = (v: string) => {
  const k = v.split(/\s+/)[0].normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  return `${COLORES[k] ?? "⚪"} ${v}`;
};
const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

async function grupoAvisos(): Promise<number> {
  const { data } = await sb.from("ojo_grupos").select("telegram_chat_id").eq("activo", true).eq("recibe_avisos", true).limit(1).maybeSingle();
  return Number(data?.telegram_chat_id ?? GRUPO_FALLBACK);
}

type Enviado = { p: Pend; nombre: string; ref: string; ok: boolean };
async function copiaGrupo(res: Enviado[]) {
  if (!res.length) return;
  const porVend = new Map<string, Enviado[]>();
  for (const r of res) {
    const v = (r.p.vendedor ?? "").trim() || "Corporativo";
    porVend.set(v, [...(porVend.get(v) ?? []), r]);
  }
  const bloques = [...porVend].map(([v, rs]) =>
    `${esc(marca(v))}\n` + rs.map((r) =>
      `• <b>${esc(r.nombre)}</b> — pedido ${esc(r.ref || "web")} · ${ETAPA[r.p.etapa] ?? r.p.etapa}` +
      (r.ok ? "" : " · ⚠️ no le llegó")).join("\n"));
  const texto = `📲 <b>Seguimiento enviado a clientes</b> (WhatsApp de IRIS)\n\n${bloques.join("\n\n")}`;
  const grupo = await grupoAvisos();
  const r = await fetch(`${TG}/sendMessage`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: grupo, text: texto.slice(0, 4000), parse_mode: "HTML", disable_web_page_preview: true }),
  });
  const d = await r.json().catch(() => ({}));
  if (d?.ok) await sb.from("ojo_mensajes_log").insert({ telegram_chat_id: grupo, telegram_message_id: d.result.message_id, autor_nombre: "Ojo", texto: texto.slice(0, 4000), es_del_bot: true });
  else console.error("sendMessage", JSON.stringify(d));
}

// ── plantilla ───────────────────────────────────────────────────────────────
async function plantilla() {
  const waba = await cfg("meta_waba_id");
  const body = "Hola {{1}}! Te escribimos de Orbital Eyewear con novedades de tu pedido {{2}}.\n\n{{3}}\n\n" +
    "Si tenés alguna consulta sobre tu pedido, respondé este mensaje y te ayudamos.";
  const r = await fetch(`https://graph.facebook.com/v21.0/${waba}/message_templates`, {
    method: "POST",
    headers: { Authorization: `Bearer ${WA_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      name: PLANTILLA, language: "es_AR", category: "UTILITY",
      components: [{
        type: "BODY", text: body,
        example: { body_text: [["Óptica Ejemplo", "N° 462 (12 u.)", "🚚 Tu pedido ya salió por correo. Número de guía: 1904230L86IMI0C501."]] },
      }],
    }),
  });
  return { http: r.status, respuesta: await r.json().catch(() => null) };
}

async function estadoPlantilla() {
  const waba = await cfg("meta_waba_id");
  const r = await fetch(`https://graph.facebook.com/v21.0/${waba}/message_templates?name=${PLANTILLA}`, { headers: { Authorization: `Bearer ${WA_TOKEN}` } });
  return await r.json().catch(() => null);
}

Deno.serve(async (req) => {
  if (!req.headers.get("x-cron-key") || req.headers.get("x-cron-key") !== (await cfg("cron_key"))) return new Response("no", { status: 401 });
  const u = new URL(req.url);
  const tarea = u.searchParams.get("tarea");
  const prueba = u.searchParams.get("prueba") === "1";
  try {
    if (tarea === "enviar") return Response.json(await enviar(prueba));
    if (tarea === "plantilla") return Response.json(await plantilla());
    if (tarea === "estado") return Response.json(await estadoPlantilla());
    return Response.json({ ok: false, error: "tarea: enviar | plantilla | estado" });
  } catch (e) {
    console.error(e);
    return Response.json({ ok: false, error: String(e) }, { status: 500 });
  }
});
