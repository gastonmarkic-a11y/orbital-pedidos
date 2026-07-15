import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useToast } from '../../lib/toast'
import { Pedido, StockItem } from '../../lib/types'
import { formatPrecio } from '../../lib/format'
import { estadoLabel, importeDe } from './calc'

export default function Cobranzas() {
  const toast = useToast()
  const [pedidos, setPedidos] = useState<Pedido[]>([])
  const [stock, setStock] = useState<StockItem[]>([])
  const [loading, setLoading] = useState(true)
  const [busqueda, setBusqueda] = useState('')
  const [filtro, setFiltro] = useState('')

  const cargar = useCallback(async () => {
    const [{ data: peds }, { data: st }] = await Promise.all([
      supabase.from('pedidos').select('*').order('created_at', { ascending: false }),
      supabase.from('stock').select('*'),
    ])
    setPedidos((peds as Pedido[]) ?? [])
    setStock((st as StockItem[]) ?? [])
    setLoading(false)
  }, [])

  useEffect(() => {
    cargar()
  }, [cargar])

  const filas = useMemo(() => {
    // Todos los pedidos entran al circuito de cobro desde que se cargan
    let logs = [...pedidos]
    if (filtro === 'cobrado') logs = logs.filter((l) => l.cobrado)
    if (filtro === 'pendiente') logs = logs.filter((l) => !l.cobrado)
    const q = busqueda.toLowerCase().trim()
    if (q) logs = logs.filter((l) => (l.cliente || '').toLowerCase().includes(q))
    return logs
  }, [pedidos, filtro, busqueda])

  const totalCobrado = filas.filter((l) => l.cobrado).reduce((a, l) => a + importeDe(l, stock), 0)
  const totalPendiente = filas.filter((l) => !l.cobrado).reduce((a, l) => a + importeDe(l, stock), 0)

  async function toggleCobrado(p: Pedido, checked: boolean) {
    const { error } = await supabase.from('pedidos').update({ cobrado: checked }).eq('id', p.id)
    if (error) {
      toast('Error al actualizar el cobro', 'error')
      return
    }
    setPedidos((prev) => prev.map((x) => (x.id === p.id ? { ...x, cobrado: checked } : x)))
    toast(checked ? '✅ Marcado como cobrado' : '↩ Desmarcado como pendiente', 'success')
  }

  if (loading) return <p className="text-sm text-muted p-4">Cargando cobranzas...</p>

  return (
    <div className="space-y-3 text-ink">
      <h2 className="text-base font-semibold">📞 Cobranzas</h2>

      <div className="grid grid-cols-2 gap-3">
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-center">
          <p className="text-lg font-bold text-emerald-600">{formatPrecio(totalCobrado) || '$ 0'}</p>
          <p className="text-[10px] uppercase tracking-wide text-emerald-700 font-semibold">Cobrado</p>
        </div>
        <div className="bg-orange-50 border border-orange-200 rounded-xl p-3 text-center">
          <p className="text-lg font-bold text-orange-600">{formatPrecio(totalPendiente) || '$ 0'}</p>
          <p className="text-[10px] uppercase tracking-wide text-orange-700 font-semibold">Pendiente de cobro</p>
        </div>
      </div>

      <div className="flex gap-2">
        <input
          placeholder="Buscar cliente..."
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          className="flex-1 bg-white border border-black/10 rounded-lg px-3 py-2 text-sm placeholder:text-faint"
        />
        <select
          value={filtro}
          onChange={(e) => setFiltro(e.target.value)}
          className="bg-white border border-black/10 rounded-lg px-2 py-2 text-sm"
        >
          <option value="">Todos</option>
          <option value="pendiente">⏳ Pendiente de cobro</option>
          <option value="cobrado">✅ Cobrado</option>
        </select>
      </div>

      {filas.length === 0 ? (
        <div className="text-sm text-faint text-center py-10 bg-white rounded-xl border border-black/10">
          Sin pedidos para gestionar.
        </div>
      ) : (
        <div className="space-y-1.5">
          {filas.map((l) => {
            const n = importeDe(l, stock)
            const nombre = (l.cliente || '').replace(/^\d+ - /, '')
            return (
              <label
                key={l.id}
                className={`flex items-center gap-3 bg-white border rounded-xl px-3 py-2.5 cursor-pointer ${
                  l.cobrado ? 'border-emerald-200 opacity-70' : 'border-black/10'
                }`}
              >
                <input
                  type="checkbox"
                  checked={!!l.cobrado}
                  onChange={(e) => toggleCobrado(l, e.target.checked)}
                  className="w-4 h-4"
                />
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-medium truncate ${l.cobrado ? 'line-through text-muted' : ''}`}>{nombre}</p>
                  <p className="text-xs text-faint">
                    {l.vendedor || ''} · {l.fecha || ''} · {estadoLabel(l.estado)}
                    {l.nro_factura ? ` · Fact. ${l.nro_factura}` : ''}
                  </p>
                </div>
                <p className="text-sm font-bold shrink-0">{formatPrecio(n)}</p>
              </label>
            )
          })}
        </div>
      )}
    </div>
  )
}
