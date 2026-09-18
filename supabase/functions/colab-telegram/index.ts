// colab-telegram — agente de Telegram para los promotores (influencers).
// Bot aparte del Ojo: chat privado con cada promotor.
//   POST /            -> webhook de Telegram
//   GET  ?tarea=avisos -> cron: cambios de promo y acciones (Día de la Madre, Navidad…)
//
// Env: COLAB_TELEGRAM_BOT_TOKEN, COLAB_TELEGRAM_WEBHOOK_SECRET (opcional),
//      SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CRON_KEY (opcional)

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
// Config: primero el secret del entorno, si no está, app_config
const cacheCfg: Record<string, string> = {};
async function cfg(clave: string, env?: string): Promise<string> {
  const v = env ? Deno.env.get(env) ?? '' : '';
  if (v) return v;
  if (cacheCfg[clave] !== undefined) return cacheCfg[clave];
  const res = await fetch(`${SUPABASE_URL}/rest/v1/app_config?clave=eq.${clave}&select=valor`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
  const filas = res.ok ? ((await res.json()) as { valor: string }[]) : [];
  cacheCfg[clave] = filas[0]?.valor ?? '';
  return cacheCfg[clave];
}
const token = () => cfg('colab_telegram_bot_token', 'COLAB_TELEGRAM_BOT_TOKEN');

const BASE = "https://ver.orbitaleyewear.com.ar";

// ————— helpers —————

async function rpc<T = unknown>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(args),
  });
  if (!res.ok) throw new Error(`${fn}: ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

type Boton = { text: string; callback_data: string };

async function enviar(chat: number, texto: string, botones?: Boton[][]) {
  const res = await fetch(`https://api.telegram.org/bot${await token()}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chat,
      text: texto,
      parse_mode: "HTML",
      disable_web_page_preview: true,
      ...(botones ? { reply_markup: { inline_keyboard: botones } } : {}),
    }),
  });
  if (!res.ok) console.error("sendMessage", res.status, await res.text());
}

async function responderCallback(id: string, texto?: string) {
  await fetch(`https://api.telegram.org/bot${await token()}/answerCallbackQuery`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ callback_query_id: id, ...(texto ? { text: texto } : {}) }),
  });
}

const pesos = (n: number) =>
  "$" + Math.round(Number(n) || 0).toLocaleString("es-AR", { maximumFractionDigits: 0 });

const sinTilde = (s: string) =>
  (s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

// % que el promotor le muestra a su comunidad: siempre redondeado para arriba
const pctPublico = (promo: number, tachado: number) =>
  tachado > 0 ? Math.ceil((1 - promo / tachado) * 100 - 1e-9) : 0;

// ————— datos —————

type Quien = {
  influencer_id: number; nombre: string; clave: string;
  pct_comision: number; pct_descuento: number; coleccion: string | null;
  chat_id: number; admin: string; cbu_alias: string | null;
};

type Color = {
  product_id: number; handle: string; color: string; price: number;
  compare_at: number | null; sku: string; imagen: string | null;
};

type Modelo = { modelo: string; colores: Color[]; precio_desde: number };

async function catalogo(clave: string): Promise<Modelo[]> {
  const r = await rpc<Modelo[]>("colab_catalogo", { p_clave: clave });
  return r ?? [];
}

function buscarModelo(cat: Modelo[], texto: string): Modelo | null {
  const t = sinTilde(texto);
  if (!t) return null;
  const exacto = cat.find((m) => sinTilde(m.modelo) === t);
  if (exacto) return exacto;
  const dentro = cat.filter((m) => t.includes(sinTilde(m.modelo)) || sinTilde(m.modelo).includes(t));
  return dentro.length === 1 ? dentro[0] : null;
}

// ————— pantallas —————

function textoPrecio(price: number, compare: number | null, pctDesc: number) {
  const promo = Math.round(price * (1 - pctDesc / 100));
  const tachado = compare && compare > price ? compare : price;
  const off = pctPublico(promo, tachado);
  return { promo, tachado, off };
}

async function pantallaModelo(chat: number, q: Quien, m: Modelo) {
  const disponibles = m.colores.slice(0, 20);
  const { promo, tachado, off } = textoPrecio(m.colores[0].price, m.colores[0].compare_at, q.pct_descuento);
  const cab =
    `<b>${m.modelo}</b>\n` +
    `En la web ${pesos(m.colores[0].price)} · para tu comunidad <b>${pesos(promo)}</b>` +
    (tachado > promo ? ` (${off}% OFF sobre ${pesos(tachado)})` : "") +
    `\n\n¿De qué color querés el link?`;
  const botones = disponibles.map((c) => [{ text: c.color, callback_data: `c|${c.handle}` }]);
  await enviar(chat, cab, botones);
}

async function pantallaRecomendar(chat: number, q: Quien) {
  const recs = await rpc<
    { modelo: string; handle: string; stock: number; vendidas_60d: number; motivo: string; price: number; promo: number; compare_at: number | null }[]
  >("colab_recomendar", { p_clave: q.clave, p_limite: 5 });
  if (!recs?.length) {
    await enviar(chat, "Por ahora no tengo nada para recomendarte. Probá de nuevo más tarde.");
    return;
  }
  let t = "<b>Lo que más te conviene promocionar hoy</b>\n\n";
  for (const r of recs) {
    const off = pctPublico(r.promo, r.compare_at && r.compare_at > r.price ? r.compare_at : r.price);
    t += `<b>${r.modelo}</b> — ${pesos(r.promo)} para tu comunidad${off ? ` (${off}% OFF)` : ""}\n`;
    t += `<i>${r.motivo}</i>\n\n`;
  }
  t += "Tocá el que quieras y te paso el link.";
  await enviar(
    chat,
    t,
    recs.map((r) => [{ text: `Quiero el link de ${r.modelo}`, callback_data: `m|${r.modelo}` }]),
  );
}

async function pantallaComoVa(chat: number, q: Quien) {
  const links = await rpc<
    { codigo: string; modelo: string; color: string | null; red: string; formato: string; activo: boolean; clicks: number; pedidos: number; neto: number; com: number }[]
  >("colab_mis_links", { p_clave: q.clave });
  if (!links?.length) {
    await enviar(chat, "Todavía no tenés ningún link publicado. Escribime el modelo que querés promocionar y te lo armo.");
    return;
  }
  const tot = links.reduce(
    (a, l) => ({ clicks: a.clicks + l.clicks, pedidos: a.pedidos + l.pedidos, com: a.com + Number(l.com) }),
    { clicks: 0, pedidos: 0, com: 0 },
  );
  let t = `<b>Cómo vienen tus links</b>\n\n`;
  t += `Total: ${tot.clicks} visita${tot.clicks === 1 ? "" : "s"} · ${tot.pedidos} pedido${tot.pedidos === 1 ? "" : "s"} · tu ${q.pct_comision}%: <b>${pesos(tot.com)}</b>\n\n`;
  for (const l of links.slice(0, 12)) {
    const conv = l.clicks ? ((l.pedidos / l.clicks) * 100).toFixed(1).replace(".", ",") : "0";
    t += `<b>${l.modelo}</b>${l.color ? ` ${l.color}` : ""} · ${l.red} ${l.formato}${l.activo ? "" : " (pausado)"}\n`;
    t += `${BASE}/r/${l.codigo}\n`;
    t += `${l.clicks} visitas · ${l.pedidos} pedidos · ${conv}% conversión · ${pesos(l.com)}\n\n`;
  }
  await enviar(chat, t);
}

async function crearLink(chat: number, q: Quien, handle: string, red: string, formato: string) {
  try {
    const r = await rpc<{ codigo: string }>("colab_crear_link", {
      p_clave: q.clave, p_handle: handle, p_red: red, p_formato: formato,
    });
    const cat = await catalogo(q.clave);
    const col = cat.flatMap((m) => m.colores.map((c) => ({ ...c, modelo: m.modelo }))).find((c) => c.handle === handle);
    const link = `${BASE}/r/${r.codigo}`;
    let t = `<b>Listo, tu link:</b>\n${link}\n\n`;
    if (col) {
      const { promo, tachado, off } = textoPrecio(col.price, col.compare_at, q.pct_descuento);
      t += `<b>${col.modelo}</b> ${col.color} · ${red} ${formato}\n`;
      t += `En la web ${pesos(col.price)} → para tu comunidad <b>${pesos(promo)}</b>`;
      if (off) t += ` (${off}% OFF sobre ${pesos(tachado)})`;
      t += `\n\n<b>Para copiar:</b>\n`;
      t += `Me llegaron los ${col.modelo} de Orbital y no me los saco más. `;
      t += `Están ${pesos(tachado)} en la web y con mi link los conseguís a ${pesos(promo)}. Link en mi bio 👇\n${link}`;
    }
    await enviar(chat, t, [[{ text: "Ver cómo va", callback_data: "v|" + r.codigo }]]);
  } catch (e) {
    const msg = String(e);
    const amable = msg.includes("solo_sol")
      ? "Ese es de receta y por ahora solo podés promocionar anteojos de sol."
      : msg.includes("solo_coleccion")
        ? "Ese anteojo es de una colección exclusiva y no lo podés promocionar."
        : msg.includes("producto_sin_stock")
          ? "Ese color se quedó sin stock. Elegí otro."
          : "No pude crear el link. Probá de nuevo en un rato.";
    await enviar(chat, amable);
  }
}

const AYUDA =
  "Soy el asistente de promotores de Orbital. Podés:\n\n" +
  "• Escribirme un modelo (por ejemplo <b>PALERMO</b>) y te armo el link con el precio para tu comunidad\n" +
  "• <b>Qué promociono</b> — te digo qué conviene según stock y ventas\n" +
  "• <b>Cómo va</b> — visitas, pedidos, conversión y tu comisión por link\n\n" +
  "Y te aviso solo cuando cambia una promo o arranca una acción.";

// ————— webhook —————

async function manejarMensaje(msg: Record<string, any>) {
  const chat = msg.chat?.id as number;
  const from = msg.from?.id as number;
  const texto = String(msg.text ?? "").trim();
  if (!chat || !from) return;

  const q = await rpc<Quien | null>("colab_tg_quien", { p_tg: from });

  // alta: manda su clave in-…
  const clave = texto.match(/\bin-[a-z0-9]{6,}\b/i)?.[0];
  if (!q && clave) {
    const r = await rpc<{ ok: boolean; error?: string; nombre?: string }>("colab_tg_vincular", {
      p_tg: from, p_chat: chat, p_clave: clave,
      p_nombre: [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(" ") || null,
      p_username: msg.from?.username ?? null,
    });
    if (!r?.ok) {
      await enviar(chat, r?.error === "inactivo"
        ? "Esa clave está dada de baja. Hablá con tu administrador."
        : "Esa clave no me figura. Fijate que sea la que te pasaron, empieza con <code>in-</code>.");
      return;
    }
    await enviar(chat, `¡Hola ${r.nombre}! Quedaste vinculado 🎉\n\n${AYUDA}`);
    return;
  }

  if (!q) {
    await enviar(chat,
      "Hola 👋 Soy el asistente de promotores de Orbital.\n\n" +
      "Para empezar, mandame tu clave de acceso (la que empieza con <code>in-</code>). " +
      "Te la pasó tu administrador junto con el link de tu panel.");
    return;
  }

  const t = sinTilde(texto);

  if (texto.startsWith("/start") || t === "ayuda" || texto.startsWith("/ayuda")) {
    await enviar(chat, `Hola ${q.nombre} 👋\n\n${AYUDA}`);
    return;
  }
  if (t.includes("que promociono") || t.includes("recomend") || texto.startsWith("/recomendar")) {
    await pantallaRecomendar(chat, q);
    return;
  }
  if (t.includes("como va") || t.includes("como viene") || t.includes("numeros") || texto.startsWith("/comova")) {
    await pantallaComoVa(chat, q);
    return;
  }

  // ¿nombró un modelo?
  const cat = await catalogo(q.clave);
  const m = buscarModelo(cat, texto);
  if (m) {
    await pantallaModelo(chat, q, m);
    return;
  }

  await enviar(chat, "No te entendí 🤔\n\n" + AYUDA, [
    [{ text: "¿Qué promociono?", callback_data: "r|" }],
    [{ text: "¿Cómo van mis links?", callback_data: "k|" }],
  ]);
}

async function manejarCallback(cb: Record<string, any>) {
  const chat = cb.message?.chat?.id as number;
  const from = cb.from?.id as number;
  const data = String(cb.data ?? "");
  await responderCallback(cb.id);
  if (!chat || !from) return;

  const q = await rpc<Quien | null>("colab_tg_quien", { p_tg: from });
  if (!q) {
    await enviar(chat, "Mandame tu clave (empieza con <code>in-</code>) para vincularte.");
    return;
  }

  const [op, ...resto] = data.split("|");

  if (op === "r") return void (await pantallaRecomendar(chat, q));
  if (op === "k" || op === "v") return void (await pantallaComoVa(chat, q));

  if (op === "m") {
    const cat = await catalogo(q.clave);
    const m = buscarModelo(cat, resto.join("|"));
    if (m) await pantallaModelo(chat, q, m);
    else await enviar(chat, "Ese modelo ya no está disponible.");
    return;
  }

  if (op === "c") {
    const handle = resto[0];
    await enviar(chat, "¿Dónde lo vas a publicar?", [
      [
        { text: "IG historia", callback_data: `l|${handle}|instagram|historia` },
        { text: "IG posteo", callback_data: `l|${handle}|instagram|posteo` },
      ],
      [
        { text: "IG reel", callback_data: `l|${handle}|instagram|reel` },
        { text: "TikTok", callback_data: `l|${handle}|tiktok|video` },
      ],
      [{ text: "WhatsApp", callback_data: `l|${handle}|whatsapp|estado` }],
    ]);
    return;
  }

  if (op === "l") {
    const [handle, red, formato] = resto;
    await crearLink(chat, q, handle, red, formato);
    return;
  }
}

// ————— avisos (cron) —————

async function correrAvisos(): Promise<{ mandados: number }> {
  const pend = await rpc<Record<string, any>[]>("colab_tg_pendientes");
  let mandados = 0;
  for (const p of pend ?? []) {
    let texto = "";
    if (p.tipo === "promo") {
      const bajo = Number(p.price_nuevo) < Number(p.price_ant);
      texto =
        `${bajo ? "📉" : "📈"} <b>${p.modelo}</b>${p.color ? ` ${p.color}` : ""} cambió de precio\n\n` +
        `En la web: ${pesos(p.price_ant)} → <b>${pesos(p.price_nuevo)}</b>\n` +
        `Para tu comunidad: ${pesos(p.promo_ant)} → <b>${pesos(p.promo)}</b>\n\n` +
        (bajo ? "Buen momento para empujarlo. Tu link de siempre ya toma el precio nuevo." : "Actualizá el precio que venías diciendo, tu link ya toma el nuevo.");
    } else if (p.tipo === "accion") {
      texto =
        `🎯 <b>${p.accion}</b>\n\n` +
        (p.mensaje ? `${p.mensaje}\n\n` : "") +
        (p.modelos?.length ? `Modelos de la acción: ${p.modelos.join(", ")}\n\n` : "") +
        `Escribime el modelo y te armo el link.`;
    }
    if (!texto) continue;
    await enviar(p.chat_id, texto);
    await rpc("colab_tg_aviso_ok", { p_inf: p.influencer_id, p_tipo: p.tipo, p_ref: p.ref });
    mandados++;
  }
  return { mandados };
}

// ————— entrada —————

Deno.serve(async (req) => {
  const url = new URL(req.url);

  if (url.searchParams.get("tarea") === "avisos") {
    const cronKey = await cfg("cron_key", "CRON_KEY");
    if (cronKey && req.headers.get("x-cron-key") !== cronKey) {
      return new Response("unauthorized", { status: 401 });
    }
    const r = await correrAvisos();
    return Response.json(r);
  }

  if (req.method !== "POST") return new Response("ok");

  const secret = await cfg("colab_telegram_webhook_secret", "COLAB_TELEGRAM_WEBHOOK_SECRET");
  if (secret && req.headers.get("x-telegram-bot-api-secret-token") !== secret) {
    return new Response("unauthorized", { status: 401 });
  }

  let update: Record<string, any> = {};
  try {
    update = await req.json();
  } catch {
    return new Response("ok");
  }

  try {
    if (update.callback_query) await manejarCallback(update.callback_query);
    else if (update.message) await manejarMensaje(update.message);
  } catch (e) {
    console.error("colab-telegram", e);
  }
  return new Response("ok");
});
