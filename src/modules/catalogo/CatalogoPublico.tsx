import { Fragment, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { Search, X, ChevronLeft, ChevronRight, ShoppingCart, Plus, Minus, Trash2, Check, Star } from 'lucide-react'
import { colorLegible, colorSwatch } from './colorLegible'

// ── Catálogo B2B público (acceso con clave, independiente del login de la app) ──
// La óptica navega modelos → colores con stock (sin ver cantidades) → arma el pedido.
// Datos en vivo de `stock`; el checkout crea un pedido web en el flujo normal.

interface Modelo {
  modelo: string; precio_desde: number | null; caliente: boolean; n_colores: number
  tipos: string[]; clasificaciones: string[]; tratamientos: string[]; imagen: string | null
}
interface Variante {
  codigo: string; descripcion: string | null; tipo: string | null; tratamiento: string | null
  clasificacion: string | null; precio: number; precio_lista: number; tiene_preventa: boolean
  caliente: boolean; imagen: string | null
}
interface CartItem { codigo: string; modelo: string; descripcion: string | null; precio: number; cantidad: number; imagen: string | null }

const CLAVE_KEY = 'orbital_catalogo_clave'
const CART_KEY = 'orbital_catalogo_cart'
const kAr = (n: number | null) => (n == null ? '—' : '$' + Math.round(n).toLocaleString('es-AR'))
const cap = (s: string | null) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '')

// Placeholder elegante cuando el producto no tiene foto todavía
function Placeholder({ label }: { label?: string }) {
  return (
    <div className="w-full h-full flex flex-col items-center justify-center gap-2 bg-gradient-to-br from-[#F1EDE4] to-[#E9E3D6] text-[#B9AE97]">
      <svg width="56" height="28" viewBox="0 0 64 30" fill="none" stroke="currentColor" strokeWidth="2.5">
        <circle cx="15" cy="16" r="11" /><circle cx="49" cy="16" r="11" /><path d="M26 14h12M4 12l4-3M60 12l-4-3" />
      </svg>
      {label && <span className="text-[10px] tracking-wide uppercase">{label}</span>}
    </div>
  )
}

function Logo() {
  return (
    <div className="flex items-center gap-2">
      <img src="/logo-orbital.png" alt="Orbital" style={{ height: 22 }} onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')} />
      <span className="text-[10px] font-bold tracking-[0.3em] text-[#8F6A34] uppercase">Eyewear · B2B</span>
    </div>
  )
}

// ── Portón de clave ──
function ClaveGate({ onOk }: { onOk: (clave: string) => void }) {
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
    <div className="min-h-screen flex items-center justify-center bg-[#F6F4EF] px-4">
      <form onSubmit={probar} className="w-full max-w-sm bg-white border border-black/10 rounded-2xl shadow-sm p-8">
        <Logo />
        <div className="h-px bg-gradient-to-r from-[#8F6A34]/60 to-transparent my-4" />
        <p className="text-sm text-neutral-600 mb-5">Catálogo mayorista para ópticas. Ingresá la clave que te compartió Orbital.</p>
        <input autoFocus type="password" placeholder="Clave de acceso" value={v} onChange={(e) => setV(e.target.value)}
          className="w-full rounded-lg bg-white border border-black/10 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#8F6A34]/40" />
        {err && <p className="text-sm text-red-600 mt-2">{err}</p>}
        <button disabled={loading} className="w-full mt-4 rounded-lg bg-[#8F6A34] text-white py-2.5 text-sm font-medium disabled:opacity-50">
          {loading ? 'Verificando…' : 'Entrar al catálogo'}
        </button>
      </form>
    </div>
  )
}

export default function CatalogoPublico() {
  const [clave, setClave] = useState<string | null>(() => localStorage.getItem(CLAVE_KEY))
  const [claveOk, setClaveOk] = useState(false)
  const [modelos, setModelos] = useState<Modelo[]>([])
  const [loading, setLoading] = useState(true)
  // filtros
  const [q, setQ] = useState('')
  const [fTipo, setFTipo] = useState<string | null>(null)
  const [fClasif, setFClasif] = useState<string | null>(null)
  const [fTrat, setFTrat] = useState<string | null>(null)
  const [soloDestacados, setSoloDestacados] = useState(false)
  // navegación
  const [sel, setSel] = useState<Modelo | null>(null)
  const [quick, setQuick] = useState<Modelo | null>(null)
  const [carritoOpen, setCarritoOpen] = useState(false)
  const [cart, setCart] = useState<Record<string, CartItem>>(() => {
    try { return JSON.parse(localStorage.getItem(CART_KEY) || '{}') } catch { return {} }
  })

  useEffect(() => { localStorage.setItem(CART_KEY, JSON.stringify(cart)) }, [cart])

  // validar clave guardada al entrar
  useEffect(() => {
    if (!clave) { setLoading(false); return }
    supabase.rpc('catalogo_clave_ok', { p: clave }).then(({ data }) => {
      if (data === true) setClaveOk(true)
      else { localStorage.removeItem(CLAVE_KEY); setClave(null) }
      setLoading(false)
    })
  }, [clave])

  // cargar modelos
  useEffect(() => {
    if (!claveOk || !clave) return
    setLoading(true)
    supabase.rpc('catalogo_modelos', { p_clave: clave }).then(({ data, error }) => {
      setModelos(error ? [] : ((data as Modelo[]) ?? [])); setLoading(false)
    })
  }, [claveOk, clave])

  const tipos = useMemo(() => Array.from(new Set(modelos.flatMap((m) => m.tipos))).sort(), [modelos])
  const clasifs = useMemo(() => Array.from(new Set(modelos.flatMap((m) => m.clasificaciones))).sort(), [modelos])
  const trats = useMemo(() => Array.from(new Set(modelos.flatMap((m) => m.tratamientos))).sort(), [modelos])

  const filtrados = useMemo(() => {
    const qn = q.trim().toLowerCase()
    const base = modelos.filter((m) => {
      if (qn && !m.modelo.toLowerCase().includes(qn)) return false
      if (fTipo && !m.tipos.includes(fTipo)) return false
      if (fClasif && !m.clasificaciones.includes(fClasif)) return false
      if (fTrat && !m.tratamientos.includes(fTrat)) return false
      if (soloDestacados && !m.caliente) return false
      return true
    })
    // Los que tienen foto primero; los que faltan (sin imagen) quedan al final.
    return base.map((m, i) => ({ m, i })).sort((a, b) => {
      const ia = a.m.imagen ? 0 : 1, ib = b.m.imagen ? 0 : 1
      return ia - ib || a.i - b.i
    }).map((x) => x.m)
  }, [modelos, q, fTipo, fClasif, fTrat, soloDestacados])
  const sinFoto = filtrados.filter((m) => !m.imagen).length

  const cartCount = Object.values(cart).reduce((a, c) => a + c.cantidad, 0)
  const cartTotal = Object.values(cart).reduce((a, c) => a + c.cantidad * c.precio, 0)

  function addCart(v: Variante, modelo: string) {
    setCart((c) => {
      const prev = c[v.codigo]
      return { ...c, [v.codigo]: { codigo: v.codigo, modelo, descripcion: v.descripcion, precio: v.precio, imagen: v.imagen, cantidad: (prev?.cantidad ?? 0) + 1 } }
    })
  }
  function setQty(codigo: string, cantidad: number) {
    setCart((c) => {
      if (cantidad <= 0) { const { [codigo]: _x, ...rest } = c; return rest }
      return { ...c, [codigo]: { ...c[codigo], cantidad } }
    })
  }

  if (loading) return <div className="min-h-screen flex items-center justify-center text-sm text-neutral-500 bg-[#F6F4EF]">Cargando catálogo…</div>
  if (!clave || !claveOk) return <ClaveGate onOk={(c) => { setClave(c); setClaveOk(true) }} />

  const chip = (active: boolean) => `text-[11px] rounded-full px-3 py-1.5 border font-medium whitespace-nowrap transition ${active ? 'bg-[#8F6A34] text-white border-[#8F6A34]' : 'bg-white border-black/10 text-neutral-600 hover:border-[#8F6A34]/40'}`

  return (
    <div className="min-h-screen bg-[#F6F4EF] text-[#1c1a17]">
      {/* Header */}
      <header className="bg-white border-b border-black/10 sticky top-0 z-20">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <Logo />
          <button onClick={() => setCarritoOpen(true)} className="relative flex items-center gap-1.5 text-sm bg-[#8F6A34] text-white rounded-full px-4 py-2 font-medium">
            <ShoppingCart size={16} /> <span className="hidden sm:inline">Pedido</span>
            {cartCount > 0 && <span className="absolute -top-1.5 -right-1.5 bg-red-500 text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">{cartCount}</span>}
          </button>
        </div>
        {/* Buscador + filtros */}
        <div className="max-w-6xl mx-auto px-4 pb-3 space-y-2">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar modelo…"
              className="w-full rounded-full bg-[#F6F4EF] border border-black/10 pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#8F6A34]/30" />
          </div>
          <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
            <button onClick={() => setSoloDestacados((v) => !v)} className={chip(soloDestacados)}><Star size={11} className="inline mb-0.5 mr-0.5" />Destacados</button>
            {tipos.map((t) => <button key={t} onClick={() => setFTipo(fTipo === t ? null : t)} className={chip(fTipo === t)}>{cap(t)}</button>)}
            {clasifs.map((c) => <button key={c} onClick={() => setFClasif(fClasif === c ? null : c)} className={chip(fClasif === c)}>{cap(c)}</button>)}
            {trats.map((t) => <button key={t} onClick={() => setFTrat(fTrat === t ? null : t)} className={chip(fTrat === t)}>{cap(t)}</button>)}
          </div>
        </div>
      </header>

      {/* Grilla de modelos */}
      <main className="max-w-6xl mx-auto px-3 py-4">
        <p className="text-[11px] text-neutral-400 mb-3">
          {filtrados.length} modelo{filtrados.length !== 1 ? 's' : ''} disponible{filtrados.length !== 1 ? 's' : ''}
          {sinFoto > 0 && <span className="text-neutral-300"> · {sinFoto} con foto pendiente</span>}
        </p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
          {filtrados.map((m, idx) => (
            <Fragment key={m.modelo}>
              {sinFoto > 0 && !m.imagen && (idx === 0 || filtrados[idx - 1].imagen) && (
                <div className="col-span-2 md:col-span-4 mt-4 mb-1 flex items-center gap-3">
                  <span className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wide">Próximamente con foto</span>
                  <span className="flex-1 h-px bg-black/10" />
                </div>
              )}
              <div className="relative bg-white rounded-xl border border-black/10 overflow-hidden transition hover:border-[#8F6A34]/40 hover:shadow-sm">
                <button onClick={() => setSel(m)} className="text-left w-full block">
                  <div className="aspect-square bg-white relative">
                    {m.imagen ? <img src={m.imagen} alt={m.modelo} className="w-full h-full object-contain" /> : <Placeholder />}
                    {m.caliente && <span className="absolute top-2 left-2 bg-[#8F6A34] text-white text-[9px] font-bold rounded-full px-2 py-0.5 flex items-center gap-0.5"><Star size={9} />TOP</span>}
                  </div>
                  <div className="p-3 pb-2">
                    <p className="text-sm font-semibold truncate">{m.modelo}</p>
                    <p className="text-[11px] text-neutral-400">{m.n_colores} color{m.n_colores !== 1 ? 'es' : ''}</p>
                    <p className="text-base font-bold mt-1 text-[#8F6A34]">{kAr(m.precio_desde)}</p>
                  </div>
                </button>
                <button onClick={() => setQuick(m)} className="mx-3 mb-3 w-[calc(100%-1.5rem)] rounded-lg bg-[#8F6A34]/10 text-[#8F6A34] text-[12px] font-semibold py-1.5 flex items-center justify-center gap-1 hover:bg-[#8F6A34]/20">
                  <Plus size={14} /> Agregar
                </button>
              </div>
            </Fragment>
          ))}
        </div>
        {filtrados.length === 0 && <p className="text-sm text-neutral-400 text-center py-16">No hay modelos con esos filtros.</p>}
      </main>

      {quick && <QuickAdd modelo={quick} clave={clave} cart={cart} onAdd={addCart} onSetQty={setQty} onClose={() => setQuick(null)} onVerDetalle={() => { setSel(quick); setQuick(null) }} />}
      {sel && <ModeloSheet modelo={sel} clave={clave} cart={cart} onAdd={addCart} onSetQty={setQty} onClose={() => setSel(null)} />}
      {carritoOpen && <CarritoSheet cart={cart} clave={clave} onSetQty={setQty} onClose={() => setCarritoOpen(false)} onDone={() => setCart({})} />}

      {/* Barra flotante de pedido en mobile */}
      {cartCount > 0 && !carritoOpen && !sel && (
        <button onClick={() => setCarritoOpen(true)} className="md:hidden fixed bottom-4 inset-x-4 bg-[#8F6A34] text-white rounded-xl py-3 px-4 flex items-center justify-between shadow-lg z-20">
          <span className="text-sm font-medium">{cartCount} artículo{cartCount !== 1 ? 's' : ''}</span>
          <span className="text-sm font-bold">{kAr(cartTotal)} · Ver pedido →</span>
        </button>
      )}
    </div>
  )
}

// ── Carga rápida desde la grilla: elegir color y cantidad sin entrar al detalle ──
function QuickAdd({ modelo, clave, cart, onAdd, onSetQty, onClose, onVerDetalle }: {
  modelo: Modelo; clave: string; cart: Record<string, CartItem>
  onAdd: (v: Variante, modelo: string) => void; onSetQty: (codigo: string, n: number) => void; onClose: () => void; onVerDetalle: () => void
}) {
  const [vars, setVars] = useState<Variante[]>([])
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    supabase.rpc('catalogo_modelo', { p_clave: clave, p_modelo: modelo.modelo }).then(({ data, error }) => {
      setVars(error ? [] : ((data as Variante[]) ?? [])); setLoading(false)
    })
  }, [clave, modelo.modelo])
  return (
    <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white w-full sm:max-w-md sm:rounded-2xl rounded-t-2xl max-h-[80vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-black/5 px-4 py-3 flex items-center justify-between z-10">
          <div>
            <h2 className="text-base font-bold">{modelo.modelo}</h2>
            <p className="text-[11px] text-neutral-400">Elegí color y cantidad</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-full hover:bg-black/5"><X size={20} /></button>
        </div>
        {loading ? <p className="text-sm text-neutral-500 p-6 text-center">Cargando colores…</p> : (
          <div className="p-3 space-y-1.5">
            {vars.map((v) => {
              const q = cart[v.codigo]?.cantidad ?? 0
              return (
                <div key={v.codigo} className="flex items-center gap-2.5 rounded-xl border border-black/10 p-2">
                  <span className="w-6 h-6 rounded-full shrink-0 border border-black/10" style={{ background: colorSwatch(v.descripcion) }} />
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-medium truncate">{colorLegible(v.descripcion) || v.codigo}</p>
                    <p className="text-[12px] font-bold text-[#8F6A34]">{kAr(v.precio)}{v.tiene_preventa && <span className="text-[10px] text-neutral-400 line-through ml-1">{kAr(v.precio_lista)}</span>}</p>
                  </div>
                  {q === 0 ? (
                    <button onClick={() => onAdd(v, modelo.modelo)} className="shrink-0 w-9 h-9 rounded-lg bg-[#8F6A34] text-white flex items-center justify-center"><Plus size={16} /></button>
                  ) : (
                    <div className="flex items-center gap-1 shrink-0">
                      <button onClick={() => onSetQty(v.codigo, q - 1)} className="w-8 h-8 rounded-lg border border-black/10 flex items-center justify-center"><Minus size={14} /></button>
                      <span className="w-6 text-center text-sm font-bold">{q}</span>
                      <button onClick={() => onSetQty(v.codigo, q + 1)} className="w-8 h-8 rounded-lg border border-black/10 flex items-center justify-center"><Plus size={14} /></button>
                    </div>
                  )}
                </div>
              )
            })}
            <button onClick={onVerDetalle} className="w-full text-[12px] text-[#8F6A34] font-medium py-2 mt-1">Ver fotos y detalle →</button>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Ficha del modelo con carrusel de colores ──
function ModeloSheet({ modelo, clave, cart, onAdd, onSetQty, onClose }: {
  modelo: Modelo; clave: string; cart: Record<string, CartItem>
  onAdd: (v: Variante, modelo: string) => void; onSetQty: (codigo: string, n: number) => void; onClose: () => void
}) {
  const [vars, setVars] = useState<Variante[]>([])
  const [i, setI] = useState(0)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    supabase.rpc('catalogo_modelo', { p_clave: clave, p_modelo: modelo.modelo }).then(({ data, error }) => {
      setVars(error ? [] : ((data as Variante[]) ?? [])); setLoading(false)
    })
  }, [clave, modelo.modelo])
  const v = vars[i]
  const enCarrito = v ? cart[v.codigo]?.cantidad ?? 0 : 0

  return (
    <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white w-full sm:max-w-lg sm:rounded-2xl rounded-t-2xl max-h-[92vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-black/5 px-4 py-3 flex items-center justify-between z-10">
          <div>
            <h2 className="text-base font-bold">{modelo.modelo}</h2>
            <p className="text-[11px] text-neutral-400">{vars.length} colores con stock</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-full hover:bg-black/5"><X size={20} /></button>
        </div>

        {loading ? <p className="text-sm text-neutral-500 p-8 text-center">Cargando colores…</p> : !v ? (
          <p className="text-sm text-neutral-400 p-8 text-center">Sin stock disponible.</p>
        ) : (
          <div className="p-4">
            {/* Imagen grande */}
            <div className="aspect-square bg-white rounded-xl border border-black/5 relative overflow-hidden">
              {v.imagen ? <img src={v.imagen} alt={v.descripcion ?? ''} className="w-full h-full object-contain" /> : <Placeholder label="Sin foto aún" />}
              {vars.length > 1 && (
                <>
                  <button onClick={() => setI((i - 1 + vars.length) % vars.length)} className="absolute left-2 top-1/2 -translate-y-1/2 bg-white/90 rounded-full p-1.5 shadow"><ChevronLeft size={18} /></button>
                  <button onClick={() => setI((i + 1) % vars.length)} className="absolute right-2 top-1/2 -translate-y-1/2 bg-white/90 rounded-full p-1.5 shadow"><ChevronRight size={18} /></button>
                </>
              )}
              {v.tiene_preventa && <span className="absolute top-2 right-2 bg-red-500 text-white text-[10px] font-bold rounded-full px-2 py-0.5">PREVENTA</span>}
            </div>

            {/* Tira de colores */}
            {vars.length > 1 && (
              <div className="flex gap-2 overflow-x-auto py-3 -mx-1 px-1">
                {vars.map((vv, idx) => (
                  <button key={vv.codigo} onClick={() => setI(idx)}
                    className={`shrink-0 w-14 h-14 rounded-lg border-2 overflow-hidden bg-white relative ${idx === i ? 'border-[#8F6A34]' : 'border-black/10'}`}>
                    {vv.imagen ? <img src={vv.imagen} alt="" className="w-full h-full object-contain" /> : <Placeholder />}
                    <span className="absolute bottom-0.5 right-0.5 w-3.5 h-3.5 rounded-full border border-white shadow-sm" style={{ background: colorSwatch(vv.descripcion) }} />
                  </button>
                ))}
              </div>
            )}

            {/* Detalle del color */}
            <div className="mt-2">
              <p className="text-sm font-semibold flex items-center gap-2">
                <span className="w-4 h-4 rounded-full border border-black/10 shrink-0" style={{ background: colorSwatch(v.descripcion) }} />
                {colorLegible(v.descripcion) || v.codigo}
              </p>
              <div className="flex flex-wrap gap-1.5 mt-1.5">
                {[v.tipo, v.clasificacion, v.tratamiento].filter(Boolean).map((t) => (
                  <span key={t} className="text-[10px] rounded-full px-2 py-0.5 bg-[#F1EDE4] text-neutral-600">{cap(t)}</span>
                ))}
              </div>
              <div className="flex items-baseline gap-2 mt-3">
                <span className="text-2xl font-bold text-[#8F6A34]">{kAr(v.precio)}</span>
                {v.tiene_preventa && <span className="text-sm text-neutral-400 line-through">{kAr(v.precio_lista)}</span>}
                <span className="text-[11px] text-neutral-400">+ IVA</span>
              </div>
            </div>

            {/* Agregar */}
            <div className="mt-4">
              {enCarrito === 0 ? (
                <button onClick={() => onAdd(v, modelo.modelo)} className="w-full bg-[#8F6A34] text-white rounded-xl py-3 text-sm font-medium flex items-center justify-center gap-2">
                  <Plus size={16} /> Agregar al pedido
                </button>
              ) : (
                <div className="flex items-center justify-between bg-[#F1EDE4] rounded-xl p-1.5">
                  <button onClick={() => onSetQty(v.codigo, enCarrito - 1)} className="w-11 h-11 rounded-lg bg-white flex items-center justify-center"><Minus size={16} /></button>
                  <span className="text-base font-bold">{enCarrito} en el pedido</span>
                  <button onClick={() => onSetQty(v.codigo, enCarrito + 1)} className="w-11 h-11 rounded-lg bg-white flex items-center justify-center"><Plus size={16} /></button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Carrito + checkout ──
function CarritoSheet({ cart, clave, onSetQty, onClose, onDone }: {
  cart: Record<string, CartItem>; clave: string
  onSetQty: (codigo: string, n: number) => void; onClose: () => void; onDone: () => void
}) {
  const items = Object.values(cart)
  const total = items.reduce((a, c) => a + c.cantidad * c.precio, 0)
  const unidades = items.reduce((a, c) => a + c.cantidad, 0)
  const [fase, setFase] = useState<'carrito' | 'datos' | 'ok'>('carrito')
  const [ident, setIdent] = useState('')
  const [razon, setRazon] = useState('')
  const [pedirRazon, setPedirRazon] = useState(false)
  const [contacto, setContacto] = useState('')
  const [wsp, setWsp] = useState('')
  const [mail, setMail] = useState('')
  const [obs, setObs] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [result, setResult] = useState<{ pedido_id: number; cliente: string; identificado: boolean } | null>(null)

  async function enviar() {
    setEnviando(true); setErr(null)
    const payload = items.map((c) => ({ codigo: c.codigo, modelo: c.modelo, descripcion: c.descripcion, cantidad: c.cantidad, precio: c.precio }))
    const { data, error } = await supabase.rpc('catalogo_checkout', {
      p_clave: clave, p_identificador: ident.trim(), p_contacto: contacto.trim(),
      p_wsp: wsp.trim(), p_mail: mail.trim(), p_items: payload, p_obs: obs.trim(), p_razon: razon.trim() || null,
    })
    setEnviando(false)
    if (error) { setErr('No se pudo enviar. Revisá la conexión.'); return }
    const r = data as { ok: boolean; need?: string; error?: string; pedido_id?: number; cliente?: string; identificado?: boolean }
    if (!r.ok) {
      if (r.need === 'razon') { setPedirRazon(true); setErr('No encontramos tu óptica. Ingresá la razón social para registrar el pedido.') }
      else setErr(r.error || 'No se pudo enviar.')
      return
    }
    setResult({ pedido_id: r.pedido_id!, cliente: r.cliente!, identificado: !!r.identificado })
    setFase('ok'); onDone()
  }

  return (
    <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white w-full sm:max-w-lg sm:rounded-2xl rounded-t-2xl max-h-[92vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-black/5 px-4 py-3 flex items-center justify-between z-10">
          <h2 className="text-base font-bold">{fase === 'ok' ? 'Pedido enviado' : 'Tu pedido'}</h2>
          <button onClick={onClose} className="p-1.5 rounded-full hover:bg-black/5"><X size={20} /></button>
        </div>

        {fase === 'ok' && result ? (
          <div className="p-6 text-center">
            <div className="w-14 h-14 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto mb-3"><Check size={28} /></div>
            <p className="text-sm font-semibold">¡Recibimos tu pedido! (N° {result.pedido_id})</p>
            <p className="text-sm text-neutral-500 mt-1">{result.cliente}</p>
            <p className="text-xs text-neutral-400 mt-3">
              {result.identificado ? 'Tu vendedor asignado lo va a revisar y confirmar a la brevedad.' : 'Un asesor comercial se va a contactar para confirmar los datos.'}
            </p>
            <button onClick={onClose} className="mt-5 bg-[#8F6A34] text-white rounded-xl py-2.5 px-6 text-sm font-medium">Seguir viendo</button>
          </div>
        ) : items.length === 0 ? (
          <p className="text-sm text-neutral-400 p-10 text-center">Tu pedido está vacío.</p>
        ) : fase === 'carrito' ? (
          <>
            <div className="p-3 space-y-2">
              {items.map((c) => (
                <div key={c.codigo} className="flex items-center gap-3 bg-[#F6F4EF] rounded-xl p-2">
                  <div className="w-14 h-14 rounded-lg bg-white border border-black/5 overflow-hidden shrink-0">
                    {c.imagen ? <img src={c.imagen} alt="" className="w-full h-full object-contain" /> : <Placeholder />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{c.modelo}</p>
                    <p className="text-[11px] text-neutral-500 truncate">{colorLegible(c.descripcion)}</p>
                    <p className="text-sm font-bold text-[#8F6A34]">{kAr(c.precio)}</p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button onClick={() => onSetQty(c.codigo, c.cantidad - 1)} className="w-8 h-8 rounded-lg bg-white border border-black/10 flex items-center justify-center"><Minus size={14} /></button>
                    <span className="w-6 text-center text-sm font-bold">{c.cantidad}</span>
                    <button onClick={() => onSetQty(c.codigo, c.cantidad + 1)} className="w-8 h-8 rounded-lg bg-white border border-black/10 flex items-center justify-center"><Plus size={14} /></button>
                    <button onClick={() => onSetQty(c.codigo, 0)} className="w-8 h-8 rounded-lg text-red-500 flex items-center justify-center"><Trash2 size={14} /></button>
                  </div>
                </div>
              ))}
            </div>
            <div className="sticky bottom-0 bg-white border-t border-black/10 p-4">
              <div className="flex justify-between text-sm mb-3"><span className="text-neutral-500">{unidades} unidades · subtotal</span><span className="font-bold text-lg">{kAr(total)} <span className="text-[11px] font-normal text-neutral-400">+ IVA</span></span></div>
              <button onClick={() => setFase('datos')} className="w-full bg-[#8F6A34] text-white rounded-xl py-3 text-sm font-medium">Continuar</button>
            </div>
          </>
        ) : (
          <div className="p-4 space-y-3">
            <div>
              <label className="text-[11px] font-medium text-neutral-500">Código de cliente, CUIT o email *</label>
              <input value={ident} onChange={(e) => setIdent(e.target.value)} placeholder="Ej: 030554 · 30-12345678-9 · optica@mail.com"
                className="w-full mt-1 rounded-lg border border-black/10 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#8F6A34]/30" />
            </div>
            {pedirRazon && (
              <div>
                <label className="text-[11px] font-medium text-neutral-500">Razón social / nombre de la óptica *</label>
                <input value={razon} onChange={(e) => setRazon(e.target.value)} placeholder="Nombre de tu óptica"
                  className="w-full mt-1 rounded-lg border border-black/10 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#8F6A34]/30" />
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[11px] font-medium text-neutral-500">WhatsApp</label>
                <input value={wsp} onChange={(e) => setWsp(e.target.value)} className="w-full mt-1 rounded-lg border border-black/10 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#8F6A34]/30" />
              </div>
              <div>
                <label className="text-[11px] font-medium text-neutral-500">Email</label>
                <input value={mail} onChange={(e) => setMail(e.target.value)} className="w-full mt-1 rounded-lg border border-black/10 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#8F6A34]/30" />
              </div>
            </div>
            <div>
              <label className="text-[11px] font-medium text-neutral-500">Contacto / nombre</label>
              <input value={contacto} onChange={(e) => setContacto(e.target.value)} className="w-full mt-1 rounded-lg border border-black/10 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#8F6A34]/30" />
            </div>
            <div>
              <label className="text-[11px] font-medium text-neutral-500">Observaciones</label>
              <textarea value={obs} onChange={(e) => setObs(e.target.value)} rows={2} className="w-full mt-1 rounded-lg border border-black/10 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#8F6A34]/30" />
            </div>
            {err && <p className="text-sm text-red-600">{err}</p>}
            <div className="flex justify-between text-sm pt-1"><span className="text-neutral-500">{unidades} unidades</span><span className="font-bold text-lg">{kAr(total)}</span></div>
            <div className="flex gap-2">
              <button onClick={() => setFase('carrito')} className="rounded-xl border border-black/10 py-3 px-5 text-sm font-medium">Volver</button>
              <button onClick={enviar} disabled={enviando || !ident.trim() || (pedirRazon && !razon.trim())} className="flex-1 bg-[#8F6A34] text-white rounded-xl py-3 text-sm font-medium disabled:opacity-50">
                {enviando ? 'Enviando…' : 'Enviar pedido'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
