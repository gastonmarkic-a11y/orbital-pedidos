import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Search, X, ShoppingCart, ChevronDown, ChevronRight, Minus, Plus, SlidersHorizontal, Download } from 'lucide-react'
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

// Miniatura: las fotos del CDN de Shopify se piden al ancho que se muestran (más nítidas y livianas)
const mini = (url: string | null | undefined, w: number) => !url ? null : /cdn\.shopify\.com/.test(url) ? url.split('?')[0] + '?width=' + w : url
const kAr = (n: number) => '$' + Math.round(n).toLocaleString('es-AR')
const cap = (s: string | null) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '')

interface Props {
  clave: string
  sinPrecios: boolean
  /** Descarga de la planilla en Excel (solo clientes habilitados): disponibilidad sin cantidades */
  descargaExcel?: { nombre: string }
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

export default function PedidoPlanilla({ clave, sinPrecios, descargaExcel,modelos, fotosModelo, preciosNov, secciones, cantidades, cartCount, cartTotal, esPromo, onSetCant, onVerPedido, onClose }: Props) {
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

  // Fotos de la tienda (orbitaleyewear.com.ar): la foto principal de cada producto, la mejor que hay.
  // Por SKU (para cada color) y por modelo (de sol primero, para la foto de referencia).
  const [tienda, setTienda] = useState<{ sku: Record<string, string>; modelo: Record<string, string> }>({ sku: {}, modelo: {} })
  useEffect(() => {
    supabase.rpc('catalogo_fotos_tienda', { p_clave: clave }).then(({ data }) => {
      const sku: Record<string, string> = {}, modelo: Record<string, string> = {}
      for (const r of (data as { modelo: string; sku: string | null; tipo: string | null; imagen: string }[]) ?? []) {
        if (r.sku && !sku[r.sku]) sku[r.sku] = r.imagen
        if (!modelo[r.modelo] && r.tipo === 'SOL') modelo[r.modelo] = r.imagen
      }
      setTienda({ sku, modelo })
    })
  }, [clave])
  const fotoColor = useCallback((f: FilaPlanilla) => tienda.sku[f.codigo] || f.imagen, [tienda])

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

  // Excel de carga masiva: todos los SKU del link (sin filtros), por categoría y modelo, con una columna
  // Cantidad vacía para completar. Nunca va el número de stock: solo "Disponible" (en rojo si quedan
  // menos de 12) o "Proyectado". xlsx-js-style se carga recién al tocar el botón.
  const [bajando, setBajando] = useState(false)
  const bajarExcel = async () => {
    if (!descargaExcel || bajando) return
    setBajando(true)
    try {
      const XLSX = (await import('xlsx-js-style')).default
      const ordenSec = new Map(secciones.map((s, i) => [s.key, i]))
      const resto = { key: 'oportunidades', nombre: secciones.find((s) => s.key === 'oportunidades')?.nombre ?? 'Oportunidades' }
      const cat = (f: FilaPlanilla) => categoriaDe.get(f.modelo) ?? resto
      const filasX = [...base].sort((a, b) => (ordenSec.get(cat(a).key) ?? 999) - (ordenSec.get(cat(b).key) ?? 999))
      const enc = ['Categoría', 'Modelo', 'Color', 'Código', 'Tipo', 'Tratamiento', ...(sinPrecios ? [] : ['Precio s/IVA']), 'Disponibilidad', 'Cantidad']
      const hoy = new Date().toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })
      const aoa: (string | number | null)[][] = [
        [`Orbital · Carga masiva · ${descargaExcel.nombre} · ${hoy}`],
        ['Disponible en rojo: quedan menos de 12 unidades. Proyectado: en producción, todavía no llegó.'],
        [],
        enc,
        ...filasX.map((f) => [cat(f).nombre, f.modelo, colorLegible(f.descripcion) || f.descripcion || '', f.codigo, cap(f.tipo), cap(f.tratamiento),
          ...(sinPrecios ? [] : [f.precio || null]), f.proyectado ? 'Proyectado' : 'Disponible', null]),
      ]
      const ws = XLSX.utils.aoa_to_sheet(aoa)
      const cDisp = enc.indexOf('Disponibilidad'), cPrecio = enc.indexOf('Precio s/IVA'), cCant = enc.indexOf('Cantidad')
      const borde = { bottom: { style: 'thin', color: { rgb: 'E4E4E7' } } }
      ws['A1'].s = { font: { bold: true, sz: 14 } }
      ws['A2'].s = { font: { italic: true, color: { rgb: '71717A' } } }
      enc.forEach((_, c) => { ws[XLSX.utils.encode_cell({ r: 3, c })].s = { font: { bold: true, color: { rgb: 'FFFFFF' } }, fill: { fgColor: { rgb: '0004FF' } }, alignment: { horizontal: 'center' } } })
      filasX.forEach((f, i) => {
        const r = i + 4
        for (let c = 0; c < enc.length; c++) {
          const ref = XLSX.utils.encode_cell({ r, c })
          ws[ref] ??= { t: 's', v: '' }
          ws[ref].s = { border: borde }
        }
        ws[XLSX.utils.encode_cell({ r, c: cDisp })].s = f.proyectado
          ? { border: borde, font: { color: { rgb: 'B45309' } } }
          : f.stock < 12
            ? { border: borde, font: { bold: true, color: { rgb: 'FFFFFF' } }, fill: { fgColor: { rgb: 'DC2626' } } }
            : { border: borde, font: { color: { rgb: '059669' } } }
        if (cPrecio >= 0) ws[XLSX.utils.encode_cell({ r, c: cPrecio })].z = '"$"#,##0'
        ws[XLSX.utils.encode_cell({ r, c: cCant })].s = { border: borde, fill: { fgColor: { rgb: 'FFFBEB' } } }
      })
      const anchos: Record<string, number> = { Categoría: 22, Modelo: 18, Color: 30, Código: 16, Tipo: 10, Tratamiento: 16, 'Precio s/IVA': 13, Disponibilidad: 15, Cantidad: 11 }
      ws['!cols'] = enc.map((h) => ({ wch: anchos[h] ?? 12 }))
      ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: enc.length - 1 } }, { s: { r: 1, c: 0 }, e: { r: 1, c: enc.length - 1 } }]
      ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 3, c: 0 }, e: { r: 3 + filasX.length, c: enc.length - 1 } }) }
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, 'Carga masiva')
      const slug = descargaExcel.nombre.toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
      XLSX.writeFile(wb, `orbital-carga-masiva-${slug}-${new Date().toISOString().slice(0, 10)}.xlsx`)
    } finally { setBajando(false) }
  }

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
    // Ancho visible de la columna centrada (max-w-6xl = 1152 px), no el de la tabla
    const medir = () => el.style.setProperty('--ancho-tabla', Math.min(el.clientWidth, 1152) + 'px')
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
  const cols = 7 - (sinPrecios ? 2 : 0)
  // Filtros: en el celu se abren con el botón "Filtros"; los títulos de columna solo van en compu
  const [verFiltros, setVerFiltros] = useState(false)
  const [esCompu, setEsCompu] = useState(() => typeof window !== 'undefined' && window.matchMedia('(min-width: 768px)').matches)
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)')
    const f = () => setEsCompu(mq.matches)
    mq.addEventListener('change', f)
    return () => mq.removeEventListener('change', f)
  }, [])

  // Filas a dibujar: categoría → (abierta) sus modelos → (abierto) sus colores.
  // Los índices de navegación (Enter / flechas) cuentan solo las celdas de cantidad a la vista.
  // Los títulos de columna (solo en compu y con algún modelo abierto) corren los encabezados pegajosos.
  const hayColores = cats.some((c) => catAb.has(c.key) && c.modelos.some((m) => modAb.has(c.key + '|' + m.modelo)))
  const conTitulos = hayColores && esCompu
  const topCat = conTitulos ? ALTO_TITULOS : 0
  // Foto de referencia del modelo: la de la tienda del mismo color que la tapa del catálogo; si no, la primera
  // de sus colores que está en la tienda; si no, la de sol de la tienda; si no, la tapa del catálogo.
  const fotoDe = (m: Mod) => {
    const tapa = fotosModelo?.[m.modelo]
    const colorTapa = tapa ? m.filas.find((f) => f.imagen === tapa) : undefined
    return (colorTapa && tienda.sku[colorTapa.codigo]) || m.filas.map((f) => tienda.sku[f.codigo]).find(Boolean)
      || tienda.modelo[m.modelo] || tapa || m.filas.find((f) => f.imagen)?.imagen || null
  }
  const filasTabla: React.ReactNode[] = []
  let nCeldas = 0
  for (const c of cats) {
    const cAb = catAb.has(c.key)
    filasTabla.push(<FilaCategoria key={'c:' + c.key} c={c} abierto={cAb} cols={cols} top={topCat} sinPrecios={sinPrecios}
      onClick={() => alternar(setCatAb, c.key)} />)
    if (!cAb) continue
    for (const m of c.modelos) {
      // Un modelo puede estar en su categoría y en Día de la Madre: se abre / pliega en cada una por separado
      const k = c.key + '|' + m.modelo
      const abierto = modAb.has(k)
      filasTabla.push(
        <FilaModelo key={'m:' + k} m={m} abierto={abierto} cols={cols} top={topCat + ALTO_CATEGORIA} sinPrecios={sinPrecios}
          onClick={() => alternar(setModAb, k)} foto={fotoDe(m)} />)
      if (abierto) for (const f of m.filas) filasTabla.push(
        <Fila key={c.key + '|' + f.codigo} f={f} foto={fotoColor(f)} idx={nCeldas++} cant={cantidades[f.codigo] ?? 0} sinPrecios={sinPrecios}
          promo={esPromo(f)} tope={tope === f.codigo} celdas={celdas} ir={ir} cambiar={cambiar} />)
    }
  }
  nCeldasRef.current = nCeldas
  const nFiltros = [seccion, clasif, trat, escala].filter(Boolean).length + (soloCargados ? 1 : 0) + (sinProyectado ? 1 : 0)

  return (
    <div className="fixed inset-0 z-40 bg-white flex flex-col orb-tienda text-[#0a0a0a]" role="dialog" aria-label="Carga masiva (planilla)">
      {/* Encabezado: título, buscador y filtros (en el celu, detrás de "Filtros") */}
      <div className="border-b border-black/[0.08] shrink-0">
        <div className="max-w-6xl mx-auto px-4 pt-3 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-[16px] font-semibold leading-tight !normal-case tracking-tight">Carga masiva</h2>
            <p className="text-[12px] text-neutral-500 leading-tight mt-0.5">{lista.length} modelos · {visibles.length} colores<span className="hidden sm:inline"> · tocá una categoría para empezar</span></p>
          </div>
          {descargaExcel && (
            <button onClick={bajarExcel} disabled={bajando || !filas?.length} className="ml-auto shrink-0 h-9 flex items-center gap-1.5 text-[13px] font-medium text-[#0004FF] px-2.5 rounded-md border border-[#0004FF]/30 hover:bg-[#0004FF]/5 disabled:opacity-40">
              <Download size={16} /> <span className="hidden sm:inline">{bajando ? 'Armando…' : 'Descargar Excel'}</span><span className="sm:hidden">Excel</span>
            </button>
          )}
          <button onClick={onClose} aria-label="Volver al catálogo"className="shrink-0 h-9 flex items-center gap-1.5 text-[13px] font-medium text-neutral-600 px-2.5 rounded-md hover:bg-[#F4F4F5]">
            <X size={18} /> <span className="hidden sm:inline">Volver al catálogo</span>
          </button>
        </div>
        <div className="max-w-6xl mx-auto px-4 pt-3 pb-3 flex items-center gap-2">
          <div className="relative flex-1 min-w-0">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar modelo, color o código"
              className="w-full h-10 rounded-md bg-[#F4F4F5] border border-transparent pl-9 pr-3 text-base sm:text-[14px] placeholder:text-neutral-400 focus:outline-none focus:bg-white focus:border-black/10 focus:ring-2 focus:ring-[#0004FF]/30" />
          </div>
          <button onClick={() => setVerFiltros((v) => !v)} aria-expanded={verFiltros}
            className={`md:hidden shrink-0 h-10 flex items-center gap-1.5 px-3 rounded-md border text-[13px] font-medium ${nFiltros ? 'border-[#0004FF] text-[#0004FF]' : 'border-black/10 text-neutral-700'}`}>
            <SlidersHorizontal size={15} /> Filtros{nFiltros ? ` · ${nFiltros}` : ''}
          </button>
        </div>
        <div className={`${verFiltros ? 'flex' : 'hidden'} md:flex max-w-6xl mx-auto px-4 pb-3 flex-wrap items-center gap-2`}>
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
              className={`h-8 rounded-full border px-3 text-[12px] font-medium whitespace-nowrap transition-colors ${v ? 'bg-[#0a0a0a] text-white border-transparent' : 'bg-white border-black/10 text-neutral-700 hover:border-black/25'}`}>
              {l}
            </button>
          ))}
          {filtrosActivos && <button onClick={limpiar} className="h-8 px-2 text-[12px] font-medium text-[#0004FF] whitespace-nowrap hover:underline">Limpiar</button>}
          <span className="ml-auto flex items-center text-[12px] text-neutral-500">
            <button onClick={abrirTodo} className="h-8 px-2 rounded-md hover:bg-[#F4F4F5] hover:text-[#0a0a0a] whitespace-nowrap">Expandir todo</button>
            <button onClick={cerrarTodo} className="h-8 px-2 rounded-md hover:bg-[#F4F4F5] hover:text-[#0a0a0a] whitespace-nowrap">Contraer todo</button>
          </span>
        </div>
      </div>

      {/* Tabla: el scroll es de la tabla, nunca de la página. En el celu no hay scroll de costado:
          las columnas secundarias se esconden y el precio pasa debajo del color. */}
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-auto overscroll-contain">
        {filas == null ? (
          <p className="text-[14px] text-neutral-500 text-center py-16">Cargando la planilla…</p>
        ) : error ? (
          <p className="text-[14px] text-red-600 text-center py-16">No pudimos cargar la planilla. Probá de nuevo en un momento.</p>
        ) : (
          <div className="max-w-6xl mx-auto">
            <table className="w-full md:min-w-[760px] border-separate border-spacing-0 text-[13px]">
              <thead className={`${conTitulos ? '' : 'hidden '}sticky top-0 z-10 bg-white text-[11px] uppercase tracking-[0.08em] text-neutral-500`}>
                <tr className="[&>th]:font-medium [&>th]:h-8 [&>th]:px-2 [&>th]:border-b [&>th]:border-black/[0.08] [&>th]:text-left [&>th]:whitespace-nowrap">
                  <th className="w-14 pl-4">Foto</th>
                  <th>Color</th>
                  {!sinPrecios && <th className="!text-right">Precio</th>}
                  <th className="w-[136px] !text-center">Cantidad</th>
                  {!sinPrecios && <th className="!text-right">Subtotal</th>}
                  <th className="hidden lg:table-cell">Código</th>
                  <th className="hidden lg:table-cell pr-4">Tratamiento</th>
                </tr>
              </thead>
              <tbody>
                {visibles.length === 0 && (
                  <tr><td colSpan={cols} className="text-center text-[14px] text-neutral-500 py-16">{filtrosActivos ? 'No hay colores con esos filtros.' : 'No hay colores con stock.'}</td></tr>
                )}
                {filasTabla}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Totales siempre a la vista */}
      <div className="shrink-0 border-t border-black/[0.08] bg-white pb-[env(safe-area-inset-bottom)]">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <div className="min-w-0 leading-tight">
            <p className="text-[16px] font-semibold tabular-nums">
              {cartCount.toLocaleString('es-AR')} {cartCount === 1 ? 'unidad' : 'unidades'}
              {!sinPrecios && <span className="text-[#0004FF]"> · {kAr(cartTotal)}</span>}
              {!sinPrecios && <span className="text-[12px] font-normal text-neutral-500"> + IVA</span>}
            </p>
            <p className="text-[12px] text-neutral-500 truncate mt-0.5">
              {nModelosCargados ? `${nModelosCargados} modelo${nModelosCargados !== 1 ? 's' : ''} cargado${nModelosCargados !== 1 ? 's' : ''}` : 'Todavía no cargaste nada'}
              <span className="hidden md:inline"> · Enter o ↑ ↓ para moverte entre cantidades</span>
            </p>
          </div>
          <button onClick={onVerPedido} disabled={cartCount === 0}
            className="shrink-0 h-10 flex items-center gap-2 rounded-md bg-[#0004FF] text-white px-4 text-[14px] font-medium hover:brightness-110 disabled:opacity-40 transition">
            <ShoppingCart size={16} /> Ver pedido
          </button>
        </div>
      </div>
    </div>
  )
}

const SEL = 'h-8 rounded-md border bg-white pl-3 pr-8 text-[12px] font-medium appearance-none focus:outline-none focus:ring-2 focus:ring-[#0004FF]/30'
function Sel({ value, onChange, children, label }: { value: string; onChange: (v: string) => void; children: React.ReactNode; label: string }) {
  return (
    <label className="relative">
      <span className="sr-only">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className={`${SEL} ${value ? 'border-[#0004FF] text-[#0004FF]' : 'border-black/10 text-neutral-700 hover:border-black/25'}`}>{children}</select>
      <ChevronDown size={14} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-neutral-400" />
    </label>
  )
}

type Mod = { modelo: string; filas: FilaPlanilla[]; u: number; imp: number; desde: number; desdeNov: number; proy: number; promo: number }
type Cat = { key: string; nombre: string; modelos: Mod[]; u: number; imp: number; promo: number }
// Secciones que cruzan el catálogo: no son categoría de la planilla
const NO_CATEGORIA = new Set(['triple', 'diamadre', 'bajaluz'])
// Alturas de los encabezados pegajosos (px): títulos de columna, categoría
const ALTO_TITULOS = 32
const ALTO_CATEGORIA = 56

// Chip de lo cargado (unidades · importe), igual en categoría y modelo
function Cargado({ u, imp, sinPrecios }: { u: number; imp: number; sinPrecios: boolean }) {
  if (u <= 0) return null
  return (
    <span className="shrink-0 tabular-nums text-[12px] font-semibold whitespace-nowrap rounded-full px-2.5 py-1 bg-[#0004FF]/[0.08] text-[#0004FF]">
      {u} u.{!sinPrecios && <span className="hidden sm:inline"> · {kAr(imp)}</span>}
    </span>
  )
}

// Fila de categoría: liviana, una línea (nombre, cantidad de modelos y lo cargado), sin fotos.
// Día de la Madre se distingue con un punto rosa. Tocándola se despliegan / pliegan sus modelos.
function FilaCategoria({ c, abierto, cols, top, sinPrecios, onClick }: {
  c: Cat; abierto: boolean; cols: number; top: number; sinPrecios: boolean; onClick: () => void
}) {
  const madre = c.key === 'diamadre'
  return (
    <tr>
      <td colSpan={cols} className={`p-0 border-b border-black/[0.08] ${abierto ? 'sticky z-[6] bg-[#FAFAFA]' : 'bg-white'}`} style={abierto ? { top } : undefined}>
        <button type="button" tabIndex={-1} onClick={onClick} aria-expanded={abierto}
          className="sticky left-0 w-[var(--ancho-tabla,100%)] h-14 flex items-center gap-3 text-left px-4 hover:bg-[#F4F4F5] transition-colors">
          <ChevronRight size={18} className={`shrink-0 text-neutral-400 transition-transform ${abierto ? 'rotate-90' : ''}`} />
          {madre && <span className="shrink-0 w-2 h-2 rounded-full bg-pink-500" aria-hidden />}
          <span className="min-w-0 flex items-baseline gap-2">
            <span className={`truncate text-[14px] font-semibold ${madre ? 'text-pink-700' : ''}`}>{c.nombre}</span>
            <span className="shrink-0 text-[12px] text-neutral-500">{c.modelos.length} modelo{c.modelos.length !== 1 ? 's' : ''}</span>
          </span>
          {c.promo > 0 && !madre && (
            <span className="shrink-0 hidden sm:inline text-[11px] font-medium rounded-full px-2 py-0.5 bg-pink-50 text-pink-700">{c.promo} en promo</span>
          )}
          <span className="flex-1" />
          <Cargado u={c.u} imp={c.imp} sinPrecios={sinPrecios} />
        </button>
      </td>
    </tr>
  )
}

// Fila de modelo: foto de referencia (la tapa del catálogo), nombre, colores, precio desde,
// disponibilidad, la referencia de noviembre y lo cargado. Toda la fila se toca para desplegar / plegar.
// Ocupa el ancho visible: en el celu es una tarjeta entera, sin scroll lateral. Fuera del orden de Tab.
function FilaModelo({ m, abierto, cols, top, foto, sinPrecios, onClick }: {
  m: Mod; abierto: boolean; cols: number; top: number; foto: string | null; sinPrecios: boolean; onClick: () => void
}) {
  const disp = m.filas.length - m.proy
  // ¿El modelo sube el 1/11? (desde de noviembre ≥ 2% sobre el desde de hoy)
  const sube = !sinPrecios && m.desde > 0 && m.desdeNov >= m.desde * 1.02
  const acento = m.u > 0 ? 'border-l-[#0004FF]' : m.promo > 0 ? 'border-l-pink-400' : 'border-l-transparent'
  return (
    <tr>
      <td colSpan={cols} className={`p-0 border-b border-black/[0.08] ${abierto ? 'sticky z-[5] bg-white' : ''}`} style={abierto ? { top } : undefined}>
        <button type="button" tabIndex={-1} onClick={onClick} aria-expanded={abierto}
          className={`sticky left-0 w-[var(--ancho-tabla,100%)] flex items-center gap-3 text-left pl-4 pr-3 sm:pr-4 py-2 border-l-2 transition-colors ${acento} ${abierto ? 'bg-[#F4F4F5]' : 'hover:bg-[#FAFAFA]'}`}>
          <span className="shrink-0 w-20 h-14 rounded-md bg-[#F4F4F5] overflow-hidden flex items-center justify-center">
            {foto && <img src={mini(foto, 240)!} alt={m.modelo} loading="lazy" decoding="async" className="w-full h-full object-contain mix-blend-multiply scale-110"
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />}
          </span>
          <span className="min-w-0 flex-1 leading-tight">
            <span className="flex items-center gap-2 min-w-0">
              <span className="truncate text-[14px] font-semibold uppercase tracking-wide">{m.modelo}</span>
              {m.promo > 0 && <span className="shrink-0 text-[11px] font-medium rounded-full px-2 py-0.5 bg-pink-50 text-pink-700">Día de la Madre</span>}
            </span>
            <span className="block truncate text-[12px] text-neutral-500 mt-1">
              {m.filas.length} color{m.filas.length !== 1 ? 'es' : ''}
              {!sinPrecios && m.desde ? <> · desde <span className="font-semibold text-[#0a0a0a]">{kAr(m.desde)}</span></> : null}
              {disp > 0 && <span className="text-emerald-700"> · {disp} disp.</span>}
              {m.proy > 0 && <span className="text-amber-700"> · {m.proy} proy.</span>}
            </span>
            {sube && (
              <span className="block truncate text-[12px] text-neutral-500 mt-0.5">
                <span className="font-medium text-[#0004FF]">Precio de octubre</span> · desde el 1/11 {kAr(m.desdeNov)}
              </span>
            )}
          </span>
          <Cargado u={m.u} imp={m.imp} sinPrecios={sinPrecios} />
          <ChevronDown size={18} className={`shrink-0 transition-transform ${abierto ? 'rotate-180 text-[#0a0a0a]' : 'text-neutral-400'}`} />
        </button>
      </td>
    </tr>
  )
}

const Fila = memo(function Fila({ f, foto, idx, cant, sinPrecios, promo, tope, celdas, ir, cambiar }: {
  f: FilaPlanilla; foto: string | null; idx: number; cant: number; sinPrecios: boolean; promo: boolean; tope: boolean
  celdas: React.MutableRefObject<(HTMLInputElement | null)[]>; ir: (i: number) => void
  cambiar: (f: FilaPlanilla, n: number) => void
}) {
  const color = colorLegible(f.descripcion) || f.descripcion || f.codigo
  const triple = /infrarrojo/i.test(f.tratamiento || '')
  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === 'ArrowDown') { e.preventDefault(); ir(idx + (e.key === 'Enter' && e.shiftKey ? -1 : 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); ir(idx - 1) }
    else if (e.key === 'Escape') (e.target as HTMLInputElement).blur()
    else if (e.key === '+' || e.key === '-') { e.preventDefault(); cambiar(f, cant + (e.key === '+' ? 1 : -1)) }
  }
  const td = 'px-2 py-2 border-b border-black/[0.06] align-middle'
  const precio = (
    <>
      {promo && <span className="text-neutral-400 line-through mr-1.5">{kAr(f.precio_lista)}</span>}
      <span className={`font-semibold ${promo ? 'text-pink-700' : ''}`}>{kAr(f.precio)}</span>
    </>
  )
  const max = tope || (cant > 0 && cant >= f.stock)
  return (
    <tr className={`${cant > 0 ? 'bg-[#0004FF]/[0.03]' : 'hover:bg-[#FAFAFA]'} focus-within:bg-[#0004FF]/[0.05]`}>
      <td className={`${td} pl-4 w-14`}>
        <div className="w-12 h-10 rounded-md bg-[#F4F4F5] overflow-hidden flex items-center justify-center" style={foto ? undefined : { background: colorSwatch(f.descripcion) }}>
          {foto && <img src={mini(foto, 160)!} alt="" loading="lazy" decoding="async" className="w-full h-full object-contain mix-blend-multiply"
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />}
        </div>
      </td>
      <td className={td}>
        <span className="flex items-start gap-2">
          <span className="mt-1 w-3 h-3 rounded-full border border-black/10 shrink-0" style={{ background: colorSwatch(f.descripcion) }} />
          <span className="min-w-0 leading-snug">
            <span className="block">{color}</span>
            {/* Celu: precio debajo del color; lo secundario en una línea chica */}
            {!sinPrecios && <span className="md:hidden block text-[12px] tabular-nums mt-0.5">{precio}</span>}
            <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5 text-[11px] text-neutral-500">
              {triple && <span className="font-medium text-[#0004FF]">Triple Protección</span>}
              {f.proyectado
                ? <span className="text-amber-700">Proyectado</span>
                : <span className="md:hidden text-emerald-700">Disponible</span>}
            </span>
          </span>
        </span>
      </td>
      {!sinPrecios && <td className={`${td} hidden md:table-cell text-right whitespace-nowrap tabular-nums`}>{precio}</td>}
      <td className={`${td} text-center`}>
        {/* − número + : los botones quedan fuera del Tab (Tab / Enter / flechas van de número en número) */}
        <div className={`inline-flex items-stretch rounded-md border overflow-hidden ${max && tope ? 'border-red-400' : cant > 0 ? 'border-[#0004FF]/50' : 'border-black/15'}`}>
          <button type="button" tabIndex={-1} onClick={() => cambiar(f, cant - 1)} disabled={cant <= 0} aria-label={`Restar ${f.modelo} ${color}`}
            className="w-9 h-9 flex items-center justify-center text-neutral-600 hover:bg-[#F4F4F5] active:bg-[#E4E4E7] disabled:text-neutral-300 disabled:hover:bg-transparent">
            <Minus size={14} />
          </button>
          <input
            ref={(el) => { celdas.current[idx] = el }}
            value={cant || ''}
            onChange={(e) => { const n = parseInt(e.target.value.replace(/\D/g, ''), 10); cambiar(f, isNaN(n) ? 0 : n) }}
            onFocus={(e) => e.target.select()}
            onKeyDown={onKey}
            inputMode="numeric" enterKeyHint="next" autoComplete="off" aria-label={`Cantidad ${f.modelo} ${color}`}
            placeholder="0"
            className="w-11 h-9 text-center text-[14px] font-semibold tabular-nums border-x border-black/10 bg-white placeholder:text-neutral-300 placeholder:font-normal focus:outline-none focus:bg-[#0004FF]/[0.06] [scroll-margin-top:180px] [scroll-margin-bottom:16px]" />
          <button type="button" tabIndex={-1} onClick={() => cambiar(f, cant + 1)} disabled={cant >= f.stock} aria-label={`Sumar ${f.modelo} ${color}`}
            className="w-9 h-9 flex items-center justify-center text-[#0004FF] hover:bg-[#0004FF]/[0.06] active:bg-[#0004FF]/10 disabled:text-neutral-300 disabled:hover:bg-transparent">
            <Plus size={14} />
          </button>
        </div>
        {max && <p className="text-[11px] text-neutral-500 mt-1 whitespace-nowrap">Máximo {f.proyectado ? 'proyectado' : 'disponible'}</p>}
      </td>
      {!sinPrecios && <td className={`${td} hidden md:table-cell text-right whitespace-nowrap tabular-nums font-semibold ${cant ? 'text-[#0004FF]' : 'text-neutral-300'}`}>{cant ? kAr(cant * f.precio) : '—'}</td>}
      <td className={`${td} hidden lg:table-cell font-mono text-[12px] text-neutral-500 whitespace-nowrap`}>{f.codigo}</td>
      <td className={`${td} hidden lg:table-cell pr-4 whitespace-nowrap text-neutral-600`}>{cap(f.tratamiento) || '—'}</td>
    </tr>
  )
})
