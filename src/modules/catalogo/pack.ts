// ── Pack de Bienvenida: piezas sin cargo en función de las unidades de LÍNEA ──
// Regla comercial (2026-09-07): a partir de 12 piezas de línea se desbloquea el 25 %
// en piezas sin cargo — 1 cada 4 —, que se eligen de la sección Oportunidades.
//   12 → 3 · 16 → 4 · 20 → 5 · 24 → 6 (el pack del PDF) · 40 → 10
// A diferencia del bono de campaña (bono.ts), que corre por MONTO del carrito, esto
// corre por UNIDADES y no depende de ningún token: se activa con ?pack=bienvenida.

export const PACK_MIN_LINEA = 12   // piso para que empiece a haber piezas sin cargo
export const PACK_CADA = 4         // 1 sin cargo cada 4 de línea = 25 %

/** Una variante es "de oportunidad" si su clasificación es la de esa sección del catálogo. */
export const esOportunidad = (clasificacion: string | null | undefined) =>
  (clasificacion || '').toLowerCase().includes('oportunidad')

export interface PackCalc {
  linea: number            // unidades de línea en el carrito
  oportunidad: number      // unidades de oportunidad en el carrito
  sinCargo: number         // piezas sin cargo desbloqueadas por las de línea
  eligio: number           // de las sin cargo, cuántas ya eligió
  faltanElegir: number     // sin cargo desbloqueadas que todavía no eligió
  seFacturan: number       // oportunidades por encima de las sin cargo (se cobran)
  faltaLinea: number       // unidades de línea para el próximo escalón (0 si no hay)
  proximoSinCargo: number  // cuántas sin cargo daría ese próximo escalón
  progreso: number         // 0..1 hacia el próximo escalón, para la barra
}

/** Piezas sin cargo que corresponden a esa cantidad de unidades de línea. */
export function sinCargoPara(linea: number): number {
  if (linea < PACK_MIN_LINEA) return 0
  return Math.floor(linea / PACK_CADA)
}

export function calcularPack(linea: number, oportunidad: number): PackCalc {
  const sinCargo = sinCargoPara(linea)

  // Próximo escalón: llegar al piso, o completar los siguientes 4 de línea.
  const objetivo = linea < PACK_MIN_LINEA
    ? PACK_MIN_LINEA
    : (Math.floor(linea / PACK_CADA) + 1) * PACK_CADA
  const faltaLinea = objetivo - linea
  const proximoSinCargo = sinCargoPara(objetivo)

  // Piso del tramo actual, para que la barra no arranque siempre de cero.
  const piso = linea < PACK_MIN_LINEA ? 0 : Math.floor(linea / PACK_CADA) * PACK_CADA
  const progreso = Math.min(1, Math.max(0, (linea - piso) / Math.max(1, objetivo - piso)))

  return {
    linea,
    oportunidad,
    sinCargo,
    eligio: Math.min(oportunidad, sinCargo),
    faltanElegir: Math.max(0, sinCargo - oportunidad),
    seFacturan: Math.max(0, oportunidad - sinCargo),
    faltaLinea,
    proximoSinCargo,
    progreso,
  }
}

/** Línea para las observaciones del pedido, para que el vendedor sepa qué aplicar. */
export function packObs(c: PackCalc): string {
  return `🎁 PACK BIENVENIDA — ${c.linea} de línea + ${c.oportunidad} de oportunidad · ` +
    `${c.sinCargo} sin cargo de OPORTUNIDAD` +
    (c.seFacturan > 0 ? ` · ${c.seFacturan} de oportunidad se facturan` : '')
}
