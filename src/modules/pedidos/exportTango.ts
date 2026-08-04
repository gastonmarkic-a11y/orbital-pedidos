import type { Pedido, PedidoItem } from '../../lib/types'
import { supabase } from '../../lib/supabase'
import { getPrecioLista } from './calc'

// Exporta pedidos al formato "Novedades para pedidos" de Tango (Pedidos automáticos).
// Genera DOS archivos: Plenorius (parte blanca) y Ejemplar (parte negra).
// El pedido se reparte por MONTOS: cada artículo entero se deriva a una empresa,
// eligiendo la combinación que deje los totales lo más cerca posible del % blanco/negro.
// Precios = los de la app (netos); Tango aplica el IVA en cada empresa según su config.
// La librería xlsx se carga en forma diferida (solo al exportar).

const COLUMNAS = [
  'Fecha desde',
  'Fecha hasta',
  'Código de artículo',
  'Descripción de artículo',
  'Descripción adicional de artículo',
  'Es kit',
  'Kit completo',
  'UM',
  'Cantidad pedida',
  'Precio',
  'Bonificación',
  'Código de cliente',
  'Razón social de cliente',
  'Código de modelo',
  'Descripción de modelo',
] as const

// Estados en los que depósito ya confirmó el pedido (listo para remitir en adelante).
const ESTADOS_CONFIRMADOS = ['listo', 'listo_despachar', 'despachado', 'facturado']

export interface ConfigEmpresa {
  codigoModelo: string
  descModelo: string
}
export interface ConfigTango {
  blanco: ConfigEmpresa // Plenorius
  negro: ConfigEmpresa // Ejemplar
}
export interface ResultadoExport {
  pedidos: number
  exportados: number[] // ids que se marcan como exportados
  lineasBlanco: number
  lineasNegro: number
  omitidos: number
}

interface Linea {
  it: PedidoItem
  precio: number // neto unitario (precio de la app)
  monto: number // precio * cantidad
}

// "3/8/2026, 06:43:40" | "03/08/2026" -> "03/08/2026"
function normFecha(f: string | null): string {
  if (!f) return ''
  const parte = f.split(',')[0].trim()
  const m = parte.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/)
  if (!m) return parte
  const yyyy = m[3].length === 2 ? '20' + m[3] : m[3]
  return `${m[1].padStart(2, '0')}/${m[2].padStart(2, '0')}/${yyyy}`
}

// "020085 - Liderman Fabian Aldo" -> "Liderman Fabian Aldo"
function razonSocial(cliente: string | null, cod: string | null): string {
  if (!cliente) return ''
  return cliente.replace(/^\s*[\w-]+\s*-\s*/, '') || cod || ''
}

// Precio neto unitario tal como lo calcula la app (lista + descuentos, o preventa, o Shopify).
function precioNetoUnitario(it: PedidoItem, stockMap: Map<string, number>, nroLista: number, dc: number, df: number): number {
  if (it.precio !== undefined && it.precio !== null) {
    // Shopify: el precio ya incluye IVA y no lleva descuentos comerciales.
    return Math.round(it.precio / 1.21)
  }
  let base: number
  if (it.preventa && it.precio_pv != null) {
    base = it.precio_pv
  } else {
    const b = stockMap.get(it.codigo) ?? 0
    base = b > 0 ? getPrecioLista(b, nroLista) : 0
  }
  const neto = base * (1 - dc / 100) * (1 - df / 100)
  return Math.round(neto)
}

// Reparte las líneas en blanco/negro por monto, acercándose al target de la parte blanca.
// Greedy sobre líneas ordenadas de mayor a menor: agrega a blanco mientras eso acerque el total al target.
function repartir(lineas: Linea[], targetBlanco: number): { blanco: Linea[]; negro: Linea[] } {
  const orden = [...lineas].sort((a, b) => b.monto - a.monto)
  const blanco: Linea[] = []
  const negro: Linea[] = []
  let sum = 0
  for (const l of orden) {
    const acercaSinPasar = sum + l.monto <= targetBlanco
    const acercaPasando = Math.abs(sum + l.monto - targetBlanco) < Math.abs(sum - targetBlanco)
    if (acercaSinPasar || acercaPasando) {
      blanco.push(l)
      sum += l.monto
    } else {
      negro.push(l)
    }
  }
  return { blanco, negro }
}

function fila(l: Linea, fecha: string, rs: string, p: Pedido, emp: ConfigEmpresa): (string | number)[] {
  return [
    fecha, // Fecha desde
    fecha, // Fecha hasta
    l.it.codigo, // Código de artículo
    l.it.descripcion ?? l.it.modelo ?? '', // Descripción de artículo
    l.it.modelo ?? '', // Descripción adicional de artículo
    'No', // Es kit
    '', // Kit completo
    '', // UM (Tango toma la del artículo)
    l.it.cantidad, // Cantidad pedida
    l.precio, // Precio (neto de la app; el IVA lo pone Tango)
    '', // Bonificación (ya está aplicada en el precio)
    p.cod_cliente ?? '', // Código de cliente
    rs, // Razón social de cliente
    emp.codigoModelo, // Código de modelo
    emp.descModelo, // Descripción de modelo
  ]
}

export async function exportarPedidosTango(pedidos: Pedido[], cfg: ConfigTango): Promise<ResultadoExport> {
  const XLSX = await import('xlsx')

  // Solo pedidos B2B confirmados por depósito y no exportados aún.
  // Los pedidos de la tienda online (vendedor = 'Tienda', Shopify) NO van a Tango:
  // el e-commerce se factura por Contabilium (conector nativo de Shopify).
  const elegibles = pedidos.filter(
    (p) =>
      p.vendedor !== 'Tienda' &&
      ESTADOS_CONFIRMADOS.includes(p.estado ?? '') &&
      !p.exportado_tango_at &&
      p.cod_cliente &&
      p.items &&
      p.items.length > 0
  )

  // Precios base del stock para los ítems B2B (sin precio explícito).
  const codigos = new Set<string>()
  for (const p of elegibles) {
    for (const it of p.items ?? []) {
      const tienePrecio = it.precio != null || (it.preventa && it.precio_pv != null)
      if (!tienePrecio && it.codigo) codigos.add(it.codigo)
    }
  }
  const stockMap = new Map<string, number>()
  if (codigos.size) {
    const { data } = await supabase.from('stock').select('codigo, precio').in('codigo', [...codigos])
    for (const s of (data as { codigo: string; precio: number | null }[]) ?? []) stockMap.set(s.codigo, s.precio ?? 0)
  }

  const filasB: (string | number)[][] = [COLUMNAS as unknown as string[]]
  const filasN: (string | number)[][] = [COLUMNAS as unknown as string[]]
  const exportados: number[] = []
  let omitidos = pedidos.length - elegibles.length

  for (const p of elegibles) {
    const nroLista = p.nro_lista ?? 5
    const dc = parseFloat(p.dto_comercial || '') || 0
    const df = parseFloat(p.dto_financiero || '') || 0
    const lineas: Linea[] = (p.items ?? [])
      .filter((it) => it.codigo && it.cantidad)
      .map((it) => {
        const precio = precioNetoUnitario(it, stockMap, nroLista, dc, df)
        return { it, precio, monto: precio * it.cantidad }
      })
    if (!lineas.length) {
      omitidos++
      continue
    }
    const total = lineas.reduce((a, l) => a + l.monto, 0)
    const blancoPct = (p.blanco_pct ?? 100) / 100
    const { blanco, negro } = repartir(lineas, total * blancoPct)
    const fecha = normFecha(p.fecha)
    const rs = razonSocial(p.cliente, p.cod_cliente)
    for (const l of blanco) filasB.push(fila(l, fecha, rs, p, cfg.blanco))
    for (const l of negro) filasN.push(fila(l, fecha, rs, p, cfg.negro))
    exportados.push(p.id)
  }

  const fechaArch = normFecha(new Date().toLocaleDateString('es-AR')).replace(/\//g, '-')
  if (filasB.length > 1) {
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(filasB), 'Novedades')
    XLSX.writeFile(wb, `PLENORIUS_blanco_${fechaArch}.xlsx`)
  }
  if (filasN.length > 1) {
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(filasN), 'Novedades')
    XLSX.writeFile(wb, `EJEMPLAR_negro_${fechaArch}.xlsx`)
  }

  return {
    pedidos: exportados.length,
    exportados,
    lineasBlanco: filasB.length - 1,
    lineasNegro: filasN.length - 1,
    omitidos,
  }
}
