import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { fetchPaged } from '../../lib/fetchAll'
import TelefonoAcciones from '../../lib/TelefonoAcciones'

// Historial de compradores de la tienda online (Shopify: Vint + línea + outlet), desde tienda_compras.
type Comprador = {
  comprador_key: string
  nombre: string | null
  email: string | null
  telefono: string | null
  provincia: string | null
  ciudad: string | null
  compras: number
  unidades: number
  total: number
  primera: string | null
  ultima: string | null
  tiendas: string[]
}
type Compra = {
  tienda: string
  order_number: string | null
  created_at: string
  financial_status: string | null
  cancelada: boolean
  unidades: number
  total: number
  descuento_codigo: string | null
  items: { n: string; q: number; p: number; sku: string | null }[]
}

const TIENDA: Record<string, string> = { vint: 'Vint', linea: 'Línea', outlet: 'Outlet' }
const pesos = (n: number) => '$' + Math.round(n).toLocaleString('es-AR')
const fecha = (s: string | null) => (s ? new Date(s).toLocaleDateString('es-AR') : '—')

type Filtro = 'todos' | 'recompra' | 'unica'
type Orden = 'ultima' | 'total' | 'compras'

export default function CompradoresTienda() {
  const [rows, setRows] = useState<Comprador[]>([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [filtro, setFiltro] = useState<Filtro>('todos')
  const [orden, setOrden] = useState<Orden>('ultima')
  const [limite, setLimite] = useState(50)
  const [sel, setSel] = useState<Comprador | null>(null)

  useEffect(() => {
    fetchPaged<Comprador>(() => supabase.from('tienda_compradores').select('*').order('ultima', { ascending: false }))
      .then(setRows)
      .finally(() => setLoading(false))
  }, [])

  const lista = useMemo(() => {
    const t = q.trim().toLowerCase()
    const out = rows.filter((r) => {
      if (filtro === 'recompra' && r.compras < 2) return false
      if (filtro === 'unica' && r.compras !== 1) return false
      if (!t) return true
      return [r.nombre, r.email, r.telefono, r.ciudad, r.provincia].some((v) => (v || '').toLowerCase().includes(t))
    })
    const k = orden === 'total' ? (r: Comprador) => r.total : orden === 'compras' ? (r: Comprador) => r.compras : (r: Comprador) => (r.ultima ? Date.parse(r.ultima) : 0)
    return out.sort((a, b) => k(b) - k(a))
  }, [rows, q, filtro, orden])

  const recompra = rows.filter((r) => r.compras > 1).length
  const facturado = rows.reduce((s, r) => s + Number(r.total), 0)

  return (
    <div className="bg-white border border-black/10 rounded-xl p-3 space-y-3">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <p className="text-base font-semibold">🛍 Compradores de la tienda</p>
        {!loading && (
          <p className="text-[11px] text-muted">
            {rows.length.toLocaleString('es-AR')} compradores · {recompra} recompraron · {pesos(facturado)} con IVA · desde oct-2025
          </p>
        )}
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <input
          value={q}
          onChange={(e) => { setQ(e.target.value); setLimite(50) }}
          placeholder="Buscar comprador: nombre, mail, teléfono, ciudad…"
          className="flex-1 min-w-[220px] border border-black/10 rounded-lg px-3 py-1.5 text-sm"
        />
        {([['todos', 'Todos'], ['recompra', 'Recompraron'], ['unica', '1 compra']] as [Filtro, string][]).map(([f, l]) => (
          <button key={f} onClick={() => { setFiltro(f); setLimite(50) }} className={`text-xs px-3 py-1.5 rounded-full border ${filtro === f ? 'bg-ink text-white border-ink' : 'border-black/10 text-muted'}`}>
            {l}
          </button>
        ))}
        <select value={orden} onChange={(e) => setOrden(e.target.value as Orden)} className="text-xs border border-black/10 rounded-lg px-2 py-1.5">
          <option value="ultima">Última compra</option>
          <option value="total">Mayor gasto</option>
          <option value="compras">Más compras</option>
        </select>
      </div>

      {loading ? (
        <p className="text-sm text-muted">Cargando compradores…</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[10px] uppercase text-muted text-left border-b border-black/10">
                <th className="py-2 pr-2">Comprador</th>
                <th className="py-2 pr-2">Contacto</th>
                <th className="py-2 pr-2">Localidad</th>
                <th className="py-2 pr-2 text-right">Compras</th>
                <th className="py-2 pr-2 text-right">Uds</th>
                <th className="py-2 pr-2 text-right">Total</th>
                <th className="py-2 pr-2">Última</th>
              </tr>
            </thead>
            <tbody>
              {lista.slice(0, limite).map((r) => (
                <tr key={r.comprador_key} onClick={() => setSel(r)} className="border-b border-black/5 hover:bg-black/[0.02] cursor-pointer">
                  <td className="py-2 pr-2">
                    <p className="font-medium">{r.nombre || '—'}</p>
                    <p className="text-[11px] text-faint">{r.email}</p>
                  </td>
                  <td className="py-2 pr-2"><TelefonoAcciones whatsapp={r.telefono} telefono={null} compact /></td>
                  <td className="py-2 pr-2 text-[12px] text-muted">{[r.ciudad, r.provincia].filter(Boolean).join(', ') || '—'}</td>
                  <td className="py-2 pr-2 text-right tabular-nums">{r.compras}{r.compras > 1 && ' 🔁'}</td>
                  <td className="py-2 pr-2 text-right tabular-nums">{r.unidades}</td>
                  <td className="py-2 pr-2 text-right tabular-nums">{pesos(Number(r.total))}</td>
                  <td className="py-2 pr-2 text-[12px] whitespace-nowrap">{fecha(r.ultima)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {lista.length > limite && (
            <button onClick={() => setLimite((l) => l + 100)} className="mt-2 text-xs text-brandDark font-medium">
              Ver más ({lista.length - limite} restantes)
            </button>
          )}
          {lista.length === 0 && <p className="text-sm text-muted py-3">Sin resultados.</p>}
        </div>
      )}

      {sel && <DetalleComprador c={sel} onClose={() => setSel(null)} />}
    </div>
  )
}

function DetalleComprador({ c, onClose }: { c: Comprador; onClose: () => void }) {
  const [compras, setCompras] = useState<Compra[] | null>(null)

  useEffect(() => {
    supabase
      .from('tienda_compras')
      .select('tienda, order_number, created_at, financial_status, cancelada, unidades, total, descuento_codigo, items')
      .eq('comprador_key', c.comprador_key)
      .order('created_at', { ascending: false })
      .then(({ data }) => setCompras((data as Compra[]) ?? []))
  }, [c.comprador_key])

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-end md:items-center justify-center p-0 md:p-4" onClick={onClose}>
      <div className="bg-white w-full md:max-w-2xl max-h-[90vh] overflow-y-auto rounded-t-2xl md:rounded-2xl p-4 space-y-3" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-start gap-2">
          <div>
            <p className="text-lg font-semibold">{c.nombre || '—'}</p>
            <p className="text-xs text-muted">{c.email}</p>
            <p className="text-xs text-muted">{[c.ciudad, c.provincia].filter(Boolean).join(', ')}</p>
            <div className="mt-1"><TelefonoAcciones whatsapp={c.telefono} telefono={null} /></div>
          </div>
          <button onClick={onClose} className="text-muted text-xl leading-none">×</button>
        </div>

        <div className="grid grid-cols-4 gap-2 text-center">
          {[
            ['Compras', String(c.compras)],
            ['Unidades', String(c.unidades)],
            ['Total', pesos(Number(c.total))],
            ['Cliente desde', fecha(c.primera)],
          ].map(([l, v]) => (
            <div key={l} className="bg-black/[0.03] rounded-lg p-2">
              <p className="text-[10px] uppercase text-muted">{l}</p>
              <p className="text-sm font-semibold">{v}</p>
            </div>
          ))}
        </div>

        {!compras ? (
          <p className="text-sm text-muted">Cargando compras…</p>
        ) : (
          <div className="space-y-2">
            {compras.map((o) => (
              <div key={o.tienda + o.order_number} className={`border rounded-lg p-2.5 ${o.cancelada ? 'border-red-200 opacity-60' : 'border-black/10'}`}>
                <div className="flex flex-wrap justify-between gap-2 text-sm">
                  <p className="font-medium">
                    {fecha(o.created_at)} · {o.order_number}{' '}
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-black/5 text-muted">{TIENDA[o.tienda] || o.tienda}</span>
                    {o.cancelada && <span className="text-[10px] ml-1 text-red-600">cancelada</span>}
                  </p>
                  <p className="font-semibold tabular-nums">{pesos(Number(o.total))}</p>
                </div>
                <ul className="mt-1 text-[12px] text-muted">
                  {o.items.map((it, i) => (
                    <li key={i} className="flex justify-between gap-2">
                      <span>{it.q} × {it.n}</span>
                      <span className="tabular-nums">{pesos(it.p)}</span>
                    </li>
                  ))}
                </ul>
                {(o.descuento_codigo || o.financial_status) && (
                  <p className="mt-1 text-[10px] text-faint">
                    {o.financial_status}{o.descuento_codigo && ` · cupón ${o.descuento_codigo}`}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
