import { EstadoPedido, Pedido, PedidoItem, StockItem } from '../../lib/types'

export const LISTA_FACTORES: Record<number, number> = {
  0: 0.7, 1: 0.75, 2: 0.8, 3: 0.85, 4: 0.9,
  5: 1.0, 6: 1.05, 7: 1.1, 8: 1.15,
  10: 1.2, 13: 1.3, 99: 0.6,
}

export function getPrecioLista(precioBase: number, nroLista: number | null): number {
  const factor = LISTA_FACTORES[nroLista ?? 5] ?? 1.0
  return Math.round(precioBase * factor)
}

export function calcImporte(
  items: PedidoItem[] | null,
  stock: StockItem[],
  dtoCom: string | null,
  dtoFin: string | null,
  nroLista?: number | null
): { bruto: number; neto: number } {
  let bruto = 0
  let esShopify = false
  for (const item of items ?? []) {
    if (item.precio !== undefined && item.precio !== null) {
      // Precio real ya pagado por el cliente (pedidos de Shopify) — no se reescala por lista de Orbital.
      esShopify = true
      bruto += item.precio * item.cantidad
      continue
    }
    // Preventa: el vendedor eligió el precio especial para este ítem (no se reescala por lista).
    if (item.preventa && item.precio_pv != null) {
      bruto += item.precio_pv * item.cantidad
      continue
    }
    const s = stock.find((x) => x.codigo === item.codigo)
    const precioBase = s ? s.precio || 0 : 0
    const precio = precioBase > 0 ? getPrecioLista(precioBase, nroLista ?? 5) : 0
    bruto += precio * item.cantidad
  }
  if (esShopify) {
    // El precio de Shopify ya incluye IVA (venta 100% blanco): el neto es el bruto sin ese 21%,
    // no bruto menos descuento comercial/financiero (esos no aplican a una venta ya cerrada).
    return { bruto: Math.round(bruto), neto: Math.round(bruto / 1.21) }
  }
  const dc = parseFloat(dtoCom || '') || 0
  const df = parseFloat(dtoFin || '') || 0
  const neto = bruto * (1 - dc / 100) * (1 - df / 100)
  return { bruto: Math.round(bruto), neto: Math.round(neto) }
}

export function calcImporteConIVA(neto: number, blancoPct: number | null) {
  const pctB = (blancoPct ?? 100) / 100
  const pctN = 1 - pctB
  const montoBlanco = neto * pctB
  const montoNegro = neto * pctN
  return {
    sinIVA: Math.round(neto),
    conIVA: Math.round(montoBlanco * 1.21 + montoNegro),
    ivaImporte: Math.round(montoBlanco * 0.21),
  }
}

export interface CuotaFP {
  dias: number
  pct: number // 0-1
}

export function parseFP(condPago: string | null, cuotasDetalle: string | null): CuotaFP[] {
  if (cuotasDetalle) {
    try {
      const arr = JSON.parse(cuotasDetalle) as { dias: number | string; pct: number | string }[]
      return arr.map((c) => ({
        dias: parseInt(String(c.dias)) || 0,
        pct: (parseFloat(String(c.pct)) || 0) / 100,
      }))
    } catch {
      /* sigue */
    }
  }
  if (condPago && condPago.includes('d-') && condPago.includes('%')) {
    const parts = condPago.split('|')[0].trim().split('/')
    const parsed = parts
      .map((p) => {
        const m = p.trim().match(/(\d+)d-([\d.]+)%/)
        return m ? { dias: parseInt(m[1]), pct: parseFloat(m[2]) / 100 } : null
      })
      .filter(Boolean) as CuotaFP[]
    if (parsed.length) return parsed
  }
  const planes: Record<string, CuotaFP[]> = {
    FP01: [{ dias: 0, pct: 1 }],
    FP02: [{ dias: 30, pct: 1 }],
    FP03: [
      { dias: 30, pct: 0.5 },
      { dias: 60, pct: 0.5 },
    ],
    FP04: [
      { dias: 30, pct: 0.5 },
      { dias: 60, pct: 0.25 },
      { dias: 90, pct: 0.25 },
    ],
    FP05: [
      { dias: 30, pct: 0.4 },
      { dias: 60, pct: 0.2 },
      { dias: 90, pct: 0.2 },
      { dias: 120, pct: 0.2 },
    ],
    FP08: [
      { dias: 60, pct: 0.5 },
      { dias: 90, pct: 0.5 },
    ],
    FP11: [{ dias: 60, pct: 1 }],
  }
  const key = (condPago || '').match(/FP\d+/)
  return key ? (planes[key[0]] ?? [{ dias: 30, pct: 1 }]) : [{ dias: 30, pct: 1 }]
}

export function estadoLabel(e: EstadoPedido | null | undefined): string {
  const m: Record<string, string> = {
    pendiente: '⏳ Pendiente',
    en_preparacion: '🔧 En preparación',
    observado: '⚠ Observado',
    listo: '✓ Listo p/facturar',
    facturado: '📄 Facturado',
    listo_despachar: '📦 Listo p/despachar',
    despachado: '🚚 Despachado',
  }
  return m[e ?? 'pendiente'] ?? '⏳ Pendiente'
}

export const ESTADO_COLORS: Record<string, string> = {
  pendiente: '#e07020',
  en_preparacion: '#1a7abf',
  observado: '#c0392b',
  listo: '#2a9d5c',
  facturado: '#4a4adf',
  listo_despachar: '#7b2ff7',
  despachado: '#c8a96e',
}

export function importeDe(p: Pedido, stock: StockItem[]): number {
  const imp = calcImporte(p.items, stock, p.dto_comercial, p.dto_financiero, p.nro_lista)
  return imp.neto || p.importe_neto || 0
}

// Condición de entrega combinable: canal (por dónde sale la mercadería) × momento del pago.
// Antes era una lista fija de 12 frases armadas; ahora se eligen las dos partes por separado
// y se arma la frase con labelEntrega() — así entran todas las combinaciones sin agregar textos.
export const ENTREGA_CANALES = [
  { id: 'retira_cliente', label: 'Retira el cliente en fábrica' },
  { id: 'retira_comisionista', label: 'Retira comisionista' },
  { id: 'retira_vendedor', label: 'Retira el vendedor' },
  { id: 'moto', label: 'Se envía por moto' },
  { id: 'expreso', label: 'Se manda por expreso' },
  { id: 'correo', label: 'Se manda por correo' },
] as const

export const ENTREGA_PAGOS = [
  { id: 'anterior', label: 'Paga antes (cobranza anterior)' },
  { id: 'contra_entrega', label: 'Paga contra entrega' },
  { id: 'posterior', label: 'Paga después (cobranza posterior)' },
  { id: 'cta_corriente', label: 'Queda en cuenta corriente' },
] as const

export type EntregaCanalId = (typeof ENTREGA_CANALES)[number]['id']
export type EntregaPagoId = (typeof ENTREGA_PAGOS)[number]['id']

/** Frase que se guarda en pedidos.cond_entrega y ve depósito/logística. */
export function labelEntrega(canal: string, pago: string): string {
  const c = ENTREGA_CANALES.find((x) => x.id === canal)?.label ?? ''
  const p = ENTREGA_PAGOS.find((x) => x.id === pago)?.label ?? ''
  return [c, p].filter(Boolean).join(' · ')
}

// Instrumento con el que paga el cliente. Es multicheck: un mismo pedido puede
// pagarse en parte por transferencia y en parte con cheques/e-checks.
export const MEDIOS_PAGO = [
  { id: 'efectivo', label: 'Efectivo' },
  { id: 'transferencia', label: 'Transferencia' },
  { id: 'cheque', label: 'Cheque' },
  { id: 'echeck', label: 'eCheck' },
] as const

export type MedioPagoId = (typeof MEDIOS_PAGO)[number]['id']

export function labelMedios(medios: string[]): string {
  return medios.map((m) => MEDIOS_PAGO.find((x) => x.id === m)?.label ?? m).join(' + ')
}

export function qtyClass(n: number): string {
  if (n >= 50) return 'bg-emerald-100 text-emerald-700'
  if (n >= 15) return 'bg-amber-100 text-amber-700'
  return 'bg-red-100 text-red-700'
}
