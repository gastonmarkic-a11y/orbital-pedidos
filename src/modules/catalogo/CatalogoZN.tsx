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
import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { Search, X, Check, ChevronLeft, ChevronRight, Sparkles, AlertTriangle, Layers, Copy, Link2, BarChart3 } from 'lucide-react'
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
    // puerta propia del cobranding: los tokens B2B no entran acá y viceversa
    const { data, error } = await supabase.rpc('zn_clave_ok', { p: v.trim() })
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
        {!f.ok && <div className="text-[8px] text-amber-600 font-bold uppercase mt-0.5">Sin stock futuro</div>}
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
                  <AlertTriangle size={11} />Sin stock futuro
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
                  {!f.ok && e === 'no' && <span className="absolute top-1 left-1 w-2 h-2 rounded-full bg-amber-500" title="Sin stock futuro" />}
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
            <span>
              <b>Análisis de stock futuro:</b> {alerta.length === 1 ? 'este color no tiene' : `estos ${alerta.length} colores no tienen`} reposición
              proyectada para sostener la colección — {alerta.map((i) => `${i.modelo} ${colorLegible(i.f.c)}`).join(' · ')}.
              Conviene reemplazar{alerta.length === 1 ? 'lo' : 'los'} por otro color del mismo modelo.
            </span>
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
        {/* Ya no hay botón Guardar: cada marca se guarda sola. */}
        <button onClick={onClose} className="w-full rounded-xl text-white py-3 text-sm font-bold" style={{ background: AZUL }}>
          Seguir eligiendo
        </button>
        <p className="text-[10px] text-neutral-400 text-center mt-1.5">
          Se guarda solo: lo que marcás queda al toque, no hace falta confirmar.
        </p>
      </div>
    </div>
  )
}

// ── Mis links · vista de ZN sobre lo que promociona ─────────────────────────
// Canal exclusivo digital: cada anteojo que promociona tiene su propio link.
//   Shopify → link del producto + UTM (la atribución la da el UTM).
//   Mercado Libre → link del Programa de Colaboradores (ML atribuye el ítem
//   con su propio tracking, no usa UTM).
const PCT_ZN = 10

type ZLink = {
  modelo: string; imagen: string | null; colores: number
  url_shopify: string | null; url_ml: string | null
  visitas: number; pedidos: number; venta_neta: number
}

function LinkFila({ label, url, color }: { label: string; url: string | null; color: string }) {
  const [copiado, setCopiado] = useState(false)
  if (!url) {
    return (
      <div className="flex items-center gap-2 text-[10px] text-neutral-400 py-1">
        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: color, opacity: 0.3 }} />
        <span className="flex-1">{label}</span>
        <span className="italic">falta cargar</span>
      </div>
    )
  }
  return (
    <div className="flex items-center gap-2 text-[10px] py-1">
      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
      <a href={url} target="_blank" rel="noopener noreferrer" className="flex-1 truncate underline decoration-black/20">{label}</a>
      <button
        onClick={() => { navigator.clipboard?.writeText(url).then(() => { setCopiado(true); setTimeout(() => setCopiado(false), 1500) }) }}
        className="shrink-0 inline-flex items-center gap-1 rounded-md border border-black/10 px-1.5 py-0.5 font-bold">
        {copiado ? <><Check size={9} strokeWidth={3} />Copiado</> : <><Copy size={9} />Copiar</>}
      </button>
    </div>
  )
}

function MisLinks({ clave }: { clave: string }) {
  const [filas, setFilas] = useState<ZLink[] | null>(null)
  useEffect(() => {
    supabase.rpc('zn_mis_links', { p_clave: clave, p_periodo: null }).then(({ data }) => setFilas((data as ZLink[]) || []))
  }, [clave])

  if (!filas) return <p className="text-sm text-neutral-500 py-16 text-center">Cargando…</p>

  const neta = filas.reduce((a, f) => a + Number(f.venta_neta || 0), 0)
  const visitas = filas.reduce((a, f) => a + f.visitas, 0)
  const pedidos = filas.reduce((a, f) => a + f.pedidos, 0)
  const comision = neta * (PCT_ZN / 100)
  const sinLink = filas.filter((f) => !f.url_shopify && !f.url_ml).length
  const kAr = (n: number) => '$' + Math.round(n).toLocaleString('es-AR')

  return (
    <>
      <div className="mb-4">
        <h1 className="text-[15px] font-bold tracking-wide uppercase">Mis links</h1>
        <p className="text-[11px] text-neutral-500 mt-1">
          Canal <b>exclusivo digital</b>. Cada anteojo que promocionás tiene su link propio: el de la tienda
          lleva tu etiqueta y el de Mercado Libre sale del Programa de Colaboradores. Lo que entra por ahí
          es lo que se cuenta.
        </p>
      </div>

      {/* Resumen del período: la venta neta y el 10% */}
      <div className="rounded-2xl p-4 text-white mb-4" style={{ background: '#111827' }}>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="text-[10px] uppercase tracking-[0.18em] opacity-60">Mes en curso</div>
            <div className="text-[30px] font-bold leading-none mt-1">{kAr(comision)}</div>
          </div>
          <div className="flex gap-5 text-[11px]">
            {[['Visitas', visitas.toLocaleString('es-AR')], ['Pedidos', pedidos.toLocaleString('es-AR')], ['Venta neta', kAr(neta)]].map(([k, v]) => (
              <div key={k}>
                <div className="text-[9px] uppercase tracking-wide opacity-50">{k}</div>
                <div className="font-bold">{v}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {sinLink > 0 && (
        <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-3 text-[11px] text-amber-900 flex gap-2">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" />
          <span>
            <b>{sinLink} de {filas.length} modelos todavía no tienen link cargado.</b> Hasta que estén, esos
            anteojos no suman visitas ni ventas — el conteo arranca cuando el link existe.
          </span>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {filas.map((f) => (
          <div key={f.modelo} className="bg-white rounded-xl border border-black/10 overflow-hidden">
            <div className="aspect-[4/3] bg-white">
              {f.imagen ? <img src={f.imagen} alt={f.modelo} className="w-full h-full object-contain p-2" loading="lazy" /> : <Placeholder />}
            </div>
            <div className="px-3 py-2.5 border-t border-black/5">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[12px] font-bold tracking-wide uppercase">{f.modelo}</span>
                <span className="text-[10px] text-neutral-400">{f.colores} {f.colores === 1 ? 'color' : 'colores'}</span>
              </div>
              <div className="mt-1.5 border-t border-black/5 pt-1">
                <LinkFila label="Link tienda Orbital" url={f.url_shopify} color={AZUL} />
                <LinkFila label="Link Mercado Libre" url={f.url_ml} color="#1baf7a" />
              </div>
              <div className="mt-1.5 border-t border-black/5 pt-1.5 flex justify-between text-[10px]">
                <span className="text-neutral-500">Visitas <b className="text-black">{f.visitas.toLocaleString('es-AR')}</b></span>
                <span className="text-neutral-500">Pedidos <b className="text-black">{f.pedidos.toLocaleString('es-AR')}</b></span>
                <span className="text-neutral-500">Tu {PCT_ZN}% <b className="text-black">{kAr(Number(f.venta_neta || 0) * PCT_ZN / 100)}</b></span>
              </div>
            </div>
          </div>
        ))}
      </div>

      <p className="text-[10px] text-neutral-400 mt-4 leading-relaxed">
        La venta neta es sin IVA y sin el envío, y descuenta devoluciones y pedidos cancelados del mes.
        En la tienda se cuenta lo que entra por tu link; en Mercado Libre, lo que Colaboradores registra como
        convertido en ese artículo.
      </p>
    </>
  )
}

// ── Dashboard de ZN ─────────────────────────────────────────────────────────
// SOLO lo suyo: su alcance, sus visitas, sus pedidos, su venta y su 10%.
// Deliberadamente NO trae nada del panel interno de Orbital (ventas B2B,
// inversión en pauta, ROAS, parámetros de canal, estado de integraciones).
const C_SHOPIFY = '#eb6834'
const C_ML = '#1baf7a'

type SerieMes = { periodo: string; shopify: number; ml: number; alcance: number; visitas: number; pedidos: number }
type TopMod = { modelo: string; neta: number; shopify: number; ml: number }
type Fuente = 'zn' | 'orbital' | 'meta'
type Origen = { fuente: Fuente; alcance: number; visitas: number; pedidos: number; neta: number; acciones: number }
type Post = {
  id: number; fecha: string; fuente: Fuente; red: string; tipo: string; modelo: string
  destino: 'shopify' | 'ml'; url_pub: string | null; url_der: string | null
  alcance: number; visitas: number; pedidos: number; neta: number
}
type Resumen = { hay_datos: boolean; serie: SerieMes[]; top: TopMod[]; origenes: Origen[]; posts: Post[] }

// De dónde vino el resultado. La pauta va en gris: es el punto de comparación,
// no el sujeto. Los dos orgánicos llevan color porque son lo que se compara.
const FUENTE: Record<Fuente, { label: string; corto: string; color: string }> = {
  zn: { label: 'Orgánico · cuenta de Zaira', corto: 'ZN', color: '#4a3aa7' },
  orbital: { label: 'Orgánico · canales de Orbital', corto: 'Orbital', color: '#2a78d6' },
  meta: { label: 'Pauta de Meta', corto: 'Meta', color: '#8d8a82' },
}

// Ejemplo que se muestra SOLO mientras no haya seguimiento conectado, con el
// cartel puesto. En cuanto entra la primera fila real, se usa la real.
const EJEMPLO: Resumen = {
  hay_datos: false,
  serie: [
    { periodo: '2026-04', shopify: 1_940_000, ml: 620_000, alcance: 386_000, visitas: 4_120, pedidos: 61 },
    { periodo: '2026-05', shopify: 2_380_000, ml: 810_000, alcance: 441_000, visitas: 5_060, pedidos: 78 },
    { periodo: '2026-06', shopify: 2_120_000, ml: 1_140_000, alcance: 402_000, visitas: 4_780, pedidos: 74 },
    { periodo: '2026-07', shopify: 3_060_000, ml: 1_490_000, alcance: 588_000, visitas: 6_940, pedidos: 108 },
    { periodo: '2026-08', shopify: 3_840_000, ml: 1_920_000, alcance: 671_000, visitas: 8_310, pedidos: 131 },
  ],
  top: [
    { modelo: 'ADELAIDA', neta: 1_640_000, shopify: 1_190_000, ml: 450_000 },
    { modelo: '5TH AVENUE', neta: 1_280_000, shopify: 980_000, ml: 300_000 },
    { modelo: 'BUENOS AIRES I', neta: 1_010_000, shopify: 640_000, ml: 370_000 },
    { modelo: 'CENTRAL PARK', neta: 780_000, shopify: 520_000, ml: 260_000 },
    { modelo: 'ZETA 8', neta: 540_000, shopify: 310_000, ml: 230_000 },
  ],
  origenes: [
    { fuente: 'zn', alcance: 671_000, visitas: 8_310, pedidos: 131, neta: 3_420_000, acciones: 6 },
    { fuente: 'orbital', alcance: 214_000, visitas: 3_180, pedidos: 41, neta: 1_090_000, acciones: 9 },
    { fuente: 'meta', alcance: 986_000, visitas: 12_400, pedidos: 96, neta: 2_480_000, acciones: 4 },
  ],
  posts: [
    { id: 1, fecha: '2026-08-14', fuente: 'zn', red: 'Instagram', tipo: 'Reel', modelo: 'ADELAIDA', destino: 'shopify', url_pub: null, url_der: null, alcance: 268_000, visitas: 3_410, pedidos: 58, neta: 1_480_000 },
    { id: 2, fecha: '2026-08-22', fuente: 'zn', red: 'TikTok', tipo: 'Video', modelo: '5TH AVENUE', destino: 'ml', url_pub: null, url_der: null, alcance: 191_000, visitas: 2_240, pedidos: 34, neta: 910_000 },
    { id: 3, fecha: '2026-08-07', fuente: 'zn', red: 'Instagram', tipo: 'Historia', modelo: 'BUENOS AIRES I', destino: 'shopify', url_pub: null, url_der: null, alcance: 118_000, visitas: 1_610, pedidos: 24, neta: 640_000 },
    { id: 4, fecha: '2026-08-19', fuente: 'orbital', red: 'Instagram', tipo: 'Reel', modelo: 'CENTRAL PARK', destino: 'shopify', url_pub: null, url_der: null, alcance: 84_000, visitas: 1_290, pedidos: 18, neta: 470_000 },
    { id: 5, fecha: '2026-08-28', fuente: 'zn', red: 'Instagram', tipo: 'Post', modelo: 'ZETA 8', destino: 'shopify', url_pub: null, url_der: null, alcance: 94_000, visitas: 1_050, pedidos: 15, neta: 390_000 },
    { id: 6, fecha: '2026-08-11', fuente: 'orbital', red: 'Instagram', tipo: 'Historia', modelo: 'LONDRES', destino: 'ml', url_pub: null, url_der: null, alcance: 62_000, visitas: 940, pedidos: 13, neta: 340_000 },
    { id: 7, fecha: '2026-08-25', fuente: 'orbital', red: 'Facebook', tipo: 'Post', modelo: 'WYNWOOD', destino: 'shopify', url_pub: null, url_der: null, alcance: 41_000, visitas: 610, pedidos: 7, neta: 180_000 },
  ],
}

const mesCorto = (p: string) => {
  const M = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
  const [y, m] = p.split('-')
  return `${M[+m - 1]} ${y.slice(2)}`
}

function Dashboard({ clave }: { clave: string }) {
  const [r, setR] = useState<Resumen | null>(null)
  useEffect(() => {
    supabase.rpc('zn_resumen', { p_clave: clave }).then(({ data }) => {
      const d = data as Resumen | null
      setR(d && d.hay_datos && d.serie.length ? d : EJEMPLO)
    })
  }, [clave])

  if (!r) return <p className="text-sm text-neutral-500 py-16 text-center">Cargando…</p>

  const kAr = (n: number) => '$' + Math.round(n).toLocaleString('es-AR')
  const kM = (n: number) => '$' + (n / 1_000_000).toLocaleString('es-AR', { maximumFractionDigits: 1 }) + 'M'
  const ult = r.serie[r.serie.length - 1]
  const prev = r.serie[r.serie.length - 2]
  const netaMes = ult ? ult.shopify + ult.ml : 0
  const netaPrev = prev ? prev.shopify + prev.ml : 0
  const delta = netaPrev ? ((netaMes / netaPrev - 1) * 100) : 0
  const maxMes = Math.max(...r.serie.map((s) => s.shopify + s.ml), 1)
  const maxTop = Math.max(...r.top.map((t) => t.neta), 1)

  // Embudo: cada paso con su conversión respecto del anterior.
  const pasos = ult ? [
    { k: 'Alcance', v: ult.alcance, sub: 'personas que vieron el posteo' },
    { k: 'Visitas al link', v: ult.visitas, sub: 'entraron al anteojo' },
    { k: 'Pedidos', v: ult.pedidos, sub: 'compraron' },
  ] : []

  return (
    <>
      <div className="mb-4">
        <h1 className="text-[15px] font-bold tracking-wide uppercase">Mi dashboard</h1>
        <p className="text-[11px] text-neutral-500 mt-1">
          Cómo viene rindiendo lo que promocionás, mes a mes y por anteojo.
        </p>
      </div>

      {!r.hay_datos && (
        <div className="mb-4 rounded-xl border border-dashed border-black/25 bg-white p-3 text-[11px] flex gap-2">
          <AlertTriangle size={14} className="shrink-0 mt-0.5 text-neutral-500" />
          <span>
            <b>Números de ejemplo.</b> Todavía no está conectado el seguimiento de la tienda ni el de
            Mercado Libre, así que esto muestra cómo se va a ver. En cuanto empiecen a llegar los datos
            reales, la pantalla los usa sola.
          </span>
        </div>
      )}

      {/* Lo primero: la plata */}
      <div className="rounded-2xl p-4 text-white mb-4" style={{ background: '#111827' }}>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="text-[10px] uppercase tracking-[0.18em] opacity-60">
              {ult ? mesCorto(ult.periodo) : 'Mes en curso'}
            </div>
            <div className="text-[32px] font-bold leading-none mt-1">{kAr(netaMes * PCT_ZN / 100)}</div>
            {prev && (
              <div className="text-[11px] mt-1" style={{ color: delta >= 0 ? '#6ee7b7' : '#fca5a5' }}>
                {delta >= 0 ? '▲' : '▼'} {Math.abs(delta).toFixed(0)}% vs {mesCorto(prev.periodo)}
              </div>
            )}
          </div>
          <div className="flex gap-5 text-[11px]">
            {[['Venta neta', kAr(netaMes)], ['Visitas', (ult?.visitas ?? 0).toLocaleString('es-AR')],
              ['Pedidos', (ult?.pedidos ?? 0).toLocaleString('es-AR')]].map(([k, v]) => (
              <div key={k}>
                <div className="text-[9px] uppercase tracking-wide opacity-50">{k}</div>
                <div className="font-bold">{v}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Embudo */}
      <div className="bg-white rounded-xl p-4 border border-black/10 mb-4">
        <h2 className="text-[12px] font-bold uppercase tracking-wide">De la publicación a la venta</h2>
        <p className="text-[10px] text-neutral-500 mb-3">{ult ? mesCorto(ult.periodo) : ''}</p>
        {/* Escalones, no barras proporcionales: entre 671.000 y 131 no hay barra
            que se pueda dibujar sin que la última quede invisible. Lo que importa
            acá es el salto de un paso al siguiente. */}
        <div>
          {pasos.map((p, i) => {
            const anterior = i > 0 ? pasos[i - 1].v : null
            return (
              <div key={p.k}>
                {anterior != null && (
                  <div className="flex items-center gap-2 py-1 pl-3">
                    <span className="w-px h-4 bg-black/15" />
                    <span className="text-[10px] text-neutral-500">
                      pasó el <b className="text-black">{((p.v / anterior) * 100).toFixed(1)}%</b>
                    </span>
                  </div>
                )}
                <div className="flex items-baseline justify-between gap-3 rounded-lg bg-[#F5F5F7] px-3 py-2">
                  <div>
                    <div className="text-[11px] font-bold uppercase tracking-wide">{p.k}</div>
                    <div className="text-[10px] text-neutral-500">{p.sub}</div>
                  </div>
                  <div className="text-[20px] font-bold tabular-nums leading-none">{p.v.toLocaleString('es-AR')}</div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Evolución mensual, apilada por canal */}
      <div className="bg-white rounded-xl p-4 border border-black/10 mb-4">
        <h2 className="text-[12px] font-bold uppercase tracking-wide">Venta neta por mes</h2>
        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1 mb-3">
          <span className="inline-flex items-center gap-1.5 text-[10px] text-neutral-500">
            <span className="w-2.5 h-2.5 rounded-sm" style={{ background: C_SHOPIFY }} />Tienda Orbital
          </span>
          <span className="inline-flex items-center gap-1.5 text-[10px] text-neutral-500">
            <span className="w-2.5 h-2.5 rounded-sm" style={{ background: C_ML }} />Mercado Libre
          </span>
        </div>
        <div className="flex items-end gap-2 h-44">
          {r.serie.map((s) => {
            const tot = s.shopify + s.ml
            const h = (tot / maxMes) * 100
            return (
              <div key={s.periodo} className="flex-1 flex flex-col items-center justify-end h-full">
                <div className="text-[9px] font-bold mb-1 tabular-nums">{kM(tot)}</div>
                <div className="w-full flex flex-col justify-end gap-[2px]" style={{ height: `${h}%` }}>
                  <div style={{ background: C_ML, height: `${(s.ml / tot) * 100}%`, borderRadius: '4px 4px 0 0' }} />
                  <div style={{ background: C_SHOPIFY, height: `${(s.shopify / tot) * 100}%` }} />
                </div>
                <div className="text-[9px] text-neutral-500 mt-1">{mesCorto(s.periodo)}</div>
              </div>
            )
          })}
        </div>
        <p className="text-[10px] text-neutral-400 mt-2">
          Tu {PCT_ZN}% del último mes: <b className="text-black">{kAr(netaMes * PCT_ZN / 100)}</b>
        </p>
      </div>

      {/* De dónde vienen los resultados: los dos orgánicos vs la pauta.
          Sin inversión ni ROAS — el orgánico no tiene costo de medios, así que
          esas métricas no comparan nada. Estas cuatro sí. */}
      {r.origenes.length > 0 && (
        <div className="bg-white rounded-xl p-4 border border-black/10 mb-4">
          <h2 className="text-[12px] font-bold uppercase tracking-wide">De dónde vienen los resultados</h2>
          <p className="text-[10px] text-neutral-500 mb-3">
            El orgánico no tiene costo de medios, así que no se compara con ROAS. Estas cuatro miden lo mismo
            en las tres fuentes.
          </p>
          <div className="flex flex-wrap gap-x-4 gap-y-1 mb-3">
            {r.origenes.map((o) => (
              <span key={o.fuente} className="inline-flex items-center gap-1.5 text-[10px] text-neutral-500">
                <span className="w-2.5 h-2.5 rounded-sm" style={{ background: FUENTE[o.fuente].color }} />
                {FUENTE[o.fuente].label} · {o.acciones}
              </span>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {([
              ['Venta neta', (o: Origen) => o.neta, (v: number) => kM(v)],
              ['Visitas al link', (o: Origen) => o.visitas, (v: number) => v.toLocaleString('es-AR')],
              ['Conversión visita → pedido', (o: Origen) => (o.visitas ? (o.pedidos / o.visitas) * 100 : 0), (v: number) => v.toFixed(1) + '%'],
              ['Venta por cada 1.000 impresiones', (o: Origen) => (o.alcance ? (o.neta / o.alcance) * 1000 : 0), (v: number) => kAr(v)],
            ] as const).map(([titulo, calc, fmt]) => {
              const vals = r.origenes.map((o) => ({ o, v: calc(o) }))
              const max = Math.max(...vals.map((x) => x.v), 1)
              const gana = vals.reduce((a, b) => (b.v > a.v ? b : a))
              return (
                <div key={titulo} className="rounded-lg border border-black/10 p-3">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-[10px] uppercase tracking-wide text-neutral-500 leading-tight">{titulo}</span>
                    <span className="text-[10px] font-bold shrink-0" style={{ color: FUENTE[gana.o.fuente].color }}>
                      gana {FUENTE[gana.o.fuente].corto}
                    </span>
                  </div>
                  {vals.map(({ o, v }) => (
                    <div key={o.fuente} className="mt-1.5">
                      <div className="flex justify-between text-[10px] mb-0.5">
                        <span className="text-neutral-500">{FUENTE[o.fuente].corto}</span>
                        <b className="tabular-nums">{fmt(v)}</b>
                      </div>
                      <div className="h-2.5 rounded-r-[4px]" style={{ background: FUENTE[o.fuente].color, width: `${(v / max) * 100}%` }} />
                    </div>
                  ))}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Lo vital: QUÉ posteo orgánico rinde más */}
      {r.posts.length > 0 && (
        <div className="bg-white rounded-xl p-4 border border-black/10 mb-4">
          <h2 className="text-[12px] font-bold uppercase tracking-wide">Qué posteos rinden más</h2>
          <p className="text-[10px] text-neutral-500 mb-3">
            Solo orgánico, ordenado por venta. Sirve para saber qué repetir: red, formato y anteojo.
          </p>
          <div className="space-y-2">
            {r.posts.map((p, i) => {
              const maxP = r.posts[0].neta || 1
              const conv = p.visitas ? (p.pedidos / p.visitas) * 100 : 0
              return (
                <div key={p.id} className="rounded-lg border border-black/10 p-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-start gap-2 min-w-0">
                      <span className="text-[11px] font-bold text-neutral-300 tabular-nums mt-0.5">{i + 1}</span>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-[11px] font-bold uppercase tracking-wide">{p.modelo}</span>
                          <span className="rounded-full px-1.5 py-0.5 text-[8px] font-bold text-white"
                            style={{ background: FUENTE[p.fuente].color }}>{FUENTE[p.fuente].corto}</span>
                        </div>
                        <div className="text-[10px] text-neutral-500">
                          {p.red} · {p.tipo} · {p.destino === 'ml' ? 'Mercado Libre' : 'Tienda Orbital'}
                          {p.url_pub && <> · <a href={p.url_pub} target="_blank" rel="noopener noreferrer" className="underline">ver posteo</a></>}
                        </div>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-[13px] font-bold tabular-nums leading-none">{kM(p.neta)}</div>
                      <div className="text-[9px] text-neutral-400">tu {PCT_ZN}%: {kAr(p.neta * PCT_ZN / 100)}</div>
                    </div>
                  </div>
                  <div className="h-2 rounded-r-[4px] mt-1.5" style={{ background: FUENTE[p.fuente].color, width: `${(p.neta / maxP) * 100}%` }} />
                  <div className="flex gap-4 text-[9px] text-neutral-500 mt-1">
                    <span>Alcance <b className="text-black">{p.alcance.toLocaleString('es-AR')}</b></span>
                    <span>Visitas <b className="text-black">{p.visitas.toLocaleString('es-AR')}</b></span>
                    <span>Pedidos <b className="text-black">{p.pedidos}</b></span>
                    <span>Conversión <b className="text-black">{conv.toFixed(1)}%</b></span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Qué anteojo rinde más */}
      <div className="bg-white rounded-xl p-4 border border-black/10">
        <h2 className="text-[12px] font-bold uppercase tracking-wide">Qué anteojos rinden más</h2>
        <p className="text-[10px] text-neutral-500 mb-3">Venta neta acumulada, dividida por dónde se compró.</p>
        <div className="space-y-2.5">
          {r.top.map((t) => (
            <div key={t.modelo}>
              <div className="flex justify-between text-[11px] mb-0.5">
                <span className="font-bold uppercase tracking-wide">{t.modelo}</span>
                <span className="tabular-nums text-neutral-500">
                  {kAr(t.neta)} <span className="text-black font-bold">· tu {PCT_ZN}%: {kAr(t.neta * PCT_ZN / 100)}</span>
                </span>
              </div>
              <div className="flex gap-[2px] h-3" style={{ width: `${(t.neta / maxTop) * 100}%` }}>
                <div style={{ background: C_SHOPIFY, width: `${(t.shopify / t.neta) * 100}%`, borderRadius: '4px 0 0 4px' }} />
                <div style={{ background: C_ML, width: `${(t.ml / t.neta) * 100}%`, borderRadius: '0 4px 4px 0' }} />
              </div>
            </div>
          ))}
        </div>
      </div>

      <p className="text-[10px] text-neutral-400 mt-4 leading-relaxed">
        La venta neta es sin IVA y sin el envío, y descuenta devoluciones y pedidos cancelados del mes.
      </p>
    </>
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
  // Recién cuando cargó la base se puede escribir el borrador local. Si no, el
  // estado inicial vacío pisa el borrador y en la recarga siguiente aparece todo
  // desmarcado aunque la base tenga las marcas.
  const [listo, setListo] = useState(false)
  // Autoguardado: sin esto, lo que marca uno vive solo en SU navegador hasta que
  // toca "Guardar", y el otro ve un número distinto. Firma de lo último que quedó
  // efectivamente en la base, para no reescribir al pedo.
  const guardadoRef = useRef<string>('')
  const [sync, setSync] = useState<'ok' | 'guardando' | 'error'>('ok')
  const [q, setQ] = useState('')
  const [filtro, setFiltro] = useState<Filtro>('Todos')
  const [abierto, setAbierto] = useState<number | null>(null)
  const [resumen, setResumen] = useState(false)
  const [tab, setTab] = useState<'coleccion' | 'links' | 'dash'>('coleccion')

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
      // PERO un borrador VACÍO nunca gana: si ganara, un borrador vacío viejo
      // dejaría la pantalla en cero con las marcas guardadas en la base y sin
      // forma de recuperarlas (el botón de borrar se esconde cuando no hay marcas).
      let local: Set<string> | null = null
      try {
        const crudo = localStorage.getItem(SEL_KEY + ':' + miRol)
        const arr = crudo ? (JSON.parse(crudo) as string[]) : []
        if (Array.isArray(arr) && arr.length) local = new Set(arr)
        else localStorage.removeItem(SEL_KEY + ':' + miRol)
      } catch { localStorage.removeItem(SEL_KEY + ':' + miRol) }
      if (miRol === 'zn') { setSelZN(local ?? baseZN); setSelOrb(baseOrb) }
      else { setSelOrb(local ?? baseOrb); setSelZN(baseZN) }
      // La firma arranca en lo que dice la BASE, no en el borrador: si el
      // borrador local trae marcas sin guardar, el autoguardado las sube solo.
      const baseMio = miRol === 'zn' ? baseZN : baseOrb
      guardadoRef.current = JSON.stringify(Array.from(baseMio).sort())
      setListo(true)
      if (urlK) localStorage.setItem(CLAVE_KEY, urlK)
    })
  }, [clave])

  const mio = rol === 'zn' ? selZN : selOrb
  useEffect(() => {
    if (!listo) return
    localStorage.setItem(SEL_KEY + ':' + rol, JSON.stringify(Array.from(mio)))
  }, [mio, rol, listo])

  // Autoguardado con espera: cada cambio se sube solo. Como zn_guardar reemplaza
  // el set completo del rol y cada rol escribe SOLO su columna, no se pisan entre sí.
  useEffect(() => {
    if (!listo || !clave) return
    const firma = JSON.stringify(Array.from(mio).sort())
    if (firma === guardadoRef.current) return
    const t = setTimeout(() => {
      setSync('guardando')
      supabase.rpc('zn_guardar', { p_clave: clave, p_items: Array.from(mio) }).then(({ error }) => {
        if (error) setSync('error')
        else { guardadoRef.current = firma; setSync('ok') }
      })
    }, 700)
    return () => clearTimeout(t)
  }, [mio, listo, clave])

  // Refresco periódico contra la base, para que todos vean el mismo número sin
  // recargar. Trae SIEMPRE lo del otro rol; y lo propio solo cuando no hay nada
  // sin guardar en este dispositivo — así dos teléfonos del mismo rol convergen
  // en vez de pisarse, y nunca se pierde lo que se acaba de marcar acá.
  const mioRef = useRef(mio)
  mioRef.current = mio
  useEffect(() => {
    if (!listo || !clave) return
    const refrescar = () => {
      supabase.rpc('zn_home', { p_clave: clave }).then(({ data, error }) => {
        if (error || !data) return
        const ms = data as ZModelo[]
        setModelos(ms)
        const de = (propio: boolean) => new Set<string>(
          ms.flatMap((m) => (m.fotos || [])
            .filter((f) => ((rol === 'zn') === propio ? f.ez : f.eo))
            .map((f) => f.cod)),
        )
        ;(rol === 'zn' ? setSelOrb : setSelZN)(de(false))

        const firmaLocal = JSON.stringify(Array.from(mioRef.current).sort())
        if (firmaLocal !== guardadoRef.current) return   // hay cambios sin subir: no tocar
        const base = de(true)
        const firmaBase = JSON.stringify(Array.from(base).sort())
        if (firmaBase !== firmaLocal) {
          ;(rol === 'zn' ? setSelZN : setSelOrb)(base)
          guardadoRef.current = firmaBase
        }
      })
    }
    // Volver a la pestaña refresca al toque: en el celular se abre la app y se
    // mira, no se espera. Sin esto había que aguantar el intervalo o recargar.
    const alVolver = () => { if (document.visibilityState === 'visible') refrescar() }
    document.addEventListener('visibilitychange', alVolver)
    window.addEventListener('focus', refrescar)
    const id = setInterval(refrescar, 15000)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', alVolver)
      window.removeEventListener('focus', refrescar)
    }
  }, [listo, clave, rol])

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
            <span className="text-[10px] tabular-nums" style={{ color: sync === 'error' ? ROJO : '#9CA3AF' }}>
              {sync === 'guardando' ? 'Guardando…' : sync === 'error' ? '⚠ sin guardar' : 'Guardado'}
            </span>
            {tab === 'coleccion' && (
              <button onClick={() => setResumen(true)}
                className="inline-flex items-center gap-2 rounded-full text-white px-4 py-2 text-[12px] font-bold" style={{ background: AZUL }}>
                <Layers size={14} />La colección · {ideal}★
              </button>
            )}
          </div>
        </div>
        {/* Dos vistas: armar la colección y ver lo que rinde cada link. */}
        <div className="max-w-6xl mx-auto px-4 flex gap-1">
          {([['coleccion', 'Colección', Layers], ['links', 'Mis links', Link2], ['dash', 'Dashboard', BarChart3]] as const).map(([k, lbl, Ic]) => (
            <button key={k} onClick={() => setTab(k)}
              className={`inline-flex items-center gap-1.5 px-3 py-2 text-[11px] font-bold border-b-2 -mb-px ${
                tab === k ? 'border-current' : 'border-transparent text-neutral-400'}`}
              style={tab === k ? { color: AZUL } : undefined}>
              <Ic size={13} />{lbl}
            </button>
          ))}
        </div>
      </header>

      {tab === 'links' ? (
        <div className="max-w-6xl mx-auto px-4 py-5"><MisLinks clave={clave} /></div>
      ) : tab === 'dash' ? (
        <div className="max-w-6xl mx-auto px-4 py-5"><Dashboard clave={clave} /></div>
      ) : (
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
      )}

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
