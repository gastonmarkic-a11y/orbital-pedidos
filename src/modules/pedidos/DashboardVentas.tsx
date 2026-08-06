import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'

// Dashboard de ventas (Tango unificado, todas las empresas internas).
// - Admin / Administración: general, con desglose por zona y por vendedor (cartera).
// - Cada vendedor/prospecto: solo su cartera = los clientes que tiene asignados (vendedor_asignado),
//   con top de clientes. Mes seleccionable, comparación mes/año, ARS o USD (por cotización).

interface MesRow { anio_mes: string; canal: string; unidades: number; importe_ars: number; importe_usd: number; comprobantes: number }
interface DimRow { anio_mes: string; unidades: number; importe_ars: number; importe_usd: number }
interface CliRow extends DimRow { cod_cliente: string }

const fmtUsd = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
const fmtArs = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 })
const ent = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 })
const MESN = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
const etiqueta = (am: string) => { const [y, m] = am.split('-'); return `${MESN[+m - 1]} ${y.slice(2)}` }

export default function DashboardVentas() {
  const { rolEfectivo, codigoEfectivo } = useAuth()
  const esGeneral = rolEfectivo === 'admin' || rolEfectivo === 'administracion'

  const [porMesArr, setPorMesArr] = useState<{ anio_mes: string; u: number; ars: number; usd: number; comp: number }[]>([])
  const [zonaRows, setZonaRows] = useState<(DimRow & { zona: string })[]>([])
  const [vendRows, setVendRows] = useState<(DimRow & { vendedor: string })[]>([])
  const [cliRows, setCliRows] = useState<CliRow[]>([])
  const [cliNombre, setCliNombre] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [moneda, setMoneda] = useState<'usd' | 'ars'>('usd')
  const [mesSel, setMesSel] = useState<string>('')

  useEffect(() => {
    let cancel = false
    async function cargar() {
      setLoading(true)
      if (esGeneral) {
        const [m, z, v] = await Promise.all([
          supabase.from('ventas_hist_mes').select('*'),
          supabase.from('ventas_hist_zona').select('*'),
          supabase.from('ventas_hist_vendedor').select('*'),
        ])
        if (cancel) return
        const map = new Map<string, { u: number; ars: number; usd: number; comp: number }>()
        for (const r of (m.data as MesRow[]) ?? []) {
          const a = map.get(r.anio_mes) ?? { u: 0, ars: 0, usd: 0, comp: 0 }
          a.u += r.unidades; a.ars += r.importe_ars; a.usd += r.importe_usd; a.comp += r.comprobantes
          map.set(r.anio_mes, a)
        }
        setPorMesArr([...map.entries()].map(([anio_mes, x]) => ({ anio_mes, ...x })))
        setZonaRows((z.data as (DimRow & { zona: string })[]) ?? [])
        setVendRows((v.data as (DimRow & { vendedor: string })[]) ?? [])
      } else {
        // Cartera: clientes asignados a este vendedor/prospecto
        const { data: cls } = await supabase.from('clientes').select('cod, razon, nomcomerc').eq('vendedor_asignado', codigoEfectivo)
        const cods = ((cls as { cod: string; razon: string | null; nomcomerc: string | null }[]) ?? [])
        const nombres: Record<string, string> = {}
        for (const c of cods) nombres[c.cod] = c.nomcomerc || c.razon || c.cod
        const lista = cods.map((c) => c.cod)
        const ventas: CliRow[] = []
        for (let i = 0; i < lista.length; i += 300) {
          const { data } = await supabase.from('ventas_hist_cliente').select('*').in('cod_cliente', lista.slice(i, i + 300))
          ventas.push(...((data as CliRow[]) ?? []))
        }
        if (cancel) return
        const map = new Map<string, { u: number; ars: number; usd: number; comp: number }>()
        for (const r of ventas) {
          const a = map.get(r.anio_mes) ?? { u: 0, ars: 0, usd: 0, comp: 0 }
          a.u += r.unidades; a.ars += r.importe_ars; a.usd += r.importe_usd; a.comp += 0
          map.set(r.anio_mes, a)
        }
        setPorMesArr([...map.entries()].map(([anio_mes, x]) => ({ anio_mes, ...x })))
        setCliRows(ventas)
        setCliNombre(nombres)
      }
      if (!cancel) setLoading(false)
    }
    cargar()
    return () => { cancel = true }
  }, [esGeneral, codigoEfectivo])

  const val = (r: { importe_usd: number; importe_ars: number }) => (moneda === 'usd' ? r.importe_usd : r.importe_ars)
  const fmt = (n: number) => (moneda === 'usd' ? fmtUsd : fmtArs).format(n)

  const porMes = useMemo(() => new Map(porMesArr.map((r) => [r.anio_mes, r])), [porMesArr])
  const meses = useMemo(() => [...porMes.keys()].sort(), [porMes])
  useEffect(() => { if (meses.length) setMesSel(meses[meses.length - 1]) }, [meses])

  if (loading) return <p className="text-sm text-muted p-4">Cargando ventas…</p>
  if (!meses.length) return <p className="text-sm text-faint p-4">{esGeneral ? 'Todavía no hay ventas cargadas.' : 'No hay ventas históricas para tu cartera todavía.'}</p>
  if (!mesSel || !porMes.get(mesSel)) return <p className="text-sm text-muted p-4">Cargando ventas…</p>

  const cur = porMes.get(mesSel)!
  const curVal = moneda === 'usd' ? cur.usd : cur.ars
  const idx = meses.indexOf(mesSel)
  const prev = idx > 0 ? porMes.get(meses[idx - 1]) : null
  const [y, m] = mesSel.split('-')
  const mismoMesAnt = porMes.get(`${+y - 1}-${m}`)
  const varPct = (base?: { ars: number; usd: number } | null) => {
    if (!base) return null
    const b = moneda === 'usd' ? base.usd : base.ars
    if (!b) return null
    return Math.round(((curVal - b) / Math.abs(b)) * 100)
  }
  const vsPrev = varPct(prev)
  const vsAnual = varPct(mismoMesAnt)

  const ult24 = meses.slice(-24)
  const maxBar = Math.max(...ult24.map((am) => (moneda === 'usd' ? porMes.get(am)!.usd : porMes.get(am)!.ars)), 1)

  const porAnio = new Map<string, number>()
  for (const [am, v] of porMes) { const a = am.slice(0, 4); porAnio.set(a, (porAnio.get(a) ?? 0) + (moneda === 'usd' ? v.usd : v.ars)) }
  const anios = [...porAnio.keys()].sort()
  const maxAnio = Math.max(...anios.map((a) => porAnio.get(a)!), 1)

  const zonaMes = zonaRows.filter((r) => r.anio_mes === mesSel).map((r) => ({ k: r.zona, v: val(r) })).filter((r) => r.v > 0).sort((a, b) => b.v - a.v)
  const vendMes = vendRows.filter((r) => r.anio_mes === mesSel).map((r) => ({ k: r.vendedor, v: val(r) })).filter((r) => r.v > 0).sort((a, b) => b.v - a.v)
  const cliMes = cliRows.filter((r) => r.anio_mes === mesSel).map((r) => ({ k: cliNombre[r.cod_cliente] || r.cod_cliente, v: val(r) })).filter((r) => r.v > 0).sort((a, b) => b.v - a.v).slice(0, 20)

  const Barras = ({ data, max }: { data: { k: string; v: number }[]; max: number }) => (
    <div className="space-y-1.5">
      {data.map((d) => (
        <div key={d.k} className="flex items-center gap-2 text-xs">
          <span className="w-32 truncate text-muted shrink-0" title={d.k}>{d.k}</span>
          <div className="flex-1 h-3.5 bg-black/5 rounded-full overflow-hidden">
            <div className="h-full rounded-full bg-brand" style={{ width: `${Math.max(0, (d.v / max) * 100)}%` }} />
          </div>
          <span className="w-24 text-right font-semibold text-ink shrink-0">{fmt(d.v)}</span>
        </div>
      ))}
      {data.length === 0 && <p className="text-xs text-faint">Sin datos este mes.</p>}
    </div>
  )
  const Delta = ({ pct, label }: { pct: number | null; label: string }) => (
    <span className="text-[11px]">{label}: {pct == null ? '—' : <b className={pct >= 0 ? 'text-emerald-600' : 'text-red-600'}>{pct >= 0 ? '+' : ''}{pct}%</b>}</span>
  )

  return (
    <div className="space-y-4 text-ink">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h2 className="text-base font-semibold">📈 Ventas {esGeneral ? '— general' : '— mi cartera'}</h2>
          <p className="text-[11px] text-faint">
            {esGeneral ? 'Todas las empresas' : 'Tus clientes asignados'} · 2020 → {etiqueta(meses[meses.length - 1])}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex bg-white border border-black/10 rounded-lg p-0.5">
            {(['usd', 'ars'] as const).map((mo) => (
              <button key={mo} onClick={() => setMoneda(mo)} className={`text-xs px-3 py-1.5 rounded-md font-medium ${moneda === mo ? 'bg-brand text-white' : 'text-muted'}`}>{mo.toUpperCase()}</button>
            ))}
          </div>
          <select value={mesSel} onChange={(e) => setMesSel(e.target.value)} className="text-sm bg-white border border-black/10 rounded-lg px-2 py-1.5">
            {[...meses].reverse().map((am) => <option key={am} value={am}>{etiqueta(am)}</option>)}
          </select>
        </div>
      </div>

      <div className="bg-white rounded-xl p-4 border border-black/10">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div>
            <p className="text-[10px] text-faint uppercase tracking-wide">Ventas {etiqueta(mesSel)}</p>
            <p className="text-2xl font-bold text-brandDark">{fmt(curVal)}</p>
            <p className="text-[11px] text-muted">{ent.format(cur.u)} u.{esGeneral ? ` · ${ent.format(cur.comp)} comprobantes` : ''}</p>
          </div>
          <div className="flex flex-col gap-1 text-right">
            <Delta pct={vsPrev} label="vs mes anterior" />
            <Delta pct={vsAnual} label={`vs ${etiqueta(`${+y - 1}-${m}`)}`} />
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl p-4 border border-black/10">
        <p className="text-xs font-semibold text-muted uppercase tracking-wide mb-3">Evolución (últimos 24 meses · {moneda.toUpperCase()})</p>
        <div className="flex items-end gap-1 h-32">
          {ult24.map((am) => {
            const v = moneda === 'usd' ? porMes.get(am)!.usd : porMes.get(am)!.ars
            return <div key={am} className="flex-1 flex flex-col items-center justify-end h-full" title={`${etiqueta(am)}: ${fmt(v)}`}>
              <div className={`w-full rounded-t ${am === mesSel ? 'bg-brandDark' : 'bg-brand/60'}`} style={{ height: `${Math.max(1, (v / maxBar) * 100)}%` }} />
            </div>
          })}
        </div>
        <div className="flex gap-1 mt-1">
          {ult24.map((am) => <span key={am} className="flex-1 text-center text-[8px] text-faint">{am.endsWith('-01') || am === mesSel ? etiqueta(am) : ''}</span>)}
        </div>
      </div>

      <div className="bg-white rounded-xl p-4 border border-black/10">
        <p className="text-xs font-semibold text-muted uppercase tracking-wide mb-3">Por año ({moneda.toUpperCase()})</p>
        <Barras data={anios.map((a) => ({ k: a, v: porAnio.get(a)! }))} max={maxAnio} />
      </div>

      {esGeneral ? (
        <div className="grid md:grid-cols-2 gap-3">
          <div className="bg-white rounded-xl p-4 border border-black/10">
            <p className="text-xs font-semibold text-muted uppercase tracking-wide mb-3">Por zona · {etiqueta(mesSel)}</p>
            <Barras data={zonaMes} max={Math.max(...zonaMes.map((d) => d.v), 1)} />
          </div>
          <div className="bg-white rounded-xl p-4 border border-black/10">
            <p className="text-xs font-semibold text-muted uppercase tracking-wide mb-3">Por vendedor (cartera) · {etiqueta(mesSel)}</p>
            <Barras data={vendMes} max={Math.max(...vendMes.map((d) => d.v), 1)} />
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-xl p-4 border border-black/10">
          <p className="text-xs font-semibold text-muted uppercase tracking-wide mb-3">Top clientes de tu cartera · {etiqueta(mesSel)}</p>
          <Barras data={cliMes} max={Math.max(...cliMes.map((d) => d.v), 1)} />
        </div>
      )}

      <p className="text-[10px] text-faint">
        Tango facturado, empresas unificadas (Plenorius + Ejemplar + Plastic), NC restadas. USD por la cotización de cada
        comprobante (comparás años sin el ruido de la inflación).
      </p>
    </div>
  )
}
