import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Search, X, ShoppingCart, ChevronDown, Minus, Plus } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { colorLegible, colorSwatch } from './colorLegible'
import { CATEGORIA_FIJA } from './categorias'

// ── Carga masiva (planilla) ───────────────────────────────────────────────────
// Todos los SKU del link en una tabla tipo Excel: una fila por color, la cantidad se tipea
// y se salta con Enter / flechas / Tab. Escribe en el MISMO carrito del catálogo (el padre
// arma el CartItem), así el checkout de siempre (catalogo_checkout) cierra el pedido.
// Los datos salen de catalogo_planilla: misma regla de precios, ocultos, promo y stock
// libre que catalogo_modelo_v2, pero de una sola vez.

export interface FilaPlanilla {
  modelo: string; codigo: string; descripcion: string | null; tipo: string | null
  tratamiento: string | null; clasificacion: string | null; precio: number; precio_lista: number
  caliente: boolean; imagen: string | null; stock: number; proyectado: boolean
}

const kAr = (n: number) => '$' + Math.round(n).toLocaleString('es-AR')
const cap = (s: string | null) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '')

interface Props {
  clave: string
  sinPrecios: boolean
  /** Orden y visibilidad de modelos: los de catalogo_home (ocultos ya filtrados por el servidor) */
  modelos: string[]
  /** Foto de referencia por modelo (la tapa del catálogo), para el encabezado del modelo */
  fotosModelo?: Record<string, string>
  /** Precio desde el 1/11 por SKU (solo los que suben): referencia para aprovechar el precio de octubre */
  preciosNov?: Record<string, number>
  /** Secciones del catálogo y a qué modelos aplica cada una (para el filtro) */
  secciones: { key: string; nombre: string; modelos: Set<string> }[]
  cantidades: Record<string, number>
  cartCount: number
  cartTotal: number
  esPromo: (f: FilaPlanilla) => boolean
  onSetCant: (f: FilaPlanilla, n: number) => void
  onVerPedido: () => void
  onClose: () => void
}

export default function PedidoPlanilla({ clave, sinPrecios, modelos, fotosModelo, preciosNov, secciones, cantidades, cartCount, cartTotal, esPromo, onSetCant, onVerPedido, onClose }: Props) {
  const [filas, setFilas] = useState<FilaPlanilla[] | null>(null)
  const [error, setError] = useState(false)
  const [q, setQ] = useState('')
  const [seccion, setSeccion] = useState('')
  const [clasif, setClasif] = useState('')
  const [trat, setTrat] = useState('')
  const [escala, setEscala] = useState('')
  const [soloCargados, setSoloCargados] = useState(false)
  const [sinProyectado, setSinProyectado] = useState(false)
  const [tope, setTope] = useState<string | null>(null)

  useEffect(() => {
    supabase.rpc('catalogo_planilla', { p_clave: clave }).then(({ data, error: e }) => {
      if (e) { setError(true); setFilas([]); return }
      setFilas(((data as FilaPlanilla[]) ?? []).map((f) => ({ ...f, precio: Number(f.precio) || 0, precio_lista: Number(f.precio_lista) || 0, stock: Number(f.stock) || 0 })))
    })
  }, [clave])

  // Esc cierra (si no se está escribiendo en una celda: ahí solo sale de la celda)
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape' && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement)) onClose() }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])

  // Solo modelos que el catálogo muestra a este link, en el mismo orden
  const orden = useMemo(() => new Map(modelos.map((m, i) => [m, i])), [modelos])
  const base = useMemo(() => (filas ?? []).filter((f) => orden.has(f.modelo))
    .sort((a, b) => orden.get(a.modelo)! - orden.get(b.modelo)! || Number(a.proyectado) - Number(b.proyectado) || (a.descripcion || '').localeCompare(b.descripcion || '')), [filas, orden])

  const opciones = useMemo(() => {
    const uniq = (xs: (string | null)[]) => [...new Set(xs.filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b))
    return {
      clasif: uniq(base.map((f) => f.clasificacion)),
      trat: uniq(base.map((f) => f.tratamiento)),
      escala: [...new Set(base.map((f) => f.precio).filter((p) => p > 0))].sort((a, b) => a - b),
      secciones: secciones.filter((s) => base.some((f) => s.modelos.has(f.modelo))),
    }
  }, [base, secciones])

  const qn = q.trim().toLowerCase()
  const visibles = useMemo(() => {
    const sec = secciones.find((s) => s.key === seccion)
    return base.filter((f) =>
      (!qn || f.modelo.toLowerCase().includes(qn) || (f.descripcion || '').toLowerCase().includes(qn) || f.codigo.toLowerCase().includes(qn)) &&
      (!sec || sec.modelos.has(f.modelo)) &&
      (!clasif || f.clasificacion === clasif) &&
      (!trat || f.tratamiento === trat) &&
      (!escala || f.precio === Number(escala)) &&
      (!sinProyectado || !f.proyectado) &&
      (!soloCargados || (cantidades[f.codigo] ?? 0) > 0))
  }, [base, qn, seccion, secciones, clasif, trat, escala, sinProyectado, soloCargados, cantidades])

  // Una fila por modelo (en el orden del catálogo) con sus colores adentro y subtotales (sobre las filas visibles)
  const lista = useMemo(() => {
    const out: Mod[] = []
    for (const f of visibles) {
      let m = out[out.length - 1]
      if (!m || m.modelo !== f.modelo) { m = { modelo: f.modelo, filas: [], u: 0, imp: 0, desde: 0, desdeNov: 0, proy: 0, promo: 0 }; out.push(m) }
      const n = cantidades[f.codigo] ?? 0
      m.filas.push(f); m.u += n; m.imp += n * f.precio
      if (f.proyectado) m.proy++
      if (esPromo(f)) m.promo++
      if (f.precio > 0 && (!m.desde || f.precio < m.desde)) m.desde = f.precio
      const pn = preciosNov?.[f.codigo] ?? f.precio
      if (pn > 0 && (!m.desdeNov || pn < m.desdeNov)) m.desdeNov = pn
    }
    return out
  }, [visibles, cantidades, preciosNov, esPromo])

  // Categoría de cada modelo: primero la asignación fija (CATEGORIA_FIJA); si no, la primera sección del
  // catálogo que le toca (orden de GRUPOS). Triple Protección, Día de la Madre y Cuando baja la luz no son
  // categorías de la planilla (cruzan el catálogo): el modelo va a su categoría de siempre. Sin ninguna,
  // va a Oportunidades. Así cada SKU aparece una sola vez.
  const categoriaDe = useMemo(() => {
    const nombre = new Map(secciones.map((s) => [s.key, s.nombre]))
    const m = new Map<string, { key: string; nombre: string }>()
    for (const [mod, key] of Object.entries(CATEGORIA_FIJA)) if (nombre.has(key)) m.set(mod, { key, nombre: nombre.get(key)! })
    for (const s of secciones) {
      if (NO_CATEGORIA.has(s.key)) continue
      for (const mod of s.modelos) if (!m.has(mod)) m.set(mod, { key: s.key, nombre: s.nombre })
    }
    // Los que solo estaban en Triple / Día de la Madre / Baja la luz son anteojos de sol de uso diario: van a Urbanos
    if (nombre.has('urbano'))
      for (const s of secciones) if (NO_CATEGORIA.has(s.key))
        for (const mod of s.modelos) if (!m.has(mod)) m.set(mod, { key: 'urbano', nombre: nombre.get('urbano')! })
    return m
  }, [secciones])
  const cats = useMemo(() => {
    const out: Cat[] = []
    const porKey = new Map<string, Cat>()
    const resto = { key: 'oportunidades', nombre: secciones.find((s) => s.key === 'oportunidades')?.nombre ?? 'Oportunidades' }
    for (const m of lista) {
      const c0 = categoriaDe.get(m.modelo) ?? resto
      let c = porKey.get(c0.key)
      if (!c) { c = { ...c0, modelos: [], u: 0, imp: 0, promo: 0 }; porKey.set(c0.key, c); out.push(c) }
      c.modelos.push(m); c.u += m.u; c.imp += m.imp; if (m.promo > 0) c.promo++
    }
    // Especial Día de la Madre: los modelos con colores en promo aparecen además acá (siguen también en su categoría)
    const enPromoMods = lista.filter((m) => m.promo > 0)
    if (enPromoMods.length) out.push({ key: 'diamadre', nombre: secciones.find((s) => s.key === 'diamadre')?.nombre ?? 'Especial Día de la Madre',
      modelos: enPromoMods, u: enPromoMods.reduce((a, m) => a + m.u, 0), imp: enPromoMods.reduce((a, m) => a + m.imp, 0), promo: enPromoMods.length })
    const orden = new Map(secciones.map((s, i) => [s.key, i]))
    return out.sort((a, b) => (orden.get(a.key) ?? 999) - (orden.get(b.key) ?? 999))
  }, [lista, categoriaDe, secciones])

  // Plegado: todo cerrado de entrada (se ven solo las categorías). Al buscar un modelo, color o código,
  // o con "Solo cargados", se abren las categorías y modelos que coinciden; los demás filtros solo achican.
  const [catAb, setCatAb] = useState<Set<string>>(() => new Set())
  const [modAb, setModAb] = useState<Set<string>>(() => new Set())
  const catsRef = useRef(cats); catsRef.current = cats
  const abrirTodo = useCallback(() => {
    setCatAb(new Set(catsRef.current.map((c) => c.key)))
    setModAb(new Set(catsRef.current.flatMap((c) => c.modelos.map((m) => c.key + '|' + m.modelo))))
  }, [])
  const cerrarTodo = useCallback(() => { setCatAb(new Set()); setModAb(new Set()) }, [])
  const filtrando = !!(qn || seccion || clasif || trat || escala || soloCargados || sinProyectado)
  const abreSolo = !!(qn || soloCargados)
  useEffect(() => { if (abreSolo) abrirTodo(); else cerrarTodo() }, [qn, soloCargados, abreSolo, abrirTodo, cerrarTodo])
  const alternar = (set: React.Dispatch<React.SetStateAction<Set<string>>>, k: string) =>
    set((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n })

  // Navegación tipo Excel entre las celdas de cantidad
  // Los encabezados plegables ocupan el ancho visible (no el de la tabla): en el celu el subtotal queda a la vista
  const scrollRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const medir = () => el.style.setProperty('--ancho-tabla', el.clientWidth + 'px')
    medir()
    const ro = new ResizeObserver(medir); ro.observe(el)
    return () => ro.disconnect()
  }, [filas])
  const celdas = useRef<(HTMLInputElement | null)[]>([])
  const nCeldasRef = useRef(0)
  const ir = useCallback((idx: number) => {
    const el = celdas.current[Math.max(0, Math.min(nCeldasRef.current - 1, idx))]
    if (el) { el.focus(); el.select() }
  }, [])
  const onSet = useRef(onSetCant); onSet.current = onSetCant
  const cambiar = useCallback((f: FilaPlanilla, n: number) => {
    if (n > f.stock) { setTope(f.codigo); n = f.stock } else setTope((t) => (t === f.codigo ? null : t))
    onSet.current(f, Math.max(0, n))
  }, [])

  const filtrosActivos = filtrando
  const limpiar = () => { setQ(''); setSeccion(''); setClasif(''); setTrat(''); setEscala(''); setSoloCargados(false); setSinProyectado(false) }
  const nModelosCargados = useMemo(() => new Set(base.filter((f) => (cantidades[f.codigo] ?? 0) > 0).map((f) => f.modelo)).size, [base, cantidades])
  const cols = 9 - (sinPrecios ? 2 : 0)

  // Filas a dibujar: categoría → (abierta) sus modelos → (abierto) sus colores.
  // Los índices de navegación (Enter / flechas) cuentan solo las celdas de cantidad a la vista.
  // Los títulos de columna solo aparecen con algún modelo abierto: los encabezados pegajosos se corren según eso.
  const hayColores = cats.some((c) => catAb.has(c.key) && c.modelos.some((m) => modAb.has(c.key + '|' + m.modelo)))
  const topCat = hayColores ? 32 : 0
  const filasTabla: React.ReactNode[] = []
  let nCeldas = 0
  for (const c of cats) {
    const cAb = catAb.has(c.key)
    filasTabla.push(<FilaCategoria key={'c:' + c.key} c={c} abierto={cAb} cols={cols} top={topCat} sinPrecios={sinPrecios} onClick={() => alternar(setCatAb, c.key)} />)
    if (!cAb) continue
    for (const m of c.modelos) {
      // Un modelo puede estar en su categoría y en Día de la Madre: se abre / pliega en cada una por separado
      const k = c.key + '|' + m.modelo
      const abierto = modAb.has(k)
      filasTabla.push(
        <FilaModelo key={'m:' + k} m={m} abierto={abierto} cols={cols} top={topCat + 44} sinPrecios={sinPrecios} onClick={() => alternar(setModAb, k)}
          foto={fotosModelo?.[m.modelo] || m.filas.find((f) => f.imagen)?.imagen || null} />)
      if (abierto) for (const f of m.filas) filasTabla.push(
        <Fila key={c.key + '|' + f.codigo} f={f} idx={nCeldas++} cant={cantidades[f.codigo] ?? 0} sinPrecios={sinPrecios}
          promo={esPromo(f)} nov={preciosNov?.[f.codigo]} tope={tope === f.codigo} celdas={celdas} ir={ir} cambiar={cambiar} />)
    }
  }
  nCeldasRef.current = nCeldas

  return (
    <div className="fixed inset-0 z-40 bg-white flex flex-col orb-tienda text-[#0a0a0a]" role="dialog" aria-label="Carga masiva (planilla)">
      {/* Encabezado + filtros */}
      <div className="border-b border-black/10 shrink-0">
        <div className="max-w-7xl mx-auto px-4 pt-3 pb-2 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-bold tracking-[0.25em] uppercase text-[#0004FF]">Orbital® · Carga masiva</p>
            <h2 className="text-base font-bold leading-tight truncate">Planilla de carga</h2>
          </div>
          <button onClick={onClose} className="shrink-0 flex items-center gap-1 text-[12px] font-semibold rounded-full border border-black/15 px-3 py-1.5 hover:border-black/40">
            <X size={15} /> <span className="hidden sm:inline">Volver al catálogo</span>
          </button>
        </div>
        <div className="max-w-7xl mx-auto px-4 pb-2">
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar modelo, color o código…"
              className="w-full h-9 rounded-full bg-[#F5F5F7] border border-black/10 pl-9 pr-3 text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-[#0004FF]/30" />
          </div>
        </div>
        <div className="max-w-7xl mx-auto px-4 pb-2.5 flex gap-1.5 overflow-x-auto [scrollbar-width:none]">
          <Sel label="Sección" value={seccion} onChange={setSeccion}>
            <option value="">Todas las secciones</option>
            {opciones.secciones.map((s) => <option key={s.key} value={s.key}>{s.nombre}</option>)}
          </Sel>
          <Sel label="Clasificación" value={clasif} onChange={setClasif}>
            <option value="">Clasificación</option>
            {opciones.clasif.map((c) => <option key={c} value={c}>{cap(c)}</option>)}
          </Sel>
          <Sel label="Tratamiento" value={trat} onChange={setTrat}>
            <option value="">Tratamiento</option>
            {opciones.trat.map((c) => <option key={c} value={c}>{cap(c)}</option>)}
          </Sel>
          {!sinPrecios && (
            <Sel label="Escala de precio" value={escala} onChange={setEscala}>
              <option value="">Escala de precio</option>
              {opciones.escala.map((p) => <option key={p} value={p}>{kAr(p)}</option>)}
            </Sel>
          )}
          {([['Solo cargados', soloCargados, setSoloCargados], ['Sin proyectados', sinProyectado, setSinProyectado]] as const).map(([l, v, set]) => (
            <button key={l} onClick={() => set(!v)} aria-pressed={v}
              className={`shrink-0 h-9 rounded-full border px-3 text-[12px] font-medium whitespace-nowrap ${v ? 'bg-[#0a0a0a] text-white border-transparent' : 'bg-white border-black/10 text-neutral-700'}`}>
              {v ? '✓ ' : ''}{l}
            </button>
          ))}
          {filtrosActivos && <button onClick={limpiar} className="shrink-0 h-9 px-2 text-[12px] font-semibold text-[#0004FF] whitespace-nowrap">Limpiar filtros</button>}
        </div>
        <div className="max-w-7xl mx-auto px-4 pb-2 -mt-1 flex items-center gap-1 text-[12px]">
          <button onClick={abrirTodo} className="h-8 px-2 font-semibold text-[#0004FF] hover:bg-[#0004FF]/[0.06] whitespace-nowrap">Expandir todo</button>
          <span className="text-neutral-300">|</span>
          <button onClick={cerrarTodo} className="h-8 px-2 font-semibold text-[#0004FF] hover:bg-[#0004FF]/[0.06] whitespace-nowrap">Contraer todo</button>
          <span className="ml-auto text-[11px] text-neutral-400 truncate">{cats.length} categoría{cats.length !== 1 ? 's' : ''} · {lista.length} modelo{lista.length !== 1 ? 's' : ''}</span>
        </div>
      </div>

      {/* Tabla: el scroll (vertical y horizontal) es de la tabla, nunca de la página */}
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-auto overscroll-contain">
        {filas == null ? (
          <p className="text-sm text-neutral-500 text-center py-16">Cargando la planilla…</p>
        ) : error ? (
          <p className="text-sm text-red-600 text-center py-16">No pudimos cargar la planilla. Probá de nuevo en un momento.</p>
        ) : (
          <table className="w-full min-w-[760px] border-separate border-spacing-0 text-[12px]">
            {/* Los títulos de columna son de los colores: solo aparecen con algún modelo abierto */}
            <thead className={`${nCeldas ? '' : 'hidden '}sticky top-0 z-10 bg-[#F5F5F7] text-[10px] uppercase tracking-[0.12em] text-neutral-500`}>
              <tr className="[&>th]:font-semibold [&>th]:py-2 [&>th]:px-2 [&>th]:border-b [&>th]:border-black/10 [&>th]:text-left [&>th]:whitespace-nowrap">
                <th className="w-12 pl-4">Foto</th>
                <th>Color</th>
                <th className="w-[140px] !text-center">Cant.</th>
                {!sinPrecios && <th className="!text-right">Precio</th>}
                {!sinPrecios && <th className="!text-right">Subtotal</th>}
                <th>Disponib.</th>
                <th>Código</th>
                <th>Tratamiento</th>
                <th className="pr-4">Clasif.</th>
              </tr>
            </thead>
            <tbody>
              {visibles.length === 0 && (
                <tr><td colSpan={cols} className="text-center text-sm text-neutral-400 py-16">{filtrosActivos ? 'No hay colores con esos filtros.' : 'No hay colores con stock.'}</td></tr>
              )}
              {filasTabla}
            </tbody>
          </table>
        )}
      </div>

      {/* Totales siempre a la vista */}
      <div className="shrink-0 border-t border-black/10 bg-white pb-[env(safe-area-inset-bottom)]">
        <div className="max-w-7xl mx-auto px-4 py-2.5 flex items-center justify-between gap-3">
          <div className="min-w-0 leading-tight">
            <p className="text-[15px] font-bold tabular-nums">
              {cartCount.toLocaleString('es-AR')} u.
              {!sinPrecios && <span className="text-[#0004FF]"> · {kAr(cartTotal)}</span>}
              {!sinPrecios && <span className="text-[11px] font-normal text-neutral-400"> + IVA</span>}
            </p>
            <p className="text-[11px] text-neutral-500 truncate">
              {nModelosCargados} modelo{nModelosCargados !== 1 ? 's' : ''} · {visibles.length} de {base.length} colores
              <span className="hidden md:inline"> · Enter / ↑ ↓ para moverte · Tab salta de celda</span>
            </p>
          </div>
          <button onClick={onVerPedido} disabled={cartCount === 0}
            className="shrink-0 flex items-center gap-2 rounded-full bg-[#0004FF] text-white px-4 sm:px-5 py-2.5 text-[13px] font-bold disabled:opacity-40">
            <ShoppingCart size={15} /> <span className="sm:hidden">Ver pedido →</span><span className="hidden sm:inline">Ver pedido y enviar →</span>
          </button>
        </div>
      </div>
    </div>
  )
}

const SEL = 'shrink-0 h-9 rounded-full border bg-white pl-3 pr-7 text-[12px] font-medium appearance-none focus:outline-none focus:ring-2 focus:ring-[#0004FF]/30'
function Sel({ value, onChange, children, label }: { value: string; onChange: (v: string) => void; children: React.ReactNode; label: string }) {
  return (
    <label className="relative shrink-0">
      <span className="sr-only">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className={`${SEL} ${value ? 'border-[#0004FF] text-[#0004FF]' : 'border-black/10 text-neutral-700'}`}>{children}</select>
      <ChevronDown size={13} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-neutral-400" />
    </label>
  )
}

type Mod = { modelo: string; filas: FilaPlanilla[]; u: number; imp: number; desde: number; desdeNov: number; proy: number; promo: number }
type Cat = { key: string; nombre: string; modelos: Mod[]; u: number; imp: number; promo: number }
// Secciones que cruzan el catálogo: no son categoría de la planilla
const NO_CATEGORIA = new Set(['triple', 'diamadre', 'bajaluz'])

// Fila de categoría (barra negra, como los carteles de sección del catálogo): nombre, modelos y lo
// cargado adentro aunque esté cerrada. Tocándola se despliegan / pliegan sus modelos.
function FilaCategoria({ c, abierto, cols, top, sinPrecios, onClick }: {
  c: Cat; abierto: boolean; cols: number; top: number; sinPrecios: boolean; onClick: () => void
}) {
  return (
    <tr>
      <td colSpan={cols} className={`p-0 ${c.key === 'diamadre' ? 'bg-pink-600' : 'bg-[#0a0a0a]'} text-white border-b border-white/15 ${abierto ? 'sticky z-[6]' : ''}`} style={abierto ? { top } : undefined}>
        <button type="button" tabIndex={-1} onClick={onClick} aria-expanded={abierto}
          className={`sticky left-0 w-[var(--ancho-tabla,100%)] flex items-center gap-2.5 text-left px-3 sm:px-4 hover:bg-white/[0.06] ${abierto ? 'h-11' : 'min-h-11 py-2'}`}>
          <ChevronDown size={18} className={`shrink-0 transition-transform ${abierto ? '' : '-rotate-90'} opacity-80`} />
          <span className="min-w-0 flex-1">
            <span className="flex items-baseline gap-1.5 min-w-0">
              <span className="truncate font-bold uppercase text-[12px] sm:text-[13px] tracking-[0.16em]">{c.nombre}</span>
              <span className="shrink-0 text-[11px] text-white/55">· {c.modelos.length} modelo{c.modelos.length !== 1 ? 's' : ''}</span>
            </span>
            {/* Cerrada: los nombres de sus modelos (los de Día de la Madre en rosa) */}
            {!abierto && (
              <span className="block truncate text-[11px] text-white/60 mt-0.5 tracking-wide">
                {c.modelos.map((m, i) => (
                  <span key={m.modelo}>{i > 0 && ' · '}<span className={m.promo > 0 && c.key !== 'diamadre' ? 'text-pink-300' : m.u > 0 ? 'text-white font-semibold' : ''}>{m.modelo}</span></span>
                ))}
              </span>
            )}
          </span>
          {c.promo > 0 && c.key !== 'diamadre' && (
            <span className="shrink-0 text-[10px] font-bold whitespace-nowrap px-1.5 py-1 bg-pink-600 text-white">♥ {c.promo} en promo<span className="hidden sm:inline"> Día de la Madre</span></span>
          )}
          {c.u > 0 && (
            <span className="shrink-0 tabular-nums text-[12px] font-bold whitespace-nowrap px-2 py-1 bg-[#0004FF] text-white">
              {c.u} u.{!sinPrecios && <span className="font-semibold"> · {kAr(c.imp)}</span>}
            </span>
          )}
        </button>
      </td>
    </tr>
  )
}

// Fila de modelo: foto de referencia (la tapa del catálogo), nombre, colores, precio desde,
// disponibilidad y lo cargado. Tocando cualquier parte se despliegan / pliegan sus colores debajo.
// Ocupa el ancho visible (no el de la tabla): en el celu es una tarjeta entera, sin scroll lateral.
// Fuera del orden de Tab: Tab salta solo entre las celdas de cantidad, como en Excel.
function FilaModelo({ m, abierto, cols, top, foto, sinPrecios, onClick }: {
  m: Mod; abierto: boolean; cols: number; top: number; foto: string | null; sinPrecios: boolean; onClick: () => void
}) {
  const disp = m.filas.length - m.proy
  // ¿El modelo sube el 1/11? (desde de noviembre ≥ 2% sobre el desde de hoy)
  const sube = !sinPrecios && m.desde > 0 && m.desdeNov >= m.desde * 1.02
  const cargado = m.u > 0 && (
    <span className="shrink-0 tabular-nums text-[12px] font-bold whitespace-nowrap px-2 py-1 bg-[#0004FF] text-white">
      {m.u} u.{!sinPrecios && <span className="font-semibold"> · {kAr(m.imp)}</span>}
    </span>
  )
  return (
    <tr>
      <td colSpan={cols} className={`p-0 border-t-2 border-t-black/25 border-b ${abierto ? 'sticky z-[5] bg-white border-b-[#0004FF]/30' : 'border-b-black/10'}`} style={abierto ? { top } : undefined}>
        <button type="button" tabIndex={-1} onClick={onClick} aria-expanded={abierto}
          className={`sticky left-0 w-[var(--ancho-tabla,100%)] flex items-center gap-3 text-left px-3 sm:px-4 py-2.5 border-l-[3px] transition-colors
            ${abierto ? 'bg-[#0004FF]/[0.05] border-l-[#0004FF]' : m.u > 0 ? 'border-l-[#0004FF] hover:bg-[#F5F5F7]' : m.promo > 0 ? 'border-l-pink-500 bg-pink-50 hover:bg-pink-100/70' : 'border-l-transparent hover:bg-[#F5F5F7]'}`}>
          <span className="shrink-0 w-[92px] h-[62px] sm:w-[120px] sm:h-[76px] bg-[#F2F2F2] overflow-hidden flex items-center justify-center">
            {foto && <img src={foto} alt={m.modelo} loading="lazy" decoding="async" className="w-full h-full object-contain"
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />}
          </span>
          <span className="min-w-0 flex-1">
            <span className={`block truncate font-bold uppercase text-[14px] sm:text-[15px] tracking-wide leading-tight ${m.promo > 0 ? 'text-pink-700' : ''}`}>{m.modelo}</span>
            <span className="block truncate text-[12px] text-neutral-500 mt-0.5">
              {m.filas.length} color{m.filas.length !== 1 ? 'es' : ''}{!sinPrecios && m.desde ? <> · desde <b className="text-[#0a0a0a]">{kAr(m.desde)}</b></> : null}
            </span>
            <span className="flex flex-wrap items-center gap-1 mt-1">
              {m.promo > 0 && <span className="text-[10px] font-bold text-white bg-pink-600 px-1.5 py-0.5">♥ Día de la Madre{m.promo < m.filas.length ? ` · ${m.promo} color${m.promo !== 1 ? 'es' : ''}` : ''}</span>}
              {disp > 0 && <span className="text-[10px] font-semibold text-emerald-700 bg-emerald-50 px-1.5 py-0.5">{disp} disponible{disp !== 1 ? 's' : ''}</span>}
              {m.proy > 0 && <span className="text-[10px] font-semibold text-[#b45309] bg-[#fdf0dd] px-1.5 py-0.5">📅 {m.proy} proyectado{m.proy !== 1 ? 's' : ''}</span>}
              <span className="sm:hidden">{cargado}</span>
            </span>
            {sube && (
              <span className="md:hidden block truncate text-[11px] font-semibold text-[#0004FF] mt-1">
                🔒 Asegurá {kAr(m.desde)} hoy · el 1/11 sube a {kAr(m.desdeNov)}
              </span>
            )}
          </span>
          {/* Nota comercial del aumento de noviembre (solo en la fila del modelo) */}
          {sube && (
            <span className="hidden md:block shrink-0 border border-[#0004FF]/30 bg-white px-3 py-1.5 text-right leading-tight">
              <span className="block text-[9px] font-bold uppercase tracking-[0.18em] text-[#0004FF]">Precio de octubre</span>
              <span className="block text-[12px] text-[#0a0a0a] mt-0.5">Asegurá <b>{kAr(m.desde)}</b> hoy</span>
              <span className="block text-[10px] text-neutral-500 mt-0.5">Desde el 1/11 sube a <b className="text-neutral-700">{kAr(m.desdeNov)}</b> (+{Math.round((m.desdeNov / m.desde - 1) * 100)}%)</span>
            </span>
          )}
          <span className="hidden sm:inline-flex">{cargado}</span>
          <span className={`shrink-0 hidden sm:inline text-[11px] font-semibold ${abierto ? 'text-[#0004FF]' : 'text-neutral-400'}`}>{abierto ? 'Ocultar colores' : 'Ver colores'}</span>
          <ChevronDown size={18} className={`shrink-0 transition-transform ${abierto ? 'rotate-180 text-[#0004FF]' : 'text-neutral-400'}`} />
        </button>
      </td>
    </tr>
  )
}

const Fila = memo(function Fila({ f, idx, cant, sinPrecios, promo, nov, tope, celdas, ir, cambiar }: {
  f: FilaPlanilla; idx: number; cant: number; sinPrecios: boolean; promo: boolean; nov?: number; tope: boolean
  celdas: React.MutableRefObject<(HTMLInputElement | null)[]>; ir: (i: number) => void
  cambiar: (f: FilaPlanilla, n: number) => void
}) {
  const color = colorLegible(f.descripcion) || f.descripcion || f.codigo
  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === 'ArrowDown') { e.preventDefault(); ir(idx + (e.key === 'Enter' && e.shiftKey ? -1 : 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); ir(idx - 1) }
    else if (e.key === 'Escape') (e.target as HTMLInputElement).blur()
    else if (e.key === '+' || e.key === '-') { e.preventDefault(); cambiar(f, cant + (e.key === '+' ? 1 : -1)) }
  }
  const td = 'px-2 py-1.5 border-b border-black/5 align-middle'
  return (
    <tr className={`${cant > 0 ? 'bg-[#0004FF]/[0.04]' : promo ? 'bg-pink-50 hover:bg-pink-100/70' : 'hover:bg-[#F5F5F7]'} focus-within:bg-[#0004FF]/[0.07]`}>
      <td className={`${td} pl-4`}>
        <div className="w-10 h-10 bg-[#F2F2F2] overflow-hidden flex items-center justify-center" style={f.imagen ? undefined : { background: colorSwatch(f.descripcion) }}>
          {f.imagen && <img src={f.imagen} alt="" loading="lazy" decoding="async" className="w-full h-full object-contain"
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />}
        </div>
      </td>
      <td className={`${td} min-w-[160px]`}>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-full border border-black/10 shrink-0" style={{ background: colorSwatch(f.descripcion) }} />
          <span className="leading-tight">{color}</span>
          {/infrarrojo/i.test(f.tratamiento || "") && <span className="shrink-0 bg-[#0004FF] text-white text-[8px] font-bold rounded-full px-1.5 py-0.5 tracking-wide whitespace-nowrap">TRIPLE PROT.</span>}
        </span>
      </td>
      <td className={`${td} text-center`}>
        {/* − número + : los botones quedan fuera del Tab (Tab / Enter / flechas van de número en número) */}
        <div className="inline-flex items-stretch">
          <button type="button" tabIndex={-1} onClick={() => cambiar(f, cant - 1)} disabled={cant <= 0} aria-label={`Restar ${f.modelo} ${color}`}
            className="w-9 h-9 border border-r-0 border-black/15 bg-white flex items-center justify-center text-neutral-700 hover:bg-[#F5F5F7] active:bg-[#0004FF]/10 disabled:text-neutral-300 disabled:hover:bg-white">
            <Minus size={15} />
          </button>
          <input
            ref={(el) => { celdas.current[idx] = el }}
            value={cant || ''}
            onChange={(e) => { const n = parseInt(e.target.value.replace(/\D/g, ''), 10); cambiar(f, isNaN(n) ? 0 : n) }}
            onFocus={(e) => e.target.select()}
            onKeyDown={onKey}
            inputMode="numeric" enterKeyHint="next" autoComplete="off" aria-label={`Cantidad ${f.modelo} ${color}`}
            placeholder="0"
            className={`w-12 h-9 text-center text-[14px] font-bold tabular-nums border bg-white placeholder:text-neutral-300 placeholder:font-normal focus:outline-none focus:ring-2 focus:ring-[#0004FF]/50 focus:border-[#0004FF] focus:relative [scroll-margin-top:170px] [scroll-margin-bottom:12px] ${tope ? 'border-red-500' : cant > 0 ? 'border-[#0004FF]' : 'border-black/15'}`} />
          <button type="button" tabIndex={-1} onClick={() => cambiar(f, cant + 1)} disabled={cant >= f.stock} aria-label={`Sumar ${f.modelo} ${color}`}
            className="w-9 h-9 border border-l-0 border-black/15 bg-white flex items-center justify-center text-[#0004FF] hover:bg-[#0004FF]/[0.06] active:bg-[#0004FF]/10 disabled:text-neutral-300 disabled:hover:bg-white">
            <Plus size={15} />
          </button>
        </div>
        {(tope || (cant > 0 && cant >= f.stock)) && <p className="text-[9px] text-red-600 font-semibold mt-0.5 whitespace-nowrap">{f.proyectado ? 'máx. proyectado' : 'máx. disponible'}</p>}
      </td>
      {!sinPrecios && (
        <td className={`${td} text-right whitespace-nowrap tabular-nums`}>
          {promo && <span className="block text-[10px] text-neutral-400 line-through leading-none">{kAr(f.precio_lista)}</span>}
          <span className={`font-semibold ${promo ? 'text-pink-700' : ''}`}>{kAr(f.precio)}</span>
        </td>
      )}
      {!sinPrecios && <td className={`${td} text-right whitespace-nowrap tabular-nums font-semibold ${cant ? 'text-[#0004FF]' : 'text-neutral-300'}`}>{cant ? kAr(cant * f.precio) : '—'}</td>}
      <td className={`${td} whitespace-nowrap`}>
        {f.proyectado
          ? <span className="text-[10px] font-semibold text-[#b45309] bg-[#fdf0dd] px-1.5 py-0.5">📅 Proyectado</span>
          : <span className="text-[10px] font-semibold text-emerald-700 bg-emerald-50 px-1.5 py-0.5">Disponible</span>}
      </td>
      <td className={`${td} font-mono text-[11px] text-neutral-500 whitespace-nowrap`}>{f.codigo}</td>
      <td className={`${td} whitespace-nowrap text-neutral-600`}>{cap(f.tratamiento) || '—'}</td>
      <td className={`${td} pr-4 whitespace-nowrap text-neutral-600`}>{cap(f.clasificacion) || '—'}</td>
    </tr>
  )
})
