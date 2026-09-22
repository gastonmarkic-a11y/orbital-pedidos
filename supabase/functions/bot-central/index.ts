// bot-central — IRIS, asistente de atención de Orbital (multicanal).
// v66: cliente identificado (cod real) que confirma la cotización con "sí" → precarga directa en la Suite
//      (bot_precarga_crear → catalogo_precarga, igual que el catálogo: codigo, precio de su lista, tope de stock,
//      vendedor de la cuenta). La ve el vendedor en Pedidos y la avisa el Ojo. Sin cod: deriva como antes.
//      v66 además: roturas, garantías y devoluciones van a Postventa (vendedor "Postventa", +54 9 11 3113-2742), ya no a Mauro.
// v65: en "¿cómo se llama tu óptica?" una respuesta de consumidor final ("soy consumidor final", "no tengo
//      óptica") ya no se busca como nombre de óptica → pasa a consumidor (tienda + óptica cerca). Además
//      bot_buscar_optica ya no devuelve cuentas internas (888888/9 y 9999xx: Empleados, Prensa, ML, locales propios).
// v64: "¿dónde consigo este modelo?" vale en CUALQUIER charla y canal (no solo la campaña Diferenciarte,
//      que sigue igual) · ruteo por tema en el chat general: postventa (roturas/garantía/devoluciones) → Postventa (v66);
//      facturación/cobranza y entrega/despacho → Administración (que ve el estado del pedido en la Suite).
// v63: consumidor que consulta un modelo y pide dónde probarlo → primero las sucursales de consigna que lo tienen
//      (bot_sucursal_consigna_cercana) y la consulta le queda a la sucursal (consigna_consulta, panel /consigna).
// v62: "sí" con tilde se toma como respuesta afirmativa (antes lo trataba como consumidor final).
// v61: mismo flujo para leads del formulario B2B de Meta (campana meta_form_b2b, con los datos del form); si piden
//      vendedor, se confirma que sea óptica y se deriva directo al vendedor de su cuenta o de su zona (con su WhatsApp).
// v60: el mensaje precargado del anuncio no cuenta como repetición (retoma donde estaba); si a "¿tenés una óptica?"
//      preguntan otra cosa, es consumidor final → tienda + búsqueda de lo que pidió, y siempre se le repregunta si es óptica.
// v59: campaña "Diferenciarte v2" sin intervención humana: speech → óptica/consumidor → nombre → cliente existente
//      (propuesta según historial + alarma canje/recuperar) o prospecto nuevo (datos → alta + token + bono 5%) ·
//      distribuidores por provincia/localidad (Georef) · FAQ directas (mínimos, pago, bono) · CUIT post-pedido.
// v55: nunca pide zona/provincia/localidad — la ubicación la carga el vendedor después.
// v54: fix de clasificación de segmento con palabras acentuadas (\b no matchea antes de "ó").
// v53: acceso al catálogo autohabilitado SOLO para leads de campaña Meta; puerta de ingreso al embudo.
// v52: arreglo de las 8 fallas del relevamiento.
import { createClient } from "jsr:@supabase/supabase-js@2";

const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const GROQ_KEY = Deno.env.get("GROQ_API_KEY") ?? "";
const GROQ_MODELS = [...new Set([Deno.env.get("GROQ_MODEL") ?? "openai/gpt-oss-20b", "openai/gpt-oss-120b", "openai/gpt-oss-20b"])];
const REABRIR_HORAS = 12;
const TEST_TELS: string[] = [];
const CATALOGO_URL = "https://ver.orbitaleyewear.com.ar/catalogo";
const VENDEDOR_LEADS = "Ulises";

type Canal = "whatsapp" | "instagram" | "email" | "web" | "mercadolibre_pregunta" | "mercadolibre_posventa";
interface MensajeEntrante { conversacionId: string; contactoId: string; canal: Canal; texto: string; esLead?: boolean; }
interface RespuestaBot { texto: string; quickReplies?: string[]; derivar?: { motivo: string; resumen: string }; }
interface Alloc { color: string; qty: number; }
interface ItemCoti { modelo: string; precio_lista: number; precio_publico: number | null; colores: string[]; objetivo: number; alloc: Alloc[]; }
interface Msg { emisor: string; contenido: string; created_at: string }

function telNorm(t: string | null): string { return (t ?? "").replace(/\D/g, ""); }
function esPrueba(tel: string | null): boolean { const d = telNorm(tel); return d.length >= 8 && TEST_TELS.some((s) => d.endsWith(s)); }
const money = (n: number) => "$" + Math.round(n).toLocaleString("es-AR");
function precioUnit(it: ItemCoti, tipo: string): number { return tipo === "mayorista" ? Math.round(it.precio_lista || 0) : Math.round(it.precio_publico || 0); }
function fmtUnit(it: ItemCoti, tipo: string): string { const p = precioUnit(it, tipo); return tipo === "mayorista" ? `${money(p)} + IVA` : money(p); }
function fmtMoney(n: number, tipo: string): string { return tipo === "mayorista" ? `${money(n)} + IVA` : money(n); }

function norm(s: string): string {
  return (s ?? "").toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}
function repetida(texto: string, ultimasBot: string[], n = 3): boolean {
  const t = norm(texto); if (t.length < 8) return false;
  return ultimasBot.slice(0, n).some((x) => norm(x) === t);
}

function enHorario(): boolean {
  const p = new Intl.DateTimeFormat("en-GB", { timeZone: "America/Argentina/Buenos_Aires", hour: "2-digit", hour12: false, weekday: "short" }).formatToParts(new Date());
  const h = parseInt(p.find((x) => x.type === "hour")?.value ?? "0", 10);
  const d = p.find((x) => x.type === "weekday")?.value ?? "";
  return !["Sat", "Sun"].includes(d) && h >= 9 && h < 19;
}
function cuando(): string { return enHorario() ? "en un rato te escribe" : "mañana a primera hora te escribe"; }

async function vendedorId(codigo: string | null): Promise<number | null> {
  if (!codigo) return null;
  const { data } = await supabase.from("vendedores").select("id").eq("codigo", codigo).eq("activo", true).maybeSingle();
  return (data as { id: number } | null)?.id ?? null;
}
async function leadDeMeta(esLead: boolean, tel: string | null): Promise<boolean> {
  if (esLead) return true;
  const t = telNorm(tel).slice(-10);
  if (t.length < 8) return false;
  const { data } = await supabase.from("prospeccion_social").select("id").eq("canal", "meta_b2b").ilike("telefono", `%${t}%`).limit(1);
  if (((data ?? []) as unknown[]).length > 0) return true;
  // El referral de Meta solo viene en el 1er mensaje; wa-webhook deja registrado el aviso por teléfono.
  const { data: av } = await supabase.from("ojo_avisos_enviados").select("ref").eq("tipo", "lead_aviso_meta").ilike("ref", `%${t}`).limit(1);
  return ((av ?? []) as unknown[]).length > 0;
}

// ══ Campaña "Diferenciarte v2" (aviso de Meta clic a WhatsApp) ══
// IRIS lleva la charla sola hasta mandar la propuesta: óptica o consumidor → nombre → cliente existente
// (propuesta según historial) o prospecto nuevo (datos → alta + token + bono) · distribuidores · FAQ directas.
const CAMPANA = "diferenciarte_v2";
const TIENDA = "https://orbitaleyewear.com.ar";
const RE_EX_VENDEDOR = /(ten[ií]a (un |una |el |la |mi )?vendedor|me atend[ií]a|nos atend[ií]a|mi (ex )?vendedor|(el|la) vendedor(a)? (que )?(me|nos)|me visitaba|nos visitaba|me vend[ií]a|nos vend[ií]a|ya (soy|era|fui|somos|[eé]ramos|fuimos) client|ya (les |le )?compr|ya tu(v|b)(e|o|imos) la marca|ya trabaj|trabaj(e|é|aba|ábamos|abamos) con (ustedes|orbital|la marca|un vendedor))/i;
const RE_PREFILL_ANUNCIO = /^\s*¡?\s*hola\s*!?\s*,?\s*quiero m[aá]s informaci[oó]n\s*[.!]*\s*$/i;
const RE_DICE_OPTICA = /(tengo (una |un )?([oó]ptica|local|negocio|comercio)|soy (el |la )?(due[ñn][oa]|encargad[oa]) de|soy [oó]ptic|somos (una )?[oó]ptica|s[ií],? (tengo|soy|somos)|mayorista|para (mi|nuestro) (local|negocio|[oó]ptica))/i;
const RE_SOLO_SALUDO = /^\s*(hola|holis|buenas|buen[oa]s?\s*(d[ií]as?|tardes?|noches?)?|hey|qu[eé]\s*tal|gracias|ok|okey|dale|listo|\?+|👍|🙌)\s*[!.?\s]*$/i;
const STOP_BUSQUEDA = new Set(["en","para","de","del","la","las","el","los","un","una","unos","unas","quiero","quisiera","busco","buscaba","tenes","tienen","tiene","hay","algo","que","me","mi","con","y","o","por","favor","hola","info","informacion","mas","saber","ver","consulta","consultar","interesa","interesado","interesada","gracias","precio","precios","cuanto","sale","salen","cuesta","cuestan","valor","valen","vale","anteojo","anteojos","lentes","lente","modelo","modelos","como","es","son","esos","esas","estos","estas","ese","esa","este","esta","lo","le","se","si","no","a","al"]);
function palabrasBusqueda(t: string): string {
  return norm(t).split(" ").filter((w) => w.length >= 3 && !STOP_BUSQUEDA.has(w)).slice(0, 4).join(" ");
}
// Sin \b al final: en JS "í" no es \w y "sí" nunca matcheaba.
const RE_SI = /^\s*(s[ií]+|claro|obvio|as[ií] es|correcto|afirmativo|exacto|tengo|somos)(?![a-záéíóúñ])/i;
function tipoRespuesta(t: string): "optica" | "consumidor" | null {
  const det = detectarTipo(t);
  if (det === "mayorista" || RE_EX_VENDEDOR.test(t)) return "optica";
  if (det === "minorista") return "consumidor";
  if (/^\s*no\b/i.test(t) || /no tengo (una )?[oó]ptica/i.test(t)) return "consumidor";
  if (RE_SI.test(t)) return "optica";
  return null;
}
const RE_MINIMO = /(m[ií]nim|cantidad m[ií]nima|desde cu[aá]nt|cu[aá]nt[oa]s? (unidades|piezas|anteojos|pares) (hay que|tengo que|debo|m[ií]nim|como m[ií]nimo))/i;
const RE_FORMA_PAGO = /(forma(s)? de pago|c[oó]mo (se )?pag|medios? de pago|plazo|cheque|cuotas|financia|a cu[aá]ntos d[ií]as|transferencia|contado|efectivo)/i;
const RE_BONO = /(bono|descuento|promo|beneficio|bonificaci|oferta|300\.?000)/i;
const RE_VER_PRECIOS = /(precio|lista de precios|cat[aá]logo|cu[aá]nto (sale|cuesta|salen|cuestan|vale|valen)|valores|cotiz|ver (los )?modelos|mandame (el|los)|pasame (el|los))/i;
const RE_DONDE_PROBAR = /(d[oó]nde (los |las )?(puedo|se pueden|los puedo|lo puedo)?\s*(ver|probar|encontrar|conseguir|comprar)|local(es)? (cerca|f[ií]sico)|en qu[eé] [oó]ptica|punto de venta cerca)/i;
const RE_NO_DATO = /^\s*(no( lo)? tengo|no uso|no|despu[eé]s|luego|m[aá]s tarde|paso|prefiero no|ahora no|no s[eé])\b/i;
const RE_EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/;
const RE_CUIT = /\b(\d{2})[-\s.]?(\d{8})[-\s.]?(\d)\b/;

const SPEECH_DEF = "¡Hola! 👋 En un mercado ultra competitivo, te proponemos un producto que no tiene nadie: nuestra colección lleva *Triple Protección* en el cristal — UV400 + Blue Cut + Infrarrojo, todo en uno. Únicos en el mercado argentino, y un valor diferenciador para tu óptica.\n\nTe consulto para confirmar: ¿tenés una óptica?";
const TXT_MINIMO = "No tenemos mínimos 🙌 A partir de *12 unidades* podés armar un pedido para tener una primera referencia de Orbital en tu negocio. Lo aconsejable es arrancar con *24 unidades por punto de venta*, para tener una buena representación de la marca.";
const TXT_PAGO = "Trabajamos a *30, 60 y 90 días*. Con más de 24 unidades, este mes tenés *hasta 120 días*. Y si pagás por *transferencia o contado*, tenés un *15% de descuento extra* exclusivo.";
const TXT_BONO = "Comprando por el catálogo tenés un *bono extra del 5%* sobre tu compra (sin IVA), en pedidos de más de $1.000.000 y *hasta $300.000*. Por ejemplo, en una compra de $6.000.000 el bono es de $300.000. Y se suma al 15% extra si pagás por transferencia o contado.";
// Cierre de TODO mensaje que lleva el token del cliente (catálogo o propuesta).
// Copia de src/lib/mensajes.ts — son runtimes distintos, si se cambia va en los dos.
const TXT_APP = "📲 *Bajate el catálogo como app*: te queda con ícono en el celular o la compu y entrás cuando quieras, sin volver a pedirnos el link. Vas a ver toda la colección en línea, el stock al día, las promos relámpago y las novedades apenas salen. El catálogo es tuyo 🙌";
const TXT_BENEFICIOS = "*Tus beneficios:*\n🎁 *Pack de Bienvenida:* desde 12 piezas de línea, 1 sin cargo cada 4, a elección de Oportunidades.\n💻 *Bono por comprar en el catálogo:* 5% extra sobre tu compra, hasta $300.000 (en pedidos de más de $1.000.000). Vale 72 h.\n📅 *Pago:* 30, 60 y 90 días; con más de 24 unidades, hasta 120 días.\n💵 *15% extra* pagando por transferencia o contado.\n\nNo hay mínimos: desde 12 unidades armás tu pedido, y lo aconsejable es arrancar con 24 por punto de venta.";

interface FlujoDif {
  conversacion_id: string; paso: string; campana: string | null; tipo: string | null; nombre_optica: string | null;
  contacto_nombre: string | null; localidad: string | null; provincia: string | null; email: string | null; cuit: string | null;
  campo_pedido: string | null; cod_cliente: string | null; zona_texto: string | null; creado_en: string;
}
interface Propuesta { ok: boolean; cod: string; label: string; tipo: "bienvenida" | "canje" | "catalogo" | "recuperar"; llamada: boolean; link: string; vendedor: string; ultimo_anio: number | null; }

const CAMPANA_FORM = "meta_form_b2b";
const CAMPANAS = [CAMPANA, CAMPANA_FORM];
const RE_PIDE_VENDEDOR = /(vendedor|vendedora|asesor|asesora|un comercial|hablar con (alguien|una persona|un humano)|persona real|que me llame|me (pueden|podr[ií]an) llamar|llam[aá]me|ll[aá]menme)/i;

// Lead que dejó sus datos en el formulario de Meta (campaña B2B clientes potenciales).
async function leadFormulario(tel: string | null): Promise<{ nombre: string | null; email: string | null; localidad: string | null; provincia: string | null; es_optica: boolean | null } | null> {
  const t = telNorm(tel).slice(-10);
  if (t.length < 8) return null;
  const { data } = await supabase.from("meta_leads").select("nombre, email, localidad, provincia, es_optica, telefono").ilike("telefono", `%${t.slice(-8)}`).order("recibido_at", { ascending: false }).limit(1);
  const r = ((data ?? [])[0] as { nombre: string | null; email: string | null; localidad: string | null; provincia: string | null; es_optica: boolean | null } | undefined);
  return r ?? null;
}

const nombreVendedor = (n: string | null, cod: string) => (n ?? cod).replace(/\s*\(.*\)\s*/g, "").trim() || cod;

// Pide hablar con un vendedor: se confirma que sea óptica y se deriva directo al vendedor de su cuenta o de su zona.
async function pideVendedor(f: FlujoDif, texto: string, tel: string | null, contactoId: string): Promise<RespuestaBot | null> {
  const conv = f.conversacion_id;
  // 1) confirmar que sea óptica
  if (f.tipo !== "optica") {
    if (f.campo_pedido !== "vend_confirma_optica") {
      await guardarFlujo(conv, { campo_pedido: "vend_confirma_optica" });
      return { texto: "¡Dale! Para pasarte con la persona correcta: ¿tenés una óptica? 🙂", quickReplies: ["Sí, tengo óptica", "Soy consumidor final"] };
    }
    const tr = tipoRespuesta(texto) ?? (RE_DICE_OPTICA.test(texto) ? "optica" : null);
    if (tr === "consumidor") {
      await guardarFlujo(conv, { campo_pedido: null, paso: "consumidor", tipo: "consumidor" });
      await supabase.from("contactos").update({ tipo_cliente: "minorista" }).eq("id", contactoId);
      return { texto: `¡Perfecto! Nuestros vendedores atienden a ópticas, pero te ayudo yo 😎 Podés ver toda la colección y comprar online en ${TIENDA}. ¿Te gustó algún anteojo en particular?` };
    }
    if (tr !== "optica") return { texto: "¿Tenés una óptica o sos consumidor final? 🙂", quickReplies: ["Sí, tengo óptica", "Soy consumidor final"] };
    f.tipo = "optica";
    await guardarFlujo(conv, { tipo: "optica", campo_pedido: null });
    await supabase.from("contactos").update({ tipo_cliente: "mayorista" }).eq("id", contactoId);
  }
  // 2) ¿de quién es? cuenta existente → su vendedor; si no, por zona
  let vend: string | null = null;
  if (f.cod_cliente) {
    const { data: c } = await supabase.from("clientes").select("vendedor_asignado").eq("cod", f.cod_cliente).maybeSingle();
    vend = (c as { vendedor_asignado: string | null } | null)?.vendedor_asignado ?? null;
    if (vend === "Corporativo") vend = "Gaston";
  }
  if (!vend) {
    if (f.campo_pedido === "vend_zona") {
      const u = await ubicar(texto);
      if (u.ambigua) return { texto: "¿De qué provincia? 🙂" };
      f.localidad = u.localidad; f.provincia = u.provincia;
      await guardarFlujo(conv, { localidad: u.localidad, provincia: u.provincia });
    }
    if (!f.localidad && !f.provincia) {
      await guardarFlujo(conv, { campo_pedido: "vend_zona" });
      return { texto: "¡Dale! ¿En qué localidad está tu óptica? Así te paso directo con el vendedor de tu zona 🙌" };
    }
    const { data: d } = await supabase.rpc("bot_distribuidor_de", { p_provincia: f.provincia, p_texto: f.localidad ?? "" });
    if (d) return avisarDistribuidor(f, tel, d as { nombre: string; telefono: string });
    const { data: z } = await supabase.rpc("bot_vendedor_por_zona", { p_texto: f.localidad ?? "", p_provincia: f.provincia });
    vend = (z as { vendedor: string } | null)?.vendedor ?? "Gaston";
  }
  const { data: vd } = await supabase.from("vendedores").select("nombre, telefono_remitente, activo").eq("codigo", vend).maybeSingle();
  const v = vd as { nombre: string | null; telefono_remitente: string | null; activo: boolean } | null;
  if (!v?.activo) vend = "Gaston";
  const nom = v?.activo ? nombreVendedor(v.nombre, vend) : "Gastón";
  const telV = v?.activo ? v.telefono_remitente : "5491131147946";
  await supabase.from("derivaciones").insert({
    conversacion_id: conv, motivo: "pide_vendedor",
    resumen: `⚠ URGENTE — pidió hablar con un vendedor (aviso Meta). ${f.nombre_optica ?? "Óptica sin nombre"}${f.localidad ? " · " + f.localidad : ""}${f.cod_cliente ? " (" + f.cod_cliente + ")" : ""}. Escribile ya: «${texto.slice(0, 200)}»`.slice(0, 480),
    estado: "pendiente", tipo_cliente: "mayorista", asignado_a: await vendedorId(vend),
  });
  await supabase.from("at_conversaciones").update({ estado: "derivada" }).eq("id", conv);
  await guardarFlujo(conv, { campo_pedido: null, vendedor: vend } as Partial<FlujoDif>);
  return { texto: `¡Listo! 🙌 Te paso directo con *${nom}*, tu vendedor. Ya le avisé y te va a escribir.${telV ? `\n\nSi querés, escribile ahora: wa.me/${telNorm(telV)}` : ""}` };
}

async function charlaDeCampana(conv: string, tel: string | null, esLead: boolean): Promise<boolean> {
  const { data } = await supabase.from("bot_lead_flujo").select("campana").eq("conversacion_id", conv).maybeSingle();
  if (data) return CAMPANAS.includes((data as { campana: string | null }).campana ?? "");
  return (await esLeadDiferenciarte(esLead, tel)) || !!(await leadFormulario(tel));
}
async function esLeadDiferenciarte(esLead: boolean, tel: string | null): Promise<boolean> {
  if (esLead) return true;
  const t = telNorm(tel).slice(-10);
  if (t.length < 8) return false;
  const { data } = await supabase.from("ojo_avisos_enviados").select("ref").eq("tipo", "lead_aviso_meta").ilike("ref", `%${t}`).limit(1);
  return ((data ?? []) as unknown[]).length > 0;
}
async function guardarFlujo(conv: string, cambios: Partial<FlujoDif>): Promise<void> {
  await supabase.from("bot_lead_flujo").update({ ...cambios, actualizado_en: new Date().toISOString() }).eq("conversacion_id", conv);
}
async function cfgTexto(clave: string, def: string): Promise<string> {
  const { data } = await supabase.from("app_config").select("valor").eq("clave", clave).maybeSingle();
  return (data as { valor: string } | null)?.valor || def;
}
const telLeg = (t: string) => { const d = telNorm(t).replace(/^549?/, ""); return d.length === 10 ? `${d.slice(0, 2)} ${d.slice(2, 6)}-${d.slice(6)}` : t; };

function preguntaPendiente(f: FlujoDif): string {
  switch (f.paso) {
    case "pide_tipo": return "¿Tenés una óptica o sos consumidor final?";
    case "pide_nombre": return "¿Cómo se llama tu óptica?";
    case "pide_zona": return "¿En qué localidad está tu óptica?";
    case "pide_cuit": return "¿Me pasás el CUIT para cerrar tu alta?";
    case "datos": return preguntaDato(f.campo_pedido ?? "contacto");
    default: return "";
  }
}
function preguntaDato(campo: string): string {
  switch (campo) {
    case "contacto": return "¿Con quién hablo? 🙂";
    case "localidad": return "¿En qué localidad está la óptica?";
    case "provincia": return "¿De qué provincia?";
    case "email": return "¿Un mail de contacto?";
    case "cuit": return "Por último, si lo tenés a mano, ¿me pasás el CUIT? Es opcional: si no, seguimos igual.";
    default: return "";
  }
}
function proximoDato(f: FlujoDif): string | null {
  if (!f.contacto_nombre) return "contacto";
  if (!f.localidad) return "localidad";
  if (!f.provincia) return "provincia";
  if (!f.email) return "email";
  if (!f.cuit) return "cuit";
  return null;
}

async function linksDeToken(cod: string): Promise<{ propuesta: string; catalogo: string } | null> {
  const { data } = await supabase.from("catalogo_acceso").select("codigo").eq("cod_cliente", cod).eq("activo", true).eq("tipo", "optica").limit(1);
  const tok = ((data ?? [])[0] as { codigo: string } | undefined)?.codigo;
  if (!tok) return null;
  const base = "https://ver.orbitaleyewear.com.ar";
  return { propuesta: `${base}/bienvenida?c=${tok}`, catalogo: `${base}/catalogo?k=${tok}&pack=bienvenida` };
}

function textoPropuesta(p: Propuesta, vendTel: string | null): string {
  const ini = `¡Te encontré! 🙌 *${p.label}* la atiende ${p.vendedor}.\n\n`;
  const contacto = vendTel ? `\n\nTu vendedor es *${p.vendedor}* — wa.me/${telNorm(vendTel)}` : "";
  const extras = `\n\n💻 Además, comprando por el catálogo tenés un *bono extra del 5%* (hasta $300.000, en pedidos de más de $1.000.000) y *15% extra* pagando por transferencia o contado. Pago a 30, 60 y 90 días; con más de 24 unidades, hasta 120 días.`;
  if (p.tipo === "bienvenida") return ini + `Como todavía no hiciste tu primera compra con Orbital, tenés el *Pack de Bienvenida* armado para tu óptica:\n${p.link}` + extras + contacto;
  if (p.tipo === "canje") return ini + `Tenés una *propuesta de canje* pensada para tu óptica: renovás lo que no rotó por la colección nueva.\n${p.link}` + extras + `\n\n${p.vendedor} te va a llamar para verla juntos 📞`;
  if (p.tipo === "recuperar") return ini + `Te dejo tu catálogo con la colección nueva, stock al día y precios de óptica:\n${p.link}` + extras + `\n\n${p.vendedor} te va a llamar para ponerse al día con vos 📞`;
  return ini + `Acá tenés tu catálogo con stock al día y precios de óptica, para armar el pedido directo:\n${p.link}` + extras + contacto;
}

async function cerrarConPropuesta(conversacionId: string, contactoId: string, cod: string): Promise<RespuestaBot | null> {
  const { data } = await supabase.rpc("bot_propuesta_cliente", { p_cod: cod });
  const p = data as Propuesta | null;
  if (!p?.ok || !p.link) return null;
  await supabase.from("contactos").update({ cod_cliente: p.cod, tipo_cliente: "mayorista" }).eq("id", contactoId);
  const tok = (p.link.match(/[?&][ck]=([^&]+)/) ?? [])[1];
  if (tok) await supabase.rpc("bot_bono_diferenciarte", { p_token: tok, p_cod: p.cod });
  const { data: vd } = await supabase.from("vendedores").select("telefono_remitente").eq("codigo", p.vendedor).eq("activo", true).maybeSingle();
  const vendTel = (vd as { telefono_remitente: string | null } | null)?.telefono_remitente ?? null;

  const situacion = p.tipo === "canje" ? "compró en 2025 y no en 2026 (canje)"
    : p.tipo === "recuperar" ? `no compra desde ${p.ultimo_anio ?? "hace años"} (recuperar)`
    : p.tipo === "bienvenida" ? "nunca compró (bienvenida)" : "compró este año (catálogo)";
  const resumen = p.tipo === "recuperar"
    ? `⚠ URGENTE — 📞 RECUPERAR: llamalo por teléfono y armá una reunión personalizada. Trabajá por qué dejó de comprar (último año ${p.ultimo_anio ?? "?"}). ${p.label} (${p.cod}) volvió a escribir por el aviso Diferenciarte v2; IRIS le mandó su catálogo con bono: ${p.link}`
    : p.llamada
      ? `⚠ URGENTE — 📞 LLAMAR, requiere atención especial. ${p.label} (${p.cod}) entró por el aviso Diferenciarte v2. Situación: ${situacion}. IRIS le mandó: ${p.link}`
      : `${p.label} (${p.cod}) entró por el aviso Diferenciarte v2. Situación: ${situacion}. IRIS le mandó: ${p.link} (con bono 5% por catálogo). Seguilo.`;
  await supabase.from("derivaciones").insert({
    conversacion_id: conversacionId, motivo: p.tipo === "recuperar" ? "recuperar_llamada" : p.llamada ? "llamada_especial" : "lead_propuesta",
    resumen: resumen.slice(0, 480), estado: "pendiente", tipo_cliente: "mayorista", asignado_a: await vendedorId(p.vendedor),
  });
  await guardarFlujo(conversacionId, { paso: "propuesta", cod_cliente: p.cod, tipo: "optica" });
  return { texto: textoPropuesta(p, vendTel) };
}

async function altaProspecto(f: FlujoDif, tel: string | null, contactoId: string): Promise<RespuestaBot> {
  const { data } = await supabase.rpc("bot_alta_diferenciarte", {
    p_tel: tel, p_optica: f.nombre_optica, p_contacto: f.contacto_nombre, p_localidad: f.localidad, p_provincia: f.provincia,
    p_email: f.email && f.email !== "-" ? f.email : null, p_cuit: f.cuit && f.cuit !== "-" ? f.cuit : null,
    p_conversacion: f.conversacion_id, p_cod: null,
  });
  const a = data as { ok: boolean; cod: string; link_propuesta: string; link_catalogo: string } | null;
  if (!a?.ok) {
    await supabase.from("derivaciones").insert({ conversacion_id: f.conversacion_id, motivo: "alta_fallida",
      resumen: `No se pudo dar de alta a "${f.nombre_optica}" (${f.localidad}, ${f.provincia}). Revisar y mandar propuesta a mano.`, estado: "pendiente", tipo_cliente: "mayorista",
      asignado_a: await vendedorId("Corporativo") });
    return { texto: `Gracias 🙌 Estoy terminando de preparar tu propuesta; Gastón ${cuando()} con el link.` };
  }
  await supabase.from("contactos").update({ cod_cliente: a.cod, tipo_cliente: "mayorista" }).eq("id", contactoId);
  await guardarFlujo(f.conversacion_id, { paso: "propuesta", cod_cliente: a.cod });
  const wspG = "5491131147946";
  return { texto:
    `¡Listo${f.contacto_nombre ? ", " + f.contacto_nombre : ""}! 🎉 Esta es tu propuesta exclusiva de bienvenida para *${f.nombre_optica}*:\n${a.link_propuesta}\n\n` +
    `Y tu catálogo con precios de óptica y stock al día, para armar el pedido directo:\n${a.link_catalogo}\n\n${TXT_BENEFICIOS}\n\n` +
    `Tu vendedor es *Gastón* — WhatsApp ${telLeg(wspG)} (wa.me/${wspG}). Vas a poder estar en contacto con él en todo lo relacionado a tu pedido 🙌` };
}

async function avisarDistribuidor(f: FlujoDif, tel: string | null, dist: { nombre: string; telefono: string }): Promise<RespuestaBot> {
  await supabase.rpc("bot_ingresar_prospecto", { p_tel: tel, p_nombre: f.nombre_optica, p_canal: "meta_b2b", p_temperatura: "tibia", p_conversacion: f.conversacion_id, p_vendedor: "Corporativo" });
  await supabase.from("prospeccion_social").update({ nota: `Zona de distribuidor (${dist.nombre}) — se le pasaron sus datos. Diferenciarte v2.`, zona: `${f.localidad ?? ""}, ${f.provincia ?? ""}` })
    .eq("conversacion_id", f.conversacion_id);
  await guardarFlujo(f.conversacion_id, { paso: "listo" });
  return { texto: `¡Gracias${f.contacto_nombre ? ", " + f.contacto_nombre : ""}! 🙌 Tu zona la atiende nuestro distribuidor oficial *${dist.nombre}*. Escribiles al WhatsApp wa.me/${telNorm(dist.telefono)} y te asesoran con toda la colección Orbital, con Triple Protección.` };
}

// Sigue pidiendo datos o, si ya están todos, da el alta. Revisa distribuidor apenas hay provincia.
async function avanzarDatos(f: FlujoDif, tel: string | null, contactoId: string, prefijo = ""): Promise<RespuestaBot> {
  if (f.provincia) {
    const { data: d } = await supabase.rpc("bot_distribuidor_de", { p_provincia: f.provincia, p_texto: f.localidad ?? "" });
    if (d) return avisarDistribuidor(f, tel, d as { nombre: string; telefono: string });
  }
  const campo = proximoDato(f);
  if (!campo) return altaProspecto(f, tel, contactoId);
  await guardarFlujo(f.conversacion_id, { paso: "datos", campo_pedido: campo });
  return { texto: prefijo + preguntaDato(campo) };
}

async function ubicar(localidadTexto: string): Promise<{ localidad: string; provincia: string | null; ambigua: boolean }> {
  const localidad = localidadTexto.split(/[,(]/)[0].replace(/^\s*(estoy|estamos|somos|soy|queda|quedamos)?\s*(en|de)\s+/i, "").trim().slice(0, 80);
  let provincia = provinciaEnTexto(localidadTexto);
  let ambigua = false;
  if (!provincia) {
    const ps = await provinciasDeLocalidad(localidadTexto);
    if (ps.length === 1) provincia = ps[0] === "Ciudad Autónoma de Buenos Aires" ? "CABA" : ps[0];
    else if (ps.length > 1) ambigua = true;
    else {
      const { data: z } = await supabase.rpc("bot_vendedor_por_zona", { p_texto: localidadTexto, p_provincia: null });
      const zz = z as { resuelto: boolean; provincia?: string } | null;
      if (zz?.resuelto && zz.provincia) provincia = zz.provincia;
    }
  }
  return { localidad: localidad || localidadTexto.slice(0, 80), provincia, ambigua };
}

async function faqDiferenciarte(f: FlujoDif, texto: string): Promise<string | null> {
  const partes: string[] = [];
  if (RE_MINIMO.test(texto)) partes.push(TXT_MINIMO);
  if (RE_FORMA_PAGO.test(texto)) partes.push(TXT_PAGO);
  // Antes de saber si es óptica, una pregunta de precio o bono es de consumidor final (va a la tienda).
  const b2b = f.tipo !== "consumidor" && f.paso !== "pide_tipo" && f.paso !== "consumidor";
  if (RE_BONO.test(texto) && b2b) partes.push(TXT_BONO);
  if (RE_VER_PRECIOS.test(texto) && b2b) {
    const l = f.cod_cliente ? await linksDeToken(f.cod_cliente) : null;
    partes.push(l ? `Acá tenés tu catálogo con precios de óptica y stock al día:\n${l.catalogo}` : "Te paso el catálogo con precios de óptica apenas tenga un par de datos tuyos, así queda armado exclusivo para tu óptica 🙌");
  }
  return partes.length ? partes.join("\n\n") : null;
}

// ── ¿Dónde consigo / pruebo este modelo? (sirve para CUALQUIER contacto, no solo la campaña) ──
// 1) sucursal de consigna que TIENE el modelo (stock real) · 2) óptica de la zona que lo compró este
// año (comprobantes Tango + pedidos de la Suite) · 3) la zona, para saber dónde se vende Orbital.
// A las sucursales de consigna que le pasamos al cliente les queda la consulta en su panel.
async function dondeConseguir(conversacionId: string, texto: string, tel: string | null, nombre: string | null, ingles = false): Promise<RespuestaBot | null> {
  const modelos = (await cotizarFull(conversacionId, texto, 5)).map((m) => m.modelo).slice(0, 3);
  const { data: sc } = await supabase.rpc("bot_sucursal_consigna_cercana", { p_texto: texto, p_modelos: modelos });
  const consigna = (sc ?? []) as { sucursal_id: number; nombre: string; direccion: string; localidad: string; modelos: string | null }[];
  const conStock = consigna.filter((s) => s.modelos);
  const { data: om } = await supabase.rpc("bot_optica_con_modelo", { p_texto: texto, p_modelos: modelos });
  const compraron = (om ?? []) as { nombre: string; direccion: string; localidad: string; modelos: string }[];
  const { data: op } = await supabase.rpc("bot_optica_cercana", { p_texto: texto });
  const zona = (op ?? []) as { nombre: string; direccion: string; localidad: string }[];
  const lista = [...conStock, ...compraron, ...consigna.filter((s) => !s.modelos), ...zona].slice(0, 3);
  if (!lista.length) return null;
  for (const s of consigna.filter((x) => lista.includes(x))) {
    const { error } = await supabase.rpc("consigna_consulta_registrar", {
      p_sucursal_id: s.sucursal_id, p_modelo: s.modelos, p_codigo: null, p_mensaje: texto.slice(0, 400),
      p_cliente_nombre: nombre, p_cliente_tel: tel, p_canal: null, p_conversacion_id: conversacionId,
    });
    if (error) console.error("consigna_consulta_registrar", error.message);
  }
  const enc = ingles
    ? "You can find our products at:"
    : conStock[0] ? `Tenemos ${conStock[0].modelos} para que te lo pruebes en:`
    : compraron[0] ? `Podés preguntar por ${compraron[0].modelos} en:`
    : "Podés encontrar nuestros productos en:";
  const cierre = ingles ? `\n\nYou can also buy online at ${TIENDA} 🙌` : `\n\nTambién podés comprar online en ${TIENDA} 🙌`;
  return { texto: `${enc}\n${lista.map((o) => `📍 *${o.nombre}* — ${o.direccion}, ${o.localidad}`).join("\n")}${cierre}` };
}

async function flujoDiferenciarte(conversacionId: string, contactoId: string, texto: string, tel: string | null, cod: string | null, esLead: boolean, yaHablamos: boolean): Promise<RespuestaBot | null> {
  const { data: fl } = await supabase.from("bot_lead_flujo").select("*").eq("conversacion_id", conversacionId).maybeSingle();
  let f = fl as FlujoDif | null;
  const corto = !texto.includes("?") && texto.trim().split(/\s+/).length <= 14;

  // ── Entrada ──
  if (!f) {
    const form = await leadFormulario(tel);
    if (form) {
      // Lead del formulario B2B: ya recibió la plantilla que pide nombre de la óptica y zona, y trae datos del form.
      const ini = { conversacion_id: conversacionId, paso: form.es_optica === false ? "pide_tipo" : "pide_nombre", campana: CAMPANA_FORM,
        tipo: form.es_optica === false ? null : "optica", telefono: tel, contacto_nombre: form.nombre || null, email: form.email || null,
        localidad: form.localidad || null, provincia: form.provincia || null };
      await supabase.from("bot_lead_flujo").insert(ini);
      f = { ...ini, nombre_optica: null, cuit: null, campo_pedido: null, cod_cliente: null, zona_texto: null, creado_en: new Date().toISOString() } as FlujoDif;
      if (cod) { const r = await cerrarConPropuesta(conversacionId, contactoId, cod); if (r) return r; }
      if (f.paso === "pide_nombre") await supabase.from("contactos").update({ tipo_cliente: "mayorista" }).eq("id", contactoId);
      // sigue abajo procesando este mismo mensaje (suele ser el nombre de la óptica)
    } else {
    if (!(await esLeadDiferenciarte(esLead, tel))) return null;
    if (yaHablamos && !RE_EX_VENDEDOR.test(texto)) return null;  // charla empezada antes de este flujo
    await supabase.from("bot_lead_flujo").insert({ conversacion_id: conversacionId, paso: "pide_tipo", campana: CAMPANA, telefono: tel });
    f = { conversacion_id: conversacionId, paso: "pide_tipo", campana: CAMPANA, tipo: null, nombre_optica: null, contacto_nombre: null, localidad: null,
      provincia: null, email: null, cuit: null, campo_pedido: null, cod_cliente: null, zona_texto: null, creado_en: new Date().toISOString() };
    if (cod) {
      const r = await cerrarConPropuesta(conversacionId, contactoId, cod);
      if (r) return r;
    }
    if (RE_PIDE_VENDEDOR.test(texto)) return pideVendedor(f, texto, tel, contactoId);
    if (RE_EX_VENDEDOR.test(texto) || detectarTipo(texto) === "mayorista") {
      await supabase.from("contactos").update({ tipo_cliente: "mayorista" }).eq("id", contactoId);
      await guardarFlujo(conversacionId, { paso: "pide_nombre", tipo: "optica" });
      return { texto: "¡Qué bueno! 🙌 ¿Cómo se llama tu óptica? Así me fijo si ya trabajamos juntos." };
    }
    return { texto: await cfgTexto("iris_speech_diferenciarte", SPEECH_DEF), quickReplies: ["Sí, tengo óptica", "Soy consumidor final"] };
    }
  }
  if (!CAMPANAS.includes(f.campana ?? "") && f.paso !== "pide_cuit") return null;

  // ── Pide un vendedor: primero se confirma que sea óptica y se lo pasa directo al vendedor ──
  if (f.campo_pedido === "vend_confirma_optica" || f.campo_pedido === "vend_zona" || (RE_PIDE_VENDEDOR.test(texto) && f.paso !== "pide_cuit")) {
    const pv = await pideVendedor(f, texto, tel, contactoId);
    if (pv) return pv;
  }
  if (f.paso === "listo") return null;

  // ── CUIT pedido después del pedido ──
  if (f.paso === "pide_cuit") {
    const m = texto.match(RE_CUIT);
    if (m && f.cod_cliente) {
      await supabase.from("clientes").update({ cuit: `${m[1]}-${m[2]}-${m[3]}` }).eq("cod", f.cod_cliente);
      await guardarFlujo(conversacionId, { paso: "propuesta", cuit: m[0] });
      return { texto: "¡Gracias! Ya quedó cargado tu CUIT ✅ Con esto cerramos tu alta como cliente 🙌" };
    }
    if (corto && !RE_NO_DATO.test(texto)) return { texto: "¿Me lo pasás con los 11 números? (ej. 30-12345678-9)" };
    return null;
  }

  // ── Volvió a tocar el anuncio: se retoma donde estaba ──
  if (RE_PREFILL_ANUNCIO.test(texto)) {
    if (f.paso === "propuesta" && f.cod_cliente) {
      const l = await linksDeToken(f.cod_cliente);
      if (l) return { texto: `¡Acá sigo! 🙌 Te dejo de nuevo tu propuesta y tu catálogo:\n${l.propuesta}\n${l.catalogo}` };
    }
    const pend = f.paso === "consumidor" ? "¿Te gustó algún anteojo en particular? 😎" : preguntaPendiente(f);
    if (pend) return { texto: `¡Acá sigo! 🙌 ${pend}` };
    return null;
  }

  // ── Preguntas directas (se contestan en cualquier paso y se retoma lo pendiente) ──
  const faq = await faqDiferenciarte(f, texto);
  if (faq) {
    const pend = f.paso === "propuesta" ? "" : preguntaPendiente(f);
    return { texto: pend ? `${faq}\n\n${pend}` : faq };
  }

  // ── Consumidor final ──
  // Si a "¿tenés una óptica?" no contestan sí/no y preguntan algo ("En blancos para mujer"), es un consumidor final
  // preguntando por lo que vio en el aviso: se lo manda a la tienda. Igual, por las dudas, siempre se le pregunta si
  // tiene una óptica; si dice que sí, pasa al circuito mayorista.
  const trTipo = f.paso === "pide_tipo" ? tipoRespuesta(texto) : null;
  const consultaProducto = f.paso === "pide_tipo" && trTipo === null && !RE_SOLO_SALUDO.test(texto);
  if (f.paso === "consumidor" && f.tipo !== "consumidor" && RE_DICE_OPTICA.test(texto)) {
    await guardarFlujo(conversacionId, { paso: "pide_nombre", tipo: "optica", campo_pedido: null });
    await supabase.from("contactos").update({ tipo_cliente: "mayorista" }).eq("id", contactoId);
    return { texto: "¡Genial! 🙌 ¿Cómo se llama tu óptica? Así me fijo si ya trabajamos juntos." };
  }
  if (f.paso === "consumidor" || trTipo === "consumidor" || consultaProducto) {
    // tipo 'consumidor' = lo dijo; paso consumidor con tipo null = lo inferimos y seguimos preguntando si es óptica.
    const inferido = trTipo !== "consumidor" && f.tipo !== "consumidor";
    const yOptica = inferido ? "\n\nAh, y por las dudas: ¿tenés una óptica? Si es así, avisame y te paso la propuesta mayorista 🙌" : "";
    if (f.paso !== "consumidor") {
      await guardarFlujo(conversacionId, { paso: "consumidor", tipo: trTipo === "consumidor" ? "consumidor" : null });
      await supabase.from("contactos").update({ tipo_cliente: "minorista" }).eq("id", contactoId);
      if (trTipo === "consumidor") return { texto: "¡Perfecto! 😎 ¿Te gustó algún anteojo en particular?" };
    }
    // "ofreci_optica": le ofrecimos una óptica tras consultar un modelo; si contesta corto con la localidad, se la pasamos.
    const respondeLocalidad = f.campo_pedido === "ofreci_optica" && corto;
    if (RE_DONDE_PROBAR.test(texto) || f.campo_pedido === "localidad_prueba" || respondeLocalidad) {
      const { localidad } = await ubicar(texto);
      const donde = await dondeConseguir(conversacionId, texto, tel, f.contacto_nombre);
      if (donde) {
        await guardarFlujo(conversacionId, { campo_pedido: null, localidad });
        return { texto: donde.texto + yOptica };
      }
      if (respondeLocalidad && !RE_DONDE_PROBAR.test(texto)) {
        // no era una localidad con óptica: se sigue la charla normal
        await guardarFlujo(conversacionId, { campo_pedido: null });
      } else if (f.campo_pedido !== "localidad_prueba") {
        await guardarFlujo(conversacionId, { campo_pedido: "localidad_prueba" });
        return { texto: "¡Dale! ¿En qué localidad estás? Así te paso una óptica cerca donde probarlos 🙂" };
      } else {
        await guardarFlujo(conversacionId, { campo_pedido: null });
        return { texto: `Todavía no tengo una óptica cargada en tu zona 🙏 Podés ver toda la colección y comprar online en ${TIENDA}, con envío a todo el país.` + yOptica };
      }
    }
    const nombres = (await cotizarFull(conversacionId, texto, 5)).map((m) => m.modelo).slice(0, 3);
    if (nombres.length) {
      await guardarFlujo(conversacionId, { campo_pedido: "ofreci_optica" });
      return { texto: `¡Buena elección! 😎 Lo encontrás acá:\n${nombres.map((n) => `• ${n}: ${TIENDA}/search?q=${encodeURIComponent(n.toLowerCase())}`).join("\n")}\n\nSi querés probarlo antes, decime en qué localidad estás y te paso una óptica cerca.` + yOptica };
    }
    const q = palabrasBusqueda(texto);
    if (q) return { texto: `¡Te ayudo! 😎 Mirá lo que tenemos:\n${TIENDA}/search?q=${encodeURIComponent(q)}\n\nSi te gusta alguno y querés probarlo antes, decime en qué localidad estás y te paso una óptica cerca.` + yOptica };
    if (corto || consultaProducto) return { texto: `Podés ver toda la colección y comprar online en ${TIENDA} 🙌 Si querés probarlos antes, decime en qué localidad estás y te paso una óptica cerca.` + yOptica };
    return null;
  }

  // ── ¿Tenés óptica? ──
  if (f.paso === "pide_tipo") {
    if (trTipo === "optica") {
      await guardarFlujo(conversacionId, { paso: "pide_nombre", tipo: "optica" });
      await supabase.from("contactos").update({ tipo_cliente: "mayorista" }).eq("id", contactoId);
      return { texto: "¡Genial! 🙌 ¿Cómo se llama tu óptica? Así me fijo si ya trabajamos juntos." };
    }
    return corto ? { texto: "¿Tenés una óptica o sos consumidor final? 🙂", quickReplies: ["Sí, tengo óptica", "Soy consumidor final"] } : null;
  }
  if (!corto && f.paso !== "propuesta") return null;

  // ── Nombre de la óptica → ¿ya es cliente? ──
  if (f.paso === "pide_nombre") {
    if (RE_SOLO_SALUDO.test(texto) || RE_PREFILL_ANUNCIO.test(texto)) return { texto: "¡Hola! 👋 ¿Cómo se llama tu óptica? Así me fijo si ya trabajamos juntos." };
    // Aclara que es consumidor final ("soy consumidor final", "no tengo óptica"): NO es el nombre de la óptica.
    // Sin esto se lo buscaba como cliente y podía cerrar con una propuesta mayorista.
    if (detectarTipo(texto) === "minorista" || /no tengo (una |un )?([oó]ptica|local|negocio|comercio)/i.test(texto)) {
      await guardarFlujo(conversacionId, { paso: "consumidor", tipo: "consumidor", campo_pedido: null });
      await supabase.from("contactos").update({ tipo_cliente: "minorista" }).eq("id", contactoId);
      return { texto: `¡Perfecto! 😎 Podés ver toda la colección y comprar online en ${TIENDA}. Si querés probarlos antes, decime en qué localidad estás y te paso una óptica cerca.` };
    }
    // "Óptica Sol, Rafaela": nombre y zona en el mismo mensaje (la plantilla del formulario pide las dos cosas).
    const [nomParte, ...resto] = texto.split(/\s*[,\n]\s*|\s+-\s+/);
    const zonaParte = resto.join(", ").trim();
    const nombre = nomParte.replace(/^\s*(se llama|es|somos|la [oó]ptica (se llama|es))\s+/i, "").trim().slice(0, 120);
    if (zonaParte && !f.localidad) {
      const u = await ubicar(zonaParte);
      f.localidad = u.localidad; f.provincia = f.provincia ?? u.provincia;
      await guardarFlujo(conversacionId, { localidad: f.localidad, provincia: f.provincia });
    }
    const { data: b0 } = await supabase.rpc("bot_buscar_optica", { p_nombre: nombre, p_zona: null });
    let r = b0 as { ok: boolean; cod?: string; motivo?: string } | null;
    if (r?.motivo === "ambiguo" && (zonaParte || f.localidad)) {
      const { data: b1 } = await supabase.rpc("bot_buscar_optica", { p_nombre: nombre, p_zona: zonaParte || f.localidad });
      if ((b1 as { ok: boolean } | null)?.ok) r = b1 as { ok: boolean; cod?: string; motivo?: string };
    }
    if (r?.ok && r.cod) { const p = await cerrarConPropuesta(conversacionId, contactoId, r.cod); if (p) return p; }
    f.nombre_optica = nombre;
    if (r?.motivo === "ambiguo") {
      await guardarFlujo(conversacionId, { paso: "pide_zona", nombre_optica: nombre });
      return { texto: "Encontré varias ópticas con ese nombre 🔎 ¿En qué localidad está la tuya?" };
    }
    await guardarFlujo(conversacionId, { nombre_optica: nombre });
    return avanzarDatos(f, tel, contactoId,
      "Te voy a pedir un par de datos para pasarte el link exclusivo de tu propuesta y el catálogo de productos. Va a ser tu propuesta y catálogo de uso exclusivo, para esta compra y para las futuras 🙌\n\n");
  }

  // ── Desempate por localidad ──
  if (f.paso === "pide_zona") {
    const { data: b } = await supabase.rpc("bot_buscar_optica", { p_nombre: f.nombre_optica, p_zona: texto });
    const r = b as { ok: boolean; cod?: string } | null;
    if (r?.ok && r.cod) { const p = await cerrarConPropuesta(conversacionId, contactoId, r.cod); if (p) return p; }
    const u = await ubicar(texto);
    f.localidad = u.localidad; f.provincia = u.provincia;
    await guardarFlujo(conversacionId, { localidad: u.localidad, provincia: u.provincia });
    return avanzarDatos(f, tel, contactoId,
      "No la encuentro en el sistema, así que te preparo una propuesta nueva. Te voy a pedir un par de datos para pasarte el link exclusivo de tu propuesta y el catálogo 🙌\n\n");
  }

  // ── Datos del prospecto ──
  if (f.paso === "datos") {
    const email = texto.match(RE_EMAIL)?.[0];
    const cuit = texto.match(RE_CUIT);
    if (email) f.email = email.toLowerCase();
    if (cuit) f.cuit = `${cuit[1]}-${cuit[2]}-${cuit[3]}`;
    switch (f.campo_pedido) {
      case "contacto":
        if (!email && !cuit) f.contacto_nombre = texto.replace(/^\s*(soy|me llamo|mi nombre es|habla|hablás con|hablas con)\s+/i, "").trim().slice(0, 60);
        break;
      case "localidad": {
        const u = await ubicar(texto);
        f.localidad = u.localidad; f.provincia = u.provincia;
        if (u.ambigua) { await guardarFlujo(conversacionId, { localidad: u.localidad, campo_pedido: "provincia" }); return { texto: preguntaDato("provincia") }; }
        break;
      }
      case "provincia":
        f.provincia = provinciaEnTexto(texto) ?? texto.trim().slice(0, 40);
        break;
      case "email":
        if (!email) f.email = RE_NO_DATO.test(texto) ? "-" : null;
        if (!email && !f.email) return { texto: "¿Me lo pasás con el formato nombre@dominio.com? Si no tenés, decime \"no tengo\" y seguimos." };
        break;
      case "cuit":
        if (!cuit) f.cuit = "-";
        break;
    }
    await guardarFlujo(conversacionId, { contacto_nombre: f.contacto_nombre, localidad: f.localidad, provincia: f.provincia, email: f.email, cuit: f.cuit });
    return avanzarDatos(f, tel, contactoId);
  }
  return null;
}
const PROVINCIAS: [RegExp, string][] = [
  [/\b(caba|capital federal|ciudad aut[oó]noma)\b/, "CABA"], [/\bbuenos aires\b|\bbs\.? ?as\b|\bprov(incia)? de bs/, "Buenos Aires"],
  [/\bcatamarca\b/, "Catamarca"], [/\bchaco\b/, "Chaco"], [/\bchubut\b/, "Chubut"], [/\bc[oó]rdoba\b|\bcba\b/, "Córdoba"],
  [/\bcorrientes\b/, "Corrientes"], [/\bentre r[ií]os\b/, "Entre Ríos"], [/\bformosa\b/, "Formosa"], [/\bjujuy\b/, "Jujuy"],
  [/\bla pampa\b/, "La Pampa"], [/\bla rioja\b/, "La Rioja"], [/\bmendoza\b/, "Mendoza"], [/\bmisiones\b/, "Misiones"],
  [/\bneuqu[eé]n\b/, "Neuquén"], [/\br[ií]o negro\b/, "Río Negro"], [/\bsalta\b/, "Salta"], [/\bsan juan\b/, "San Juan"],
  [/\bsan luis\b/, "San Luis"], [/\bsanta cruz\b/, "Santa Cruz"], [/\bsanta fe\b/, "Santa Fe"],
  [/\bsantiago del estero\b|\bstgo\.? del estero\b/, "Santiago del Estero"], [/\btierra del fuego\b|\bushuaia\b/, "Tierra del Fuego"],
  [/\btucum[aá]n\b/, "Tucumán"],
];
function provinciaEnTexto(t: string): string | null {
  const s = t.toLowerCase();
  for (const [re, p] of PROVINCIAS) if (re.test(s)) return p;
  return null;
}
// Provincias posibles de una localidad según Georef (datos.gob.ar). Solo nombres exactos.
async function provinciasDeLocalidad(texto: string): Promise<string[]> {
  const lugar = norm(texto.split(/[,(]/)[0]
    .replace(/^\s*(hola[,!. ]*)?(estoy|estamos|soy|somos|queda|quedamos|la [oó]ptica (est[aá]|queda))?\s*(en|de)?\s*(la\s+)?(zona|ciudad|localidad)?\s*(de\s+)?/i, "")).trim();
  if (lugar.length < 3) return [];
  try {
    const r = await fetch(`https://apis.datos.gob.ar/georef/api/localidades?nombre=${encodeURIComponent(lugar)}&max=20&campos=nombre,provincia.nombre`, { signal: AbortSignal.timeout(4000) });
    const j = await r.json() as { localidades?: { nombre: string; provincia: { nombre: string } }[] };
    const exactas = (j.localidades ?? []).filter((l) => norm(l.nombre) === lugar);
    return [...new Set(exactas.map((l) => l.provincia.nombre))];
  } catch { return []; }
}
interface ZonaVend { resuelto: boolean; vendedor: string; zona: string; provincia?: string; territorio_propio?: boolean; }
// null = hay que preguntar la provincia.
async function resolverZona(texto: string, provinciaDicha: string | null, yaPregunte: boolean): Promise<ZonaVend | null> {
  let prov = provinciaDicha ?? provinciaEnTexto(texto);
  if (!prov) {
    const ps = await provinciasDeLocalidad(texto);
    if (ps.length === 1) prov = ps[0] === "Ciudad Autónoma de Buenos Aires" ? "CABA" : ps[0];
    else if (ps.length > 1 && !yaPregunte) return null;
  }
  const { data } = await supabase.rpc("bot_vendedor_por_zona", { p_texto: texto, p_provincia: prov });
  const z = data as ZonaVend | null;
  if (z?.resuelto) return z;
  if (!yaPregunte) return null;
  return { resuelto: true, vendedor: "Adrian", zona: "Interior (sin provincia)" };
}

async function vendedorDeCliente(cod: string | null): Promise<string> {
  if (!cod) return VENDEDOR_LEADS;
  const { data } = await supabase.from("clientes").select("vendedor_asignado").eq("cod", cod).maybeSingle();
  const v = (data as { vendedor_asignado: string | null } | null)?.vendedor_asignado;
  return v && v.trim() ? v : VENDEDOR_LEADS;
}

function triSet(s: string): Set<string> {
  const x = "  " + s.toLowerCase().replace(/[^a-z0-9áéíóúñ]+/g, " ").trim() + "  ";
  const g = new Set<string>();
  for (let i = 0; i < x.length - 2; i++) g.add(x.slice(i, i + 3));
  return g;
}
function triSim(a: string, b: string): number {
  const A = triSet(a), B = triSet(b); if (!A.size || !B.size) return 0;
  let inter = 0; for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}
function asignarCantidades(items: ItemCoti[], texto: string): void {
  const segs = [...texto.matchAll(/(\d{1,3})\s+([^\d\n]{2,})/gi)];
  for (const s of segs) {
    const qty = parseInt(s[1], 10); const phrase = (s[2] || "").trim();
    if (!qty || qty > 500 || phrase.length < 3) continue;
    let best: ItemCoti | null = null, bestSim = 0;
    for (const it of items) { const sm = triSim(phrase, it.modelo); if (sm > bestSim) { bestSim = sm; best = it; } }
    if (best && bestSim >= 0.3) best.objetivo = qty;
  }
}
function parseAlloc(texto: string, it: ItemCoti): Alloc[] {
  const t = " " + texto.toLowerCase().replace(/\s+/g, " ") + " ";
  const n = it.colores.length;
  const map = new Map<number, number>();
  let m: RegExpExecArray | null;
  const re1 = /(\d+)\s*(?:del|de|x)\s*(\d+)/g;
  let used = false;
  while ((m = re1.exec(t))) { const q = +m[1], c = +m[2]; if (c >= 1 && c <= n) { map.set(c - 1, (map.get(c - 1) || 0) + q); used = true; } }
  if (used) return toAlloc(map, it);
  const re2 = /(\d+)\s+([a-záéíóúñ]{3,})/g;
  while ((m = re2.exec(t))) { const q = +m[1], w = m[2]; const ci = it.colores.findIndex((c) => c.toLowerCase().includes(w)); if (ci >= 0) { map.set(ci, (map.get(ci) || 0) + q); used = true; } }
  if (used) return toAlloc(map, it);
  const only = texto.match(/\b(\d+)\b/);
  if (only) { const c = +only[1]; if (c >= 1 && c <= n) return [{ color: it.colores[c - 1], qty: it.objetivo || 1 }]; }
  const ci = it.colores.findIndex((c) => { const w = c.toLowerCase().split(/[\s/]+/).filter((x) => x.length >= 4); return w.some((x) => t.includes(x)); });
  if (ci >= 0) return [{ color: it.colores[ci], qty: it.objetivo || 1 }];
  return [];
}
function toAlloc(map: Map<number, number>, it: ItemCoti): Alloc[] {
  const r: Alloc[] = [];
  for (const [ci, q] of [...map.entries()].sort((a, b) => a[0] - b[0])) if (q > 0) r.push({ color: it.colores[ci], qty: q });
  return r;
}

const RE_RASTREO = /\b(rastre|seguimiento|segu[ií]|d[oó]nde est[aá]|donde esta|mi (pedido|env[ií]o|envio|paquete|compra|orden)|estado (de|del) (mi )?pedido|cu[aá]ndo (llega|me llega)|tracking|n[uú]mero de seguimiento|estado de mi|track|where is my)/i;
const RE_ATRIB = /\b(cu[aá]les|qu[eé] modelos|modelos (con|que|tienen|de|hay|son)|list[aá] de modelos|todos los modelos|mostrame los modelos)\b/i;
const RE_MEDIDA = /\b(medida|mide|tama[ñn]o|cm|formato|forma|ancho|alto|largo|calibre|varilla|puente|protecci[oó]n|infrarrojo|blue|uv|cristal|filtro|pesa|peso|material|polariz)\b/i;
const RE_COMPRA = /\b(quiero|quer[ií]a|comprar|me llevo|llevo|pedir|pedido|cotiz|arm[aá](me)?|dame|pasame|mand[aá]me|necesito|ten[eé]s|tienen|hay)\b/i;

const RE_NRO_PEDIDO = /#\s*(\d{2,8})|\b(?:pedido|orden|order|remito)\s*(?:n[°ºro.]*\s*)?(\d{2,8})\b|\bes\s+(?:el\s+)?(\d{4,6})\b/i;
const RE_POSTVENTA = /\b(mi pedido|el pedido|la compra|mi compra|que compr[eé]|lo que compr|mi orden|el env[ií]o|mi env[ií]o|ya compr[eé]|compr[eé] la semana)\b/i;
const RE_ACCESO = /(habilit\w*|desde este dispositivo|no me deja entrar|no puedo entrar|no me abre el cat|c[oó]digo de acceso|clave del cat|acceso al cat|abrir (mi )?cat[aá]logo|mi cat[aá]logo|link del cat[aá]logo|token)/i;
// Postventa de producto: algo se rompió / falló / falta una pieza. Va derecho a Postventa.
const RE_POSTVENTA_PROD = /\b(se me (rompi|quebr|parti|sali|despeg|raj)|se (rompi[oó]|quebr[oó]|parti[oó]|raj[oó]|despeg[oó]|sali[oó] (el|la|un|una)))|\b(patita|patilla|varilla|bisagra|tornillo|terminal|plaqueta|almohadilla)\b|\b(roto|rota|rotura|quebrad[oa]|flojo|floja|desarmad[oa]|fallad[oa]|defectuos[oa]|con falla|vino mal|vino fallad)\b|\b(garant[ií]a|repuesto|reemplaz\w*|recambio|cambio por (falla|rotura|defecto)|lente rayad|se ray[oó])\b/i;
const RE_NO_LLEGO = /\b(no (me )?(lleg|ha llegado|lleg[oó])|nunca (me )?lleg|todav[ií]a no (me )?(lleg|lo recib|la recib)|a[uú]n no (me )?lleg|no (lo|la|los|las) recib[ií]|no recib[ií] (mi|el|la))/i;
const RE_NO_LLEGO_OTRO = /\b(cat[aá]logo|lista|precios?|mail|correo|e-?mail|link|c[oó]digo|clave|token|factura|presupuesto|respuesta|mensaje|audio|foto)\b/i;
const RE_NEGATIVA =/\b(no (lo|los|la|las) quiero|no me interesa|ya no quiero|no quiero|cancelar|cancelo|devoluci[oó]n|devolver|reintegro|reembolso)\b/i;

const RE_FRICCION: RegExp[] = [
  /\bya (te )?(lo )?(respond|dij|cont[eé]|expliqu|pregunt|mand)/i,
  /\b(ya me lo preguntaron|te lo dije|lo dije \d+ vec|respond[ií] (todo|3 vec|dos vec)|van \d+ vec|3 veces|tres veces)/i,
  /\b(no me est[aá]s? entendiendo|no entend[eé]s|no me entend|no me le[eé]s)\b/i,
  /\b(poco serio|qu[eé] verg[üu]enza|verguenza|un desastre|p[eé]sim\w*|mal[ií]sim\w*|falta de respeto)\b/i,
  /\b(hablar con (alguien|una persona|un humano|un asesor)|persona real|atenci[oó]n humana|no un bot|un humano)\b/i,
  /\b(me est[aá]n dando vueltas|dando vueltas|nadie (me )?(contesta|responde)|no me responde nadie|desde ayer espero|no tengo paciencia)\b/i,
  /\b(defensa del consumidor|denunciar|voy a cancelar|cancelo la compra)\b/i,
];
function detectarFriccion(texto: string, cliMsgs: string[], botMsgs: string[]): boolean {
  if (RE_FRICCION.some((re) => re.test(texto))) return true;
  const t = norm(texto);
  // El mensaje precargado del anuncio se repite cada vez que tocan el aviso: no es enojo.
  if (t.length > 12 && !RE_PREFILL_ANUNCIO.test(texto) && cliMsgs.slice(0, 6).some((m) => norm(m) === t)) return true;
  if (botMsgs.length >= 2 && norm(botMsgs[0]) === norm(botMsgs[1])) return true;
  return false;
}

function extraerNombre(t: string): string | null {
  const m = t.match(/\bsoy\s+([A-ZÁÉÍÓÚÑ][\wÁ-Úá-ú]+(?:\s+[A-ZÁÉÍÓÚÑ][\wÁ-Úá-ú]+){0,3})/);
  return m ? m[1].trim() : null;
}
function extraerTracking(t: string): string | null { const m = t.match(/\b(\d{6,14})\b/); return m ? m[1] : null; }
function fFecha(v: string | null): string { if (!v) return ""; try { return new Date(v).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" }); } catch { return ""; } }
function linkTrack(url: string | null, tn: string): string { if (!url) return ""; return url.trim().endsWith("=") ? url + tn : url; }

function estadoFriendly(e: string | null): string {
  switch (e) { case "pendiente": return "recibido, en cola de preparación ⏳"; case "en_preparacion": return "en preparación 🔧"; case "observado": return "con una observación — te vamos a contactar ⚠"; case "listo": return "listo para facturar ✅"; case "facturado": return "facturado 📄"; case "listo_despachar": return "listo para despachar 📦"; case "despachado": return "despachado 🚚, en camino"; default: return e ?? "en proceso"; }
}
async function estadoPedidoCliente(cod: string): Promise<RespuestaBot | null> {
  const { data } = await supabase.from("pedidos").select("id, estado, nro_remito, nro_guia, tipo_transporte, created_at").eq("cod_cliente", cod).order("created_at", { ascending: false }).limit(1);
  const p = (data ?? [])[0] as { id: number; estado: string | null; nro_remito: string | null; nro_guia: string | null; tipo_transporte: string | null } | undefined;
  if (!p) return null;
  let txt = `Tu último pedido (#${p.id}) está: ${estadoFriendly(p.estado)}.`;
  if (p.estado === "despachado" && p.nro_guia && /\d{5,}/.test(p.nro_guia)) txt += ` Guía: ${p.nro_guia} (${p.tipo_transporte ?? "transporte"}).`;
  else if (p.nro_remito) txt += ` Remito ${p.nro_remito}.`;
  return { texto: txt };
}
async function estadoPorOrden(orden: string, telAprender?: string | null): Promise<RespuestaBot | null> {
  const on = orden.replace(/[#\s]/g, "");
  if (!on) return null;
  let pid: number | null = null;
  const { data: vs } = await supabase.from("ventas_shopify").select("order_number, pedido_id, pedido_outlet_id, fulfillment_status").or(`order_number.eq.#${on},order_number.eq.${on}`).limit(1);
  const v = (vs ?? [])[0] as { pedido_id: number | null; pedido_outlet_id: number | null } | undefined;
  if (v) pid = v.pedido_id ?? v.pedido_outlet_id ?? null;
  if (!pid && /^\d+$/.test(on)) pid = Number(on);
  if (!pid) return null;
  const { data: p } = await supabase.from("pedidos").select("id, estado, nro_guia, tipo_transporte, cod_cliente").eq("id", pid).maybeSingle();
  const ped = p as { id: number; estado: string | null; nro_guia: string | null; tipo_transporte: string | null; cod_cliente: string | null } | null;
  if (!ped) return null;
  if (telAprender) await aprenderTelefono(ped.cod_cliente, telAprender);
  let txt = `Tu pedido #${on} está: ${estadoFriendly(ped.estado)}.`;
  if (ped.nro_guia && /\d{5,}/.test(ped.nro_guia)) {
    const { data: e } = await supabase.from("envios_envia").select("tracking_number, estado, carrier_track_url").eq("tracking_number", ped.nro_guia).maybeSingle();
    const env = e as { tracking_number: string; estado: string; carrier_track_url: string | null } | null;
    if (env) { txt += ` Envío ${env.tracking_number}: ${env.estado}.`; const l = linkTrack(env.carrier_track_url, env.tracking_number); if (l) txt += `\nSeguilo: ${l}`; }
    else txt += ` Guía: ${ped.nro_guia} (${ped.tipo_transporte ?? "transporte"}).`;
  }
  return { texto: txt };
}

// "No me llegó el pedido" sin número: el consumidor final no tiene cod_cliente, pero su compra de
// Shopify guarda el teléfono. Se busca la última y se responde con el estado real que tiene en la Suite.
async function estadoPorTelefono(tel: string | null): Promise<RespuestaBot | null> {
  if (!tel) return null;
  const { data } = await supabase.rpc("bot_pedido_por_telefono", { p_tel: tel });
  const p = data as {
    orden: string | null; fecha: string | null; fulfillment: string | null; financial: string | null;
    pedido_id: number | null; estado: string | null; nro_remito: string | null; nro_guia: string | null;
    tipo_transporte: string | null; track_estado: string | null; track_url: string | null; tracking: string | null;
  } | null;
  if (!p || !p.orden) return null;
  const orden = p.orden.replace(/^#/, "");
  let txt = p.estado
    ? `Te busqué por tu número 🙌 Tu pedido ${orden} (${fFecha(p.fecha)}) está: ${estadoFriendly(p.estado)}.`
    : `Te busqué por tu número 🙌 Tu pedido ${orden} (${fFecha(p.fecha)}) está confirmado y entra en preparación ⏳.`;
  if (p.tracking && p.track_estado) {
    txt += ` Envío ${p.tracking}: ${p.track_estado}.`;
    const l = linkTrack(p.track_url, p.tracking);
    if (l) txt += `\nSeguilo: ${l}`;
  } else if (p.nro_guia && /\d{5,}/.test(p.nro_guia)) {
    txt += ` Guía: ${p.nro_guia} (${p.tipo_transporte ?? "transporte"}).`;
  } else if (p.nro_remito) {
    txt += ` Remito ${p.nro_remito}.`;
  }
  return { texto: txt + "\n¿Es ese el pedido que esperabas?" };
}

async function identificarPorTelefono(contactoId: string, tel: string | null): Promise<{ cod: string; nuevo: boolean } | null> {
  if (!tel) return null;
  const t = tel.replace(/\D/g, "").slice(-10);
  if (t.length < 8) return null;
  const { data } = await supabase.from("clientes").select("cod").or(`telefono.ilike.%${t}%,whatsapp.ilike.%${t}%`).limit(1);
  const c = (data ?? [])[0] as { cod: string } | undefined;
  if (!c) return null;
  await supabase.from("contactos").update({ cod_cliente: c.cod, tipo_cliente: "mayorista" }).eq("id", contactoId);
  return { cod: c.cod, nuevo: true };
}
async function resumenActividad(cod: string): Promise<string> {
  const { data } = await supabase.from("pedidos").select("id, estado, created_at").eq("cod_cliente", cod).order("created_at", { ascending: false }).limit(6);
  const rows = ((data ?? []) as { id: number; estado: string | null }[]).filter((p) => p.estado && p.estado !== "despachado");
  if (!rows.length) return "";
  return "📋 En curso: " + rows.map((r) => `#${r.id} (${estadoFriendly(r.estado)})`).join(" · ");
}
async function aprenderTelefono(cod: string | null, tel: string | null): Promise<void> {
  if (!cod || !tel || ["888888", "888889"].includes(cod)) return;
  const t = tel.replace(/\D/g, "");
  if (t.length < 8) return;
  const { data } = await supabase.from("clientes").select("cod, telefono, whatsapp").eq("cod", cod).maybeSingle();
  const c = data as { telefono: string | null; whatsapp: string | null } | null;
  if (c && !c.telefono && !c.whatsapp) await supabase.from("clientes").update({ whatsapp: tel }).eq("cod", cod);
}
async function chequearStockColores(texto: string, ingles: boolean): Promise<RespuestaBot | null> {
  const { data } = await supabase.rpc("stock_colores_en_mensaje", { p_texto: texto });
  const rows = (data ?? []) as { modelo: string; colores: string[] }[];
  if (!rows.length) return null;
  const partes: string[] = [];
  for (const r of rows) {
    const cols = (r.colores ?? []).filter(Boolean);
    if (cols.length) partes.push(ingles ? `${r.modelo}: available in ${cols.join(", ")}.` : `El ${r.modelo} lo tengo disponible en: ${cols.join(", ")}.`);
    else partes.push(ingles ? `${r.modelo}: out of stock right now.` : `El ${r.modelo} por ahora no tiene stock 😕.`);
  }
  const hayAlguno = rows.some((r) => (r.colores ?? []).filter(Boolean).length);
  const cierre = hayAlguno ? (ingles ? " Want an advisor to prepare your order? 🙌" : " ¿Querés que un asesor te arme el pedido? 🙌") : (ingles ? " I'll have an advisor let you know when it's back." : " Te aviso apenas reingrese 🙌");
  return { texto: partes.join("\n") + cierre };
}

async function cotizarFull(conversacionId: string, texto: string, lista: number): Promise<ItemCoti[]> {
  const { data: h } = await supabase.from("at_mensajes").select("contenido").eq("conversacion_id", conversacionId).eq("emisor", "cliente").order("created_at", { ascending: false }).limit(4);
  const ctx = (((h ?? []) as { contenido: string }[]).map((x) => x.contenido).join(" ") + " " + texto).slice(0, 700);
  const { data } = await supabase.rpc("cotizar_full", { p_texto: ctx, p_lista: lista });
  const rows = (data ?? []) as { modelo: string; precio_lista: number; precio_publico: number | null; colores: string[] }[];
  const items: ItemCoti[] = rows.map((r) => ({ modelo: r.modelo, precio_lista: r.precio_lista, precio_publico: r.precio_publico, colores: (r.colores ?? []).slice(0, 12), objetivo: 1, alloc: [] }));
  asignarCantidades(items, texto);
  return items;
}
function preguntarColor(items: ItemCoti[], idx: number, tipo: string): RespuestaBot {
  const it = items[idx];
  const pu = precioUnit(it, tipo);
  const precioTxt = pu ? ` — ${fmtUnit(it, tipo)} c/u` : "";
  const lineas = it.colores.map((c, i) => `${i + 1}) ${c}`).join("\n");
  const conColor = items.filter((x) => x.colores.length > 0);
  const pos = conColor.filter((x) => items.indexOf(x) <= idx).length;
  const cual = conColor.length > 1 ? ` (${pos}/${conColor.length})` : "";
  const obj = it.objetivo || 1;
  const instr = obj > 1
    ? `Buscás *${obj} unidades*. Decime cuántas de cada color — ej: "2 del 1, 1 del 3" — o mandá un número de color para llevar las ${obj} iguales 👇`
    : `¿Qué color querés? Respondeme con el número 👇`;
  return { texto: `🕶️ *${it.modelo}*${precioTxt}${cual}\n${instr}\n${lineas}` };
}
function armarQuoteFinal(items: ItemCoti[], tipo: string, token: string | null, identificado = false): RespuestaBot {
  const mayor = tipo === "mayorista";
  let total = 0; let unidades = 0; const lineas: string[] = []; let k = 0;
  for (const it of items) {
    if (!it.alloc || !it.alloc.length) continue;
    const pu = precioUnit(it, tipo);
    for (const a of it.alloc) {
      const sub = pu * a.qty; total += sub; unidades += a.qty; k++;
      const qtyTxt = a.qty > 1 ? ` ×${a.qty}` : "";
      lineas.push(`${k}. ${it.modelo} — ${a.color}${qtyTxt} — ${fmtMoney(sub, tipo)}`);
    }
  }
  const sinStock = items.filter((it) => (!it.alloc || !it.alloc.length) && it.colores.length === 0).map((it) => it.modelo);
  const nota = mayor ? "Precios de tu lista + IVA, orientativos." : "Precio de venta al público.";
  const totalTxt = mayor ? `${money(total)} + IVA` : money(total);
  let txt = `📋 *Cotización — Orbital Eyewear*\n\n${lineas.join("\n")}\n\n*Total (${unidades} u.): ${totalTxt}*\n_${nota}_`;
  if (sinStock.length) txt += `\n\n⚠️ Sin stock por ahora: ${sinStock.join(", ")}`;
  if (mayor && identificado) txt += `\n\n¿Te lo dejo *precargado* en el sistema? Respondé *sí* y tu vendedor lo confirma 🙌${token ? `\nTambién lo podés cargar solo desde tu catálogo:\n${CATALOGO_URL}?k=${token}` : ""}`;
  else if (mayor) txt += token ? `\n\n¿*Armamos el pedido*? También lo podés cargar solo desde tu catálogo:\n${CATALOGO_URL}?k=${token}` : "\n\n¿*Armamos el pedido* con estos colores? Respondé *sí* y tu vendedor lo confirma 🙌";
  else txt += "\n\n🛒 Compralos online:\n" + items.filter((it) => it.alloc && it.alloc.length).map((it) => `• ${it.modelo}: https://orbitaleyewear.com.ar/search?q=${encodeURIComponent(it.modelo)}`).join("\n");
  return { texto: txt };
}
function resumenPedido(items: ItemCoti[], tipo: string): RespuestaBot {
  const sinStock = items.filter((it) => it.colores.length === 0);
  const lineas = items.map((it) => `• ${(it.objetivo || 1) > 1 ? `${it.objetivo}× ` : ""}${it.modelo}${it.colores.length === 0 ? "  ⚠️ sin stock" : ""}`);
  let txt = `¡Perfecto! 🙌 Tu pedido de cotización es:\n${lineas.join("\n")}`;
  if (sinStock.length) txt += `\n\n⚠️ *${sinStock.map((it) => it.modelo).join(", ")}* no tiene stock ahora. ¿Lo reemplazás por otro modelo? Escribime cuál, o seguimos sin ese.`;
  txt += `\n\n¿Vemos la disponibilidad de *colores* de cada modelo? Decime *sí* 👇`;
  return { texto: txt };
}
async function iniciarCotizacion(conversacionId: string, items: ItemCoti[], tipo: string, lista: number): Promise<RespuestaBot> {
  await supabase.from("bot_cotizaciones").upsert({ conversacion_id: conversacionId, estado: "resumen", tipo_cliente: tipo, lista, items, idx: 0, updated_at: new Date().toISOString() });
  return resumenPedido(items, tipo);
}

// Precarga directa solo para clientes con código real de la Suite (no prospectos TMP-) y mayoristas.
function identificadoPrecarga(cod: string | null, tipo: string): boolean { return !!cod && !cod.startsWith("TMP-") && tipo === "mayorista"; }

async function capturarSeleccion(conversacionId: string, texto: string, tipoCliente: string, prueba: boolean, token: string | null, vendCod: string, cod: string | null = null, contacto: { nombre: string | null; tel: string | null; canal: string } | null = null): Promise<RespuestaBot | null> {
  const { data } = await supabase.from("bot_cotizaciones").select("*").eq("conversacion_id", conversacionId).maybeSingle();
  const cot = data as { estado: string; tipo_cliente: string; items: ItemCoti[]; idx: number } | null;
  if (!cot) return null;
  const t = texto.trim().toLowerCase();
  if (/^(cancelar|salir|dej[aá]lo|olvidalo|nada|no gracias|no, gracias)\b/.test(t)) { await supabase.from("bot_cotizaciones").delete().eq("conversacion_id", conversacionId); return { texto: "Listo, lo dejamos ahí. Cuando quieras la retomamos 🙌" }; }
  const tipo = cot.tipo_cliente || tipoCliente;
  const corto = texto.trim().split(/\s+/).length <= 5;

  if (cot.estado === "resumen") {
    const confirma = /^(s[ií]|dale|ok(ay)?|listo|vemos|ver|de una|joya|perfecto|av[aá]nz|colores?|arranc|empez|si dale|obvio)\b/.test(t);
    if (corto && confirma) {
      const its = cot.items || [];
      const idx = its.findIndex((it) => it.colores.length > 0);
      if (idx < 0) { await supabase.from("bot_cotizaciones").update({ estado: "listo", updated_at: new Date().toISOString() }).eq("conversacion_id", conversacionId); return armarQuoteFinal(its, tipo, token, identificadoPrecarga(cod, tipo)); }
      await supabase.from("bot_cotizaciones").update({ estado: "eligiendo", idx, updated_at: new Date().toISOString() }).eq("conversacion_id", conversacionId);
      return preguntarColor(its, idx, tipo);
    }
    if (corto && /^(no|nop|negativo)\b/.test(t)) { await supabase.from("bot_cotizaciones").delete().eq("conversacion_id", conversacionId); return { texto: "Sin problema. ¿En qué te ayudo entonces? 🙌" }; }
    return null;
  }

  if (cot.estado === "listo") {
    const confirma = /^(s[ií]|dale|ok(ay)?|listo|confirmo|confirmar|confirmado|de una|joya|perfecto|arm[aá](lo|me|emos)?)\b/.test(t);
    if (corto && confirma) {
      const items = (cot.items || []).filter((it) => it.alloc && it.alloc.length);
      const resumen = "Pedido a armar: " + items.map((it) => it.alloc.map((a) => `${it.modelo} ${a.color} x${a.qty}`).join(", ")).join(", ");
      await supabase.from("bot_cotizaciones").delete().eq("conversacion_id", conversacionId);
      if (prueba) return { texto: "¡Genial! (modo prueba: no derivo ni precargo). " + resumen };
      // Cliente identificado: precarga directa (no deriva: la precarga le llega al vendedor y la avisa el Ojo).
      if (identificadoPrecarga(cod, tipo)) {
        const pedido = items.flatMap((it) => it.alloc.map((a) => ({ modelo: it.modelo, color: a.color, qty: a.qty })));
        const { data: pr, error } = await supabase.rpc("bot_precarga_crear", { p_cod: cod, p_items: pedido, p_contacto: contacto?.nombre ?? null, p_wsp: contacto?.tel ?? null, p_canal: contacto?.canal ?? null });
        const r = pr as { ok: boolean; precarga_id?: number; vendedor?: string; total_units?: number; importe?: number; faltantes?: { modelo: string; color: string; pedido: number; stock: number }[] } | null;
        if (!error && r?.ok) {
          const falt = (r.faltantes ?? []).map((f) => `${f.modelo} ${f.color}${f.stock > 0 ? ` (quedan ${f.stock})` : " (sin stock)"}`);
          return { texto: `¡Listo! 🙌 Te dejé el pedido *precargado* en el sistema (#${r.precarga_id}): *${r.total_units} u. · ${money(r.importe ?? 0)} + IVA*.\n${r.vendedor ?? vendCod} lo revisa y ${cuando()} para confirmarte condiciones y entrega.${falt.length ? `\n\n⚠️ Ajusté por stock: ${falt.join(", ")}.` : ""}` };
        }
        if (error) console.error("bot_precarga_crear", error.message);
      }
      await supabase.from("derivaciones").insert({ conversacion_id: conversacionId, motivo: "cierre_pedido", resumen: resumen.slice(0, 480), estado: "pendiente", tipo_cliente: tipo !== "desconocido" ? tipo : null, asignado_a: await vendedorId(vendCod) });
      await supabase.from("at_conversaciones").update({ estado: "derivada" }).eq("id", conversacionId);
      return { texto: `¡Perfecto! 🙌 ${vendCod} arma tu pedido con esos colores y ${cuando()} para confirmarte stock y condiciones.`, derivar: { motivo: "cierre_pedido", resumen } };
    }
    return null;
  }

  const items = cot.items || [];
  const it = items[cot.idx];
  if (!it) { await supabase.from("bot_cotizaciones").delete().eq("conversacion_id", conversacionId); return null; }
  const tieneNum = /\d/.test(texto);
  const algunColor = it.colores.some((c) => { const w = c.toLowerCase().split(/[\s/]+/).filter((x) => x.length >= 4); return w.some((x) => t.includes(x)); });
  if (!tieneNum && !algunColor) return null;

  const alloc = parseAlloc(texto, it);
  if (!alloc.length) { const lineas = it.colores.map((c, i) => `${i + 1}) ${c}`).join("\n"); return { texto: `No te agarré los colores 😅. Decime así: "2 del 1, 1 del 3", o un número de color. *${it.modelo}*:\n${lineas}` }; }

  items[cot.idx].alloc = alloc;
  let next = -1;
  for (let i = cot.idx + 1; i < items.length; i++) { if (items[i].colores.length > 0 && !(items[i].alloc && items[i].alloc.length)) { next = i; break; } }
  if (next >= 0) { await supabase.from("bot_cotizaciones").update({ items, idx: next, updated_at: new Date().toISOString() }).eq("conversacion_id", conversacionId); return preguntarColor(items, next, tipo); }
  await supabase.from("bot_cotizaciones").update({ items, estado: "listo", updated_at: new Date().toISOString() }).eq("conversacion_id", conversacionId);
  return armarQuoteFinal(items, tipo, token, identificadoPrecarga(cod, tipo));
}

interface EnvioRow { tracking_number: string; estado: string; consignee_city: string | null; delivered_at: string | null; estimated_delivery: string | null; carrier_track_url: string | null; }
type ResRastreo = RespuestaBot | "escalar" | "sin_dato";
async function intentarRastreo(texto: string, c: { telefono?: string | null; email?: string | null }): Promise<ResRastreo> {
  const tn = extraerTracking(texto);
  const tel = c?.telefono ?? null;
  const email = c?.email && !c.email.startsWith("anon:") ? c.email : null;
  if (!tn && !tel && !email) return "sin_dato";
  const { data } = await supabase.rpc("rastreo_envio", { p_tn: tn, p_tel: tel, p_email: email });
  const e = (data as EnvioRow[] | null)?.[0];
  if (!e) return tn ? { texto: `No encontré un envío con el número ${tn} 🤔. Fijate que esté bien copiado, o pasáme tu email de la compra.` } : "sin_dato";
  const link = linkTrack(e.carrier_track_url, e.tracking_number);
  const donde = e.consignee_city ? ` en ${e.consignee_city}` : "";
  switch (e.estado) {
    case "Entregado": return { texto: `✅ Tu envío ${e.tracking_number} fue entregado${e.delivered_at ? ` el ${fFecha(e.delivered_at)}` : ""}${donde}. ¡Que lo disfrutes!` };
    case "En tránsito": return { texto: `🚚 Tu envío ${e.tracking_number} está en camino${e.estimated_delivery ? `. Entrega estimada: ${fFecha(e.estimated_delivery)}` : ""}.${link ? `\nSeguilo: ${link}` : ""}` };
    case "Generado": return { texto: `📦 Tu envío ${e.tracking_number} ya está generado — en breve lo despachan.${link ? `\nSeguilo: ${link}` : ""}` };
    case "Incidencia": return "escalar";
    case "Cancelado": return { texto: `El envío ${e.tracking_number} figura cancelado. Si creés que es un error, te paso con un asesor.` };
    default: return { texto: `Tu envío ${e.tracking_number} figura como: ${e.estado}.` };
  }
}

const RE_ESCALA: RegExp[] = [
  /\b(rotur|se rompi|roto|falla|fallado|fallada|defect|no funciona|vino mal|lleg[oó] mal|reclamo|queja|da[ñn]ad)\b/i,
  /\b(devoluci[oó]n|devolver|quiero devolver|cambio por otro|nota de cr[eé]dito|garant[ií]a (rota|rechaz))\b/i,
  /\b(disputa|estafa|no me lleg[oó] (el|mi)|cobr(aron|o) de m[aá]s|pago rechazado|reembolso|devuelvan)\b/i,
];
const RE_PRECIO = /\b(precio|cu[aá]nt[oa]s? (sale|salen|cuesta|cuestan|vale|valen|est[aá]|el|la|los|las|ser[ií]a|es|me sale|me cuesta)|cotiz|lista de precios|price|how much)\b/i;
const RE_PAGOS = /\b(factura|facturaci[oó]n|cuenta corriente|cta\.? ?cte|cobranza|saldo|cu[aá]nto (debo|adeudo|te debo)|estado de cuenta|resumen de cuenta|comprobante de pago|transferenc|quiero pagar|pago pendiente|vencimiento|mi recibo)\b/i;
// Entrega / despacho (lo resuelve Administración con el estado del pedido en la Suite).
const RE_ENTREGA = /\b(cu[aá]ndo (me )?(llega|lo mandan|lo env[ií]an|sale)|demora|demorad|no me lleg[oó]|entrega|entregan|despach|env[ií]o pendiente|remito|reparto|retiro|retirar el pedido)\b/i;
function esEscalamiento(t: string): boolean { return RE_ESCALA.some((re) => re.test(t)); }

// OJO: no usar \b con palabras acentuadas. En JS "ó" no es \w, así que /\bóptica/ NUNCA matchea
// y por eso "Es una consulta de una óptica" no se clasificaba. Se usa lookaround de letras.
function detectarTipo(texto: string): "mayorista" | "minorista" | null {
  const B = (re: string) => new RegExp(`(?<![a-záéíóúñ])(?:${re})(?![a-záéíóúñ])`, "i");
  if (B("no soy (un[ao]? )?(particular|consumidor final|cliente final)").test(texto)) return "mayorista";
  if (B("no soy (un[ao]? )?(comercio|[oó]ptica|negocio)").test(texto)) return "minorista";
  if (B("cons(umidor)?\\.? ?final|consumidor|particular|soy (un )?cliente|para m[ií] mism|para mi uso|un anteojo|un lente|para regalar|final consumer|end consumer|for myself|personal use|just one").test(texto)) return "minorista";
  if (B("[oó]ptica|comercio|cuit|raz[oó]n social|precio por mayor|reventa|revend|para mi (local|negocio)|mayorista|wholesale|optical (shop|store)|resell|distribuidor|mi negocio").test(texto)) return "mayorista";
  if (/\d{2,}\s*(unidades|pares|piezas|units)/i.test(texto)) return "mayorista";
  return null;
}
function esIngles(t: string): boolean {
  const en = /\b(hi|hello|hey|please|thank you|thanks|where is|how much|do you have|can i|i want|i'?m|i am|my order|final consumer|good morning)\b/i.test(t);
  const es = /[áéíóúñ¿¡]|\b(hola|gracias|pedido|precio|env[ií]o|quiero|d[oó]nde|donde|c[oó]mo|como|anteojo|busco|modelo|hay|ten[eé]s|tienen|tienes|color|quisiera|necesito|s[ií]|el|la|los|las|un|una)\b/i.test(t);
  return en && !es;
}

interface Pieza { categoria: string; tema: string | null; titulo: string; descripcion: string | null; contenido_texto: string | null; url: string | null }
async function armarRAG(tipoCliente: string, segmentos: string[]): Promise<string> {
  const excluir = tipoCliente === "mayorista" ? [] : ["guion", "propuesta"];
  const { data: pr } = await supabase.from("piezas_marketing").select("categoria, tema, titulo, descripcion, contenido_texto, url").eq("activa", true);
  const piezas = ((pr ?? []) as Pieza[]).filter((p) => !excluir.includes(p.categoria));
  const prio = (p: Pieza) => { const t = (p.titulo || "").toLowerCase(), tm = (p.tema || "").toLowerCase(); if (t.includes("medida") || t.includes("caracter")) return 0; if (t.includes("objeci") || tm.includes("objeci")) return 1; if (p.categoria === "catalogo") return 2; if (p.categoria === "precios") return 3; if (tm.includes("cristal") || tm.includes("infrarrojo") || tm.includes("blue")) return 4; if (p.categoria === "guion") return 5; if (p.categoria === "copy") return 6; return 7; };
  piezas.sort((a, b) => prio(a) - prio(b));
  let budget = 12000; const bloques: string[] = [];
  for (const p of piezas) {
    const lim = (p.categoria === "catalogo" || p.categoria === "precios") ? 4000 : 900;
    let cuerpo: string;
    if (p.contenido_texto && p.contenido_texto.trim()) cuerpo = p.contenido_texto.trim().slice(0, lim);
    else { const d = (p.descripcion || "").trim(); cuerpo = (d || "(material disponible)") + (p.url ? " — [hay material/enlace; el asesor lo comparte o está en la web]" : ""); }
    const b = `[${p.categoria}/${p.tema || "general"}] ${p.titulo}:\n${cuerpo}`;
    if (b.length > budget) continue; budget -= b.length; bloques.push(b);
  }
  const { data: kb } = await supabase.from("base_conocimiento").select("intencion, respuesta").eq("activa", true).overlaps("segmentos_permitidos", segmentos).order("prioridad", { ascending: true }).limit(20);
  const faq = ((kb ?? []) as { intencion: string; respuesta: string }[]).map((k) => `[faq/${k.intencion}] ${k.respuesta}`).join("\n");
  return `=== FAQ OPERATIVA ===\n${faq || "(s/d)"}\n\n=== MATERIAL DE MARKETING ===\n${bloques.join("\n---\n") || "(s/d)"}`;
}

function sistemaIRIS(tipoCliente: string, canal: Canal, ingles: boolean, rag: string, token: string | null, vendCod: string): string {
  const ml = canal === "mercadolibre_posventa" ? "CANAL: Mercado Libre POSVENTA — extremá el cuidado. Ante CUALQUIER reclamo o disputa, derivá sin resolver." : canal === "mercadolibre_pregunta" ? "CANAL: Mercado Libre PREGUNTAS — respondé con catálogo y precio minorista oficial." : `CANAL: ${canal}.`;
  const mayor = tipoCliente === "mayorista";
  const bloqueLinks = mayor
    ? `LINKS (MAYORISTA — PROHIBICIÓN ABSOLUTA): NUNCA, bajo ninguna circunstancia, mandes orbitaleyewear.com.ar ni outletorbitaleyewear.shop a una óptica: ESE ES EL CANAL DEL CONSUMIDOR FINAL y le muestra precios de público. El canal de la óptica es SU catálogo mayorista${token ? `: ${CATALOGO_URL}?k=${token}` : " (su link personal con token, que se lo pasa el sistema)"} y su vendedor de zona (${vendCod}).`
    : `CONSUMIDOR FINAL: tu meta es que compre en la web. Producto puntual → link de ese producto: https://orbitaleyewear.com.ar/search?q=NOMBRE+DEL+MODELO (espacios como +). Consulta general → home https://orbitaleyewear.com.ar. Ofertas/outlet → https://outletorbitaleyewear.shop . NO des precios de productos.`;
  return [
    "Sos IRIS, la asistente virtual de atención al cliente de Orbital (marca argentina de anteojos premium; plataforma TRIPLE PROTECCIÓN: UV400 + BlueCut + Infrarrojo, única en el mercado).",
    ingles ? "El cliente escribió en INGLÉS: respondé en INGLÉS." : "Respondé en español rioplatense, tono cordial y profesional, natural (nunca robótico).",
    "Tenés el HISTORIAL de la charla: usálo. Si el cliente responde 'sí'/'dale'/'ok' a algo que vos ofreciste, CUMPLÍ con eso concretamente.",
    "NO REPREGUNTES lo que ya está en el historial. Si el cliente ya dijo su nombre, su zona, su rubro o qué necesita, NO se lo vuelvas a pedir — usalo. Si te dice que ya respondió algo, pedile disculpas y seguí adelante, nunca lo vuelvas a preguntar.",
    "PROHIBIDO PEDIR LA UBICACIÓN. Nunca preguntes zona, provincia, localidad ni ciudad: el vendedor ya está asignado y esos datos los carga él después. Tampoco pidas CUIT ni razón social.",
    "Respuestas CORTAS y directas, estilo chat de WhatsApp real. Para lo comercial usá técnicas de venta orientadas a la conversión, con el gancho de la Triple Protección.",
    "USÁ TODO EL MATERIAL del CONTEXTO (catálogos, medidas, listas de precios, cristales, objeciones, copys): si el dato está ahí, respondelo concretamente. No mandes menús genéricos ni 'revisá la web' si la respuesta está en el material.",
    `TIPO DE CLIENTE: ${tipoCliente}.`,
    `VENDEDOR DE ZONA de este cliente: ${vendCod}. Si nombrás a alguien del equipo, nombrá SOLO a ${vendCod}. Nunca inventes otros nombres de vendedores.`,
    "CATÁLOGO: casi toda la línea tiene Triple Protección. Los 4 modelos ASCARI/CIVIC CENTER/CASA BLANCA/5TH AVENUE son la PREVENTA (lanzamientos NUEVOS), NO todo el catálogo.",
    "MEDIDAS Y TIPOS: hay un 'Catálogo de medidas y características por modelo'. Si preguntan medida/formato/tipo/si es polarizado, respondé con ese dato. NUNCA afirmes que un modelo no existe sin buscarlo primero (Silverstone, Roma, Le Mans, Eivissa, Zeta, etc. SÍ existen).",
    "PRECIOS: NO inventes precios NI listas. Si el cliente quiere precio de un modelo, el sistema tiene un cotizador propio; vos NO tirés números de precio de productos.",
    bloqueLinks,
    "ESTADO DE PEDIDO/ENVÍO: si dan número de pedido (ej #4422) o de seguimiento, el sistema ya te da el estado real; respondé eso. Si NO dan número, pediles el número — NO inventes.",
    "POSTVENTA cristales: el precio depende de la BASE del modelo (Deportivos=base 8, Urbanos=base 2, Milano y Brera=base 0). La lista de postventa tiene precio Público y Óptica.",
    "DERIVÁ LO MENOS POSIBLE. Si podés resolver con el material o los datos del sistema, resolvé. NUNCA digas 'te paso con un asesor' salvo que uses el token ⟦DERIVAR⟧.",
    "REGLAS INQUEBRANTABLES (solo acá se deriva):",
    "- NUNCA inventes. Si el dato no está en el CONTEXTO ni en los datos del sistema, derivá.",
    "- Precio de PRODUCTOS: NO lo respondas vos; lo maneja el cotizador del sistema.",
    "- Pagos, facturas, cuenta corriente o cobranzas: DERIVÁ (lo maneja Administración).",
    "- Reclamos por producto dañado, cambios/devoluciones o disputas de pago: DERIVÁ siempre.",
    ml,
    "DERIVAR: cuando corresponda, respondé empezando EXACTAMENTE con el token ⟦DERIVAR⟧ y luego un mensaje corto avisando que un asesor continúa.",
    "",
    "CONTEXTO (usalo tal cual, no inventes):",
    rag,
  ].join("\n");
}

// El LLM insiste en pedir la zona aunque el prompt se lo prohíba. La ubicación la carga
// después el vendedor, así que la pregunta se corta acá antes de que salga.
const RE_ZONA = /(zona|provincia|localidad|ciudad|partido|barrio|d[oó]nde (est[aá]s|queda|te encontr[aá]s|est[aá] ubicad))/i;
const RE_PIDE = /(\?|dec[ií]me|contame|cont[aá]me|indic[aá]me|pas[aá]me|av[ií]same|me dec[ií]s|necesito saber|me confirm|me indic)/i;
const RE_HUERFANA = /^\s*(as[ií]|con eso|de esa forma|de ese modo|y ah[ií]|entonces|para eso)\b/i;
function sacarPreguntaDeZona(txt: string, tipo: string, conFallback = true): string {
  if (!txt || !RE_ZONA.test(txt)) return txt;
  const frases = txt.split(/(?<=[.!?\n])\s*/);
  const quedan: string[] = [];
  let corte = false;
  for (const f of frases) {
    if (RE_ZONA.test(f) && RE_PIDE.test(f)) { corte = true; continue; }
    // La frase que seguía a la pregunta suele quedar colgada ("Así te asigno vendedor").
    if (corte && RE_HUERFANA.test(f)) { continue; }
    corte = false;
    quedan.push(f);
  }
  const limpio = quedan.join(" ").replace(/[ \t]{2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  if (limpio.length >= 60) return limpio;
  if (!conFallback) return "";     // en una derivación el cierre lo pone quien llama
  return tipo === "mayorista"
    ? "¡Buenísimo! Contame qué modelos te interesan o qué necesitás y te ayudo 🙌"
    : "¡Dale! Contame qué estás buscando y te ayudo 🙌";
}
// Todo lo que sale del LLM pasa por acá: links del canal correcto y sin pedir ubicación.
function pulir(txt: string, tipo: string, token: string | null, conFallback = true): string {
  return sacarPreguntaDeZona(limpiarLinksB2C(txt, tipo, token), tipo, conFallback);
}

function limpiarLinksB2C(txt: string, tipo: string, token: string | null): string {
  if (tipo !== "mayorista") return txt;
  const destino = token ? `${CATALOGO_URL}?k=${token}` : CATALOGO_URL;
  return txt
    .replace(/https?:\/\/(www\.)?outletorbitaleyewear\.shop\S*/gi, destino)
    .replace(/https?:\/\/(www\.)?orbitaleyewear\.com\.ar\S*/gi, destino)
    .replace(/\n{3,}/g, "\n\n").trim();
}

async function derivar(motivo: string, conversacionId: string, resumen: string, tipoCliente: string | undefined, vendCod: string, urgente = false): Promise<RespuestaBot> {
  await supabase.from("derivaciones").insert({
    conversacion_id: conversacionId, motivo,
    resumen: (urgente ? "⚠ URGENTE — " : "") + resumen.slice(0, 480),
    estado: "pendiente",
    tipo_cliente: tipoCliente && tipoCliente !== "desconocido" ? tipoCliente : null,
    asignado_a: await vendedorId(vendCod),
  });
  await supabase.from("at_conversaciones").update({ estado: "derivada" }).eq("id", conversacionId);
  const quien = vendCod === "Administracion" ? "Administración" : vendCod === "Postventa" ? "Postventa" : vendCod;
  return { texto: `Te paso con ${quien} — ${cuando()}. ¡Gracias! 🙌`, derivar: { motivo, resumen } };
}

async function responder(conversacionId: string, canal: Canal, resp: RespuestaBot, ultimasBot: string[] = []): Promise<Response> {
  if (resp.texto && repetida(resp.texto, ultimasBot)) {
    return new Response(JSON.stringify({ texto: "" }), { headers: { "content-type": "application/json" } });
  }
  if (resp.texto) { try { await supabase.from("at_mensajes").insert({ conversacion_id: conversacionId, canal, emisor: "bot", contenido: resp.texto }); } catch { /* */ } }
  return new Response(JSON.stringify(resp), { headers: { "content-type": "application/json" } });
}

async function catalogoPorAtributo(texto: string): Promise<RespuestaBot | null> {
  const { data } = await supabase.rpc("modelos_por_atributo", { p_texto: texto });
  const row = (data ?? [])[0] as { criterio: string; modelos: string[] } | undefined;
  if (!row?.modelos?.length) return null;
  const n = row.modelos.length; const sample = row.modelos.slice(0, 12).join(", ");
  return { texto: `Tenemos ${n} modelos con ${row.criterio}: ${sample}${n > 12 ? ", y más" : ""}. ¿Querés info de alguno o el catálogo completo? 🙌` };
}

// v57b (2026-09-14): el 20b se queda sin cupo por minuto (429) y el respaldo llama-3.3 ya no
// existe (404) -> todo iba a llm_error y la consulta quedaba en "te paso con Ulises". Ahora el
// respaldo es otro modelo vivo con cupo propio, y si todos dan 429 se espera y se reintenta.
async function llamarGroq(messages: unknown[]): Promise<string | null> {
  for (let vuelta = 0; vuelta < 2; vuelta++) {
    let todos429 = true;
    for (const model of GROQ_MODELS) {
      try {
        const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST", headers: { Authorization: `Bearer ${GROQ_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({ model, temperature: 0.5, max_tokens: 400, messages }),
        });
        if (!res.ok) { console.error("groq", model, res.status); if (res.status !== 429) todos429 = false; continue; }
        todos429 = false;
        const data = await res.json();
        const s = (data?.choices?.[0]?.message?.content ?? "").trim();
        if (s) return s;
      } catch (e) { todos429 = false; console.error("groq", model, (e as Error).message); }
    }
    if (!todos429) break;
    await new Promise((r) => setTimeout(r, 8000));
  }
  return null;
}

async function handler(req: Request): Promise<Response> {
  const { conversacionId, contactoId, canal, texto, esLead } = (await req.json()) as MensajeEntrante;

  const { data: histRaw } = await supabase.from("at_mensajes").select("emisor, contenido, created_at")
    .eq("conversacion_id", conversacionId).order("created_at", { ascending: false }).limit(12);
  const hist = ((histRaw ?? []) as Msg[]);
  const ultimasBot = hist.filter((m) => m.emisor === "bot").map((m) => m.contenido);
  const ultimasCli = hist.filter((m) => m.emisor === "cliente").map((m) => m.contenido);
  const ultTs = hist[0]?.created_at as string | undefined;
  const horasInactivo = ultTs ? (Date.now() - new Date(ultTs).getTime()) / 36e5 : null;

  await supabase.from("at_mensajes").insert({ conversacion_id: conversacionId, canal, emisor: "cliente", contenido: texto });

  const { data: conv } = await supabase.from("at_conversaciones").select("estado").eq("id", conversacionId).single();
  const { data: contacto } = await supabase.from("contactos").select("tipo_cliente, telefono, email, cod_cliente").eq("id", contactoId).single();
  const ingles = esIngles(texto);
  const prueba = esPrueba(contacto?.telefono ?? null);

  let cod = contacto?.cod_cliente ?? null;
  let recienIdentificado = false;
  if (!cod) { const idc = await identificarPorTelefono(contactoId, contacto?.telefono ?? null); if (idc) { cod = idc.cod; recienIdentificado = true; } }
  const vendCod = await vendedorDeCliente(cod);

  let modoDerivada = conv?.estado === "derivada" && !prueba;
  if (modoDerivada && (horasInactivo === null || horasInactivo > REABRIR_HORAS)) {
    await supabase.from("at_conversaciones").update({ estado: "bot_activo" }).eq("id", conversacionId);
    modoDerivada = false;
  }

  // En la campaña, pedir un vendedor no es fricción: lo resuelve el flujo (confirma óptica y deriva directo al vendedor).
  const pideVend = RE_PIDE_VENDEDOR.test(texto) && !modoDerivada && (await charlaDeCampana(conversacionId, contacto?.telefono ?? null, !!esLead));
  if (!pideVend && detectarFriccion(texto, ultimasCli, ultimasBot) && !prueba) {
    if (modoDerivada) {
      const yaAvise = ultimasBot.slice(0, 2).some((m) => /prioridad|perd[oó]n|disculp/i.test(m));
      if (yaAvise) return new Response(JSON.stringify({ texto: "" }), { headers: { "content-type": "application/json" } });
      await supabase.from("derivaciones").insert({
        conversacion_id: conversacionId, motivo: "friccion_bot",
        resumen: "⚠ URGENTE — el cliente está molesto y sigue esperando. " + texto.slice(0, 400),
        estado: "pendiente", tipo_cliente: contacto?.tipo_cliente ?? null, asignado_a: await vendedorId(vendCod),
      });
      return responder(conversacionId, canal, { texto: `Perdoname, tenés razón. Lo marqué como prioridad y ${vendCod} ${cuando()}. No te vuelvo a hacer perder tiempo con respuestas automáticas 🙌` }, ultimasBot);
    }
    await supabase.from("derivaciones").insert({
      conversacion_id: conversacionId, motivo: "friccion_bot",
      resumen: "⚠ URGENTE — el bot no está entendiendo al cliente. " + texto.slice(0, 400),
      estado: "pendiente", tipo_cliente: contacto?.tipo_cliente ?? null, asignado_a: await vendedorId(vendCod),
    });
    await supabase.from("at_conversaciones").update({ estado: "derivada" }).eq("id", conversacionId);
    await supabase.from("bot_cotizaciones").delete().eq("conversacion_id", conversacionId);
    return responder(conversacionId, canal, {
      texto: ingles ? `Sorry about that — I'm handing you to ${vendCod} right now, a real person. They'll write to you shortly 🙌`
                    : `Perdoname, no te estoy entendiendo bien y no quiero hacerte perder más tiempo. Te paso con ${vendCod}, una persona del equipo — ${cuando()} 🙌`,
      derivar: { motivo: "friccion_bot", resumen: texto },
    }, ultimasBot);
  }

  const acuseDerivada: RespuestaBot = { texto: ingles ? "Your query is already with an advisor — they'll reply shortly 🙌" : `Tu consulta ya está con ${vendCod} — ${cuando()} 🙌` };

  if (!modoDerivada && !ingles) {
    const fx = await flujoDiferenciarte(conversacionId, contactoId, texto, contacto?.telefono ?? null, cod, !!esLead, ultimasBot.length > 0);
    if (fx) return responder(conversacionId, canal, fx, ultimasBot);
  }

  if (RE_ACCESO.test(texto) && !/consumidor final|para m[ií] mism/i.test(texto)) {
    const esLeadMeta = await leadDeMeta(!!esLead, contacto?.telefono ?? null);
    const { data: acc } = await supabase.rpc("bot_acceso_catalogo", {
      p_tel: contacto?.telefono ?? null, p_nombre: extraerNombre(texto), p_vendedor_fallback: VENDEDOR_LEADS, p_crear: esLeadMeta,
    });
    const a = acc as { ok: boolean; cod?: string; token?: string; label?: string; vendedor?: string; motivo?: string } | null;
    if (a?.ok && a.token) {
      await supabase.from("contactos").update({ cod_cliente: a.cod, tipo_cliente: "mayorista" }).eq("id", contactoId);
      const v = a.vendedor || VENDEDOR_LEADS;
      if (!prueba) {
        await supabase.from("derivaciones").insert({
          conversacion_id: conversacionId, motivo: "acceso_catalogo",
          resumen: `Se habilitó el catálogo solo. ${a.label ?? a.cod}. Link: ${CATALOGO_URL}?k=${a.token}`,
          estado: "pendiente", tipo_cliente: "mayorista", asignado_a: await vendedorId(v),
        });
      }
      return responder(conversacionId, canal, {
        texto: ingles
          ? `Done! 🙌 Your wholesale catalog is enabled on this device:\n${CATALOGO_URL}?k=${a.token}`
          : `¡Listo! 🙌 Te habilité el catálogo mayorista en este dispositivo:\n${CATALOGO_URL}?k=${a.token}\n\nAhí ves toda la colección con fotos, medidas y disponibilidad, y podés armar el pedido directo con precios de óptica.\n\n${v}, tu vendedor de zona, ${cuando()} 🙌`,
      }, ultimasBot);
    }
    await supabase.rpc("bot_ingresar_prospecto", { p_tel: contacto?.telefono ?? null, p_nombre: extraerNombre(texto), p_canal: "whatsapp_in", p_temperatura: "caliente", p_conversacion: conversacionId, p_vendedor: a?.vendedor || VENDEDOR_LEADS });
    if (modoDerivada) return responder(conversacionId, canal, acuseDerivada, ultimasBot);
    const vAcc = a?.vendedor || VENDEDOR_LEADS;
    await supabase.from("derivaciones").insert({ conversacion_id: conversacionId, motivo: "acceso_catalogo", resumen: `Pide acceso al catálogo mayorista y hay que habilitarlo a mano (${a?.motivo ?? "sin datos"}). ${texto.slice(0, 300)}`, estado: "pendiente", tipo_cliente: "mayorista", asignado_a: await vendedorId(vAcc) });
    await supabase.from("at_conversaciones").update({ estado: "derivada" }).eq("id", conversacionId);
    return responder(conversacionId, canal, { texto: `¡Dale! Para habilitarte el catálogo mayorista te paso con ${vAcc}, tu vendedor de zona — ${cuando()} 🙌`, derivar: { motivo: "acceso_catalogo", resumen: texto } }, ultimasBot);
  }

  const mNro = texto.match(RE_NRO_PEDIDO);
  const nroPedido = mNro ? (mNro[1] || mNro[2] || mNro[3]) : null;
  const noLlego = RE_NO_LLEGO.test(texto) && !RE_NO_LLEGO_OTRO.test(texto);
  const hablaDePedido = RE_POSTVENTA.test(texto) || RE_RASTREO.test(texto) || noLlego;
  const mencionaPedido = /\b(pedido|orden|order|remito)\b/i.test(texto);

  // Postventa de producto (rotura, falla, repuesto): la resuelve Postventa, no el vendedor de la cuenta.
  if (RE_POSTVENTA_PROD.test(texto) && !prueba) {
    if (modoDerivada) return responder(conversacionId, canal, acuseDerivada, ultimasBot);
    const resumen = `Postventa de producto${nroPedido ? ` (pedido #${nroPedido})` : ""}: ${texto.slice(0, 400)}`;
    await supabase.from("derivaciones").insert({
      conversacion_id: conversacionId, motivo: "postventa_garantia", resumen: resumen.slice(0, 480),
      estado: "pendiente", tipo_cliente: contacto?.tipo_cliente ?? null, asignado_a: await vendedorId("Postventa"),
    });
    await supabase.from("at_conversaciones").update({ estado: "derivada" }).eq("id", conversacionId);
    return responder(conversacionId, canal, {
      texto: ingles
        ? `Sorry about that 😕 I'm passing it to our after-sales team — ${enHorario() ? "they will write to you shortly" : "they will write to you first thing tomorrow"}. If you can, send a photo of the damage and your order number: we sort it out faster that way 🙌`
        : `Uy, qué macana 😕 Lo paso a Postventa — ${cuando()}. Si podés, mandame una foto de cómo quedó y el número de pedido: con eso lo resolvemos más rápido 🙌`,
      derivar: { motivo: "postventa_garantia", resumen },
    }, ultimasBot);
  }

  if (nroPedido && (hablaDePedido || mencionaPedido || /#/.test(texto))) {
    const eo = await estadoPorOrden(nroPedido, contacto?.telefono ?? null);
    if (eo) return responder(conversacionId, canal, eo, ultimasBot);
  }
  if (RE_RASTREO.test(texto) || noLlego) {
    if (extraerTracking(texto)) {
      const r = await intentarRastreo(texto, contacto ?? {});
      if (r === "escalar" && !prueba) return responder(conversacionId, canal, modoDerivada ? acuseDerivada : await derivar("envio_incidencia", conversacionId, texto, contacto?.tipo_cliente ?? undefined, "Administracion", true), ultimasBot);
      if (r !== "sin_dato" && r !== "escalar") return responder(conversacionId, canal, r, ultimasBot);
    }
    if (cod) { const ped = await estadoPedidoCliente(cod); if (ped) return responder(conversacionId, canal, ped, ultimasBot); }
    const porTel = await estadoPorTelefono(contacto?.telefono ?? null);
    if (porTel) return responder(conversacionId, canal, porTel, ultimasBot);
    return responder(conversacionId, canal, { texto: ingles ? "Sure! Send me your order number (e.g. #4422) or your tracking number and I'll check it 📦" : "¡Dale! Pasame el número de pedido (ej #4422) o el de seguimiento y te digo el estado 📦" }, ultimasBot);
  }
  if (hablaDePedido && !nroPedido && !modoDerivada) {
    if (cod) { const ped = await estadoPedidoCliente(cod); if (ped) return responder(conversacionId, canal, ped, ultimasBot); }
    const porTel = await estadoPorTelefono(contacto?.telefono ?? null);
    if (porTel) return responder(conversacionId, canal, porTel, ultimasBot);
    return responder(conversacionId, canal, { texto: ingles ? "Happy to help! What's your order number (e.g. #4422)? 📦" : "¡Te ayudo! ¿Cuál es el número de pedido? (ej #4422) 📦" }, ultimasBot);
  }

  if (recienIdentificado && cod && !modoDerivada) {
    const resumen = await resumenActividad(cod);
    if (resumen) return responder(conversacionId, canal, { texto: `¡Hola! Te reconocí por tu número 🙌\n${resumen}\n¿Tu consulta es sobre alguno de estos, o querés otra cosa?` }, ultimasBot);
  }

  const esSaludo = /^\s*(hola|holis|buenas|buen[oa]s?\s*(?:d[ií]as?|tardes?|noches?)?|hey|hi+|hello|qu[eé]\s*tal|buen d[ií]a)\s*[!.\s]*$/i.test(texto);
  if (esSaludo && !modoDerivada) {
    await supabase.from("bot_cotizaciones").delete().eq("conversacion_id", conversacionId);
    const tipoActual = contacto?.tipo_cliente ?? (cod ? "mayorista" : "desconocido");
    const mostrarOutreach = !!esLead || prueba;
    if (mostrarOutreach) {
      let outEs = "¡Hola! 👋 Soy Ulises, de Orbital. ¡Gracias por escribirnos! 🙌";
      const { data: sc } = await supabase.from("app_config").select("valor").eq("clave", "iris_saludo_lead").maybeSingle();
      if ((sc as { valor: string } | null)?.valor) outEs = (sc as { valor: string }).valor;
      const out = ingles
        ? "Hi! 👋 I'm Ulises, from Orbital. Thanks for reaching out! We make sunglasses with Triple Protection (UV400 + Infrared + Blue Cut), unique in the market. To help you better — are you an optical shop/business, or an end consumer?"
        : outEs;
      return responder(conversacionId, canal, { texto: out, quickReplies: ingles ? ["Optical / business", "End consumer"] : ["Soy óptica / comercio", "Soy consumidor final"] }, ultimasBot);
    }
    if (tipoActual === "mayorista" || tipoActual === "minorista") {
      return responder(conversacionId, canal, { texto: ingles ? "Hi! 👋 How can I help you today?" : "¡Hola! 👋 ¿En qué te ayudo hoy?" }, ultimasBot);
    }
    return responder(conversacionId, canal, { texto: ingles ? "Hi! 👋 I'm IRIS, Orbital's assistant. To help you right — are you an optical shop/business, or an end consumer?" : "¡Hola! 👋 Soy IRIS, la asistente de Orbital. Para ayudarte bien, ¿sos óptica/comercio o consumidor final?", quickReplies: ingles ? ["Optical / business", "End consumer"] : ["Soy óptica / comercio", "Soy consumidor final"] }, ultimasBot);
  }

  // Ruteo por tema: postventa (roturas, garantía, devoluciones) → Postventa; facturación y entrega → Administración.
  if (esEscalamiento(texto) && !prueba) return responder(conversacionId, canal, modoDerivada ? acuseDerivada : await derivar("reclamo_excepcion", conversacionId, texto, contacto?.tipo_cliente ?? undefined, "Postventa", true), ultimasBot);
  if (RE_PAGOS.test(texto) && !prueba) return responder(conversacionId, canal, modoDerivada ? acuseDerivada : await derivar("pagos_cobranza", conversacionId, texto, contacto?.tipo_cliente ?? undefined, "Administracion"), ultimasBot);
  if (RE_ENTREGA.test(texto) && !prueba) return responder(conversacionId, canal, modoDerivada ? acuseDerivada : await derivar("entrega", conversacionId, texto, contacto?.tipo_cliente ?? undefined, "Administracion"), ultimasBot);
  if (modoDerivada) return responder(conversacionId, canal, acuseDerivada, ultimasBot);

  let tipoCliente = contacto?.tipo_cliente ?? (cod ? "mayorista" : "desconocido");

  let token: string | null = null;
  if (cod) {
    const { data: ca } = await supabase.from("catalogo_acceso").select("codigo").eq("cod_cliente", cod).eq("activo", true).limit(1);
    token = ((ca ?? [])[0] as { codigo: string } | undefined)?.codigo ?? null;
  }

  const sel = await capturarSeleccion(conversacionId, texto, tipoCliente, prueba, token, vendCod, cod, { nombre: extraerNombre(texto), tel: contacto?.telefono ?? null, canal });
  if (sel) return responder(conversacionId, canal, sel, ultimasBot);
  const { data: cotAct } = await supabase.from("bot_cotizaciones").select("estado").eq("conversacion_id", conversacionId).maybeSingle();
  const hayCotActiva = !!cotAct;

  if (RE_ATRIB.test(texto)) { const cat = await catalogoPorAtributo(texto); if (cat) return responder(conversacionId, canal, cat, ultimasBot); }

  const yaPregunteSegmento = ultimasBot.slice(0, 5).filter((m) => /[oó]ptica\/comercio o consumidor|optical shop\/business/i.test(m)).length;
  if (tipoCliente === "desconocido") {
    const det = detectarTipo(texto);
    if (det) {
      tipoCliente = det;
      await supabase.from("contactos").update({ tipo_cliente: det }).eq("id", contactoId);
      if (det === "mayorista") {
        await supabase.rpc("bot_ingresar_prospecto", {
          p_tel: contacto?.telefono ?? null, p_nombre: extraerNombre(texto),
          p_canal: (await leadDeMeta(!!esLead, contacto?.telefono ?? null)) ? "meta_b2b" : "whatsapp_in",
          p_temperatura: "caliente", p_conversacion: conversacionId, p_vendedor: vendCod,
        });
      }
    }
    else if (yaPregunteSegmento >= 2) {
      return responder(conversacionId, canal, await derivar("sin_segmento", conversacionId, texto, undefined, vendCod), ultimasBot);
    }
    else if ((RE_PRECIO.test(texto) || RE_COMPRA.test(texto)) && !yaPregunteSegmento && !RE_NEGATIVA.test(texto)) {
      return responder(conversacionId, canal, { texto: ingles ? "To quote you right — are you an optical shop/business, or an end consumer?" : "Para cotizarte bien — ¿sos óptica/comercio o consumidor final?", quickReplies: ingles ? ["Optical / business", "End consumer"] : ["Soy óptica / comercio", "Soy consumidor final"] }, ultimasBot);
    }
  }

  // ¿Dónde consigo este modelo? En CUALQUIER charla (no solo la campaña) y en todos los canales.
  // Si ya le preguntamos la localidad, el mensaje corto siguiente se toma como la localidad.
  const pidioLocalidad = ultimasBot.slice(0, 2).some((m) => /en qu[eé] localidad/i.test(m));
  const cortoLoc = texto.trim().split(/\s+/).length <= 8 && !texto.includes("?");
  if (tipoCliente !== "mayorista" && !cod && (RE_DONDE_PROBAR.test(texto) || (pidioLocalidad && cortoLoc))) {
    const donde = await dondeConseguir(conversacionId, texto, contacto?.telefono ?? null, extraerNombre(texto), ingles);
    if (donde) return responder(conversacionId, canal, donde, ultimasBot);
    if (!pidioLocalidad) {
      return responder(conversacionId, canal, {
        texto: ingles ? "Sure! Which city are you in? I'll point you to a nearby optical shop 🙂"
                      : "¡Dale! ¿En qué localidad estás? Así te paso una óptica cerca donde probarlos 🙂",
      }, ultimasBot);
    }
    if (RE_DONDE_PROBAR.test(texto)) {
      return responder(conversacionId, canal, {
        texto: ingles ? `I don't have a shop loaded in your area yet 🙏 You can see everything and buy online at ${TIENDA}.`
                      : `Todavía no tengo una óptica cargada en tu zona 🙏 Podés ver toda la colección y comprar online en ${TIENDA}, con envío a todo el país.`,
      }, ultimasBot);
    }
  }

  const intencionCompra = (RE_PRECIO.test(texto) || RE_COMPRA.test(texto)) && !RE_NEGATIVA.test(texto);
  const cortoModelos = texto.trim().split(/\s+/).length <= 6 && !RE_NEGATIVA.test(texto);
  const wantQuote = (intencionCompra || cortoModelos) && !RE_MEDIDA.test(texto) && !RE_ATRIB.test(texto) && !hayCotActiva;
  if (wantQuote && (tipoCliente === "mayorista" || tipoCliente === "minorista")) {
    const items = await cotizarFull(conversacionId, texto, 5);
    if (items.length) {
      if (tipoCliente === "mayorista" && !cod && !prueba) {
        return responder(conversacionId, canal, await derivar("precio_mayorista", conversacionId, texto, tipoCliente, VENDEDOR_LEADS), ultimasBot);
      }
      return responder(conversacionId, canal, await iniciarCotizacion(conversacionId, items, tipoCliente, 5), ultimasBot);
    }
    if (RE_PRECIO.test(texto) && !RE_NEGATIVA.test(texto)) {
      return responder(conversacionId, canal, { texto: ingles ? "Which model(s) would you like? Tell me the name 🙌" : "¿De qué modelo(s) querés? Pasame el nombre y te armo la cotización 🙌" }, ultimasBot);
    }
  }

  if (!RE_MEDIDA.test(texto)) { const st = await chequearStockColores(texto, ingles); if (st) return responder(conversacionId, canal, st, ultimasBot); }

  if (tipoCliente === "desconocido") {
    if (yaPregunteSegmento >= 1) return responder(conversacionId, canal, await derivar("sin_segmento", conversacionId, texto, undefined, vendCod), ultimasBot);
    return responder(conversacionId, canal, { texto: ingles ? "To help you right — are you an optical shop/business, or an end consumer?" : "Para ayudarte bien — ¿sos óptica/comercio o consumidor final?", quickReplies: ingles ? ["Optical / business", "End consumer"] : ["Soy óptica / comercio", "Soy consumidor final"] }, ultimasBot);
  }

  const segmentos = tipoCliente === "mayorista" ? ["b2b_activo", "b2b_inactivo"] : ["b2c"];
  const rag = await armarRAG(tipoCliente, segmentos);

  if (!GROQ_KEY) return responder(conversacionId, canal, await derivar("sin_llm", conversacionId, texto, tipoCliente, vendCod), ultimasBot);
  const historial = hist.slice(0, 8).reverse().map((m) => ({ role: m.emisor === "bot" ? "assistant" : "user", content: m.contenido }));
  historial.push({ role: "user", content: texto });
  const { data: flc } = await supabase.from("bot_lead_flujo").select("campana").eq("conversacion_id", conversacionId).maybeSingle();
  const reglaCampana = CAMPANAS.includes((flc as { campana: string | null } | null)?.campana ?? "")
    ? "\n\nREGLA DE ESTA CHARLA (campaña Diferenciarte v2): respondé SOLO lo que te preguntan, directo y en 1 a 3 oraciones. NO recomiendes modelos, ni la Preventa, ni lanzamientos nuevos salvo que te pidan una recomendación explícitamente. Condiciones vigentes: sin mínimos (desde 12 unidades; aconsejable 24 por punto de venta); pago 30/60/90 días, con más de 24 unidades hasta 120 días; 15% extra pagando por transferencia o contado; bono 5% comprando por catálogo en pedidos de más de $1.000.000, hasta $300.000."
    : "";
  const messages = [{ role: "system", content: sistemaIRIS(tipoCliente, canal, ingles, rag, token, vendCod) + reglaCampana }, ...historial];

  const salida = await llamarGroq(messages);
  if (!salida) return responder(conversacionId, canal, await derivar("llm_error", conversacionId, texto, tipoCliente, vendCod), ultimasBot);

  if (salida.includes("⟦DERIVAR⟧")) {
    const limpio = pulir(salida.replace(/⟦DERIVAR⟧/g, "").trim(), tipoCliente, token, false);
    if (prueba) return responder(conversacionId, canal, { texto: limpio || acuseDerivada.texto }, ultimasBot);
    await supabase.from("derivaciones").insert({ conversacion_id: conversacionId, motivo: "iris_deriva", resumen: texto.slice(0, 480), estado: "pendiente", tipo_cliente: tipoCliente !== "desconocido" ? tipoCliente : null, asignado_a: await vendedorId(vendCod) });
    await supabase.from("at_conversaciones").update({ estado: "derivada" }).eq("id", conversacionId);
    return responder(conversacionId, canal, { texto: limpio || (ingles ? "An advisor will continue shortly 🙌" : `${vendCod} sigue con esto — ${cuando()} 🙌`), derivar: { motivo: "iris_deriva", resumen: texto } }, ultimasBot);
  }
  return responder(conversacionId, canal, { texto: pulir(salida, tipoCliente, token) }, ultimasBot);
}

Deno.serve(handler);
