// ── Lista de precios para la central de consigna ────────────────────────────
// Categoría, modelo, código, descripción y precio (lista óptico, sin IVA: el mismo precio de la consigna).
// Solo la central (la RPC rechaza el link de sucursal). Se exporta a Excel tal como se ve filtrada.
import { useEffect, useMemo, useState } from 'react'
import { Search, Download } from 'lucide-react'
import { supabase } from '../../lib/supabase'

type Fila = { categoria: string; modelo: string; codigo: string; descripcion: string | null; tratamiento: string | null; precio: number }

const fmtPrecio = (n: number) => `$ ${Math.round(n).toLocaleString('es-AR')}`
// Sol primero, después Receta; dentro, por categoría y modelo.
const orden = (c: string) => (c.startsWith('Sol') ? 0 : c.startsWith('Receta') ? 1 : 2)

export default function ListaPrecios({ clave, cliente }: { clave: string; cliente: string }) {
  const [filas, setFilas] = useState<Fila[] | null>(null)
  const [error, setError] = useState(false)
  const [busca, setBusca] = useState('')
  const [cat, setCat] = useState('')

  useEffect(() => {
    supabase.rpc('consigna_lista_precios', { p_k: clave }).then(({ data, error }) => {
      if (error) { setError(true); setFilas([]); return }
      setFilas(((data as Fila[]) ?? []).map((f) => ({ ...f, categoria: f.categoria || 'Sin categoría', precio: Number(f.precio) }))
        .sort((a, b) => orden(a.categoria) - orden(b.categoria) || a.categoria.localeCompare(b.categoria)
          || a.modelo.localeCompare(b.modelo) || (a.descripcion ?? '').localeCompare(b.descripcion ?? '')))
    })
  }, [clave])

  const categorias = useMemo(() => [...new Set((filas ?? []).map((f) => f.categoria))], [filas])
  const visibles = useMemo(() => {
    const q = busca.trim().toLowerCase()
    return (filas ?? []).filter((f) => (!cat || f.categoria === cat)
      && (!q || `${f.modelo} ${f.descripcion ?? ''} ${f.codigo}`.toLowerCase().includes(q)))
  }, [filas, busca, cat])

  const exportar = async () => {
    const XLSX = await import('xlsx')
    const hoy = new Date().toLocaleDateString('es-AR')
    const ws = XLSX.utils.aoa_to_sheet([
      [`Lista de precios Orbital · ${cliente} · ${hoy}`],
      ['Precio óptico sin IVA, antes del descuento comercial.'],
      [],
      ['Categoría', 'Modelo', 'Código', 'Descripción', 'Precio (sin IVA)'],
      ...visibles.map((f) => [f.categoria, f.modelo, f.codigo, f.descripcion ?? '', f.precio]),
    ])
    ws['!cols'] = [{ wch: 22 }, { wch: 22 }, { wch: 18 }, { wch: 40 }, { wch: 16 }]
    for (let r = 4; r < visibles.length + 4; r++) {
      const c = ws[XLSX.utils.encode_cell({ r, c: 4 })]
      if (c) c.z = '"$" #,##0'
    }
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Lista de precios')
    XLSX.writeFile(wb, `Lista_precios_Orbital_${new Date().toISOString().slice(0, 10)}.xlsx`)
  }

  if (!filas) return <p className="text-sm text-muted">Cargando la lista de precios…</p>
  if (error) return <p className="text-sm text-muted bg-white border border-black/10 rounded-lg px-4 py-6">No se pudo cargar la lista de precios. La ve solo el link de la central.</p>

  let ultimaCat = ''
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative flex-1 min-w-[200px] max-w-md">
          <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
          <input id="precios-busca" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar modelo, color o código"
            className="w-full bg-white border border-black/10 rounded-lg pl-8 pr-3 py-2 text-sm" />
        </label>
        <select id="precios-categoria" aria-label="Categoría" value={cat} onChange={(e) => setCat(e.target.value)}
          className="text-sm bg-white border border-black/15 rounded-lg px-2.5 py-2">
          <option value="">Todas las categorías</option>
          {categorias.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <button onClick={exportar} disabled={!visibles.length}
          className="ml-auto bg-ink text-white text-sm font-medium rounded-lg px-4 py-2 flex items-center gap-2 disabled:opacity-40">
          <Download size={15} /> Exportar a Excel
        </button>
      </div>
      <p className="text-xs text-muted -mt-2">
        {visibles.length} productos · precio óptico sin IVA, antes del descuento comercial. El Excel sale con lo que ves filtrado.
      </p>

      <section className="bg-white border border-black/10 rounded-lg overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-muted">
              <th className="text-left font-medium px-4 py-2 border-b border-black/10">Categoría</th>
              <th className="text-left font-medium px-2 py-2 border-b border-black/10">Modelo</th>
              <th className="text-left font-medium px-2 py-2 border-b border-black/10">Código</th>
              <th className="text-left font-medium px-2 py-2 border-b border-black/10">Descripción</th>
              <th className="text-right font-medium px-4 py-2 border-b border-black/10">Precio</th>
            </tr>
          </thead>
          <tbody>
            {visibles.map((f) => {
              const nueva = f.categoria !== ultimaCat
              ultimaCat = f.categoria
              return (
                <tr key={f.codigo} className={nueva ? 'border-t border-black/15' : ''}>
                  <td className="px-4 py-1.5 border-b border-black/5 text-xs whitespace-nowrap">{nueva ? <b>{f.categoria}</b> : <span className="text-black/25">〃</span>}</td>
                  <td className="px-2 py-1.5 border-b border-black/5 text-[12px] font-semibold tracking-wide uppercase whitespace-nowrap">{f.modelo}</td>
                  <td className="px-2 py-1.5 border-b border-black/5 text-xs text-muted tabular-nums">{f.codigo}</td>
                  <td className="px-2 py-1.5 border-b border-black/5 text-xs">{f.descripcion}</td>
                  <td className="px-4 py-1.5 border-b border-black/5 text-right tabular-nums font-medium whitespace-nowrap">{fmtPrecio(f.precio)}</td>
                </tr>
              )
            })}
            {visibles.length === 0 && (
              <tr><td colSpan={5} className="text-center text-muted text-sm py-8">No hay productos con ese filtro.</td></tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  )
}
