// Escalón 2 de la cascada: reglas/regex sobre patrones frecuentes.
// Devuelven una intención canónica (misma clave que en base_conocimiento
// y que los ids de las filas del menú), sin costo de tokens.

export interface Regla {
  intencion: string;
  re: RegExp;
}

// El orden importa: primero patrones específicos, luego genéricos.
// (La detección de escalamiento se corre ANTES que esto, en el handler.)
const REGLAS: Regla[] = [
  { intencion: "saludo", re: /^\s*(hola|holis|buenas|buen d[ií]a|buenas tardes|buenas noches|hey|q onda|que onda|buenos d[ií]as)\b/i },
  { intencion: "estado_pedido", re: /\b(mi pedido|estado (de|del)? ?pedido|d[oó]nde est[aá].*pedido|seguimiento|track|cu[aá]ndo (llega|sale) mi)\b/i },
  { intencion: "preventa", re: /\bpreventa|colecci[oó]n 2026\b/i },
  { intencion: "propuestas_comerciales", re: /\b(plan canje|canje|propuesta|bienvenida|recuperar|preventa colecci)\b/i },
  { intencion: "como_ser_cliente", re: /\b(ser cliente|vender orbital|revend|distribu|mayorista|abrir (una )?cuenta|quiero vender|tener orbital en mi)\b/i },
  { intencion: "condiciones_generales", re: /\b(condicion|forma de pago|formas de pago|financ|cuotas|pago a|plazo de pago)\b/i },
  { intencion: "zona_vendedor", re: /\b(vendedor|qui[eé]n me atiende|representante|asesor de zona|mi zona)\b/i },
  { intencion: "precios", re: /\b(precio|precios|cu[aá]nto (sale|cuesta|vale|salen|cuestan)|lista de precio|valores|cotiza)\b/i },
  { intencion: "stock", re: /\b(stock|disponib|hay .*(negro|marr[oó]n|carey|modelo)|ten[eé]s .*(negro|marr[oó]n))\b/i },
  { intencion: "tecnologia_lentes", re: /\b(blue ?cut|blue ?light|luz azul|uv ?400|uv400|vsl|infrarrojo|polariz|filtro|420 ?nm)\b/i },
  { intencion: "catalogo_modelos", re: /\b(modelo|modelos|ascari|civic|casa blanca|5th|quinta avenida|cat[aá]logo|anteojos|lentes de sol|armazon|xylon)\b/i },
  { intencion: "cuidado_producto", re: /\b(limpi|c[oó]mo cuid|cuidado|se raya|rayar|pa[ñn]o|estuche)\b/i },
  { intencion: "garantia", re: /\bgarant[ií]a\b/i },
  { intencion: "donde_comprar", re: /\b(d[oó]nde (compro|consigo|venden|encuentro)|comprar orbital|[oó]ptica (cerca|m[aá]s cercana)|d[oó]nde los venden)\b/i },
  { intencion: "redes_contacto", re: /\b(instagram|redes|ig\b|face|mail|correo|tel[eé]fono|web|p[aá]gina|contacto)\b/i },
  { intencion: "horarios", re: /\b(horario|horarios|atienden|abren|abiertos|hasta qu[eé] hora)\b/i },
  { intencion: "direccion", re: /\b(direcci|d[oó]nde queda|d[oó]nde est[aá]n|ubicaci|showroom|local)\b/i },
];

export function clasificarTexto(texto: string): string | null {
  const t = texto.trim();
  for (const r of REGLAS) {
    if (r.re.test(t)) return r.intencion;
  }
  return null;
}

// Detección de escalamiento por contenido. Devuelve el motivo o null.
// Se evalúa ANTES de la clasificación normal: un reclamo gana a cualquier FAQ.
const ESCALA: Array<{ motivo: string; re: RegExp }> = [
  { motivo: "cobranza", re: /\b(cobranza|deuda|saldo (pendiente|deudor)|pagar (la )?factura|vencimiento|impago|refinanci)\b/i },
  { motivo: "devolucion", re: /\b(devoluci[oó]n|devolver|quiero devolver|cambio por otro|nota de cr[eé]dito)\b/i },
  { motivo: "reclamo", re: /\b(rotur|se rompi|roto|falla|fallado|fallada|defect|no funciona|vino mal|lleg[oó] mal|error.*factur|factura(do)? mal|reclamo|queja)\b/i },
  { motivo: "garantia_gestion", re: /\bgarant[ií]a\b.*\b(romp|roto|falla|gestion|reclam|hacer valer|cubre esto)\b/i },
  { motivo: "precio_especial", re: /\b(precio especial|descuento especial|fuera de lista|mejor precio|condici[oó]n especial|bonific)\b/i },
  { motivo: "pedido_humano", re: /\b(hablar con (alguien|una persona|un humano|un vendedor|un asesor|el equipo)|persona real|atenci[oó]n humana|un asesor real|no un bot|dejar de ser bot)\b/i },
];

export function detectarEscalamiento(texto: string): string | null {
  const t = texto.trim();
  for (const e of ESCALA) {
    if (e.re.test(t)) return e.motivo;
  }
  return null;
}
