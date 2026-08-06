import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'

// Dashboard de ventas — SOLO PESOS (ARS).
// - Admin / Administración: general. Total = b2b (Tango, empresas unificadas) + b2c (Shopify minorista).
//   Desglose por zona, por vendedor (cartera real según código de cliente) y reparto b2b/b2c.
// - Cada vendedor/prospecto: su cartera = clientes asignados (vendedor_asignado por código), con top de clientes.

interface MesRow { anio_mes: string; unidades: number; importe_ars: number; comprobantes: number }
interface CartRow { anio_mes: string; vendedor: string; unidades: number; importe_ars: number }
interface ZonaRow { anio_mes: string; zona: string; unidades: number; importe_ars: number }
interface EcomRow { anio_mes: string; unidades: number; importe_ars: number; comprobantes: number }
interface CliRow { anio_mes: string; cod_cliente: string; unidades: number; importe_ars: number }

const fmtArs = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 })
const ent = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 })
const fmt = (n: number) => fmtArs.format(n)
const MESN = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
const etiqueta = (am: string) => { const [y, m] = am.split('-'); return `${MESN[+m - 1]} ${y.slice(2)}` }

// b2b = mayorista (ópticas / Tango). b2c = minorista (e-commerce Shopify).
interface Punto { u: number; ars: number; comp: number; b2b: number; b2c: number }

export default function DashboardVentas() {
  const { rolEfectivo, codigoEfectivo } = useAuth()
  const esGeneral = rolEfectivo === 'admin' || rolEfectivo === 'administracion'

  const [datos, setDatos] = useState<{ anio_mes: string; p: Punto }[]>([])
  const [zonaRows, setZonaRows] = useState<ZonaRow[]>([])
  const [cartRows, setCartRows] = useState<CartRow[]>([])
  const [cliRows, setCliRows] = useState<CliRow[]>([])
  const [cliNombre, setCliNombre] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [mesSel, setMesSel] = useState<string>('')

  useEffect(() => {
    let cancel = false
    async function cargar() {
      setLoading(true)
      if (esGeneral) {
        const [m, z, c, e] = await Promise.all([
          supabase.from('ventas_hist_mes').select('anio_mes,unidades,importe_ars,comprobantes'),
          supabase.from('ventas_hist_zona').select('anio_mes,zona,unidades,importe_ars'),
          supabase.from('v_ventas_cartera_mes').select('anio_mes,vendedor,unidades,importe_ars'),
          supabase.from('v_ventas_ecom_mes').select('anio_mes,unidades,importe_ars,comprobantes'),
        ])
        if (cancel) return
        const map = new Map<string, Punto>()
        const get = (am: string) => { let a = map.get(am); if (!a) { a = { u: 0, ars: 0, comp: 0, b2b: 0, b2c: 0 }; map.set(am, a) } return a }
        for (const r of (m.data as MesRow[]) ?? []) { const a = get(r.anio_mes); a.u += r.unidades; a.ars += r.importe_ars; a.comp += r.comprobantes; a.b2b += r.importe_ars }
        for (const r of (e.data as EcomRow[]) ?? []) { const a = get(r.anio_mes); a.u += r.unidades; a.ars += r.importe_ars; a.comp += r.comprobantes; a.b2c += r.importe_ars }
        setDatos([...map.entries()].map(([anio_mes, p]) => ({ anio_mes, p })))
        setZonaRows((z.data as ZonaRow[]) ?? [])
        setCartRows((c.data as CartRow[]) ?? [])
      } else {
        const { data: cls } = await supabase.from('clientes').select('cod, razon, nomcomerc').eq('vendedor_asignado', codigoEfectivo)
        const cods = ((cls as { cod: string; razon: string | null; nomcomerc: string | null }[]) ?? [])
        const nombres: Record<string, string> = {}
        for (const c of cods) nombres[c.cod] = c.nomcomerc || c.razon || c.cod
        const lista = cods.map((c) => c.cod)
        const ventas: CliRow[] = []
        for (let i = 0; i < lista.length; i += 300) {
          const { data } = await supabase.from('ventas_hist_cliente').select('anio_mes,cod_cliente,unidades,importe_ars').in('cod_cliente', lista.slice(i, i + 300))
          ventas.push(...((data as CliRow[]) ?? []))
        }
        if (cancel) return
        const map = new Map<string, Punto>()
        for (const r of ventas) { let a = map.get(r.anio_mes); if (!a) { a = { u: 0, ars: 0, comp: 0, b2b: 0, b2c: 0 }; map.set(r.anio_mes, a) } a.u += r.unidades; a.ars += r.importe_ars; a.b2b += r.importe_ars }
        setDatos([...map.entries()].map(([anio_mes, p]) => ({ anio_mes, p })))
        setCliRows(ventas)
        setCliNombre(nombres)
      }
      if (!cancel) setLoading(false)
    }
    cargar()
    return () => { cancel = true }
  }, [esGeneral, codigoEfectivo])

  const porMes = useMemo(() => new Map(datos.map((r) => [r.anio_mes, r.p])), [datos])
  const meses = useMemo(() => [...porMes.keys()].sort(), [porMes])
  useEffect(() => { if (meses.length) setMesSel(meses[meses.length - 1]) }, [meses])

  if (loading) return <p className="text-sm text-muted p-4">Cargando ventas…</p>
  if (!meses.length) return <p className="text-sm text-faint p-4">{esGeneral ? 'Todavía no hay ventas cargadas.' : 'No hay ventas históricas para tu cartera todavía.'}</p>
  if (!mesSel || !porMes.get(mesSel)) return <p className="text-sm text-muted p-4">Cargando ventas…</p>

  const cur = porMes.get(mesSel)!
  const idx = meses.indexOf(mesSel)
  const prev = idx > 0 ? porMes.get(meses[idx - 1]) : null
  const [y, m] = mesSel.split('-')
  const mismoMesAnt = porMes.get(`${+y - 1}-${m}`)
  const varPct = (base?: Punto | null) => { if (!base || !base.ars) return null; return Math.round(((cur.ars - base.ars) / Math.abs(base.ars)) * 100) }
  const vsPrev = varPct(prev)
  const vsAnual = varPct(mismoMesAnt)

  const ult24 = meses.slice(-24)
  const maxBar = Math.max(...ult24.map((am) => porMes.get(am)!.ars), 1)

  const porAnio = new Map<string, number>()
  for (const [am, v] of porMes) { const a = am.slice(0, 4); porAnio.set(a, (porAnio.get(a) ?? 0) + v.ars) }
  const anios = [...porAnio.keys()].sort()
  const maxAnio = Math.max(...anios.map((a) => porAnio.get(a)!), 1)

  const zonaMes = zonaRows.filter((r) => r.anio_mes === mesSel).map((r) => ({ k: r.zona, v: r.importe_ars })).filter((r) => r.v > 0).sort((a, b) => b.v - a.v)
  const cartMes = cartRows.filter((r) => r.anio_mes === mesSel).map((r) => ({ k: r.vendedor, v: r.importe_ars })).filter((r) => r.v > 0).sort((a, b) => b.v - a.v)
  const cliMes = cliRows.filter((r) => r.anio_mes === mesSel).map((r) => ({ k: cliNombre[r.cod_cliente] || r.cod_cliente, v: r.importe_ars })).filter((r) => r.v > 0).sort((a, b) => b.v - a.v).slice(0, 20)

  const totCanal = cur.b2b + cur.b2c
  const pctB2b = totCanal ? Math.round((cur.b2b / totCanal) * 100) : 0
  const pctB2c = 100 - pctB2b

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
            {esGeneral ? 'Mayorista (Tango) + minorista (Shopify) · en pesos' : 'Tus clientes asignados · en pesos'} · hasta {etiqueta(meses[meses.length - 1])}
          </p>
        </div>
        <select value={mesSel} onChange={(e) => setMesSel(e.target.value)} className="text-sm bg-white border border-black/10 rounded-lg px-2 py-1.5">
          {[...meses].reverse().map((am) => <option key={am} value={am}>{etiqueta(am)}</option>)}
        </select>
      </div>

      <div className="bg-white rounded-xl p-4 border border-black/10">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div>
            <p className="text-[10px] text-faint uppercase tracking-wide">Ventas {etiqueta(mesSel)}</p>
            <p className="text-2xl font-bold text-brandDark">{fmt(cur.ars)}</p>
            <p className="text-[11px] text-muted">{ent.format(cur.u)} u.{esGeneral ? ` · ${ent.format(cur.comp)} comprobantes` : ''}</p>
          </div>
          <div className="flex flex-col gap-1 text-right">
            <Delta pct={vsPrev} label="vs mes anterior" />
            <Delta pct={vsAnual} label={`vs ${etiqueta(`${+y - 1}-${m}`)}`} />
          </div>
        </div>
      </div>

      {esGeneral && (
        <div className="bg-white rounded-xl p-4 border border-black/10">
          <p className="text-xs font-semibold text-muted uppercase tracking-wide mb-3">Reparto por canal · {etiqueta(mesSel)}</p>
          {totCanal > 0 ? (
            <>
              <div className="flex h-6 rounded-lg overflow-hidden mb-2">
                <div className="bg-brand h-full flex items-center justify-center text-white text-[10px] font-semibold" style={{ width: `${pctB2b}%` }} title={`B2B ${pctB2b}%`}>{pctB2b >= 12 ? `B2B ${pctB2b}%` : ''}</div>
                <div className="bg-amber-500 h-full flex items-center justify-center text-white text-[10px] font-semibold" style={{ width: `${pctB2c}%` }} title={`B2C ${pctB2c}%`}>{pctB2c >= 12 ? `B2C ${pctB2c}%` : ''}</div>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-lg border border-black/10 p-2">
                  <p className="text-[10px] text-faint uppercase">B2B · Mayorista (ópticas)</p>
                  <p className="font-bold text-brandDark">{fmt(cur.b2b)}</p>
                  <p className="text-[11px] text-muted">{pctB2b}% del total</p>
                </div>
                <div className="rounded-lg border border-black/10 p-2">
                  <p className="text-[10px] text-faint uppercase">B2C · Minorista (e-commerce)</p>
                  <p className="font-bold text-amber-600">{fmt(cur.b2c)}</p>
                  <p className="text-[11px] text-muted">{pctB2c}% del total</p>
                </div>
              </div>
              {cur.b2c === 0 && <p className="text-[10px] text-faint mt-2">Minorista (Shopify) disponible desde oct-25. Meses previos no tienen e-commerce cargado.</p>}
            </>
          ) : <p className="text-xs text-faint">Sin datos de canal este mes.</p>}
        </div>
      )}

      <div className="bg-white rounded-xl p-4 border border-black/10">
        <p className="text-xs font-semibold text-muted uppercase tracking-wide mb-3">Evolución (últimos 24 meses)</p>
        <div className="flex items-end gap-1 h-32">
          {ult24.map((am) => {
            const v = porMes.get(am)!.ars
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
        <p className="text-xs font-semibold text-muted uppercase tracking-wide mb-3">Por año</p>
        <Barras data={anios.map((a) => ({ k: a, v: porAnio.get(a)! }))} max={maxAnio} />
        <p className="text-[10px] text-faint mt-2">Valores nominales en pesos: entre años pesa la inflación (no es comparación real de volumen).</p>
      </div>

      {esGeneral ? (
        <div className="grid md:grid-cols-2 gap-3">
          <div className="bg-white rounded-xl p-4 border border-black/10">
            <p className="text-xs font-semibold text-muted uppercase tracking-wide mb-3">Por zona · {etiqueta(mesSel)}</p>
            <Barras data={zonaMes} max={Math.max(...zonaMes.map((d) => d.v), 1)} />
          </div>
          <div className="bg-white rounded-xl p-4 border border-black/10">
            <p className="text-xs font-semibold text-muted uppercase tracking-wide mb-3">Por vendedor (cartera) · {etiqueta(mesSel)}</p>
            <Barras data={cartMes} max={Math.max(...cartMes.map((d) => d.v), 1)} />
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-xl p-4 border border-black/10">
          <p className="text-xs font-semibold text-muted uppercase tracking-wide mb-3">Top clientes de tu cartera · {etiqueta(mesSel)}</p>
          <Barras data={cliMes} max={Math.max(...cliMes.map((d) => d.v), 1)} />
        </div>
      )}

      <p className="text-[10px] text-faint">
        B2B = Tango facturado (empresas unificadas: Plenorius + Ejemplar + Plastic), NC restadas. B2C = Shopify (minorista).
        Por vendedor se agrupa según el vendedor asignado por código de cliente. Todo en pesos.
      </p>
    </div>
  )
}
