import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'
import { useToast } from '../../lib/toast'

// Cristales: stock por base + color + tipo (las órdenes activas ya están descontadas), lo comprometido por
// órdenes pendientes y el proyectado. Abajo, la asociación SKU → cristal que usa el generador.

export interface CristalResumen {
  cristal_id: number
  base: string
  color: string
  tipo: string
  stock: number
  comprometido: number
  proyectado: number
  consumido_ordenes: number
  skus: number
  consumo_por_unidad: number
}
interface SkuCristal {
  sku: string
  armazon_id: string
  color_cristal: string | null
  cristal_id: number | null
  cristal_match: string | null
}

const ent = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 })
export const cristalLabel = (c: { base: string; color: string; tipo: string }) => `${c.base} · ${c.color} · ${c.tipo}`

export default function CristalesProduccion() {
  const { rolEfectivo } = useAuth()
  const puedeGestionar = rolEfectivo === 'produccion' || rolEfectivo === 'admin'
  const toast = useToast()
  const [cristales, setCristales] = useState<CristalResumen[]>([])
  const [skus, setSkus] = useState<SkuCristal[]>([])
  const [desc, setDesc] = useState<Record<string, string>>({})
  const [soloRevisar, setSoloRevisar] = useState(true)
  const [loading, setLoading] = useState(true)

  async function cargar() {
    const [{ data: res }, { data: hab }] = await Promise.all([
      supabase.rpc('cristales_resumen'),
      supabase.from('skus_habilitados_produccion').select('sku, armazon_id, color_cristal, cristal_id, cristal_match').eq('activo', true),
    ])
    setCristales((res as CristalResumen[]) ?? [])
    const lista = (hab as SkuCristal[]) ?? []
    setSkus(lista)
    const { data: st } = await supabase.from('stock').select('codigo, descripcion').in('codigo', lista.map((s) => s.sku))
    const d: Record<string, string> = {}
    for (const r of (st as { codigo: string; descripcion: string }[]) ?? []) d[r.codigo] = r.descripcion
    setDesc(d)
    setLoading(false)
  }

  useEffect(() => {
    cargar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function asignar(sku: string, cristalId: number | null) {
    const { error } = await supabase
      .from('skus_habilitados_produccion')
      .update({ cristal_id: cristalId, cristal_match: cristalId ? 'manual' : null })
      .eq('sku', sku)
    if (error) return toast('No se pudo guardar: ' + error.message, 'error')
    setSkus((prev) => prev.map((s) => (s.sku === sku ? { ...s, cristal_id: cristalId, cristal_match: cristalId ? 'manual' : null } : s)))
    toast('Cristal asociado', 'success')
  }

  const porBase = useMemo(() => {
    const m = new Map<string, CristalResumen[]>()
    for (const c of cristales) {
      if (!m.has(c.base)) m.set(c.base, [])
      m.get(c.base)!.push(c)
    }
    return [...m.entries()]
  }, [cristales])

  const porModelo = useMemo(() => {
    const m = new Map<string, SkuCristal[]>()
    for (const s of skus) {
      if (soloRevisar && s.cristal_id && s.cristal_match !== 'aproximado') continue
      const k = s.armazon_id || '(sin modelo)'
      if (!m.has(k)) m.set(k, [])
      m.get(k)!.push(s)
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [skus, soloRevisar])

  if (loading) return <p className="text-sm text-muted p-4">Cargando cristales…</p>

  const sinAsignar = skus.filter((s) => !s.cristal_id).length
  const aprox = skus.filter((s) => s.cristal_match === 'aproximado').length
  const totStock = cristales.reduce((a, c) => a + c.stock, 0)
  const totComp = cristales.reduce((a, c) => a + c.comprometido, 0)

  return (
    <div className="space-y-4 text-ink">
      <div>
        <h2 className="text-base font-semibold">🔬 Cristales</h2>
        <p className="text-[11px] text-faint">
          Stock {ent.format(totStock)} · comprometido en órdenes pendientes {ent.format(totComp)} · proyectado {ent.format(totStock - totComp)}.
          Al activar una orden se descuenta del stock; si se anula, vuelve.
        </p>
      </div>

      {porBase.map(([base, rows]) => (
        <div key={base} className="bg-white rounded-xl p-4 border border-black/10 overflow-x-auto">
          <p className="text-sm font-semibold mb-2">{base}</p>
          <table className="w-full text-[11px] min-w-[520px]">
            <thead className="text-faint uppercase">
              <tr>
                <th className="text-left font-medium pb-1">Color</th>
                <th className="text-left font-medium pb-1">Tipo</th>
                <th className="text-right font-medium pb-1">Stock</th>
                <th className="text-right font-medium pb-1">Comprometido</th>
                <th className="text-right font-medium pb-1">Proyectado</th>
                <th className="text-right font-medium pb-1">SKUs</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.cristal_id} className="border-t border-black/5">
                  <td className="py-1">{c.color}</td>
                  <td className="py-1 text-muted">{c.tipo}</td>
                  <td className={`py-1 text-right ${c.stock < 0 ? 'text-red-600 font-semibold' : ''}`}>{ent.format(c.stock)}</td>
                  <td className="py-1 text-right text-muted">{c.comprometido ? ent.format(c.comprometido) : '—'}</td>
                  <td className={`py-1 text-right font-semibold ${c.proyectado < 0 ? 'text-red-600' : ''}`}>{ent.format(c.proyectado)}</td>
                  <td className="py-1 text-right text-faint">{c.skus || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      <div className="bg-white rounded-xl p-4 border border-black/10">
        <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
          <div>
            <p className="text-sm font-semibold">🔗 Cristal de cada SKU</p>
            <p className="text-[11px] text-faint">
              {sinAsignar} sin cristal · {aprox} sugeridos aproximados (revisar). Sin cristal, la orden no descuenta.
            </p>
          </div>
          <label className="flex items-center gap-2 text-xs text-muted">
            <input type="checkbox" checked={soloRevisar} onChange={(e) => setSoloRevisar(e.target.checked)} />
            Solo a revisar
          </label>
        </div>
        {porModelo.length === 0 ? (
          <p className="text-sm text-faint">Todo asociado.</p>
        ) : (
          <div className="space-y-3">
            {porModelo.map(([modelo, lista]) => (
              <div key={modelo}>
                <p className="text-xs font-semibold text-muted uppercase tracking-wide mb-1">{modelo}</p>
                {lista.map((s) => (
                  <div key={s.sku} className="flex items-center gap-2 flex-wrap border-t border-black/5 py-1.5 text-[11px]">
                    <span className="flex-1 min-w-[180px]">
                      {desc[s.sku] ?? s.color_cristal ?? '—'} <span className="text-faint font-mono">· {s.sku}</span>
                    </span>
                    {!s.cristal_id && <span className="text-red-600">sin cristal</span>}
                    {s.cristal_match === 'aproximado' && <span className="text-amber-600">⚠ aproximado</span>}
                    <select
                      disabled={!puedeGestionar}
                      value={s.cristal_id ?? ''}
                      onChange={(e) => asignar(s.sku, e.target.value ? Number(e.target.value) : null)}
                      className="max-w-full bg-white border border-black/10 rounded px-1.5 py-1 text-[11px]"
                    >
                      <option value="">— sin cristal —</option>
                      {cristales.map((c) => (
                        <option key={c.cristal_id} value={c.cristal_id}>
                          {cristalLabel(c)} ({ent.format(c.proyectado)})
                        </option>
                      ))}
                    </select>
                    {puedeGestionar && s.cristal_id && s.cristal_match === 'aproximado' && (
                      <button onClick={() => asignar(s.sku, s.cristal_id)} className="text-[11px] px-2 py-1 rounded bg-brand/10 text-brandDark font-medium">
                        OK
                      </button>
                    )}
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
