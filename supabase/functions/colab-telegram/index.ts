// colab-telegram — agente de Telegram para los promotores (influencers).
// Bot aparte del Ojo: chat privado con cada promotor, y un grupo interno de Orbital que ve todo.
//   POST /            -> webhook de Telegram
//   GET  ?tarea=avisos -> cron: cambios de promo y acciones (Día de la Madre, Navidad…)

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

async function guardarCfg(clave: string, valor: string) {
  await fetch(`${SUPABASE_URL}/rest/v1/app_config`, {
    method: "POST",
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates",
    },
    body: JSON.stringify({ clave, valor }),
  });
  cacheCfg[clave] = valor;
}

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

async function enviar(chat: number, texto: string, botones?: Boton[][], teclado?: unknown) {
  const res = await fetch(`https://api.telegram.org/bot${await token()}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chat,
      text: texto,
      parse_mode: "HTML",
      disable_web_page_preview: true,
      ...(botones ? { reply_markup: { inline_keyboard: botones } } : {}),
      ...(teclado ? { reply_markup: teclado } : {}),
    }),
  });
  if (!res.ok) console.error("sendMessage", res.status, await res.text());
}

// Teclado de alta: un toque y Telegram manda su teléfono
const PEDIR_TEL = {
  keyboard: [[{ text: "📱 Entrar con mi teléfono", request_contact: true }]],
  resize_keyboard: true,
  one_time_keyboard: true,
};

async function responderCallback(id: string, texto?: string) {
  await fetch(`https://api.telegram.org/bot${await token()}/answerCallbackQuery`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ callback_query_id: id, ...(texto ? { text: texto } : {}) }),
  });
}

// Grupo interno de Orbital: ve todo lo que hace cada promotor con el bot.
// La marca #p<id> al pie sirve para contestarle a ESE promotor respondiendo el mensaje.
async function espejo(texto: string, infId?: number) {
  const g = await cfg("colab_telegram_grupo");
  if (!g) return;
  await enviar(Number(g), "👁 " + texto + (infId ? `\n\n<code>#p${infId}</code>` : ""));
}

type Conectado = { influencer_id: number; nombre: string; admin: string; chat_id: number; links: number };

const conectados = (id?: number) =>
  rpc<Conectado[]>("colab_tg_conectados", { p_id: id ?? null });

const pesos = (n: number) =>
  "$" + Math.round(Number(n) || 0).toLocaleString("es-AR", { maximumFractionDigits: 0 });

const sinTilde = (s: string) =>
  (s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

// Solo letras y n\u00fameros: "Pablo," / "\u00bfPablo?" -> "pablo"
const soloLetras = (s: string) => sinTilde(s).replace(/[^a-z0-9]/g, "");

// El texto que escribe una persona viaja dentro de un mensaje HTML
const esc = (s: string) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

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
  tipo?: string | null; tratamiento?: string | null;
};

type Modelo = {
  modelo: string; colores: Color[]; precio_desde: number;
  descripcion?: string | null; linea?: string | null; tipos?: string[];
};

// Publicación activa del modelo en Mercado Libre (la más barata con stock)
async function enML(modelo: string): Promise<{ permalink: string; n: number } | null> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/mapeo_producto_ml?modelo=eq.${encodeURIComponent(modelo)}` +
      `&estado=eq.active&available_quantity=gt.0&select=permalink,precio_actual&order=precio_actual.asc`,
    { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } },
  );
  const filas = res.ok ? ((await res.json()) as { permalink: string }[]) : [];
  return filas.length ? { permalink: filas[0].permalink, n: filas.length } : null;
}

// ————— copies (misma lógica que el panel, colabUtil.copiesDe, resumida) —————

const tituloM = (s: string) => s.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase());

type TipoCopy = "historia" | "posteo" | "guion";

function copyDe(m: Modelo, c: Color, pctDesc: number, link: string, tipo: TipoCopy): string {
  const plano = (m.descripcion ?? "").replace(/\s+/g, " ");
  const [armazon, lente] = (c.color ?? "").split("/").map((s) => s.trim());
  const esSol = (c.tipo ?? m.tipos?.[0]) === "SOL";
  const intro = plano.split(/Frente:|Medidas:/i)[0].trim().split(/(?<=\.)\s+/).filter((s) => s.length > 20).slice(0, 2).join(" ");
  const dest: string[] = [];
  if (/xylon/i.test(plano)) dest.push("Xylon® súper liviano y flexible");
  else if (/acetato/i.test(plano)) dest.push("Acetato");
  if (lente && /polariz/i.test(lente)) dest.push("lente polarizado (chau reflejos)");
  if (lente && /espej/i.test(lente)) dest.push("lente espejado");
  if (esSol || /uv\s?400/i.test(plano)) dest.push("protección UV400");
  if (/high definition/i.test(plano)) dest.push("cristales High Definition");

  const sinCodigo = pctDesc <= 0;
  const { promo, tachado, off } = textoPrecio(c.price, c.compare_at, pctDesc);
  const frase = sinCodigo
    ? (tachado > c.price ? `de ${pesos(tachado)} a ${pesos(c.price)} en la web` : `a ${pesos(c.price)} en la web`)
    : `de ${pesos(tachado)} a ${pesos(promo)} con mi código${off ? ` (${off}% OFF)` : ""}`;
  const nombre = tituloM(m.modelo);
  const colorTxt = [armazon, lente && `lente ${lente.toLowerCase()}`].filter(Boolean).join(" con ");
  const tag = m.modelo.replace(/[^A-Za-z0-9]/g, "");

  if (tipo === "historia") {
    return [
      `Mis ${nombre} de Orbital 🕶️`,
      colorTxt ? colorTxt.charAt(0).toUpperCase() + colorTxt.slice(1) : null,
      `${frase.charAt(0).toUpperCase() + frase.slice(1)} 👇`,
      link,
    ].filter(Boolean).join("\n");
  }
  if (tipo === "posteo") {
    return [
      `${nombre}${colorTxt ? ` · ${colorTxt}` : ""} ✨`,
      intro || null,
      dest.length ? `✔ ${dest.slice(0, 4).join("\n✔ ")}` : null,
      sinCodigo ? `🎁 Lo tenés ${frase}.` : `🎁 Con mi link lo tenés ${frase.replace(" con mi código", "")}. Es un código único, solo para vos.`,
      link,
      `#OrbitalEyewear #${tag} ${esSol ? "#AnteojosDeSol" : "#AnteojosDeReceta"} #HechoEnArgentina`,
    ].filter(Boolean).join("\n\n");
  }
  return [
    "Guion de 15 segundos (Reel / TikTok)",
    '0–3 s · Mostralo en la mano: "Miren lo que me llegó".',
    `3–8 s · Ponételo y mirá a cámara. Texto en pantalla: "${nombre}${lente ? ` · ${lente}` : ""}".`,
    `8–12 s · Detalle de cerca${dest.length ? `: ${dest.slice(0, 2).join(" + ")}` : ""}.`,
    `12–15 s · Cierre: "${sinCodigo ? `Lo encontrás en la web de Orbital` : `Con mi link lo pagás ${pesos(promo)}${off ? `, ${off}% OFF` : ""}, es un código único`}". Sumá el sticker de enlace.`,
    link,
  ].join("\n");
}

// historia/estado → historia · posteo → posteo · reel/tiktok → guion
const copyPorFormato = (formato: string): TipoCopy =>
  formato === "posteo" ? "posteo" : formato === "reel" || formato === "video" ? "guion" : "historia";

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
  const ml = await enML(m.modelo);
  const cab =
    `<b>${m.modelo}</b>\n` +
    `En la web ${pesos(m.colores[0].price)} · para tu comunidad <b>${pesos(promo)}</b>` +
    (tachado > promo ? ` (${off}% OFF sobre ${pesos(tachado)})` : "") +
    `\n\n<b>Disponible en línea</b>\n` +
    `✅ Tienda Orbital · ${m.colores.length} color${m.colores.length === 1 ? "" : "es"} con stock\n` +
    (ml ? `✅ Mercado Libre · <a href="${ml.permalink}">ver publicación</a>\n` : `— Mercado Libre: no está publicado\n`) +
    `<i>Tu comisión sale de lo que se vende con tu link de la tienda.</i>` +
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

// Resumen para el grupo interno: TODOS los promotores activos, tengan links o no
async function pantallaResumenInterno(chat: number) {
  const clave = await cfg("colab_telegram_grupo_clave");
  if (!clave) {
    await enviar(chat, "Me falta la clave de Orbital. Mandá <code>/panel or-…</code>");
    return;
  }
  const filas = await rpc<
    { influencer_id: number; nombre: string; admin: string; conectado: boolean; links: number; clicks: number; pedidos: number; com: number }[]
  >("colab_resumen_promotores", { p_clave: clave });
  if (!filas?.length) {
    await enviar(chat, "Todavía no hay promotores dados de alta.");
    return;
  }
  let t = "<b>Promotores — cómo vienen</b>\n\n";
  for (const f of filas) {
    t += `<b>${esc(f.nombre)}</b> <i>(${esc(f.admin)})</i>${f.conectado ? " · 📱" : ""}\n`;
    if (!f.links) {
      t += `Todavía no publicó ningún link${f.conectado ? "" : " · no entró al bot"}\n`;
    } else {
      const conv = f.clicks ? ((f.pedidos / f.clicks) * 100).toFixed(1).replace(".", ",") : "0";
      t += `${f.links} link${f.links === 1 ? "" : "s"} · ${f.clicks} visitas · ${f.pedidos} pedidos · ${conv}% · ${pesos(f.com)}\n`;
    }
    if (f.conectado) t += `<code>/decile ${soloLetras(f.nombre.split(" ")[0])} </code>\n`;
    t += "\n";
  }
  t += "📱 = conectado al bot. Para escribirle a uno, copiá su <code>/decile</code> y seguí escribiendo.";
  await enviar(chat, t);
}

// Desde el grupo interno a un promotor puntual. "quien" puede ser el nombre o el número.
async function mandarAPromotor(chat: number, quien: string | number, texto: string) {
  const cs = await conectados();
  let c: Conectado | undefined;

  if (typeof quien === "number" || /^\d+$/.test(String(quien))) {
    c = cs.find((x) => x.influencer_id === Number(quien));
  } else {
    const t = soloLetras(String(quien));
    const candidatos = t
      ? cs.filter((x) => sinTilde(x.nombre).split(/\s+/).some((p) => soloLetras(p).startsWith(t)))
      : [];
    if (candidatos.length > 1) {
      // Hay más de uno con ese nombre de pila: preguntar antes de mandar nada
      await enviar(chat,
        `¿A cuál de los ${candidatos.length}?\n\n` +
        candidatos.map((x) => `<code>/decile ${soloLetras(x.nombre.split(" ").slice(-1)[0])} ${esc(texto)}</code>\n<i>${esc(x.nombre)} (${esc(x.admin)})</i>`).join("\n\n") +
        "\n\nCopiá el que corresponda y mandalo.");
      return;
    }
    c = candidatos[0];
  }

  if (!c) {
    const lista = cs.length ? cs.map((x) => esc(x.nombre.split(" ")[0])).join(", ") : "ninguno todavía";
    await enviar(chat, `No encontré a ese promotor entre los conectados.\nConectados: ${lista}`);
    return;
  }
  await enviar(c.chat_id, `📣 <b>Orbital</b>\n\n${esc(texto)}`);
  await enviar(chat, `Mandado a <b>${esc(c.nombre)}</b>.`);
}

async function crearLink(chat: number, q: Quien, handle: string, red: string, formato: string) {
  try {
    const r = await rpc<{ codigo: string }>("colab_crear_link", {
      p_clave: q.clave, p_handle: handle, p_red: red, p_formato: formato,
    });
    const cat = await catalogo(q.clave);
    const mod = cat.find((m) => m.colores.some((c) => c.handle === handle));
    const col = mod?.colores.find((c) => c.handle === handle);
    const link = `${BASE}/r/${r.codigo}`;
    let t = `<b>Listo, tu link:</b>\n${link}\n\n`;
    if (mod && col) {
      const { promo, tachado, off } = textoPrecio(col.price, col.compare_at, q.pct_descuento);
      t += `<b>${mod.modelo}</b> ${esc(col.color)} · ${red} ${formato}\n`;
      t += `En la web ${pesos(col.price)} → para tu comunidad <b>${pesos(promo)}</b>`;
      if (off) t += ` (${off}% OFF sobre ${pesos(tachado)})`;
      const tipo = copyPorFormato(formato);
      t += `\n\n<b>Texto listo para copiar</b> (${tipo === "guion" ? "guion" : tipo}):\n`;
      t += `<pre>${esc(copyDe(mod, col, q.pct_descuento, link, tipo))}</pre>`;
    }
    const otros = (["historia", "posteo", "guion"] as TipoCopy[]).filter((x) => x !== copyPorFormato(formato));
    await enviar(chat, t, [
      otros.map((x) => ({ text: `Texto para ${x === "guion" ? "reel/TikTok" : x}`, callback_data: `t|${r.codigo}|${x}` })),
      [{ text: "Ver cómo va", callback_data: "v|" + r.codigo }],
    ]);
    await espejo(
      `<b>${esc(q.nombre)}</b> pidió un link${mod && col ? ` de <b>${mod.modelo}</b> ${esc(col.color)}` : ""} para ${red} ${formato}\n` +
      `${BASE}/r/${r.codigo}`, q.influencer_id,
    );
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

// Texto del link ya creado, en otro formato (botón "Texto para …")
async function copyDeLink(chat: number, q: Quien, codigo: string, tipo: TipoCopy) {
  const links = await rpc<{ codigo: string; handle: string }[]>("colab_mis_links", { p_clave: q.clave });
  const l = links?.find((x) => x.codigo === codigo);
  const cat = await catalogo(q.clave);
  const mod = l && cat.find((m) => m.colores.some((c) => c.handle === l.handle));
  const col = mod?.colores.find((c) => c.handle === l!.handle);
  if (!mod || !col) {
    await enviar(chat, "Ese anteojo ya no está disponible en la tienda.");
    return;
  }
  await enviar(chat,
    `<b>Texto para ${tipo === "guion" ? "reel/TikTok" : tipo}</b> · ${mod.modelo}\n` +
    `<pre>${esc(copyDe(mod, col, q.pct_descuento, `${BASE}/r/${codigo}`, tipo))}</pre>`);
}

// ————— consultas al equipo —————
// El promotor escribe → llega al grupo interno con la marca #p → el equipo responde ese mensaje.

const MARCA_CONSULTA = "Escribí tu consulta para el equipo";

async function pedirConsulta(chat: number) {
  await enviar(chat,
    `💬 ${MARCA_CONSULTA} de Orbital y te respondemos por acá.`,
    undefined, { force_reply: true, input_field_placeholder: "Tu consulta…" });
}

async function mandarConsulta(chat: number, q: Quien, texto: string) {
  const g = await cfg("colab_telegram_grupo");
  if (!g) {
    await enviar(chat, "No pude pasar tu consulta ahora. Probá de nuevo en un rato.");
    return;
  }
  await espejo(`💬 <b>Consulta de ${esc(q.nombre)}</b> <i>(${esc(q.admin)})</i>\n\n«${esc(texto)}»\n\nRespondé este mensaje para contestarle.`, q.influencer_id);
  await enviar(chat, "Listo, se la pasé al equipo 🙌 Te respondemos por acá.", undefined, MENU);
}

// ————— dashboard / reportes —————
// Mismos datos que el Dashboard del panel (colab_resumen + colab_liquidacion).
// Sirve para el promotor (su clave) y para el grupo interno (clave de Orbital).

type Resumen = {
  hay_datos: boolean;
  serie: { periodo: string; clicks: number; pedidos: number; pendientes: number; neto: number; com_inf: number; com_adm: number }[];
  top: { modelo: string; links: number; clicks: number; pedidos: number; neto: number }[];
  redes: { red: string; links: number; clicks: number; pedidos: number; neto: number }[];
  posts: { codigo: string; modelo: string; red: string; formato: string; influencer?: string; clicks: number; pedidos: number; neto: number }[];
  origenes?: { canal: string; neto: number; pedidos: number; com_inf: number }[];
};

type Lector = { clave: string; pct: number | null; nombre: string; infId?: number }; // pct null = Orbital

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const mesLargo = (p: string) => `${MESES[+p.slice(5, 7) - 1]} ${p.slice(0, 4)}`;
const mesCorto = (p: string) => `${MESES[+p.slice(5, 7) - 1].slice(0, 3)} ${p.slice(2, 4)}`;
const pct1 = (a: number, b: number) => (b ? ((a / b) * 100).toFixed(1).replace(".", ",") : "0");
const RED: Record<string, string> = { instagram: "Instagram", tiktok: "TikTok", whatsapp: "WhatsApp", youtube: "YouTube", facebook: "Facebook", x: "X", otra: "Otra" };
const CANAL: Record<string, string> = {
  link: "Tus links", meta: "Anuncios de Orbital", redes: "Instagram y redes (sin link)", tienda: "Directo en la tienda",
};
const barra = (v: number, max: number) => "▇".repeat(Math.max(v > 0 ? 1 : 0, Math.round((v / (max || 1)) * 10)));

const BOTONES_DASH: Boton[][] = [
  [{ text: "Del link a la venta", callback_data: "d|mes" }, { text: "De dónde vienen", callback_data: "d|origen" }],
  [{ text: "Venta neta por mes", callback_data: "d|meses" }, { text: "Por red social", callback_data: "d|redes" }],
  [{ text: "Publicaciones que rinden", callback_data: "d|pubs" }, { text: "Conversión por publicación", callback_data: "d|conv" }],
  [{ text: "Anteojos que rinden", callback_data: "d|anteojos" }, { text: "Liquidación", callback_data: "d|liq" }],
];

const SECCION: Record<string, string> = {
  mes: "del link a la venta", origen: "de dónde vienen las ventas", meses: "venta neta por mes", redes: "resultados por red social",
  pubs: "publicaciones que más rinden", conv: "conversión por publicación", anteojos: "anteojos que más rinden", liq: "liquidación",
};

async function pantallaDashMenu(chat: number, quien: Lector) {
  await enviar(chat,
    `📊 <b>${quien.pct == null ? "Reporte de colaboradores" : "Tu dashboard"}</b>\n\n¿Qué querés ver?`, BOTONES_DASH);
}

async function pantallaDash(chat: number, quien: Lector, sec: string) {
  const r = await rpc<Resumen | null>("colab_resumen", { p_clave: quien.clave, p_admin: null });
  const orb = quien.pct == null;
  const com = (neto: number) => Math.round((Number(neto) || 0) * (quien.pct ?? 0) / 100);
  const etCom = orb ? "comisiones" : `tu ${quien.pct}%`;
  const volver: Boton[][] = [[{ text: "← Otro reporte", callback_data: "d|menu" }]];

  if (!r || !r.hay_datos) {
    await enviar(chat,
      orb ? "Todavía no hay toques ni ventas en ningún link." :
        "Todavía no hay toques en tus links. Cuando alguien toque el primero, acá vas a ver todo.\n\nEscribime un modelo y te armo el link.",
      volver);
    return;
  }
  const ult = r.serie[r.serie.length - 1];
  const prev = r.serie[r.serie.length - 2];
  const comMes = (s: typeof ult) => orb ? Number(s.com_inf) + Number(s.com_adm) : Number(s.com_inf);
  let t = "";

  if (sec === "mes") {
    const d = prev && comMes(prev) ? (comMes(ult) / comMes(prev) - 1) * 100 : null;
    t = `<b>Del link a la venta</b> · ${mesLargo(ult.periodo)}\n\n` +
      `👆 Toques al link: <b>${ult.clicks}</b>\n` +
      `   ↓ compró el ${pct1(ult.pedidos, ult.clicks)}%\n` +
      `🛍 Pedidos pagados: <b>${ult.pedidos}</b>\n` +
      (ult.pendientes ? `⏳ ${ult.pendientes} esperando el pago (se suman cuando se acredita)\n` : "") +
      `\nVenta neta (sin IVA): <b>${pesos(ult.neto)}</b>\n` +
      `${orb ? "Comisiones (influencers + admins)" : `Tu ${quien.pct}%`}: <b>${pesos(comMes(ult))}</b>` +
      (d != null ? `\n${d >= 0 ? "▲" : "▼"} ${Math.abs(d).toFixed(0)}% vs ${mesCorto(prev.periodo)}` : "");
  } else if (sec === "origen") {
    const os = r.origenes ?? [];
    const tot = os.reduce((a, o) => a + Number(o.neto || 0), 0);
    t = `<b>De dónde vienen las ventas</b> · ${mesLargo(ult.periodo)}\n\n` + (os.length
      ? os.map((o) => `<b>${CANAL[o.canal] ?? o.canal}</b> — ${pesos(o.neto)} (${pct1(Number(o.neto), tot)}%)\n` +
          `${o.pedidos} pedido${o.pedidos === 1 ? "" : "s"}${orb ? "" : ` · ${etCom}: ${pesos(o.com_inf)}`}`).join("\n\n")
      : "Sin ventas pagadas este mes.");
  } else if (sec === "meses") {
    const max = Math.max(...r.serie.map((s) => Number(s.neto)), 1);
    t = `<b>Venta neta por mes</b>\n\n` + r.serie.map((s) =>
      `<b>${mesCorto(s.periodo)}</b> ${barra(Number(s.neto), max)}\n${pesos(s.neto)} · ${s.pedidos} ped. · ${s.clicks} toques · ${etCom} ${pesos(comMes(s))}`,
    ).join("\n\n");
  } else if (sec === "redes") {
    t = `<b>Resultados por red social</b> · acumulado\n\n` + (r.redes.length
      ? [...r.redes].sort((a, b) => b.neto - a.neto).map((x) =>
          `<b>${RED[x.red] ?? x.red}</b> — ${x.links} link${x.links === 1 ? "" : "s"}\n` +
          `${x.clicks} toques · ${x.pedidos} pedidos · ${pct1(x.pedidos, x.clicks)}% · ${pesos(x.neto)}${orb ? "" : ` · ${etCom} ${pesos(com(x.neto))}`}`).join("\n\n")
      : "Todavía no hay datos por red.");
  } else if (sec === "pubs" || sec === "conv") {
    const ps = [...r.posts].filter((p) => sec === "pubs" || p.clicks > 0);
    ps.sort(sec === "pubs"
      ? (a, b) => b.neto - a.neto || b.clicks - a.clicks
      : (a, b) => b.pedidos / (b.clicks || 1) - a.pedidos / (a.clicks || 1) || b.clicks - a.clicks);
    t = `<b>${sec === "pubs" ? "Publicaciones que más rinden" : "Conversión por publicación"}</b> · acumulado\n\n` + (ps.length
      ? ps.slice(0, 10).map((p, i) =>
          `${i + 1}. <b>${p.modelo}</b> · ${RED[p.red] ?? p.red} ${p.formato}${orb && p.influencer ? ` · <i>${esc(p.influencer)}</i>` : ""}\n` +
          (sec === "conv"
            ? `<b>${pct1(p.pedidos, p.clicks)}%</b> conversión · ${p.pedidos} de ${p.clicks} toques`
            : `${pesos(p.neto)} · ${p.pedidos} pedidos · ${p.clicks} toques${orb ? "" : ` · ${etCom} ${pesos(com(p.neto))}`}`) +
          `\n${BASE}/r/${p.codigo}`).join("\n\n")
      : "Todavía no hay publicaciones con toques.");
  } else if (sec === "anteojos") {
    t = `<b>Anteojos que más rinden</b> · acumulado\n\n` + (r.top.length
      ? r.top.slice(0, 10).map((x, i) =>
          `${i + 1}. <b>${x.modelo}</b> — ${pesos(x.neto)}\n${x.pedidos} pedidos · ${x.clicks} toques · ${pct1(x.pedidos, x.clicks)}% · ${x.links} link${x.links === 1 ? "" : "s"}`).join("\n\n")
      : "Todavía no hay ventas por anteojo.");
  }
  await enviar(chat, t || "No encontré ese reporte.", volver);
}

const periodoDe = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

async function pantallaLiquidacion(chat: number, quien: Lector, periodo?: string) {
  const per = periodo ?? periodoDe(new Date());
  const filas = await rpc<
    { order_name: string; fecha: string; influencer: string; modelo: string; estado: string; neto: number; com_inf: number; com_adm: number | null; red: string | null; canal?: string | null }[]
  >("colab_liquidacion", { p_clave: quien.clave, p_periodo: per, p_admin: null });
  const orb = quien.pct == null;
  const pag = (filas ?? []).filter((f) => f.estado === "pagado");
  const neto = pag.reduce((a, f) => a + Number(f.neto || 0), 0);
  const cInf = pag.reduce((a, f) => a + Number(f.com_inf || 0), 0);
  const cAdm = pag.reduce((a, f) => a + Number(f.com_adm || 0), 0);
  const EST: Record<string, string> = { pagado: "✅ pagado", pendiente: "⏳ pendiente", cancelado: "✖ cancelado", reembolsado: "↩ reembolsado" };

  let t = `<b>Liquidación</b> · ${mesLargo(per)}\n<i>Pedido por pedido. Comisión sobre el neto sin IVA.</i>\n\n` +
    `Venta neta: <b>${pesos(neto)}</b> · ${pag.length} pedido${pag.length === 1 ? "" : "s"} pagado${pag.length === 1 ? "" : "s"}\n` +
    (orb ? `Influencers: <b>${pesos(cInf)}</b> · Admins: <b>${pesos(cAdm)}</b>\n` : `Tu ${quien.pct}%: <b>${pesos(cInf)}</b>\n`);
  if (!filas?.length) t += `\nSin pedidos en ${mesLargo(per)}.`;
  else {
    t += "\n" + filas.slice(0, 20).map((f) =>
      `<b>${esc(f.order_name)}</b> · ${new Date(f.fecha).toLocaleDateString("es-AR")} · ${esc(f.modelo)}\n` +
      `${EST[f.estado] ?? f.estado} · neto ${pesos(f.neto)} · ${orb ? `inf. ${pesos(f.com_inf)} · adm. ${pesos(f.com_adm ?? 0)}` : `tu comisión ${pesos(f.com_inf)}`}` +
      (orb ? ` · <i>${esc(f.influencer)}</i>` : "")).join("\n\n");
    if (filas.length > 20) t += `\n\n… y ${filas.length - 20} más (el detalle completo está en el panel).`;
  }
  const meses = Array.from({ length: 4 }, (_, i) => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - i); return periodoDe(d); });
  await enviar(chat, t, [
    meses.filter((m) => m !== per).map((m) => ({ text: mesCorto(m), callback_data: `q|${m}` })),
    [{ text: "← Otro reporte", callback_data: "d|menu" }],
  ]);
}

// Menú fijo abajo del chat del promotor
const MENU = {
  keyboard: [
    [{ text: "🔗 Pedir un link" }, { text: "⭐ Qué promociono" }],
    [{ text: "📈 Mis links" }, { text: "📊 Mi dashboard" }],
    [{ text: "💬 Consultar al equipo" }],
  ],
  resize_keyboard: true,
  is_persistent: true,
};

const AYUDA =
  "Soy el asistente de promotores de Orbital. Podés:\n\n" +
  "• Escribirme un modelo (por ejemplo <b>PALERMO</b>) y te armo el link con el precio para tu comunidad, el texto listo para copiar y dónde está en línea\n" +
  "• <b>Qué promociono</b> — te digo qué conviene según stock y ventas\n" +
  "• <b>Mis links</b> — visitas, pedidos, conversión y tu comisión por link\n" +
  "• <b>Mi dashboard</b> — del link a la venta, de dónde vienen las ventas, venta por mes, por red, publicaciones y anteojos que más rinden, y tu liquidación pedido por pedido\n" +
  "• <b>Consultar al equipo</b> — le escribís a Orbital y te responden por acá\n\n" +
  "Y te aviso solo cuando cambia un precio, arranca una promo o el equipo te manda un mensaje.";

// ————— webhook —————

async function manejarMensaje(msg: Record<string, any>) {
  const chat = msg.chat?.id as number;
  const from = msg.from?.id as number;
  const texto = String(msg.text ?? "").trim();
  if (!chat || !from) return;

  // En un grupo el bot no atiende promotores: es el panel interno de Orbital
  const tipoChat = String(msg.chat?.type ?? "private");
  if (tipoChat === "group" || tipoChat === "supergroup") {
    const or = texto.match(/\bor-[a-z0-9]{6,}\b/i)?.[0];
    if (or) {
      const ok = await rpc<boolean>("colab_orbital_ok", { p_clave: or });
      if (!ok) {
        await enviar(chat, "Esa no es la clave de Orbital.");
        return;
      }
      await guardarCfg("colab_telegram_grupo", String(chat));
      await guardarCfg("colab_telegram_grupo_clave", or);
      await enviar(chat,
        "Listo 👁 Este grupo queda como panel interno.\n\n" +
        "Acá les voy a ir contando todo lo que hace cada promotor: cuando se vincula, " +
        "cuando pide un link, cuando mira qué promocionar y cuando consulta sus números.\n\n" +
        "Escriban <b>/resumen</b> cuando quieran ver cómo vienen todos.");
      return;
    }
    if (texto.startsWith("/resumen")) {
      await pantallaResumenInterno(chat);
      return;
    }

    // Reportes de todo el programa: mismo dashboard que el promotor, con la clave de Orbital
    if (texto.startsWith("/reporte") || texto.startsWith("/dashboard")) {
      const clave = await cfg("colab_telegram_grupo_clave");
      if (!clave) {
        await enviar(chat, "Me falta la clave de Orbital. Mandá <code>/panel or-…</code>");
        return;
      }
      await pantallaDashMenu(chat, { clave, pct: null, nombre: "Orbital" });
      return;
    }

    // Lista de promotores conectados, con su nombre para escribirles
    if (texto.startsWith("/promotores")) {
      const cs = await conectados();
      if (!cs.length) {
        await enviar(chat, "Todavía no se conectó ningún promotor al bot.");
        return;
      }
      let t = "<b>Promotores conectados</b>\n\n";
      for (const c of cs) {
        t += `<b>${esc(c.nombre)}</b> <i>(${esc(c.admin)})</i> · ${c.links} link${c.links === 1 ? "" : "s"}\n`;
        t += `Para escribirle: <code>/decile ${soloLetras(c.nombre.split(" ")[0])} tu mensaje</code>\n\n`;
      }
      t += "También podés responder cualquier mensaje 👁 de un promotor y le llega directo.";
      await enviar(chat, t);
      return;
    }

    // /decile <id> <texto> — a uno solo
    const uno = texto.match(/^\/decile\s+(\S+)\s+([\s\S]+)$/i);
    if (uno) {
      await mandarAPromotor(chat, uno[1], uno[2].trim());
      return;
    }

    // /aviso <texto> — a todos los conectados
    const todos = texto.match(/^\/aviso\s+([\s\S]+)$/i);
    if (todos) {
      const cs = await conectados();
      if (!cs.length) {
        await enviar(chat, "No hay promotores conectados al bot todavía.");
        return;
      }
      for (const c of cs) await enviar(c.chat_id, `📣 <b>Orbital</b>\n\n${esc(todos[1].trim())}`);
      await enviar(chat, `Mandado a ${cs.length} promotor${cs.length === 1 ? "" : "es"}: ${esc(cs.map((c) => c.nombre).join(", "))}`);
      return;
    }

    // Responder el mensaje 👁 de un promotor = escribirle a ese promotor
    const citado = String(msg.reply_to_message?.text ?? "");
    const marca = citado.match(/#p(\d+)/);
    if (marca && texto && !texto.startsWith("/")) {
      await mandarAPromotor(chat, Number(marca[1]), texto);
      return;
    }

    if (texto.startsWith("/")) {
      await enviar(chat,
        "<b>Panel interno</b>\n\n" +
        "/resumen — cómo vienen todos los promotores\n" +
        "/reporte — dashboard de todo el programa (ventas, redes, publicaciones, anteojos, liquidación)\n" +
        "/promotores — quiénes están conectados\n" +
        "/aviso &lt;texto&gt; — mandarle un mensaje a todos\n" +
        "/decile &lt;nombre&gt; &lt;texto&gt; — mandarle un mensaje a uno\n\n" +
        "Y respondiendo cualquier mensaje 👁 le contestás a ese promotor.");
    }
    return; // en grupo no contesta nada más
  }

  const q = await rpc<Quien | null>("colab_tg_quien", { p_tg: from });

  const nombreTg = [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(" ") || null;

  // alta con un toque: comparte su teléfono y lo busco en los promotores
  const tel = msg.contact?.user_id === from ? String(msg.contact?.phone_number ?? "") : "";
  if (!q && tel) {
    const r = await rpc<{ ok: boolean; error?: string; nombre?: string; influencer_id?: number }>("colab_tg_vincular_tel", {
      p_tg: from, p_chat: chat, p_tel: tel, p_nombre: nombreTg, p_username: msg.from?.username ?? null,
    });
    if (!r?.ok) {
      await enviar(chat, r?.error === "inactivo"
        ? "Tu acceso está dado de baja. Hablá con tu administrador."
        : r?.error === "repetido"
          ? "Ese teléfono figura en más de un promotor. Avisale a tu administrador."
          : "Ese teléfono no me figura como promotor. Pedile a tu administrador que lo cargue, " +
            "o mandame tu clave de acceso (empieza con <code>in-</code>).");
      return;
    }
    await enviar(chat, `¡Hola ${esc(r.nombre ?? "")}! Quedaste vinculado 🎉\n\n${AYUDA}`, undefined, MENU);
    await espejo(`<b>${esc(r.nombre ?? "")}</b> se vinculó al bot con su teléfono`, r.influencer_id);
    return;
  }

  // alta alternativa: manda su clave in-…
  const clave = texto.match(/\bin-[a-z0-9]{6,}\b/i)?.[0];
  if (!q && clave) {
    const r = await rpc<{ ok: boolean; error?: string; nombre?: string; influencer_id?: number }>("colab_tg_vincular", {
      p_tg: from, p_chat: chat, p_clave: clave,
      p_nombre: nombreTg,
      p_username: msg.from?.username ?? null,
    });
    if (!r?.ok) {
      await enviar(chat, r?.error === "inactivo"
        ? "Esa clave está dada de baja. Hablá con tu administrador."
        : "Esa clave no me figura. Fijate que sea la que te pasaron, empieza con <code>in-</code>.");
      return;
    }
    await enviar(chat, `¡Hola ${esc(r.nombre ?? "")}! Quedaste vinculado 🎉\n\n${AYUDA}`, undefined, MENU);
    await espejo(`<b>${esc(r.nombre ?? "")}</b> se vinculó al bot`, r.influencer_id);
    return;
  }

  if (!q) {
    await enviar(chat,
      "Hola 👋 Soy el asistente de promotores de Orbital.\n\n" +
      "Tocá el botón de acá abajo y entrás con tu teléfono, sin claves ni contraseñas.",
      undefined, PEDIR_TEL);
    return;
  }

  const t = sinTilde(texto);
  const lector: Lector = { clave: q.clave, pct: Number(q.pct_comision), nombre: q.nombre, infId: q.influencer_id };

  // Respuesta a "escribí tu consulta" o a un 📣 del equipo → va al equipo como consulta
  const citado = msg.reply_to_message;
  const citaTexto = String(citado?.text ?? "");
  if (texto && !texto.startsWith("/") && citado?.from?.is_bot &&
      (citaTexto.includes(MARCA_CONSULTA) || citaTexto.startsWith("📣"))) {
    await mandarConsulta(chat, q, texto);
    return;
  }

  if (texto.startsWith("/start") || t === "ayuda" || texto.startsWith("/ayuda")) {
    await enviar(chat, `Hola ${esc(q.nombre)} 👋\n\n${AYUDA}`, undefined, MENU);
    return;
  }
  if (t.includes("consultar") || t.includes("consulta al equipo") || t.startsWith("equipo") || texto.startsWith("/consulta")) {
    // "consulta: tengo una duda…" en un solo mensaje también vale
    const directo = texto.match(/^\/?consulta[r]?\s*(?:al equipo)?\s*[:,-]\s*([\s\S]{3,})$/i);
    if (directo) await mandarConsulta(chat, q, directo[1].trim());
    else await pedirConsulta(chat);
    return;
  }
  if (t.includes("pedir un link") || texto.startsWith("/link")) {
    await enviar(chat, "Escribime el nombre del modelo (por ejemplo <b>PALERMO</b>) y te armo el link.\n\n¿No sabés cuál? Tocá <b>⭐ Qué promociono</b>.", undefined, MENU);
    return;
  }
  if (t.includes("que promociono") || t.includes("recomend") || texto.startsWith("/recomendar")) {
    await pantallaRecomendar(chat, q);
    await espejo(`<b>${esc(q.nombre)}</b> pidió recomendaciones`, q.influencer_id);
    return;
  }
  if (t.includes("liquidacion") || t.includes("cuanto cobro") || t.includes("cuanto gane") || texto.startsWith("/liquidacion")) {
    await pantallaLiquidacion(chat, lector);
    await espejo(`<b>${esc(q.nombre)}</b> miró su liquidación`, q.influencer_id);
    return;
  }
  if (t.includes("dashboard") || t.includes("reporte") || t.includes("estadistica") || texto.startsWith("/dashboard")) {
    await pantallaDashMenu(chat, lector);
    return;
  }
  if (t.includes("mis links") || t.includes("como va") || t.includes("como viene") || t.includes("numeros") || texto.startsWith("/comova")) {
    await pantallaComoVa(chat, q);
    await espejo(`<b>${esc(q.nombre)}</b> miró cómo van sus links`, q.influencer_id);
    return;
  }

  // ¿nombró un modelo?
  const cat = await catalogo(q.clave);
  const m = buscarModelo(cat, texto);
  if (m) {
    await pantallaModelo(chat, q, m);
    await espejo(`<b>${esc(q.nombre)}</b> está mirando <b>${m.modelo}</b>`, q.influencer_id);
    return;
  }

  await espejo(`<b>${esc(q.nombre)}</b> escribió algo que el bot no entendió: «${esc(texto)}»\n\nRespondé este mensaje para contestarle.`, q.influencer_id);
  await enviar(chat, "No te entendí 🤔\n\n" + AYUDA, [
    [{ text: "¿Qué promociono?", callback_data: "r|" }, { text: "¿Cómo van mis links?", callback_data: "k|" }],
    [{ text: "📊 Mi dashboard", callback_data: "d|menu" }, { text: "💬 Preguntarle al equipo", callback_data: "p|" }],
  ]);
}

async function manejarCallback(cb: Record<string, any>) {
  const chat = cb.message?.chat?.id as number;
  const from = cb.from?.id as number;
  const data = String(cb.data ?? "");
  await responderCallback(cb.id);
  if (!chat || !from) return;

  const [op, ...resto] = data.split("|");

  // Botones de reportes en el grupo interno: leen con la clave de Orbital
  const tipoChat = String(cb.message?.chat?.type ?? "private");
  if (tipoChat === "group" || tipoChat === "supergroup") {
    const clave = await cfg("colab_telegram_grupo_clave");
    if (!clave || String(chat) !== (await cfg("colab_telegram_grupo"))) return;
    const orb: Lector = { clave, pct: null, nombre: "Orbital" };
    if (op === "d") {
      if (resto[0] === "menu") await pantallaDashMenu(chat, orb);
      else if (resto[0] === "liq") await pantallaLiquidacion(chat, orb);
      else await pantallaDash(chat, orb, resto[0]);
    } else if (op === "q") await pantallaLiquidacion(chat, orb, resto[0]);
    return;
  }

  const q = await rpc<Quien | null>("colab_tg_quien", { p_tg: from });
  if (!q) {
    await enviar(chat, "Tocá el botón para entrar con tu teléfono.", undefined, PEDIR_TEL);
    return;
  }
  const lector: Lector = { clave: q.clave, pct: Number(q.pct_comision), nombre: q.nombre, infId: q.influencer_id };

  if (op === "r") return void (await pantallaRecomendar(chat, q));
  if (op === "k" || op === "v") return void (await pantallaComoVa(chat, q));
  if (op === "p") return void (await pedirConsulta(chat));
  if (op === "t") return void (await copyDeLink(chat, q, resto[0], resto[1] as TipoCopy));

  if (op === "d") {
    const sec = resto[0];
    if (sec === "menu") return void (await pantallaDashMenu(chat, lector));
    if (sec === "liq") await pantallaLiquidacion(chat, lector);
    else await pantallaDash(chat, lector, sec);
    await espejo(`<b>${esc(q.nombre)}</b> miró su dashboard: ${SECCION[sec] ?? sec}`, q.influencer_id);
    return;
  }
  if (op === "q") return void (await pantallaLiquidacion(chat, lector, resto[0]));

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
        `🎯 <b>${esc(p.accion)}</b>\n\n` +
        (p.mensaje ? `${esc(p.mensaje)}\n\n` : "") +
        (p.modelos?.length ? `Modelos de la acción: ${esc(p.modelos.join(", "))}\n\n` : "") +
        `Escribime el modelo y te armo el link.`;
    }
    if (!texto) continue;
    await enviar(p.chat_id, texto);
    await rpc("colab_tg_aviso_ok", { p_inf: p.influencer_id, p_tipo: p.tipo, p_ref: p.ref });
    await espejo(`Aviso mandado a <b>${esc(p.nombre)}</b>: ${p.tipo === "promo" ? `cambio de precio de ${p.modelo}` : esc(p.accion)}`, p.influencer_id);
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
