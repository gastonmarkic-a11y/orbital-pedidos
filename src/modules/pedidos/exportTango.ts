import type { Pedido } from '../../lib/types'

// Exporta pedidos al formato "Novedades para pedidos" de Tango (Pedidos automáticos).
// Genera un .xlsx con las columnas exactas que espera Tango; administración lo importa
// con Apertura → Excel, y luego Generación de pedidos los crea en Tango.
// La librería xlsx se carga en forma diferida (solo al exportar) para no inflar el bundle.

// Columnas EXACTAS de la grilla "Novedades para pedidos" (Tango 24.01).
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

export interface ConfigTango {
  /** Código del modelo de pedido genérico creado en Tango (ej: WEB / APP) */
  codigoModelo: string
  /** Descripción de ese modelo */
  descModelo: string
}

// "3/8/2026, 06:43:40" | "03/08/2026" -> "03/08/2026"
function normFecha(f: string | null): string {
  if (!f) return ''
  const parte = f.split(',')[0].trim()
  const m = parte.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/)
  if (!m) return parte
  const dd = m[1].padStart(2, '0')
  const mm = m[2].padStart(2, '0')
  const yyyy = m[3].length === 2 ? '20' + m[3] : m[3]
  return `${dd}/${mm}/${yyyy}`
}

// "020085 - Liderman Fabian Aldo" -> "Liderman Fabian Aldo"
function razonSocial(cliente: string | null, cod: string | null): string {
  if (!cliente) return ''
  const sinCod = cliente.replace(/^\s*[\w-]+\s*-\s*/, '')
  return sinCod || (cod ?? '')
}

function bonif(dto: string | null): number | '' {
  if (!dto) return ''
  const n = parseFloat(String(dto).replace('%', '').replace(',', '.'))
  return Number.isFinite(n) && n > 0 ? n : ''
}

export interface ResultadoExport {
  filas: number
  pedidos: number
  omitidos: number
}

export async function exportarNovedadesTango(pedidos: Pedido[], cfg: ConfigTango): Promise<ResultadoExport> {
  const XLSX = await import('xlsx')

  const filas: (string | number)[][] = [COLUMNAS as unknown as string[]]
  let pedidosOk = 0
  let omitidos = 0

  for (const p of pedidos) {
    if (!p.cod_cliente || !p.items || p.items.length === 0) {
      omitidos++
      continue
    }
    const fecha = normFecha(p.fecha)
    const rs = razonSocial(p.cliente, p.cod_cliente)
    const bonificacion = bonif(p.dto_comercial)
    let algunaFila = false
    for (const it of p.items) {
      if (!it.codigo || !it.cantidad) continue
      const precio = it.preventa && it.precio_pv != null ? it.precio_pv : it.precio ?? ''
      filas.push([
        fecha, // Fecha desde
        fecha, // Fecha hasta
        it.codigo, // Código de artículo
        it.descripcion ?? it.modelo ?? '', // Descripción de artículo
        it.modelo ?? '', // Descripción adicional de artículo
        'No', // Es kit
        '', // Kit completo
        '', // UM (Tango toma la del artículo)
        it.cantidad, // Cantidad pedida
        precio, // Precio (vacío = usa lista de Tango)
        bonificacion, // Bonificación
        p.cod_cliente, // Código de cliente
        rs, // Razón social de cliente
        cfg.codigoModelo, // Código de modelo
        cfg.descModelo, // Descripción de modelo
      ])
      algunaFila = true
    }
    if (algunaFila) pedidosOk++
    else omitidos++
  }

  const ws = XLSX.utils.aoa_to_sheet(filas)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Novedades')
  const fechaArch = normFecha(new Date().toLocaleDateString('es-AR')).replace(/\//g, '-')
  XLSX.writeFile(wb, `novedades_tango_${fechaArch}.xlsx`)

  return { filas: filas.length - 1, pedidos: pedidosOk, omitidos }
}
