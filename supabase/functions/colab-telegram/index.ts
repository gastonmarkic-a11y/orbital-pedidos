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
  const cuerpo = await res.text(); // las funciones void responden vacío
  return (cuerpo ? JSON.parse(cuerpo) : null) as T;
}

type Boton = { text: string; callback_data?: string; url?: string };

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
  pct_comision_resto?: number | null; pct_resto_desde?: string | null;   // colección: % de lo que trae Orbital y desde cuándo
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
    // Ficha del anteojo (la misma del reconocimiento por cámara): fotos, colores, ópticas cerca.
    // "Comprar" pasa por el link de arriba. Solo si el modelo tiene stock (si no, diría "no lo encontré").
    if (mod && col && await rpc("modelo_landing", { p_modelo: mod.modelo, p_sku: col.sku }).catch(() => null)) {
      t += `📷 <b>Ficha del anteojo</b> (fotos, colores y ópticas cerca):\n` +
        `${BASE}/modelo/${encodeURIComponent(mod.modelo)}?sku=${encodeURIComponent(col.sku)}&r=${r.codigo}\n\n`;
    }
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

// pct null = Orbital; rol 'admin' = administradora (sus promotores, su comisión es com_adm)
// pctResto/restoDesde: colección con comisión doble (pct lo que trae el promotor, pctResto anuncios y directo)
type Lector = { clave: string; pct: number | null; nombre: string; infId?: number; rol?: "admin"; pctResto?: number | null; restoDesde?: string | null };

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
    `📊 <b>${quien.pct == null ? "Reporte de colaboradores" : quien.rol === "admin" ? "Resultados de tus promotores" : "Tu dashboard"}</b>\n\n¿Qué querés ver?`, BOTONES_DASH);
}

async function pantallaDash(chat: number, quien: Lector, sec: string) {
  const r = await rpc<Resumen | null>("colab_resumen", { p_clave: quien.clave, p_admin: null });
  const orb = quien.pct == null;
  const adm = quien.rol === "admin";
  const com = (neto: number) => Math.round((Number(neto) || 0) * (quien.pct ?? 0) / 100);
  const doble = !orb && !adm && quien.pctResto != null && !!quien.restoDesde;
  const etCom = orb ? "comisiones" : doble ? "tu comisión" : `tu ${quien.pct}%`;
  // % de cada origen (comisión doble): links y redes sin anuncio al pct; anuncios y directo al pctResto
  const pctCanal = (canal: string, periodo: string) =>
    doble && periodo >= quien.restoDesde!.slice(0, 7) && canal !== "link" && canal !== "redes" ? quien.pctResto! : quien.pct;
  const volver: Boton[][] = [[{ text: "← Otro reporte", callback_data: "d|menu" }]];

  if (!r || !r.hay_datos) {
    await enviar(chat,
      orb ? "Todavía no hay toques ni ventas en ningún link." :
      adm ? "Todavía no hay toques en los links de tus promotores. Cuando publiquen, acá vas a ver todo." :
        "Todavía no hay toques en tus links. Cuando alguien toque el primero, acá vas a ver todo.\n\nEscribime un modelo y te armo el link.",
      volver);
    return;
  }
  const ult = r.serie[r.serie.length - 1];
  const prev = r.serie[r.serie.length - 2];
  const comMes = (s: typeof ult) => orb ? Number(s.com_inf) + Number(s.com_adm) : adm ? Number(s.com_adm) : Number(s.com_inf);
  let t = "";

  if (sec === "mes") {
    const d = prev && comMes(prev) ? (comMes(ult) / comMes(prev) - 1) * 100 : null;
    t = `<b>Del link a la venta</b> · ${mesLargo(ult.periodo)}\n\n` +
      `👆 Toques al link: <b>${ult.clicks}</b>\n` +
      `   ↓ compró el ${pct1(ult.pedidos, ult.clicks)}%\n` +
      `🛍 Pedidos pagados: <b>${ult.pedidos}</b>\n` +
      (ult.pendientes ? `⏳ ${ult.pendientes} esperando el pago (se suman cuando se acredita)\n` : "") +
      `\nVenta neta (sin IVA): <b>${pesos(ult.neto)}</b>\n` +
      `${orb ? "Comisiones (influencers + admins)" : doble ? "Tu comisión" : `Tu ${quien.pct}%`}: <b>${pesos(comMes(ult))}</b>` +
      (doble ? `\n<i>${quien.pct}% lo que traés vos (tus links, Instagram sin anuncio) · ${quien.pctResto}% anuncios de Orbital y directo</i>` : "") +
      (d != null ? `\n${d >= 0 ? "▲" : "▼"} ${Math.abs(d).toFixed(0)}% vs ${mesCorto(prev.periodo)}` : "");
  } else if (sec === "origen") {
    const os = r.origenes ?? [];
    const tot = os.reduce((a, o) => a + Number(o.neto || 0), 0);
    t = `<b>De dónde vienen las ventas</b> · ${mesLargo(ult.periodo)}\n\n` + (os.length
      ? os.map((o) => `<b>${CANAL[o.canal] ?? o.canal}</b> — ${pesos(o.neto)} (${pct1(Number(o.neto), tot)}%)\n` +
          `${o.pedidos} pedido${o.pedidos === 1 ? "" : "s"}${orb || adm ? "" : ` · tu ${pctCanal(o.canal, ult.periodo)}%: ${pesos(o.com_inf)}`}`).join("\n\n")
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
          `${i + 1}. <b>${p.modelo}</b> · ${RED[p.red] ?? p.red} ${p.formato}${(orb || adm) && p.influencer ? ` · <i>${esc(p.influencer)}</i>` : ""}\n` +
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
    { order_name: string; fecha: string; influencer: string; modelo: string; estado: string; neto: number; com_inf: number; com_adm: number | null; red: string | null; canal?: string | null; pct?: number | null }[]
  >("colab_liquidacion", { p_clave: quien.clave, p_periodo: per, p_admin: null });
  const orb = quien.pct == null;
  const adm = quien.rol === "admin";
  const pag = (filas ?? []).filter((f) => f.estado === "pagado");
  const neto = pag.reduce((a, f) => a + Number(f.neto || 0), 0);
  const cInf = pag.reduce((a, f) => a + Number(f.com_inf || 0), 0);
  const cAdm = pag.reduce((a, f) => a + Number(f.com_adm || 0), 0);
  const EST: Record<string, string> = { pagado: "✅ pagado", pendiente: "⏳ pendiente", cancelado: "✖ cancelado", reembolsado: "↩ reembolsado" };

  let t = `<b>Liquidación</b> · ${mesLargo(per)}\n<i>Pedido por pedido. Comisión sobre el neto sin IVA.</i>\n\n` +
    `Venta neta: <b>${pesos(neto)}</b> · ${pag.length} pedido${pag.length === 1 ? "" : "s"} pagado${pag.length === 1 ? "" : "s"}\n` +
    (orb ? `Influencers: <b>${pesos(cInf)}</b> · Admins: <b>${pesos(cAdm)}</b>\n`
      : adm ? `Tu ${quien.pct}%: <b>${pesos(cAdm)}</b> · Tus promotores: <b>${pesos(cInf)}</b>\n`
      : `Tu ${quien.pctResto != null ? "comisión" : `${quien.pct}%`}: <b>${pesos(cInf)}</b>\n`);
  if (!filas?.length) t += `\nSin pedidos en ${mesLargo(per)}.`;
  else {
    t += "\n" + filas.slice(0, 20).map((f) =>
      `<b>${esc(f.order_name)}</b> · ${new Date(f.fecha).toLocaleDateString("es-AR")} · ${esc(f.modelo)}\n` +
      `${EST[f.estado] ?? f.estado} · neto ${pesos(f.neto)} · ${orb ? `inf. ${pesos(f.com_inf)} · adm. ${pesos(f.com_adm ?? 0)}`
        : adm ? `tu comisión ${pesos(f.com_adm ?? 0)} · promotor ${pesos(f.com_inf)}` : `tu ${f.pct ?? quien.pct}% ${pesos(f.com_inf)}`}` +
      (orb || adm ? ` · <i>${esc(f.influencer)}</i>` : "")).join("\n\n");
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
  "• <b>Consultar al equipo</b> — le escribís a Orbital y te responden por acá\n" +
  "• 📷 <b>Mandame una foto</b> de un anteojo y te digo cuál es, con su link\n\n" +
  "Y te aviso solo cuando cambia un precio, arranca una promo o el equipo te manda un mensaje.";

// ————— foto → modelo —————
// El promotor manda la foto de un anteojo: Claude la compara contra TODO el catálogo (fotos de producto_imagenes,
// tandas de 34) y, si es de su tienda, sigue el flujo de siempre (colores disponibles → link + ficha); si no, la ficha.

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";

async function bajarFotoTelegram(fileId: string): Promise<string | null> {
  const r = await fetch(`https://api.telegram.org/bot${await token()}/getFile?file_id=${encodeURIComponent(fileId)}`);
  const path = (await r.json())?.result?.file_path;
  if (!path) return null;
  const img = await fetch(`https://api.telegram.org/file/bot${await token()}/${path}`);
  if (!img.ok) return null;
  const bytes = new Uint8Array(await img.arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

// Miniaturas de referencia (320×320 JPG, hasta 2 por modelo) precalculadas con scripts/ar-miniaturas.mjs
// en el storage público: van adjuntas en base64 (traerlas por URL choca con el límite de Anthropic).
const AR_REF = `${SUPABASE_URL}/storage/v1/object/public/catalogo/ar-ref`;

type Ref = { modelo: string; imgs: string[] };

function aBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

async function referencias(): Promise<Ref[]> {
  const idx = (await (await fetch(`${AR_REF}/index.json`)).json()) as Record<string, string[]>;
  const refs = await Promise.all(Object.entries(idx).map(async ([modelo, archivos]) => {
    const imgs = (await Promise.all(archivos.map(async (a) => {
      const r = await fetch(`${AR_REF}/${a}`);
      return r.ok ? aBase64(new Uint8Array(await r.arrayBuffer())) : null;
    }))).filter((x): x is string => !!x);
    return { modelo, imgs };
  }));
  return refs.filter((r) => r.imgs.length);
}

// Una llamada a Claude con la FOTO y las referencias numeradas.
//  final=false → los hasta 3 modelos más parecidos (filtro amplio, para no perder el bueno)
//  final=true  → cuál es, o ninguno
async function compararTanda(b64: string, mime: string, refs: Ref[], final: boolean): Promise<string[]> {
  const content: unknown[] = [
    { type: "text", text: "FOTO (sacada por una persona con el celular, puede estar en ángulo, con reflejos o con otras cosas alrededor):" },
    { type: "image", source: { type: "base64", media_type: mime, data: b64 } },
  ];
  refs.forEach((r, i) => {
    content.push({ type: "text", text: `Referencia ${i + 1}:` });
    for (const d of r.imgs) content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: d } });
  });
  const criterio =
    "Importa el MODELO de armazón, no el color: ignorá el color del armazón y de las lentes (las referencias pueden estar en otro color o con otras lentes). " +
    "Compará la silueta del frente, la forma de las lentes, el puente, el grosor del acetato, la barra superior y las patillas. ";
  content.push({ type: "text", text: final
    ? criterio + `¿Cuál de las ${refs.length} referencias es el mismo modelo que el anteojo de la FOTO? Elegí la que coincida en forma; ` +
      'si ninguna tiene la misma forma, o en la FOTO no hay un anteojo, lista vacía. Si dudás, agregá hasta 2 más parecidas después de la elegida. Respondé SOLO con JSON: {"referencias": [números]}'
    : criterio + `De las ${refs.length} referencias, ¿cuáles son las más parecidas en forma al anteojo de la FOTO? ` +
      'Dá hasta 3 números, de la más parecida a la menos; si en la FOTO no hay un anteojo, lista vacía. Respondé SOLO con JSON: {"referencias": [números]}' });
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: "claude-sonnet-5", max_tokens: 2000, messages: [{ role: "user", content }] }),
  });
  const data = await res.json();
  if (data?.error) throw new Error("anthropic " + JSON.stringify(data.error));
  const txt = data?.content?.find((c: { type: string }) => c.type === "text")?.text ?? "";
  console.log("reconocerFoto claude", final ? "final" : "tanda", data?.stop_reason, JSON.stringify(txt).slice(0, 300));
  const nums = (txt.match(/"referencias"\s*:\s*\[([^\]]*)\]/)?.[1] ?? "").split(",").map((x: string) => Number(x.trim()));
  return nums.filter((n) => Number.isInteger(n) && n >= 1 && n <= refs.length).slice(0, 3).map((n) => refs[n - 1].modelo);
}

// Busca en TODO el catálogo: tandas de 34 modelos (1 foto c/u) en paralelo, cada una propone sus 3
// más parecidos, y la final decide entre esos finalistas con las 2 fotos de cada uno.
async function modeloDeFoto(b64: string, mime: string): Promise<string[]> {
  if (!ANTHROPIC_API_KEY) return [];
  const todos = await referencias();
  if (!todos.length) return [];
  const tandas: Ref[][] = [];
  for (let i = 0; i < todos.length; i += 34) tandas.push(todos.slice(i, i + 34).map((r) => ({ modelo: r.modelo, imgs: r.imgs.slice(0, 1) })));
  const finalistas = [...new Set((await Promise.all(tandas.map((t) => compararTanda(b64, mime, t, false)))).flat())];
  console.log("reconocerFoto finalistas", JSON.stringify(finalistas));
  if (!finalistas.length) return [];
  return await compararTanda(b64, mime, todos.filter((r) => finalistas.includes(r.modelo)), true);
}

async function reconocerFoto(chat: number, q: Quien, fileId: string, mime: string) {
  await fetch(`https://api.telegram.org/bot${await token()}/sendChatAction`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chat, action: "typing" }),
  });
  let candidatos: string[] = [];
  try {
    const b64 = await bajarFotoTelegram(fileId);
    if (!b64) throw new Error("no bajó la foto");
    candidatos = await modeloDeFoto(b64, mime);
  } catch (e) {
    console.error("reconocerFoto", String(e));
    await enviar(chat, "No pude mirar la foto ahora 😕 Probá de nuevo en un rato o escribime el nombre del modelo.");
    return;
  }
  if (!candidatos.length) {
    await enviar(chat,
      "No lo encontré en el catálogo 🤔\n\n" +
      "Probá con otra foto: el anteojo de frente, con buena luz y ocupando casi toda la foto. " +
      "O escribime el nombre del modelo.");
    await espejo(`<b>${esc(q.nombre)}</b> mandó una foto y no encontré el anteojo`, q.influencer_id);
    return;
  }
  const [modeloStock, ...otros] = candidatos;
  await mostrarModeloDeFoto(chat, q, modeloStock);
  // Modelos parecidos se confunden (BUENOS AIRES I / ATLANTIC CITY): los otros candidatos a un toque
  if (otros.length) {
    await enviar(chat, "¿No era ese? Tocá el correcto:",
      [otros.map((o) => ({ text: o, callback_data: `f|${o}`.slice(0, 64) }))]);
  }
  await espejo(`<b>${esc(q.nombre)}</b> mandó una foto: era <b>${esc(modeloStock)}</b>` +
    (otros.length ? ` (también parecido: ${esc(otros.join(", "))})` : ""), q.influencer_id);
}

// Modelo de stock reconocido → si está en SU tienda, colores disponibles → link + ficha; si no, la ficha.
async function mostrarModeloDeFoto(chat: number, q: Quien, modeloStock: string) {
  // El nombre de stock y el de la tienda pueden diferir: CASA BLANCA / CASABLANCA
  const cat = await catalogo(q.clave);
  const mapa = await rpc<{ modelo_stock: string; modelo: string }[]>("colab_modelos_stock", { p_clave: q.clave });
  const nombreTienda = mapa?.find((x) => x.modelo_stock === modeloStock)?.modelo ??
    buscarModelo(cat, modeloStock)?.modelo ?? null;
  const m = nombreTienda ? cat.find((x) => x.modelo === nombreTienda) ?? null : null;

  if (m) {
    await enviar(chat, `📷 Es el <b>${m.modelo}</b>`);
    await pantallaModelo(chat, q, m);
    return;
  }
  await enviar(chat,
    `📷 Es el <b>${esc(modeloStock)}</b>\n\n` +
    "Ese modelo no está en tu tienda online, así que no te puedo armar un link con comisión. " +
    `Acá tenés su ficha con los colores disponibles:\n${BASE}/modelo/${encodeURIComponent(modeloStock)}`);
}

// ————— modo administrador —————
// Mery, Yamila, Ariel y Gastón entran con su teléfono y hacen desde el celu lo del panel:
// la lista de Instagram (próximo, tomar, marcar), alta de promotores, sus promotores y resultados.
// Todo lo que hacen se espeja al grupo interno con la marca #a<id> (responder = contestarle).

type Admin = {
  admin_id: number; nombre: string; clave: string; pct: number; chat_id: number;
  ve_ig: boolean; modo: "admin" | "promotor"; estado: Record<string, any>; telefono: string | null;
};
type IgFila = { usuario: string; nombre: string | null; seguidores: number; categoria: string | null; bio: string | null;
  ultimo_dm: string | null; estado: string; escrito_por: string | null; escrito_en: string | null };

const MENU_ADMIN = {
  keyboard: [
    [{ text: "📸 Próximo influencer" }, { text: "📋 Mis contactos" }],
    [{ text: "➕ Alta de promotor" }, { text: "👥 Mis promotores" }],
    [{ text: "📊 Resultados" }, { text: "💬 Consultar a Gastón" }],
  ],
  resize_keyboard: true,
  is_persistent: true,
};

const AYUDA_ADMIN =
  "Estás en <b>modo administrador</b>. Desde acá hacés lo mismo que en tu panel:\n\n" +
  "• <b>📸 Próximo influencer</b> — te doy el próximo de la lista de Instagram con el mensaje listo; lo tomás y te abro su chat\n" +
  "• <b>📋 Mis contactos</b> — los que escribiste: marcás Respondió, Se sumó o Descartado\n" +
  "• <b>➕ Alta de promotor</b> — lo cargo con vos paso a paso y te doy su panel para mandarle\n" +
  "• <b>👥 Mis promotores</b> — cada uno con sus links, toques, ventas y si ya usa el bot\n" +
  "• <b>📊 Resultados</b> — ventas, redes, publicaciones y tu liquidación\n" +
  "• <b>💬 Consultar a Gastón</b> — te responde por acá\n\n" +
  "También podés escribirme un <b>@usuario</b> de Instagram y te digo si ya lo contactó alguien.";

const IG_ESTADO: Record<string, string> = {
  pendiente: "Sin escribir", escrito: "✉️ Escrito", respondio: "💬 Respondió", alta: "✅ Se sumó", descartado: "✖ Descartado",
};

// Tramos de seguidores: mismos mensajes que la lista del panel (ColabInfluencers.tsx → TRAMOS)
const TRAMOS_IG: { min: number; max: number | null; t: string; msj: (yo: string) => string }[] = [
  { min: 5000, max: 10000, t: "5k–10k", msj: (yo) =>
    `Hola {nombre}! Soy ${yo}, de Orbital Eyewear 👋 Nos encanta cómo te conecta tu comunidad.\n` +
    "Queremos invitarte a nuestro plan Orbital Creator Hub:\n" +
    "🕶️ Elegís los modelos que van con vos, con la Triple Protección (UV, luz azul e infrarrojo), única en Argentina\n" +
    '🔗 Tu propia página "Elegidos por {nombre}" con un descuento exclusivo para tus seguidores\n' +
    "📊 Tu panel de resultados: ves cuántos entran, cuántos compran y cómo rinde cada publicación. Tenés el control de todo\n" +
    "💡 Ideas y formatos para tus historias y posteos\n" +
    "¿Te cuento cómo sería?" },
  { min: 10000, max: 50000, t: "10k–50k", msj: (yo) =>
    `Hola {nombre}! Soy ${yo}, de Orbital Eyewear 👋 Venimos siguiendo tu contenido y tu estilo va perfecto con la marca.\n` +
    "Queremos invitarte a nuestro plan Orbital Creator Hub:\n" +
    "🕶️ Elegís los modelos que van con vos, con la Triple Protección (UV, luz azul e infrarrojo), única en Argentina\n" +
    '🔗 Tu página "Elegidos por {nombre}" con un descuento que tu comunidad solo consigue con vos\n' +
    "📊 Tu panel de resultados: seguís cada publicación, cuántos entran y cuántos compran. Todo bajo tu control\n" +
    "Son pocos lugares. ¿Te cuento cómo sería?" },
  { min: 50000, max: 200000, t: "50k–200k", msj: (yo) =>
    `Hola {nombre}! Soy ${yo}, de Orbital Eyewear 👋\n` +
    "Queremos invitarte a nuestro plan Orbital Creator Hub, con pocos creadores seleccionados:\n" +
    "🕶️ Una selección de modelos elegida con vos, con la Triple Protección, única en Argentina\n" +
    '🔗 Tu página propia "Elegidos por {nombre}" con un beneficio exclusivo para tu comunidad\n' +
    "📊 Tu panel de resultados para ver en todo momento el alcance y las ventas de cada publicación\n" +
    "🤝 Una propuesta armada a tu medida\n" +
    "¿Coordinamos una charla para contarte todo?" },
  { min: 200000, max: 1000000, t: "200k–1M", msj: (yo) =>
    `Hola {nombre}! Soy ${yo}, de Orbital Eyewear 👋\n` +
    'Queremos invitarte a nuestro plan Orbital Creator Hub, con muy pocos creadores esta temporada: una selección de modelos pensada con vos, con la Triple Protección (única en Argentina), y una página propia "Elegidos por {nombre}" con un beneficio exclusivo para tu comunidad.\n' +
    "Además tenés tu panel de resultados: ves en todo momento cuántos entran y cuántos compran por cada publicación. El control lo tenés vos 📊\n" +
    "¿Coordinamos una charla corta o me pasás el contacto de quien maneja tus marcas?" },
  { min: 1000000, max: null, t: "+1M", msj: (yo) =>
    `Hola {nombre}! Soy ${yo}, de Orbital Eyewear 🕶️ Nos encanta lo que hacés.\n` +
    'Queremos invitarte a nuestro plan Orbital Creator Hub y crear algo juntos: elegir con vos los modelos que van con tu estilo, con la Triple Protección (UV, luz azul e infrarrojo), única en Argentina, y armarte una página propia "Elegidos por {nombre}" con un beneficio exclusivo para tu comunidad ✨\n' +
    "Y con tu panel de resultados seguís cada publicación, cuántos entran y cuántos compran. Todo a la vista, todo bajo tu control 📊\n" +
    "¿Te gustaría que lo charlemos?" },
];

const primerNombreIg = (f: IgFila) => (f.nombre ?? f.usuario).trim().split(/[\s·|,]/)[0] || f.usuario;
function mensajeIg(f: IgFila, yo: string) {
  const tr = TRAMOS_IG.find((x) => f.seguidores >= x.min && (x.max == null || f.seguidores < x.max)) ?? TRAMOS_IG[0];
  return tr.msj(yo).replace(/\{nombre\}/g, primerNombreIg(f)).replace(/\{usuario\}/g, f.usuario);
}
const miles = (n: number) => Number(n || 0).toLocaleString("es-AR");
const fechaCortaAr = (s: string | null) => (s ? new Date(s).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" }) : "");

async function espejoAdmin(a: Admin, texto: string) {
  const g = await cfg("colab_telegram_grupo");
  if (!g) return;
  await enviar(Number(g), `👁 <b>${esc(a.nombre)}</b> (admin) ${texto}\n\n<code>#a${a.admin_id}</code>`);
}

const guardarEstado = (tg: number, e: Record<string, any>) => rpc("colab_tg_admin_estado", { p_tg: tg, p_estado: e });

function tarjetaIg(f: IgFila) {
  return `<b>@${esc(f.usuario)}</b> · ${miles(f.seguidores)} seguidores\n` +
    `${esc(f.nombre ?? "")}${f.categoria ? ` · ${esc(f.categoria)}` : ""}` +
    (f.ultimo_dm ? `\nNos escribió por última vez el ${new Date(f.ultimo_dm).toLocaleDateString("es-AR")}` : "") +
    (f.bio ? `\n<i>${esc(f.bio.slice(0, 220))}</i>` : "");
}

const botonesEstadoIg = (usuario: string): Boton[][] => [
  [{ text: "💬 Respondió", callback_data: `ai|e|respondio|${usuario}` }, { text: "✅ Se sumó", callback_data: `ai|e|alta|${usuario}` }],
  [{ text: "✖ Descartado", callback_data: `ai|e|descartado|${usuario}` }, { text: "↩ Sin escribir", callback_data: `ai|e|pendiente|${usuario}` }],
];

async function adminProximo(chat: number, tg: number, a: Admin) {
  if (!a.ve_ig) {
    await enviar(chat, "Todavía no tenés habilitada la lista de Instagram. Pedíselo a Gastón.", undefined, MENU_ADMIN);
    return;
  }
  const tramo = TRAMOS_IG[Number(a.estado?.tramo ?? -1)];
  const saltados: string[] = a.estado?.saltados ?? [];
  const r = await rpc<{ fila: IgFila | null; quedan: number } | null>("ig_infl_proximo", {
    p_clave: a.clave, p_min: tramo?.min ?? 5000, p_max: tramo?.max ?? null, p_excluir: saltados,
  });
  const filtros: Boton[][] = [
    TRAMOS_IG.slice(0, 3).map((x, i) => ({ text: (Number(a.estado?.tramo) === i ? "● " : "") + x.t, callback_data: `ai|t|${i}` })),
    [...TRAMOS_IG.slice(3).map((x, i) => ({ text: (Number(a.estado?.tramo) === i + 3 ? "● " : "") + x.t, callback_data: `ai|t|${i + 3}` })),
      { text: (tramo ? "" : "● ") + "Todos", callback_data: "ai|t|-1" }],
  ];
  if (!r?.fila) {
    await enviar(chat, `No quedan influencers sin escribir${tramo ? ` en ${tramo.t} seguidores` : ""} 🎉\n\nProbá con otro tramo:`, filtros);
    return;
  }
  const f = r.fila;
  await enviar(chat,
    `📸 <b>Próximo de la lista</b> · quedan ${miles(r.quedan)}${tramo ? ` en ${tramo.t}` : ""}\n\n${tarjetaIg(f)}`,
    [
      [{ text: "✍️ Lo tomo y le escribo", callback_data: `ai|tomar|${f.usuario}` }],
      [{ text: "⏭ Otro", callback_data: `ai|skip|${f.usuario}` }, { text: "👀 Ver perfil", url: `https://instagram.com/${f.usuario}` }],
      ...filtros,
    ]);
}

async function adminTomar(chat: number, tg: number, a: Admin, usuario: string) {
  const t = await rpc<{ ok: boolean; por: string | null; estado: string; en?: string | null }>("ig_infl_tomar", { p_clave: a.clave, p_usuario: usuario });
  if (!t?.ok) {
    await enviar(chat, `🔒 A @${esc(usuario)} ya lo contactó <b>${esc(t?.por ?? "otra persona")}</b>${t?.en ? ` el ${fechaCortaAr(t.en)}` : ""}. Te paso otro.`);
    await adminProximo(chat, tg, a);
    return;
  }
  const f = await rpc<IgFila | null>("ig_infl_uno", { p_clave: a.clave, p_usuario: usuario });
  if (!f) return;
  await enviar(chat,
    `✅ Quedó a tu nombre: <b>@${esc(usuario)}</b>\n\n` +
    "1. Mantené apretado el mensaje de abajo y copialo\n2. Tocá <b>Abrir su chat</b>, pegalo y enviá\n3. Cuando conteste, marcalo acá o en 📋 Mis contactos",
    [[{ text: `💬 Abrir su chat`, url: `https://ig.me/m/${usuario}` }], ...botonesEstadoIg(usuario),
      [{ text: "📸 Siguiente", callback_data: "ai|next" }]]);
  await enviar(chat, `<pre>${esc(mensajeIg(f, a.nombre))}</pre>`);
  await espejoAdmin(a, `tomó a <b>@${esc(usuario)}</b> (${miles(f.seguidores)} seg.) de la lista de Instagram`);
}

async function adminMarcar(chat: number, a: Admin, estado: string, usuario: string) {
  const r = await rpc<IgFila | null>("ig_infl_marcar", { p_clave: a.clave, p_usuario: usuario, p_estado: estado });
  if (!r) return void (await enviar(chat, "No encontré a ese usuario en la lista."));
  await enviar(chat, `Listo: <b>@${esc(usuario)}</b> → ${IG_ESTADO[estado] ?? estado}` +
    (estado === "alta" ? "\n\n¿Lo das de alta como promotor ahora?" : ""),
    estado === "alta" ? [[{ text: "➕ Darlo de alta", callback_data: `aa|desde|${usuario}` }]] : undefined);
  await espejoAdmin(a, `marcó a <b>@${esc(usuario)}</b> como ${IG_ESTADO[estado] ?? estado}`);
}

async function adminMisContactos(chat: number, a: Admin, filtro = "abiertos") {
  const estados = filtro === "abiertos" ? ["escrito", "respondio"] : [filtro];
  const filas = await rpc<IgFila[] | null>("ig_infl_mios", { p_clave: a.clave, p_estados: estados });
  const chips: Boton[][] = [[
    { text: "Abiertos", callback_data: "ai|mis|abiertos" }, { text: "Se sumaron", callback_data: "ai|mis|alta" },
    { text: "Descartados", callback_data: "ai|mis|descartado" },
  ]];
  if (!filas?.length) {
    await enviar(chat, filtro === "abiertos" ? "No tenés contactos abiertos. Tocá <b>📸 Próximo influencer</b> para arrancar." : "No hay contactos con ese estado.", chips);
    return;
  }
  await enviar(chat, `📋 <b>Tus contactos</b> · ${filtro === "abiertos" ? "escritos y que respondieron" : IG_ESTADO[filtro]} (${filas.length})\nTocá uno para cambiarle el estado.`,
    [...filas.map((f) => [{ text: `@${f.usuario} · ${IG_ESTADO[f.estado] ?? f.estado} · ${fechaCortaAr(f.escrito_en)}`, callback_data: `ai|ver|${f.usuario}` }]), ...chips]);
}

async function adminVerIg(chat: number, a: Admin, usuario: string) {
  const f = await rpc<IgFila | null>("ig_infl_uno", { p_clave: a.clave, p_usuario: usuario });
  if (!f) {
    await enviar(chat, `@${esc(usuario)} no está en la lista de Instagram (solo están los que nos escribieron por DM con 5.000+ seguidores).`);
    return;
  }
  const quien = f.escrito_por ? ` · ${f.escrito_por === a.nombre ? "lo contactaste vos" : `lo contactó <b>${esc(f.escrito_por)}</b>`}${f.escrito_en ? ` el ${fechaCortaAr(f.escrito_en)}` : ""}` : "";
  await enviar(chat, `${tarjetaIg(f)}\n\nEstado: <b>${IG_ESTADO[f.estado] ?? f.estado}</b>${quien}`,
    f.estado === "pendiente"
      ? [[{ text: "✍️ Lo tomo y le escribo", callback_data: `ai|tomar|${f.usuario}` }]]
      : [[{ text: "💬 Abrir su chat", url: `https://ig.me/m/${f.usuario}` }], ...botonesEstadoIg(f.usuario)]);
}

// Alta de promotor paso a paso: el estado de la charla vive en colab_tg_admin.estado
const PASOS_ALTA: { k: string; pregunta: string; opcional?: boolean }[] = [
  { k: "nombre", pregunta: "¿Cómo se llama? (como lo conoce su comunidad)" },
  { k: "telefono", pregunta: "¿Su WhatsApp? (ej. 11 5555 5555). Con ese número entra al bot sin clave." },
  { k: "usuario", pregunta: "¿Su @ de Instagram?", opcional: true },
  { k: "seguidores", pregunta: "¿Cuántos seguidores tiene? (aproximado)", opcional: true },
  { k: "cbu_alias", pregunta: "¿Su CBU o alias para pagarle la comisión?", opcional: true },
];

async function adminAltaPaso(chat: number, tg: number, a: Admin, alta: Record<string, string>) {
  const paso = PASOS_ALTA.find((p) => alta[p.k] === undefined);
  await guardarEstado(tg, { ...a.estado, alta });
  if (paso) {
    await enviar(chat, `➕ <b>Alta de promotor</b> · paso ${PASOS_ALTA.indexOf(paso) + 1} de ${PASOS_ALTA.length}\n\n${paso.pregunta}`,
      [[...(paso.opcional ? [{ text: "Saltar", callback_data: "aa|saltar" }] : []), { text: "Cancelar", callback_data: "aa|cancelar" }]]);
    return;
  }
  await enviar(chat,
    `➕ <b>Revisá los datos</b>\n\n` +
    `Nombre: <b>${esc(alta.nombre)}</b>\nWhatsApp: ${esc(alta.telefono || "—")}\nInstagram: ${alta.usuario ? "@" + esc(alta.usuario) : "—"}` +
    `${alta.seguidores ? ` (${esc(alta.seguidores)} seg.)` : ""}\nCBU o alias: ${esc(alta.cbu_alias || "— (se lo podés pedir después)")}\n\n` +
    `Comisión 10% · descuento para su comunidad 15% (lo fija Orbital).`,
    [[{ text: "✅ Crear promotor", callback_data: "aa|ok" }, { text: "Cancelar", callback_data: "aa|cancelar" }]]);
}

async function adminAltaCrear(chat: number, tg: number, a: Admin) {
  const alta = (a.estado?.alta ?? {}) as Record<string, string>;
  if (!alta.nombre) return void (await enviar(chat, "Se cortó el alta. Tocá <b>➕ Alta de promotor</b> y arrancamos de nuevo.", undefined, MENU_ADMIN));
  const usuario = (alta.usuario || "").replace(/^@/, "").trim();
  let r: { id: number; clave: string } | null = null;
  try {
    r = await rpc<{ id: number; clave: string }>("colab_admin_guardar", {
      p_clave: a.clave,
      p: {
        nombre: alta.nombre, telefono: alta.telefono || null, cbu_alias: alta.cbu_alias || null,
        redes: usuario ? [{ red: "instagram", usuario, url: `https://instagram.com/${usuario}`, seguidores: alta.seguidores || "" }] : [],
      },
    });
  } catch (e) {
    console.error("alta promotor", e);
  }
  await guardarEstado(tg, { ...a.estado, alta: undefined });
  if (!r?.clave) return void (await enviar(chat, "No pude crearlo 😕 Probá de nuevo o cargalo desde tu panel.", undefined, MENU_ADMIN));

  // Si estaba en la lista de Instagram, queda como "Se sumó"
  if (usuario) {
    const f = await rpc<IgFila | null>("ig_infl_uno", { p_clave: a.clave, p_usuario: usuario }).catch(() => null);
    if (f && f.estado !== "alta") await rpc("ig_infl_marcar", { p_clave: a.clave, p_usuario: f.usuario, p_estado: "alta" }).catch(() => null);
  }
  const panel = `${BASE}/colab?k=${r.clave}`;
  const nombre1 = alta.nombre.split(" ")[0];
  const msj =
    `Hola ${nombre1}! Bienvenido/a a Orbital Creator Hub 🕶️\n\n` +
    `Tu panel (anteojos, textos listos, tu link con descuento para tu comunidad y tus resultados): ${panel}\n\n` +
    `Y el atajo desde el celu, por Telegram:\n` +
    `1. Bajá Telegram (Play Store o App Store) y registrate con este mismo número\n` +
    `2. Abrí https://t.me/orbital_celeb_bot y tocá Iniciar\n` +
    `3. Tocá "📱 Entrar con mi teléfono"\n` +
    `Ahí pedís tus links, ves tus números y consultás al equipo.`;
  const tel = (alta.telefono || "").replace(/\D/g, "");
  const wa = tel ? `https://wa.me/${tel.startsWith("54") ? tel : "549" + tel.replace(/^0/, "")}?text=${encodeURIComponent(msj)}` : null;
  await enviar(chat,
    `🎉 <b>${esc(alta.nombre)}</b> ya es promotor.\n\nSu panel:\n${panel}\n\n` +
    (wa ? "Tocá <b>Mandarle todo por WhatsApp</b>: le llega su panel y cómo entrar al bot." : "No cargaste WhatsApp: copiá el mensaje de abajo y mandáselo."),
    wa ? [[{ text: "📲 Mandarle todo por WhatsApp", url: wa }]] : undefined, undefined);
  if (!wa) await enviar(chat, `<pre>${esc(msj)}</pre>`);
  await enviar(chat, "¿Algo más?", undefined, MENU_ADMIN);
  await espejoAdmin(a, `dio de alta al promotor <b>${esc(alta.nombre)}</b>${usuario ? ` (@${esc(usuario)})` : ""}`);
}

type PromotorAdm = { id: number; nombre: string; clave: string; telefono: string | null; activo: boolean; cbu_alias: string | null;
  links: number; clicks: number; pedidos: number; neto: number; com_inf: number; com_adm: number };

async function adminPromotores(chat: number, a: Admin) {
  const lista = ((await rpc<PromotorAdm[] | null>("colab_admin_influencers", { p_clave: a.clave, p_admin: null })) ?? []).filter((p) => p.activo);
  if (!lista.length) {
    await enviar(chat, "Todavía no tenés promotores. Tocá <b>➕ Alta de promotor</b>.", undefined, MENU_ADMIN);
    return;
  }
  const enBot = new Set((await conectados()).map((c) => c.influencer_id));
  const t = `👥 <b>Tus promotores</b> (${lista.length})\n\n` + lista.map((p) =>
    `<b>${esc(p.nombre)}</b> ${enBot.has(p.id) ? "📱" : "· <i>sin bot</i>"}${p.cbu_alias ? "" : " · ⚠️ falta CBU"}\n` +
    `${p.links} links · ${miles(p.clicks)} toques · ${p.pedidos} ped. · ${pesos(p.neto)} · tu comisión ${pesos(p.com_adm)}`).join("\n\n") +
    "\n\n📱 = ya usa el bot. Tocá uno para ver su panel y mandárselo.";
  await enviar(chat, t, lista.slice(0, 20).map((p) => [{ text: p.nombre, callback_data: `ap|${p.id}` }]));
}

async function adminPromotor(chat: number, a: Admin, id: number) {
  const lista = (await rpc<PromotorAdm[] | null>("colab_admin_influencers", { p_clave: a.clave, p_admin: null })) ?? [];
  const p = lista.find((x) => x.id === id);
  if (!p) return void (await enviar(chat, "No encontré ese promotor."));
  const panel = `${BASE}/colab?k=${p.clave}`;
  const msj = `Hola ${p.nombre.split(" ")[0]}! Tu panel de Orbital: ${panel}\n\nY el atajo por Telegram: https://t.me/orbital_celeb_bot → Iniciar → "📱 Entrar con mi teléfono".`;
  const tel = (p.telefono || "").replace(/\D/g, "");
  const wa = tel ? `https://wa.me/${tel.startsWith("54") ? tel : "549" + tel.replace(/^0/, "")}?text=${encodeURIComponent(msj)}` : null;
  await enviar(chat,
    `<b>${esc(p.nombre)}</b>\n${p.links} links · ${miles(p.clicks)} toques · ${p.pedidos} pedidos · ${pesos(p.neto)} sin IVA\n` +
    `Comisión de él/ella: ${pesos(p.com_inf)} · la tuya: ${pesos(p.com_adm)}\n` +
    `CBU/alias: ${esc(p.cbu_alias || "⚠️ falta")}\n\nPanel: ${panel}`,
    [[{ text: "🔗 Abrir su panel", url: panel }], ...(wa ? [[{ text: "📲 Mandarle panel + bot por WhatsApp", url: wa }]] : [])]);
}

const MARCA_CONSULTA_ADMIN = "Escribí tu consulta para Gastón";

async function manejarAdmin(msg: Record<string, any>, chat: number, tg: number, a: Admin) {
  const texto = String(msg.text ?? "").trim();
  const t = sinTilde(texto);
  const lector: Lector = { clave: a.clave, pct: Number(a.pct), nombre: a.nombre, rol: "admin" };

  if (texto.startsWith("/promotor")) {
    await rpc("colab_tg_admin_modo", { p_tg: tg, p_modo: "promotor" });
    await enviar(chat, "Pasaste a <b>modo promotor</b>. Para volver escribí /admin.", undefined, MENU);
    return;
  }
  if (texto.startsWith("/start") || texto.startsWith("/admin") || t === "ayuda" || texto.startsWith("/ayuda") || t === "menu") {
    await guardarEstado(tg, {});
    await enviar(chat, `Hola ${esc(a.nombre)} 👋\n\n${AYUDA_ADMIN}\n\nTu panel: ${BASE}/colab?k=${a.clave}`, undefined, MENU_ADMIN);
    return;
  }

  // Respuesta a "escribí tu consulta" → al grupo interno
  const cita = String(msg.reply_to_message?.text ?? "");
  if (texto && msg.reply_to_message?.from?.is_bot && (cita.includes(MARCA_CONSULTA_ADMIN) || cita.startsWith("📣"))) {
    await espejoAdmin(a, `consulta:\n\n«${esc(texto)}»\n\nRespondé este mensaje para contestarle.`);
    await enviar(chat, "Listo, se la pasé a Gastón 🙌 Te responde por acá.", undefined, MENU_ADMIN);
    return;
  }

  // Botones del menú (cortan cualquier alta a medio hacer)
  const menu = t.includes("proximo influencer") ? "prox" : t.includes("mis contactos") ? "mis" : t.includes("alta de promotor") ? "alta"
    : t.includes("mis promotores") ? "proms" : t.includes("resultados") || t.includes("dashboard") ? "res"
    : t.includes("consultar a gaston") || texto.startsWith("/consulta") ? "cons" : t.includes("liquidacion") ? "liq" : "";
  if (menu && a.estado?.alta) { await guardarEstado(tg, { ...a.estado, alta: undefined }); a.estado = { ...a.estado, alta: undefined }; }
  if (menu === "prox") return void (await adminProximo(chat, tg, a));
  if (menu === "mis") return void (await adminMisContactos(chat, a));
  if (menu === "alta") return void (await adminAltaPaso(chat, tg, a, {}));
  if (menu === "proms") return void (await adminPromotores(chat, a));
  if (menu === "res") return void (await pantallaDashMenu(chat, lector));
  if (menu === "liq") return void (await pantallaLiquidacion(chat, lector));
  if (menu === "cons") {
    await enviar(chat, `💬 ${MARCA_CONSULTA_ADMIN} respondiendo este mensaje.`, undefined, { force_reply: true, input_field_placeholder: "Tu consulta…" });
    return;
  }

  // Alta en curso: el texto es la respuesta al paso
  const alta = a.estado?.alta as Record<string, string> | undefined;
  if (alta && texto) {
    const paso = PASOS_ALTA.find((p) => alta[p.k] === undefined);
    if (paso) {
      let v = texto;
      if (paso.k === "telefono" && v.replace(/\D/g, "").length < 8) {
        await enviar(chat, "Ese número parece incompleto. Mandámelo con característica, ej. <b>11 5555 5555</b>.");
        return;
      }
      if (paso.k === "usuario") v = v.replace(/^@/, "").replace(/^https?:\/\/(www\.)?instagram\.com\//i, "").replace(/\/.*$/, "").trim();
      return void (await adminAltaPaso(chat, tg, a, { ...alta, [paso.k]: v }));
    }
  }

  // @usuario → cómo está en la lista
  const arroba = texto.match(/^@?([a-z0-9._]{3,30})$/i);
  if (texto.startsWith("@") && arroba) return void (await adminVerIg(chat, a, arroba[1]));

  await espejoAdmin(a, `escribió algo que el bot no entendió: «${esc(texto)}»\n\nRespondé este mensaje para contestarle.`);
  await enviar(chat, "No te entendí 🤔\n\n" + AYUDA_ADMIN, undefined, MENU_ADMIN);
}

async function manejarCallbackAdmin(cb: Record<string, any>, chat: number, tg: number, a: Admin) {
  const [op, ...resto] = String(cb.data ?? "").split("|");
  const lector: Lector = { clave: a.clave, pct: Number(a.pct), nombre: a.nombre, rol: "admin" };

  if (op === "ai") {
    const [acc, x, y] = resto;
    if (acc === "next") return void (await adminProximo(chat, tg, a));
    if (acc === "t") {
      a.estado = { ...a.estado, tramo: Number(x), saltados: [] };
      await guardarEstado(tg, a.estado);
      return void (await adminProximo(chat, tg, a));
    }
    if (acc === "skip") {
      a.estado = { ...a.estado, saltados: [...(a.estado?.saltados ?? []), x].slice(-200) };
      await guardarEstado(tg, a.estado);
      return void (await adminProximo(chat, tg, a));
    }
    if (acc === "tomar") {
      await adminTomar(chat, tg, a, x);
      return;
    }
    if (acc === "e") return void (await adminMarcar(chat, a, x, y));
    if (acc === "mis") return void (await adminMisContactos(chat, a, x));
    if (acc === "ver") return void (await adminVerIg(chat, a, x));
    return;
  }
  if (op === "aa") {
    const alta = (a.estado?.alta ?? {}) as Record<string, string>;
    if (resto[0] === "cancelar") {
      await guardarEstado(tg, { ...a.estado, alta: undefined });
      return void (await enviar(chat, "Alta cancelada.", undefined, MENU_ADMIN));
    }
    if (resto[0] === "saltar") {
      const paso = PASOS_ALTA.find((p) => alta[p.k] === undefined);
      if (paso?.opcional) return void (await adminAltaPaso(chat, tg, a, { ...alta, [paso.k]: "" }));
      return;
    }
    if (resto[0] === "ok") return void (await adminAltaCrear(chat, tg, a));
    if (resto[0] === "desde") {
      const f = await rpc<IgFila | null>("ig_infl_uno", { p_clave: a.clave, p_usuario: resto[1] });
      return void (await adminAltaPaso(chat, tg, a, f
        ? { nombre: f.nombre?.trim() || f.usuario, usuario: f.usuario, seguidores: String(f.seguidores) }
        : { usuario: resto[1] }));
    }
    return;
  }
  if (op === "ap") return void (await adminPromotor(chat, a, Number(resto[0])));
  if (op === "d") {
    if (resto[0] === "menu") return void (await pantallaDashMenu(chat, lector));
    if (resto[0] === "liq") return void (await pantallaLiquidacion(chat, lector));
    return void (await pantallaDash(chat, lector, resto[0]));
  }
  if (op === "q") return void (await pantallaLiquidacion(chat, lector, resto[0]));
}

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
    // …y el de un administrador (#a<id>) = escribirle a ese administrador
    const marcaA = citado.match(/#a(\d+)/);
    if (marcaA && texto && !texto.startsWith("/")) {
      const c = await rpc<number | null>("colab_tg_admin_chat", { p_admin: Number(marcaA[1]) });
      if (!c) await enviar(chat, "Ese administrador no está conectado al bot.");
      else {
        await enviar(c, `📣 <b>Orbital</b>\n\n${esc(texto)}`);
        await enviar(chat, "Enviado ✔");
      }
      return;
    }
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
        "Y respondiendo cualquier mensaje 👁 le contestás a ese promotor o administrador.");
    }
    return; // en grupo no contesta nada más
  }

  const nombreTg = [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(" ") || null;

  // ——— administradores (Mery, Yamila, Ariel, Gastón): entran con su teléfono o su clave ad-… ———
  const adm = await rpc<Admin | null>("colab_tg_admin_quien", { p_tg: from });
  const telAdm = msg.contact?.user_id === from ? String(msg.contact?.phone_number ?? "") : "";
  const claveAd = texto.match(/\bad-[a-z0-9]{6,}\b/i)?.[0];
  if ((telAdm || claveAd) && !(adm && adm.modo === "admin")) {
    const r = await rpc<{ ok: boolean; error?: string; nombre?: string; admin_id?: number }>("colab_tg_admin_vincular", {
      p_tg: from, p_chat: chat, p_tel: telAdm || null, p_clave: claveAd ?? null, p_nombre: nombreTg, p_username: msg.from?.username ?? null,
    });
    if (r?.ok) {
      const a = await rpc<Admin | null>("colab_tg_admin_quien", { p_tg: from });
      // si además es promotor (Gastón), también queda vinculado como promotor para /promotor
      if (telAdm) await rpc("colab_tg_vincular_tel", { p_tg: from, p_chat: chat, p_tel: telAdm, p_nombre: nombreTg, p_username: msg.from?.username ?? null }).catch(() => null);
      await enviar(chat, `¡Hola ${esc(r.nombre ?? "")}! Entraste como <b>administrador</b> 🎉\n\n${AYUDA_ADMIN}` +
        (a ? `\n\nTu panel: ${BASE}/colab?k=${a.clave}` : ""), undefined, MENU_ADMIN);
      if (a) await espejoAdmin(a, "se conectó al bot como administrador");
      return;
    }
    if (claveAd) {
      await enviar(chat, r?.error === "repetido" ? "Ese teléfono figura en más de un administrador. Avisale a Gastón." : "Esa clave de administrador no me figura.");
      return;
    }
    // el teléfono no es de un administrador → sigue como promotor
  }
  if (adm && adm.modo === "admin") return void (await manejarAdmin(msg, chat, from, adm));
  if (texto.startsWith("/admin")) {
    if (adm) {
      await rpc("colab_tg_admin_modo", { p_tg: from, p_modo: "admin" });
      await enviar(chat, `Volviste al <b>modo administrador</b>.\n\n${AYUDA_ADMIN}`, undefined, MENU_ADMIN);
    } else {
      await enviar(chat, "Para entrar como administrador tocá el botón y compartí tu teléfono.", undefined,
        { ...PEDIR_TEL, keyboard: [[{ text: "📱 Entrar como administrador", request_contact: true }]] });
    }
    return;
  }

  const q = await rpc<Quien | null>("colab_tg_quien", { p_tg: from });

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
      "Hola 👋 Soy el asistente de Orbital Creator Hub, para promotores y administradores.\n\n" +
      "Tocá el botón de acá abajo y entrás con tu teléfono, sin claves ni contraseñas.",
      undefined, PEDIR_TEL);
    return;
  }

  const t = sinTilde(texto);
  const lector: Lector = { clave: q.clave, pct: Number(q.pct_comision), nombre: q.nombre, infId: q.influencer_id,
    pctResto: q.pct_comision_resto != null ? Number(q.pct_comision_resto) : null, restoDesde: q.pct_resto_desde ?? null };

  // Foto (o imagen mandada como archivo) → qué anteojo es
  const docMime = String(msg.document?.mime_type ?? "");
  const foto = msg.photo?.length
    ? { id: msg.photo[msg.photo.length - 1].file_id as string, mime: "image/jpeg" }
    : ["image/jpeg", "image/png", "image/webp"].includes(docMime) ? { id: msg.document.file_id as string, mime: docMime } : null;
  if (foto) {
    await reconocerFoto(chat, q, foto.id, foto.mime);
    return;
  }

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

  const adm = await rpc<Admin | null>("colab_tg_admin_quien", { p_tg: from });
  if (adm && adm.modo === "admin") return void (await manejarCallbackAdmin(cb, chat, from, adm));

  const q = await rpc<Quien | null>("colab_tg_quien", { p_tg: from });
  if (!q) {
    await enviar(chat, "Tocá el botón para entrar con tu teléfono.", undefined, PEDIR_TEL);
    return;
  }
  const lector: Lector = { clave: q.clave, pct: Number(q.pct_comision), nombre: q.nombre, infId: q.influencer_id,
    pctResto: q.pct_comision_resto != null ? Number(q.pct_comision_resto) : null, restoDesde: q.pct_resto_desde ?? null };

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

  if (op === "f") return void (await mostrarModeloDeFoto(chat, q, resto.join("|")));

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

  // Prueba del reconocimiento sin Telegram: POST ?tarea=probarfoto  {b64, mime}  (con x-cron-key)
  if (url.searchParams.get("tarea") === "probarfoto") {
    const cronKey = await cfg("cron_key", "CRON_KEY");
    if (!cronKey || req.headers.get("x-cron-key") !== cronKey) return new Response("unauthorized", { status: 401 });
    const { b64, mime } = await req.json();
    return Response.json({ candidatos: await modeloDeFoto(b64, mime ?? "image/jpeg") });
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
