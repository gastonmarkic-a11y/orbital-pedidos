import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useToast } from '../../lib/toast'

// ── USA stock panel (Suite, role 'usa') — the Miami stock (stock_usa). Independent. ──

interface Row { sku: string; modelo: string; color_en: string | null; precio: number | null; cantidad: number }
const usd = (n: number) => '$' + Math.round(n).toLocaleString('en-US')

export default function StockUSAAdmin() {
  const toast = useToast()
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [edit, setEdit] = useState<Record<string, string>>({})
  const [abierto, setAbierto] = useState<Set<string>>(new Set())

  async function cargar() {
    const { data } = await supabase.from('stock_usa').select('sku, modelo, color_en, precio, cantidad').order('modelo').order('color_en')
    setRows((data ?? []) as Row[])
    setLoading(false)
  }
  useEffect(() => { cargar() }, [])

  const qn = q.trim().toLowerCase()
  const filtradas = useMemo(
    () => rows.filter((r) => !qn || (r.modelo + ' ' + (r.color_en || '') + ' ' + r.sku).toLowerCase().includes(qn)),
    [rows, qn],
  )
  const grupos = useMemo(() => {
    const g: Record<string, Row[]> = {}
    for (const r of filtradas) { const k = (r.modelo || '').toUpperCase(); (g[k] ||= []).push(r) }
    return g
  }, [filtradas])
  const totalU = filtradas.reduce((a, r) => a + r.cantidad, 0)

  function toggle(m: string) {
    setAbierto((prev) => { const n = new Set(prev); n.has(m) ? n.delete(m) : n.add(m); return n })
  }

  async function guardar(r: Row) {
    const raw = edit[r.sku]
    if (raw === undefined) return
    const n = Math.max(0, Math.round(Number(raw)))
    setEdit((e) => { const { [r.sku]: _x, ...rest } = e; return rest })
    if (isNaN(n) || n === r.cantidad) return
    const { error } = await supabase.from('stock_usa').update({ cantidad: n, updated_at: new Date().toISOString() }).eq('sku', r.sku)
    if (error) { toast('Could not save', 'error'); return }
    setRows((prev) => prev.map((x) => (x.sku === r.sku ? { ...x, cantidad: n } : x)))
    toast(`${r.modelo} · ${r.color_en} → ${n}`, 'success')
  }

  if (loading) return <p className="text-sm text-muted p-4">Loading USA stock…</p>

  return (
    <div className="space-y-3 text-ink">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold">🇺🇸 USA Stock <span className="text-xs font-normal text-muted">(Miami)</span></h2>
        <button onClick={cargar} className="text-xs text-brandDark font-medium">Refresh</button>
      </div>

      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search model, color or SKU…"
        className="w-full rounded-lg bg-white border border-black/10 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand/30" />
      <p className="text-xs text-muted">{Object.keys(grupos).length} models · {filtradas.length} SKUs · {totalU} units</p>

      <div className="space-y-1.5">
        {Object.keys(grupos).sort().map((m) => {
          const items = grupos[m]
          const open = abierto.has(m) || qn.length > 0
          const u = items.reduce((a, r) => a + r.cantidad, 0)
          return (
            <div key={m} className="bg-white rounded-xl border border-black/10 overflow-hidden">
              <button onClick={() => toggle(m)} className="w-full flex items-center justify-between px-4 py-2.5 text-sm">
                <span className="font-semibold">{m} <span className="text-xs font-normal text-faint">{items.length} colors</span></span>
                <span className="flex items-center gap-2">
                  <span className="text-xs text-muted">{u} u.</span>
                  <span className="text-faint text-xs">{open ? '▾' : '▸'}</span>
                </span>
              </button>
              {open && (
                <div className="border-t border-black/5 divide-y divide-black/5">
                  {items.map((r) => (
                    <div key={r.sku} className="flex items-center justify-between gap-2 px-4 py-2">
                      <div className="min-w-0">
                        <p className="text-sm truncate">{r.color_en || '—'}</p>
                        <p className="text-[10px] text-faint font-mono">{r.sku} · {usd(r.precio ?? 0)}</p>
                      </div>
                      <input
                        type="number" min={0}
                        value={edit[r.sku] ?? String(r.cantidad)}
                        onChange={(e) => setEdit((s) => ({ ...s, [r.sku]: e.target.value }))}
                        onBlur={() => guardar(r)}
                        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                        className="w-16 text-right rounded-lg border border-black/10 px-2 py-1 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-brand/30"
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
