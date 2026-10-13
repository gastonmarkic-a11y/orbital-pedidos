// ── Escalera por volumen: paquetes de condiciones según unidades del pedido ──
// Cuadro aprobado 13/10/2026 (master nov 2026 corregido). Aplica al catálogo de ópticas y a la carga de vendedores.
// La bonificación comercial es por VOLUMEN y va siempre, pague como pague. El plazo con cheques crece con el volumen.
// Contado/transferencia: CONTADO_PCT financiero en cascada sobre el neto comercial (NC al cobrar), sin plazo.
// Las piezas sin cargo son del Pack (pack.ts).

export interface Escalon { desde: number; pct: number; plazo: string; paquete: string }

export const ESCALERA: Escalon[] = [
  { desde: 1,   pct: 0,  plazo: '30/60/90',             paquete: 'Inicial' },
  { desde: 24,  pct: 5,  plazo: '30/60/90/120',         paquete: 'Básico' },
  { desde: 36,  pct: 7,  plazo: '30/60/90/120/150',     paquete: 'Intermedio' },
  { desde: 60,  pct: 7,  plazo: '30/60/90/120/150',     paquete: 'Avanzado' },
  { desde: 100, pct: 10, plazo: '30/60/90/120/150/180', paquete: 'Full' },
]
// Material de exhibición para el PDV según piezas de la compra: mismos cortes que los paquetes.
// img: la pieza nueva de ese escalón (public/pdv, sacadas del PDF de condiciones).
export interface Material { desde: number; nombre: string; detalle: string; img: string | null }
export const MATERIAL: Material[] = [
  { desde: 24,  nombre: 'POP para vidriera', detalle: 'POP para vidriera', img: '/pdv/pop-vidriera.webp' },
  { desde: 36,  nombre: 'exhibidor de vidriera', detalle: 'Exhibidor de vidriera + POP', img: '/pdv/exhibidor-vidriera.webp' },
  { desde: 60,  nombre: 'exhibidor de pie', detalle: 'Exhibidor de pie + exhibidor de vidriera + POP', img: '/pdv/exhibidor-pie.webp' },
  { desde: 100, nombre: 'gráficas a medida', detalle: 'Exhibidor de pie + exhibidor de vidriera + POP + gráficas a medida para la óptica', img: null },
]
export const materialDe = (u: number) => [...MATERIAL].reverse().find((m) => u >= m.desde) ?? null

export const CONTADO_PCT = 3

export const escalonDe = (u: number) => [...ESCALERA].reverse().find((e) => u >= e.desde) ?? ESCALERA[0]
/** "30/60/90/120" → "30, 60, 90 y 120 días" */
export const plazoTexto = (plazo: string) => {
  const p = plazo.split('/')
  return (p.length > 1 ? p.slice(0, -1).join(', ') + ' y ' + p[p.length - 1] : p[0]) + ' días'
}

export interface EscaleraCalc {
  unidades: number
  actual: Escalon
  proximo: Escalon | null     // próximo paquete
  faltan: number              // unidades para el próximo paquete
  premioProximo: string[]     // lo que suma el próximo paquete: descuento, plazo, material
  subio: Escalon | null       // paquete al que llegó desde que abrió el carrito (para festejarlo)
  premioSubio: string[]       // lo que ganó al llegar a ese paquete
  descuento: number           // $ comercial
  neto: number                // subtotal − comercial
  contado: number             // $ extra si paga contado
  netoContado: number
  plazo: string               // plazo con cheques del paquete
  material: Material | null           // material de exhibición que se lleva
  materialProximo: Material | null    // próximo material
  faltanMaterial: number              // unidades para el próximo material
}

/** Lo que gana la óptica al pasar del paquete `de` al `a`: más descuento, más plazo, material nuevo. */
export function premioPaquete(de: Escalon, a: Escalon): string[] {
  const out: string[] = []
  if (a.pct > de.pct) out.push(`${a.pct}% de descuento`)
  if (a.plazo.split('/').length > de.plazo.split('/').length) out.push(`pago a ${plazoTexto(a.plazo)}`)
  const m = materialDe(a.desde)
  if (m && m !== materialDe(de.desde)) out.push(m.nombre)
  return out
}

/** `unidadesAlAbrir`: lo que tenía el carrito al abrirlo; si desde ahí sube de paquete, se le comunica lo que ganó.
 *  `cerrado`: importe a precio cerrado (promo): suma unidades al paquete pero no lleva comercial ni contado. */
export function calcularEscalera(unidades: number, subtotal: number, unidadesAlAbrir = unidades, cerrado = 0): EscaleraCalc {
  const actual = escalonDe(unidades)
  const inicial = escalonDe(unidadesAlAbrir)
  const proximo = ESCALERA.find((e) => e.desde > unidades) ?? null
  const subio = actual.desde > inicial.desde ? actual : null
  const descuento = Math.round((subtotal - cerrado) * actual.pct / 100)
  const neto = subtotal - descuento
  const contado = Math.round((neto - cerrado) * CONTADO_PCT / 100)
  const materialProx = MATERIAL.find((m) => m.desde > unidades) ?? null
  return {
    unidades, actual, proximo,
    faltan: proximo ? proximo.desde - unidades : 0,
    premioProximo: proximo ? premioPaquete(actual, proximo) : [],
    subio, premioSubio: subio ? premioPaquete(inicial, subio) : [],
    descuento, neto, contado, netoContado: neto - contado,
    plazo: actual.plazo,
    material: materialDe(unidades),
    materialProximo: materialProx,
    faltanMaterial: materialProx ? materialProx.desde - unidades : 0,
  }
}

/** Línea para las observaciones del pedido: el vendedor ve qué condición eligió la óptica. */
export function escaleraObs(c: EscaleraCalc, pagaContado: boolean): string {
  return `📊 ESCALERA ${c.unidades} u. (paquete ${c.actual.paquete}) — comercial ${c.actual.pct}%` +
    (pagaContado ? ` · PAGA CONTADO/TRANSFERENCIA ${CONTADO_PCT}% (NC al cobrar)` : ` · plazo ${c.plazo}`) +
    (c.subio ? ` · 🎁 subió al paquete en el carrito` : '') +
    (c.material ? ` · 📦 MATERIAL PDV: ${c.material.detalle}` : '')
}
