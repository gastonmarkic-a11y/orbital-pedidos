// Documentos automáticos de marca blanca.
// Con IVA (Plenorius): fila(s) en formato "Novedades para pedidos" de Tango → se factura en Tango.
// Sin IVA (Brubank): remito PDF generado acá, se sube al bucket y el cliente lo baja desde su link.

interface ItemMB { modelo: string; ref?: string; color: string; terminacion?: string; detalle?: string; cantidad: number; unit_usd: number; total_usd: number }
interface PedidoMB {
  id: number; marca: string; razon_social: string; email: string; telefono: string
  items: ItemMB[]; unidades: number; subtotal_usd: number; total_usd: number
}

const COLUMNAS = ['Fecha desde', 'Fecha hasta', 'Código de artículo', 'Descripción de artículo', 'Descripción adicional de artículo',
  'Es kit', 'Kit completo', 'UM', 'Cantidad pedida', 'Precio', 'Bonificación', 'Código de cliente', 'Razón social de cliente',
  'Código de modelo', 'Descripción de modelo']

const hoy = () => new Date().toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })
const desc = (it: ItemMB) => [it.color, it.terminacion, it.detalle].filter(Boolean).join(' · ')

// Precio en pesos neto de IVA (Tango le suma el IVA en Plenorius), al dólar que se pasa.
export async function excelTangoMB(p: PedidoMB, cfg: { codCliente: string; codArticulo: string; codModelo: string; dolar: number }) {
  const XLSX = await import('xlsx')
  const f = hoy()
  const filas: (string | number)[][] = [COLUMNAS]
  for (const it of p.items ?? []) {
    filas.push([f, f, cfg.codArticulo, `Marca blanca ${it.modelo} ${p.marca}`.slice(0, 50), desc(it).slice(0, 50), 'No', '', '',
      it.cantidad, Math.round(it.unit_usd * cfg.dolar * 100) / 100, 0, cfg.codCliente, p.razon_social, cfg.codModelo, 'Marca blanca'])
  }
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(filas), 'Novedades')
  XLSX.writeFile(wb, `PLENORIUS_marca_blanca_${p.id}_${f.replace(/\//g, '-')}.xlsx`)
}

export async function remitoPdfMB(p: PedidoMB): Promise<Blob> {
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  let y = 20
  doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.text('REMITO', 20, y)
  doc.setFontSize(10); doc.setFont('helvetica', 'normal')
  doc.text(`N° MB-${String(p.id).padStart(5, '0')}`, 190, y, { align: 'right' })
  y += 6; doc.text(`Fecha: ${hoy()}`, 190, y, { align: 'right' })
  doc.text('Orbital Eyewear · Marca blanca', 20, y)
  y += 6; doc.setFontSize(8); doc.text('Documento no válido como factura', 20, y)
  doc.setFontSize(10)
  y += 10; doc.setFont('helvetica', 'bold'); doc.text('Cliente', 20, y); doc.setFont('helvetica', 'normal')
  y += 6; doc.text(`${p.razon_social} · marca ${p.marca}`, 20, y)
  y += 5; doc.text(`${p.email} · ${p.telefono}`, 20, y)
  y += 12
  doc.setFont('helvetica', 'bold')
  doc.text('Cant.', 20, y); doc.text('Artículo', 38, y); doc.text('Unit. USD', 160, y, { align: 'right' }); doc.text('Total USD', 190, y, { align: 'right' })
  doc.setFont('helvetica', 'normal'); y += 2; doc.line(20, y, 190, y); y += 5
  for (const it of p.items ?? []) {
    const lineas = doc.splitTextToSize(`${it.modelo} · ${desc(it)} · con logo ${p.marca}`, 110) as string[]
    if (y + lineas.length * 5 > 270) { doc.addPage(); y = 20 }
    doc.text(String(it.cantidad), 20, y); doc.text(lineas, 38, y)
    doc.text(it.unit_usd.toFixed(2), 160, y, { align: 'right' }); doc.text(it.total_usd.toFixed(2), 190, y, { align: 'right' })
    y += lineas.length * 5 + 2
  }
  doc.line(20, y, 190, y); y += 6
  doc.setFont('helvetica', 'bold')
  doc.text(`${p.unidades} unidades`, 20, y); doc.text(`Total USD ${p.total_usd.toFixed(2)}`, 190, y, { align: 'right' })
  y += 25; doc.setFont('helvetica', 'normal')
  doc.line(20, y, 90, y); doc.line(120, y, 190, y); y += 5
  doc.text('Entregó', 20, y); doc.text('Recibí conforme (firma y aclaración)', 120, y)
  return doc.output('blob')
}
