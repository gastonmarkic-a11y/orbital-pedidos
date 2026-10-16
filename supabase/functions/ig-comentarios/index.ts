// ig-comentarios — comentarios de Instagram (publicaciones y anuncios) al grupo Ojo Consumidor Final (2026-10-16).
// Problema: mientras la app de Meta no esté aprobada, Meta no le manda los comentarios al webhook
// (webhook-instagram v23 los sabe contestar, pero nunca le llegó ninguno). Los anuncios juntaban
// preguntas ("¿dónde lo compro en CABA?", "¿qué modelo es?") que nadie contestaba.
// Qué hace:
//   • POST {accion:'barrer'} (cron cada 5 min): lee por API las últimas publicaciones y la pieza de IG de cada
//     anuncio activo; de las que sumaron comentarios baja los nuevos. Los que parecen consulta (mismo criterio
//     que webhook-instagram) y tienen menos de AUTO_HORAS: IRIS le escribe por privado + "te escribimos por
//     privado" en el comentario. Todos los que son consulta salen como tarjeta al grupo de consumidores.
//   • POST {accion:'responder', comment_id, texto, autor} (lo llama ojo-telegram cuando alguien responde la
//     tarjeta): "público: …" contesta en el comentario; si no, intenta por privado y, si Meta no deja, en público.
//   • {simular:true} en 'barrer' devuelve lo que haría, sin escribir ni mandar nada.
// Mientras la app no esté aprobada Meta no muestra el usuario que comentó: la tarjeta lo dice.
// Dedupe con webhook-instagram por meta_msg_procesados ('comment:<id>'): cuando aprueben la app no se contesta dos veces.
// Auth: x-cron-key = app_config.cron_key. Se apaga con app_config.ig_comentarios = 'off'.
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
const PAGE_TOKEN = Deno.env.get("IG_PAGE_TOKEN") ?? "";
const TG_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const CUENTA_ADS = Deno.env.get("META_AD_ACCOUNT_ID") ?? "act_212025263653522";
const G = "https://graph.facebook.com/v21.0";
const TZ = "America/Argentina/Buenos_Aires";
const AUTO_HORAS = 3;        // más viejo que esto no se contesta solo: decide una persona
const BACKLOG_DIAS = 10;     // comentarios más viejos no se traen
const PUBLICACIONES = 25;    // últimas publicaciones orgánicas que se miran

// Mismo criterio que webhook-instagram (+ "modelo" y los reclamos por no contestar): "Hermosos 😍" o
// "@amiga mirá" no son consulta.
const RE_CONSULTA = /\?|precio|valor|vale|cu[aá]nto|info|venden|venta|mayor|env[ií]o|envian|stock|d[oó]nde|comprar|compro|quiero|link|cuotas|medida|graduad|receta|polariz|local|direcci[oó]n|tienen|disponib|modelo|contest|respond|atiend|nadie|\$|\bdm\b|\bmd\b|privado|interesa|consulta/i;
const TXT_PRIVADO = "¡Hola! 😊 Soy IRIS, de Orbital. Vi tu comentario y te escribo por acá así te ayudo mejor. ¿Los anteojos son para vos o para regalar? Contame qué estilo te gusta 😎\n(Si tenés una óptica, avisame y te paso con el equipo comercial 🙌)";
const TXT_PUBLICO = "¡Hola! Te escribimos por privado 🙌";

const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b, null, 1), { status, headers: { "content-type": "application/json" } });

async function cfg(clave: string): Promise<string | null> {
  const { data } = await supabase.from("app_config").select("valor").eq("clave", clave).maybeSingle();
  return (data as { valor: string } | null)?.valor ?? null;
}

async function graph(path: string, token: string): Promise<any> {
  const r = await fetch(`${G}/${path}${path.includes("?") ? "&" : "?"}access_token=${token}`);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { console.error("graph", path.split("?")[0], r.status, JSON.stringify(j?.error ?? j)); return null; }
  return j;
}

async function graphPost(path: string, body: unknown): Promise<{ ok: boolean; j: any }> {
  try {
    const r = await fetch(`${G}/${path}?access_token=${PAGE_TOKEN}`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) console.error("graph post", path, r.status, JSON.stringify(j?.error ?? j));
    return { ok: r.ok, j };
  } catch (e) { console.error("graph post", path, (e as Error).message); return { ok: false, j: {} }; }
}

const respuestaPrivada = (commentId: string, texto: string) =>
  graphPost("me/messages", { recipient: { comment_id: commentId }, message: { text: texto } });
const respuestaPublica = (commentId: string, texto: string) => graphPost(`${commentId}/replies`, { message: texto });

async function tgSend(chatId: number, html: string, replyTo?: number): Promise<number | null> {
  const r = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: html, parse_mode: "HTML", disable_web_page_preview: true, ...(replyTo ? { reply_to_message_id: replyTo } : {}) }),
  });
  const j = await r.json().catch(() => ({}));
  if (!j?.ok) { console.error("telegram", JSON.stringify(j)); return null; }
  return j.result.message_id;
}

function hace(iso: string | null): string {
  if (!iso) return "";
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 60) return `hace ${Math.max(min, 1)} min`;
  if (min < 24 * 60) return `hace ${Math.round(min / 60)} h`;
  return `hace ${Math.round(min / 1440)} d (${new Date(iso).toLocaleDateString("es-AR", { timeZone: TZ, day: "2-digit", month: "2-digit" })})`;
}

type Pieza = { media_id: string; origen: "anuncio" | "publicacion"; titulo: string; permalink: string | null };

// Publicaciones recientes + la pieza de IG de cada anuncio activo (los anuncios no aparecen en /media).
async function piezas(): Promise<Pieza[]> {
  const out = new Map<string, Pieza>();
  const me = await graph("me?fields=instagram_business_account", PAGE_TOKEN);
  const ig = me?.instagram_business_account?.id;
  if (ig) {
    const media = await graph(`${ig}/media?fields=id,caption,permalink,timestamp&limit=${PUBLICACIONES}`, PAGE_TOKEN);
    for (const m of media?.data ?? []) {
      out.set(m.id, { media_id: m.id, origen: "publicacion", titulo: String(m.caption ?? "").split("\n")[0].slice(0, 60) || "publicación", permalink: m.permalink ?? null });
    }
  }
  const { data: auth } = await supabase.from("meta_auth").select("access_token").eq("id", "principal").maybeSingle();
  const userToken = (auth as { access_token: string } | null)?.access_token ?? Deno.env.get("META_ACCESS_TOKEN") ?? "";
  if (userToken) {
    let next: string | null = `${CUENTA_ADS}/ads?fields=name,creative{effective_instagram_media_id,instagram_permalink_url}&limit=100&effective_status=${encodeURIComponent('["ACTIVE"]')}`;
    for (let i = 0; next && i < 3; i++) {
      const ads = await graph(next, userToken);
      for (const a of ads?.data ?? []) {
        const m = a?.creative?.effective_instagram_media_id;
        if (!m) continue;
        // Una pieza orgánica promocionada sigue siendo la misma publicación: se la marca como anuncio.
        out.set(m, { media_id: m, origen: "anuncio", titulo: String(a.name ?? "anuncio").slice(0, 70), permalink: a?.creative?.instagram_permalink_url ?? out.get(m)?.permalink ?? null });
      }
      const n: string | undefined = ads?.paging?.next;
      next = n ? n.replace(`${G}/`, "").replace(/&?access_token=[^&]+/, "") : null;
    }
  }
  return [...out.values()];
}

// comments_count de hasta 50 piezas por llamada: solo se baja la lista de las que sumaron comentarios.
async function conteos(ids: string[]): Promise<Map<string, number>> {
  const res = new Map<string, number>();
  for (let i = 0; i < ids.length; i += 50) {
    const lote = ids.slice(i, i + 50);
    const j = await graph(`?ids=${lote.join(",")}&fields=comments_count`, PAGE_TOKEN);
    for (const id of lote) if (j?.[id]) res.set(id, Number(j[id].comments_count) || 0);
  }
  return res;
}

async function barrer(simular: boolean) {
  if (!PAGE_TOKEN) return { error: "falta IG_PAGE_TOKEN" };
  const apagado = (await cfg("ig_comentarios")) === "off";
  const chat = Number((await supabase.rpc("ojo_chat_tema", { p_tema: "consumidor" })).data) || 0;
  const lista = await piezas();
  const cuentas = await conteos(lista.map((p) => p.media_id));
  const { data: previos } = await supabase.from("ig_media_estado").select("media_id, comments_count").in("media_id", lista.map((p) => p.media_id));
  const antes = new Map((previos ?? []).map((r: any) => [r.media_id, r.comments_count as number]));

  const limite = Date.now() - BACKLOG_DIAS * 86400000;
  const resumen = { piezas: lista.length, con_novedades: 0, nuevos: 0, consultas: 0, auto: 0, tarjetas: 0, detalle: [] as unknown[] };

  for (const p of lista) {
    const n = cuentas.get(p.media_id) ?? 0;
    if (n === 0 || n === antes.get(p.media_id)) continue;
    resumen.con_novedades++;
    const j = await graph(`${p.media_id}/comments?fields=id,text,username,timestamp&limit=50`, PAGE_TOKEN);
    const comentarios = (j?.data ?? []) as { id: string; text?: string; username?: string; timestamp?: string }[];
    const ids = comentarios.map((c) => c.id);
    const { data: ya } = ids.length ? await supabase.from("ig_comentarios").select("comment_id").in("comment_id", ids) : { data: [] };
    const vistos = new Set((ya ?? []).map((r: any) => r.comment_id));

    for (const c of comentarios.reverse()) { // del más viejo al más nuevo, así las tarjetas salen en orden
      if (vistos.has(c.id) || !c.text) continue;
      const ts = c.timestamp ? new Date(c.timestamp).toISOString() : null;
      if (ts && new Date(ts).getTime() < limite) continue;
      resumen.nuevos++;
      const consulta = RE_CONSULTA.test(c.text);
      const fila: Record<string, unknown> = {
        comment_id: c.id, media_id: p.media_id, origen: p.origen, titulo: p.titulo, permalink: p.permalink,
        texto: c.text, username: c.username ?? null, comentado_en: ts, consulta,
      };
      if (!consulta) { if (!simular) await supabase.from("ig_comentarios").insert(fila); continue; }
      resumen.consultas++;

      const reciente = ts ? Date.now() - new Date(ts).getTime() < AUTO_HORAS * 3600000 : false;
      let estado = "";
      if (simular) {
        estado = reciente && !apagado ? "(simulado) IRIS le escribiría por privado" : "(simulado) sin respuesta automática";
      } else if (reciente && !apagado) {
        // Si cuando aprueben la app el webhook ya lo contestó, acá no se repite.
        const { error: dup } = await supabase.from("meta_msg_procesados").insert({ mid: `comment:${c.id}` });
        if (dup) {
          estado = "✅ IRIS ya lo contestó por el webhook";
          fila.privado_ok = true;
        } else {
          const priv = await respuestaPrivada(c.id, TXT_PRIVADO);
          if (priv.ok) {
            fila.privado_ok = true;
            const pub = await respuestaPublica(c.id, TXT_PUBLICO);
            fila.publico_ok = pub.ok;
            fila.conversacion_id = await registrarPrivado(String(priv.j?.recipient_id ?? ""), c.text, TXT_PRIVADO, fila);
            estado = `✅ IRIS le escribió por privado${pub.ok ? " y dejó «te escribimos por privado»" : ""}. Si contesta, sigue IRIS.`;
            resumen.auto++;
          } else {
            fila.detalle = `privado: ${JSON.stringify(priv.j?.error?.message ?? priv.j).slice(0, 300)}`;
            estado = "⚠️ Meta no dejó escribirle por privado";
          }
        }
      } else {
        estado = apagado ? "⏸️ Respuesta automática apagada" : `⚠️ Sin respuesta automática (tiene más de ${AUTO_HORAS} h)`;
      }

      const html =
        `💬 <b>Comentario en ${p.origen === "anuncio" ? "anuncio" : "publicación"}</b> · ${esc(p.titulo)}\n` +
        `<i>“${esc(c.text.slice(0, 500))}”</i>\n` +
        `👤 ${c.username ? "@" + esc(c.username) : "usuario oculto por Meta"} · ${hace(ts)}\n` +
        `${estado}\n\n` +
        `↩️ <b>Respondé este mensaje</b> y le escribo por privado. Empezá con <code>público:</code> para contestar en el comentario.` +
        (p.permalink ? `\n<a href="${esc(p.permalink)}">Ver en Instagram</a>` : "");

      if (simular) { resumen.detalle.push({ titulo: p.titulo, texto: c.text, ts, estado }); continue; }
      if (chat) {
        const mid = await tgSend(chat, html);
        if (mid) { fila.telegram_chat_id = chat; fila.telegram_message_id = mid; resumen.tarjetas++; }
      }
      await supabase.from("ig_comentarios").insert(fila);
    }
    if (!simular) await supabase.from("ig_media_estado").upsert({ media_id: p.media_id, comments_count: n, actualizado_en: new Date().toISOString() });
  }
  return resumen;
}

// Igual que webhook-instagram: la charla privada queda en Conversaciones con el comentario de origen.
async function registrarPrivado(igsid: string, comentario: string, enviado: string, fila: Record<string, unknown>): Promise<string | null> {
  if (!igsid) return null;
  try {
    let { data: ct } = await supabase.from("contactos").select("id").eq("instagram_handle", igsid).maybeSingle();
    if (!ct) ct = (await supabase.from("contactos").insert({ instagram_handle: igsid }).select("id").single()).data;
    if (!ct) return null;
    const { data: abiertas } = await supabase.from("at_conversaciones").select("id")
      .eq("contacto_id", ct.id).in("estado", ["bot_activo", "derivada"]).order("updated_at", { ascending: false, nullsFirst: false }).limit(1);
    let convId = abiertas?.[0]?.id as string | undefined;
    if (!convId) convId = (await supabase.from("at_conversaciones").insert({ contacto_id: ct.id, canal_origen: "instagram" }).select("id").single()).data?.id;
    if (!convId) return null;
    const origen = { origen: "comentario", comment_id: fila.comment_id, media_id: fila.media_id, anuncio: fila.titulo };
    await supabase.from("at_mensajes").insert([
      { conversacion_id: convId, canal: "instagram", emisor: "cliente", contenido: `[comentario en ${fila.origen}] ${comentario}`, metadata: origen },
      { conversacion_id: convId, canal: "instagram", emisor: "bot", contenido: enviado, metadata: origen },
    ]);
    return convId;
  } catch (e) { console.error("registrarPrivado", (e as Error).message); return null; }
}

// Respuesta de una persona desde la tarjeta de Telegram.
async function responder(commentId: string, textoCrudo: string, autor: string) {
  const { data: f } = await supabase.from("ig_comentarios").select("*").eq("comment_id", commentId).maybeSingle();
  if (!f) return { ok: false, detalle: "no encuentro ese comentario" };
  const publico = /^\s*p[uú]blico\s*:/i.test(textoCrudo);
  const texto = textoCrudo.replace(/^\s*p[uú]blico\s*:\s*/i, "").trim();
  if (!texto) return { ok: false, detalle: "el mensaje está vacío" };

  let via = ""; let detalle = "";
  if (!publico && !f.privado_ok) {
    const priv = await respuestaPrivada(commentId, texto);
    if (priv.ok) {
      via = "privado";
      const conv = await registrarPrivado(String(priv.j?.recipient_id ?? ""), f.texto, `${autor}: ${texto}`, f);
      await supabase.from("ig_comentarios").update({ privado_ok: true, conversacion_id: conv ?? f.conversacion_id }).eq("comment_id", commentId);
      // Aviso corto en el comentario, para que lo vea quien lo hizo y el resto.
      if (!f.publico_ok) {
        const pub = await respuestaPublica(commentId, TXT_PUBLICO);
        if (pub.ok) await supabase.from("ig_comentarios").update({ publico_ok: true }).eq("comment_id", commentId);
      }
    } else detalle = String(priv.j?.error?.message ?? "Meta no dejó escribirle por privado");
  } else if (!publico && f.conversacion_id) {
    // Ya hubo un privado: si la persona contestó, sigue la charla por DM.
    try {
      const r = await fetch(`${SUPABASE_URL}/functions/v1/at-responder`, {
        method: "POST", headers: { "content-type": "application/json", Authorization: `Bearer ${SERVICE_KEY}` },
        body: JSON.stringify({ conversacion_id: f.conversacion_id, texto, agente: autor }),
      });
      const j = await r.json().catch(() => ({}));
      if (j?.enviado) via = "privado"; else detalle = String(j?.detalle ?? "no salió por privado");
    } catch (e) { detalle = (e as Error).message; }
  }
  // Público pedido, o el privado no salió (Meta deja un solo privado por comentario y hasta 7 días).
  if (!via) {
    const pub = await respuestaPublica(commentId, texto);
    if (pub.ok) via = publico ? "público" : "público (por privado no se pudo)";
    else detalle = `${detalle ? detalle + " | " : ""}${String(pub.j?.error?.message ?? "Meta rechazó la respuesta pública")}`;
  }
  if (via) await supabase.from("ig_comentarios").update({ respondido_por: autor, respondido_en: new Date().toISOString(), ...(via.startsWith("público") ? { publico_ok: true } : {}) }).eq("comment_id", commentId);
  return { ok: !!via, via, detalle };
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== "POST") return json({ error: "method" }, 405);
  const clave = await cfg("cron_key");
  if (!clave || req.headers.get("x-cron-key") !== clave) return json({ error: "no_autorizado" }, 401);
  let body: any = {};
  try { body = await req.json(); } catch { /* vacío */ }
  try {
    if (body.accion === "responder") {
      if (!body.comment_id || !body.texto) return json({ error: "faltan datos" }, 400);
      return json(await responder(String(body.comment_id), String(body.texto), String(body.autor ?? "Orbital")));
    }
    return json(await barrer(!!body.simular));
  } catch (e) {
    console.error("ig-comentarios", (e as Error).message);
    return json({ error: (e as Error).message }, 500);
  }
});
