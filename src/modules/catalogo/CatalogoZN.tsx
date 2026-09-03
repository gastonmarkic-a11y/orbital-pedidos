// ── Catálogo COBRANDING ZN ──────────────────────────────────────────────────
// Variante del catálogo B2B pensada para definir la colección cobranding.
// Diferencias con /catalogo:
//   · NO muestra precios en ninguna pantalla.
//   · Dos selectores: uno general (modelo) y uno particular (color / SKU).
//   · DOS selecciones en paralelo, el rol lo define el token:
//       verde = lo que elige ZN (?k=zn2026) · rojo = lo que sugiere Orbital (?k=orbitalzn)
//       las dos juntas = el ideal (coincidencia).
//   · El "carrito" no dispara un pedido: abre el resumen comparado de lo elegido.
// Universo: SKU con stock+proyectado >= 20, más las novedades de $72.000
// (todas las posiciones aunque no tengan stock), y solo con foto. Ver vista zn_universo.
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { Search, X, Check, ChevronLeft, ChevronRight, Sparkles, AlertTriangle, Layers } from 'lucide-react'
import { colorLegible, colorSwatch } from './colorLegible'

const CLAVE_KEY = 'orbital_zn_clave'
const SEL_KEY = 'orbital_zn_seleccion'   // + ':' + rol
const AZUL = '#0004FF'
const VERDE = '#059669'
const ROJO = '#DC2626'

type Rol = 'zn' | 'orbital'

type ZFoto = {
  cod: string
  u: string | null
  c: string | null   // descripcion (color interno)
  tp: string | null  // tipo: sol / receta
  t: string | null   // tratamiento
  ez: boolean        // elegido por ZN
  eo: boolean        // sugerido por Orbital
  ok: boolean        // pasa el filtro de 20 unidades (stock + proyectado)
  nv: boolean        // novedad $72.000
  pr: boolean        // tiene proyectado
  fp: boolean        // la foto es de producto (no "en cara")
}
type ZModelo = {
  modelo: string
  n_colores: number
  elegidos: number
  elegidos_orb: number
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

// Estado visual de un SKU según las dos selecciones.
type Estado = 'ideal' | 'zn' | 'orb' | 'no'
const estadoDe = (cod: string, zn: Set<string>, orb: Set<string>): Estado => {
  const a = zn.has(cod), b = orb.has(cod)
  return a && b ? 'ideal' : a ? 'zn' : b ? 'orb' : 'no'
}
const BORDE: Record<Estado, string> = { ideal: '#111827', zn: VERDE, orb: ROJO, no: 'rgba(0,0,0,0.1)' }

// Chips ✓ de esquina: verde = ZN, rojo = Orbital.
function Marcas({ e, size = 20 }: { e: Estado; size?: number }) {
  if (e === 'no') return null
  const chip = (color: string) => (
    <span className="rounded-full text-white flex items-center justify-center shadow-sm"
      style={{ background: color, width: size, height: size }}>
      <Check size={size * 0.6} strokeWidth={3} />
    </span>
  )
  return (
    <span className="absolute top-1.5 right-1.5 flex gap-1">
      {(e === 'zn' || e === 'ideal') && chip(VERDE)}
      {(e === 'orb' || e === 'ideal') && chip(ROJO)}
    </span>
  )
}

// ── Tarjeta de SKU: el detalle del color, con las dos marcas ──
function SkuCard({ modelo, f, zn, orb, onToggle, onQuitar }: {
  modelo: string; f: ZFoto; zn: Set<string>; orb: Set<string>
  onToggle?: () => void; onQuitar?: () => void
}) {
  const e = estadoDe(f.cod, zn, orb)
  return (
    <div className="relative rounded-xl overflow-hidden bg-white flex flex-col" style={{ border: `2px solid ${BORDE[e]}` }}>
      <button onClick={onToggle} disabled={!onToggle} className="block text-left">
        <div className="aspect-[4/3]">
          {f.u ? <img src={f.u} alt={f.c || ''} className="w-full h-full object-contain p-2" loading="lazy" /> : <Placeholder />}
        </div>
      </button>
      <div className="px-2 py-2 border-t border-black/5 flex-1">
        <div className="text-[11px] font-bold tracking-wide uppercase leading-tight">{modelo}</div>
        <div className="flex items-start gap-1 mt-1">
          <span className="w-2.5 h-2.5 rounded-full shrink-0 border border-black/10 mt-0.5" style={{ background: colorSwatch(f.c) }} />
          <span className="text-[10px] leading-snug">{colorLegible(f.c)}</span>
        </div>
        <div className="text-[8px] text-neutral-400 uppercase tracking-wide mt-1">{f.tp || ''}{f.t ? ` · ${f.t}` : ''}</div>
        <div className="text-[8px] text-neutral-400 tracking-wide">REF {f.cod}</div>
        {e === 'ideal' && <div className="text-[8px] font-bold uppercase mt-0.5 tracking-widest">★ Ideal · ZN + Orbital</div>}
        {e === 'zn' && <div className="text-[8px] font-bold uppercase mt-0.5" style={{ color: VERDE }}>Elige ZN</div>}
        {e === 'orb' && <div className="text-[8px] font-bold uppercase mt-0.5" style={{ color: ROJO }}>Sugiere Orbital</div>}
        {!f.ok && <div className="text-[8px] text-amber-600 font-bold uppercase mt-0.5">Sin reposición</div>}
      </div>
      <Marcas e={e} />
      {onQuitar && (
        <button onClick={onQuitar} className="absolute bottom-1.5 right-1.5 w-6 h-6 rounded-full bg-black/60 text-white flex items-center justify-center">
          <X size={12} />
        </button>
      )}
    </div>
  )
}

const cover = (m: ZModelo): ZFoto | null => {
  const con = (m.fotos || []).filter((f) => f.u)
  if (!con.length) return null
  const prod = con.filter((f) => f.fp)
  const pool = prod.length ? prod : con
  return pool.find((f) => f.ez || f.eo) || pool.find((f) => f.ok) || pool[0]
}

// ── Tarjeta de modelo (selector general) ──
function ModeloCard({ m, nZN, nOrb, onOpen }: { m: ZModelo; nZN: number; nOrb: number; onOpen: () => void }) {
  const f = cover(m)
  return (
    <button onClick={onOpen} className="text-left group">
      <div className="relative aspect-[4/3] rounded-xl overflow-hidden bg-white border border-black/10 group-hover:border-[#0004FF]/50 transition">
        {f?.u ? <img src={f.u} alt={m.modelo} className="w-full h-full object-contain p-2" loading="lazy" /> : <Placeholder label="Próximamente" />}
        <span className="absolute top-2 left-2 flex gap-1">
          {nZN > 0 && (
            <span className="inline-flex items-center gap-0.5 rounded-full text-white text-[10px] font-bold px-2 py-0.5" style={{ background: VERDE }}>
              <Check size={10} strokeWidth={3} />{nZN}
            </span>
          )}
          {nOrb > 0 && (
            <span className="inline-flex items-center gap-0.5 rounded-full text-white text-[10px] font-bold px-2 py-0.5" style={{ background: ROJO }}>
              <Check size={10} strokeWidth={3} />{nOrb}
            </span>
          )}
        </span>
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
function ColorSheet({ m, rol, zn, orb, toggle, onClose, onPrev, onNext }: {
  m: ZModelo; rol: Rol; zn: Set<string>; orb: Set<string>; toggle: (cod: string) => void
  onClose: () => void; onPrev?: () => void; onNext?: () => void
}) {
  const fotos = m.fotos || []
  const mio = rol === 'zn' ? zn : orb
  const [i, setI] = useState(() => Math.max(0, fotos.findIndex((f) => mio.has(f.cod))))
  useEffect(() => { setI(Math.max(0, fotos.findIndex((f) => mio.has(f.cod)))) }, [m.modelo])
  const act = fotos[i] || fotos[0]
  const nMio = fotos.filter((f) => mio.has(f.cod)).length
  const miColor = rol === 'zn' ? VERDE : ROJO
  return (
    <div className="fixed inset-0 z-50 bg-white font-mono flex flex-col">
      <div className="flex items-center justify-between px-4 h-14 border-b border-black/10 shrink-0">
        <button onClick={onClose} className="p-2 -ml-2"><X size={20} /></button>
        <div className="text-center">
          <div className="text-[13px] font-bold tracking-wide uppercase">{m.modelo}</div>
          <div className="text-[10px] text-neutral-500">{nMio} de {fotos.length} {rol === 'zn' ? 'elegidos' : 'sugeridos'}</div>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={onPrev} disabled={!onPrev} className="p-2 disabled:opacity-25"><ChevronLeft size={18} /></button>
          <button onClick={onNext} disabled={!onNext} className="p-2 disabled:opacity-25"><ChevronRight size={18} /></button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {act && (
          <div className="p-4 max-w-3xl mx-auto w-full">
            <div className="aspect-[4/3] max-h-[52vh] mx-auto rounded-2xl overflow-hidden bg-white relative"
              style={{ border: `2px solid ${BORDE[estadoDe(act.cod, zn, orb)]}` }}>
              {act.u ? <img src={act.u} alt={act.c || m.modelo} className="w-full h-full object-contain p-3" /> : <Placeholder label="Sin foto" />}
              <Marcas e={estadoDe(act.cod, zn, orb)} size={26} />
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
                {estadoDe(act.cod, zn, orb) === 'ideal' && <div className="text-[10px] font-bold uppercase tracking-widest mt-1">★ Ideal · ZN + Orbital</div>}
                {estadoDe(act.cod, zn, orb) === 'orb' && rol === 'zn' && <div className="text-[10px] font-bold mt-1" style={{ color: ROJO }}>Sugerido por Orbital</div>}
                {estadoDe(act.cod, zn, orb) === 'zn' && rol === 'orbital' && <div className="text-[10px] font-bold mt-1" style={{ color: VERDE }}>Elegido por ZN</div>}
              </div>
              <button onClick={() => toggle(act.cod)}
                className="shrink-0 rounded-full px-4 py-2 text-[12px] font-bold text-white"
                style={{ background: mio.has(act.cod) ? '#404040' : miColor }}>
                {mio.has(act.cod) ? '✓ Quitar' : rol === 'zn' ? 'Elegir' : 'Sugerir'}
              </button>
            </div>
          </div>
        )}

        <div className="px-4 pb-24 max-w-3xl mx-auto w-full">
          <div className="text-[10px] uppercase tracking-[0.2em] text-neutral-400 mb-2">Colores del modelo</div>
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
            {fotos.map((f, k) => {
              const e = estadoDe(f.cod, zn, orb)
              return (
                <button key={f.cod} onClick={() => { setI(k); toggle(f.cod) }}
                  className="relative rounded-lg overflow-hidden transition"
                  style={{ border: `2px solid ${e === 'no' && k === i ? AZUL : BORDE[e]}` }}>
                  <div className="aspect-square bg-white">
                    {f.u ? <img src={f.u} alt={f.c || ''} className="w-full h-full object-contain p-1" loading="lazy" /> : <Placeholder />}
                  </div>
                  <Marcas e={e} />
                  {!f.ok && e === 'no' && <span className="absolute top-1 left-1 w-2 h-2 rounded-full bg-amber-500" title="Sin reposición" />}
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

// ── Resumen comparado: el ideal (coincidencias) + lo de cada uno ──
function ResumenSheet({ modelos, rol, zn, orb, toggle, limpiar, onClose, clave }: {
  modelos: ZModelo[]; rol: Rol; zn: Set<string>; orb: Set<string>
  toggle: (c: string) => void; limpiar: () => void; onClose: () => void; clave: string
}) {
  const [guardando, setGuardando] = useState(false)
  const [ok, setOk] = useState(false)
  const [confirmar, setConfirmar] = useState(false)
  const mio = rol === 'zn' ? zn : orb

  // un ítem por SKU marcado por cualquiera de los dos, con el detalle completo
  const items = useMemo(() => {
    const out: { modelo: string; f: ZFoto; e: Estado }[] = []
    for (const m of modelos) for (const f of m.fotos || []) {
      const e = estadoDe(f.cod, zn, orb)
      if (e !== 'no') out.push({ modelo: m.modelo, f, e })
    }
    return out.sort((a, b) => a.modelo.localeCompare(b.modelo) || colorLegible(a.f.c).localeCompare(colorLegible(b.f.c)))
  }, [modelos, zn, orb])

  const bloques: { key: Estado; titulo: string; color: string; bajada: string }[] = [
    { key: 'ideal', titulo: '★ El ideal · coinciden ZN y Orbital', color: '#111827', bajada: 'Lo que las dos partes quieren. Es la base de la colección.' },
    { key: 'zn', titulo: 'Solo ZN', color: VERDE, bajada: 'Elegido por ZN, Orbital todavía no lo sugirió.' },
    { key: 'orb', titulo: 'Solo Orbital', color: ROJO, bajada: 'Sugerido por Orbital, ZN todavía no lo eligió.' },
  ]
  const alerta = items.filter((i) => !i.f.ok)

  async function guardar() {
    setGuardando(true)
    const { error } = await supabase.rpc('zn_guardar', { p_clave: clave, p_items: Array.from(mio) })
    setGuardando(false)
    if (!error) { setOk(true); setTimeout(() => setOk(false), 2500) }
  }

  // Borra TODAS mis marcas (las de este rol): en pantalla, en el navegador y en la base.
  // No toca las del otro rol.
  async function borrarTodo() {
    setGuardando(true)
    await supabase.rpc('zn_guardar', { p_clave: clave, p_items: [] })
    limpiar()
    setGuardando(false)
    setConfirmar(false)
  }

  return (
    <div className="fixed inset-0 z-50 bg-[#FAFAFA] font-mono flex flex-col">
      <div className="flex items-center justify-between px-4 h-14 border-b border-black/10 bg-white shrink-0">
        <button onClick={onClose} className="p-2 -ml-2"><X size={20} /></button>
        <div className="text-center">
          <div className="text-[13px] font-bold tracking-wide uppercase">La colección</div>
          <div className="text-[10px] text-neutral-500">
            {items.filter((i) => i.e === 'ideal').length} ideal · {zn.size} ZN · {orb.size} Orbital
          </div>
        </div>
        <div className="w-8" />
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 pb-28">
        {items.length === 0 && <p className="text-sm text-neutral-500 text-center mt-16">Todavía no hay nada marcado.</p>}
        {alerta.length > 0 && (
          <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-3 text-[11px] text-amber-900 flex gap-2">
            <AlertTriangle size={14} className="shrink-0 mt-0.5" />
            <span><b>{alerta.length} {alerta.length === 1 ? 'SKU' : 'SKU'} sin reposición</b> (menos de 20 unidades entre stock y proyectado): {alerta.map((i) => `${i.modelo} ${colorLegible(i.f.c)}`).join(' · ')}. Conviene reemplazarlos.</span>
          </div>
        )}
        {bloques.map((b) => {
          const del = items.filter((i) => i.e === b.key)
          if (!del.length) return null
          return (
            <section key={b.key} className="mb-8">
              <div className="mb-2 border-b pb-1.5" style={{ borderColor: b.color }}>
                <h2 className="text-[12px] font-bold tracking-[0.14em] uppercase" style={{ color: b.color }}>
                  {b.titulo} <span className="text-neutral-400">· {del.length} SKU</span>
                </h2>
                <p className="text-[10px] text-neutral-500 mt-0.5">{b.bajada}</p>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                {del.map(({ modelo, f }) => (
                  <SkuCard key={f.cod} modelo={modelo} f={f} zn={zn} orb={orb}
                    onQuitar={mio.has(f.cod) ? () => toggle(f.cod) : undefined}
                    onToggle={() => toggle(f.cod)} />
                ))}
              </div>
            </section>
          )
        })}
      </div>

      <div className="border-t border-black/10 bg-white p-3 shrink-0">
        {mio.size > 0 && (
          confirmar ? (
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[10px] text-neutral-600 flex-1">
                ¿Borrar tus {mio.size} marcas {rol === 'zn' ? 'verdes' : 'rojas'}? Las del otro no se tocan.
              </span>
              <button onClick={() => setConfirmar(false)} className="rounded-lg border border-black/15 px-3 py-1.5 text-[11px]">No</button>
              <button onClick={borrarTodo} disabled={guardando}
                className="rounded-lg px-3 py-1.5 text-[11px] font-bold text-white disabled:opacity-40"
                style={{ background: ROJO }}>Sí, borrar</button>
            </div>
          ) : (
            <button onClick={() => setConfirmar(true)} className="text-[10px] text-neutral-400 underline mb-2">
              Borrar mis {mio.size} marcas y empezar de cero
            </button>
          )
        )}
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 rounded-xl border border-black/15 py-3 text-sm font-medium">Seguir eligiendo</button>
          <button onClick={guardar} disabled={guardando || mio.size === 0}
            className="flex-1 rounded-xl text-white py-3 text-sm font-bold disabled:opacity-40"
            style={{ background: ok ? VERDE : AZUL }}>
            {guardando ? 'Guardando…' : ok ? '✓ Guardado' : `Guardar (${mio.size})`}
          </button>
        </div>
      </div>
    </div>
  )
}

const FILTROS = ['Todos', 'Elegidos ZN', 'Sugeridos Orbital', 'Coincidencias', 'Sin marcar', 'Novedades'] as const
type Filtro = typeof FILTROS[number]
// Con estos filtros la grilla muestra directamente el SKU, no la tarjeta de modelo.
const FILTROS_SKU: Filtro[] = ['Elegidos ZN', 'Sugeridos Orbital', 'Coincidencias']

// La grilla se muestra dividida por categoría, en este orden.
const CATEGORIAS: { key: string; label: string }[] = [
  { key: 'urbano', label: 'Urbanos' },
  { key: 'deportivo', label: 'Deportivos' },
  { key: 'zaira nara', label: 'Zaira Nara' },
  { key: 'oportunidades', label: 'Oportunidades' },
  { key: '_otros', label: 'Otros' },
]
const catDe = (m: ZModelo): string => {
  const c = (m.clasificaciones || [])[0]
  return c && CATEGORIAS.some((x) => x.key === c) ? c : '_otros'
}
const slugCat = (k: string) => 'cat-' + k.replace(/\s+/g, '-')

export default function CatalogoZN() {
  const urlK = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('k') : null
  const [clave, setClave] = useState<string | null>(urlK || localStorage.getItem(CLAVE_KEY))
  const [rol, setRol] = useState<Rol>('zn')
  const [modelos, setModelos] = useState<ZModelo[]>([])
  const [cargando, setCargando] = useState(true)
  const [selZN, setSelZN] = useState<Set<string>>(new Set())
  const [selOrb, setSelOrb] = useState<Set<string>>(new Set())
  const [q, setQ] = useState('')
  const [filtro, setFiltro] = useState<Filtro>('Todos')
  const [abierto, setAbierto] = useState<number | null>(null)
  const [resumen, setResumen] = useState(false)

  useEffect(() => {
    if (!clave) return
    setCargando(true)
    Promise.all([
      supabase.rpc('zn_rol', { p_clave: clave }),
      supabase.rpc('zn_home', { p_clave: clave }),
    ]).then(([r, h]) => {
      setCargando(false)
      if (h.error || !r.data) { setClave(null); localStorage.removeItem(CLAVE_KEY); return }
      const miRol = (r.data as Rol) || 'zn'
      setRol(miRol)
      const ms = (h.data as ZModelo[]) || []
      setModelos(ms)
      const baseZN = new Set<string>(ms.flatMap((m) => (m.fotos || []).filter((f) => f.ez).map((f) => f.cod)))
      const baseOrb = new Set<string>(ms.flatMap((m) => (m.fotos || []).filter((f) => f.eo).map((f) => f.cod)))
      // El borrador local es la copia de trabajo de ESTE dispositivo y manda tal cual
      // (si se uniera con la base nunca se podría desmarcar algo sin guardar).
      // Para volver a lo guardado está "Borrar mis marcas" en el resumen.
      const crudo = localStorage.getItem(SEL_KEY + ':' + miRol)
      const local = crudo ? new Set<string>(JSON.parse(crudo)) : null
      if (miRol === 'zn') { setSelZN(local ?? baseZN); setSelOrb(baseOrb) }
      else { setSelOrb(local ?? baseOrb); setSelZN(baseZN) }
      if (urlK) localStorage.setItem(CLAVE_KEY, urlK)
    })
  }, [clave])

  const mio = rol === 'zn' ? selZN : selOrb
  useEffect(() => { localStorage.setItem(SEL_KEY + ':' + rol, JSON.stringify(Array.from(mio))) }, [mio, rol])

  // con una hoja abierta, la página de atrás no debe scrollear (mobile)
  useEffect(() => {
    const abierta = abierto !== null || resumen
    document.body.style.overflow = abierta ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [abierto, resumen])

  const toggle = (cod: string) => {
    const set = rol === 'zn' ? setSelZN : setSelOrb
    set((p) => { const n = new Set(p); if (n.has(cod)) n.delete(cod); else n.add(cod); return n })
  }
  // deja mis marcas en cero (pantalla + borrador del navegador); las del otro rol no se tocan
  const limpiar = () => {
    localStorage.removeItem(SEL_KEY + ':' + rol)
    ;(rol === 'zn' ? setSelZN : setSelOrb)(new Set())
  }
  const nZN = (m: ZModelo) => (m.fotos || []).filter((f) => selZN.has(f.cod)).length
  const nOrb = (m: ZModelo) => (m.fotos || []).filter((f) => selOrb.has(f.cod)).length

  const lista = useMemo(() => {
    const t = q.trim().toLowerCase()
    return modelos.filter((m) => {
      if (t && !m.modelo.toLowerCase().includes(t)) return false
      if (filtro === 'Elegidos ZN') return nZN(m) > 0
      if (filtro === 'Sugeridos Orbital') return nOrb(m) > 0
      if (filtro === 'Coincidencias') return (m.fotos || []).some((f) => selZN.has(f.cod) && selOrb.has(f.cod))
      if (filtro === 'Sin marcar') return nZN(m) === 0 && nOrb(m) === 0
      if (filtro === 'Novedades') return m.novedad
      return true
    })
  }, [modelos, q, filtro, selZN, selOrb])

  // grilla partida por categoría (solo las que tienen algo con el filtro puesto)
  const secciones = useMemo(
    () => CATEGORIAS.map((c) => ({ ...c, items: lista.filter((m) => catDe(m) === c.key) })).filter((s) => s.items.length),
    [lista],
  )
  // el orden de ‹ › dentro de la hoja sigue el orden visible (por categoría)
  const orden = useMemo(() => secciones.flatMap((s) => s.items), [secciones])

  // vista SKU: cada color marcado, directo, con su detalle
  const modoSku = FILTROS_SKU.includes(filtro)
  const skus = useMemo(() => {
    if (!modoSku) return []
    const out: { modelo: string; f: ZFoto }[] = []
    for (const m of orden) for (const f of m.fotos || []) {
      const a = selZN.has(f.cod), b = selOrb.has(f.cod)
      const pasa = filtro === 'Elegidos ZN' ? a : filtro === 'Sugeridos Orbital' ? b : a && b
      if (pasa) out.push({ modelo: m.modelo, f })
    }
    return out
  }, [orden, filtro, selZN, selOrb, modoSku])

  const ideal = useMemo(() => Array.from(selZN).filter((c) => selOrb.has(c)).length, [selZN, selOrb])

  if (!clave) return <ClaveGate onOk={setClave} />

  return (
    <div className="min-h-screen bg-[#FAFAFA] font-mono">
      <header className="sticky top-0 z-30 bg-white border-b border-black/10">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between gap-3">
          <Marca />
          <div className="flex items-center gap-2">
            <span className="hidden sm:inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide"
              style={{ borderColor: rol === 'zn' ? VERDE : ROJO, color: rol === 'zn' ? VERDE : ROJO }}>
              <span className="w-2 h-2 rounded-full" style={{ background: rol === 'zn' ? VERDE : ROJO }} />
              {rol === 'zn' ? 'Marcás como ZN' : 'Marcás como Orbital'}
            </span>
            <button onClick={() => setResumen(true)}
              className="inline-flex items-center gap-2 rounded-full text-white px-4 py-2 text-[12px] font-bold" style={{ background: AZUL }}>
              <Layers size={14} />La colección · {ideal}★
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-4 py-5">
        <div className="mb-4">
          <h1 className="text-[15px] font-bold tracking-wide uppercase">Selección de colección</h1>
          <p className="text-[11px] text-neutral-500 mt-1">
            Elegí primero el <b>modelo</b> y después los <b>colores</b>. Sin precios: es solo para armar la colección.
          </p>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-[10px]">
            <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded-full" style={{ background: VERDE }} /><b>{selZN.size}</b> elige ZN</span>
            <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded-full" style={{ background: ROJO }} /><b>{selOrb.size}</b> sugiere Orbital</span>
            <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-neutral-900" /><b>{ideal}</b> coinciden · el ideal</span>
          </div>
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
              style={filtro === f ? { background: f === 'Elegidos ZN' ? VERDE : f === 'Sugeridos Orbital' ? ROJO : f === 'Coincidencias' ? '#111827' : AZUL } : undefined}>{f}</button>
          ))}
        </div>

        {cargando && <p className="text-sm text-neutral-500 py-16 text-center">Cargando modelos…</p>}

        {/* Vista SKU: el detalle de cada color marcado */}
        {!cargando && modoSku && (
          skus.length === 0
            ? <p className="text-sm text-neutral-500 py-16 text-center">Todavía no hay nada en {filtro.toLowerCase()}.</p>
            : (
              <>
                <div className="text-[10px] uppercase tracking-[0.2em] text-neutral-400 mb-2">{skus.length} SKU</div>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                  {skus.map(({ modelo, f }) => (
                    <SkuCard key={f.cod} modelo={modelo} f={f} zn={selZN} orb={selOrb} onToggle={() => toggle(f.cod)} />
                  ))}
                </div>
              </>
            )
        )}

        {/* Vista modelo: grilla dividida por categoría */}
        {!cargando && !modoSku && (
          <>
            {secciones.length > 1 && (
              <div className="flex gap-1.5 overflow-x-auto pb-3 -mx-1 px-1">
                {secciones.map((s) => (
                  <a key={s.key} href={`#${slugCat(s.key)}`}
                    className="shrink-0 rounded-full px-3 py-1.5 text-[11px] font-medium bg-white border border-black/10 text-neutral-600">
                    {s.label} <span className="text-neutral-400">{s.items.length}</span>
                  </a>
                ))}
              </div>
            )}
            {lista.length === 0 && <p className="text-sm text-neutral-500 py-16 text-center">No hay modelos con ese filtro.</p>}
            {secciones.map((s) => {
              const ez = s.items.reduce((a, m) => a + nZN(m), 0)
              const eo = s.items.reduce((a, m) => a + nOrb(m), 0)
              return (
                <section key={s.key} id={slugCat(s.key)} className="mb-8 scroll-mt-20">
                  <div className="flex items-baseline gap-2 mb-2 border-b border-black/10 pb-1.5">
                    <h2 className="text-[12px] font-bold tracking-[0.18em] uppercase">{s.label}</h2>
                    <span className="text-[10px] text-neutral-400">
                      {s.items.length} {s.items.length === 1 ? 'modelo' : 'modelos'}
                      {ez > 0 && <span className="font-bold" style={{ color: VERDE }}> · {ez} ZN</span>}
                      {eo > 0 && <span className="font-bold" style={{ color: ROJO }}> · {eo} Orbital</span>}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                    {s.items.map((m) => (
                      <ModeloCard key={m.modelo} m={m} nZN={nZN(m)} nOrb={nOrb(m)} onOpen={() => setAbierto(orden.indexOf(m))} />
                    ))}
                  </div>
                </section>
              )
            })}
          </>
        )}
      </div>

      {abierto !== null && orden[abierto] && (
        <ColorSheet m={orden[abierto]} rol={rol} zn={selZN} orb={selOrb} toggle={toggle} onClose={() => setAbierto(null)}
          onPrev={abierto > 0 ? () => setAbierto(abierto - 1) : undefined}
          onNext={abierto < orden.length - 1 ? () => setAbierto(abierto + 1) : undefined} />
      )}
      {resumen && (
        <ResumenSheet modelos={modelos} rol={rol} zn={selZN} orb={selOrb} toggle={toggle} limpiar={limpiar}
          onClose={() => setResumen(false)} clave={clave} />
      )}
    </div>
  )
}
