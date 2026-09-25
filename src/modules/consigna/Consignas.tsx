// ── Consignas (Suite) ───────────────────────────────────────────────────────
// Administración de los clientes de consigna con sucursales (cliente madre + sucursales):
//   · Tablero: envíos en curso, stock por sucursal, rotación, lo trabado y cómo impulsarlo.
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
import TableroConsigna from './TableroConsigna'
import { leerHoja, matchTexto, norm, type DetalleCliente, type LineaLeida } from './liquidacionParser'

type Madre = { cod: string; nombre: string; sucursales: number; local: number; devolver: number; camino: number; repos: number; postventa: number }
type Suc = { id: number; cod_madre: string; nombre: string; direccion: string | null; orden: number }
type StockRow = { sucursal_id: number; codigo: string; modelo: string | null; descripcion: string | null; cantidad: number; devolver: number; en_camino: number; precio: number | null }
type RepoItem = { codigo: string; modelo: string | null; descripcion: string | null; cantidad: number; motivo?: string }
type Repo = { id: number; sucursal_id: number; origen: string; liquidacion_id: number | null; consigna_pedido_id: number | null; items: RepoItem[]; sin_cubrir: number; created_at: string }
type Liq = { id: number; archivo: string | null; desde: string | null; hasta: string | null; total_units: number; importe: number; importe_cliente: number | null; detalle_cliente: DetalleCliente | null; creado_por: string | null; created_at: string }
type Dev = { id: number; sucursal_id: number; modelo: string; descripcion: string | null; cantidad: number; enviada: number; recibida: number; conservada: number; vendida: number }
type Pv = { id: number; sucursal_id: number | null; tipo: string; producto: string | null; detalle: string; estado: string; solicitado_por: string | null; created_at: string }
type Acceso = { codigo: string; sucursal_id: number | null; nombre: string | null }

const fmt = (n: number) => Number(n || 0).toLocaleString('es-AR')
const pesos = (n: number) => '$' + Math.round(Number(n || 0)).toLocaleString('es-AR')
const fecha = (s: string) => new Date(s).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' })
const URL_BASE = 'https://ver.orbitaleyewear.com.ar'

type Vista = 'tablero' | 'liquidacion' | 'repos' | 'devoluciones' | 'postventa' | 'links'

export default function Consignas() {
  const [madres, setMadres] = useState<Madre[] | null>(null)
  const [sel, setSel] = useState<string | null>(null)
  const [vista, setVista] = useState<Vista>('tablero')
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
    ['tablero', 'Tablero'],
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
        if (s.length) supabase.from('consigna_suc_stock').select('sucursal_id, codigo, modelo, descripcion, cantidad, devolver, en_camino, precio')
          .in('sucursal_id', s.map((x) => x.id)).then(({ data }) => setStock((data ?? []) as StockRow[]))
      })
  }, [madre.cod])
  const nombreSuc = (id: number | null) => sucs.find((s) => s.id === id)?.nombre ?? 'Central'

  if (vista === 'tablero') return <TableroConsigna cod={madre.cod} nombre={madre.nombre} sucs={sucs} stock={stock} />
  if (vista === 'liquidacion') return <Liquidacion madre={madre} sucs={sucs} stock={stock} onCambio={onCambio} />
  if (vista === 'repos') return <Reposiciones madre={madre} nombreSuc={nombreSuc} onCambio={onCambio} />
  if (vista === 'devoluciones') return <Devoluciones madre={madre} nombreSuc={nombreSuc} />
  if (vista === 'postventa') return <PostventaSuite madre={madre} nombreSuc={nombreSuc} onCambio={onCambio} />
  return <Links madre={madre} sucs={sucs} nombreSuc={nombreSuc} />
}

// ── Liquidación por Excel ────────────────────────────────────────────────────
// El formato de cada cliente se reconoce solo (liquidacionParser). El producto se resuelve por:
// SKU Orbital en el archivo → equivalencia aprendida (consigna_alias) → modelo + color.
// Sin sucursal en el archivo: se descuenta de la sucursal que tiene ese producto.
type TipoLinea = 'venta' | 'otra_marca'
type LineaPrev = {
  fila: number; sucursal_id: number | null; codigo: string | null; cantidad: number; saldo: boolean; texto: string; sucTexto: string
  tipo: TipoLinea; forzar: boolean; codigoCliente: string; modelo: string; color: string; seccion: string
  precioCliente: number | null; importeCliente: number | null
}
type Prod = { codigo: string; modelo: string | null; descripcion: string | null; precio: number | null }
const CAMPOS_CLIENTE: [keyof DetalleCliente, string][] = [
  ['subtotal', 'Subtotal sin IVA'], ['iva', 'IVA'], ['total', 'Total'], ['publicidad', 'Publicidad'], ['comision', 'Comisión %'], ['pago', 'Pago'],
]

function Liquidacion({ madre, sucs, stock, onCambio }: { madre: Madre; sucs: Suc[]; stock: StockRow[]; onCambio: () => void }) {
  const toast = useToast()
  const { codigoEfectivo, vendedor } = useAuth()
  const quien = vendedor?.nombre || codigoEfectivo
  const [archivo, setArchivo] = useState<string | null>(null)
  const [libro, setLibro] = useState<{ nombres: string[]; filas: unknown[][][] } | null>(null)
  const [hoja, setHoja] = useState(0)
  const [lineas, setLineas] = useState<LineaPrev[]>([])
  const [sucGeneral, setSucGeneral] = useState<number | null>(null)
  const [desde, setDesde] = useState('')
  const [hasta, setHasta] = useState('')
  const [cliente, setCliente] = useState<DetalleCliente>({})
  const [enviando, setEnviando] = useState(false)
  const [resultado, setResultado] = useState<any>(null)
  const [historial, setHistorial] = useState<Liq[]>([])
  const [alias, setAlias] = useState<Map<string, string>>(new Map())
  const [catalogo, setCatalogo] = useState<Prod[]>([])

  useEffect(() => {
    supabase.from('consigna_liquidacion').select('*').eq('cod_madre', madre.cod).order('created_at', { ascending: false }).limit(30)
      .then(({ data }) => setHistorial((data ?? []) as Liq[]))
  }, [madre.cod, resultado])
  useEffect(() => {
    supabase.from('consigna_alias').select('codigo_cliente, codigo').eq('cod_madre', madre.cod)
      .then(({ data }) => setAlias(new Map((data ?? []).map((a: any) => [String(a.codigo_cliente).toUpperCase(), a.codigo as string]))))
    supabase.from('stock').select('codigo, modelo, descripcion, precio').then(({ data }) => setCatalogo((data ?? []) as Prod[]))
  }, [madre.cod, resultado])

  // productos de la consigna del cliente (todas las sucursales) + catálogo Orbital
  const prods = useMemo(() => {
    const m = new Map<string, Prod>()
    for (const s of stock) if (!m.has(s.codigo)) m.set(s.codigo, { codigo: s.codigo, modelo: s.modelo, descripcion: s.descripcion, precio: s.precio })
    const enConsigna = [...m.values()]
    for (const c of catalogo) if (!m.has(c.codigo)) m.set(c.codigo, c)
    return { enConsigna, todos: m }
  }, [stock, catalogo])
  const nombreProd = (c: string | null) => { const p = c ? prods.todos.get(c) : null; return p ? `${p.modelo ?? ''} · ${p.descripcion ?? ''}` : null }
  const precioLista = (c: string | null) => (c ? prods.todos.get(c)?.precio ?? null : null)
  const stockEn = (sid: number | null, codigo: string | null) => stock.find((s) => s.sucursal_id === sid && s.codigo === codigo)?.cantidad ?? 0

  const matchSucursal = (t: string): number | null => {
    const n = norm(t)
    if (!n) return null
    const exact = sucs.find((s) => norm(s.nombre) === n || norm(s.direccion) === n)
    if (exact) return exact.id
    const parcial = sucs.find((s) => n.includes(norm(s.nombre)) || norm(s.nombre).includes(n) || (s.direccion && (n.includes(norm(s.direccion)) || norm(s.direccion).includes(n))))
    return parcial?.id ?? null
  }
  const resolverProducto = (l: LineaLeida): string | null => {
    if (l.codigoOrbital && prods.todos.has(l.codigoOrbital)) return l.codigoOrbital
    const a = l.codigoCliente ? alias.get(l.codigoCliente.toUpperCase()) : undefined
    if (a) return a
    const [mod, col] = l.modelo ? [l.modelo, l.color] : [l.texto.split(' ')[0], l.texto.split(' ').slice(1).join(' ')]
    return matchTexto(mod, col, prods.enConsigna, catalogo) ?? l.codigoOrbital
  }
  // reparte la cantidad entre las sucursales que tienen el producto (la de más stock primero)
  const repartir = (codigo: string | null, cantidad: number): { sucursal_id: number | null; cantidad: number; forzar: boolean }[] => {
    if (sucGeneral) return [{ sucursal_id: sucGeneral, cantidad, forzar: false }]
    if (sucs.length === 1) return [{ sucursal_id: sucs[0].id, cantidad, forzar: false }]
    const con = stock.filter((s) => s.codigo === codigo && s.cantidad > 0).sort((a, b) => b.cantidad - a.cantidad)
    // sin stock registrado en ninguna: va a la primera sucursal (se cambia en la línea)
    if (cantidad < 0 || !codigo || !con.length) return [{ sucursal_id: con[0]?.sucursal_id ?? sucs[0]?.id ?? null, cantidad, forzar: false }]
    const out: { sucursal_id: number | null; cantidad: number; forzar: boolean }[] = []
    let resto = cantidad
    for (const s of con) { if (resto <= 0) break; const q = Math.min(resto, s.cantidad); out.push({ sucursal_id: s.sucursal_id, cantidad: q, forzar: false }); resto -= q }
    if (resto > 0) { out[0].cantidad += resto; out[0].forzar = true }
    return out
  }

  const armarLineas = (filas: unknown[][]) => {
    const r = leerHoja(filas)
    if (r.error) { toast(r.error, 'error'); setLineas([]); return }
    const out: LineaPrev[] = []
    for (const l of r.lineas) {
      const base = {
        fila: l.fila, texto: l.texto, sucTexto: l.sucTexto, saldo: l.saldo, codigoCliente: l.codigoCliente, modelo: l.modelo, color: l.color,
        seccion: l.seccion, precioCliente: l.precioCliente,
      }
      if (l.otraMarca) {
        out.push({ ...base, tipo: 'otra_marca', codigo: null, cantidad: l.cantidad, sucursal_id: sucGeneral ?? sucs[0]?.id ?? null, forzar: false, importeCliente: l.importeCliente })
        continue
      }
      const codigo = resolverProducto(l)
      const partes = l.sucTexto ? [{ sucursal_id: matchSucursal(l.sucTexto), cantidad: l.cantidad, forzar: false }] : repartir(codigo, l.cantidad)
      for (const p of partes) {
        out.push({
          ...base, tipo: 'venta', codigo, ...p,
          importeCliente: l.importeCliente != null && l.cantidad ? (l.importeCliente * p.cantidad) / l.cantidad : null,
        })
      }
    }
    setLineas(out)
    setCliente(r.detalle)
    setDesde(r.desde ?? '')
    setHasta(r.hasta ?? '')
    setResultado(null)
  }

  const leerArchivo = async (f: File) => {
    if (/\.pdf$/i.test(f.name)) {
      toast('El PDF no se puede leer con seguridad (las columnas vienen corridas). Pedile el Excel al cliente o cargá las líneas a mano.', 'error')
      setArchivo(f.name); setLibro(null); setLineas([]); setCliente({})
      return
    }
    const XLSX = await import('xlsx')
    const wb = XLSX.read(await f.arrayBuffer())
    const filas = wb.SheetNames.map((n) => XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[n], { header: 1, defval: '' }))
    const primera = Math.max(0, wb.SheetNames.findIndex((n) => !/stock/i.test(n)))
    setArchivo(f.name)
    setLibro({ nombres: wb.SheetNames, filas })
    setHoja(primera)
    armarLineas(filas[primera])
  }

  const setLinea = (i: number, cambios: Partial<LineaPrev>) => setLineas((ls) => ls.map((l, j) => (j === i ? { ...l, ...cambios } : l)))
  const agregarLinea = () => setLineas((ls) => [...ls, {
    fila: 0, sucursal_id: sucGeneral ?? sucs[0]?.id ?? null, codigo: null, cantidad: 1, saldo: false, texto: 'Agregada a mano', sucTexto: '',
    tipo: 'venta', forzar: false, codigoCliente: '', modelo: '', color: '', seccion: '', precioCliente: null, importeCliente: null,
  }])

  // Validación contra el stock de la sucursal (sumando líneas repetidas)
  const estados = useMemo(() => {
    const usado = new Map<string, number>()
    return lineas.map((l): { error?: string; aviso?: string } => {
      if (!l.sucursal_id) return { error: 'Elegí la sucursal' }
      if (l.tipo === 'otra_marca') return { aviso: 'Otra marca: se liquida, no mueve stock' }
      if (!l.codigo) return { error: 'Elegí el producto' }
      if (!prods.todos.has(l.codigo)) return { error: 'Ese código no existe' }
      if (l.cantidad < 0) return { aviso: 'Devolución: vuelve a la consigna' }
      const k = `${l.sucursal_id}|${l.codigo}`
      usado.set(k, (usado.get(k) ?? 0) + l.cantidad)
      const hay = stockEn(l.sucursal_id, l.codigo)
      if (usado.get(k)! > hay) return l.forzar ? { aviso: `Sin stock registrado (tiene ${hay}): se carga igual` } : { error: `La sucursal tiene ${hay}` }
      return {}
    })
  }, [lineas, stock, prods])
  const okTodo = lineas.length > 0 && estados.every((e) => !e.error)
  const totalU = lineas.reduce((s, l) => s + l.cantidad, 0)
  const nuestro = lineas.reduce((s, l) => s + l.cantidad * ((l.tipo === 'otra_marca' ? l.precioCliente : precioLista(l.codigo)) ?? 0), 0)
  const sumaCliente = lineas.reduce((s, l) => s + (l.importeCliente ?? 0), 0)
  const subtotalCliente = cliente.subtotal ?? (sumaCliente || null)

  const confirmar = async () => {
    if (!okTodo) return
    const devol = lineas.filter((l) => l.cantidad < 0).reduce((s, l) => s - l.cantidad, 0)
    const forz = lineas.filter((l) => l.forzar).length
    if (!window.confirm(`¿Cargar la liquidación de ${madre.nombre}? ${totalU} u netas${devol ? ` (${devol} devueltas vuelven a la consigna)` : ''}${forz ? ` · ${forz} líneas sin stock registrado` : ''}. Se descuenta el stock de las sucursales y se generan las reposiciones (pedidos reales).`)) return
    setEnviando(true)
    const { data, error } = await supabase.rpc('consigna_liquidar', {
      p_madre: madre.cod,
      p_lineas: lineas.map((l) => ({
        sucursal_id: l.sucursal_id, codigo: l.codigo, cantidad: l.cantidad, saldo: l.saldo,
        tipo: l.tipo === 'otra_marca' ? 'otra_marca' : l.forzar ? 'forzar' : 'venta',
        codigo_cliente: l.codigoCliente || null, texto_cliente: l.texto, precio_cliente: l.precioCliente, importe_cliente: l.importeCliente,
      })),
      p_archivo: libro ? `${archivo} · ${libro.nombres[hoja]}` : archivo, p_desde: desde || null, p_hasta: hasta || null, p_quien: quien,
      p_cliente: { ...cliente, subtotal: subtotalCliente ?? undefined, nuestro_importe: Math.round(nuestro) },
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
          Liquidación que mandó el cliente
          <span className="flex items-center gap-2 border border-dashed border-black/20 rounded-lg px-3 py-2 text-sm text-ink cursor-pointer hover:border-gold">
            <Upload size={15} /> {archivo ?? 'Elegir archivo'}
            <input id="liq-archivo" type="file" accept=".xlsx,.xls,.csv,.pdf" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) leerArchivo(f); e.target.value = '' }} />
          </span>
        </label>
        {libro && libro.nombres.length > 1 && (
          <label className="flex flex-col gap-1 text-xs text-muted">
            Hoja
            <select id="liq-hoja" value={hoja} onChange={(e) => { const h = Number(e.target.value); setHoja(h); armarLineas(libro.filas[h]) }}
              className="border border-black/15 rounded-lg px-2 py-2 text-sm max-w-[240px]">
              {libro.nombres.map((n, i) => <option key={i} value={i}>{n}</option>)}
            </select>
          </label>
        )}
        {sucs.length > 1 && (
          <label className="flex flex-col gap-1 text-xs text-muted">
            Si no trae sucursal
            <select id="liq-suc-general" value={sucGeneral ?? ''} onChange={(e) => {
              const v = e.target.value ? Number(e.target.value) : null
              setSucGeneral(v)
              if (v) setLineas((ls) => ls.map((l) => (l.sucTexto ? l : { ...l, sucursal_id: v })))
            }} className="border border-black/15 rounded-lg px-2 py-2 text-sm">
              <option value="">Automático (donde hay stock)</option>
              {sucs.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
            </select>
          </label>
        )}
        <label className="flex flex-col gap-1 text-xs text-muted">Desde<input id="liq-desde" type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className="border border-black/15 rounded-lg px-2 py-1.5 text-sm" /></label>
        <label className="flex flex-col gap-1 text-xs text-muted">Hasta<input id="liq-hasta" type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className="border border-black/15 rounded-lg px-2 py-1.5 text-sm" /></label>
        <button onClick={agregarLinea} className="text-sm text-muted underline ml-auto">+ agregar línea a mano</button>
        <p className="text-[11px] text-faint basis-full">
          Reconoce solo los formatos de Prieto, Expovision (hoja por mes; LIQUIDETA = saldo, BE RABBIT = otra marca) y el Excel de ShopGallery.
          El código propio del cliente se aprende la primera vez que elegís el producto. Cantidades negativas = devolución del cliente final.
        </p>
      </section>

      {lineas.length > 0 && (
        <section className="bg-white border border-black/10 rounded-xl p-4 flex flex-col gap-3">
          <h3 className="text-sm font-semibold">Lo que liquida el cliente vs. nuestro importe</h3>
          <div className="flex flex-wrap gap-3">
            {CAMPOS_CLIENTE.map(([k, label]) => (
              <label key={k} className="flex flex-col gap-1 text-xs text-muted">
                {label}
                <input id={`liq-cli-${k}`} type="number" value={cliente[k] ?? ''} onChange={(e) => setCliente((c) => ({ ...c, [k]: e.target.value === '' ? undefined : Number(e.target.value) }))}
                  className="w-32 border border-black/15 rounded-md px-2 py-1 text-sm text-right tabular-nums" />
              </label>
            ))}
          </div>
          <div className="text-sm tabular-nums flex flex-wrap gap-x-6 gap-y-1">
            <span>Cliente (sin IVA): <b>{subtotalCliente != null ? pesos(subtotalCliente) : '—'}</b></span>
            <span>Nuestro a precio de lista: <b>{pesos(nuestro)}</b></span>
            {subtotalCliente != null && nuestro > 0 && (
              <span className={Math.abs(subtotalCliente - nuestro) / nuestro > 0.02 ? 'text-amber-700' : 'text-emerald-700'}>
                Diferencia {pesos(subtotalCliente - nuestro)} ({(((subtotalCliente - nuestro) / nuestro) * 100).toFixed(1)}%)
              </span>
            )}
            {cliente.pago != null && <span>Pago que informa: <b>{pesos(cliente.pago)}</b></span>}
          </div>
        </section>
      )}

      {lineas.length > 0 && (
        <section className="bg-white border border-black/10 rounded-xl overflow-x-auto">
          <datalist id="liq-prods">
            {[...prods.todos.values()].map((p) => <option key={p.codigo} value={p.codigo}>{p.modelo} · {p.descripcion}</option>)}
          </datalist>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wide text-muted text-left">
                <th className="px-3 py-2 font-medium">Fila</th><th className="px-2 py-2 font-medium">En el archivo</th>
                <th className="px-2 py-2 font-medium">Sucursal</th><th className="px-2 py-2 font-medium">Producto Orbital</th>
                <th className="px-2 py-2 font-medium text-right">Cant.</th><th className="px-2 py-2 font-medium text-right">$ cliente</th>
                <th className="px-2 py-2 font-medium">Saldo</th><th className="px-3 py-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {lineas.map((l, i) => {
                const e = estados[i]
                return (
                  <tr key={i} className={`border-t border-black/5 align-top ${l.cantidad < 0 ? 'bg-sky-50/60' : l.tipo === 'otra_marca' ? 'bg-black/[0.02]' : ''}`}>
                    <td className="px-3 py-1.5 text-xs text-faint">{l.fila || '—'}</td>
                    <td className="px-2 py-1.5 text-xs">
                      {l.seccion && <div className="text-[10px] uppercase tracking-wide text-faint">{l.seccion}</div>}
                      {l.sucTexto && <div className="text-faint">{l.sucTexto}</div>}
                      {l.texto}{l.codigoCliente && <span className="text-faint"> · {l.codigoCliente}</span>}
                    </td>
                    <td className="px-2 py-1.5">
                      <select id={`liq-suc-${i}`} value={l.sucursal_id ?? ''} onChange={(ev) => setLinea(i, { sucursal_id: ev.target.value ? Number(ev.target.value) : null })}
                        className="border border-black/15 rounded-md px-1.5 py-1 text-xs max-w-[150px]">
                        <option value="">—</option>
                        {sucs.map((s) => <option key={s.id} value={s.id}>{s.nombre}{l.codigo ? ` (${stockEn(s.id, l.codigo)})` : ''}</option>)}
                      </select>
                    </td>
                    <td className="px-2 py-1.5">
                      {l.tipo === 'otra_marca' ? <span className="text-xs text-muted">Otra marca</span> : (
                        <>
                          <input id={`liq-prod-${i}`} list="liq-prods" value={l.codigo ?? ''} placeholder="código o buscar…"
                            onChange={(ev) => { const v = ev.target.value.trim().toUpperCase(); setLinea(i, { codigo: v || null }) }}
                            className="w-40 border border-black/15 rounded-md px-1.5 py-1 text-xs font-mono" />
                          <div className="text-[11px] text-muted max-w-[240px] truncate">{nombreProd(l.codigo) ?? ''}</div>
                        </>
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      <input id={`liq-cant-${i}`} type="number" value={l.cantidad} onChange={(ev) => setLinea(i, { cantidad: Math.trunc(Number(ev.target.value) || 0) })}
                        className="w-14 border border-black/15 rounded-md px-1.5 py-1 text-xs text-right" />
                    </td>
                    <td className="px-2 py-1.5 text-right text-xs tabular-nums text-muted">{l.importeCliente != null ? pesos(l.importeCliente) : ''}</td>
                    <td className="px-2 py-1.5"><input id={`liq-saldo-${i}`} type="checkbox" checked={l.saldo} disabled={l.tipo === 'otra_marca'} onChange={(ev) => setLinea(i, { saldo: ev.target.checked })} aria-label="Venta por saldo" /></td>
                    <td className="px-3 py-1.5 text-xs">
                      {e.error ? <span className="text-red-600">{e.error}</span> : e.aviso ? <span className="text-amber-700">{e.aviso}</span> : <Check size={14} className="text-emerald-600" />}
                      {(e.error?.startsWith('La sucursal tiene') || l.forzar) && (
                        <label className="flex items-center gap-1 mt-1 whitespace-nowrap text-muted">
                          <input id={`liq-forzar-${i}`} type="checkbox" checked={l.forzar} onChange={(ev) => setLinea(i, { forzar: ev.target.checked })} /> cargar igual
                        </label>
                      )}
                      <button onClick={() => setLineas((ls) => ls.filter((_, j) => j !== i))} className="block mt-1 text-faint underline">quitar</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <div className="flex flex-wrap items-center gap-3 px-3 py-3 border-t border-black/10">
            <span className="text-sm mr-auto tabular-nums">
              {lineas.length} líneas · {totalU} u netas
              {estados.some((e) => e.error) && <span className="text-red-600"> · {estados.filter((e) => e.error).length} para corregir</span>}
            </span>
            {estados.some((e) => e.error?.startsWith('La sucursal tiene')) && (
              <button onClick={() => setLineas((ls) => ls.map((l, j) => (estados[j].error?.startsWith('La sucursal tiene') ? { ...l, forzar: true } : l)))}
                className="text-sm text-muted underline">Cargar igual todo lo que no tiene stock registrado</button>
            )}
            <button onClick={() => setLineas([])} className="text-sm text-muted">Cancelar</button>
            <button onClick={confirmar} disabled={!okTodo || enviando} className="bg-ink text-white text-sm font-medium rounded-lg px-4 py-2 disabled:opacity-40">
              {enviando ? 'Cargando…' : 'Cargar liquidación y reponer'}
            </button>
          </div>
        </section>
      )}

      {resultado && (
        <section className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-sm">
          <div className="font-semibold mb-2">
            Liquidación #{resultado.liquidacion_id}: {resultado.unidades} u · {pesos(resultado.importe)} a lista
            {resultado.importe_cliente != null && <> · el cliente liquida {pesos(resultado.importe_cliente)}</>}
          </div>
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
                <span className="tabular-nums">{h.total_units} u · {pesos(h.importe)} lista</span>
                {h.importe_cliente != null && <span className="tabular-nums">cliente {pesos(Number(h.detalle_cliente?.subtotal ?? h.importe_cliente))}</span>}
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
              {r.origen === 'liquidacion' ? `Reemplazos de la liquidación #${r.liquidacion_id}`
                : r.origen === 'sugerida' ? 'Reposición sugerida (ventas + modelos nuevos)'
                : `Faltante del pedido de sucursal #${r.consigna_pedido_id}`} · {fecha(r.created_at)}
              {' · '}{r.items.reduce((a, i) => a + i.cantidad, 0)} u
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
