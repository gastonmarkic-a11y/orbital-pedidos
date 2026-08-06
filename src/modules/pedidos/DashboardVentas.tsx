import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'

// Dashboard de ventas — SOLO PESOS. Interactivo y ecualizable:
//  - Scope: General (admin) o una cartera puntual (por código de cliente). Vendedor: su cartera.
//  - Mes + comparación (versus) contra otro mes cualquiera.
//  - Canales B2B/B2C, evolución clickeable, ranking de clientes, modelos más vendidos, zonas, por vendedor.
//  - Toggle métrica $ / unidades para mirar lo mismo desde otro ángulo.
// Todo agregado del lado del servidor (RPC/vistas) para no truncar en 1000 filas.

const fmtArs = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 })
const ent = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 })
const MESN = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
const etiqueta = (am: string) => { const [y, m] = am.split('-'); return `${MESN[+m - 1]} ${y.slice(2)}` }
const kAr = (n: number) => fmtArs.format(Math.round(n))

interface Punto { ars: number; u: number; ops: number; b2b: number; b2c: number }
interface Fila { k: string; sub?: string; v: number; u: number }

export default function DashboardVentas() {
  const { rolEfectivo, codigoEfectivo } = useAuth()
  const esAdmin = rolEfectivo === 'admin' || rolEfectivo === 'administracion'

  const [carteras, setCarteras] = useState<{ codigo: string; nombre: string }[]>([])
  const [scope, setScope] = useState<string>(esAdmin ? 'general' : (codigoEfectivo ?? ''))
  const esGeneral = scope === 'general'

  const [serie, setSerie] = useState<{ anio_mes: string; p: Punto }[]>([])
  const [mesSel, setMesSel] = useState('')
  const [mesCmp, setMesCmp] = useState('')
  const [metrica, setMetrica] = useState<'ars' | 'u'>('ars')

  const [clientes, setClientes] = useState<Fila[]>([])
  const [modelos, setModelos] = useState<Fila[]>([])
  const [zonas, setZonas] = useState<Fila[]>([])
  const [vendedores, setVendedores] = useState<Fila[]>([])
  const [loading, setLoading] = useState(true)
  const [loadDet, setLoadDet] = useState(false)

  // lista de carteras para el selector (admin)
  useEffect(() => {
    if (!esAdmin) return
    supabase.from('vendedores').select('codigo,nombre').eq('rol', 'vendedor').then(({ data }) => {
      setCarteras((data as { codigo: string; nombre: string }[]) ?? [])
    })
  }, [esAdmin])

  // serie mensual segun scope
  useEffect(() => {
    let cancel = false
    async function cargar() {
      setLoading(true)
      const map = new Map<string, Punto>()
      const get = (am: string) => { let a = map.get(am); if (!a) { a = { ars: 0, u: 0, ops: 0, b2b: 0, b2c: 0 }; map.set(am, a) } return a }
      if (esGeneral) {
        const [m, e] = await Promise.all([
          supabase.from('ventas_hist_mes').select('anio_mes,unidades,importe_ars,comprobantes'),
          supabase.from('v_ventas_ecom_mes').select('anio_mes,unidades,importe_ars,comprobantes'),
        ])
        for (const r of (m.data as { anio_mes: string; unidades: number; importe_ars: number; comprobantes: number }[]) ?? []) {
          const a = get(r.anio_mes); a.ars += r.importe_ars; a.u += r.unidades; a.ops += r.comprobantes; a.b2b += r.importe_ars
        }
        for (const r of (e.data as { anio_mes: string; unidades: number; importe_ars: number; comprobantes: number }[]) ?? []) {
          const a = get(r.anio_mes); a.ars += r.importe_ars; a.u += r.unidades; a.ops += r.comprobantes; a.b2c += r.importe_ars
        }
      } else {
        const { data } = await supabase.rpc('ventas_cartera_mensual', { p_cartera: scope })
        for (const r of (data as { anio_mes: string; unidades: number; importe_ars: number; clientes: number }[]) ?? []) {
          const a = get(r.anio_mes); a.ars += r.importe_ars; a.u += r.unidades; a.ops += r.clientes; a.b2b += r.importe_ars
        }
      }
      if (cancel) return
      const arr = [...map.entries()].map(([anio_mes, p]) => ({ anio_mes, p })).sort((a, b) => a.anio_mes.localeCompare(b.anio_mes))
      setSerie(arr)
      setLoading(false)
    }
    cargar()
    return () => { cancel = true }
  }, [scope, esGeneral])

  const porMes = useMemo(() => new Map(serie.map((r) => [r.anio_mes, r.p])), [serie])
  const meses = useMemo(() => serie.map((r) => r.anio_mes), [serie])
  useEffect(() => {
    if (!meses.length) return
    const ult = meses[meses.length - 1]
    setMesSel(ult)
    const [y, m] = ult.split('-'); const prevAnual = `${+y - 1}-${m}`
    setMesCmp(porMes.has(prevAnual) ? prevAnual : (meses[meses.length - 2] ?? ult))
  }, [meses]) // eslint-disable-line react-hooks/exhaustive-deps

  // detalle del mes seleccionado
  useEffect(() => {
    let cancel = false
    if (!mesSel) return
    async function cargar() {
      setLoadDet(true)
      const topCli = supabase.rpc('ventas_top_clientes', { p_cartera: esGeneral ? null : scope, p_mes: mesSel, p_limit: 15 })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const proms: any[] = [topCli]
      if (esGeneral) {
        proms.push(
          supabase.from('ventas_hist_modelo').select('modelo,unidades,importe_ars').eq('anio_mes', mesSel).order('unidades', { ascending: false }).limit(15),
          supabase.from('ventas_hist_zona').select('zona,unidades,importe_ars').eq('anio_mes', mesSel),
          supabase.from('v_ventas_cartera_mes').select('vendedor,unidades,importe_ars').eq('anio_mes', mesSel),
        )
      }
      const res = await Promise.all(proms) as { data: unknown }[]
      if (cancel) return
      const cli = (res[0].data as { cod_cliente: string; nombre: string; unidades: number; importe_ars: number }[]) ?? []
      setClientes(cli.map((r) => ({ k: r.nombre, sub: r.cod_cliente, v: r.importe_ars, u: r.unidades })))
      if (esGeneral) {
        const mod = (res[1].data as { modelo: string; unidades: number; importe_ars: number }[]) ?? []
        setModelos(mod.filter((r) => r.unidades > 0).map((r) => ({ k: r.modelo, v: r.importe_ars, u: r.unidades })))
        const zo = (res[2].data as { zona: string; unidades: number; importe_ars: number }[]) ?? []
        setZonas(zo.map((r) => ({ k: r.zona, v: r.importe_ars, u: r.unidades })).filter((r) => r.v > 0))
        const ve = (res[3].data as { vendedor: string; unidades: number; importe_ars: number }[]) ?? []
        const nom = new Map(carteras.map((c) => [c.codigo, c.nombre]))
        setVendedores(ve.map((r) => ({ k: nom.get(r.vendedor) || r.vendedor, v: r.importe_ars, u: r.unidades })).filter((r) => r.v > 0))
      } else { setModelos([]); setZonas([]); setVendedores([]) }
      setLoadDet(false)
    }
    cargar()
    return () => { cancel = true }
  }, [mesSel, scope, esGeneral, carteras])

  if (loading) return <p className="text-sm text-muted p-4">Cargando ventas…</p>
  if (!meses.length) return <p className="text-sm text-faint p-4">No hay ventas para {esGeneral ? 'mostrar' : 'esta cartera'} todavía.</p>

  const cur = porMes.get(mesSel) ?? { ars: 0, u: 0, ops: 0, b2b: 0, b2c: 0 }
  const cmp = porMes.get(mesCmp)
  const mv = (r: Fila) => (metrica === 'ars' ? r.v : r.u)
  const fmtM = (n: number) => (metrica === 'ars' ? kAr(n) : `${ent.format(n)} u`)
  const delta = (a: number, b?: number) => (b == null || !b ? null : Math.round(((a - b) / Math.abs(b)) * 100))
  const ticket = cur.ops ? cur.ars / cur.ops : 0
  const ticketCmp = cmp && cmp.ops ? cmp.ars / cmp.ops : undefined

  const ult = meses.slice(-18)
  const maxEvo = Math.max(...ult.map((am) => (metrica === 'ars' ? porMes.get(am)!.ars : porMes.get(am)!.u)), 1)
  const totCanal = cur.b2b + cur.b2c
  const pctB2b = totCanal ? Math.round((cur.b2b / totCanal) * 100) : 0

  // ---- UI helpers ----
  const Delta = ({ pct }: { pct: number | null }) => pct == null ? <span className="text-faint">—</span>
    : <span className={pct >= 0 ? 'text-emerald-600' : 'text-red-600'}>{pct >= 0 ? '▲' : '▼'} {Math.abs(pct)}%</span>

  const Kpi = ({ titulo, valor, sub, pct }: { titulo: string; valor: string; sub?: string; pct?: number | null }) => (
    <div className="bg-white rounded-xl p-3 border border-black/10">
      <p className="text-[10px] text-faint uppercase tracking-wide">{titulo}</p>
      <p className="text-xl font-bold text-brandDark leading-tight">{valor}</p>
      <p className="text-[11px] text-muted flex gap-2">{sub && <span>{sub}</span>}{pct !== undefined && <Delta pct={pct ?? null} />}</p>
    </div>
  )

  const Ranking = ({ titulo, data, vacio }: { titulo: string; data: Fila[]; vacio: string }) => {
    const max = Math.max(...data.map(mv), 1)
    return (
      <div className="bg-white rounded-xl p-4 border border-black/10">
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs font-semibold text-muted uppercase tracking-wide">{titulo}</p>
          <span className="text-[10px] text-faint">{etiqueta(mesSel)} · {metrica === 'ars' ? '$' : 'u'}</span>
        </div>
        <div className="space-y-1.5">
          {data.slice(0, 15).map((d, i) => (
            <div key={d.k + i} className="flex items-center gap-2 text-xs">
              <span className="w-4 text-right text-faint shrink-0">{i + 1}</span>
              <span className="w-36 truncate text-ink shrink-0" title={d.k}>{d.k}{d.sub ? <span className="text-faint"> ·{d.sub}</span> : ''}</span>
              <div className="flex-1 h-3 bg-black/5 rounded-full overflow-hidden">
                <div className="h-full rounded-full bg-brand" style={{ width: `${Math.max(2, (mv(d) / max) * 100)}%` }} />
              </div>
              <span className="w-24 text-right font-semibold text-ink shrink-0">{fmtM(mv(d))}</span>
            </div>
          ))}
          {loadDet && <p className="text-xs text-faint">Cargando…</p>}
          {!loadDet && data.length === 0 && <p className="text-xs text-faint">{vacio}</p>}
        </div>
      </div>
    )
  }

  const scopeLabel = esGeneral ? 'General' : (carteras.find((c) => c.codigo === scope)?.nombre ?? scope)

  return (
    <div className="space-y-4 text-ink">
      {/* Controles */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h2 className="text-base font-semibold">📈 Ventas — {scopeLabel}</h2>
          <p className="text-[11px] text-faint">En pesos · {esGeneral ? 'mayorista (Tango) + minorista (Shopify)' : 'clientes de la cartera por código'}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {esAdmin && (
            <select value={scope} onChange={(e) => setScope(e.target.value)} className="text-sm bg-white border border-black/10 rounded-lg px-2 py-1.5">
              <option value="general">General (todo)</option>
              {carteras.map((c) => <option key={c.codigo} value={c.codigo}>{c.nombre}</option>)}
            </select>
          )}
          <div className="flex bg-white border border-black/10 rounded-lg p-0.5">
            {(['ars', 'u'] as const).map((mo) => (
              <button key={mo} onClick={() => setMetrica(mo)} className={`text-xs px-2.5 py-1 rounded-md font-medium ${metrica === mo ? 'bg-brand text-white' : 'text-muted'}`}>{mo === 'ars' ? '$' : 'Unid.'}</button>
            ))}
          </div>
        </div>
      </div>

      {/* Mes + versus */}
      <div className="bg-white rounded-xl p-3 border border-black/10 flex items-center gap-3 flex-wrap text-sm">
        <label className="flex items-center gap-1.5"><span className="text-[11px] text-muted">Mes</span>
          <select value={mesSel} onChange={(e) => setMesSel(e.target.value)} className="bg-white border border-black/10 rounded-lg px-2 py-1">
            {[...meses].reverse().map((am) => <option key={am} value={am}>{etiqueta(am)}</option>)}
          </select>
        </label>
        <span className="text-faint">vs</span>
        <label className="flex items-center gap-1.5"><span className="text-[11px] text-muted">Comparar con</span>
          <select value={mesCmp} onChange={(e) => setMesCmp(e.target.value)} className="bg-white border border-black/10 rounded-lg px-2 py-1">
            {[...meses].reverse().map((am) => <option key={am} value={am}>{etiqueta(am)}</option>)}
          </select>
        </label>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Kpi titulo={`Facturación ${etiqueta(mesSel)}`} valor={kAr(cur.ars)} sub={`vs ${etiqueta(mesCmp)}`} pct={delta(cur.ars, cmp?.ars)} />
        <Kpi titulo="Unidades" valor={ent.format(cur.u)} sub={`vs ${etiqueta(mesCmp)}`} pct={delta(cur.u, cmp?.u)} />
        <Kpi titulo={esGeneral ? 'Operaciones' : 'Clientes con compra'} valor={ent.format(cur.ops)} sub={`vs ${etiqueta(mesCmp)}`} pct={delta(cur.ops, cmp?.ops)} />
        <Kpi titulo="Ticket promedio" valor={kAr(ticket)} sub={`vs ${etiqueta(mesCmp)}`} pct={delta(ticket, ticketCmp)} />
      </div>

      {/* Canal B2B/B2C (solo general) */}
      {esGeneral && totCanal > 0 && (
        <div className="bg-white rounded-xl p-4 border border-black/10">
          <p className="text-xs font-semibold text-muted uppercase tracking-wide mb-3">Reparto por canal · {etiqueta(mesSel)}</p>
          <div className="flex h-6 rounded-lg overflow-hidden mb-2">
            <div className="bg-brand h-full flex items-center justify-center text-white text-[10px] font-semibold" style={{ width: `${pctB2b}%` }}>{pctB2b >= 12 ? `B2B ${pctB2b}%` : ''}</div>
            <div className="bg-amber-500 h-full flex items-center justify-center text-white text-[10px] font-semibold" style={{ width: `${100 - pctB2b}%` }}>{100 - pctB2b >= 12 ? `B2C ${100 - pctB2b}%` : ''}</div>
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="rounded-lg border border-black/10 p-2"><p className="text-[10px] text-faint uppercase">B2B · Mayorista (ópticas)</p><p className="font-bold text-brandDark">{kAr(cur.b2b)}</p></div>
            <div className="rounded-lg border border-black/10 p-2"><p className="text-[10px] text-faint uppercase">B2C · Minorista (e-commerce)</p><p className="font-bold text-amber-600">{kAr(cur.b2c)}</p></div>
          </div>
        </div>
      )}

      {/* Evolución clickeable */}
      <div className="bg-white rounded-xl p-4 border border-black/10">
        <p className="text-xs font-semibold text-muted uppercase tracking-wide mb-3">Evolución (18 meses · {metrica === 'ars' ? '$' : 'unid.'}) — tocá una barra</p>
        <div className="flex items-end gap-1 h-32">
          {ult.map((am) => {
            const v = metrica === 'ars' ? porMes.get(am)!.ars : porMes.get(am)!.u
            const activo = am === mesSel, comparado = am === mesCmp
            return (
              <button key={am} onClick={() => setMesSel(am)} className="flex-1 flex flex-col items-center justify-end h-full group" title={`${etiqueta(am)}: ${metrica === 'ars' ? kAr(v) : ent.format(v) + ' u'}`}>
                <div className={`w-full rounded-t ${activo ? 'bg-brandDark' : comparado ? 'bg-amber-400' : 'bg-brand/50 group-hover:bg-brand/80'}`} style={{ height: `${Math.max(2, (v / maxEvo) * 100)}%` }} />
              </button>
            )
          })}
        </div>
        <div className="flex gap-1 mt-1">
          {ult.map((am) => <span key={am} className="flex-1 text-center text-[8px] text-faint">{am.endsWith('-01') || am === mesSel ? etiqueta(am) : ''}</span>)}
        </div>
      </div>

      {/* Rankings */}
      <div className="grid md:grid-cols-2 gap-3">
        <Ranking titulo="🏆 Ranking de clientes" data={clientes} vacio="Sin ventas este mes." />
        {esGeneral
          ? <Ranking titulo="🕶️ Modelos más vendidos" data={modelos} vacio="Sin datos de modelo para este mes (por ahora solo jul-26)." />
          : <div className="bg-white rounded-xl p-4 border border-black/10 flex items-center justify-center text-center text-xs text-faint">Los rankings de modelo, zona y vendedor están en la vista <b className="mx-1">General</b>.</div>}
      </div>
      {esGeneral && (
        <div className="grid md:grid-cols-2 gap-3">
          <Ranking titulo="📍 Por zona" data={zonas} vacio="Sin datos de zona este mes." />
          <Ranking titulo="👥 Por vendedor (cartera)" data={vendedores} vacio="Sin datos este mes." />
        </div>
      )}

      <p className="text-[10px] text-faint">
        B2B = Tango facturado (empresas unificadas, NC restadas). B2C = Shopify minorista, neto sin IVA (precio ÷ 1,21).
        Por cartera se agrupa por el código de cliente asignado. Modelos: histórico Tango (cargado jul-26; el resto se puede backfillear).
      </p>
    </div>
  )
}
