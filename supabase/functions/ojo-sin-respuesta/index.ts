// ojo-sin-respuesta — charlas de consumidores donde IRIS no contestó → grupo Ojo Consumidor Final, en el momento (2026-10-16).
// Problema: el 🆘 solo sale cuando IRIS deriva. Si IRIS no contesta nada (un "1" que no entendió, un reel, una
// falla), el cliente queda hablando solo y nadie se entera hasta el resumen de las 19:30 (ojo-consumidores).
// Qué hace (cron cada 5 min): ojo_conversaciones_sin_respuesta() trae las charlas de consumidores (sin cod_cliente,
// no mayoristas, no derivadas) cuyo último mensaje es del cliente hace más de MIN minutos y menos de HORAS horas.
// Cada una sale como tarjeta anclada en ojo_hilos: respondiéndola le llega al cliente por su canal (ojo-telegram →
// at-responder) y el trigger de ojo_hilos le cuelga abajo el 📋 resumen de la charla. Un aviso por mensaje.
// Los "gracias / ok / 👍" sueltos no se avisan. ?simular=1 (o {simular:true}) devuelve la lista sin mandar nada.
// Auth: x-cron-key = app_config.cron_key. Se apaga con app_config.ojo_sin_respuesta = 'off'.
import { createClient } from "jsr:@supabase/supabase-js@2";

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const TG_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const MIN = 4;
const HORAS = 12;
const CANAL: Record<string, string> = { instagram: "Instagram", messenger: "Messenger", web: "el chat de la web", whatsapp: "WhatsApp" };
const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b, null, 1), { status, headers: { "content-type": "application/json" } });

async function cfg(clave: string): Promise<string | null> {
  const { data } = await supabase.from("app_config").select("valor").eq("clave", clave).maybeSingle();
  return (data as { valor: string } | null)?.valor ?? null;
}

async function tgSend(chatId: number, html: string): Promise<number | null> {
  const r = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: html, parse_mode: "HTML", disable_web_page_preview: true }),
  });
  const j = await r.json().catch(() => ({}));
  if (!j?.ok) { console.error("telegram", JSON.stringify(j)); return null; }
  return j.result.message_id;
}

type Fila = { conversacion_id: string; canal: string; estado: string; contacto: string; mensaje_id: string; contenido: string; enviado_en: string };

Deno.serve(async (req: Request): Promise<Response> => {
  const clave = await cfg("cron_key");
  if (!clave || req.headers.get("x-cron-key") !== clave) return json({ error: "no_autorizado" }, 401);
  let body: any = {};
  try { body = await req.json(); } catch { /* vacío */ }
  const simular = !!body.simular || new URL(req.url).searchParams.get("simular") === "1";
  if (!simular && (await cfg("ojo_sin_respuesta")) === "off") return json({ ok: true, apagado: true });

  const { data, error } = await supabase.rpc("ojo_conversaciones_sin_respuesta", { p_min: MIN, p_horas: HORAS });
  if (error) return json({ error: error.message }, 500);
  const filas = (data ?? []) as Fila[];
  if (simular) return json({ simular: true, filas });

  const chat = Number((await supabase.rpc("ojo_chat_tema", { p_tema: "consumidor" })).data) || 0;
  if (!chat) return json({ error: "no hay grupo de consumidores" }, 500);

  let avisados = 0;
  for (const f of filas) {
    // Primero se reserva el mensaje: si dos corridas se pisan, solo una avisa.
    const { error: dup } = await supabase.from("ojo_sin_respuesta_aviso").insert({ mensaje_id: f.mensaje_id, conversacion_id: f.conversacion_id });
    if (dup) continue;
    const min = Math.round((Date.now() - new Date(f.enviado_en).getTime()) / 60000);
    const cuando = min < 60 ? `hace ${min} min` : `hace ${Math.round(min / 60)} h`;
    const html =
      `🤐 <b>IRIS no le contestó</b> · ${esc(CANAL[f.canal] ?? f.canal)} · ${esc(f.contacto)} · ${cuando}\n` +
      `<i>“${esc(String(f.contenido).slice(0, 400))}”</i>\n\n` +
      `↩️ <b>Respondé este mensaje</b> y le llega por ${esc(CANAL[f.canal] ?? f.canal)}.`;
    const mid = await tgSend(chat, html);
    if (!mid) continue;
    await supabase.from("ojo_sin_respuesta_aviso").update({ telegram_chat_id: chat, telegram_message_id: mid }).eq("mensaje_id", f.mensaje_id);
    await supabase.from("ojo_hilos").upsert(
      { telegram_chat_id: chat, telegram_message_id: mid, conversacion_id: f.conversacion_id },
      { onConflict: "telegram_chat_id,telegram_message_id" },
    );
    avisados++;
  }
  return json({ ok: true, encontrados: filas.length, avisados });
});
