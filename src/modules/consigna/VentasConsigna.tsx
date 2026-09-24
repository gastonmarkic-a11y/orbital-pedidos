// ── Ventas y análisis de la consigna ────────────────────────────────────────
// Lo que el cliente vendió (movimientos 'venta' de consigna_suc_mov, cargados por liquidación o por
// el reporte del cliente) cruzado con el stock de hoy: por tienda y mes, por modelo, por cristal y
// por marco. La central ve todas las tiendas; un link de sucursal, solo la suya (lo filtra la RPC).
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import type { Central } from './CentralConsigna'

type Venta = { sucursal_id: number; mes: string; codigo: string; modelo: string | null; descripcion: string | null; u: number; importe: number }

const fmt = (n: number) => Math.round(n).toLocaleString('es-AR')
const millones = (n: number) => '$' + (n / 1e6).toLocaleString('es-AR', { maximumFractionDigits: 1 }) + ' M'
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
const nombreMes = (m: string) => { const [y, mm] = m.split('-'); return `${MESES[Number(mm) - 1]} ${y.slice(2)}` }

// Descripción "Marco / Lente" (a veces sin barra). El código también dice: termina en P = polarizado, F = flash.
function partes(desc: string | null) {
  const d = (desc ?? '').toLowerCase()
  const i = d.indexOf('/')
  return i >= 0 ? { marco: d.slice(0, i), lente: d.slice(i + 1) } : { marco: d, lente: d }
}
export function tipoCristal(codigo: string, desc: string | null) {
  const { lente } = partes(desc)
  if (codigo.endsWith('P') || /polari/.test(lente)) return 'Polarizado'
  if (codigo.endsWith('F') || /flash|espej/.test(lente)) return 'Espejado / flash'
  if (/incoloro|antirre|antire/.test(lente)) return 'Incoloro (receta)'
  if (/degrad|deg\b|grd/.test(lente)) return 'Degradé'
  return 'Color liso'
}
export function colorCristal(desc: string | null) {
  const { lente } = partes(desc)
  const c: [RegExp, string][] = [[/gris|negro|ngm|ngd/, 'Gris'], [/verde/, 'Verde'], [/celeste|azul/, 'Celeste / azul'],
    [/habano|marr|ha\b|had/, 'Habano / marrón'], [/rosa|rs\b/, 'Rosa'], [/naranja|ocre|amarillo/, 'Naranja / ocre'], [/rojo/, 'Rojo'], [/incoloro|antirre/, 'Incoloro']]
  return c.find(([r]) => r.test(lente))?.[1] ?? 'Otro'
}
export function tipoMarco(desc: string | null) {
  const { marco } = partes(desc)
  if (/negro brillo|ngb|nb\b/.test(marco)) return 'Negro brillo'
  if (/negro|ngm|nm\b/.test(marco)) return 'Negro mate'
  if (/habano|carey|marr|caramelo|ha\b|ca\b/.test(marco)) return 'Habano / carey'
  if (/clear|cristal|transp|cl\b|gris clear/.test(marco)) return 'Transparente'
  if (/dorado|plata|niquel|níquel|do\b|metal/.test(marco)) return 'Metal'
  if (/beige|marfil|blanco|pastel|bl\b/.test(marco)) return 'Claro (beige / marfil)'
  return 'Color'
}

function Barras({ titulo, filas, nota }: { titulo: string; filas: { k: string; v: number; st?: number }[]; nota?: string }) {
  const max = Math.max(1, ...filas.map((f) => Math.max(f.v, f.st ?? 0)))
  const tot = filas.reduce((s, f) => s + f.v, 0) || 1
  return (
    <section className="bg-white border border-black/10 rounded-lg px-4 py-4 flex flex-col gap-3">
      <div>
        <h3 className="text-sm font-semibold">{titulo}</h3>
        {nota && <p className="text-[11px] text-muted mt-0.5">{nota}</p>}
      </div>
      <ul className="flex flex-col gap-2">
        {filas.map((f) => (
          <li key={f.k} className="grid grid-cols-[minmax(96px,150px)_1fr_auto] items-center gap-3 text-xs">
            <span className="truncate">{f.k}</span>
            <span className="relative h-3.5">
              <span className="absolute inset-y-0 left-0 bg-ink rounded-sm" style={{ width: `${(f.v / max) * 100}%` }} />
              {f.st != null && <span className="absolute left-0 top-[5px] h-1 bg-gold rounded-sm" style={{ width: `${(f.st / max) * 100}%` }} />}
            </span>
            <span className="tabular-nums text-muted whitespace-nowrap">
              {fmt(f.v)} u · {Math.round((f.v / tot) * 100)}%{f.st != null && <span className="text-gold"> · st {fmt(f.st)}</span>}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}

export default function VentasConsigna({ clave, data }: { clave: string; data: Central }) {
  const [ventas, setVentas] = useState<Venta[] | null>(null)
  const [suc, setSuc] = useState<number | 'todas'>('todas')
  useEffect(() => {
    supabase.rpc('consigna_ventas', { p_k: clave }).then(({ data: d }) => setVentas((d as Venta[]) ?? []))
  }, [clave])

  const sucs = data.sucursales
  const v = useMemo(() => (ventas ?? []).filter((x) => suc === 'todas' || x.sucursal_id === suc), [ventas, suc])
  const st = useMemo(() => data.stock.filter((l) => suc === 'todas' || l.sucursal_id === suc), [data.stock, suc])
  const meses = useMemo(() => [...new Set((ventas ?? []).map((x) => x.mes))].sort(), [ventas])

  if (!ventas) return <p className="text-sm text-muted">Cargando ventas…</p>
  if (ventas.length === 0) return (
    <p className="text-sm text-muted bg-white border border-black/10 rounded-lg px-4 py-6">
      Todavía no hay ventas cargadas. Aparecen cuando Orbital carga el reporte o la liquidación de ventas.
    </p>
  )

  const totU = v.reduce((s, x) => s + x.u, 0)
  const totImp = v.reduce((s, x) => s + x.importe, 0)
  const totSt = st.reduce((s, l) => s + l.cantidad, 0)
  const porMes = totU / Math.max(1, meses.length)
  const agrupar = (clave: (x: { codigo: string; modelo: string | null; descripcion: string | null }) => string) => {
    const m = new Map<string, { v: number; st: number }>()
    for (const x of v) { const k = clave(x); const o = m.get(k) ?? { v: 0, st: 0 }; o.v += x.u; m.set(k, o) }
    for (const l of st) { const k = clave(l); const o = m.get(k) ?? { v: 0, st: 0 }; o.st += l.cantidad; m.set(k, o) }
    return [...m.entries()].map(([k, o]) => ({ k, v: o.v, st: o.st })).sort((a, b) => b.v - a.v || b.st - a.st)
  }
  const modelos = agrupar((x) => x.modelo ?? '—')
  const agotan = modelos.filter((m) => m.v >= 5 && m.st <= m.v / 3).slice(0, 6)
  const sobran = modelos.filter((m) => m.st >= 8 && m.st > m.v * 2).sort((a, b) => b.st - a.st).slice(0, 6)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted">Ver</span>
        <select id="ventas-suc" aria-label="Tienda" value={suc} onChange={(e) => setSuc(e.target.value === 'todas' ? 'todas' : Number(e.target.value))}
          className="text-sm border border-black/15 rounded-lg px-2.5 py-1.5 bg-white">
          <option value="todas">Todas las tiendas</option>
          {sucs.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
        </select>
        <span className="text-xs text-muted">Período: {meses.map(nombreMes).join(' · ')}</span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-black/10 border border-black/10 rounded-lg overflow-hidden">
        {[
          [`${fmt(totU)} u`, 'vendidas en el período'],
          [totImp ? millones(totImp) : '—', 'en ventas (precio de tienda)'],
          [`${fmt(totSt)} u`, 'en stock hoy'],
          [porMes ? `${(totSt / porMes).toLocaleString('es-AR', { maximumFractionDigits: 1 })} meses` : '—', 'de stock al ritmo de venta'],
        ].map(([a, b]) => (
          <div key={b} className="bg-white px-4 py-3">
            <div className="text-xl font-semibold tabular-nums">{a}</div>
            <div className="text-[11px] text-muted">{b}</div>
          </div>
        ))}
      </div>

      {suc === 'todas' && (
        <section className="bg-white border border-black/10 rounded-lg overflow-x-auto">
          <table className="w-full text-sm min-w-[560px]">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-muted text-left">
                <th className="px-4 py-2.5 font-medium">Tienda</th>
                {meses.map((m) => <th key={m} className="px-3 py-2.5 font-medium text-right">{nombreMes(m)}</th>)}
                <th className="px-3 py-2.5 font-medium text-right">Vendido</th>
                <th className="px-3 py-2.5 font-medium text-right">Importe</th>
                <th className="px-3 py-2.5 font-medium text-right">Stock hoy</th>
                <th className="px-4 py-2.5 font-medium text-right">Meses de stock</th>
              </tr>
            </thead>
            <tbody>
              {sucs.map((s) => {
                const vs = ventas.filter((x) => x.sucursal_id === s.id)
                const u = vs.reduce((a, x) => a + x.u, 0)
                const stock = data.stock.filter((l) => l.sucursal_id === s.id).reduce((a, l) => a + l.cantidad, 0)
                const cob = u ? stock / (u / Math.max(1, meses.length)) : null
                return (
                  <tr key={s.id} className="border-t border-black/5">
                    <td className="px-4 py-2">{s.nombre}</td>
                    {meses.map((m) => <td key={m} className="px-3 py-2 text-right tabular-nums">{fmt(vs.filter((x) => x.mes === m).reduce((a, x) => a + x.u, 0))}</td>)}
                    <td className="px-3 py-2 text-right tabular-nums font-semibold">{fmt(u)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{millones(vs.reduce((a, x) => a + x.importe, 0))}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmt(stock)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {cob == null ? '—' : cob > 6
                        ? <span className="text-[11px] rounded px-1.5 py-0.5 bg-amber-100 text-amber-800">{cob.toFixed(1)} · exceso</span>
                        : cob.toFixed(1)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </section>
      )}

      <div className="grid md:grid-cols-2 gap-4">
        <section className="bg-white border border-black/10 rounded-lg px-4 py-4">
          <h3 className="text-sm font-semibold">Se agotan</h3>
          <p className="text-[11px] text-muted">Venden mucho y queda poco stock: son los que conviene reponer primero.</p>
          <ul className="mt-2 text-sm divide-y divide-black/5">
            {agotan.length ? agotan.map((m) => <li key={m.k} className="py-1.5 flex justify-between"><span>{m.k}</span><span className="tabular-nums text-muted">{m.v} vendidos · {m.st} en stock</span></li>)
              : <li className="py-1.5 text-muted">Nada crítico.</li>}
          </ul>
        </section>
        <section className="bg-white border border-black/10 rounded-lg px-4 py-4">
          <h3 className="text-sm font-semibold">No rotan</h3>
          <p className="text-[11px] text-muted">Mucho stock para lo que venden: candidatos a mover de tienda o devolver.</p>
          <ul className="mt-2 text-sm divide-y divide-black/5">
            {sobran.length ? sobran.map((m) => <li key={m.k} className="py-1.5 flex justify-between"><span>{m.k}</span><span className="tabular-nums text-muted">{m.v} vendidos · {m.st} en stock</span></li>)
              : <li className="py-1.5 text-muted">Sin excesos.</li>}
          </ul>
        </section>
      </div>

      <div className="flex flex-wrap gap-4 text-[11px] text-muted">
        <span><i className="inline-block w-3 h-2 bg-ink rounded-sm mr-1.5 align-middle" />Vendido</span>
        <span><i className="inline-block w-3 h-1 bg-gold rounded-sm mr-1.5 align-middle" />Stock hoy</span>
      </div>
      <div className="grid md:grid-cols-2 gap-4">
        <Barras titulo="Tipo de cristal" nota="Polarizado y flash salen del código y la descripción del color." filas={agrupar((x) => tipoCristal(x.codigo, x.descripcion))} />
        <Barras titulo="Color de cristal" filas={agrupar((x) => colorCristal(x.descripcion))} />
        <Barras titulo="Marco" filas={agrupar((x) => tipoMarco(x.descripcion))} />
        <Barras titulo="Modelos" nota="Los 12 más vendidos." filas={modelos.slice(0, 12)} />
      </div>
    </div>
  )
}
