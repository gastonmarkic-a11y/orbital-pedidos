import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { Search, X, ShoppingCart, Plus, Minus, Check, ChevronLeft, ChevronRight } from 'lucide-react'

// ── Orbital USA — independent wholesale catalog (Miami stock, USD, English) ──
// Shared login (email + password). Quantities are hidden; only in-stock is shown.
// Data: table stock_usa via RPCs catalogo_usa_login / _home / _checkout.

interface Color { sku: string; color: string; precio: number; in_stock: boolean; foto: string | null }
interface Modelo {
  modelo: string; precio_desde: number; n_colores: number; in_stock: boolean
  tipo: string | null; clasificacion: string | null; imagenes: string[]; colores: Color[]
}
interface CartItem { sku: string; modelo: string; color: string; precio: number; cantidad: number; foto: string | null }

const CLAVE_KEY = 'orbital_usa_clave'
const CART_KEY = 'orbital_usa_cart'
const AZUL = '#0004FF'
const usd = (n: number) => '$' + Math.round(n).toLocaleString('en-US')

function Placeholder() {
  return (
    <div className="w-full h-full flex items-center justify-center bg-neutral-100 text-neutral-300">
      <svg width="56" height="26" viewBox="0 0 64 30" fill="none" stroke="currentColor" strokeWidth="2.5">
        <circle cx="15" cy="15" r="11" /><circle cx="49" cy="15" r="11" /><path d="M26 13h12M4 11l4-3M60 11l-4-3" />
      </svg>
    </div>
  )
}

function LoginGate({ onOk }: { onOk: (clave: string) => void }) {
  const [email, setEmail] = useState('')
  const [pass, setPass] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setLoading(true); setErr(null)
    const { data, error } = await supabase.rpc('catalogo_usa_login', { p_email: email.trim(), p_clave: pass })
    setLoading(false)
    if (error) { setErr('Connection error'); return }
    if ((data as any)?.ok) { localStorage.setItem(CLAVE_KEY, pass); onOk(pass) }
    else setErr('Wrong email or password')
  }
  return (
    <div className="min-h-screen flex items-center justify-center bg-white px-4 font-sans">
      <form onSubmit={submit} className="w-full max-w-sm bg-white border border-black/10 rounded-2xl shadow-sm p-8">
        <img src="/logo-orbital.png" alt="Orbital" style={{ height: 24 }} onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')} />
        <p className="text-[10px] font-bold tracking-[0.3em] uppercase mt-2" style={{ color: AZUL }}>Eyewear · USA Wholesale</p>
        <div className="h-px my-4" style={{ background: `linear-gradient(90deg, ${AZUL}99, transparent)` }} />
        <p className="text-sm text-neutral-600 mb-5">Sign in to browse the US catalog and place orders.</p>
        <label className="block text-xs text-neutral-500 mb-1">Email</label>
        <input type="email" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@email.com"
          className="w-full rounded-lg bg-white border border-black/10 px-3 py-2.5 text-sm mb-3 focus:outline-none focus:ring-2" style={{ ['--tw-ring-color' as any]: `${AZUL}55` }} />
        <label className="block text-xs text-neutral-500 mb-1">Password</label>
        <input type="password" value={pass} onChange={(e) => setPass(e.target.value)} placeholder="Password"
          className="w-full rounded-lg bg-white border border-black/10 px-3 py-2.5 text-sm focus:outline-none focus:ring-2" style={{ ['--tw-ring-color' as any]: `${AZUL}55` }} />
        {err && <p className="text-sm text-red-600 mt-2">{err}</p>}
        <button disabled={loading} className="w-full mt-5 rounded-lg text-white py-2.5 text-sm font-semibold disabled:opacity-50" style={{ background: AZUL }}>
          {loading ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  )
}

function ColorCarousel({ imgs }: { imgs: string[] }) {
  const [i, setI] = useState(0)
  if (!imgs.length) return <div className="aspect-square w-full"><Placeholder /></div>
  return (
    <div className="relative aspect-square w-full bg-white">
      <img src={imgs[i]} alt="" className="w-full h-full object-contain" />
      {imgs.length > 1 && (
        <>
          <button onClick={() => setI((i - 1 + imgs.length) % imgs.length)} className="absolute left-2 top-1/2 -translate-y-1/2 bg-white/90 rounded-full p-1.5 shadow"><ChevronLeft size={18} /></button>
          <button onClick={() => setI((i + 1) % imgs.length)} className="absolute right-2 top-1/2 -translate-y-1/2 bg-white/90 rounded-full p-1.5 shadow"><ChevronRight size={18} /></button>
        </>
      )}
    </div>
  )
}

function ModelSheet({ m, onClose, add }: { m: Modelo; onClose: () => void; add: (c: Color, m: Modelo) => void }) {
  const [added, setAdded] = useState<Record<string, boolean>>({})
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white w-full sm:max-w-lg sm:rounded-2xl rounded-t-2xl max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-black/5 px-4 py-3 flex items-center justify-between">
          <div>
            <p className="text-base font-bold">{m.modelo}</p>
            <p className="text-xs text-neutral-500">{m.n_colores} colors · from {usd(m.precio_desde)}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-full hover:bg-black/5"><X size={20} /></button>
        </div>
        {m.imagenes.length > 0 && <ColorCarousel imgs={m.imagenes} />}
        <div className="divide-y divide-black/5">
          {m.colores.map((c) => (
            <div key={c.sku} className="flex items-center gap-3 px-4 py-2.5">
              <div className="w-12 h-12 rounded-lg overflow-hidden border border-black/5 shrink-0 bg-white">
                {c.foto || m.imagenes[0] ? <img src={c.foto || m.imagenes[0]} alt="" className="w-full h-full object-contain" /> : <Placeholder />}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm truncate">{c.color || '—'}</p>
                <p className="text-xs font-semibold" style={{ color: AZUL }}>{usd(c.precio)}</p>
              </div>
              {c.in_stock ? (
                <button
                  onClick={() => { add(c, m); setAdded((a) => ({ ...a, [c.sku]: true })); setTimeout(() => setAdded((a) => ({ ...a, [c.sku]: false })), 1200) }}
                  className="text-xs font-semibold rounded-lg text-white px-3 py-1.5 flex items-center gap-1" style={{ background: added[c.sku] ? '#0a8f56' : AZUL }}>
                  {added[c.sku] ? <><Check size={13} /> Added</> : <><Plus size={13} /> Add</>}
                </button>
              ) : (
                <span className="text-[11px] text-neutral-400 font-medium">Out of stock</span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export default function CatalogoUSA() {
  const [clave, setClave] = useState<string | null>(() => localStorage.getItem(CLAVE_KEY))
  const [claveOk, setClaveOk] = useState(false)
  const [modelos, setModelos] = useState<Modelo[]>([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [tipo, setTipo] = useState<'all' | 'sol' | 'receta'>('all')
  const [sel, setSel] = useState<Modelo | null>(null)
  const [cartOpen, setCartOpen] = useState(false)
  const [cart, setCart] = useState<Record<string, CartItem>>(() => {
    try { return JSON.parse(localStorage.getItem(CART_KEY) || '{}') } catch { return {} }
  })
  const [form, setForm] = useState({ nombre: '', email: '', empresa: '', notas: '' })
  const [enviando, setEnviando] = useState(false)
  const [okPedido, setOkPedido] = useState<{ id: number; units: number; total: number } | null>(null)

  useEffect(() => { localStorage.setItem(CART_KEY, JSON.stringify(cart)) }, [cart])

  useEffect(() => {
    if (!clave) { setLoading(false); return }
    supabase.rpc('catalogo_usa_home', { p_clave: clave }).then(({ data }) => {
      const r = data as any
      if (r?.ok) { setClaveOk(true); setModelos(r.modelos as Modelo[]) }
      else { localStorage.removeItem(CLAVE_KEY); setClave(null) }
      setLoading(false)
    })
  }, [clave])

  const qn = q.trim().toLowerCase()
  const visibles = useMemo(() => modelos.filter((m) =>
    (!qn || m.modelo.toLowerCase().includes(qn)) &&
    (tipo === 'all' || (m.tipo || '') === tipo)
  ), [modelos, qn, tipo])

  const cartItems = Object.values(cart)
  const cartCount = cartItems.reduce((a, c) => a + c.cantidad, 0)
  const cartTotal = cartItems.reduce((a, c) => a + c.cantidad * c.precio, 0)

  function add(c: Color, m: Modelo) {
    setCart((prev) => ({ ...prev, [c.sku]: { sku: c.sku, modelo: m.modelo, color: c.color, precio: c.precio, foto: c.foto || m.imagenes[0] || null, cantidad: (prev[c.sku]?.cantidad ?? 0) + 1 } }))
  }
  function setQty(sku: string, n: number) {
    setCart((prev) => { if (n <= 0) { const { [sku]: _x, ...rest } = prev; return rest } return { ...prev, [sku]: { ...prev[sku], cantidad: n } } })
  }

  async function checkout() {
    if (!cartItems.length || !clave) return
    if (!form.nombre.trim() || !form.email.trim()) return
    setEnviando(true)
    const { data, error } = await supabase.rpc('catalogo_usa_checkout', {
      p_clave: clave, p_nombre: form.nombre, p_email: form.email, p_empresa: form.empresa, p_notas: form.notas,
      p_items: cartItems.map((c) => ({ sku: c.sku, cantidad: c.cantidad })),
    })
    setEnviando(false)
    const r = data as any
    if (error || !r?.ok) return
    setOkPedido({ id: r.id, units: r.units, total: r.total })
    setCart({}); setForm({ nombre: '', email: '', empresa: '', notas: '' })
  }

  if (loading) return <div className="min-h-screen flex items-center justify-center text-sm text-neutral-500 bg-white font-sans">Loading catalog…</div>
  if (!clave || !claveOk) return <LoginGate onOk={(c) => { setClave(c); setClaveOk(true) }} />

  const tipos: { k: 'all' | 'sol' | 'receta'; label: string }[] = [
    { k: 'all', label: 'All' }, { k: 'sol', label: 'Sunglasses' }, { k: 'receta', label: 'Optical / Rx' },
  ]

  return (
    <div className="min-h-screen bg-white text-[#0a0a0a] font-sans">
      <div className="text-white text-[10px] tracking-[0.25em] uppercase text-center py-1.5 px-3" style={{ background: '#0a0a0a' }}>
        Orbital® · USA Wholesale — live stock · prices in USD
      </div>
      <header className="bg-white border-b border-black/10 sticky top-0 z-20">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <img src="/logo-orbital.png" alt="Orbital" style={{ height: 22 }} onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')} />
          <button onClick={() => setCartOpen(true)} className="relative flex items-center gap-1.5 text-sm text-white rounded-full px-4 py-2 font-medium" style={{ background: AZUL }}>
            <ShoppingCart size={16} /> <span className="hidden sm:inline">Order</span>
            {cartCount > 0 && <span className="absolute -top-1.5 -right-1.5 bg-red-500 text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">{cartCount}</span>}
          </button>
        </div>
        <div className="max-w-6xl mx-auto px-4 pb-2 flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search model…"
              className="w-full rounded-full bg-[#F5F5F7] border border-black/10 pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2" style={{ ['--tw-ring-color' as any]: `${AZUL}44` }} />
          </div>
          <div className="flex gap-1.5">
            {tipos.map((t) => (
              <button key={t.k} onClick={() => setTipo(t.k)}
                className="text-xs font-semibold rounded-full px-3 py-1.5 border transition"
                style={tipo === t.k ? { background: AZUL, color: '#fff', borderColor: AZUL } : { background: '#fff', borderColor: 'rgba(0,0,0,0.12)', color: '#555' }}>
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-4">
        <p className="text-xs text-neutral-500 mb-3">{visibles.length} models</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {visibles.map((m) => (
            <button key={m.modelo} onClick={() => setSel(m)} className="text-left rounded-xl border border-black/10 overflow-hidden bg-white hover:border-black/25 transition">
              <div className="aspect-square bg-white">
                {m.imagenes[0] ? <img src={m.imagenes[0]} alt={m.modelo} loading="lazy" className="w-full h-full object-contain" /> : <Placeholder />}
              </div>
              <div className="px-3 py-2">
                <p className="text-sm font-semibold truncate">{m.modelo}</p>
                <p className="text-xs text-neutral-500">{m.n_colores} colors · from <span className="font-semibold" style={{ color: AZUL }}>{usd(m.precio_desde)}</span></p>
              </div>
            </button>
          ))}
        </div>
        {visibles.length === 0 && <p className="text-sm text-neutral-500 text-center py-16">No models found.</p>}
      </main>

      {cartCount > 0 && (
        <button onClick={() => setCartOpen(true)} className="md:hidden fixed bottom-4 inset-x-4 text-white rounded-xl py-3 px-4 flex items-center justify-between shadow-lg z-20" style={{ background: AZUL }}>
          <span className="font-semibold">{cartCount} items</span><span className="font-bold">{usd(cartTotal)} · Review order</span>
        </button>
      )}

      {sel && <ModelSheet m={sel} onClose={() => setSel(null)} add={add} />}

      {cartOpen && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/40" onClick={() => setCartOpen(false)} />
          <div className="relative bg-white w-full max-w-md h-full overflow-y-auto flex flex-col">
            <div className="sticky top-0 bg-white border-b border-black/5 px-4 py-3 flex items-center justify-between">
              <p className="text-base font-bold">Your order</p>
              <button onClick={() => setCartOpen(false)} className="p-1.5 rounded-full hover:bg-black/5"><X size={20} /></button>
            </div>

            {okPedido ? (
              <div className="p-6 text-center flex-1 flex flex-col items-center justify-center">
                <div className="w-14 h-14 rounded-full flex items-center justify-center text-white mb-3" style={{ background: '#0a8f56' }}><Check size={28} /></div>
                <p className="text-lg font-bold">Order received!</p>
                <p className="text-sm text-neutral-500 mt-1">Order #{okPedido.id} · {okPedido.units} units · {usd(okPedido.total)}</p>
                <p className="text-sm text-neutral-500 mt-3">We'll get back to you shortly. Thank you!</p>
                <button onClick={() => { setOkPedido(null); setCartOpen(false) }} className="mt-6 text-sm font-semibold text-white rounded-lg px-5 py-2.5" style={{ background: AZUL }}>Keep browsing</button>
              </div>
            ) : cartItems.length === 0 ? (
              <p className="text-sm text-neutral-500 text-center py-16 flex-1">Your order is empty.</p>
            ) : (
              <>
                <div className="divide-y divide-black/5 flex-1">
                  {cartItems.map((c) => (
                    <div key={c.sku} className="flex items-center gap-3 px-4 py-2.5">
                      <div className="w-12 h-12 rounded-lg overflow-hidden border border-black/5 shrink-0 bg-white">
                        {c.foto ? <img src={c.foto} alt="" className="w-full h-full object-contain" /> : <Placeholder />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">{c.modelo}</p>
                        <p className="text-xs text-neutral-500 truncate">{c.color}</p>
                        <p className="text-xs font-semibold" style={{ color: AZUL }}>{usd(c.precio)}</p>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button onClick={() => setQty(c.sku, c.cantidad - 1)} className="w-7 h-7 rounded-lg border border-black/10 flex items-center justify-center"><Minus size={13} /></button>
                        <span className="w-6 text-center text-sm font-semibold">{c.cantidad}</span>
                        <button onClick={() => setQty(c.sku, c.cantidad + 1)} className="w-7 h-7 rounded-lg border border-black/10 flex items-center justify-center"><Plus size={13} /></button>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="border-t border-black/10 p-4 space-y-2.5 bg-white">
                  <div className="flex justify-between text-sm font-bold"><span>Total ({cartCount} units)</span><span>{usd(cartTotal)}</span></div>
                  <input value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} placeholder="Your name *" className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm" />
                  <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="Email *" className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm" />
                  <input value={form.empresa} onChange={(e) => setForm({ ...form, empresa: e.target.value })} placeholder="Company (optional)" className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm" />
                  <textarea value={form.notas} onChange={(e) => setForm({ ...form, notas: e.target.value })} placeholder="Notes (optional)" rows={2} className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm" />
                  <button onClick={checkout} disabled={enviando || !form.nombre.trim() || !form.email.trim()}
                    className="w-full text-white rounded-xl py-3 text-sm font-semibold disabled:opacity-40" style={{ background: AZUL }}>
                    {enviando ? 'Sending…' : 'Place order'}
                  </button>
                  <p className="text-[11px] text-neutral-400 text-center">Prices in USD. This is a wholesale order request, not a payment.</p>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
