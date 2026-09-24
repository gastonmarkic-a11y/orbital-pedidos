import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// carrito-abandonado — carritos del catálogo que la óptica armó y no confirmó.
//   ?tarea=clientes  (cron cada 15 min, 9 a 20 ART, L-S) a las 2 h sin cerrar, IRIS le manda un
//                    WhatsApp (plantilla carrito_pendiente) con el botón que le abre SU carrito.
//                    Una sola vez por carrito, y nunca más de uno cada 3 días a la misma óptica.
//   ?tarea=resumen   (cron 9:00 ART, L-S) en el grupo, a cada vendedor: sus carritos sin cerrar de
//                    los últimos 7 días, con WhatsApp directo y "Pasarlo a precarga" (prc:, lo atiende ojo-conteo).
//   ?tarea=plantilla (a mano, una vez) da de alta la plantilla en Meta.
//   ?prueba=1        no manda nada: devuelve a quién le mandaría.
// En Telegram no se habla de plata: solo unidades y modelos.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WA_TOKEN = Deno.env.get("WHATSAPP_TOKEN") ?? "";
const TG = `https://api.telegram.org/bot${Deno.env.get("TELEGRAM_BOT_TOKEN")!}`;
const GRUPO_FALLBACK = -5504692394;
const PLANTILLA = "carrito_pendiente";
const URL_BASE = "https://ver.orbitaleyewear.com.ar/catalogo?carrito=1&k=";
const sb = createClient(SUPABASE_URL, SERVICE_KEY);

type Carrito = {
  codigo: string; cod_cliente: string; razon: string | null; vendedor: string; wa: string | null;
  unidades: number; modelos: string | null; actualizado_at: string; recordado_at: string | null; de_baja: boolean;
};

async function cfg(clave: string): Promise<string | null> {
  const { data } = await sb.from("app_config").select("valor").eq("clave", clave).maybeSingle();
  return data?.valor ?? null;
}
const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const horas = (iso: string) => (Date.now() - new Date(iso).getTime()) / 3600000;
function hace(iso: string) {
  const h = horas(iso);
  if (h < 24) return `hace ${Math.max(1, Math.round(h))} h`;
  const d = Math.round(h / 24);
  return d === 1 ? "ayer" : `hace ${d} días`;
}
const COLORES: Record<string, string> = { adrian: "🟢", bruno: "🔵", ulises: "🟣", mauro: "🟠", gus: "🟡", gustavo: "🟡" };
const marca = (v: string) => {
  const k = v.split(/\s+/)[0].normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  return `${COLORES[k] ?? "⚪"} ${v}`;
};

async function lista(desde: string, hasta: string): Promise<Carrito[]> {
  const { data, error } = await sb.rpc("carrito_abandonado_lista", { p_desde: desde, p_hasta: hasta });
  if (error) throw new Error(error.message);
  return (data ?? []) as Carrito[];
}

async function waPhoneId() {
  return Deno.env.get("WHATSAPP_PHONE_NUMBER_ID") || (await cfg("whatsapp_phone_number_id")) || "";
}

// ── al cliente ──────────────────────────────────────────────────────────────
async function clientes(prueba: boolean) {
  const todos = await lista("48 hours", "2 hours");
  const { data: errores } = await sb.from("carrito_recordatorio").select("codigo")
    .eq("estado", "error").gte("enviado_at", new Date(Date.now() - 6 * 3600000).toISOString());
  const conError = new Set((errores ?? []).map((e) => e.codigo));

  const aMandar = todos.filter((c) =>
    c.wa && !c.de_baja && !conError.has(c.codigo) &&
    // uno por carrito, y no más de uno cada 3 días a la misma óptica
    (!c.recordado_at || (c.recordado_at < c.actualizado_at && horas(c.recordado_at) > 72))
  );
  if (prueba) return { prueba: true, mandaria: aMandar.map((c) => ({ codigo: c.codigo, razon: c.razon, unidades: c.unidades })) };
  if (!aMandar.length) return { mandados: [] };

  // Hasta que Meta apruebe la plantilla no se intenta nada (no ensucia el registro con errores).
  const est = await estadoPlantilla();
  const status = est?.data?.[0]?.status;
  if (status !== "APPROVED") return { esperando_plantilla: status ?? "sin plantilla", pendientes: aMandar.length };

  const phone = await waPhoneId();
  const res: unknown[] = [];
  for (const c of aMandar) {
    const nombre = (c.razon ?? "").trim() || "¿cómo estás?";
    const r = await fetch(`https://graph.facebook.com/v21.0/${phone}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${WA_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp", to: c.wa, type: "template",
        template: {
          name: PLANTILLA, language: { code: "es_AR" },
          components: [
            { type: "body", parameters: [{ type: "text", text: nombre }] },
            { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: c.codigo }] },
          ],
        },
      }),
    });
    const d = await r.json().catch(() => ({}));
    const ok = r.ok && d?.messages?.[0]?.id;
    await sb.from("carrito_recordatorio").insert({
      codigo: c.codigo, cod_cliente: c.cod_cliente, carrito_at: c.actualizado_at, wa: c.wa,
      unidades: c.unidades, vendedor: c.vendedor, estado: ok ? "enviado" : "error",
      error: ok ? null : JSON.stringify(d?.error ?? d).slice(0, 500), wa_message_id: ok ? d.messages[0].id : null,
    });
    res.push({ codigo: c.codigo, ok: !!ok });
  }
  return { mandados: res };
}

// ── al vendedor ─────────────────────────────────────────────────────────────
async function resumen(prueba: boolean) {
  const todos = await lista("7 days", "2 hours");
  const porVend = new Map<string, Carrito[]>();
  for (const c of todos) porVend.set(c.vendedor, [...(porVend.get(c.vendedor) ?? []), c]);
  if (prueba) return { prueba: true, vendedores: Object.fromEntries([...porVend].map(([v, cs]) => [v, cs.map((c) => c.razon)])) };
  if (!porVend.size) return { enviados: 0 };

  const grupo = Number((await cfg("ojo_grupo_avisos")) ?? 0) || await grupoAvisos();
  let n = 0;
  for (const [vend, cs] of porVend) {
    const lineas = cs.slice(0, 10).map((c, i) => {
      const rec = c.recordado_at ? " · ✉️ IRIS ya le escribió" : c.wa ? "" : " · sin WhatsApp cargado";
      return `${i + 1}. <b>${esc(c.razon)}</b> — ${c.unidades} u. (${esc(c.modelos ?? "")}) · ${hace(c.actualizado_at)}${rec}`;
    });
    const texto = `🛒 <b>Carritos sin cerrar</b> · ${esc(marca(vend))}\n` +
      `Armaron el pedido en el catálogo y no lo confirmaron. Llamalos o escribiles hoy para cerrarlo.\n\n` +
      lineas.join("\n") + (cs.length > 10 ? `\n… y ${cs.length - 10} más` : "");
    const botones = cs.slice(0, 10).map((c, i) => {
      const fila: Record<string, string>[] = [{ text: `📥 ${i + 1}. a precarga`, callback_data: `prc:${c.codigo}` }];
      if (c.wa) {
        const msg = `Hola! Vi que te quedó armado un pedido en el catálogo de Orbital (${c.unidades} u.). ¿Te ayudo a cerrarlo?`;
        fila.unshift({ text: `💬 ${i + 1}. WhatsApp`, url: `https://wa.me/${c.wa}?text=${encodeURIComponent(msg)}` });
      }
      return fila;
    });
    const r = await fetch(`${TG}/sendMessage`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: grupo, text: texto, parse_mode: "HTML", disable_web_page_preview: true, reply_markup: { inline_keyboard: botones } }),
    });
    const d = await r.json().catch(() => ({}));
    if (d?.ok) {
      n++;
      await sb.from("ojo_mensajes_log").insert({ telegram_chat_id: grupo, telegram_message_id: d.result.message_id, autor_nombre: "Ojo", texto: texto.slice(0, 4000), es_del_bot: true });
    } else console.error("sendMessage", JSON.stringify(d));
  }
  return { enviados: n };
}

async function grupoAvisos(): Promise<number> {
  const { data } = await sb.from("ojo_grupos").select("telegram_chat_id").eq("activo", true).eq("recibe_avisos", true).limit(1).maybeSingle();
  return Number(data?.telegram_chat_id ?? GRUPO_FALLBACK);
}

// ── plantilla ───────────────────────────────────────────────────────────────
async function plantilla() {
  const waba = await cfg("meta_waba_id");
  const body = "Hola {{1}}! Te quedó un pedido armado en el catálogo de Orbital. Lo guardamos tal cual lo dejaste: " +
    "tocá el botón para revisarlo y confirmarlo en un paso. Si tenés dudas con el pago o la entrega, respondé este mensaje y te ayudamos.";
  const r = await fetch(`https://graph.facebook.com/v21.0/${waba}/message_templates`, {
    method: "POST",
    headers: { Authorization: `Bearer ${WA_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      name: PLANTILLA, language: "es_AR", category: "MARKETING",
      components: [
        { type: "BODY", text: body, example: { body_text: [["Óptica Ejemplo"]] } },
        { type: "BUTTONS", buttons: [{ type: "URL", text: "Terminar mi pedido", url: URL_BASE + "{{1}}", example: [URL_BASE + "opticaej12345"] }] },
      ],
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
    if (tarea === "clientes") return Response.json(await clientes(prueba));
    if (tarea === "resumen") return Response.json(await resumen(prueba));
    if (tarea === "plantilla") return Response.json(await plantilla());
    if (tarea === "estado") return Response.json(await estadoPlantilla());
    return Response.json({ ok: false, error: "tarea: clientes | resumen | plantilla | estado" });
  } catch (e) {
    console.error(e);
    return Response.json({ ok: false, error: String(e) }, { status: 500 });
  }
});
