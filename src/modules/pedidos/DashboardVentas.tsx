import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'
import { importeDe } from './calc'
import type { Pedido, StockItem } from '../../lib/types'

// Estados que cuentan como facturado (igual que el dashboard operativo).
const FACTURABLES = ['facturado', 'listo_despachar', 'despachado']

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
  const [tapMode, setTapMode] = useState<'mes' | 'cmp'>('mes')

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
        // Empalme: meses posteriores al histórico Tango (jul-26) → B2B desde los pedidos
        // facturados de la app, con el MISMO cálculo que el operativo (así agosto coincide).
        const cutoff = ((m.data as { anio_mes: string }[]) ?? []).reduce((mx, r) => (r.anio_mes > mx ? r.anio_mes : mx), '0000-00')
        const [ped, stk] = await Promise.all([
          supabase.from('pedidos').select('*'),
          supabase.from('stock').select('codigo,precio,precio_preventa'),
        ])
        const stock = (stk.data as StockItem[]) ?? []
        for (const p of (ped.data as Pedido[]) ?? []) {
          if (!FACTURABLES.includes(p.estado ?? '')) continue
          const mes = p.created_at ? String(p.created_at).slice(0, 7) : ''
          if (!mes || mes <= cutoff) continue // no duplicar lo que ya está en el histórico
          const a = get(mes)
          const n = importeDe(p, stock)
          a.ars += n; a.b2b += n; a.ops += 1; a.u += (p.total_units ?? 0)
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

  // detalle del mes primario (el MÁS NUEVO de los dos elegidos — comparación siempre viejo→nuevo)
  useEffect(() => {
    let cancel = false
    if (!mesSel) return
    const mesDet = !mesCmp || mesSel >= mesCmp ? mesSel : mesCmp
    async function cargar() {
      setLoadDet(true)
      const topCli = supabase.rpc('ventas_top_clientes', { p_cartera: esGeneral ? null : scope, p_mes: mesDet, p_limit: 15 })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const proms: any[] = [topCli]
      if (esGeneral) {
        proms.push(
          supabase.from('ventas_hist_modelo').select('modelo,unidades,importe_ars').eq('anio_mes', mesDet).order('unidades', { ascending: false }).limit(15),
          supabase.from('ventas_hist_zona').select('zona,unidades,importe_ars').eq('anio_mes', mesDet),
          supabase.from('v_ventas_cartera_mes').select('vendedor,unidades,importe_ars').eq('anio_mes', mesDet),
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
  }, [mesSel, mesCmp, scope, esGeneral, carteras])

  if (loading) return <p className="text-sm text-muted p-4">Cargando ventas…</p>
  if (!meses.length) return <p className="text-sm text-faint p-4">No hay ventas para {esGeneral ? 'mostrar' : 'esta cartera'} todavía.</p>

  // Comparación SIEMPRE viejo→nuevo: el más nuevo de los dos es el primario, el más viejo el comparado.
  const mesNuevo = !mesCmp || mesSel >= mesCmp ? mesSel : mesCmp
  const mesViejo = mesNuevo === mesSel ? mesCmp : mesSel
  const cur = porMes.get(mesNuevo) ?? { ars: 0, u: 0, ops: 0, b2b: 0, b2c: 0 }
  const cmp = porMes.get(mesViejo)
  const [y, m] = mesNuevo.split('-')
  const mv = (r: Fila) => (metrica === 'ars' ? r.v : r.u)
  const fmtM = (n: number) => (metrica === 'ars' ? kAr(n) : `${ent.format(n)} u`)
  const delta = (a: number, b?: number) => (b == null || !b ? null : Math.round(((a - b) / Math.abs(b)) * 100))
  const ticket = cur.ops ? cur.ars / cur.ops : 0
  const ticketCmp = cmp && cmp.ops ? cmp.ars / cmp.ops : undefined

  const ult = meses.slice(-18)
  const maxEvo = Math.max(...ult.map((am) => (metrica === 'ars' ? porMes.get(am)!.ars : porMes.get(am)!.u)), 1)
  const totCanal = cur.b2b + cur.b2c
  // Mes en curso: no comparar contra un mes completo (siempre daría negativo). Se muestra
  // AVANCE hacia un objetivo mínimo = mismo mes del año anterior (o el mes comparado).
  const hoyMes = new Date().toISOString().slice(0, 7)
  const esCurso = mesNuevo === hoyMes
  const objetivo = porMes.get(`${+y - 1}-${m}`)?.ars ?? cmp?.ars ?? 0
  const progreso = objetivo > 0 ? Math.round((cur.ars / objetivo) * 100) : null
  const dPctFact = delta(cur.ars, cmp?.ars)

  // Presets de comparación
  const añoAnterior = porMes.has(`${+y - 1}-${m}`) ? `${+y - 1}-${m}` : ''
  const idxNuevo = meses.indexOf(mesNuevo)
  const mesPrevio = idxNuevo > 0 ? meses[idxNuevo - 1] : ''

  // Acumulado del año (YTD): suma ene→mes elegido, y año completo, con su par del año anterior.
  const acum = (anio: string, hastaMM?: string) => {
    const pref = `${anio}-`
    const r = { ars: 0, u: 0, ops: 0 }
    for (const am of meses) {
      if (!am.startsWith(pref)) continue
      if (hastaMM && am.slice(5) > hastaMM) continue
      const p = porMes.get(am)!; r.ars += p.ars; r.u += p.u; r.ops += p.ops
    }
    return r
  }
  const ytdCur = acum(y, m)
  const ytdPrev = acum(String(+y - 1), m)
  const ytdFullCur = acum(y)
  const ytdFullPrev = acum(String(+y - 1))

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
          <span className="text-[10px] text-faint">{etiqueta(mesNuevo)} · {metrica === 'ars' ? '$' : 'u'}</span>
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

  const kArShort = (n: number) => (Math.abs(n) >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : `$${Math.round(n / 1e3)}k`)
  const deltaBig = (a: number, b?: number | null) => {
    const p = delta(a, b ?? undefined)
    return p == null ? <span className="text-faint">—</span> : <b className={p >= 0 ? 'text-emerald-600' : 'text-red-600'}>{p >= 0 ? '▲' : '▼'} {Math.abs(p)}%</b>
  }

  // Acelerador (gauge semicircular). pct = posición de la aguja (-100..100); centro/sub = textos; color = acento.
  const Acelerador = ({ pct, centro, sub, color }: { pct: number | null; centro: string; sub: string; color: string }) => {
    const p = pct == null ? 0 : Math.max(-100, Math.min(100, pct))
    const theta = (90 - (p / 100) * 90) * (Math.PI / 180)
    const nx = 100 + 72 * Math.cos(theta), ny = 100 - 72 * Math.sin(theta)
    const ticks = Array.from({ length: 41 }, (_, i) => i)
    return (
      <svg viewBox="0 0 200 118" className="w-full max-w-[210px]">
        {ticks.map((i) => {
          const d = 180 - (i / 40) * 180
          const a = d * (Math.PI / 180)
          const pctAt = (90 - d) / 0.9
          const on = pct != null && (p >= 0 ? pctAt >= 0 && pctAt <= p : pctAt <= 0 && pctAt >= p)
          const x1 = 100 + 80 * Math.cos(a), y1 = 100 - 80 * Math.sin(a)
          const x2 = 100 + 92 * Math.cos(a), y2 = 100 - 92 * Math.sin(a)
          return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={on ? color : 'rgba(255,255,255,0.16)'} strokeWidth={2.6} strokeLinecap="round" />
        })}
        <line x1={100} y1={100} x2={nx} y2={ny} stroke={color} strokeWidth={3.2} strokeLinecap="round" />
        <circle cx={100} cy={100} r={5} fill={color} />
        <text x={100} y={70} textAnchor="middle" fill="#fff" fontSize={22} fontWeight={700}>{centro}</text>
        <text x={100} y={90} textAnchor="middle" fill="rgba(255,255,255,0.55)" fontSize={8.5}>{sub}</text>
      </svg>
    )
  }

  // Donut de canal B2B/B2C
  const DonutCanal = ({ b2b, b2c }: { b2b: number; b2c: number }) => {
    const tot = b2b + b2c || 1
    const pb = b2b / tot
    const R = 42, C = 2 * Math.PI * R
    return (
      <svg viewBox="0 0 120 120" className="w-[112px] h-[112px] shrink-0">
        <circle cx={60} cy={60} r={R} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth={13} />
        <circle cx={60} cy={60} r={R} fill="none" stroke="#e6a817" strokeWidth={13} strokeDasharray={`${C} ${C}`} transform="rotate(-90 60 60)" />
        <circle cx={60} cy={60} r={R} fill="none" stroke="#fff" strokeWidth={13} strokeDasharray={`${pb * C} ${C}`} strokeLinecap="butt" transform="rotate(-90 60 60)" />
        <text x={60} y={57} textAnchor="middle" fill="#fff" fontSize={18} fontWeight={700}>{Math.round(pb * 100)}%</text>
        <text x={60} y={72} textAnchor="middle" fill="rgba(255,255,255,0.55)" fontSize={8}>B2B</text>
      </svg>
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

      {/* Mes + versus (cruce específico) */}
      <div className="bg-white rounded-xl p-3 border border-black/10 flex items-center gap-3 flex-wrap text-sm">
        <label className="flex items-center gap-1.5"><span className="text-[11px] text-muted">Mes</span>
          <select value={mesSel} onChange={(e) => setMesSel(e.target.value)} className="bg-white border border-black/10 rounded-lg px-2 py-1">
            {[...meses].reverse().map((am) => <option key={am} value={am}>{etiqueta(am)}</option>)}
          </select>
        </label>
        <span className="text-faint">vs</span>
        <label className="flex items-center gap-1.5"><span className="text-[11px] text-muted">Cruce específico</span>
          <select value={mesCmp} onChange={(e) => setMesCmp(e.target.value)} className="bg-white border border-black/10 rounded-lg px-2 py-1">
            {[...meses].reverse().map((am) => <option key={am} value={am}>{etiqueta(am)}</option>)}
          </select>
        </label>
        {/* Presets rápidos de comparación */}
        <div className="flex gap-1 ml-auto">
          {añoAnterior && (
            <button onClick={() => setMesCmp(añoAnterior)} className={`text-[11px] px-2 py-1 rounded-lg border ${mesCmp === añoAnterior ? 'bg-brandDark text-white border-brandDark' : 'bg-white text-muted border-black/10'}`}>
              Año vs año ({etiqueta(añoAnterior)})
            </button>
          )}
          {mesPrevio && (
            <button onClick={() => setMesCmp(mesPrevio)} className={`text-[11px] px-2 py-1 rounded-lg border ${mesCmp === mesPrevio ? 'bg-brandDark text-white border-brandDark' : 'bg-white text-muted border-black/10'}`}>
              Mes anterior
            </button>
          )}
        </div>
      </div>

      {/* Acumulado del año (YTD) — la venta acumulada como dato */}
      <div className="rounded-xl p-3 border border-black/10 bg-[#F7F5F0] grid grid-cols-2 md:grid-cols-4 gap-3 items-center">
        <div className="col-span-2 md:col-span-1">
          <p className="text-[10px] text-faint uppercase tracking-wide">Acumulado {y} · ene–{MESN[+m - 1]}</p>
          <p className="text-2xl font-bold text-brandDark leading-tight">{kAr(ytdCur.ars)}</p>
          <p className="text-[11px] text-muted">{ent.format(ytdCur.u)} u · {ent.format(ytdCur.ops)} {esGeneral ? 'oper.' : 'clientes'}</p>
        </div>
        <div>
          <p className="text-[10px] text-faint uppercase tracking-wide">Mismo tramo {+y - 1}</p>
          <p className="text-lg font-semibold text-ink leading-tight">{ytdPrev.ars ? kAr(ytdPrev.ars) : '—'}</p>
          <p className="text-[11px]">{ytdPrev.ars ? <Delta pct={delta(ytdCur.ars, ytdPrev.ars)} /> : <span className="text-faint">sin base</span>}</p>
        </div>
        <div>
          <p className="text-[10px] text-faint uppercase tracking-wide">Año completo {y}</p>
          <p className="text-lg font-semibold text-ink leading-tight">{kAr(ytdFullCur.ars)}</p>
          <p className="text-[11px] text-muted">{ent.format(ytdFullCur.u)} u</p>
        </div>
        <div>
          <p className="text-[10px] text-faint uppercase tracking-wide">Año completo {+y - 1}</p>
          <p className="text-lg font-semibold text-ink leading-tight">{ytdFullPrev.ars ? kAr(ytdFullPrev.ars) : '—'}</p>
          <p className="text-[11px]">{ytdFullPrev.ars ? <Delta pct={delta(ytdFullCur.ars, ytdFullPrev.ars)} /> : <span className="text-faint">—</span>}</p>
        </div>
      </div>

      {/* HERO impacto: facturación + acelerador + donut de canal */}
      <div className="rounded-2xl p-4 md:p-5 bg-neutral-900 text-white grid gap-4 md:grid-cols-[1.1fr_1fr_1fr] items-center">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-white/50">Facturación · {etiqueta(mesNuevo)}</p>
          <p className="text-3xl md:text-4xl font-bold text-amber-400 leading-tight">{kAr(cur.ars)}</p>
          <p className="text-[11px] text-white/60 mt-0.5">{ent.format(cur.u)} u · {ent.format(cur.ops)} {esGeneral ? 'operaciones' : 'clientes'} · ticket {kAr(ticket)}</p>
          <p className="text-[11px] mt-1">vs {etiqueta(mesViejo)}: {deltaBig(cur.ars, cmp?.ars)}</p>
        </div>
        <div className="flex flex-col items-center justify-center">
          {esCurso && progreso != null ? (
            <Acelerador pct={progreso - 100} centro={`${progreso}%`} sub={`del objetivo (${etiqueta(`${+y - 1}-${m}`)})`} color={progreso >= 100 ? '#34d399' : '#e6a817'} />
          ) : (
            <Acelerador pct={dPctFact} centro={dPctFact == null ? '—' : `${dPctFact >= 0 ? '+' : ''}${dPctFact}%`} sub={`vs ${etiqueta(mesViejo)}`} color={dPctFact == null ? '#9ca3af' : dPctFact >= 0 ? '#34d399' : '#f87171'} />
          )}
          <p className="text-[9px] text-white/40 -mt-1">{esCurso ? '🟡 mes en curso · avance vs objetivo' : 'acelerador vs comparado'}</p>
        </div>
        {esGeneral && totCanal > 0 ? (
          <div className="flex items-center gap-3 justify-center">
            <DonutCanal b2b={cur.b2b} b2c={cur.b2c} />
            <div className="text-[11px] space-y-1.5">
              <div><span className="inline-block w-2.5 h-2.5 rounded-full bg-white mr-1.5 align-middle" />B2B mayorista<br /><b className="text-white">{kAr(cur.b2b)}</b></div>
              <div><span className="inline-block w-2.5 h-2.5 rounded-full bg-amber-400 mr-1.5 align-middle" />B2C minorista<br /><b className="text-amber-400">{kAr(cur.b2c)}</b></div>
            </div>
          </div>
        ) : <div className="hidden md:block" />}
      </div>

      {/* KPIs con delta */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Kpi titulo={`Facturación ${etiqueta(mesNuevo)}`} valor={kAr(cur.ars)} sub={`vs ${etiqueta(mesViejo)}`} pct={delta(cur.ars, cmp?.ars)} />
        <Kpi titulo="Unidades" valor={ent.format(cur.u)} sub={`vs ${etiqueta(mesViejo)}`} pct={delta(cur.u, cmp?.u)} />
        <Kpi titulo={esGeneral ? 'Operaciones' : 'Clientes con compra'} valor={ent.format(cur.ops)} sub={`vs ${etiqueta(mesViejo)}`} pct={delta(cur.ops, cmp?.ops)} />
        <Kpi titulo="Ticket promedio" valor={kAr(ticket)} sub={`vs ${etiqueta(mesViejo)}`} pct={delta(ticket, ticketCmp)} />
      </div>

      {/* Evolución interactiva con feedback claro */}
      <div className="bg-white rounded-xl p-4 border border-black/10">
        <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
          <p className="text-xs font-semibold text-muted uppercase tracking-wide">Evolución 18 meses · {metrica === 'ars' ? '$' : 'unid.'}</p>
          <div className="flex items-center gap-1.5 text-[10px]">
            <span className="text-faint">Al tocar una barra, fijar:</span>
            <div className="flex bg-[#F1EDE4] rounded-lg p-0.5">
              <button onClick={() => setTapMode('mes')} className={`px-2 py-0.5 rounded-md font-medium ${tapMode === 'mes' ? 'bg-brandDark text-white' : 'text-muted'}`}>Mes</button>
              <button onClick={() => setTapMode('cmp')} className={`px-2 py-0.5 rounded-md font-medium ${tapMode === 'cmp' ? 'bg-amber-400 text-white' : 'text-muted'}`}>Comparar</button>
            </div>
          </div>
        </div>

        {/* Callout: qué tocaste y cómo compara */}
        <div className="rounded-lg bg-[#F7F5F0] p-2.5 mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
          <span className="font-semibold text-brandDark">📅 {etiqueta(mesNuevo)}: {metrica === 'ars' ? kAr(cur.ars) : ent.format(cur.u) + ' u'}</span>
          <span className="text-muted">
            vs <span className="text-amber-700 font-medium">{etiqueta(mesViejo)}</span> ({metrica === 'ars' ? kAr(cmp?.ars ?? 0) : ent.format(cmp?.u ?? 0) + ' u'}):{' '}
            {deltaBig(metrica === 'ars' ? cur.ars : cur.u, metrica === 'ars' ? cmp?.ars : cmp?.u)}
          </span>
        </div>

        <div className="flex items-end gap-1 h-36">
          {ult.map((am) => {
            const pt = porMes.get(am)!
            const v = metrica === 'ars' ? pt.ars : pt.u
            const activo = am === mesNuevo, comparado = am === mesViejo
            return (
              <button
                key={am}
                onClick={() => (tapMode === 'mes' ? setMesSel(am) : setMesCmp(am))}
                className="flex-1 flex flex-col items-center justify-end h-full group"
                title={`${etiqueta(am)}: ${metrica === 'ars' ? kAr(v) : ent.format(v) + ' u'}`}
              >
                {(activo || comparado) && (
                  <span className={`text-[8px] font-bold mb-0.5 leading-none ${activo ? 'text-brandDark' : 'text-amber-600'}`}>
                    {metrica === 'ars' ? kArShort(v) : ent.format(v)}
                  </span>
                )}
                <div
                  className={`w-full rounded-t transition-colors ${activo ? 'bg-brandDark' : comparado ? 'bg-amber-400' : 'bg-brand/40 group-hover:bg-brand/70'}`}
                  style={{ height: `${Math.max(2, (v / maxEvo) * 100)}%` }}
                />
                <span className={`text-[7px] mt-0.5 leading-none ${activo ? 'text-brandDark font-semibold' : comparado ? 'text-amber-600 font-semibold' : 'text-transparent group-hover:text-faint'}`}>
                  {etiqueta(am)}
                </span>
              </button>
            )
          })}
        </div>
        <p className="text-[10px] text-faint mt-2">Barra <b className="text-brandDark">oscura</b> = mes elegido · <b className="text-amber-600">ámbar</b> = mes comparado. Tocá para cambiar según el selector de arriba.</p>
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
