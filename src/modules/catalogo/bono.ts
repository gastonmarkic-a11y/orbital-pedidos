// ── Bono de campaña: cálculo de escalones sobre el carrito del catálogo ──
// El bono vive en el TOKEN (tabla catalogo_bono), no en el catálogo: quien entra
// con la clave compartida o con el link de un vendedor no ve nada de esto.
// La escalera es data editable (bono_flujo), no código.

export interface Escalon { desde: number; valor: number }

export interface BonoEstado {
  bono_id: number
  flujo: string
  vence_at: string
  escalera_plata: Escalon[]
  escalera_piezas: Escalon[]
  financiero_pct: number
  clasif_piezas: string | null
  // Modo porcentaje (campaña Diferenciarte v2): pct sobre la compra sin IVA, desde `minimo`, con `tope`.
  modo?: 'escalera' | 'pct'
  pct?: number | null
  minimo?: number | null
  tope?: number | null
  contado_pct?: number | null
  contacto_nombre?: string | null
  contacto_wsp?: string | null
  campana?: string | null
}

export const esBonoPct = (b: BonoEstado | null | undefined): boolean => b?.modo === 'pct'

/** Importe de las piezas sin cargo del pack: se descuentan las oportunidades más baratas del carrito. */
export function importeSinCargo(items: { precio: number; cantidad: number; oportunidad?: boolean }[], sinCargo: number): number {
  const unidades = items.filter((i) => i.oportunidad).flatMap((i) => Array(i.cantidad).fill(i.precio) as number[]).sort((a, b) => a - b)
  return unidades.slice(0, Math.max(0, sinCargo)).reduce((a, p) => a + p, 0)
}

const fmt = (n: number) => '$' + Math.round(n).toLocaleString('es-AR')

function calcularBonoPct(total: number, bono: BonoEstado, unidadesCarrito: number, sinCargoImporte: number, vencido: boolean): BonoCalc {
  const pct = bono.pct ?? 0
  const min = bono.minimo ?? 0
  const tope = bono.tope ?? Number.POSITIVE_INFINITY
  const base = Math.max(0, total - sinCargoImporte)
  const bonoDe = (b: number) => (b > min ? Math.min(Math.round((b * pct) / 100), tope) : 0)
  const bonificacion = bonoDe(base)
  const neto = base - bonificacion
  const cpct = bono.contado_pct ?? bono.financiero_pct ?? 0
  const financiero = Math.round((neto * cpct) / 100)
  const precioPar = unidadesCarrito > 0 ? Math.round(total / unidadesCarrito) : PRECIO_PAR_REF

  let proximo: Proximo | null = null
  if (base <= min) {
    const falta = min + 1 - base
    proximo = { desde: min + 1, falta, pares: Math.max(1, Math.ceil(falta / Math.max(1, precioPar))),
      premio: `un bono del ${pct}% (desde ${fmt(bonoDe(min + 1))})`, progreso: min > 0 ? base / min : 0 }
  } else if (bonificacion < tope) {
    const pares = 2
    const falta = pares * precioPar
    proximo = { desde: base + falta, falta, pares, premio: `${fmt(bonoDe(base + falta) - bonificacion)} más de bono`,
      progreso: Number.isFinite(tope) ? bonificacion / tope : 1 }
  }
  return { bonificacion, piezas: 0, neto, financiero, pagaEfectivo: neto - financiero, seLleva: total, proximo, vencido }
}

export interface Proximo {
  desde: number
  falta: number
  pares: number          // estimado de pares que faltan, para el cartel guía
  premio: string         // qué desbloquea
  progreso: number       // 0..1 desde el escalón actual hasta el próximo
}

export interface BonoCalc {
  bonificacion: number     // $ de bonificación ya ganada
  piezas: number           // pares sin cargo ya desbloqueados
  neto: number             // total − bonificación
  financiero: number       // 10% sobre el neto (condicional al pago en efectivo)
  pagaEfectivo: number     // lo que termina pagando si paga en efectivo
  seLleva: number          // mercadería a precio de lista, incluidos los pares
  proximo: Proximo | null
  vencido: boolean
}

const PRECIO_PAR_REF = 45000  // fallback cuando el carrito está vacío

const ordenar = (e: Escalon[]) => [...(e || [])].sort((a, b) => a.desde - b.desde)

/** Escalón alcanzado con ese total (el más alto cuyo `desde` ya se superó). */
function alcanzado(esc: Escalon[], total: number): Escalon | null {
  let r: Escalon | null = null
  for (const e of ordenar(esc)) if (total >= e.desde) r = e
  return r
}

/** Primer escalón todavía no alcanzado. */
function siguiente(esc: Escalon[], total: number): Escalon | null {
  for (const e of ordenar(esc)) if (total < e.desde) return e
  return null
}

/** Monto del escalón anterior al que viene, para dibujar la barra de progreso. */
function pisoDe(bono: BonoEstado, hasta: number): number {
  const previos = [...ordenar(bono.escalera_plata), ...ordenar(bono.escalera_piezas)]
    .map((e) => e.desde)
    .filter((d) => d < hasta)
  return previos.length ? Math.max(...previos) : 0
}

export function calcularBono(
  total: number,
  bono: BonoEstado | null,
  unidadesCarrito = 0,
  sinCargoImporte = 0,
): BonoCalc | null {
  if (!bono) return null
  const vencido = new Date(bono.vence_at).getTime() <= Date.now()
  if (bono.modo === 'pct') return calcularBonoPct(total, bono, unidadesCarrito, sinCargoImporte, vencido)

  const plata = alcanzado(bono.escalera_plata, total)
  const piezasEsc = alcanzado(bono.escalera_piezas, total)
  const bonificacion = plata?.valor ?? 0
  const piezas = piezasEsc?.valor ?? 0

  const neto = Math.max(0, total - bonificacion)
  const financiero = Math.round((neto * (bono.financiero_pct || 0)) / 100)
  const pagaEfectivo = neto - financiero

  // Precio de referencia por par: lo que el cliente está poniendo de verdad en su carrito.
  const precioPar = unidadesCarrito > 0 ? Math.round(total / unidadesCarrito) : PRECIO_PAR_REF

  // El próximo hito es el escalón más cercano de cualquiera de las dos escaleras.
  const sigPlata = siguiente(bono.escalera_plata, total)
  const sigPiezas = siguiente(bono.escalera_piezas, total)
  const cand = [sigPlata, sigPiezas].filter(Boolean) as Escalon[]
  let proximo: Proximo | null = null

  if (cand.length) {
    const desde = Math.min(...cand.map((e) => e.desde))
    const enPlata = sigPlata?.desde === desde ? sigPlata : null
    const enPiezas = sigPiezas?.desde === desde ? sigPiezas : null
    const partes: string[] = []
    if (enPlata) partes.push(`una bonificación de $${enPlata.valor.toLocaleString('es-AR')}`)
    if (enPiezas) partes.push(`${enPiezas.valor} pares sin cargo`)

    const piso = pisoDe(bono, desde)
    proximo = {
      desde,
      falta: desde - total,
      pares: Math.max(1, Math.ceil((desde - total) / Math.max(1, precioPar))),
      premio: partes.join(' y '),
      progreso: Math.min(1, Math.max(0, (total - piso) / Math.max(1, desde - piso))),
    }
  }

  return {
    bonificacion,
    piezas,
    neto,
    financiero,
    pagaEfectivo,
    seLleva: total + piezas * precioPar,
    proximo,
    vencido,
  }
}

/** Cuenta regresiva legible: "47:12:05". Devuelve null si ya venció.
 *  Arriba de 4 días pasa a "12d 07:45" — un contador de tres dígitos de horas
 *  no se lee como urgencia, se lee como error. */
export function cuentaRegresiva(vence: string, ahora = Date.now()): string | null {
  const ms = new Date(vence).getTime() - ahora
  if (ms <= 0) return null
  const h = Math.floor(ms / 3600000)
  const m = Math.floor((ms % 3600000) / 60000)
  const s = Math.floor((ms % 60000) / 1000)
  const dd = (n: number) => String(n).padStart(2, '0')
  if (h >= 96) return `${Math.floor(h / 24)}d ${dd(h % 24)}:${dd(m)}`
  return `${dd(h)}:${dd(m)}:${dd(s)}`
}
