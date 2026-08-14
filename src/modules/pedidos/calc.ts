import { EstadoPedido, Pedido, PedidoItem, StockItem } from '../../lib/types'

// Modelo de precios real: el precio de stock ES el precio ÓPTICO (lista 5) y se aplica a TODOS los clientes.
// Los únicos con precio distinto son los DISTRIBUIDORES (nro_lista = 1), que pagan el óptico ÷ 1,41.
// Shopify va por precio público (item.precio) y no pasa por esta función.
export const FACTOR_DISTRIBUIDOR = 1.41

export function getPrecioLista(precioBase: number, nroLista: number | null): number {
  if (nroLista === 1) return Math.round(precioBase / FACTOR_DISTRIBUIDOR) // distribuidor
  return Math.round(precioBase) // óptico (lista 5) para todos los demás
}

// Precio BRUTO unitario (antes de descuentos): lista, o preventa, o Shopify-neto. Sin cargo = 0.
export function brutoUnitario(item: PedidoItem, precioBase: number, nroLista: number | null): number {
  if (item.regalo) return 0
  if (item.precio !== undefined && item.precio !== null) return Math.round(item.precio / 1.21) // Shopify (ya con IVA)
  if (item.preventa && item.precio_pv != null) return item.precio_pv
  return precioBase > 0 ? getPrecioLista(precioBase, nroLista ?? 5) : 0
}

// Descuento COMERCIAL del ítem, en %. Es el único que se hornea en el precio (define el neto a remitir/facturar).
// El financiero NO entra acá: va aparte como NC "Diferencia de Precios" (ver financieroUnitario).
// Reglas: sin cargo = 100%; preventa = 0 (precio fijo, sin comercial); lista = comercial; Shopify = 0.
export function descuentoItemPct(item: PedidoItem, dc: number, _df: number): number {
  if (item.regalo) return 100
  if (item.precio !== undefined && item.precio !== null) return 0 // Shopify: precio cerrado
  if (item.preventa && item.precio_pv != null) return 0 // preventa: precio fijo, sin comercial
  return Math.round(dc)
}

// Precio NETO unitario (después del descuento COMERCIAL), idéntico en resumen, remito, factura y Tango.
// El descuento FINANCIERO NO se hornea acá: es condicional al pago y se materializa como NC posterior.
// Preventa: precio fijo (precio_pv), sin comercial ni financiero horneado.
export function netoUnitario(item: PedidoItem, precioBase: number, nroLista: number | null, dc: number, _df: number): number {
  if (item.regalo) return 0
  if (item.precio !== undefined && item.precio !== null) return Math.round(item.precio / 1.21) // Shopify (ya con IVA, sin dtos)
  if (item.preventa && item.precio_pv != null) return Math.round(item.precio_pv) // preventa: precio fijo
  const precioLista = precioBase > 0 ? getPrecioLista(precioBase, nroLista ?? 5) : 0
  return Math.round(precioLista * (1 - dc / 100)) // solo comercial
}

// Descuento FINANCIERO por unidad. NO se hornea en el precio ni va a la factura.
// Es condicional al cumplimiento del pago pactado (efectivo/transferencia): Administración genera
// una NC "Diferencia de Precios" por este monto cuando el cobro se cumple.
// Se calcula SOBRE el neto comercial → por eso comercial + financiero NO se suman (cascada).
export function financieroUnitario(item: PedidoItem, precioBase: number, nroLista: number | null, dc: number, df: number): number {
  if (df <= 0 || item.regalo) return 0
  if (item.precio !== undefined && item.precio !== null) return 0 // Shopify: precio cerrado, sin financiero
  const netoCom = netoUnitario(item, precioBase, nroLista, dc, df)
  return Math.round(netoCom * (df / 100))
}

// Total del descuento financiero de un pedido = monto de la NC "Diferencia de Precios" (si cumple el pago).
export function calcFinanciero(
  items: PedidoItem[] | null,
  stock: StockItem[],
  dtoCom: string | null,
  dtoFin: string | null,
  nroLista?: number | null
): number {
  const df = parseFloat(dtoFin || '') || 0
  if (df <= 0) return 0
  const dc = parseFloat(dtoCom || '') || 0
  let total = 0
  for (const it of items ?? []) {
    if (it.regalo) continue
    const precioBase = stock.find((x) => x.codigo === it.codigo)?.precio || 0
    total += financieroUnitario(it, precioBase, nroLista ?? 5, dc, df) * it.cantidad
  }
  return Math.round(total)
}

export function calcImporte(
  items: PedidoItem[] | null,
  stock: StockItem[],
  dtoCom: string | null,
  dtoFin: string | null,
  nroLista?: number | null
): { bruto: number; neto: number } {
  const lista = items ?? []
  // Pedido de Shopify: precio ya cerrado (con IVA), sin descuentos comerciales.
  const esShopify = lista.some((i) => !i.regalo && i.precio !== undefined && i.precio !== null)
  if (esShopify) {
    let bruto = 0
    for (const it of lista) if (!it.regalo && it.precio != null) bruto += it.precio * it.cantidad
    return { bruto: Math.round(bruto), neto: Math.round(bruto / 1.21) }
  }
  // Pedido B2B: se suma línea por línea (mismo redondeo que el remito de Tango).
  const dc = parseFloat(dtoCom || '') || 0
  const df = parseFloat(dtoFin || '') || 0
  let bruto = 0
  let neto = 0
  for (const item of lista) {
    if (item.regalo) continue
    const precioBase = stock.find((x) => x.codigo === item.codigo)?.precio || 0
    bruto += brutoUnitario(item, precioBase, nroLista ?? 5) * item.cantidad
    neto += netoUnitario(item, precioBase, nroLista ?? 5, dc, df) * item.cantidad
  }
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
