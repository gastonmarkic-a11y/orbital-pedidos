import { ChangeEvent, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useToast } from '../../lib/toast'
import { StockItem } from '../../lib/types'
import { formatPrecio } from '../../lib/format'
import { qtyClass } from './calc'

const PAGE_SIZE = 50

export default function StockAdmin() {
  const toast = useToast()
  const [stock, setStock] = useState<StockItem[]>([])
  const [loading, setLoading] = useState(true)
  const [busqueda, setBusqueda] = useState('')
  const [pagina, setPagina] = useState(1)
  const [ajustes, setAjustes] = useState<Record<string, string>>({})
  const [nuevoAbierto, setNuevoAbierto] = useState(false)
  const [nuevo, setNuevo] = useState({ codigo: '', modelo: '', descripcion: '', estuche: '', cantidad: '', precio: '' })
  const [masivoStatus, setMasivoStatus] = useState<string | null>(null)

  async function cargar() {
    const { data } = await supabase.from('stock').select('*').order('modelo')
    setStock((data as StockItem[]) ?? [])
    setLoading(false)
  }

  useEffect(() => {
    cargar()
  }, [])

  const filtrado = useMemo(() => {
    const q = busqueda.toLowerCase().trim()
    return stock.filter(
      (p) =>
        !q ||
        p.modelo.toLowerCase().includes(q) ||
        p.codigo.toLowerCase().includes(q) ||
        (p.descripcion || '').toLowerCase().includes(q)
    )
  }, [stock, busqueda])

  const paginas = Math.max(1, Math.ceil(filtrado.length / PAGE_SIZE))
  const slice = filtrado.slice((pagina - 1) * PAGE_SIZE, pagina * PAGE_SIZE)

  async function actualizar(p: StockItem) {
    const val = parseInt(ajustes[p.codigo] ?? String(p.cantidad))
    if (isNaN(val) || val < 0) {
      toast('Valor inválido', 'error')
      return
    }
    const { error } = await supabase
      .from('stock')
      .update({ cantidad: val, updated_at: new Date().toISOString() })
      .eq('codigo', p.codigo)
    if (error) {
      toast('Error al actualizar el stock', 'error')
      return
    }
    setStock((prev) => prev.map((x) => (x.codigo === p.codigo ? { ...x, cantidad: val } : x)))
    toast(`${p.modelo} actualizado: ${p.cantidad} → ${val}`, 'success')
  }

  async function guardarNuevo() {
    if (!nuevo.codigo.trim() || !nuevo.modelo.trim()) {
      toast('Código y Modelo son obligatorios', 'error')
      return
    }
    const { error } = await supabase.from('stock').insert({
      codigo: nuevo.codigo.trim(),
      modelo: nuevo.modelo.trim(),
      descripcion: nuevo.descripcion.trim(),
      estuche: nuevo.estuche.trim(),
      cantidad: parseInt(nuevo.cantidad) || 0,
      precio: parseInt(nuevo.precio) || 0,
    })
    if (error) {
      toast(error.message.includes('23505') || error.code === '23505' ? 'Ese código ya existe en el stock' : 'Error al guardar el artículo', 'error')
      return
    }
    setNuevo({ codigo: '', modelo: '', descripcion: '', estuche: '', cantidad: '', precio: '' })
    setNuevoAbierto(false)
    await cargar()
    toast(`✓ Artículo agregado al stock`, 'success')
  }

  function exportarStock() {
    let csv = 'Codigo,Modelo,Descripcion,Stock\n'
    for (const p of stock) csv += `"${p.codigo}","${p.modelo}","${p.descripcion ?? ''}",${p.cantidad}\n`
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `stock_orbital_${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
  }

  async function procesarMasivo(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setMasivoStatus('Leyendo archivo…')
    try {
      const text = await file.text()
      const lines = text
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l)
      if (!lines.length) {
        toast('No se encontraron datos en el archivo', 'error')
        setMasivoStatus(null)
        return
      }
      const sep = lines[0].includes('\t') ? '\t' : lines[0].includes(';') ? ';' : ','
      const header = lines[0].toLowerCase().split(sep).map((h) => h.trim().replace(/['"]/g, ''))
      const idxCod = header.findIndex((h) => h.includes('cod') || h.includes('sku'))
      const idxCant = header.findIndex((h) => h.includes('cant') || h.includes('stock') || h.includes('qty'))
      const idxPrecio = header.findIndex((h) => h.includes('precio') || h.includes('lista') || h.includes('price'))
      const cIdx = idxCod >= 0 ? idxCod : 0
      const qIdx = idxCant >= 0 ? idxCant : 1
      const startRow = idxCod >= 0 ? 1 : 0

      const filas: { codigo: string; cantidad: number; precio?: number }[] = []
      for (let i = startRow; i < lines.length; i++) {
        const cols = lines[i].split(sep).map((c) => c.trim().replace(/['"]/g, ''))
        const codigo = cols[cIdx]
        const cantidad = parseInt(cols[qIdx])
        const precio = idxPrecio >= 0 ? parseInt(cols[idxPrecio]) : undefined
        if (codigo && !isNaN(cantidad)) filas.push({ codigo, cantidad, precio })
      }

      let ok = 0
      let errores = 0
      for (let i = 0; i < filas.length; i += 50) {
        const batch = filas.slice(i, i + 50)
        setMasivoStatus(`Actualizando… ${Math.min(i + batch.length, filas.length)}/${filas.length}`)
        await Promise.all(
          batch.map(async (fila) => {
            const stripped = fila.codigo.replace(/^0+/, '')
            const local = stock.find((x) => x.codigo === fila.codigo || x.codigo.replace(/^0+/, '') === stripped)
            const updateData: Record<string, number> = { cantidad: fila.cantidad }
            if (fila.precio !== undefined && fila.precio > 0) updateData.precio = fila.precio
            const { error } = await supabase
              .from('stock')
              .update(updateData)
              .eq('codigo', local ? local.codigo : fila.codigo)
            if (error) errores++
            else ok++
          })
        )
      }
      setMasivoStatus(`✓ Completado: ${ok} actualizados, ${errores} errores`)
      await cargar()
      toast(`✓ ${ok} artículos actualizados`, 'success')
      setTimeout(() => setMasivoStatus(null), 4000)
    } catch (err) {
      console.error(err)
      setMasivoStatus(null)
      toast('Error al procesar el archivo', 'error')
    }
    e.target.value = ''
  }

  if (loading) return <p className="text-sm text-muted p-4">Cargando stock...</p>

  return (
    <div className="space-y-3 text-ink">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-base font-semibold">Gestión de Stock</h2>
        <div className="flex gap-2">
          <button onClick={() => setNuevoAbierto(true)} className="text-xs font-medium bg-emerald-600 text-white rounded-lg px-3 py-1.5">
            + Nuevo artículo
          </button>
          <button onClick={exportarStock} className="text-xs font-medium border border-black/10 rounded-lg px-3 py-1.5 text-muted">
            ⬇ Exportar CSV
          </button>
          <label className="text-xs font-medium border border-black/10 rounded-lg px-3 py-1.5 text-muted cursor-pointer">
            ⬆ Actualización masiva
            <input type="file" accept=".csv,.txt,.tsv" onChange={procesarMasivo} className="hidden" />
          </label>
        </div>
      </div>

      {masivoStatus && (
        <div className="bg-blue-50 border border-blue-200 text-blue-700 text-xs rounded-lg p-3">
          {masivoStatus}
          <span className="block text-[10px] text-blue-500 mt-1">
            Formato esperado: Código | Cantidad (y opcionalmente Precio). CSV separado por coma, punto y coma o tab.
          </span>
        </div>
      )}

      <input
        placeholder="Buscar por código, modelo o descripción..."
        value={busqueda}
        onChange={(e) => {
          setBusqueda(e.target.value)
          setPagina(1)
        }}
        className="w-full bg-white border border-black/10 rounded-lg px-3 py-2 text-sm placeholder:text-faint"
      />

      <div className="overflow-x-auto rounded-xl border border-black/10 bg-white">
        <table className="w-full min-w-[680px] text-sm border-collapse">
          <thead className="bg-[#f7f7fa]">
            <tr>
              {['Código', 'Modelo', 'Descripción', 'Precio', 'Stock', 'Ajustar', ''].map((h) => (
                <th key={h} className="text-left text-[10px] uppercase text-muted font-semibold px-2.5 py-2">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {slice.map((p) => (
              <tr key={p.codigo} className="border-t border-black/5">
                <td className="px-2.5 py-1.5 font-mono text-[11px] text-faint">{p.codigo}</td>
                <td className="px-2.5 py-1.5 font-semibold">{p.modelo}</td>
                <td className="px-2.5 py-1.5 text-muted">{p.descripcion || '—'}</td>
                <td className="px-2.5 py-1.5 text-gold font-semibold">{(p.precio ?? 0) > 0 ? formatPrecio(p.precio) : '—'}</td>
                <td className="px-2.5 py-1.5">
                  <span className={`text-xs font-semibold rounded-full px-2 py-0.5 ${qtyClass(p.cantidad)}`}>{p.cantidad}</span>
                </td>
                <td className="px-2.5 py-1.5">
                  <input
                    type="number"
                    min={0}
                    value={ajustes[p.codigo] ?? String(p.cantidad)}
                    onChange={(e) => setAjustes({ ...ajustes, [p.codigo]: e.target.value })}
                    className="w-20 border border-black/10 rounded-md px-2 py-1 text-xs"
                  />
                </td>
                <td className="px-2.5 py-1.5">
                  <button onClick={() => actualizar(p)} className="text-xs font-bold text-white bg-brand rounded-md px-2.5 py-1">
                    OK
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {paginas > 1 && (
        <div className="flex gap-1 flex-wrap">
          {Array.from({ length: Math.min(paginas, 10) }, (_, i) => i + 1).map((i) => (
            <button
              key={i}
              onClick={() => setPagina(i)}
              className={`w-8 h-8 rounded-lg text-xs font-medium border ${
                i === pagina ? 'bg-brand text-white border-brand' : 'border-black/10 text-muted'
              }`}
            >
              {i}
            </button>
          ))}
        </div>
      )}

      {nuevoAbierto && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setNuevoAbierto(false)}>
          <div className="bg-white rounded-2xl border border-black/10 w-full max-w-md p-4 space-y-2" onClick={(e) => e.stopPropagation()}>
            <p className="text-sm font-semibold mb-1">+ Nuevo artículo</p>
            {(
              [
                ['codigo', 'Código *'],
                ['modelo', 'Modelo *'],
                ['descripcion', 'Descripción'],
                ['estuche', 'Estuche'],
                ['cantidad', 'Cantidad'],
                ['precio', 'Precio'],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="block text-xs text-muted">
                {label}
                <input
                  type={key === 'cantidad' || key === 'precio' ? 'number' : 'text'}
                  value={nuevo[key]}
                  onChange={(e) => setNuevo({ ...nuevo, [key]: e.target.value })}
                  className="w-full mt-1 border border-black/10 rounded-lg px-3 py-2 text-sm"
                />
              </label>
            ))}
            <div className="flex gap-2 pt-2">
              <button onClick={() => setNuevoAbierto(false)} className="flex-1 rounded-lg border border-black/10 py-2 text-sm text-muted">
                Cancelar
              </button>
              <button onClick={guardarNuevo} className="flex-1 rounded-lg bg-emerald-600 text-white py-2 text-sm font-semibold">
                + Guardar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
