// Chequeo diario de la cartera de cheques (cron). Mismo mecanismo que el bot Ojo:
// avisa por Telegram y deja el aviso registrado, sin decidir por nadie.
//
// Qué hace:
//   1. Cheques que vencen dentro de DIAS_PREAVISO → pasan a 'pendiente_deposito' y avisan.
//      Es una transición mecánica (llegó la fecha), no una decisión.
//   2. Cheques ya vencidos que siguen en cartera o pendientes → insisten.
//   3. Cheques depositados hace más de DIAS_ACREDITACION sin marcar cobrados → preguntan.
//
// Lo que NUNCA hace: marcar un cheque como cobrado o rechazado. Eso lo confirma una persona
// en la Suite (está fuera de alcance por decisión de diseño, no por falta de código).
//
// Destino de los avisos: el grupo de Telegram con tipo='finanzas'. Si no existe, va por
// privado a los ojo_admins: la cartera de cheques no se comparte con el grupo de ventas.
//
// Deploy (pendiente de confirmación):
//   supabase functions deploy finanzas-cheques-aviso
//   y un cron diario ~08:00 ART apuntando a la función.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")!;

const DIAS_PREAVISO = 3;      // se prepara el depósito 3 días antes del vencimiento
const DIAS_ACREDITACION = 2;  // depositado hace 2 días y sin cobrar: hay que confirmarlo

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const plata = (n: number) => "$ " + Math.round(Number(n || 0)).toLocaleString("es-AR");

async function telegramSend(chatId: number, text: string) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
  });
}

/** Los destinatarios de plata: grupo de finanzas si existe, si no los admins por privado. */
async function destinatarios(): Promise<number[]> {
  const { data: grupos } = await supabase
    .from("ojo_grupos")
    .select("telegram_chat_id")
    .eq("tipo", "finanzas")
    .eq("activo", true);
  if (grupos?.length) return grupos.map((g) => g.telegram_chat_id);
  const { data: admins } = await supabase.from("ojo_admins").select("telegram_user_id");
  return (admins ?? []).map((a) => a.telegram_user_id);
}

function ymd(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

interface Cheque {
  id: number;
  numero: string;
  banco: string;
  monto: number;
  estado: string;
  fecha_vencimiento: string;
  fecha_deposito: string | null;
  cliente_nombre: string | null;
  aviso_enviado_at: string | null;
  historial: unknown[] | null;
}

Deno.serve(async (_req: Request) => {
  const ahora = new Date();
  const hoy = ymd(ahora);
  const limitePreaviso = ymd(new Date(ahora.getTime() + DIAS_PREAVISO * 86400000));
  const limiteAcreditacion = ymd(new Date(ahora.getTime() - DIAS_ACREDITACION * 86400000));
  const chats = await destinatarios();
  const lineas: string[] = [];

  const registrar = async (c: Cheque, accion: string, nuevoEstado?: string) => {
    const parche: Record<string, unknown> = {
      aviso_enviado_at: ahora.toISOString(),
      updated_at: ahora.toISOString(),
      historial: [
        ...((c.historial as unknown[]) ?? []),
        { fecha: ahora.toISOString(), de: c.estado, a: nuevoEstado ?? c.estado, por: "aviso automático", accion },
      ],
    };
    if (nuevoEstado) parche.estado = nuevoEstado;
    await supabase.from("cheques_cartera").update(parche).eq("id", c.id);
  };

  // 1) Por vencer: se marcan para depositar.
  const { data: porVencer } = await supabase
    .from("cheques_cartera")
    .select("*")
    .eq("estado", "en_cartera")
    .lte("fecha_vencimiento", limitePreaviso)
    .gte("fecha_vencimiento", hoy);
  for (const c of (porVencer ?? []) as Cheque[]) {
    await registrar(c, "preaviso de vencimiento", "pendiente_deposito");
    lineas.push(`📅 <b>${c.numero}</b> (${c.banco}) ${plata(c.monto)} vence el ${c.fecha_vencimiento} → pasa a pendiente de depósito`);
  }

  // 2) Vencidos y todavía sin depositar.
  const { data: vencidos } = await supabase
    .from("cheques_cartera")
    .select("*")
    .in("estado", ["en_cartera", "pendiente_deposito"])
    .lt("fecha_vencimiento", hoy);
  for (const c of (vencidos ?? []) as Cheque[]) {
    // Se insiste una vez por día, no en cada corrida.
    if (c.aviso_enviado_at && c.aviso_enviado_at.slice(0, 10) === hoy) continue;
    await registrar(c, "vencido sin depositar");
    lineas.push(`⚠️ <b>${c.numero}</b> (${c.banco}) ${plata(c.monto)} venció el ${c.fecha_vencimiento} y sigue sin depositarse`);
  }

  // 3) Depositados sin confirmar la acreditación. El estado NO se toca: lo confirma una persona.
  const { data: sinAcreditar } = await supabase
    .from("cheques_cartera")
    .select("*")
    .eq("estado", "depositado")
    .lte("fecha_deposito", limiteAcreditacion);
  for (const c of (sinAcreditar ?? []) as Cheque[]) {
    if (c.aviso_enviado_at && c.aviso_enviado_at.slice(0, 10) === hoy) continue;
    await registrar(c, "acreditación sin confirmar");
    lineas.push(`❓ <b>${c.numero}</b> (${c.banco}) ${plata(c.monto)} depositado el ${c.fecha_deposito}: ¿se acreditó o rebotó?`);
  }

  if (lineas.length && chats.length) {
    const texto = `<b>Cheques · ${hoy}</b>\n\n${lineas.join("\n")}\n\nCobrado y rechazado se marcan a mano en la Suite.`;
    for (const chat of chats) await telegramSend(chat, texto);
  }

  return new Response(
    JSON.stringify({ ok: true, avisos: lineas.length, destinatarios: chats.length }),
    { headers: { "Content-Type": "application/json" } }
  );
});
