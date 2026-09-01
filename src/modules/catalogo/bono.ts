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
): BonoCalc | null {
  if (!bono) return null
  const vencido = new Date(bono.vence_at).getTime() <= Date.now()

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

/** Cuenta regresiva legible: "47:12:05". Devuelve null si ya venció. */
export function cuentaRegresiva(vence: string, ahora = Date.now()): string | null {
  const ms = new Date(vence).getTime() - ahora
  if (ms <= 0) return null
  const h = Math.floor(ms / 3600000)
  const m = Math.floor((ms % 3600000) / 60000)
  const s = Math.floor((ms % 60000) / 1000)
  const dd = (n: number) => String(n).padStart(2, '0')
  return `${dd(h)}:${dd(m)}:${dd(s)}`
}
