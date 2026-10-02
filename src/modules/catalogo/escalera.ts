// ── Escalera por volumen: descuento comercial + plazo según unidades del pedido ──
// Propuesta 2026-09-28 (a validar con costos). Aplica al catálogo de ópticas sin pack ni bono.
// El volumen da SOLO descuento comercial; las piezas sin cargo son del Pack (pack.ts).
// Plazo base: hasta 39 u. 30/60/90; desde 40 u. 30/60/90/120 (actualizado 2026-09-29).
// Premio del checkout: si en el carrito completa un escalón, +30 días (tope 150) → 24 u. 30/60/90/120 · 40+ 30/60/90/120/150.
// Contado/transferencia: financiero en cascada sobre el neto comercial (NC al cobrar).

export interface Escalon { desde: number; pct: number; plazo: string }

export const ESCALERA: Escalon[] = [
  { desde: 1,   pct: 0,  plazo: '30/60/90' },
  { desde: 24,  pct: 5,  plazo: '30/60/90' },
  { desde: 40,  pct: 7,  plazo: '30/60/90/120' },
  { desde: 60,  pct: 9,  plazo: '30/60/90/120' },
  { desde: 100, pct: 12, plazo: '30/60/90/120' },
  { desde: 200, pct: 15, plazo: '30/60/90/120' },
]
export const CONTADO_PCT = 15
export const PREMIO_DIAS = 30
export const PLAZO_TOPE = 150

const diasMax = (plazo: string) => Number(plazo.split('/').pop())
export const estirar = (plazo: string) => {
  const d = diasMax(plazo)
  return d + PREMIO_DIAS > PLAZO_TOPE ? plazo : `${plazo}/${d + PREMIO_DIAS}`
}
const escalonDe = (u: number) => [...ESCALERA].reverse().find((e) => u >= e.desde) ?? ESCALERA[0]

export interface EscaleraCalc {
  unidades: number
  actual: Escalon
  proximo: Escalon | null
  faltan: number              // unidades para el próximo escalón
  descuento: number           // $ comercial
  neto: number                // subtotal − comercial
  contado: number             // $ extra si paga contado
  netoContado: number
  premio: boolean             // ya completó un escalón en el checkout
  plazo: string               // plazo final (con premio si lo ganó)
  plazoProximo: string        // plazo que tendría al llegar al próximo escalón
}

/** `unidadesAlAbrir`: lo que tenía el carrito al abrirlo; si sube de escalón desde ahí, gana el premio.
 *  `cerrado`: importe a precio cerrado (promo Día de la Madre): suma unidades al escalón pero no lleva comercial ni contado. */
export function calcularEscalera(unidades: number, subtotal: number, unidadesAlAbrir: number, cerrado = 0): EscaleraCalc {
  const actual = escalonDe(unidades)
  const proximo = ESCALERA.find((e) => e.desde > unidades) ?? null
  const premio = actual.desde > escalonDe(unidadesAlAbrir).desde
  const descuento = Math.round((subtotal - cerrado) * actual.pct / 100)
  const neto = subtotal - descuento
  const contado = Math.round((neto - cerrado) * CONTADO_PCT / 100)
  return {
    unidades, actual, proximo,
    faltan: proximo ? proximo.desde - unidades : 0,
    descuento, neto, contado, netoContado: neto - contado,
    premio,
    plazo: premio ? estirar(actual.plazo) : actual.plazo,
    plazoProximo: proximo ? estirar(proximo.plazo) : '',
  }
}

/** Línea para las observaciones del pedido: el vendedor ve qué condición eligió la óptica. */
export function escaleraObs(c: EscaleraCalc, pagaContado: boolean): string {
  return `📊 ESCALERA ${c.unidades} u. — comercial ${c.actual.pct}%` +
    (pagaContado ? ` · PAGA CONTADO/TRANSFERENCIA ${CONTADO_PCT}% (NC al cobrar)`
      : ` · plazo ${c.plazo}` + (c.premio ? ` (🎁 +${PREMIO_DIAS} días por completar escalón en el checkout)` : ''))
}
