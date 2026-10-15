import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Search, X, ShoppingCart, ChevronDown } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { colorLegible, colorSwatch } from './colorLegible'

// ── Pedido grande (planilla) ──────────────────────────────────────────────────
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

export default function PedidoPlanilla({ clave, sinPrecios, modelos, secciones, cantidades, cartCount, cartTotal, esPromo, onSetCant, onVerPedido, onClose }: Props) {
  const [filas, setFilas] = useState<FilaPlanilla[] | null>(null)
  const [error, setError] = useState(false)
  const [q, setQ] = useState('')
  const [seccion, setSeccion] = useState('')
  const [clasif, setClasif] = useState('')
  const [trat, setTrat] = useState('')
  const [escala, setEscala] = useState('')
  const [soloCargados, setSoloCargados] = useState(false)
  const [sinProyectado, setSinProyectado] = useState(false)
  const [agrupar, setAgrupar] = useState(true)
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

  // Grupos por modelo con subtotales (se calculan sobre las filas visibles)
  const grupos = useMemo(() => {
    const out: { modelo: string; filas: { f: FilaPlanilla; idx: number }[]; u: number; imp: number }[] = []
    visibles.forEach((f, idx) => {
      let g = out[out.length - 1]
      if (!g || g.modelo !== f.modelo) { g = { modelo: f.modelo, filas: [], u: 0, imp: 0 }; out.push(g) }
      const c = cantidades[f.codigo] ?? 0
      g.filas.push({ f, idx }); g.u += c; g.imp += c * f.precio
    })
    return out
  }, [visibles, cantidades])

  // Navegación tipo Excel entre las celdas de cantidad
  const celdas = useRef<(HTMLInputElement | null)[]>([])
  const ir = useCallback((idx: number) => {
    const el = celdas.current[idx]
    if (el) { el.focus(); el.select() }
  }, [])
  const onSet = useRef(onSetCant); onSet.current = onSetCant
  const cambiar = useCallback((f: FilaPlanilla, n: number) => {
    if (n > f.stock) { setTope(f.codigo); n = f.stock } else setTope((t) => (t === f.codigo ? null : t))
    onSet.current(f, Math.max(0, n))
  }, [])

  const filtrosActivos = !!(qn || seccion || clasif || trat || escala || soloCargados || sinProyectado)
  const limpiar = () => { setQ(''); setSeccion(''); setClasif(''); setTrat(''); setEscala(''); setSoloCargados(false); setSinProyectado(false) }
  const nModelosCargados = useMemo(() => new Set(base.filter((f) => (cantidades[f.codigo] ?? 0) > 0).map((f) => f.modelo)).size, [base, cantidades])
  const cols = (agrupar ? 9 : 10) - (sinPrecios ? 2 : 0)

  return (
    <div className="fixed inset-0 z-40 bg-white flex flex-col orb-tienda text-[#0a0a0a]" role="dialog" aria-label="Pedido grande (planilla)">
      {/* Encabezado + filtros */}
      <div className="border-b border-black/10 shrink-0">
        <div className="max-w-7xl mx-auto px-4 pt-3 pb-2 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-bold tracking-[0.25em] uppercase text-[#0004FF]">Orbital® · Pedido grande</p>
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
          {([['Agrupar por modelo', agrupar, setAgrupar], ['Solo cargados', soloCargados, setSoloCargados], ['Sin proyectados', sinProyectado, setSinProyectado]] as const).map(([l, v, set]) => (
            <button key={l} onClick={() => set(!v)} aria-pressed={v}
              className={`shrink-0 h-9 rounded-full border px-3 text-[12px] font-medium whitespace-nowrap ${v ? 'bg-[#0a0a0a] text-white border-transparent' : 'bg-white border-black/10 text-neutral-700'}`}>
              {v ? '✓ ' : ''}{l}
            </button>
          ))}
          {filtrosActivos && <button onClick={limpiar} className="shrink-0 h-9 px-2 text-[12px] font-semibold text-[#0004FF] whitespace-nowrap">Limpiar filtros</button>}
        </div>
      </div>

      {/* Tabla: el scroll (vertical y horizontal) es de la tabla, nunca de la página */}
      <div className="flex-1 min-h-0 overflow-auto overscroll-contain">
        {filas == null ? (
          <p className="text-sm text-neutral-500 text-center py-16">Cargando la planilla…</p>
        ) : error ? (
          <p className="text-sm text-red-600 text-center py-16">No pudimos cargar la planilla. Probá de nuevo en un momento.</p>
        ) : (
          <table className="w-full min-w-[760px] border-separate border-spacing-0 text-[12px]">
            <thead className="sticky top-0 z-10 bg-[#F5F5F7] text-[10px] uppercase tracking-[0.12em] text-neutral-500">
              <tr className="[&>th]:font-semibold [&>th]:py-2 [&>th]:px-2 [&>th]:border-b [&>th]:border-black/10 [&>th]:text-left [&>th]:whitespace-nowrap">
                <th className="w-12 pl-4">Foto</th>
                {!agrupar && <th>Modelo</th>}
                <th>Color</th>
                <th className="w-[84px] !text-center">Cant.</th>
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
              {grupos.map((g) => (
                <GrupoFilas key={g.modelo} g={g} agrupar={agrupar} cols={cols} sinPrecios={sinPrecios}
                  cantidades={cantidades} tope={tope} esPromo={esPromo} celdas={celdas} ir={ir} total={visibles.length} cambiar={cambiar} />
              ))}
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

type Grupo = { modelo: string; filas: { f: FilaPlanilla; idx: number }[]; u: number; imp: number }
function GrupoFilas({ g, agrupar, cols, sinPrecios, cantidades, tope, esPromo, celdas, ir, total, cambiar }: {
  g: Grupo; agrupar: boolean; cols: number; sinPrecios: boolean; cantidades: Record<string, number>; tope: string | null
  esPromo: (f: FilaPlanilla) => boolean; celdas: React.MutableRefObject<(HTMLInputElement | null)[]>; ir: (i: number) => void; total: number
  cambiar: (f: FilaPlanilla, n: number) => void
}) {
  return (
    <>
      {agrupar && (
        <tr>
          <td colSpan={cols} className="sticky top-[33px] z-[5] bg-white border-b border-black/10 px-4 pt-3 pb-1.5">
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-[13px] font-bold uppercase tracking-wide">{g.modelo} <span className="text-[11px] font-normal normal-case tracking-normal text-neutral-400">· {g.filas.length} color{g.filas.length !== 1 ? 'es' : ''}</span></p>
              {g.u > 0 && (
                <p className="text-[12px] font-semibold tabular-nums whitespace-nowrap">
                  {g.u} u.{!sinPrecios && <span className="text-[#0004FF]"> · {kAr(g.imp)}</span>}
                </p>
              )}
            </div>
          </td>
        </tr>
      )}
      {g.filas.map(({ f, idx }) => (
        <Fila key={f.codigo} f={f} idx={idx} cant={cantidades[f.codigo] ?? 0} agrupar={agrupar} sinPrecios={sinPrecios}
          promo={esPromo(f)} tope={tope === f.codigo} celdas={celdas} ir={ir} total={total} cambiar={cambiar} />
      ))}
    </>
  )
}

const Fila = memo(function Fila({ f, idx, cant, agrupar, sinPrecios, promo, tope, celdas, ir, total, cambiar }: {
  f: FilaPlanilla; idx: number; cant: number; agrupar: boolean; sinPrecios: boolean; promo: boolean; tope: boolean
  celdas: React.MutableRefObject<(HTMLInputElement | null)[]>; ir: (i: number) => void; total: number
  cambiar: (f: FilaPlanilla, n: number) => void
}) {
  const color = colorLegible(f.descripcion) || f.descripcion || f.codigo
  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === 'ArrowDown') { e.preventDefault(); ir(Math.min(total - 1, idx + (e.key === 'Enter' && e.shiftKey ? -1 : 1))) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); ir(Math.max(0, idx - 1)) }
    else if (e.key === 'Escape') (e.target as HTMLInputElement).blur()
    else if (e.key === '+' || e.key === '-') { e.preventDefault(); cambiar(f, cant + (e.key === '+' ? 1 : -1)) }
  }
  const td = 'px-2 py-1.5 border-b border-black/5 align-middle'
  return (
    <tr className={`${cant > 0 ? 'bg-[#0004FF]/[0.04]' : 'hover:bg-[#F5F5F7]'} focus-within:bg-[#0004FF]/[0.07]`}>
      <td className={`${td} pl-4`}>
        <div className="w-10 h-10 bg-[#F2F2F2] overflow-hidden flex items-center justify-center" style={f.imagen ? undefined : { background: colorSwatch(f.descripcion) }}>
          {f.imagen && <img src={f.imagen} alt="" loading="lazy" decoding="async" className="w-full h-full object-contain"
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />}
        </div>
      </td>
      {!agrupar && <td className={`${td} font-semibold whitespace-nowrap`}>{f.modelo}</td>}
      <td className={`${td} min-w-[160px]`}>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-full border border-black/10 shrink-0" style={{ background: colorSwatch(f.descripcion) }} />
          <span className="leading-tight">{color}</span>
        </span>
      </td>
      <td className={`${td} text-center`}>
        <input
          ref={(el) => { celdas.current[idx] = el }}
          value={cant || ''}
          onChange={(e) => { const n = parseInt(e.target.value.replace(/\D/g, ''), 10); cambiar(f, isNaN(n) ? 0 : n) }}
          onFocus={(e) => e.target.select()}
          onKeyDown={onKey}
          inputMode="numeric" enterKeyHint="next" autoComplete="off" aria-label={`Cantidad ${f.modelo} ${color}`}
          placeholder="0"
          className={`w-16 h-8 text-center text-[13px] font-bold tabular-nums border bg-white placeholder:text-neutral-300 placeholder:font-normal focus:outline-none focus:ring-2 focus:ring-[#0004FF]/50 focus:border-[#0004FF] [scroll-margin-top:84px] [scroll-margin-bottom:12px] ${tope ? 'border-red-500' : cant > 0 ? 'border-[#0004FF]' : 'border-black/15'}`} />
        {tope && <p className="text-[9px] text-red-600 font-semibold mt-0.5 whitespace-nowrap">{f.proyectado ? 'máx. proyectado' : 'máx. disponible'}</p>}
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
