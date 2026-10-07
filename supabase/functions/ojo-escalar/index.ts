import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Ojo — escalado de 🆘 sin respuesta (v1, 2026-09-17).
// Gaston: "cuando ves que alguien no responde, salvo que sea corporativo, decí: no tengo respuesta
// de X, ¿algun vendedor puede tomar este caso?" + "si alguien dice yo, mandame a mi para que de el ok".
//   • Derivacion pendiente hace ESCALA_MIN minutos sin ningun mensaje de agente en la conversacion
//     -> Ojo lo dice en el grupo como respuesta al 🆘 (ojo_hilos). Uno por conversacion.
//   • Solo L-S de 9 a 20 ART: lo que entra de noche se escala a la mañana.
//   • No escala lo asignado a Corporativo / Gaston.
//   • Queda en ojo_derivacion_escalada; el «yo» respondiendo ese mensaje lo maneja ojo-telegram
//     (vendedor -> SI de Gaston; Gaston -> directo).
//   ?simular=1 devuelve lo que escalaria, sin mandar nada.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const ESCALA_MIN = 30;
const NO_ESCALA = ["Corporativo", "Gaston"];

const COLORES: Record<string, string> = {
  adrian: "🟢", bruno: "🔵", lola: "🔴", ulises: "🟣", mauro: "🟠", gus: "🟡", gustavo: "🟡",
  gaston: "⚫", corporativo: "⚫", administracion: "🟤", orbital: "🟤", postventa: "⚪",
};
function marca(n: string | null | undefined): string {
  const s = String(n ?? "").trim();
  const k = s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().split(/[\s(]+/)[0] ?? "";
  const c = COLORES[k];
  return c ? `${c} ${s}` : s;
}

async function telegramSend(chatId: number, text: string, replyTo?: number | null): Promise<number | null> {
  const body: Record<string, unknown> = { chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true };
  if (replyTo) body.reply_parameters = { message_id: replyTo, allow_sending_without_reply: true };
  const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const j = await res.json().catch(() => null);
  if (!j?.ok) console.error("Telegram sendMessage error:", JSON.stringify(j));
  return j?.result?.message_id ?? null;
}

const json = (x: unknown) =>
  new Response(JSON.stringify(x), { headers: { "Content-Type": "application/json; charset=utf-8" } });

Deno.serve(async (req: Request) => {
  const simular = new URL(req.url).searchParams.get("simular") === "1";
  const ar = new Date(Date.now() - 3 * 3600 * 1000);
  const hora = ar.getUTCHours();
  const dia = ar.getUTCDay();
  if (!simular && (dia < 1 || dia > 6 || hora < 9 || hora >= 20)) return json({ ok: true, fuera_de_horario: true });

  const { data: grupos } = await supabase.from("ojo_grupos").select("telegram_chat_id").eq("activo", true).eq("recibe_avisos", true);
  const chats = (grupos ?? []).map((g) => Number(g.telegram_chat_id));
  if (chats.length === 0) return json({ ok: false, motivo: "sin grupo" });

  const limite = new Date(Date.now() - ESCALA_MIN * 60 * 1000).toISOString();
  const desde24h = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { data: sinResp } = await supabase
    .from("derivaciones").select("id, conversacion_id, created_at, asignado_a")
    .eq("estado", "pendiente").gte("created_at", desde24h).lte("created_at", limite)
    .order("created_at", { ascending: false });

  const salida: unknown[] = [];
  const convVistas = new Set<string>();
  for (const d of sinResp ?? []) {
    const conv = d.conversacion_id as string | null;
    if (!conv || convVistas.has(conv)) continue;
    convVistas.add(conv);
    const { data: yaEsc } = await supabase.from("ojo_derivacion_escalada").select("derivacion_id")
      .eq("conversacion_id", conv).gte("creado_en", desde24h).limit(1).maybeSingle();
    if (yaEsc) continue;
    const { data: vend } = d.asignado_a
      ? await supabase.from("vendedores").select("codigo, nombre").eq("id", d.asignado_a).maybeSingle()
      : { data: null };
    const v = vend as { codigo: string; nombre: string } | null;
    if (v && NO_ESCALA.includes(v.codigo)) continue;
    const { count } = await supabase.from("at_mensajes").select("id", { count: "exact", head: true })
      .eq("conversacion_id", conv).in("emisor", ["agente", "humano"]).gt("created_at", d.created_at);
    if ((count ?? 0) > 0) continue;

    const { data: dv } = await supabase.from("ojo_v_derivaciones")
      .select("cliente_razon, contacto_nombre, contacto_telefono").eq("id", d.id).maybeSingle();
    const quien = dv?.cliente_razon ?? dv?.contacto_nombre ?? dv?.contacto_telefono ?? "un contacto";
    const min = Math.round((Date.now() - Date.parse(d.created_at)) / 60000);
    const hace = min < 90 ? `${min} min` : `${Math.round(min / 60)} h`;
    const texto =
      (v ? `⏰ No tengo respuesta de <b>${marca(v.nombre)}</b> sobre` : `⏰ Nadie tomó`) +
      ` el caso de <b>${quien}</b> (hace ${hace}).\n` +
      `🙋 <b>¿Algún vendedor puede tomar este caso?</b>\n` +
      `<i>Respondé «yo» a este mensaje y le pido el OK a Gastón.</i>`;
    if (simular) { salida.push({ derivacion: d.id, asignado: v?.codigo ?? null, quien, texto }); continue; }

    const desdeHilo = new Date(Date.parse(d.created_at) - 2 * 60 * 1000).toISOString();
    // Ojo por tema (2026-09-30): se escala en el grupo del tema del 🆘 (ahí está el 🆘 original).
    const { data: temaD } = await supabase.rpc("ojo_tema_derivacion", { p_derivacion: d.id });
    const { data: chatT } = await supabase.rpc("ojo_chat_tema", { p_tema: String(temaD ?? "ventas") });
    for (const chat of [Number(chatT) || chats[0]]) {
      const { data: h } = await supabase.from("ojo_hilos").select("telegram_message_id")
        .eq("telegram_chat_id", chat).eq("conversacion_id", conv).gte("creado_en", desdeHilo)
        .order("creado_en", { ascending: true }).limit(1).maybeSingle();
      // Se reserva antes de mandar: si dos corridas se pisan, la segunda choca con la PK y no duplica.
      const { error } = await supabase.from("ojo_derivacion_escalada").insert({
        derivacion_id: d.id, conversacion_id: conv, telegram_chat_id: chat,
        asignado_original: v?.codigo ?? null, cliente: String(quien).slice(0, 200),
      });
      if (error) { console.error("ojo_derivacion_escalada", JSON.stringify(error)); break; }
      const mid = await telegramSend(chat, texto, h?.telegram_message_id ? Number(h.telegram_message_id) : null);
      await supabase.from("ojo_derivacion_escalada").update({ telegram_message_id: mid }).eq("derivacion_id", d.id);
      salida.push({ derivacion: d.id, asignado: v?.codigo ?? null, message_id: mid });
      break; // un solo grupo de avisos
    }
  }
  return json({ ok: true, simulado: simular, escalados: salida });
});
