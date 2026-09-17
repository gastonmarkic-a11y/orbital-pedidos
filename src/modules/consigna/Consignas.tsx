// ── Consignas (Suite) ───────────────────────────────────────────────────────
// Administración de los clientes de consigna con sucursales (cliente madre + sucursales):
//   · Liquidación: se sube el Excel que manda el cliente → descuenta del stock de cada
//     sucursal → reposición automática (consigna_liquidar):
//       - lo vendido que rota y tiene stock central → pedido de carga automático por sucursal
//       - saldos y lo que no tiene stock → reemplazo a aprobar acá (consigna_repo_suc)
//   · Reposiciones a aprobar (también lo que faltó de los pedidos particulares de sucursal).
//   · Devoluciones: marcar lo recibido en Orbital.
//   · Postventa: estado de los pedidos; la charla se contesta en Conversaciones o Telegram.
//   · Links de acceso de la central y de cada sucursal.
import { useEffect, useMemo, useState } from 'react'
import { Upload, Check, Copy, ExternalLink, RefreshCw } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useToast } from '../../lib/toast'
import { useAuth } from '../../lib/auth'

type Madre = { cod: string; nombre: string; sucursales: number; local: number; devolver: number; camino: number; repos: number; postventa: number }
type Suc = { id: number; cod_madre: string; nombre: string; direccion: string | null; orden: number }
type StockRow = { sucursal_id: number; codigo: string; modelo: string | null; descripcion: string | null; cantidad: number; devolver: number; en_camino: number }
type RepoItem = { codigo: string; modelo: string | null; descripcion: string | null; cantidad: number; motivo?: string }
type Repo = { id: number; sucursal_id: number; origen: string; liquidacion_id: number | null; consigna_pedido_id: number | null; items: RepoItem[]; sin_cubrir: number; created_at: string }
type Liq = { id: number; archivo: string | null; desde: string | null; hasta: string | null; total_units: number; importe: number; creado_por: string | null; created_at: string }
type Dev = { id: number; sucursal_id: number; modelo: string; descripcion: string | null; cantidad: number; enviada: number; recibida: number; conservada: number; vendida: number }
type Pv = { id: number; sucursal_id: number | null; tipo: string; producto: string | null; detalle: string; estado: string; solicitado_por: string | null; created_at: string }
type Acceso = { codigo: string; sucursal_id: number | null; nombre: string | null }

const fmt = (n: number) => Number(n || 0).toLocaleString('es-AR')
const pesos = (n: number) => '$' + Math.round(Number(n || 0)).toLocaleString('es-AR')
const fecha = (s: string) => new Date(s).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' })
const URL_BASE = 'https://ver.orbitaleyewear.com.ar'

type Vista = 'liquidacion' | 'repos' | 'devoluciones' | 'postventa' | 'links'

export default function Consignas() {
  const [madres, setMadres] = useState<Madre[] | null>(null)
  const [sel, setSel] = useState<string | null>(null)
  const [vista, setVista] = useState<Vista>('liquidacion')
  const [tick, setTick] = useState(0)
  const refrescar = () => setTick((t) => t + 1)

  useEffect(() => {
    (async () => {
      const [{ data: sucs }, { data: stock }, { data: repos }, { data: pvs }] = await Promise.all([
        supabase.from('cliente_sucursal').select('id, cod_madre').eq('activa', true),
        supabase.from('consigna_suc_stock').select('sucursal_id, cantidad, devolver, en_camino'),
        supabase.from('consigna_repo_suc').select('cod_madre').eq('estado', 'pendiente'),
        supabase.from('consigna_postventa').select('cod_madre').neq('estado', 'resuelto'),
      ])
      const madreDe = new Map((sucs ?? []).map((s: any) => [s.id as number, s.cod_madre as string]))
      const cods = [...new Set((sucs ?? []).map((s: any) => s.cod_madre as string))]
      const { data: clis } = await supabase.from('clientes').select('cod, razon, nomcomerc').in('cod', cods.length ? cods : ['-'])
      const out: Madre[] = cods.map((cod) => {
        const c = (clis ?? []).find((x: any) => x.cod === cod) as any
        return { cod, nombre: c?.nomcomerc || c?.razon || cod, sucursales: 0, local: 0, devolver: 0, camino: 0, repos: 0, postventa: 0 }
      })
      const by = new Map(out.map((m) => [m.cod, m]))
      for (const s of sucs ?? []) by.get((s as any).cod_madre)!.sucursales++
      for (const r of (stock ?? []) as any[]) {
        const m = by.get(madreDe.get(r.sucursal_id) ?? '')
        if (m) { m.local += r.cantidad; m.devolver += r.devolver; m.camino += r.en_camino }
      }
      for (const r of (repos ?? []) as any[]) { const m = by.get(r.cod_madre); if (m) m.repos++ }
      for (const r of (pvs ?? []) as any[]) { const m = by.get(r.cod_madre); if (m) m.postventa++ }
      setMadres(out)
      setSel((s) => s ?? out[0]?.cod ?? null)
    })()
  }, [tick])

  if (!madres) return <p className="text-sm text-muted p-4">Cargando consignas…</p>
  if (madres.length === 0) return <p className="text-sm text-muted p-4">No hay clientes de consigna con sucursales.</p>
  const madre = madres.find((m) => m.cod === sel)!

  const tabs: [Vista, string, number?][] = [
    ['liquidacion', 'Liquidación'],
    ['repos', 'Reposiciones a aprobar', madre.repos],
    ['devoluciones', 'Devoluciones'],
    ['postventa', 'Postventa', madre.postventa],
    ['links', 'Links de acceso'],
  ]

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">📦 Consignas</h2>
        <button onClick={refrescar} className="text-xs text-muted flex items-center gap-1"><RefreshCw size={13} /> Actualizar</button>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2">
        {madres.map((m) => (
          <button key={m.cod} onClick={() => setSel(m.cod)}
            className={`text-left rounded-xl border px-4 py-3 ${sel === m.cod ? 'bg-ink text-white border-ink' : 'bg-white border-black/10 hover:border-gold'}`}>
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-semibold truncate">{m.nombre}</span>
              <span className={`text-[11px] ${sel === m.cod ? 'text-white/60' : 'text-faint'}`}>{m.cod}</span>
            </div>
            <div className={`text-xs mt-1 tabular-nums ${sel === m.cod ? 'text-white/75' : 'text-muted'}`}>
              {m.sucursales} sucursales · {fmt(m.local)} u · ↩ {fmt(m.devolver)} · + {fmt(m.camino)}
            </div>
            {(m.repos > 0 || m.postventa > 0) && (
              <div className="flex gap-1.5 mt-2">
                {m.repos > 0 && <span className="text-[11px] rounded-full px-2 py-0.5 bg-amber-100 text-amber-800">{m.repos} reposición a aprobar</span>}
                {m.postventa > 0 && <span className="text-[11px] rounded-full px-2 py-0.5 bg-sky-100 text-sky-800">{m.postventa} postventa abierta</span>}
              </div>
            )}
          </button>
        ))}
      </div>

      <nav className="flex flex-wrap gap-1 border-b border-black/10">
        {tabs.map(([k, label, n]) => (
          <button key={k} onClick={() => setVista(k)}
            className={`px-3 py-2 text-sm -mb-px border-b-2 ${vista === k ? 'border-gold font-semibold' : 'border-transparent text-muted'}`}>
            {label}{n ? <span className="ml-1 text-[11px] rounded-full px-1.5 bg-amber-100 text-amber-800">{n}</span> : null}
          </button>
        ))}
      </nav>

      <Detalle key={`${madre.cod}-${tick}`} madre={madre} vista={vista} onCambio={refrescar} />
    </div>
  )
}

function Detalle({ madre, vista, onCambio }: { madre: Madre; vista: Vista; onCambio: () => void }) {
  const [sucs, setSucs] = useState<Suc[]>([])
  const [stock, setStock] = useState<StockRow[]>([])
  useEffect(() => {
    supabase.from('cliente_sucursal').select('id, cod_madre, nombre, direccion, orden').eq('cod_madre', madre.cod).order('orden')
      .then(({ data }) => {
        const s = (data ?? []) as Suc[]
        setSucs(s)
        if (s.length) supabase.from('consigna_suc_stock').select('sucursal_id, codigo, modelo, descripcion, cantidad, devolver, en_camino')
          .in('sucursal_id', s.map((x) => x.id)).then(({ data }) => setStock((data ?? []) as StockRow[]))
      })
  }, [madre.cod])
  const nombreSuc = (id: number | null) => sucs.find((s) => s.id === id)?.nombre ?? 'Central'

  if (vista === 'liquidacion') return <Liquidacion madre={madre} sucs={sucs} stock={stock} onCambio={onCambio} />
  if (vista === 'repos') return <Reposiciones madre={madre} nombreSuc={nombreSuc} onCambio={onCambio} />
  if (vista === 'devoluciones') return <Devoluciones madre={madre} nombreSuc={nombreSuc} />
  if (vista === 'postventa') return <PostventaSuite madre={madre} nombreSuc={nombreSuc} onCambio={onCambio} />
  return <Links madre={madre} sucs={sucs} nombreSuc={nombreSuc} />
}

// ── Liquidación por Excel ────────────────────────────────────────────────────
type LineaPrev = { fila: number; sucursal_id: number | null; codigo: string | null; cantidad: number; saldo: boolean; texto: string; sucTexto: string }

const norm = (s: unknown) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

function detectarColumnas(headers: string[]) {
  const h = headers.map(norm)
  const buscar = (...claves: string[]) => h.findIndex((x) => claves.some((c) => x === c || x.includes(c)))
  return {
    sucursal: buscar('sucursal', 'local', 'punto de venta', 'deposito', 'tienda'),
    codigo: buscar('codigo', 'cod ', 'sku', 'articulo'),
    modelo: buscar('modelo'),
    color: buscar('color', 'descripcion', 'posicion', 'detalle'),
    cantidad: buscar('cantidad', 'cant', 'unidades', 'vendid', 'venta'),
    saldo: buscar('saldo', 'liquidacion', 'oferta', 'outlet'),
  }
}

function Liquidacion({ madre, sucs, stock, onCambio }: { madre: Madre; sucs: Suc[]; stock: StockRow[]; onCambio: () => void }) {
  const toast = useToast()
  const { codigoEfectivo, vendedor } = useAuth()
  const quien = vendedor?.nombre || codigoEfectivo
  const [archivo, setArchivo] = useState<string | null>(null)
  const [lineas, setLineas] = useState<LineaPrev[]>([])
  const [sucGeneral, setSucGeneral] = useState<number | null>(null)
  const [desde, setDesde] = useState('')
  const [hasta, setHasta] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [resultado, setResultado] = useState<any>(null)
  const [historial, setHistorial] = useState<Liq[]>([])

  useEffect(() => {
    supabase.from('consigna_liquidacion').select('*').eq('cod_madre', madre.cod).order('created_at', { ascending: false }).limit(30)
      .then(({ data }) => setHistorial((data ?? []) as Liq[]))
  }, [madre.cod, resultado])

  const stockDe = (sid: number | null) => stock.filter((s) => s.sucursal_id === sid && s.cantidad > 0)

  const matchSucursal = (t: string): number | null => {
    const n = norm(t)
    if (!n) return null
    const exact = sucs.find((s) => norm(s.nombre) === n || norm(s.direccion) === n)
    if (exact) return exact.id
    const parcial = sucs.find((s) => n.includes(norm(s.nombre)) || norm(s.nombre).includes(n) || (s.direccion && (n.includes(norm(s.direccion)) || norm(s.direccion).includes(n))))
    return parcial?.id ?? null
  }
  const matchProducto = (sid: number | null, codigo: string, texto: string): string | null => {
    const rows = stockDe(sid)
    const c = codigo.trim()
    if (c) { const r = rows.find((x) => x.codigo === c); if (r) return r.codigo }
    const t = norm(texto)
    if (!t) return null
    const exact = rows.find((x) => norm(`${x.modelo} ${x.descripcion}`) === t)
    if (exact) return exact.codigo
    // todas las palabras del texto están en modelo + color
    const pal = t.split(' ').filter((w) => w.length > 1)
    const cands = rows.filter((x) => { const n = norm(`${x.modelo} ${x.descripcion}`); return pal.every((w) => n.includes(w)) })
    return cands.length === 1 ? cands[0].codigo : null
  }

  const leerArchivo = async (f: File) => {
    const XLSX = await import('xlsx')
    const wb = XLSX.read(await f.arrayBuffer())
    const filas = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' })
    // la primera fila con "cantidad" (o parecido) es el encabezado
    const hi = filas.findIndex((r) => { const c = detectarColumnas((r as unknown[]).map(String)); return c.cantidad >= 0 && (c.codigo >= 0 || c.modelo >= 0 || c.color >= 0) })
    if (hi < 0) { toast('No encontré el encabezado (necesito una columna de cantidad y una de código o modelo)', 'error'); return }
    const col = detectarColumnas((filas[hi] as unknown[]).map(String))
    const out: LineaPrev[] = []
    filas.slice(hi + 1).forEach((r, i) => {
      const row = r as unknown[]
      const cant = Math.round(Number(String(row[col.cantidad] ?? '').replace(',', '.')))
      if (!cant || cant <= 0) return
      const sucTexto = col.sucursal >= 0 ? String(row[col.sucursal] ?? '') : ''
      const sid = col.sucursal >= 0 ? matchSucursal(sucTexto) : sucGeneral
      const codigo = col.codigo >= 0 ? String(row[col.codigo] ?? '') : ''
      const texto = [col.modelo >= 0 ? row[col.modelo] : '', col.color >= 0 ? row[col.color] : ''].map(String).join(' ').trim()
      const saldoTxt = col.saldo >= 0 ? norm(row[col.saldo]) : ''
      out.push({
        fila: hi + i + 2, sucursal_id: sid, cantidad: cant, texto: texto || codigo, sucTexto,
        codigo: matchProducto(sid, codigo, texto), saldo: ['si', 's', 'x', 'saldo', 'yes', '1', 'true'].includes(saldoTxt),
      })
    })
    setArchivo(f.name)
    setLineas(out)
    setResultado(null)
  }

  const setLinea = (i: number, cambios: Partial<LineaPrev>) => setLineas((ls) => ls.map((l, j) => (j === i ? { ...l, ...cambios } : l)))

  // Validación contra el stock de la sucursal (sumando líneas repetidas)
  const errores = useMemo(() => {
    const usado = new Map<string, number>()
    return lineas.map((l) => {
      if (!l.sucursal_id) return 'Elegí la sucursal'
      if (!l.codigo) return 'Elegí el producto'
      const k = `${l.sucursal_id}|${l.codigo}`
      usado.set(k, (usado.get(k) ?? 0) + l.cantidad)
      const hay = stock.find((s) => s.sucursal_id === l.sucursal_id && s.codigo === l.codigo)?.cantidad ?? 0
      return usado.get(k)! > hay ? `La sucursal tiene ${hay}` : null
    })
  }, [lineas, stock])
  const okTodo = lineas.length > 0 && errores.every((e) => !e)
  const totalU = lineas.reduce((s, l) => s + l.cantidad, 0)

  const confirmar = async () => {
    if (!okTodo) return
    if (!window.confirm(`¿Cargar la liquidación de ${madre.nombre}? Se descuentan ${totalU} u del stock de las sucursales y se generan las reposiciones.`)) return
    setEnviando(true)
    const { data, error } = await supabase.rpc('consigna_liquidar', {
      p_madre: madre.cod,
      p_lineas: lineas.map((l) => ({ sucursal_id: l.sucursal_id, codigo: l.codigo, cantidad: l.cantidad, saldo: l.saldo })),
      p_archivo: archivo, p_desde: desde || null, p_hasta: hasta || null, p_quien: quien,
    })
    setEnviando(false)
    if (error) { toast(error.message.replace(/^.*linea_invalida: /, ''), 'error'); return }
    setResultado(data)
    setLineas([])
    toast(`Liquidación #${(data as any).liquidacion_id} cargada`, 'success')
    onCambio()
  }

  return (
    <div className="flex flex-col gap-4">
      <section className="bg-white border border-black/10 rounded-xl p-4 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-muted">
          Excel que mandó el cliente
          <span className="flex items-center gap-2 border border-dashed border-black/20 rounded-lg px-3 py-2 text-sm text-ink cursor-pointer hover:border-gold">
            <Upload size={15} /> {archivo ?? 'Elegir archivo'}
            <input id="liq-archivo" type="file" accept=".xlsx,.xls,.csv" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) leerArchivo(f); e.target.value = '' }} />
          </span>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          Si el Excel no trae sucursal
          <select id="liq-suc-general" value={sucGeneral ?? ''} onChange={(e) => {
            const v = e.target.value ? Number(e.target.value) : null
            setSucGeneral(v)
            setLineas((ls) => ls.map((l) => (l.sucTexto ? l : { ...l, sucursal_id: v, codigo: matchProducto(v, l.codigo ?? '', l.texto) })))
          }} className="border border-black/15 rounded-lg px-2 py-2 text-sm">
            <option value="">—</option>
            {sucs.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">Desde<input id="liq-desde" type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className="border border-black/15 rounded-lg px-2 py-1.5 text-sm" /></label>
        <label className="flex flex-col gap-1 text-xs text-muted">Hasta<input id="liq-hasta" type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className="border border-black/15 rounded-lg px-2 py-1.5 text-sm" /></label>
        <p className="text-[11px] text-faint basis-full">
          Columnas que reconoce: sucursal, código, modelo, color/descripción, cantidad y saldo (si/x). Lo marcado como saldo no se repone igual: se reemplaza por lo que más vende.
        </p>
      </section>

      {lineas.length > 0 && (
        <section className="bg-white border border-black/10 rounded-xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wide text-muted text-left">
                <th className="px-3 py-2 font-medium">Fila</th><th className="px-2 py-2 font-medium">En el Excel</th>
                <th className="px-2 py-2 font-medium">Sucursal</th><th className="px-2 py-2 font-medium">Producto</th>
                <th className="px-2 py-2 font-medium text-right">Cant.</th><th className="px-2 py-2 font-medium">Saldo</th><th className="px-3 py-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {lineas.map((l, i) => (
                <tr key={i} className="border-t border-black/5 align-top">
                  <td className="px-3 py-1.5 text-xs text-faint">{l.fila}</td>
                  <td className="px-2 py-1.5 text-xs">{l.sucTexto && <div className="text-faint">{l.sucTexto}</div>}{l.texto}</td>
                  <td className="px-2 py-1.5">
                    <select id={`liq-suc-${i}`} value={l.sucursal_id ?? ''} onChange={(e) => { const v = e.target.value ? Number(e.target.value) : null; setLinea(i, { sucursal_id: v, codigo: matchProducto(v, l.codigo ?? '', l.texto) }) }}
                      className="border border-black/15 rounded-md px-1.5 py-1 text-xs max-w-[150px]">
                      <option value="">—</option>
                      {sucs.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
                    </select>
                  </td>
                  <td className="px-2 py-1.5">
                    <select id={`liq-prod-${i}`} value={l.codigo ?? ''} onChange={(e) => setLinea(i, { codigo: e.target.value || null })}
                      className="border border-black/15 rounded-md px-1.5 py-1 text-xs max-w-[260px]">
                      <option value="">—</option>
                      {stockDe(l.sucursal_id).map((s) => <option key={s.codigo} value={s.codigo}>{s.modelo} · {s.descripcion} ({s.cantidad})</option>)}
                    </select>
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    <input id={`liq-cant-${i}`} type="number" min={1} value={l.cantidad} onChange={(e) => setLinea(i, { cantidad: Math.max(1, Math.floor(Number(e.target.value) || 1)) })}
                      className="w-14 border border-black/15 rounded-md px-1.5 py-1 text-xs text-right" />
                  </td>
                  <td className="px-2 py-1.5"><input id={`liq-saldo-${i}`} type="checkbox" checked={l.saldo} onChange={(e) => setLinea(i, { saldo: e.target.checked })} aria-label="Venta por saldo" /></td>
                  <td className="px-3 py-1.5 text-xs whitespace-nowrap">
                    {errores[i] ? <span className="text-red-600">{errores[i]}</span> : <Check size={14} className="text-emerald-600" />}
                    <button onClick={() => setLineas((ls) => ls.filter((_, j) => j !== i))} className="ml-2 text-faint underline">quitar</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex flex-wrap items-center gap-3 px-3 py-3 border-t border-black/10">
            <span className="text-sm mr-auto tabular-nums">{lineas.length} líneas · {totalU} u{errores.some(Boolean) && <span className="text-red-600"> · {errores.filter(Boolean).length} para corregir</span>}</span>
            <button onClick={() => setLineas([])} className="text-sm text-muted">Cancelar</button>
            <button onClick={confirmar} disabled={!okTodo || enviando} className="bg-ink text-white text-sm font-medium rounded-lg px-4 py-2 disabled:opacity-40">
              {enviando ? 'Cargando…' : 'Cargar liquidación y reponer'}
            </button>
          </div>
        </section>
      )}

      {resultado && (
        <section className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-sm">
          <div className="font-semibold mb-2">Liquidación #{resultado.liquidacion_id}: {resultado.unidades} u · {pesos(resultado.importe)} a facturar a {madre.nombre}</div>
          <ul className="space-y-1">
            {resultado.sucursales.map((s: any) => (
              <li key={s.sucursal}>
                <b>{s.sucursal}</b>: {s.repuesto > 0 ? <>repone {s.repuesto} u en el pedido #{s.pedido_id} (automático)</> : 'sin reposición automática'}
                {s.a_aprobar > 0 && <> · {s.a_aprobar} u de reemplazo para aprobar</>}
                {s.sin_cubrir > 0 && <span className="text-amber-700"> · {s.sin_cubrir} u sin stock para reemplazar</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="bg-white border border-black/10 rounded-xl">
        <h3 className="text-sm font-semibold px-4 py-3 border-b border-black/10">Liquidaciones cargadas</h3>
        {historial.length === 0 ? <p className="text-sm text-muted px-4 py-4">Todavía no hay liquidaciones.</p> : (
          <ul className="divide-y divide-black/5 text-sm">
            {historial.map((h) => (
              <li key={h.id} className="px-4 py-2 flex flex-wrap gap-x-4 items-baseline">
                <b>#{h.id}</b>
                <span className="text-muted">{fecha(h.created_at)}{h.desde ? ` · período ${h.desde} a ${h.hasta ?? ''}` : ''}</span>
                <span className="tabular-nums">{h.total_units} u · {pesos(h.importe)}</span>
                <span className="text-xs text-faint">{h.archivo} · {h.creado_por}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

// ── Reposiciones a aprobar ───────────────────────────────────────────────────
function Reposiciones({ madre, nombreSuc, onCambio }: { madre: Madre; nombreSuc: (id: number | null) => string; onCambio: () => void }) {
  const toast = useToast()
  const { codigoEfectivo, vendedor } = useAuth()
  const quien = vendedor?.nombre || codigoEfectivo
  const [repos, setRepos] = useState<Repo[] | null>(null)
  const [central, setCentral] = useState<Record<string, number>>({})
  const [edit, setEdit] = useState<Record<number, RepoItem[]>>({})

  const cargar = async () => {
    const { data } = await supabase.from('consigna_repo_suc').select('*').eq('cod_madre', madre.cod).eq('estado', 'pendiente').order('created_at')
    const rs = (data ?? []) as Repo[]
    setRepos(rs)
    setEdit(Object.fromEntries(rs.map((r) => [r.id, r.items.map((it) => ({ ...it }))])))
    const cods = [...new Set(rs.flatMap((r) => r.items.map((i) => i.codigo)))]
    if (cods.length) {
      const { data: st } = await supabase.from('stock').select('codigo, cantidad').in('codigo', cods)
      setCentral(Object.fromEntries((st ?? []).map((s: any) => [s.codigo, s.cantidad])))
    }
  }
  useEffect(() => { cargar() }, [madre.cod])

  const aprobar = async (r: Repo) => {
    const items = (edit[r.id] ?? []).filter((i) => i.cantidad > 0)
    if (!items.length) return toast('No quedó nada para enviar: descartala', 'error')
    const { data, error } = await supabase.rpc('consigna_repo_aprobar', { p_id: r.id, p_items: items, p_quien: quien })
    if (error) return toast('No se pudo aprobar: ' + error.message, 'error')
    const d = data as any
    toast(d.pedido_id ? `Pedido de carga #${d.pedido_id} para ${nombreSuc(r.sucursal_id)}${d.faltante?.length ? ' (faltó stock de algunos)' : ''}` : 'No había stock para cargar', d.pedido_id ? 'success' : 'error')
    cargar(); onCambio()
  }
  const descartar = async (r: Repo) => {
    if (!window.confirm('¿Descartar esta reposición?')) return
    await supabase.from('consigna_repo_suc').update({ estado: 'descartada', aprobado_por: quien, resuelto_at: new Date().toISOString() }).eq('id', r.id)
    cargar(); onCambio()
  }

  if (!repos) return <p className="text-sm text-muted">Cargando…</p>
  if (repos.length === 0) return <p className="text-sm text-muted bg-white border border-black/10 rounded-xl px-4 py-6">No hay reposiciones pendientes. Lo que tiene stock se carga solo como pedido.</p>

  return (
    <div className="grid md:grid-cols-2 gap-3 items-start">
      {repos.map((r) => (
        <section key={r.id} className="bg-white border border-black/10 rounded-xl">
          <header className="px-4 py-3 border-b border-black/10">
            <div className="font-semibold">{nombreSuc(r.sucursal_id)}</div>
            <div className="text-xs text-muted">
              {r.origen === 'liquidacion' ? `Reemplazos de la liquidación #${r.liquidacion_id}` : `Faltante del pedido de sucursal #${r.consigna_pedido_id}`} · {fecha(r.created_at)}
              {r.sin_cubrir > 0 && <span className="text-amber-700"> · {r.sin_cubrir} u sin reemplazo con stock</span>}
            </div>
          </header>
          <ul className="divide-y divide-black/5 text-sm">
            {(edit[r.id] ?? []).map((it, i) => (
              <li key={it.codigo + i} className="px-4 py-2 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div><b className="text-[11px] tracking-wide">{it.modelo}</b> <span className="text-xs text-muted">{it.descripcion}</span></div>
                  {it.motivo && <div className="text-[11px] text-faint">{it.motivo}</div>}
                </div>
                <span className={`text-[11px] tabular-nums ${(central[it.codigo] ?? 0) >= it.cantidad ? 'text-emerald-700' : 'text-red-600'}`}>depósito {central[it.codigo] ?? 0}</span>
                <input id={`repo-${r.id}-${i}`} type="number" min={0} value={it.cantidad}
                  onChange={(e) => setEdit((ed) => ({ ...ed, [r.id]: ed[r.id].map((x, j) => (j === i ? { ...x, cantidad: Math.max(0, Math.floor(Number(e.target.value) || 0)) } : x)) }))}
                  className="w-14 border border-black/15 rounded-md px-1.5 py-1 text-xs text-right" aria-label="Cantidad" />
              </li>
            ))}
          </ul>
          <footer className="px-4 py-3 border-t border-black/10 flex justify-end gap-2">
            <button onClick={() => descartar(r)} className="text-sm border border-black/15 rounded-lg px-3 py-1.5">Descartar</button>
            <button onClick={() => aprobar(r)} className="text-sm bg-ink text-white rounded-lg px-3 py-1.5">Aprobar y cargar pedido</button>
          </footer>
        </section>
      ))}
    </div>
  )
}

// ── Devoluciones: lo que llegó a Orbital ─────────────────────────────────────
function Devoluciones({ madre, nombreSuc }: { madre: Madre; nombreSuc: (id: number | null) => string }) {
  const toast = useToast()
  const [devs, setDevs] = useState<Dev[] | null>(null)
  const cargar = () => supabase.from('consigna_devolucion').select('id, sucursal_id, modelo, descripcion, cantidad, enviada, recibida, conservada, vendida')
    .eq('cod_madre', madre.cod).order('sucursal_id').then(({ data }) => setDevs((data ?? []) as Dev[]))
  useEffect(() => { cargar() }, [madre.cod])
  if (!devs) return <p className="text-sm text-muted">Cargando…</p>

  const pedida = devs.reduce((s, d) => s + d.cantidad, 0)
  const enviada = devs.reduce((s, d) => s + d.enviada, 0)
  const recibida = devs.reduce((s, d) => s + d.recibida, 0)
  const enCamino = devs.filter((d) => d.enviada > d.recibida)

  const recibir = async (d: Dev) => {
    const { error } = await supabase.from('consigna_devolucion').update({ recibida: d.enviada, updated_at: new Date().toISOString() }).eq('id', d.id)
    if (error) return toast('No se pudo marcar', 'error')
    toast(`Recibidas ${d.enviada - d.recibida} u de ${d.modelo}`, 'success')
    cargar()
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted">
        Pedidas {fmt(pedida)} u · la cadena despachó {fmt(enviada)} · recibidas en Orbital {fmt(recibida)} · se quedan {fmt(devs.reduce((s, d) => s + d.conservada, 0))} · vendidas {fmt(devs.reduce((s, d) => s + d.vendida, 0))}
      </p>
      <section className="bg-white border border-black/10 rounded-xl">
        <h3 className="text-sm font-semibold px-4 py-3 border-b border-black/10">Despachadas por las sucursales, a recibir</h3>
        {enCamino.length === 0 ? <p className="text-sm text-muted px-4 py-4">No hay devoluciones despachadas pendientes de recibir.</p> : (
          <ul className="divide-y divide-black/5 text-sm">
            {enCamino.map((d) => (
              <li key={d.id} className="px-4 py-2 flex items-center gap-3">
                <span className="w-40 shrink-0 text-xs text-muted truncate">{nombreSuc(d.sucursal_id)}</span>
                <span className="flex-1"><b className="text-[11px] tracking-wide">{d.modelo}</b> <span className="text-xs text-muted">{d.descripcion}</span></span>
                <span className="tabular-nums font-medium">{d.enviada - d.recibida} u</span>
                <button onClick={() => recibir(d)} className="text-xs bg-emerald-100 text-emerald-900 rounded-md px-2.5 py-1">Recibido</button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

// ── Postventa ────────────────────────────────────────────────────────────────
function PostventaSuite({ madre, nombreSuc, onCambio }: { madre: Madre; nombreSuc: (id: number | null) => string; onCambio: () => void }) {
  const [pvs, setPvs] = useState<Pv[] | null>(null)
  const cargar = () => supabase.from('consigna_postventa').select('id, sucursal_id, tipo, producto, detalle, estado, solicitado_por, created_at')
    .eq('cod_madre', madre.cod).order('created_at', { ascending: false }).then(({ data }) => setPvs((data ?? []) as Pv[]))
  useEffect(() => { cargar() }, [madre.cod])
  if (!pvs) return <p className="text-sm text-muted">Cargando…</p>

  const cambiar = async (p: Pv, estado: string) => {
    await supabase.from('consigna_postventa').update({ estado, updated_at: new Date().toISOString() }).eq('id', p.id)
    cargar(); onCambio()
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted">
        IRIS contesta lo que puede. Lo que deriva llega al grupo de Telegram: respondiendo ese mensaje (o desde{' '}
        <a href="/conversaciones" className="underline">Conversaciones</a>) la respuesta aparece en la pantalla de la sucursal.
      </p>
      {pvs.length === 0 ? <p className="text-sm text-muted bg-white border border-black/10 rounded-xl px-4 py-6">Sin pedidos de postventa.</p> : (
        <section className="bg-white border border-black/10 rounded-xl divide-y divide-black/5">
          {pvs.map((p) => (
            <div key={p.id} className="px-4 py-3 flex flex-wrap gap-3 items-start">
              <div className="flex-1 min-w-[220px]">
                <div className="text-sm font-semibold">#{p.id} · {p.tipo === 'repuesto' ? 'Repuesto' : 'Postventa'} · {nombreSuc(p.sucursal_id)}</div>
                <div className="text-xs text-muted">{fecha(p.created_at)} · {p.solicitado_por}{p.producto ? ` · ${p.producto}` : ''}</div>
                <p className="text-sm mt-1 whitespace-pre-wrap">{p.detalle}</p>
              </div>
              <select id={`pv-estado-${p.id}`} value={p.estado} onChange={(e) => cambiar(p, e.target.value)} className="border border-black/15 rounded-lg px-2 py-1 text-sm">
                <option value="abierto">Abierto</option>
                <option value="en_proceso">En proceso</option>
                <option value="resuelto">Resuelto</option>
              </select>
            </div>
          ))}
        </section>
      )}
    </div>
  )
}

// ── Links de acceso ──────────────────────────────────────────────────────────
// Los tokens se generan SOLO acá, en el panel: la central y las sucursales nunca los generan.
function Links({ madre, sucs, nombreSuc }: { madre: Madre; sucs: Suc[]; nombreSuc: (id: number | null) => string }) {
  const toast = useToast()
  const [accesos, setAccesos] = useState<Acceso[]>([])
  const [generando, setGenerando] = useState<number | 'central' | null>(null)
  const cargar = () =>
    supabase.from('consigna_acceso').select('codigo, sucursal_id, nombre').eq('cod_madre', madre.cod).eq('activo', true)
      .then(({ data }) => setAccesos(((data ?? []) as Acceso[]).sort((a, b) => (a.sucursal_id ?? 0) - (b.sucursal_id ?? 0))))
  useEffect(() => { cargar() }, [madre.cod])

  const generar = async (sucursal_id: number | null, nombre: string) => {
    setGenerando(sucursal_id ?? 'central')
    const { error } = await supabase.from('consigna_acceso').insert({ cod_madre: madre.cod, sucursal_id, nombre })
    setGenerando(null)
    if (error) { toast('No se pudo generar el link', 'error'); return }
    await cargar()
    toast(`Link de ${nombre} generado`, 'success')
  }

  // Una fila por acceso posible: la central y cada sucursal, tenga token o no.
  const filas: { key: string; sucursal_id: number | null; nombre: string; acceso: Acceso | undefined }[] = [
    { key: 'central', sucursal_id: null, nombre: 'Central (autoriza pedidos)', acceso: accesos.find((a) => a.sucursal_id == null) },
    ...sucs.map((s) => ({ key: `s${s.id}`, sucursal_id: s.id, nombre: s.nombre, acceso: accesos.find((a) => a.sucursal_id === s.id) })),
  ]

  return (
    <section className="bg-white border border-black/10 rounded-xl divide-y divide-black/5">
      {filas.map((f) => {
        const url = f.acceso ? `${URL_BASE}/consigna?k=${f.acceso.codigo}` : ''
        return (
          <div key={f.key} className="px-4 py-2.5 flex flex-wrap items-center gap-3 text-sm">
            <span className={`w-44 shrink-0 ${f.sucursal_id ? '' : 'font-semibold'}`}>{f.sucursal_id ? nombreSuc(f.sucursal_id) : f.nombre}</span>
            {f.acceso ? (
              <>
                <code className="flex-1 min-w-0 truncate text-xs text-muted">{url}</code>
                <button onClick={() => { navigator.clipboard.writeText(url); toast('Link copiado', 'success') }} className="text-xs border border-black/15 rounded-md px-2 py-1 flex items-center gap-1"><Copy size={12} /> Copiar</button>
                <a href={url} target="_blank" rel="noreferrer" className="text-xs border border-black/15 rounded-md px-2 py-1 flex items-center gap-1"><ExternalLink size={12} /> Abrir</a>
              </>
            ) : (
              <>
                <span className="flex-1 min-w-0 text-xs text-muted">Sin link todavía</span>
                <button
                  onClick={() => generar(f.sucursal_id, f.sucursal_id ? `Sucursal ${f.nombre}` : `Central ${madre.nombre}`)}
                  disabled={generando !== null}
                  className="text-xs bg-ink text-white rounded-md px-2.5 py-1 disabled:opacity-50"
                >
                  {generando === (f.sucursal_id ?? 'central') ? 'Generando…' : 'Generar link'}
                </button>
              </>
            )}
          </div>
        )
      })}
      <TerminalesPendientes madre={madre} />
    </section>
  )
}

// Terminales que chocaron con el tope (central 8, sucursal 4). Se activan de acá; el cliente no
// necesita usuario ni contraseña: recarga y entra.
type DevPend = { codigo: string; device_id: string; user_agent: string | null; sucursal: string; desde: string }

function TerminalesPendientes({ madre }: { madre: Madre }) {
  const toast = useToast()
  const [items, setItems] = useState<DevPend[]>([])
  const cargar = () => supabase.rpc('consigna_dispositivos_pendientes', { p_madre: madre.cod })
    .then(({ data }) => setItems((data ?? []) as DevPend[]))
  useEffect(() => { cargar() }, [madre.cod])

  const activar = async (d: DevPend) => {
    const { error } = await supabase.rpc('consigna_dispositivo_activar', { p_codigo: d.codigo, p_device: d.device_id })
    if (error) { toast('No se pudo activar', 'error'); return }
    await cargar()
    toast('Terminal activada', 'success')
  }

  const equipo = (ua: string | null) => {
    const u = (ua ?? '').toLowerCase()
    if (u.includes('iphone')) return 'iPhone'
    if (u.includes('ipad')) return 'iPad'
    if (u.includes('android')) return 'Android'
    if (u.includes('windows')) return 'PC'
    if (u.includes('mac os')) return 'Mac'
    return 'Terminal'
  }

  if (!items.length) return null
  return (
    <div className="px-4 py-3 bg-amber-50">
      <div className="text-xs font-semibold text-amber-900 mb-1.5">Terminales esperando activación</div>
      <ul className="flex flex-col gap-1.5">
        {items.map((d) => (
          <li key={d.codigo + d.device_id} className="flex flex-wrap items-center gap-3 text-sm">
            <span className="w-44 shrink-0">{d.sucursal}</span>
            <span className="flex-1 min-w-0 text-xs text-muted truncate">
              {equipo(d.user_agent)} · desde {new Date(d.desde).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
            </span>
            <button onClick={() => activar(d)} className="text-xs bg-amber-700 text-white rounded-md px-2.5 py-1">Activar</button>
          </li>
        ))}
      </ul>
    </div>
  )
}
