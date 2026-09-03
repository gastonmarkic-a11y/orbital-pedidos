// ── Catálogo COBRANDING ZN ──────────────────────────────────────────────────
// Variante del catálogo B2B pensada para que ZN termine de elegir la colección.
// Diferencias con /catalogo:
//   · NO muestra precios en ninguna pantalla.
//   · Dos selectores: uno general (modelo) y uno particular (color / SKU).
//   · El "carrito" no dispara un pedido: abre el resumen visual de lo elegido.
// Universo: SKU con stock+proyectado >= 20, más las novedades de $72.000
// (todas las posiciones aunque no tengan stock). Ver RPC zn_home / vista zn_universo.
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { Search, X, Check, ChevronLeft, ChevronRight, Sparkles, AlertTriangle, Layers } from 'lucide-react'
import { colorLegible, colorSwatch } from './colorLegible'

const CLAVE_KEY = 'orbital_zn_clave'
const SEL_KEY = 'orbital_zn_seleccion'
const AZUL = '#0004FF'

type ZFoto = {
  cod: string
  u: string | null
  c: string | null   // descripcion (color interno)
  tp: string | null  // tipo: sol / receta
  t: string | null   // tratamiento
  el: boolean        // ya elegido al cargar
  ok: boolean        // pasa el filtro de 20 unidades (stock + proyectado)
  nv: boolean        // novedad $72.000
  pr: boolean        // tiene proyectado
  fp: boolean        // la foto es de producto (no "en cara")
}
type ZModelo = {
  modelo: string
  n_colores: number
  elegidos: number
  novedad: boolean
  caliente: boolean
  clasificaciones: string[] | null
  tipos: string[] | null
  fotos: ZFoto[]
}

function Placeholder({ label }: { label?: string }) {
  return (
    <div className="w-full h-full flex flex-col items-center justify-center gap-2 bg-gradient-to-br from-[#F0F0F2] to-[#E4E4E8] text-[#AEAEB6]">
      <svg width="56" height="28" viewBox="0 0 64 30" fill="none" stroke="currentColor" strokeWidth="2.5">
        <circle cx="15" cy="16" r="11" /><circle cx="49" cy="16" r="11" /><path d="M26 14h12M4 12l4-3M60 12l-4-3" />
      </svg>
      {label && <span className="text-[10px] tracking-wide uppercase">{label}</span>}
    </div>
  )
}

function Marca() {
  return (
    <div className="flex items-center gap-2">
      <img src="/logo-orbital.png" alt="Orbital" style={{ height: 20 }} onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')} />
      <span className="text-[10px] font-bold tracking-[0.28em] text-neutral-400">×</span>
      <span className="text-[11px] font-bold tracking-[0.3em] uppercase" style={{ color: AZUL }}>ZN</span>
    </div>
  )
}

function ClaveGate({ onOk }: { onOk: (c: string) => void }) {
  const [v, setV] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  async function probar(e: React.FormEvent) {
    e.preventDefault(); setLoading(true); setErr(null)
    const { data, error } = await supabase.rpc('catalogo_clave_ok', { p: v.trim() })
    setLoading(false)
    if (error) { setErr('Error de conexión'); return }
    if (data === true) { localStorage.setItem(CLAVE_KEY, v.trim()); onOk(v.trim()) }
    else setErr('Clave incorrecta')
  }
  return (
    <div className="min-h-screen flex items-center justify-center bg-white px-4 font-mono">
      <form onSubmit={probar} className="w-full max-w-sm bg-white border border-black/10 rounded-2xl shadow-sm p-8">
        <Marca />
        <div className="h-px bg-gradient-to-r from-[#0004FF]/60 to-transparent my-4" />
        <p className="text-sm text-neutral-600 mb-5">Selección de colección cobranding. Ingresá la clave de acceso.</p>
        <input autoFocus type="password" placeholder="Clave" value={v} onChange={(e) => setV(e.target.value)}
          className="w-full rounded-lg bg-white border border-black/10 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0004FF]/40" />
        {err && <p className="text-sm text-red-600 mt-2">{err}</p>}
        <button disabled={loading} className="w-full mt-4 rounded-lg text-white py-2.5 text-sm font-medium disabled:opacity-50" style={{ background: AZUL }}>
          {loading ? 'Verificando…' : 'Entrar'}
        </button>
      </form>
    </div>
  )
}

// Portada: siempre foto de producto si existe (nunca la foto "en cara"),
// priorizando un color ya elegido.
const cover = (m: ZModelo): ZFoto | null => {
  const con = (m.fotos || []).filter((f) => f.u)
  if (!con.length) return null
  const prod = con.filter((f) => f.fp)
  const pool = prod.length ? prod : con
  return pool.find((f) => f.el) || pool.find((f) => f.ok) || pool[0]
}

// ── Tarjeta de modelo (selector general) ──
function ModeloCard({ m, elegidos, onOpen }: { m: ZModelo; elegidos: number; onOpen: () => void }) {
  const f = cover(m)
  return (
    <button onClick={onOpen} className="text-left group">
      <div className="relative aspect-[4/3] rounded-xl overflow-hidden bg-white border border-black/10 group-hover:border-[#0004FF]/50 transition">
        {f?.u ? <img src={f.u} alt={m.modelo} className="w-full h-full object-contain p-2" loading="lazy" /> : <Placeholder label="Próximamente" />}
        {elegidos > 0 && (
          <span className="absolute top-2 left-2 inline-flex items-center gap-1 rounded-full bg-emerald-600 text-white text-[10px] font-bold px-2 py-0.5">
            <Check size={11} strokeWidth={3} />{elegidos}
          </span>
        )}
        {m.novedad && (
          <span className="absolute top-2 right-2 inline-flex items-center gap-1 rounded-full text-white text-[9px] font-bold px-2 py-0.5" style={{ background: AZUL }}>
            <Sparkles size={10} />NEW
          </span>
        )}
      </div>
      <div className="mt-1.5">
        <div className="text-[12px] font-bold tracking-wide uppercase leading-tight">{m.modelo}</div>
        <div className="text-[10px] text-neutral-500">{m.n_colores} {m.n_colores === 1 ? 'color' : 'colores'}</div>
      </div>
    </button>
  )
}

// ── Selector particular: colores / SKU de un modelo ──
function ColorSheet({ m, sel, toggle, onClose, onPrev, onNext }: {
  m: ZModelo; sel: Set<string>; toggle: (cod: string) => void
  onClose: () => void; onPrev?: () => void; onNext?: () => void
}) {
  const fotos = m.fotos || []
  const [i, setI] = useState(() => Math.max(0, fotos.findIndex((f) => sel.has(f.cod))))
  useEffect(() => { setI(Math.max(0, fotos.findIndex((f) => sel.has(f.cod)))) }, [m.modelo])
  const act = fotos[i] || fotos[0]
  const nSel = fotos.filter((f) => sel.has(f.cod)).length
  return (
    <div className="fixed inset-0 z-50 bg-white font-mono flex flex-col">
      <div className="flex items-center justify-between px-4 h-14 border-b border-black/10 shrink-0">
        <button onClick={onClose} className="p-2 -ml-2"><X size={20} /></button>
        <div className="text-center">
          <div className="text-[13px] font-bold tracking-wide uppercase">{m.modelo}</div>
          <div className="text-[10px] text-neutral-500">{nSel} de {fotos.length} elegidos</div>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={onPrev} disabled={!onPrev} className="p-2 disabled:opacity-25"><ChevronLeft size={18} /></button>
          <button onClick={onNext} disabled={!onNext} className="p-2 disabled:opacity-25"><ChevronRight size={18} /></button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {act && (
          <div className="p-4 max-w-3xl mx-auto w-full">
            <div className="aspect-[4/3] max-h-[52vh] mx-auto rounded-2xl overflow-hidden bg-white border border-black/10 relative">
              {act.u ? <img src={act.u} alt={act.c || m.modelo} className="w-full h-full object-contain p-3" /> : <Placeholder label="Sin foto" />}
              {!act.ok && (
                <span className="absolute bottom-2 left-2 inline-flex items-center gap-1 rounded-full bg-amber-500 text-white text-[10px] font-bold px-2 py-1">
                  <AlertTriangle size={11} />Sin reposición
                </span>
              )}
            </div>
            <div className="mt-3 flex items-start justify-between gap-3">
              <div>
                <div className="text-[13px] font-semibold">{colorLegible(act.c)}</div>
                <div className="text-[10px] text-neutral-500 uppercase tracking-wide">
                  {act.tp || '—'}{act.t ? ` · ${act.t}` : ''} · REF {act.cod}
                </div>
              </div>
              <button onClick={() => toggle(act.cod)}
                className={`shrink-0 rounded-full px-4 py-2 text-[12px] font-bold ${sel.has(act.cod) ? 'bg-emerald-600 text-white' : 'text-white'}`}
                style={sel.has(act.cod) ? undefined : { background: AZUL }}>
                {sel.has(act.cod) ? '✓ Elegido' : 'Elegir'}
              </button>
            </div>
          </div>
        )}

        <div className="px-4 pb-24 max-w-3xl mx-auto w-full">
          <div className="text-[10px] uppercase tracking-[0.2em] text-neutral-400 mb-2">Colores del modelo</div>
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
            {fotos.map((f, k) => {
              const on = sel.has(f.cod)
              return (
                <button key={f.cod} onClick={() => { setI(k); toggle(f.cod) }}
                  className={`relative rounded-lg overflow-hidden border-2 transition ${on ? 'border-emerald-600' : k === i ? 'border-[#0004FF]' : 'border-black/10'}`}>
                  <div className="aspect-square bg-white">
                    {f.u ? <img src={f.u} alt={f.c || ''} className="w-full h-full object-contain p-1" loading="lazy" /> : <Placeholder />}
                  </div>
                  {on && <span className="absolute top-1 right-1 w-5 h-5 rounded-full bg-emerald-600 text-white flex items-center justify-center"><Check size={12} strokeWidth={3} /></span>}
                  {!f.ok && !on && <span className="absolute top-1 left-1 w-2 h-2 rounded-full bg-amber-500" title="Sin reposición" />}
                  <div className="px-1 py-1 flex items-center gap-1 bg-white border-t border-black/5">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0 border border-black/10" style={{ background: colorSwatch(f.c) }} />
                    <span className="text-[8px] leading-tight text-neutral-600 truncate">{colorLegible(f.c)}</span>
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      </div>

      <div className="border-t border-black/10 p-3 shrink-0 max-w-3xl mx-auto w-full">
        <button onClick={onNext || onClose} className="w-full rounded-xl text-white py-3 text-sm font-bold" style={{ background: AZUL }}>
          {onNext ? 'Siguiente modelo →' : 'Listo'}
        </button>
      </div>
    </div>
  )
}

// ── Resumen visual de la colección elegida (reemplaza al checkout) ──
function ResumenSheet({ modelos, sel, toggle, onClose, clave }: {
  modelos: ZModelo[]; sel: Set<string>; toggle: (c: string) => void; onClose: () => void; clave: string
}) {
  const [guardando, setGuardando] = useState(false)
  const [ok, setOk] = useState(false)
  const grupos = useMemo(() => {
    const g: { modelo: string; fotos: ZFoto[] }[] = []
    for (const m of modelos) {
      const fs = (m.fotos || []).filter((f) => sel.has(f.cod))
      if (fs.length) g.push({ modelo: m.modelo, fotos: fs })
    }
    return g.sort((a, b) => a.modelo.localeCompare(b.modelo))
  }, [modelos, sel])
  const total = grupos.reduce((a, g) => a + g.fotos.length, 0)
  const alerta = grupos.flatMap((g) => g.fotos).filter((f) => !f.ok)

  async function guardar() {
    setGuardando(true)
    const { error } = await supabase.rpc('zn_guardar', { p_clave: clave, p_items: Array.from(sel) })
    setGuardando(false)
    if (!error) { setOk(true); setTimeout(() => setOk(false), 2500) }
  }

  return (
    <div className="fixed inset-0 z-50 bg-[#FAFAFA] font-mono flex flex-col">
      <div className="flex items-center justify-between px-4 h-14 border-b border-black/10 bg-white shrink-0">
        <button onClick={onClose} className="p-2 -ml-2"><X size={20} /></button>
        <div className="text-center">
          <div className="text-[13px] font-bold tracking-wide uppercase">La colección</div>
          <div className="text-[10px] text-neutral-500">{grupos.length} modelos · {total} colores</div>
        </div>
        <div className="w-8" />
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 pb-28">
        {total === 0 && <p className="text-sm text-neutral-500 text-center mt-16">Todavía no elegiste ningún anteojo.</p>}
        {alerta.length > 0 && (
          <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-3 text-[11px] text-amber-900 flex gap-2">
            <AlertTriangle size={14} className="shrink-0 mt-0.5" />
            <span><b>{alerta.length} {alerta.length === 1 ? 'color elegido' : 'colores elegidos'} sin reposición</b> (menos de 20 unidades entre stock y proyectado): {alerta.map((f) => colorLegible(f.c)).join(' · ')}. Conviene reemplazarlos.</span>
          </div>
        )}
        {grupos.map((g) => (
          <div key={g.modelo} className="mb-6">
            <div className="flex items-baseline gap-2 mb-2">
              <h3 className="text-[13px] font-bold tracking-wide uppercase">{g.modelo}</h3>
              <span className="text-[10px] text-neutral-400">{g.fotos.length} {g.fotos.length === 1 ? 'color' : 'colores'}</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {g.fotos.map((f) => (
                <div key={f.cod} className="relative rounded-xl overflow-hidden bg-white border border-black/10">
                  <div className="aspect-[4/3]">
                    {f.u ? <img src={f.u} alt={f.c || ''} className="w-full h-full object-contain p-2" loading="lazy" /> : <Placeholder />}
                  </div>
                  <div className="px-2 py-1.5 border-t border-black/5">
                    <div className="flex items-center gap-1">
                      <span className="w-2.5 h-2.5 rounded-full shrink-0 border border-black/10" style={{ background: colorSwatch(f.c) }} />
                      <span className="text-[10px] leading-tight truncate">{colorLegible(f.c)}</span>
                    </div>
                    <div className="text-[8px] text-neutral-400 uppercase tracking-wide">{f.tp || ''} · {f.cod}</div>
                  </div>
                  {!f.ok && <span className="absolute top-1.5 left-1.5 w-2.5 h-2.5 rounded-full bg-amber-500" />}
                  <button onClick={() => toggle(f.cod)} className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-black/60 text-white flex items-center justify-center">
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="border-t border-black/10 bg-white p-3 shrink-0 flex gap-2">
        <button onClick={onClose} className="flex-1 rounded-xl border border-black/15 py-3 text-sm font-medium">Seguir eligiendo</button>
        <button onClick={guardar} disabled={guardando || total === 0}
          className="flex-1 rounded-xl text-white py-3 text-sm font-bold disabled:opacity-40" style={{ background: ok ? '#059669' : AZUL }}>
          {guardando ? 'Guardando…' : ok ? '✓ Guardado' : 'Guardar selección'}
        </button>
      </div>
    </div>
  )
}

const FILTROS = ['Todos', 'Elegidos', 'Sin elegir', 'Novedades', 'Sol', 'Receta'] as const
type Filtro = typeof FILTROS[number]

export default function CatalogoZN() {
  const urlK = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('k') : null
  const [clave, setClave] = useState<string | null>(urlK || localStorage.getItem(CLAVE_KEY))
  const [modelos, setModelos] = useState<ZModelo[]>([])
  const [cargando, setCargando] = useState(true)
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [q, setQ] = useState('')
  const [filtro, setFiltro] = useState<Filtro>('Todos')
  const [abierto, setAbierto] = useState<number | null>(null)
  const [resumen, setResumen] = useState(false)

  useEffect(() => {
    if (!clave) return
    setCargando(true)
    supabase.rpc('zn_home', { p_clave: clave }).then(({ data, error }) => {
      setCargando(false)
      if (error) { setClave(null); localStorage.removeItem(CLAVE_KEY); return }
      const ms = (data as ZModelo[]) || []
      setModelos(ms)
      // arranca con lo ya elegido (marcado en la base) + lo que haya quedado local
      const guardado = new Set<string>(JSON.parse(localStorage.getItem(SEL_KEY) || '[]'))
      const base = new Set<string>(ms.flatMap((m) => (m.fotos || []).filter((f) => f.el).map((f) => f.cod)))
      setSel(guardado.size ? new Set([...base, ...guardado]) : base)
      if (urlK) localStorage.setItem(CLAVE_KEY, urlK)
    })
  }, [clave])

  useEffect(() => { localStorage.setItem(SEL_KEY, JSON.stringify(Array.from(sel))) }, [sel])

  // con una hoja abierta, la página de atrás no debe scrollear (mobile)
  useEffect(() => {
    const abierta = abierto !== null || resumen
    document.body.style.overflow = abierta ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [abierto, resumen])

  const toggle = (cod: string) => setSel((p) => { const n = new Set(p); if (n.has(cod)) n.delete(cod); else n.add(cod); return n })
  const cuenta = (m: ZModelo) => (m.fotos || []).filter((f) => sel.has(f.cod)).length

  const lista = useMemo(() => {
    const t = q.trim().toLowerCase()
    return modelos.filter((m) => {
      if (t && !m.modelo.toLowerCase().includes(t)) return false
      if (filtro === 'Elegidos') return cuenta(m) > 0
      if (filtro === 'Sin elegir') return cuenta(m) === 0
      if (filtro === 'Novedades') return m.novedad
      if (filtro === 'Sol') return (m.tipos || []).includes('sol')
      if (filtro === 'Receta') return (m.tipos || []).includes('receta')
      return true
    })
  }, [modelos, q, filtro, sel])

  const totalSel = sel.size
  const modelosSel = modelos.filter((m) => cuenta(m) > 0).length

  if (!clave) return <ClaveGate onOk={setClave} />

  return (
    <div className="min-h-screen bg-[#FAFAFA] font-mono">
      <header className="sticky top-0 z-30 bg-white border-b border-black/10">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between gap-3">
          <Marca />
          <button onClick={() => setResumen(true)}
            className="inline-flex items-center gap-2 rounded-full text-white px-4 py-2 text-[12px] font-bold" style={{ background: AZUL }}>
            <Layers size={14} />La colección · {totalSel}
          </button>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-4 py-5">
        <div className="mb-5">
          <h1 className="text-[15px] font-bold tracking-wide uppercase">Selección de colección</h1>
          <p className="text-[11px] text-neutral-500 mt-1">
            Elegí primero el <b>modelo</b> y después los <b>colores</b> de cada modelo. Sin precios: es solo para armar la colección.
            {' '}Llevás <b>{modelosSel} modelos</b> y <b>{totalSel} colores</b>.
          </p>
        </div>

        <div className="flex items-center gap-2 mb-3">
          <div className="relative flex-1">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar modelo…"
              className="w-full rounded-full bg-white border border-black/10 pl-9 pr-3 py-2 text-[12px] focus:outline-none focus:ring-2 focus:ring-[#0004FF]/30" />
          </div>
        </div>
        <div className="flex gap-1.5 overflow-x-auto pb-3 -mx-1 px-1">
          {FILTROS.map((f) => (
            <button key={f} onClick={() => setFiltro(f)}
              className={`shrink-0 rounded-full px-3 py-1.5 text-[11px] font-medium border ${filtro === f ? 'text-white border-transparent' : 'bg-white border-black/10 text-neutral-600'}`}
              style={filtro === f ? { background: AZUL } : undefined}>{f}</button>
          ))}
        </div>

        {cargando && <p className="text-sm text-neutral-500 py-16 text-center">Cargando modelos…</p>}
        {!cargando && lista.length === 0 && <p className="text-sm text-neutral-500 py-16 text-center">No hay modelos con ese filtro.</p>}

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
          {lista.map((m) => (
            <ModeloCard key={m.modelo} m={m} elegidos={cuenta(m)} onOpen={() => setAbierto(modelos.indexOf(m))} />
          ))}
        </div>
      </div>

      {abierto !== null && modelos[abierto] && (
        <ColorSheet m={modelos[abierto]} sel={sel} toggle={toggle} onClose={() => setAbierto(null)}
          onPrev={abierto > 0 ? () => setAbierto(abierto - 1) : undefined}
          onNext={abierto < modelos.length - 1 ? () => setAbierto(abierto + 1) : undefined} />
      )}
      {resumen && <ResumenSheet modelos={modelos} sel={sel} toggle={toggle} onClose={() => setResumen(false)} clave={clave} />}
    </div>
  )
}
