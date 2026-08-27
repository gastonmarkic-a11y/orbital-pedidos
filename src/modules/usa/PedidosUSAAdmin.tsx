import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useToast } from '../../lib/toast'

// ── USA orders panel (Suite, role 'usa') — fully independent from Argentina ──
// Orders come from pedidos_usa (USA catalog checkout). Fulfilled with USA stock
// (stock_usa). Does NOT touch Argentina's pedidos/stock.

interface Item { sku: string; modelo: string; color: string; cantidad: number; precio: number }
interface Pedido {
  id: number; fecha: string; cliente_nombre: string | null; cliente_email: string | null
  cliente_empresa: string | null; notas: string | null; items: Item[]
  total_units: number | null; total_usd: number | null; estado: string
}

const usd = (n: number) => '$' + Math.round(n).toLocaleString('en-US')
const ESTADOS = [
  { k: 'nuevo', label: 'New', cls: 'bg-blue-100 text-blue-700' },
  { k: 'preparando', label: 'In progress', cls: 'bg-amber-100 text-amber-700' },
  { k: 'enviado', label: 'Shipped', cls: 'bg-emerald-100 text-emerald-700' },
  { k: 'cancelado', label: 'Cancelled', cls: 'bg-neutral-200 text-neutral-600' },
]
const estadoInfo = (e: string) => ESTADOS.find((x) => x.k === e) ?? ESTADOS[0]

export default function PedidosUSAAdmin() {
  const toast = useToast()
  const [pedidos, setPedidos] = useState<Pedido[]>([])
  const [stock, setStock] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [filtro, setFiltro] = useState<'nuevo' | 'preparando' | 'enviado' | 'todos'>('nuevo')
  const [abierto, setAbierto] = useState<Set<number>>(new Set())
  const [guardando, setGuardando] = useState<number | null>(null)

  async function cargar() {
    const [{ data: ps }, { data: st }] = await Promise.all([
      supabase.from('pedidos_usa').select('*').order('fecha', { ascending: false }),
      supabase.from('stock_usa').select('sku, cantidad'),
    ])
    setPedidos((ps ?? []) as Pedido[])
    const m: Record<string, number> = {}
    for (const s of (st ?? []) as { sku: string; cantidad: number }[]) m[s.sku] = Number(s.cantidad)
    setStock(m)
    setLoading(false)
  }
  useEffect(() => { cargar() }, [])

  const visibles = useMemo(
    () => pedidos.filter((p) => filtro === 'todos' || (p.estado || 'nuevo') === filtro),
    [pedidos, filtro],
  )
  const counts = useMemo(() => {
    const c: Record<string, number> = { nuevo: 0, preparando: 0, enviado: 0, todos: pedidos.length }
    for (const p of pedidos) c[p.estado || 'nuevo'] = (c[p.estado || 'nuevo'] ?? 0) + 1
    return c
  }, [pedidos])

  function toggle(id: number) {
    setAbierto((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  async function cambiarEstado(p: Pedido, estado: string) {
    setGuardando(p.id)
    // Al despachar (shipped), descuenta del stock USA. Cancelar desde shipped devuelve stock.
    if (estado === 'enviado' && p.estado !== 'enviado') {
      for (const it of p.items || []) {
        const actual = stock[it.sku] ?? 0
        await supabase.from('stock_usa').update({ cantidad: Math.max(0, actual - it.cantidad), updated_at: new Date().toISOString() }).eq('sku', it.sku)
      }
    }
    if (estado === 'cancelado' && p.estado === 'enviado') {
      for (const it of p.items || []) {
        const actual = stock[it.sku] ?? 0
        await supabase.from('stock_usa').update({ cantidad: actual + it.cantidad, updated_at: new Date().toISOString() }).eq('sku', it.sku)
      }
    }
    const { error } = await supabase.from('pedidos_usa').update({ estado }).eq('id', p.id)
    setGuardando(null)
    if (error) { toast('Could not update the order', 'error'); return }
    toast(`Order #${p.id} → ${estadoInfo(estado).label}`, 'success')
    cargar()
  }

  if (loading) return <p className="text-sm text-muted p-4">Loading USA orders…</p>

  return (
    <div className="space-y-3 text-ink">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold">🇺🇸 USA Orders</h2>
        <button onClick={cargar} className="text-xs text-brandDark font-medium">Refresh</button>
      </div>

      <div className="flex gap-1.5 flex-wrap">
        {[{ k: 'nuevo', label: 'New' }, { k: 'preparando', label: 'In progress' }, { k: 'enviado', label: 'Shipped' }, { k: 'todos', label: 'All' }].map((t) => (
          <button key={t.k} onClick={() => setFiltro(t.k as any)}
            className={`text-xs font-semibold rounded-full px-3 py-1.5 border ${filtro === t.k ? 'bg-brand text-white border-transparent' : 'bg-white border-black/10 text-muted'}`}>
            {t.label} <span className="opacity-70">{counts[t.k] ?? 0}</span>
          </button>
        ))}
      </div>

      {visibles.length === 0 ? (
        <p className="text-sm text-muted text-center py-16">No orders here.</p>
      ) : (
        <div className="space-y-2">
          {visibles.map((p) => {
            const info = estadoInfo(p.estado || 'nuevo')
            const open = abierto.has(p.id)
            const faltante = (p.items || []).some((it) => (stock[it.sku] ?? 0) < it.cantidad)
            return (
              <div key={p.id} className="bg-white rounded-xl border border-black/10 overflow-hidden">
                <button onClick={() => toggle(p.id)} className="w-full flex items-center justify-between gap-2 px-4 py-3 text-left">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold truncate">
                      #{p.id} · {p.cliente_nombre || '—'}
                      {p.cliente_empresa ? <span className="text-muted font-normal"> · {p.cliente_empresa}</span> : null}
                    </p>
                    <p className="text-xs text-muted truncate">
                      {p.cliente_email || 'no email'} · {new Date(p.fecha).toLocaleDateString('en-US')} · {p.total_units} units · <b>{usd(p.total_usd ?? 0)}</b>
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {faltante && p.estado !== 'enviado' && p.estado !== 'cancelado' && <span title="Not enough USA stock for some lines" className="text-[10px]">⚠️</span>}
                    <span className={`text-[10px] font-semibold rounded-full px-2 py-0.5 ${info.cls}`}>{info.label}</span>
                    <span className="text-muted text-xs">{open ? '▾' : '▸'}</span>
                  </div>
                </button>

                {open && (
                  <div className="border-t border-black/5 px-4 py-3 space-y-3">
                    <div className="divide-y divide-black/5">
                      {(p.items || []).map((it) => {
                        const disp = stock[it.sku] ?? 0
                        const falta = disp < it.cantidad
                        return (
                          <div key={it.sku} className="flex items-center justify-between gap-2 py-1.5 text-sm">
                            <div className="min-w-0">
                              <p className="truncate"><b>{it.modelo}</b> · {it.color}</p>
                              <p className="text-[10px] text-faint font-mono">{it.sku}</p>
                            </div>
                            <div className="flex items-center gap-3 shrink-0 text-xs">
                              <span className={falta ? 'text-red-600 font-semibold' : 'text-muted'} title="Available in USA stock">{disp} in stock</span>
                              <span className="font-semibold">×{it.cantidad}</span>
                              <span className="text-muted w-16 text-right">{usd(it.precio * it.cantidad)}</span>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                    {p.notas && <p className="text-xs text-muted">📝 {p.notas}</p>}
                    <div className="flex items-center justify-between gap-2 pt-1">
                      <span className="text-sm font-bold">Total: {usd(p.total_usd ?? 0)} <span className="text-xs font-normal text-muted">({p.total_units} units)</span></span>
                      <div className="flex gap-1.5">
                        {p.estado === 'nuevo' && (
                          <button disabled={guardando === p.id} onClick={() => cambiarEstado(p, 'preparando')} className="text-xs font-semibold rounded-lg bg-amber-500 text-white px-3 py-1.5 disabled:opacity-50">Start</button>
                        )}
                        {(p.estado === 'nuevo' || p.estado === 'preparando') && (
                          <button disabled={guardando === p.id} onClick={() => cambiarEstado(p, 'enviado')} className="text-xs font-semibold rounded-lg bg-emerald-600 text-white px-3 py-1.5 disabled:opacity-50">Mark shipped</button>
                        )}
                        {p.estado === 'enviado' && (
                          <button disabled={guardando === p.id} onClick={() => cambiarEstado(p, 'cancelado')} className="text-xs rounded-lg border border-black/10 px-3 py-1.5 text-muted disabled:opacity-50">Undo / cancel</button>
                        )}
                        {p.estado === 'nuevo' && (
                          <button disabled={guardando === p.id} onClick={() => cambiarEstado(p, 'cancelado')} className="text-xs rounded-lg border border-black/10 px-3 py-1.5 text-muted disabled:opacity-50">Cancel</button>
                        )}
                      </div>
                    </div>
                    <p className="text-[10px] text-faint">Marking as shipped discounts these units from USA stock (Miami). Argentina stock is never touched.</p>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
