/* Carga y derivación de datos del módulo financiero.
   Lo único que se guarda nuevo son las cuentas, los movimientos y los cheques.
   La cuenta corriente NO se carga a mano: se deriva de los pedidos ya facturados
   y sin cobrar, abriendo cada uno en sus cuotas según la forma de pago pactada. */

import { supabase } from '../../lib/supabase'
import { fetchPaged } from '../../lib/fetchAll'
import {
  ChequeCartera,
  CuentaFinanciera,
  MovimientoFinanciero,
  ParametrosFin,
  Pedido,
  StockItem,
} from '../../lib/types'
import { esPedidoShopify, importeDe, parseFP } from '../pedidos/calc'
import { ESTADOS_VIVOS, sumarDias, tramoDe, VencimientoCC } from '../../lib/finanzas'

/** Parámetros vigentes = la fila con vigente_desde más reciente que ya arrancó. */
export async function cargarParametros(): Promise<ParametrosFin | null> {
  const hoy = new Date().toISOString().slice(0, 10)
  const { data } = await supabase
    .from('parametros_financieros')
    .select('*')
    .lte('vigente_desde', hoy)
    .order('vigente_desde', { ascending: false })
    .order('id', { ascending: false })
    .limit(1)
  if (data && data.length) return data[0] as ParametrosFin
  // Si todavía no arrancó ninguna (alguien la cargó con fecha futura), se usa la última cargada.
  const { data: ultima } = await supabase
    .from('parametros_financieros')
    .select('*')
    .order('id', { ascending: false })
    .limit(1)
  return ((ultima?.[0] as ParametrosFin) ?? null) || null
}

export async function cargarCuentas(): Promise<CuentaFinanciera[]> {
  const { data } = await supabase
    .from('cuentas_financieras')
    .select('*')
    .order('orden')
    .order('id')
  return (data as CuentaFinanciera[]) ?? []
}

export async function cargarMovimientos(desde: string): Promise<MovimientoFinanciero[]> {
  return fetchPaged<MovimientoFinanciero>(() =>
    supabase.from('movimientos_financieros').select('*').gte('fecha', desde).order('fecha', { ascending: false })
  )
}

export async function cargarCheques(): Promise<ChequeCartera[]> {
  return fetchPaged<ChequeCartera>(() =>
    supabase.from('cheques_cartera').select('*').order('fecha_vencimiento')
  )
}

/** Ventas de los últimos 12 meses con dato cargado (B2B Tango + B2C). Denominador del DSO. */
export async function ventasUltimos12(): Promise<number> {
  const { data } = await supabase
    .from('ventas_hist_mes')
    .select('anio_mes, importe_ars')
    .order('anio_mes', { ascending: false })
    .limit(36)
  const filas = (data as { anio_mes: string; importe_ars: number }[]) ?? []
  const meses = [...new Set(filas.map((f) => f.anio_mes))].sort().reverse().slice(0, 12)
  return filas.filter((f) => meses.includes(f.anio_mes)).reduce((a, f) => a + Number(f.importe_ars || 0), 0)
}

/** Pedidos que forman la cuenta corriente: facturados, sin cobrar y mayoristas (la Tienda cobra al contado). */
export async function cargarPedidosCC(): Promise<{ pedidos: Pedido[]; stock: StockItem[] }> {
  const [{ data: peds }, stock] = await Promise.all([
    supabase.from('pedidos').select('*').not('fecha_factura', 'is', null),
    fetchPaged<StockItem>(() => supabase.from('stock').select('*')),
  ])
  return { pedidos: (peds as Pedido[]) ?? [], stock }
}

/** Abre cada factura impaga en sus vencimientos (cuotas de la forma de pago) y les calcula la mora. */
export function vencimientosDe(pedidos: Pedido[], stock: StockItem[], hoy = new Date()): VencimientoCC[] {
  const hoyMs = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate()).getTime()
  const out: VencimientoCC[] = []
  for (const p of pedidos) {
    if (p.cobrado) continue
    if (!p.fecha_factura) continue
    if (esPedidoShopify(p)) continue // B2C: no hay cuenta corriente
    const total = importeDe(p, stock)
    if (total <= 0) continue
    const cuotas = parseFP(p.cond_pago, p.cuotas_detalle)
    for (const c of cuotas) {
      const fechaVenc = sumarDias(p.fecha_factura, c.dias)
      const diasMora = Math.round((hoyMs - new Date(fechaVenc + 'T00:00:00').getTime()) / 86400000)
      out.push({
        pedidoId: p.id,
        cod: p.cod_cliente ?? '',
        cliente: (p.cliente ?? '').replace(/^\d+ - /, ''),
        vendedor: p.vendedor ?? '',
        fechaFactura: p.fecha_factura,
        fechaVenc,
        monto: Math.round(total * c.pct),
        diasMora,
        tramo: tramoDe(diasMora),
      })
    }
  }
  return out.sort((a, b) => a.fechaVenc.localeCompare(b.fechaVenc))
}

export function chequesVivos(cheques: ChequeCartera[]): ChequeCartera[] {
  return cheques.filter((c) => ESTADOS_VIVOS.includes(c.estado))
}

/** Caja disponible = saldo de todas las cuentas activas (bancos + MP + efectivo). */
export function cajaTotal(cuentas: CuentaFinanciera[]): number {
  return cuentas.filter((c) => c.activo).reduce((a, c) => a + Number(c.saldo_actual || 0), 0)
}

export const RAZON_OPCIONES = [
  { id: '', label: 'Todas las razones sociales' },
  { id: 'Ejemplar', label: 'Ejemplar' },
  { id: 'Plenorius', label: 'Plenorius' },
  { id: 'Plastic', label: 'Plastic' },
]
