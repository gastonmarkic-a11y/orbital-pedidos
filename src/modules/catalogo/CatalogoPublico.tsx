import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { Search, X, ChevronLeft, ChevronRight, ShoppingCart, Plus, Minus, Trash2, Check, Star, Info, MessageCircle, ChevronDown, Send } from 'lucide-react'
import { colorLegible, colorSwatch } from './colorLegible'
import { calcularBono, esBonoPct, importeSinCargo, type BonoEstado } from './bono'
import { BonoBanner, BonoBarra, BonoCelebra, BonoLinea, BonoResumen, ResumenCompraDigital } from './BonoUI'
import { calcularPack, esOportunidad, packObs } from './pack'
import { PackBanner, PackPasos, PackBarra, PackResumen } from './PackUI'
import InstalarApp from '../../components/InstalarApp'
import ColabInspiracion from '../colab/ColabInspiracion'
import { copiesDe, partesColor } from '../colab/colabUtil'
import { BotonCopiar } from '../colab/ColabAnteojos'
import PostventaOptica, { MisAnteojos, MisPublicaciones, PublicarLink } from './MiOptica'

// ── Catálogo B2B público (acceso con clave, independiente del login de la app) ──
// La óptica navega modelos → colores con stock (sin ver cantidades) → arma el pedido.
// Datos en vivo de `stock`; el checkout crea un pedido web en el flujo normal.

interface Modelo {
  modelo: string; precio_desde: number | null; precio_lista_desde?: number | null; caliente: boolean; n_colores: number
  imagenes: string[]
}
interface Variante {
  codigo: string; descripcion: string | null; tipo: string | null; tratamiento: string | null
  clasificacion: string | null; precio: number; precio_lista: number; tiene_preventa: boolean
  caliente: boolean; imagen: string | null; stock: number; proyectado?: boolean
}
interface CartItem { codigo: string; modelo: string; descripcion: string | null; precio: number; cantidad: number; imagen: string | null; stock?: number; oportunidad?: boolean }
interface Foto { u: string; c: string | null; t: string | null; k: string | null; tp: string | null; bl: boolean; bc: boolean; ca: boolean; pr?: boolean }
interface HomeModelo extends Modelo {
  fotos: Foto[]; clasificaciones: string[]; tratamientos: string[]; is_bajaluz: boolean; has_bluecut: boolean
}
interface Medidas { ancho: number | null; alto: number | null; largo: number | null; formato: string | null; patilla: string | null; frente: string | null; para: string | null }
// Destacados se controla 100% por es_caliente en la base (stock). Lista vacía = sin forzados en el front.
const DESTACADOS_EXTRA: string[] = []
// Modelos con tratamiento triple que NO queremos en la sección Triple
const TRIPLE_EXCLUDE: string[] = []
// Modelos que pueden aparecer en más de una sección (no los consume el dedup): p.ej. Londres en Triple y Urbanos
const MULTI_GRUPO: string[] = ['LONDRES']
const esNegro = (c: string | null) => !!c && /negro|ngm|ngb|\bng\b|black/i.test(c)
const esGris = (c: string | null) => !!c && /gris|gray/i.test(c)
// Tapa fija elegida a mano para modelos puntuales (color exacto)
const COVER_OVERRIDE: Record<string, string> = {
  'SIGNATURE': 'Negro Mate / Espejo Rojo',
  'ZETA 11': 'Negro Mate / Gris',
  'ZETA 7': 'Negro Mate / Gris',
  'LONG BEACH': 'Negro Mate / Gris Polarizado',
  'ZETA 1 PRO': 'Negro Mate / Espejo Naranja',
  'ENDOR': 'Negro Brillo/ Gris Polarizado',
  'BAREIN': 'Negro Brillo / Gris',
  'EIVISSA': 'Negro Brillo / Celeste Flash',
  'LENA': 'Rosa Clear / Habano Degrade',
  'BUENOS AIRES': 'Carey Brillo / Verde',
  'CENTRAL PARK': 'Negro Brillo / Gris Degrade',
  'MARSELLA': 'Negro Brillo / Habano Degrade',
  // Deportivos con foto profesional en 45° (negro)
  'QUARTZ': 'Negro Mate / Gris Polarizado',
  'ZETA 3': 'Negro Mate/ Gris Polarizado',
  'ZETA 4': 'Negro Mate/ Gris Polarizado',
  'ZETA 8': 'Negro Mate/ Gris Polarizado',
  'VELOCITY': 'Negro Brillo / Gris Polarizado',
  'ZERO': 'Negro Brillo / Gris Polarizado',
  'ADRENALINE': 'Negro Mate/ Espejado Celeste',
  'CRYSTAL': 'Negro Mate/ Espejo Rojo',
  'SUZUKA': 'Gris Clear / Gris Claro',
}
// Tapa por modelo + grupo (para modelos que viven en varias secciones con tapa distinta)
const COVER_OVERRIDE_GRUPO: Record<string, Record<string, string>> = {
  'LONDRES': { triple: 'Clear Verde / Flash Verde Espejado Degradé', urbano: 'Negro Brillo / Gris Degradé' },
  // Modelos triple con foto 45° negra: forzamos esa tapa también en la sección Triple
  'ZETA 7': { triple: 'Negro Mate / Gris' },
  'ZETA 8': { triple: 'Negro Mate/ Gris Polarizado' },
  'ZERO': { triple: 'Negro Brillo / Gris Polarizado' },
  'ABU DHABI': { triple: 'Negro Mate / Gris Polarizado' },
  'BUENOS AIRES I': { destacados: 'Negro Mate Compacto / Gris' },
}
const norm = (s: string | null) => (s || '').toLowerCase().replace(/\s+/g, ' ').trim()
// Índice de la foto de portada según el grupo (representa al grupo)
function coverIndex(fotos: Foto[], grupo?: string, modelo?: string): number {
  if (!fotos?.length) return 0
  // la tapa siempre debe ser un color CON foto (nunca placeholder)
  const find = (fn: (f: Foto) => boolean) => { const i = fotos.findIndex((f) => !!f.u && fn(f)); return i >= 0 ? i : -1 }
  const hasSol = fotos.some((f) => f.tp === 'sol' && !!f.u)
  // 1a) override por modelo + grupo (tapa distinta según la sección)
  if (modelo && grupo && COVER_OVERRIDE_GRUPO[modelo]?.[grupo]) {
    const j = find((f) => norm(f.c) === norm(COVER_OVERRIDE_GRUPO[modelo][grupo]))
    if (j >= 0) return j
  }
  // 1b) override manual por modelo (color exacto) — en Triple manda la lógica de flash, no el override
  if (modelo && COVER_OVERRIDE[modelo] && grupo !== 'triple') {
    const j = find((f) => norm(f.c) === norm(COVER_OVERRIDE[modelo]))
    if (j >= 0) return j
  }
  // condición + tiene que ser de sol: la tapa SIEMPRE muestra un anteojo de sol
  const S = (fn: (f: Foto) => boolean) => (f: Foto) => f.tp === 'sol' && fn(f)
  let i = -1
  if (grupo === 'destacados') {
    // preferimos NEGRO con lente GRIS de sol; si no hay, cualquier negro de sol
    i = find(S((f) => esNegro(f.c) && esGris(f.c)))
    if (i < 0) i = find(S((f) => esNegro(f.c)))
  }
  else if (grupo === 'triple') i = find(S((f) => f.t === 'Infrarrojo + Blue cut'))
  else if (grupo === 'bajaluz') i = find(S((f) => !!f.bl))
  else if (grupo === 'deportivo') i = find((f) => f.tp === 'sol')
  else if (grupo === 'bluecut' && !hasSol) {
    // solo si el modelo NO tiene ninguna posición de sol mostramos receta/lentilla en la tapa
    i = find((f) => (!!f.t && /blue cut|lentilla/i.test(f.t)) || f.tp === 'receta' || /lentilla/i.test(f.c || ''))
  }
  // Regla global: la tapa siempre de sol (con foto) si el modelo tiene alguna posición de sol
  if (i < 0 && hasSol) i = find((f) => f.tp === 'sol')
  // Modelo sin sol: evitamos receta si hubiera algo intermedio; siempre con foto
  if (i < 0) i = find((f) => f.tp !== 'receta')
  if (i < 0) i = find(() => true)
  return i >= 0 ? i : 0
}

// Paleta de la tienda orbitaleyewear.com.ar: blanco/negro, azul eléctrico, tipografía monospace
const CLAVE_KEY = 'orbital_catalogo_clave'
const ACCESO_KEY = 'orbital_catalogo_acceso'
const CART_KEY = 'orbital_catalogo_cart'
// En sessionStorage, no en localStorage: la sesión de medición dura lo que dura la pestaña.
const SESION_KEY = 'orbital_catalogo_sesion'
const PACK_KEY = 'orbital_catalogo_pack'
const DEVICE_KEY = 'orbital_catalogo_device'
// Id estable por navegador para contar entradas y detectar si el link se comparte.
function deviceId(): string {
  try {
    let d = localStorage.getItem(DEVICE_KEY)
    if (!d) { d = (crypto.randomUUID?.() || Math.random().toString(36).slice(2) + Date.now().toString(36)); localStorage.setItem(DEVICE_KEY, d) }
    return d
  } catch { return '' }
}
interface Acceso { tipo: string; codigo?: string; cod_cliente?: string | null; label?: string | null; vendedor?: string | null; vendedor_tel?: string | null }
// Catálogo de disponibilidad: el token de los vendedores de un distribuidor no ve
// precios (ellos venden con su propia lista). El servidor ya los manda en 0; acá
// solo se evita mostrar el número y todo lo que hable de plata.
const SinPreciosCtx = createContext(false)
const useSinPrecios = () => useContext(SinPreciosCtx)
// "010002 - Optisur S.R.L · vendedores (sin precios)" → "Optisur S.R.L"
const empresaDe = (label?: string | null) => ((label || '').split(' - ')[1] || label || '').split('·')[0].trim()
const kAr = (n: number | null) => (n == null ? '—' : '$' + Math.round(n).toLocaleString('es-AR'))
const cap = (s: string | null) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '')

// Placeholder elegante cuando el producto no tiene foto todavía
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

// Carrusel de fotos en la tarjeta: permite ojear los colores sin abrir el detalle
function CardCarousel({ fotos, alt, onOpen, initial = 0 }: { fotos: Foto[]; alt: string; onOpen: () => void; initial?: number }) {
  const n = fotos?.length ?? 0
  const [i, setI] = useState(Math.min(initial, Math.max(0, n - 1)))
  useEffect(() => { setI(Math.min(initial, Math.max(0, n - 1))) }, [initial, n])
  const tX = useRef<number | null>(null)
  const go = (e: React.MouseEvent, d: number) => { e.stopPropagation(); setI((p) => (p + d + n) % n) }
  // Swipe en mobile: deslizar cambia de color directo
  const onTouchStart = (e: React.TouchEvent) => { tX.current = e.touches[0].clientX }
  const onTouchEnd = (e: React.TouchEvent) => {
    if (tX.current == null || n < 2) return
    const dx = e.changedTouches[0].clientX - tX.current
    if (Math.abs(dx) > 35) setI((p) => (p + (dx < 0 ? 1 : -1) + n) % n)
    tX.current = null
  }
  if (!n) return <button onClick={onOpen} className="aspect-square w-full bg-white block"><Placeholder /></button>
  const cur = fotos[Math.min(i, n - 1)]
  const color = colorLegible(cur.c)
  return (
    <div className="group aspect-square bg-white relative" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      <button onClick={onOpen} className="w-full h-full block">
        {cur.u ? <img src={cur.u} alt={alt} className="w-full h-full object-contain" /> : <Placeholder />}
      </button>
      {color && (
        <span className="absolute bottom-6 left-1/2 -translate-x-1/2 bg-black/70 text-white text-[9px] font-medium rounded-full px-2 py-0.5 max-w-[90%] truncate flex items-center gap-1">
          <span className="w-2 h-2 rounded-full border border-white/60 shrink-0" style={{ background: colorSwatch(cur.c) }} />
          {color}
        </span>
      )}
      {n > 1 && (
        <>
          {/* Flechas solo en desktop; en mobile el cambio de color es por arrastre (swipe) */}
          <button onClick={(e) => go(e, -1)} aria-label="Anterior" className="hidden md:block absolute left-1 top-1/2 -translate-y-1/2 bg-white/85 hover:bg-white rounded-full p-1 shadow opacity-0 group-hover:opacity-100 transition"><ChevronLeft size={16} /></button>
          <button onClick={(e) => go(e, 1)} aria-label="Siguiente" className="hidden md:block absolute right-1 top-1/2 -translate-y-1/2 bg-white/85 hover:bg-white rounded-full p-1 shadow opacity-0 group-hover:opacity-100 transition"><ChevronRight size={16} /></button>
          <div className="absolute bottom-1.5 inset-x-0 flex items-center justify-center gap-1">
            {fotos.map((_, k) => (
              <span key={k} className={`h-1.5 rounded-full transition-all ${k === Math.min(i, n - 1) ? 'w-3 bg-[#0004FF]' : 'w-1.5 bg-black/20'}`} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function Logo() {
  return (
    <div className="flex items-center gap-2">
      <img src="/logo-orbital.png" alt="Orbital" style={{ height: 22 }} onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')} />
      <span className="text-[10px] font-bold tracking-[0.3em] text-[#0004FF] uppercase">Eyewear · B2B</span>
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
    const { data, error } = await supabase.rpc('catalogo_entrar', { p: v.trim() })
    setLoading(false)
    if (error) { setErr('Error de conexión'); return }
    if ((data as any)?.ok) { localStorage.setItem(CLAVE_KEY, v.trim()); onOk(v.trim()) }
    else setErr('Clave o código incorrecto')
  }
  return (
    <div className="min-h-screen flex items-center justify-center bg-white px-4 font-mono">
      <form onSubmit={probar} className="w-full max-w-sm bg-white border border-black/10 rounded-2xl shadow-sm p-8">
        <Logo />
        <div className="h-px bg-gradient-to-r from-[#0004FF]/60 to-transparent my-4" />
        <p className="text-sm text-neutral-600 mb-5">Catálogo mayorista para ópticas. Ingresá la clave que te compartió Orbital.</p>
        <input autoFocus type="password" placeholder="Clave de acceso" value={v} onChange={(e) => setV(e.target.value)}
          className="w-full rounded-lg bg-white border border-black/10 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0004FF]/40" />
        {err && <p className="text-sm text-red-600 mt-2">{err}</p>}
        <button disabled={loading} className="w-full mt-4 rounded-lg bg-[#0004FF] text-white py-2.5 text-sm font-medium disabled:opacity-50">
          {loading ? 'Verificando…' : 'Entrar al catálogo'}
        </button>
      </form>
    </div>
  )
}

// ── Portón de bloqueo: el link ya está en uso en otro dispositivo ──
// Si ya no se puede habilitar solo, el pedido le llega a Gastón por Telegram (edge function
// catalogo-pedir-acceso, botones Habilitar/No) y esta pantalla se abre sola cuando lo aprueba:
// el cliente no tiene que volver a entrar ni recargar.
function BloqueoGate({ label, vendedorTel, codigo }: {
  label: string | null; vendedorTel?: string | null; codigo?: string | null
}) {
  const optica = (label?.split(' - ')[1] || label || 'tu óptica').trim()
  const [tel, setTel] = useState(vendedorTel || null)
  const [agotado, setAgotado] = useState(false)
  const [yendo, setYendo] = useState(false)
  const [pedido, setPedido] = useState<'no' | 'enviando' | 'enviado' | 'error'>('no')
  // Alternativa manual: WhatsApp al vendedor del token; si no tiene teléfono cargado, cae en IRIS.
  const wa = (tel || '').replace(/\D/g, '') || '5491178548316'
  const msg = `Hola! Soy ${optica}. Quiero abrir mi catálogo Orbital desde este dispositivo, ¿me lo habilitás?`
  const waLink = `https://wa.me/${wa}?text=${encodeURIComponent(msg)}`

  // Primera vez que un cliente choca con el candado, se habilita solo y entra.
  // Cuando se agotan las habilitaciones automáticas, pide acceso por Telegram.
  async function entrarIgual() {
    if (!codigo) return
    setYendo(true)
    const { data } = await supabase.rpc('catalogo_autoacceso', { p: codigo, p_device: deviceId() })
    const r = data as { ok: boolean; motivo?: string; vendedor_tel?: string | null }
    if (r?.ok) { window.location.reload(); return }
    if (r?.vendedor_tel) setTel(r.vendedor_tel)
    setAgotado(true); setYendo(false)
  }

  async function pedirAcceso() {
    if (!codigo) return
    setPedido('enviando')
    const { data, error } = await supabase.functions.invoke('catalogo-pedir-acceso', { body: { codigo, device: deviceId() } })
    const r = data as { permitido?: boolean; pedido?: boolean } | null
    if (r?.permitido) { window.location.reload(); return }
    setPedido(!error && r?.pedido ? 'enviado' : 'error')
  }

  // Sin habilitación automática disponible, el pedido sale solo.
  useEffect(() => { if (agotado) pedirAcceso() }, [agotado]) // eslint-disable-line react-hooks/exhaustive-deps

  // Esperando el OK: se fija cada 8 s y entra apenas lo habilitan (deja de mirar a la hora).
  useEffect(() => {
    if (pedido !== 'enviado' || !codigo) return
    const t0 = Date.now()
    const id = window.setInterval(async () => {
      if (Date.now() - t0 > 3_600_000) { window.clearInterval(id); return }
      const { data } = await supabase.rpc('catalogo_dispositivo_ok', { p: codigo, p_device: deviceId() })
      if (data === true) { window.clearInterval(id); window.location.reload() }
    }, 8000)
    return () => window.clearInterval(id)
  }, [pedido, codigo])

  return (
    <div className="min-h-screen flex items-center justify-center bg-white px-4 font-mono">
      <div className="w-full max-w-sm bg-white border border-black/10 rounded-2xl shadow-sm p-8 text-center">
        <Logo />
        <div className="h-px bg-gradient-to-r from-[#0004FF]/60 to-transparent my-4" />
        <div className="text-4xl mb-3">🔒</div>
        <p className="text-sm font-bold text-[#0a0a0a] mb-1">Catálogo exclusivo de {optica}</p>
        {pedido === 'enviando' || pedido === 'enviado' ? (
          <>
            <p className="text-sm text-neutral-600 mb-4">
              {pedido === 'enviando'
                ? 'Pidiendo acceso…'
                : 'Listo, pedimos tu acceso a Orbital. Apenas lo aprueben, esta página se abre sola: no hace falta que hagas nada.'}
            </p>
            {pedido === 'enviado' && (
              <div className="flex items-center justify-center gap-2 text-[11px] text-neutral-400">
                <span className="w-2 h-2 rounded-full bg-[#0004FF] animate-pulse" /> Esperando la aprobación…
              </div>
            )}
            <a href={waLink} target="_blank" rel="noreferrer" className="block text-[11px] text-neutral-400 underline mt-4">
              ¿Estás apurado? Escribile a tu vendedor
            </a>
          </>
        ) : agotado ? (
          <>
            <p className="text-sm text-neutral-600 mb-5">
              Este link ya se abrió en varios dispositivos. Para sumar uno más hay que pedir acceso.
            </p>
            {pedido === 'error' && <p className="text-sm text-red-600 mb-3">No pudimos enviar el pedido. Probá de nuevo.</p>}
            <button onClick={pedirAcceso}
              className="block w-full rounded-lg bg-[#0004FF] text-white py-2.5 text-sm font-medium">
              Pedir acceso
            </button>
            <a href={waLink} target="_blank" rel="noreferrer"
              className="block w-full rounded-lg border border-black/10 text-neutral-600 py-2.5 text-sm font-medium mt-2">
              Escribirle a mi vendedor
            </a>
          </>
        ) : (
          <>
            <p className="text-sm text-neutral-600 mb-5">
              Este link es personal y ya está abierto en otro dispositivo. Podés habilitar este por única vez.
            </p>
            <button onClick={entrarIgual} disabled={yendo}
              className="block w-full rounded-lg bg-[#0004FF] text-white py-2.5 text-sm font-medium disabled:opacity-60">
              {yendo ? 'Habilitando…' : 'Habilitar este dispositivo y entrar'}
            </button>
            <button onClick={pedirAcceso}
              className="block w-full rounded-lg border border-black/10 text-neutral-600 py-2.5 text-sm font-medium mt-2">
              Prefiero pedir acceso a Orbital
            </button>
          </>
        )}
      </div>
    </div>
  )
}

// ── Grupos del catálogo (secciones tipo tienda) ──
// Un modelo es "de sol" si tiene alguna foto de producto de sol; es "recetado" si solo tiene fotos de receta/lentilla
const tieneSolFoto = (m: HomeModelo) => (m.fotos || []).some((f) => f.tp === 'sol')
const esRecetaModelo = (m: HomeModelo) => !tieneSolFoto(m) && (m.fotos || []).some((f) => f.tp === 'receta' || /lentilla/i.test(f.c || ''))
// Línea Zaira Nara: clasificación 'zaira nara' o nombre que termina en "- ZN"
const esZN = (m: HomeModelo) => m.clasificaciones.includes('zaira nara') || /\bZN\s*$/i.test(m.modelo)
// Cápsula ETHEREA (ultralivianos 9g)
const ETHEREA_MODELOS = ['SUBLIME', 'PLUMA', 'MICRA', 'BRISSA']
const esEtherea = (m: HomeModelo) => ETHEREA_MODELOS.includes(m.modelo)
// ZN y ETHEREA son exclusivos de su sección; el resto los excluye
const matchGrupo = (g: Grupo, m: HomeModelo) => {
  // ETHEREA y ZN son secciones exclusivas por modelo (aunque el modelo sea solo receta, como Brissa)
  if (esEtherea(m)) return g.key === 'etherea'
  if (esZN(m)) return g.key === 'zn'
  // Un modelo sin posiciones de sol solo puede vivir en "Blue cut y lentillas" (receta/lentillas, como Brasilia)
  if (!tieneSolFoto(m)) return g.key === 'bluecut'
  return (g.match(m) && !esZN(m) && !esEtherea(m))
}
type Grupo = { key: string; nombre: string; sub?: string; accent: 'blue' | 'amber' | 'red' | 'dark' | 'etherea'; match: (m: HomeModelo) => boolean }
const GRUPOS: Grupo[] = [
  { key: 'destacados', nombre: 'Destacados', accent: 'blue', match: (m) => m.caliente || DESTACADOS_EXTRA.includes(m.modelo) },
  { key: 'triple', nombre: 'Triple Protección', sub: 'Infrarrojo + Blue cut', accent: 'blue', match: (m) => m.tratamientos.includes('Infrarrojo + Blue cut') && !TRIPLE_EXCLUDE.includes(m.modelo) },
  { key: 'urbano', nombre: 'Urbanos', accent: 'dark', match: (m) => m.clasificaciones.includes('urbano') },
  { key: 'deportivo', nombre: 'Deportivos', accent: 'dark', match: (m) => m.clasificaciones.includes('deportivo') && tieneSolFoto(m) },
  { key: 'etherea', nombre: 'ETHEREA', sub: 'Ultralivianos · 9 gramos', accent: 'etherea', match: (m) => esEtherea(m) },
  { key: 'bluecut', nombre: 'Blue cut y lentillas', sub: 'Recetados y lentillas', accent: 'blue', match: (m) => m.tratamientos.includes('Blue cut') || m.tratamientos.includes('lentilla') || esRecetaModelo(m) },
  { key: 'bajaluz', nombre: 'Cuando baja la luz', sub: 'Cristal ocre · naranja · rojo', accent: 'amber', match: (m) => m.is_bajaluz },
  { key: 'zn', nombre: 'Zaira Nara', sub: 'ZN', accent: 'dark', match: (m) => m.clasificaciones.includes('zaira nara') },
  { key: 'oportunidades', nombre: 'Oportunidades', accent: 'red', match: (m) => m.clasificaciones.includes('oportunidades') },
]
const ACCENT: Record<Grupo['accent'], string> = {
  blue: 'bg-gradient-to-r from-[#0004FF] to-[#3b46ff] text-white',
  amber: 'bg-gradient-to-r from-[#b45309] via-[#ea8a00] to-[#dc2626] text-white',
  red: 'bg-gradient-to-r from-[#dc2626] to-[#f05252] text-white',
  dark: 'bg-[#0a0a0a] text-white',
  etherea: 'bg-gradient-to-r from-[#64748b] via-[#94a3b8] to-[#e2e8f0] text-white',
}

// Contenido explicativo (pop-up tipo frontpage) por grupo
const GRUPO_INFO: Record<string, { titulo: string; bajada: string; puntos: string[]; link?: { href: string; texto: string } }> = {
  destacados: { titulo: 'Destacados', bajada: 'Lo más elegido por las ópticas: los modelos que más rotan y mejor funcionan en vidriera.', puntos: ['Curados por el equipo comercial', 'Alta rotación y demanda comprobada', 'Ideales para arrancar o reponer stock'] },
  triple: { titulo: 'Triple Protección', bajada: 'La tecnología Orbital que protege de la luz infrarroja, la luz azul y los rayos UV en un solo cristal.', puntos: ['Filtro Infrarrojo (IR) — confort térmico', 'Filtro Blue Cut — pantallas y luz artificial', 'Protección UV400 — sol', 'Visión más nítida y menos fatiga'], link: { href: '/proteccion', texto: 'Ver la página de Triple Protección →' } },
  urbano: { titulo: 'Urbanos', bajada: 'Diseño para el día a día en la ciudad. Livianos, versátiles y con impronta de marca.', puntos: ['Estilo para uso diario', 'Materiales livianos y resistentes', 'Combinan con todo'] },
  deportivo: { titulo: 'Deportivos', bajada: 'Sujeción, liviandad y cristales de alto rendimiento para exigencia y aire libre.', puntos: ['Agarre firme en movimiento', 'Cristales polarizados y espejados', 'Pensados para deporte y manejo'] },
  receta: { titulo: 'Recetados', bajada: 'Armazones pensados para uso con receta: se cierran con el cristal graduado del cliente.', puntos: ['Aptos para lentes recetados', 'Diseño y calce cuidados', 'Consultá calibres y colores disponibles'] },
  etherea: { titulo: 'ETHEREA — Ultralivianos', bajada: 'Ultralivianos de solo 9 gramos: liviandad, confort y sofisticación en su máxima expresión, con un diseño para quienes buscan la mejor experiencia de uso.', puntos: ['Solo 9 gramos de peso', 'Hasta 4× más livianos que un marco tradicional', 'Sensación prácticamente imperceptible todo el día', 'Calce natural, sin presión ni marcas', 'Se adaptan suavemente al rostro'] },
  bluecut: { titulo: 'Blue cut y lentillas', bajada: 'Filtro de luz azul para pantallas y armazones para receta/lentilla, listos para el cristal graduado del cliente.', puntos: ['Menos fatiga visual frente a pantallas', 'Aptos para lentes recetados / lentilla', 'Diseño y calce cuidados'] },
  bajaluz: { titulo: 'Cuando baja la luz', bajada: 'Cristales ocre, naranja y rojo que aumentan el contraste cuando cae la luz: manejo nocturno, niebla y días grises.', puntos: ['Más contraste con poca luz', 'Ideal para conducir al atardecer y de noche', 'Reduce el encandilamiento'] },
  zn: { titulo: 'Zaira Nara — ZN', bajada: 'La cápsula ZN: diseño de tendencia con el sello de Zaira Nara.', puntos: ['Colección cápsula', 'Diseño de moda', 'Edición especial'] },
  oportunidades: { titulo: 'Oportunidades', bajada: 'Precios especiales y liquidación de temporada: margen y rotación para la óptica.', puntos: ['Mejor precio', 'Ideales para promociones', 'Stock por tiempo limitado'] },
}

// Pop-up explicativo del grupo (frontpage de cada punto)
function InfoModal({ grupoKey, onClose }: { grupoKey: string; onClose: () => void }) {
  const g = GRUPOS.find((x) => x.key === grupoKey)
  const info = GRUPO_INFO[grupoKey]
  if (!g || !info) return null
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center font-mono">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white w-full sm:max-w-md sm:rounded-2xl rounded-t-2xl max-h-[88vh] overflow-y-auto">
        <div className={`px-5 py-5 relative ${ACCENT[g.accent]} sm:rounded-t-2xl`}>
          <button onClick={onClose} className="absolute top-3 right-3 text-white/90 hover:text-white"><X size={20} /></button>
          <p className="text-[10px] tracking-[0.3em] uppercase opacity-80">Orbital® · Eyewear</p>
          <h2 className="text-xl font-bold tracking-wide uppercase mt-1">{info.titulo}</h2>
          {g.sub && <p className="text-[11px] opacity-80 mt-0.5">{g.sub}</p>}
        </div>
        <div className="p-5">
          <p className="text-sm text-neutral-700 leading-relaxed">{info.bajada}</p>
          <ul className="mt-4 space-y-2">
            {info.puntos.map((p, i) => (
              <li key={i} className="flex gap-2 text-sm text-neutral-800"><span className="text-[#0004FF] font-bold">›</span><span>{p}</span></li>
            ))}
          </ul>
          {info.link && (
            <a href={info.link.href} target="_blank" rel="noreferrer" className="mt-5 block text-center bg-[#0004FF] text-white rounded-xl py-3 text-sm font-semibold hover:opacity-90">{info.link.texto}</a>
          )}
          <button onClick={onClose} className="mt-2 w-full text-center text-[12px] text-neutral-500 py-2">Cerrar</button>
        </div>
      </div>
    </div>
  )
}

// Badge azul: "Triple Protección" (si tiene Infrarrojo + Blue cut) o "Blue cut"
function ProtBadge({ triple }: { triple: boolean }) {
  return <span className="absolute top-2 right-2 z-10 bg-[#0004FF] text-white text-[8px] font-bold rounded-full px-2 py-0.5 tracking-wide shadow whitespace-nowrap">{triple ? 'TRIPLE PROT.' : 'BLUE CUT'}</span>
}

// Tarjeta de modelo reutilizable (grilla y secciones)
function ModelCard({ m, onOpen, onQuick, grupo }: { m: HomeModelo; onOpen: () => void; onQuick: () => void; grupo?: string }) {
  const sinPrecios = useSinPrecios()
  return (
    <div className="relative bg-white rounded-xl border border-black/10 overflow-hidden transition hover:border-[#0004FF]/40 hover:shadow-sm h-full flex flex-col">
      <div className="relative">
        <CardCarousel fotos={m.fotos} alt={m.modelo} onOpen={onOpen} initial={coverIndex(m.fotos, grupo, m.modelo)} />
        {m.caliente && <span className="absolute top-2 left-2 bg-[#0004FF] text-white text-[9px] font-bold rounded-full px-2 py-0.5 flex items-center gap-0.5 z-10"><Star size={9} />TOP</span>}
        {m.has_bluecut && <ProtBadge triple={m.tratamientos.includes('Infrarrojo + Blue cut')} />}
      </div>
      <button onClick={onOpen} className="text-left w-full block px-3 pt-3 pb-2 flex-1">
        <p className="text-sm font-semibold truncate">{m.modelo}</p>
        <p className="text-[11px] text-neutral-400">{m.n_colores} color{m.n_colores !== 1 ? 'es' : ''}</p>
        {sinPrecios
          ? <p className="text-[11px] font-semibold mt-1 text-emerald-600">Disponible</p>
          : <p className="text-base font-bold mt-1 text-[#0004FF]">{kAr(m.precio_desde)}</p>}
      </button>
      <button onClick={onQuick} className="mx-3 mb-3 rounded-lg bg-[#0004FF]/10 text-[#0004FF] text-[12px] font-semibold py-1.5 flex items-center justify-center gap-1 hover:bg-[#0004FF]/20">
        <Plus size={14} /> Agregar
      </button>
    </div>
  )
}

// Cartelito de sección (chico, tipo Mercado Libre) + fila con scroll horizontal
function SectionRow({ grupo, items, row, onOpen, onQuick, onInfo }: {
  grupo: Grupo; items: HomeModelo[]; row?: HomeModelo[]; onOpen: (m: HomeModelo) => void; onQuick: (m: HomeModelo) => void; onInfo: () => void
}) {
  const [exp, setExp] = useState(false)
  const fila = row ?? items  // fila colapsada (deduplicada); expandido muestra todo `items`
  if (!fila.length) return null
  return (
    <section id={`g-${grupo.key}`} className="mb-7 scroll-mt-32">
      <div className={`flex items-center justify-between rounded-lg px-3 py-1.5 mb-2.5 ${ACCENT[grupo.accent]}`}>
        <button onClick={onInfo} className="flex items-center gap-1.5 min-w-0 text-left group/info" title={`Qué es ${grupo.nombre}`}>
          {grupo.key === 'destacados' && <Star size={13} className="shrink-0" />}
          <span className="text-[12px] font-bold tracking-[0.18em] uppercase truncate underline decoration-white/30 underline-offset-2 group-hover/info:decoration-white">{grupo.nombre}</span>
          <Info size={12} className="shrink-0 opacity-80 group-hover/info:opacity-100" />
          {grupo.sub && <span className="text-[10px] opacity-70 tracking-wide truncate hidden sm:inline">{grupo.sub}</span>}
          <span className="text-[10px] opacity-70">· {items.length}</span>
        </button>
        {items.length > (exp ? 0 : 14) || exp ? (
          <button onClick={() => setExp((v) => !v)} className="text-[11px] font-semibold whitespace-nowrap opacity-90 hover:opacity-100">{exp ? 'Ver menos ↑' : 'Ver todos ↓'}</button>
        ) : null}
      </div>
      {exp ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
          {items.map((m) => <ModelCard key={m.modelo} m={m} grupo={grupo.key} onOpen={() => onOpen(m)} onQuick={() => onQuick(m)} />)}
        </div>
      ) : (
        <div className="flex gap-2.5 overflow-x-auto pb-2 -mx-1 px-1 snap-x">
          {fila.slice(0, 14).map((m) => (
            <div key={m.modelo} className="snap-start shrink-0 w-36 sm:w-44">
              <ModelCard m={m} grupo={grupo.key} onOpen={() => onOpen(m)} onQuick={() => onQuick(m)} />
            </div>
          ))}
          {fila.length > 14 && (
            <button onClick={() => setExp(true)} className="snap-start shrink-0 w-36 sm:w-44 rounded-xl border border-dashed border-black/20 text-[#0004FF] text-sm font-semibold flex items-center justify-center hover:bg-[#0004FF]/5">
              Ver los {items.length} ↓
            </button>
          )}
        </div>
      )}
    </section>
  )
}


// ── Botón de ayuda del catálogo ──────────────────────────────────────────────
// Respuestas automáticas de cómo funciona + WhatsApp del vendedor asignado.
// El teléfono sale del token (vendedor de la óptica); si no hay, cae en IRIS.
const TEL_IRIS = '5491178548316'
const FAQ: { q: string; a: string }[] = [
  { q: '¿Los precios que veo son los míos?',
    a: 'Sí. Este catálogo se abre con tu link personal, así que los precios que ves son los de tu lista de óptica, sin IVA. No son precios de público.' },
  { q: '¿Cómo armo un pedido?',
    a: 'Entrá al modelo que te interese, elegí el color y la cantidad, y se suma a tu pedido. Cuando termines, tocá "Pedido" arriba a la derecha y confirmá. Te llega a tu vendedor para que valide stock y condiciones.' },
  { q: '¿Lo que veo tiene stock?',
    a: 'Sí. Solo se muestran los colores con stock disponible en este momento. Por eso a veces un modelo aparece con menos colores que en el catálogo PDF.' },
  { q: '¿Puedo abrirlo desde otro dispositivo?',
    a: 'Tu link funciona en hasta 2 dispositivos. Si querés sumar otro (por ejemplo la compu del local), escribile a tu vendedor y te lo habilita en el momento.' },
  { q: '¿Qué es la Triple Protección?',
    a: 'Es nuestra plataforma de cristales: UV400 + Blue Cut + Infrarrojo en un solo lente. Es única en el mercado argentino y es el principal argumento de venta en el mostrador.' },
  { q: '¿Cuándo me llega el pedido?',
    a: 'Una vez que tu vendedor confirma el pedido, se prepara y se despacha por el transporte que tengas acordado. Él te pasa el número de seguimiento cuando sale.' },
]

// Catálogo de disponibilidad (vendedores de un distribuidor): acá no se habla de
// precios ni de listas — los precios los pone el distribuidor, no Orbital.
const FAQ_SIN_PRECIOS: { q: string; a: string }[] = [
  { q: '¿Por qué no veo precios?',
    a: 'Este catálogo muestra solo disponibilidad. Los precios te los pasa tu empresa: son los de su lista, no los de Orbital.' },
  { q: '¿Lo que veo tiene stock?',
    a: 'Sí. Solo aparecen los colores con stock disponible en este momento. Los que dicen "proyectado" todavía no llegaron, pero ya están en producción.' },
  { q: '¿Cómo armo un pedido?',
    a: 'Entrá al modelo, elegí el color y la cantidad, y se suma al pedido. Cuando termines, tocá "Pedido" arriba a la derecha y confirmá: queda registrado a nombre de tu empresa para que ellos lo revisen y lo cierren.' },
  { q: '¿Qué es la Triple Protección?',
    a: 'Es nuestra plataforma de cristales: UV400 + Blue Cut + Infrarrojo en un solo lente. Es única en el mercado argentino y es el principal argumento de venta en el mostrador.' },
]

// Chat en vivo con IRIS, adentro del catálogo. La diferencia con el widget de la
// web pública es que acá sabemos QUIÉN está mirando (el token de acceso trae el
// cod_cliente), así que el bot no pregunta "¿sos óptica o consumidor?" y cotiza
// con la lista que corresponde. Si no puede resolver, deriva y la consulta le
// llega al equipo por Telegram con la razón social.
const CHAT_CONV_KEY = 'orbital_catalogo_conv'
const CHAT_SES_KEY = 'orbital_catalogo_chat_ses'
const SALUDO_KEY = 'orbital_catalogo_saludo'

type MsgChat = { de: 'cliente' | 'bot'; texto: string }

function ChatIris({ acceso, entrantes }: { acceso: Acceso | null; entrantes: string[] }) {
  const [msgs, setMsgs] = useState<MsgChat[]>([])
  const [texto, setTexto] = useState('')
  const [enviando, setEnviando] = useState(false)
  const cont = useRef<HTMLDivElement | null>(null)
  const vistos = useRef(0)

  // Lo que escribe el equipo desde Orbital Suite o desde Telegram entra acá y se
  // muestra como un mensaje más: para el cliente es la misma conversación.
  useEffect(() => {
    if (entrantes.length > vistos.current) {
      const nuevos = entrantes.slice(vistos.current)
      vistos.current = entrantes.length
      setMsgs((m) => [...m, ...nuevos.map((t) => ({ de: 'bot' as const, texto: t }))])
    }
  }, [entrantes])

  const sesionId = useMemo(() => {
    let s = localStorage.getItem(CHAT_SES_KEY)
    if (!s) { s = 'cat-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8); localStorage.setItem(CHAT_SES_KEY, s) }
    return s
  }, [])

  // Scrollea el cuadro del chat, no la página: si no, al enviar saltaba todo el panel.
  useEffect(() => { if (cont.current) cont.current.scrollTop = cont.current.scrollHeight }, [msgs])

  async function mandar(t?: string) {
    const q = (t ?? texto).trim()
    if (!q || enviando) return
    setTexto('')
    setMsgs((m) => [...m, { de: 'cliente', texto: q }])
    setEnviando(true)
    try {
      const res = await fetch('https://towcgvphxeqilpdnboki.supabase.co/functions/v1/webhook-web', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          conversacionId: localStorage.getItem(CHAT_CONV_KEY) || null,
          sesionId,
          texto: q,
          identidad: {
            cod_cliente: acceso?.cod_cliente ?? null,
            label: acceso?.label ?? null,
            vendedor: acceso?.vendedor ?? null,
            origen: 'catalogo',
          },
        }),
      })
      const data = await res.json()
      if (data.conversacionId) localStorage.setItem(CHAT_CONV_KEY, data.conversacionId)
      // silencio: el cliente está charlando con su vendedor; la respuesta llega por el chat en vivo.
      if (!data.silencio) setMsgs((m) => [...m, { de: 'bot', texto: data.texto || 'Gracias, en un rato te respondemos.' }])
    } catch {
      setMsgs((m) => [...m, { de: 'bot', texto: 'Uy, hubo un problema de conexión. Probá de nuevo en un momento.' }])
    } finally {
      setEnviando(false)
    }
  }

  // Las dudas que frenan la compra son siempre las mismas: cómo se paga, cuándo
  // llega y qué conviene pedir. Se ofrecen hechas para que no tengan que escribir.
  const sugerencias = ['Formas de pago', '¿Cuándo me llega?', '¿Qué modelos me convienen?', '¿Cuál es el mínimo de compra?']

  return (
    <div className="px-4 pt-3">
      <div className="rounded-xl border border-black/10 overflow-hidden">
        <div className="bg-[#0004FF] text-white px-4 py-2.5">
          <p className="text-[13px] font-semibold leading-tight">Chateá con nosotros</p>
          <p className="text-[11px] text-white/70">Te respondemos ahora mismo</p>
        </div>

        <div ref={cont} className="max-h-56 overflow-y-auto bg-[#F5F5F7] px-3 py-3 space-y-2">
          {msgs.length === 0 && (
            <p className="text-[13px] text-neutral-500 leading-snug">
              Preguntanos lo que necesites del catálogo: colores, medidas, precios o cómo cerrar el pedido.
            </p>
          )}
          {msgs.map((m, i) => (
            <div key={i} className={`max-w-[85%] rounded-2xl px-3 py-2 text-[13.5px] leading-snug whitespace-pre-wrap ${
              m.de === 'cliente'
                ? 'ml-auto bg-[#0004FF] text-white rounded-br-md'
                : 'bg-white border border-black/5 rounded-bl-md'}`}>
              {m.texto}
            </div>
          ))}
          {enviando && <div className="bg-white border border-black/5 rounded-2xl rounded-bl-md px-3 py-2 text-[13.5px] text-neutral-400 w-16">…</div>}
        </div>

        {msgs.length === 0 && (
          <div className="flex flex-wrap gap-1.5 px-3 py-2 bg-white border-t border-black/5">
            {sugerencias.map((s) => (
              <button key={s} onClick={() => mandar(s)}
                className="rounded-full border border-[#0004FF]/30 text-[#0004FF] px-2.5 py-1 text-[11.5px]">
                {s}
              </button>
            ))}
          </div>
        )}

        <div className="flex items-center gap-2 border-t border-black/5 bg-white px-3 py-2">
          <input value={texto} onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') mandar() }}
            placeholder="Escribí tu consulta…"
            className="flex-1 text-[13.5px] outline-none bg-transparent py-1.5" />
          <button onClick={() => mandar()} disabled={enviando || !texto.trim()}
            className="rounded-full bg-[#0004FF] text-white p-2 disabled:opacity-40">
            <Send size={15} />
          </button>
        </div>
      </div>
    </div>
  )
}

function AyudaCatalogo({ acceso, offset }: { acceso: Acceso | null; offset?: string }) {
  const [open, setOpen] = useState(false)
  const [abierta, setAbierta] = useState<number | null>(null)
  const [entrantes, setEntrantes] = useState<string[]>([])
  const [sinLeer, setSinLeer] = useState(0)
  // Catálogo de disponibilidad: sin chat (IRIS cotiza) y sin las preguntas de precio.
  const sinPrecios = useSinPrecios()
  const faq = sinPrecios ? FAQ_SIN_PRECIOS : FAQ

  // Si alguien del equipo le escribe (desde Orbital Suite o contestando el aviso en
  // Telegram), el mensaje aparece acá mientras el cliente sigue mirando el catálogo:
  // el panel se abre solo. Se consulta cada 8 s y solo desde que se cargó la página,
  // así no le saltan mensajes viejos al volver a entrar.
  const desde = useRef<string>(new Date().toISOString())
  useEffect(() => {
    const tick = async () => {
      if (!acceso?.codigo || sinPrecios) return
      const { data } = await supabase.rpc('catalogo_chat_escuchar', { p_acceso: acceso.codigo, p_desde: desde.current })
      const nuevos = (data ?? []) as { contenido: string; created_at: string }[]
      if (!nuevos.length) return
      desde.current = nuevos[nuevos.length - 1].created_at
      setEntrantes((prev) => [...prev, ...nuevos.map((m) => m.contenido)])
      setOpen((abierto) => { if (!abierto) setSinLeer((n) => n + nuevos.length); return true })
    }
    const id = setInterval(tick, 8000)
    return () => clearInterval(id)
  }, [acceso])

  useEffect(() => { if (open) setSinLeer(0) }, [open])

  // Comprar acá es con asesoramiento: la duda es la forma de pago, la entrega o qué
  // conviene pedir, y si nadie abre la charla el cliente se va con la duda puesta.
  // Al minuto de estar mirando, el asistente saluda una vez y ofrece esos tres temas.
  // Una sola vez por día y por cliente: si ya escribió, no aparece.
  useEffect(() => {
    if (sinPrecios) return
    const hoy = new Date().toISOString().slice(0, 10)
    if (localStorage.getItem(SALUDO_KEY) === hoy) return
    const t = setTimeout(() => {
      if (localStorage.getItem(CHAT_CONV_KEY)) return // ya está charlando
      localStorage.setItem(SALUDO_KEY, hoy)
      const quien = (acceso?.label?.split(' - ')[1] || '').trim()
      // El campo vendedor del link muchas veces trae una etiqueta ("asignado", "propio",
      // "ex_vendedor"...) y no una persona: solo se nombra si es un vendedor real, que es
      // el que tiene teléfono (el mismo criterio que la tarjeta de ayuda de abajo).
      const vend = acceso?.vendedor_tel ? acceso?.vendedor : null
      setEntrantes((prev) => [...prev, `👋 Hola${quien ? ' ' + quien : ''}! Soy IRIS, de Orbital.\n\n` +
        `Si te queda alguna duda con las formas de pago, la entrega o qué modelos te convienen, escribime por acá y te ayudo` +
        `${vend ? `. También podés hablar directo con ${vend}` : ''}.`])
      setOpen(true)
    }, 60000)
    return () => clearTimeout(t)
  }, [acceso])
  const optica = empresaDe(acceso?.label)
  const vendedor = acceso?.vendedor || null
  const tel = (acceso?.vendedor_tel || '').replace(/\D/g, '') || TEL_IRIS
  const propio = !!acceso?.vendedor_tel
  const msg = `Hola${vendedor && propio ? ` ${vendedor}` : ''}! Soy ${optica || 'una óptica'} y estoy en el catálogo online. Necesito una mano con:`
  const wa = `https://wa.me/${tel}?text=${encodeURIComponent(msg)}`

  return (
    <>
      {/* El botón blanco pasaba desapercibido y nadie lo tocaba: ahora va en el azul
          de marca y dice qué hace, porque atrás hay alguien que contesta al toque. */}
      <button onClick={() => setOpen(true)} aria-label="Chatear con Orbital"
        className={`fixed ${offset ?? "bottom-5"} right-5 z-30 flex items-center gap-2 rounded-full bg-[#0004FF] text-white shadow-xl shadow-[#0004FF]/25 px-5 py-3.5 text-sm font-semibold hover:brightness-110 transition`}>
        <MessageCircle size={18} />
        <span>¿Te ayudo?</span>
        {sinLeer > 0
          ? <span className="absolute -top-1.5 -right-1.5 min-w-5 h-5 px-1 rounded-full bg-[#00E07B] text-[#0a0a0a] text-[11px] font-bold flex items-center justify-center ring-2 ring-white">{sinLeer}</span>
          : <span className="absolute -top-1 -right-1 h-3 w-3 rounded-full bg-[#00E07B] ring-2 ring-white" />}
      </button>

      {open && (
        <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center bg-black/40 px-0 sm:px-4" onClick={() => setOpen(false)}>
          <div className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl max-h-[88vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="sticky top-0 bg-white border-b border-black/5 px-4 py-3 flex items-center justify-between z-10">
              <p className="font-semibold text-[15px]">¿Te ayudo?</p>
              <button onClick={() => setOpen(false)} className="p-1"><X size={20} /></button>
            </div>

            {!sinPrecios && <ChatIris acceso={acceso} entrantes={entrantes} />}

            <div className="px-4 pt-4 pb-1">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">Dudas frecuentes</p>
            </div>

            <div className="px-4 py-2 divide-y divide-black/5">
              {faq.map((f, i) => (
                <div key={i} className="py-1">
                  <button onClick={() => setAbierta(abierta === i ? null : i)}
                    className="w-full flex items-start justify-between gap-3 text-left py-2.5">
                    <span className="text-[13.5px] font-medium leading-snug">{f.q}</span>
                    <ChevronDown size={17} className={`shrink-0 mt-0.5 text-neutral-400 transition-transform ${abierta === i ? 'rotate-180' : ''}`} />
                  </button>
                  {abierta === i && <p className="text-[13px] text-neutral-600 leading-relaxed pb-3 pr-6">{f.a}</p>}
                </div>
              ))}
            </div>

            <div className="px-4 pb-5 pt-2">
              <div className="rounded-xl border border-black/10 bg-[#F5F5F7] p-4">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500 mb-1">
                  {propio ? 'Tu vendedor de zona' : 'Atención Orbital'}
                </p>
                <p className="text-[15px] font-semibold">{propio && vendedor ? vendedor : 'Orbital Eyewear'}</p>
                <p className="text-[13px] text-neutral-500 font-mono mt-0.5">
                  +{tel.replace(/^(\d{2})(\d)(\d{2})(\d{4})(\d{4})$/, '$1 $2 $3 $4-$5')}
                </p>
                <a href={wa} target="_blank" rel="noreferrer"
                  className="mt-3 w-full flex items-center justify-center gap-2 bg-[#0004FF] text-white rounded-xl py-3 text-sm font-medium">
                  <MessageCircle size={16} /> Escribir por WhatsApp
                </a>
                <p className="text-[11px] text-neutral-400 text-center mt-2">Lunes a viernes de 9 a 19 hs</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

export default function CatalogoPublico() {
  // token del link (?k=) tiene prioridad sobre la clave guardada
  const [clave, setClave] = useState<string | null>(() => {
    try { const k = new URLSearchParams(window.location.search).get('k'); if (k) return k.trim() } catch { /* noop */ }
    return localStorage.getItem(CLAVE_KEY)
  })
  const [claveOk, setClaveOk] = useState(false)
  // ¿viene de la landing de bienvenida? El modo queda guardado para que sobreviva
  // una recarga en medio del armado del pedido.
  //
  // OJO: antes solo se apagaba con ?pack=0, así que quedaba pegado al navegador
  // para siempre. A un cliente de Plan Canje, cuyo link no pide pack, el catálogo
  // le seguía mostrando "Estás armando tu Pack de Bienvenida" — le hablábamos de
  // una propuesta y le mostrábamos otra. Ahora un link de acceso sin ?pack lo
  // apaga: el modo pertenece al link, no al navegador.
  const [modoPack] = useState<boolean>(() => {
    try {
      const sp = new URLSearchParams(window.location.search)
      const p = sp.get('pack')
      if (p === '0' || p === 'off') { localStorage.removeItem(PACK_KEY); return false }
      if (p) { localStorage.setItem(PACK_KEY, '1'); return true }
      if (sp.get('k')) { localStorage.removeItem(PACK_KEY); return false }
      // Sin parámetros (recarga o marcador) se respeta lo último que se abrió.
      return localStorage.getItem(PACK_KEY) === '1'
    } catch { return false }
  })
  const [bloqueo, setBloqueo] = useState<{ label: string | null; vendedor_tel?: string | null } | null>(null)
  const [acceso, setAcceso] = useState<Acceso | null>(() => {
    try { return JSON.parse(localStorage.getItem(ACCESO_KEY) || 'null') } catch { return null }
  })
  const [todos, setTodos] = useState<HomeModelo[]>([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [grupoActivo, setGrupoActivo] = useState<string | null>(null)
  // Pestaña "Conocé más": virales, Triple Protección y lentes de color (lo mismo que ven los colaboradores)
  const [conoce, setConoce] = useState(false)
  const [postventa, setPostventa] = useState(false)
  // Crear contenido: buscador de modelos que abre la ficha sin precio ni carrito
  const [contenido, setContenido] = useState(false)
  const [selContenido, setSelContenido] = useState<Modelo | null>(null)
  // navegación
  const [sel, setSel] = useState<Modelo | null>(null)
  const [quick, setQuick] = useState<Modelo | null>(null)
  const [infoGrupo, setInfoGrupo] = useState<string | null>(null)
  const [carritoOpen, setCarritoOpen] = useState(false)
  const [cart, setCart] = useState<Record<string, CartItem>>(() => {
    try { return JSON.parse(localStorage.getItem(CART_KEY) || '{}') } catch { return {} }
  })

  // Bono de campaña: vive en el token, no en el catálogo. Sin bono no se renderiza nada.
  const [bono, setBono] = useState<BonoEstado | null>(null)
  const [celebra, setCelebra] = useState<string | null>(null)
  const ganadoRef = useRef({ bonificacion: 0, piezas: 0 })

  useEffect(() => { localStorage.setItem(CART_KEY, JSON.stringify(cart)) }, [cart])

  // validar clave/token guardado o del link al entrar
  useEffect(() => {
    if (!clave) { setLoading(false); return }
    supabase.rpc('catalogo_entrar', { p: clave, p_device: deviceId() }).then(({ data, error }) => {
      const r = data as any
      if (r?.ok) {
        setClaveOk(true); setBloqueo(null)
        localStorage.setItem(CLAVE_KEY, clave)
        const acc: Acceso = { tipo: r.tipo, codigo: r.codigo, cod_cliente: r.cod_cliente, label: r.label, vendedor: r.vendedor, vendedor_tel: r.vendedor_tel ?? null }
        setAcceso(acc); localStorage.setItem(ACCESO_KEY, JSON.stringify(acc))
      } else if (r?.motivo === 'otro_dispositivo') {
        // El link ya está en uso en otro equipo: mostramos la pantalla de pedir acceso. El token se
        // guarda para que, si vuelve sin el link, caiga otra vez acá y no en la pantalla de clave.
        localStorage.setItem(CLAVE_KEY, clave)
        setBloqueo({ label: r.label ?? null, vendedor_tel: r.vendedor_tel ?? null })
      } else if (error) {
        // Falla de red: no se borra nada, al recargar vuelve a intentar con el mismo token.
      } else {
        localStorage.removeItem(CLAVE_KEY); localStorage.removeItem(ACCESO_KEY); setClave(null); setAcceso(null)
      }
      setLoading(false)
    })
  }, [clave])

  // cargar todo el catálogo una vez; los grupos se arman en el cliente
  useEffect(() => {
    if (!claveOk || !clave) return
    supabase.rpc('catalogo_home', { p_clave: clave }).then(({ data, error }) => {
      setTodos(error ? [] : ((data as HomeModelo[]) ?? [])); setLoading(false)
    })
  }, [claveOk, clave])

  // foto primero, sin foto al final
  const conFoto = (arr: HomeModelo[]) => arr.map((m, i) => ({ m, i })).sort((a, b) => {
    // los de precio 32.645 van al final de cada categoría (se mira el precio de LISTA: el cliente
    // con lista especial ve otro número, pero el orden de la góndola no cambia)
    const lp = (m: Modelo) => m.precio_lista_desde ?? m.precio_desde
    const pa = lp(a.m) === 32645 ? 1 : 0, pb = lp(b.m) === 32645 ? 1 : 0
    const ia = a.m.imagenes?.length ? 0 : 1, ib = b.m.imagenes?.length ? 0 : 1
    return pa - pb || ia - ib || a.i - b.i
  }).map((x) => x.m)

  const qn = q.trim().toLowerCase()
  const buscando = qn.length > 0
  const resultados = useMemo(() => conFoto(todos.filter((m) => m.modelo.toLowerCase().includes(qn))), [todos, qn])
  const grupoObj = GRUPOS.find((g) => g.key === grupoActivo) || null
  const modelosGrupo = useMemo(() => (grupoObj ? conFoto(todos.filter((m) => matchGrupo(grupoObj, m))) : []), [todos, grupoObj])

  const cartCount = Object.values(cart).reduce((a, c) => a + c.cantidad, 0)
  const cartTotal = Object.values(cart).reduce((a, c) => a + c.cantidad * c.precio, 0)
  // Token de vendedores de un distribuidor: ven disponibilidad, no precios.
  const sinPrecios = acceso?.tipo === 'dist_vend'
  // Panel de la óptica (postventa, mis anteojos, publicaciones): solo accesos de óptica con cliente
  const esOptica = acceso?.tipo === 'optica' && !!acceso.cod_cliente

  // ¿este token trae bono? Se consulta una vez, al validar el acceso.
  useEffect(() => {
    if (!claveOk) { setBono(null); return }
    const cod = acceso?.codigo || clave
    if (!cod) return
    supabase.rpc('catalogo_bono_estado', { p_acceso: cod }).then(({ data }) => {
      setBono((data as BonoEstado) ?? null)
    })
  }, [claveOk, acceso?.codigo, clave])

  // ── Tracking: cuánto miró y qué llegó a cargar ──────────────────────────────
  // Hasta acá solo sabíamos que entró, y —si confirmaba— qué pidió. Lo del medio
  // (el rato que estuvo y el carrito que armó y no cerró) es justo la señal que le
  // sirve al vendedor para saber a quién llamar hoy.
  const sesionRef = useRef<string | null>(null)
  const segundosRef = useRef(0)

  useEffect(() => {
    if (!claveOk || !clave) return
    // La sesión se guarda en la pestaña: si el componente se vuelve a montar —o React
    // lo monta dos veces en desarrollo— seguimos escribiendo en la misma fila en vez
    // de abrir una visita nueva. Muere cuando la óptica cierra la pestaña, que es
    // exactamente lo que queremos contar como "una visita".
    if (!sesionRef.current) {
      try { sesionRef.current = sessionStorage.getItem(SESION_KEY) } catch { /* modo privado */ }
    }
    // OJO: rpc() es un builder perezoso. Sin .then() no sale el request.
    const latir = () => {
      supabase.rpc('catalogo_sesion_ping', {
        p_codigo: clave, p_sesion: sesionRef.current,
        p_segundos: segundosRef.current, p_device: deviceId(),
      }).then(({ data }) => {
        if (typeof data !== 'string') return
        sesionRef.current = data
        try { sessionStorage.setItem(SESION_KEY, data) } catch { /* modo privado */ }
      })
    }
    latir()
    // El reloj corre solo con la pestaña a la vista: dejarla abierta de fondo no cuenta.
    const tic = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return
      segundosRef.current += 15
      if (segundosRef.current % 30 === 0) latir()
    }, 15000)
    const alCambiar = () => { if (segundosRef.current) latir() }
    document.addEventListener('visibilitychange', alCambiar)
    return () => {
      window.clearInterval(tic)
      document.removeEventListener('visibilitychange', alCambiar)
      if (segundosRef.current) latir()
    }
  }, [claveOk, clave])

  // Link del WhatsApp de carrito sin cerrar (?carrito=1): puede abrirlo en otro equipo, así que
  // traemos el último carrito guardado de ese acceso (recortado a stock libre) y lo abrimos.
  useEffect(() => {
    if (!claveOk || !clave) return
    const sp = new URLSearchParams(window.location.search)
    if (sp.get('carrito') !== '1') return
    sp.delete('carrito')
    window.history.replaceState(null, '', window.location.pathname + (sp.toString() ? `?${sp}` : ''))
    supabase.rpc('catalogo_carrito_recuperar', { p_codigo: clave }).then(({ data }) => {
      const items = Array.isArray(data) ? (data as CartItem[]) : []
      if (!items.length) return
      setCart(Object.fromEntries(items.map((i) => [i.codigo, i])))
      setCarritoOpen(true)
    })
  }, [claveOk, clave])

  // El carrito se guarda entero y pisado, no por diferencias: lo que queda grabado
  // es siempre el último estado real de la pantalla. Con demora, para no escribir
  // una fila por cada clic en el "+".
  useEffect(() => {
    if (!claveOk || !clave) return
    const t = window.setTimeout(() => {
      supabase.rpc('catalogo_carrito_guardar', {
        p_codigo: clave, p_device: deviceId(),
        p_items: Object.values(cart).map((i) => ({
          codigo: i.codigo, modelo: i.modelo, cantidad: i.cantidad, precio: i.precio,
        })),
        p_unidades: cartCount, p_importe: cartTotal,
      }).then(() => {})
    }, 2500)
    return () => window.clearTimeout(t)
  }, [cart, cartCount, cartTotal, claveOk, clave])

  // Pack de bienvenida: lo activa el link de la landing (?pack=bienvenida) y queda
  // pegado al navegador para que sobreviva la navegación del catálogo.
  const packCalc = useMemo(() => {
    if (!modoPack) return null
    const items = Object.values(cart)
    const oport = items.filter((i) => i.oportunidad).reduce((a, c) => a + c.cantidad, 0)
    return calcularPack(cartCount - oport, oport)
  }, [modoPack, cart, cartCount])

  // Bono en % (Diferenciarte v2) convive con el pack: se calcula sobre lo que se factura.
  const bonoPct = esBonoPct(bono)
  const bonoCalc = useMemo(
    () => calcularBono(cartTotal, bono, cartCount, packCalc && bonoPct ? importeSinCargo(Object.values(cart), packCalc.eligio) : 0),
    [cartTotal, bono, cartCount, packCalc, bonoPct, cart])

  // Al cruzar un escalón, cartel de celebración (una sola vez por escalón).
  useEffect(() => {
    if (!bonoCalc) return
    const prev = ganadoRef.current
    const partes: string[] = []
    if (bonoCalc.bonificacion > prev.bonificacion) partes.push(`${kAr(bonoCalc.bonificacion)} de bonificación`)
    if (bonoCalc.piezas > prev.piezas) partes.push(`${bonoCalc.piezas} pares sin cargo`)
    ganadoRef.current = { bonificacion: bonoCalc.bonificacion, piezas: bonoCalc.piezas }
    if (partes.length) setCelebra(partes.join(' y '))
  }, [bonoCalc])

  function addCart(v: Variante, modelo: string) {
    setCart((c) => {
      const prev = c[v.codigo]
      const cantidad = Math.min((prev?.cantidad ?? 0) + 1, v.stock)
      return { ...c, [v.codigo]: { codigo: v.codigo, modelo, descripcion: v.descripcion, precio: v.precio, imagen: v.imagen, stock: v.stock, cantidad, oportunidad: esOportunidad(v.clasificacion) } }
    })
  }
  function setQty(codigo: string, cantidad: number) {
    setCart((c) => {
      if (cantidad <= 0) { const { [codigo]: _x, ...rest } = c; return rest }
      const max = c[codigo]?.stock
      return { ...c, [codigo]: { ...c[codigo], cantidad: max ? Math.min(cantidad, max) : cantidad } }
    })
  }

  function verGrupo(k: string) { setGrupoActivo(k); setQ(''); setConoce(false); window.scrollTo({ top: 0 }) }
  function irInicio() { setGrupoActivo(null); setQ(''); setConoce(false) }
  function verConoce() { setConoce(true); setGrupoActivo(null); setQ(''); window.scrollTo({ top: 0 }) }
  const modelosDe = (key: string) => {
    const g = GRUPOS.find((x) => x.key === key)
    return g ? todos.filter((m) => matchGrupo(g, m)).map((m) => m.modelo).sort() : []
  }
  function abrirModelo(nombre: string) { const m = todos.find((x) => x.modelo === nombre); if (m) setSel(m) }

  if (loading) return <div className="min-h-screen flex items-center justify-center text-sm text-neutral-500 bg-white font-mono">Cargando catálogo…</div>
  if (bloqueo) return <BloqueoGate label={bloqueo.label} vendedorTel={bloqueo.vendedor_tel} codigo={clave} />
  if (!clave || !claveOk) return <ClaveGate onOk={(c) => { setClave(c); setClaveOk(true) }} />

  // ¿hay barra fija abajo (pack o bono)? Los flotantes se corren para no taparla.
  const barraFija = !!packCalc || !!(bonoCalc && !bonoCalc.vencido)

  // Inspiración (todos) y Postventa / Mi óptica (solo ópticas), al lado de Pedido; en el celu, fila propia
  const accesosHeader = (
    <>
      <button onClick={verConoce}
        className={`flex-1 sm:flex-none text-[11px] rounded-full px-3 py-2 font-semibold whitespace-nowrap uppercase tracking-wide border ${conoce && !buscando ? 'bg-gradient-to-r from-fuchsia-600 via-pink-500 to-orange-400 text-white border-transparent' : 'bg-gradient-to-r from-fuchsia-50 to-orange-50 border-fuchsia-300 text-fuchsia-700'}`}>
        ✦ Inspiración
      </button>
      {!sinPrecios && (
        <button onClick={() => setContenido(true)}
          className="flex-1 sm:flex-none text-[11px] rounded-full px-3 py-2 font-semibold whitespace-nowrap uppercase tracking-wide border border-fuchsia-300 bg-white text-fuchsia-700 hover:border-fuchsia-500">
          Crear contenido
        </button>
      )}
      {!sinPrecios && acceso?.tipo !== 'campana' && (
        <button onClick={() => setPostventa(true)}
          className="flex-1 sm:flex-none text-[11px] rounded-full px-3 py-2 font-semibold whitespace-nowrap uppercase tracking-wide border border-black/15 bg-white text-neutral-700 hover:border-[#0004FF]/40">
          Postventa
        </button>
      )}
    </>
  )
  const navPill = (active: boolean, accent: Grupo['accent']) =>
    `text-[11px] rounded-full px-3 py-1.5 font-semibold whitespace-nowrap tracking-wide uppercase transition border ${active ? ACCENT[accent] + ' border-transparent' : 'bg-white border-black/10 text-neutral-600 hover:border-[#0004FF]/40'}`

  return (
    <SinPreciosCtx.Provider value={sinPrecios}>
    <div className="min-h-screen bg-white text-[#0a0a0a] font-mono">
      {/* Banner chico estilo tienda */}
      <div className="bg-[#0a0a0a] text-white text-[10px] tracking-[0.25em] uppercase text-center py-1.5 px-3">
        {sinPrecios ? 'Orbital® · Disponibilidad en vivo sobre stock real' : 'Orbital® · Catálogo mayorista — pedido online sobre stock real'}
      </div>
      {/* Vendedores del distribuidor: el catálogo es de disponibilidad, sin precios */}
      {sinPrecios && (
        <div className="bg-emerald-50 border-b border-emerald-200 text-emerald-800 text-[11px] text-center py-1.5 px-3 font-semibold">
          👓 Disponibilidad en vivo · los precios te los pasa {empresaDe(acceso?.label) || 'tu empresa'}
        </div>
      )}
      {/* Marca de agua: catálogo personalizado del cliente (link con token) */}
      {acceso?.tipo === 'optica' && acceso.label && (
        <div className="bg-[#0004FF]/[0.06] border-b border-[#0004FF]/15 text-[#0004FF] text-[11px] text-center py-1.5 px-3 font-semibold">
          🔒 Catálogo con precios exclusivos de {(acceso.label.split(' - ')[1] || acceso.label).trim()} · uso personal
        </div>
      )}
      {/* Pack de bienvenida: llega desde la landing */}
      {packCalc && <PackBanner />}
      {/* Bono de campaña: solo si el token lo trae */}
      {bono && (!packCalc || bonoPct) && <BonoBanner bono={bono} />}
      {/* Header */}
      <header className="bg-white border-b border-black/10 sticky top-0 z-20">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <button onClick={irInicio} className="shrink-0"><Logo /></button>
          <div className="flex items-center gap-2">
            <div className="hidden sm:flex items-center gap-2">{accesosHeader}</div>
            <InstalarApp nombre="Catálogo Orbital" que="el catálogo" bajada="Queda con el ícono de Orbital y entra directo a tu catálogo, sin clave." mono />
            <button onClick={() => setCarritoOpen(true)} className="relative flex items-center gap-1.5 text-sm bg-[#0004FF] text-white rounded-full px-4 py-2 font-medium">
              <ShoppingCart size={16} /> <span className="hidden sm:inline">{cartCount > 0 ? 'Terminar pedido →' : 'Pedido'}</span>
              {cartCount > 0 && <span className="absolute -top-1.5 -right-1.5 bg-red-500 text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">{cartCount}</span>}
            </button>
          </div>
        </div>
        {/* En el celu, Inspiración / Postventa van en su propia fila */}
        <div className="sm:hidden max-w-6xl mx-auto px-4 pb-2 flex gap-2">{accesosHeader}</div>
        {/* Buscador */}
        <div className="max-w-6xl mx-auto px-4 pb-2">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
            <input value={q} onChange={(e) => { setQ(e.target.value); setGrupoActivo(null); setConoce(false) }} placeholder="Buscar modelo…"
              className="w-full rounded-full bg-[#F5F5F7] border border-black/10 pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0004FF]/30" />
          </div>
        </div>
        {/* Propuestas: acceso directo a cada grupo */}
        <div className="max-w-6xl mx-auto px-4 pb-3">
          <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
            <button onClick={irInicio} className={navPill(!buscando && !grupoActivo && !conoce, 'dark')}>Inicio</button>
            {GRUPOS.map((g) => (
              <button key={g.key} onClick={() => verGrupo(g.key)} className={navPill(grupoActivo === g.key, g.accent)}>{g.nombre}</button>
            ))}
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-3 py-4">
        {/* Los tres pasos del pack, arriba de todo en la home del catálogo */}
        {packCalc && !buscando && !grupoActivo && !conoce && (
          <div className="mb-4">
            <PackPasos calc={packCalc} onVerOportunidades={() => verGrupo('oportunidades')} />
          </div>
        )}
        {buscando ? (
          <>
            <p className="text-[11px] text-neutral-400 mb-3">{resultados.length} resultado{resultados.length !== 1 ? 's' : ''} para “{q.trim()}”</p>
            {resultados.length ? (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
                {resultados.map((m) => <ModelCard key={m.modelo} m={m} onOpen={() => setSel(m)} onQuick={() => setQuick(m)} />)}
              </div>
            ) : <p className="text-sm text-neutral-400 text-center py-16">No hay modelos con ese nombre.</p>}
          </>
        ) : conoce ? (
          <div className="font-sans">
            <ColabInspiracion optica clave={clave} onVerTriple={() => verGrupo('triple')} onModelo={abrirModelo}
              modelosTriple={modelosDe('triple')} modelosColor={modelosDe('bajaluz')} />
          </div>
        ) : grupoObj ? (
          <>
            <div className={`flex items-center justify-between rounded-lg px-3 py-2 mb-3 ${ACCENT[grupoObj.accent]}`}>
              <button onClick={() => setInfoGrupo(grupoObj.key)} className="flex items-center gap-1.5 min-w-0 text-left group/info" title={`Qué es ${grupoObj.nombre}`}>
                <span className="text-[13px] font-bold tracking-[0.18em] uppercase truncate underline decoration-white/30 underline-offset-2 group-hover/info:decoration-white">{grupoObj.nombre}</span>
                <Info size={13} className="shrink-0 opacity-80 group-hover/info:opacity-100" />
                {grupoObj.sub && <span className="text-[10px] opacity-70 truncate hidden sm:inline">{grupoObj.sub}</span>}
                <span className="text-[10px] opacity-70">· {modelosGrupo.length}</span>
              </button>
              <button onClick={irInicio} className="text-[11px] font-semibold whitespace-nowrap opacity-90 hover:opacity-100">← Inicio</button>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
              {modelosGrupo.map((m) => <ModelCard key={m.modelo} m={m} grupo={grupoObj.key} onOpen={() => setSel(m)} onQuick={() => setQuick(m)} />)}
            </div>
          </>
        ) : (
          (() => {
            // Dedup de arriba para abajo: cada modelo se muestra en la sección más alta que le toca (no repetir tapas)
            const usados = new Set<string>()
            return GRUPOS.map((g) => {
              const items = conFoto(todos.filter((m) => matchGrupo(g, m)))
              // "Cuando baja la luz" es transversal (por color de cristal): muestra su set completo con su tapa ocre/naranja/rojo, sin dedup
              if (g.key === 'bajaluz') {
                if (!items.length) return null
                return <SectionRow key={g.key} grupo={g} items={items} row={items}
                  onOpen={(m) => setSel(m)} onQuick={(m) => setQuick(m)} onInfo={() => setInfoGrupo(g.key)} />
              }
              const row = items.filter((m) => MULTI_GRUPO.includes(m.modelo) || !usados.has(m.modelo))
              row.forEach((m) => { if (!MULTI_GRUPO.includes(m.modelo)) usados.add(m.modelo) })
              if (!row.length) return null
              return <SectionRow key={g.key} grupo={g} items={items} row={row}
                onOpen={(m) => setSel(m)} onQuick={(m) => setQuick(m)} onInfo={() => setInfoGrupo(g.key)} />
            })
          })()
        )}
      </main>

      {infoGrupo && <InfoModal grupoKey={infoGrupo} onClose={() => setInfoGrupo(null)} />}

      {quick && <QuickAdd modelo={quick} clave={clave} cart={cart} onAdd={addCart} onSetQty={setQty} onClose={() => setQuick(null)} onVerDetalle={() => { setSel(quick); setQuick(null) }} />}
      {postventa && !esOptica && <SinOptica onClose={() => setPostventa(false)} />}
      {postventa && esOptica && <PostventaOptica clave={clave} onClose={() => setPostventa(false)} />}
      {contenido && <ContenidoBuscar modelos={todos} clave={clave} esOptica={esOptica} onElegir={(m) => { setSelContenido(m); setContenido(false) }} onClose={() => setContenido(false)} />}
      {selContenido && <ModeloSheet modelo={selContenido} clave={clave} esOptica={esOptica} soloContenido cart={cart} onAdd={addCart} onSetQty={setQty} onClose={() => { setSelContenido(null); setContenido(true) }} />}
      {sel && <ModeloSheet modelo={sel} clave={clave} esOptica={esOptica} cart={cart} onAdd={addCart} onSetQty={setQty} onClose={() => setSel(null)} />}
      {carritoOpen && <CarritoSheet cart={cart} clave={clave} acceso={acceso} bono={bono} modoPack={!!packCalc} onSetQty={setQty} onClose={() => setCarritoOpen(false)} onDone={() => setCart({})} />}

      {/* Bono: cartel de escalón desbloqueado + barra de progreso fija */}
      {celebra && (!packCalc || bonoPct) && <BonoCelebra texto={celebra} onClose={() => setCelebra(null)} />}
      {packCalc && !carritoOpen && !sel && !quick && (
        <PackBarra calc={packCalc} onVerOportunidades={() => verGrupo('oportunidades')}
          extra={bonoPct && bonoCalc && !bonoCalc.vencido ? <BonoLinea calc={bonoCalc} /> : undefined} />
      )}
      {!packCalc && bonoCalc && !bonoCalc.vencido && !carritoOpen && !sel && !quick && (
        <BonoBarra calc={bonoCalc} onVerPares={() => verGrupo('oportunidades')} />
      )}

      {/* Ayuda al cliente: FAQ automática + WhatsApp del vendedor asignado */}
      {!carritoOpen && !sel && !quick && !infoGrupo && (
        <AyudaCatalogo acceso={acceso} offset={cartCount > 0 ? (barraFija ? "bottom-52 md:bottom-5" : "bottom-28 md:bottom-5") : (barraFija ? "bottom-28 md:bottom-5" : "bottom-5")} />
      )}

      {/* Barra flotante de pedido en mobile */}
      {cartCount > 0 && !carritoOpen && !sel && (
        <div className={`md:hidden fixed ${barraFija ? 'bottom-28' : 'bottom-4'} inset-x-4 z-20`}>
          <p className="text-[11px] text-center font-semibold text-[#0004FF] bg-white/95 rounded-full py-1 mb-1.5 shadow-sm">Cuando termines de elegir, tocá acá para enviarlo 👇</p>
          <button onClick={() => setCarritoOpen(true)} className="w-full bg-[#0004FF] text-white rounded-xl py-3 px-4 flex items-center justify-between shadow-lg animate-[pulse_1.5s_ease-in-out_3]">
            <span className="text-sm font-medium">{cartCount} u.{!sinPrecios && ` · ${kAr(cartTotal)}`}</span>
            <span className="text-sm font-bold">Terminar pedido →</span>
          </button>
        </div>
      )}
      {/* Desktop: la misma barra, abajo al centro */}
      {cartCount > 0 && !carritoOpen && !sel && (
        <button onClick={() => setCarritoOpen(true)} className={`hidden md:flex fixed ${barraFija ? 'bottom-28' : 'bottom-5'} left-1/2 -translate-x-1/2 bg-[#0004FF] text-white rounded-full py-3 px-6 items-center gap-3 shadow-lg z-20`}>
          <span className="text-sm">{cartCount} u. elegidas{!sinPrecios && ` · ${kAr(cartTotal)}`}</span>
          <span className="text-sm font-bold">Terminar y enviar pedido →</span>
        </button>
      )}
    </div>
    </SinPreciosCtx.Provider>
  )
}

// ── Carga rápida desde la grilla: elegir color y cantidad sin entrar al detalle ──
function QuickAdd({ modelo, clave, cart, onAdd, onSetQty, onClose, onVerDetalle }: {
  modelo: Modelo; clave: string; cart: Record<string, CartItem>
  onAdd: (v: Variante, modelo: string) => void; onSetQty: (codigo: string, n: number) => void; onClose: () => void; onVerDetalle: () => void
}) {
  const [vars, setVars] = useState<Variante[]>([])
  const [loading, setLoading] = useState(true)
  const sinPrecios = useSinPrecios()
  useEffect(() => {
    supabase.rpc('catalogo_modelo_v2', { p_clave: clave, p_modelo: modelo.modelo, p_tipo: null, p_clasif: null, p_trat: null }).then(({ data, error }) => {
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
          <div className="p-3">
            <p className="text-[11px] text-neutral-400 mb-2">{vars.length} colores — deslizá →</p>
            <div className="flex gap-2.5 overflow-x-auto pb-2">
              {vars.map((v) => {
                const q = cart[v.codigo]?.cantidad ?? 0
                return (
                  <div key={v.codigo} className={`shrink-0 w-32 rounded-xl border overflow-hidden ${q > 0 ? 'border-[#0004FF]' : 'border-black/10'}`}>
                    <div className="aspect-square relative" style={{ background: v.imagen ? '#fff' : colorSwatch(v.descripcion) }}>
                      {v.imagen && <img src={v.imagen} alt={v.descripcion ?? ''} className="w-full h-full object-contain" />}
                      <span className="absolute bottom-1 left-1 w-4 h-4 rounded-full border border-white shadow" style={{ background: colorSwatch(v.descripcion) }} />
                      {v.tiene_preventa && <span className="absolute top-1 right-1 bg-red-500 text-white text-[8px] font-bold rounded-full px-1.5 py-0.5">PV</span>}
                      {v.proyectado && <span className="absolute top-1 left-1 bg-[#b45309] text-white text-[8px] font-bold rounded-full px-1.5 py-0.5">📅</span>}
                    </div>
                    <div className="p-2">
                      <p className="text-[11px] font-medium leading-tight line-clamp-2 h-[28px]">{colorLegible(v.descripcion) || v.codigo}</p>
                      <div className="flex items-center gap-1 flex-wrap">{sinPrecios ? <p className="text-[10px] font-semibold text-emerald-600 mt-0.5">Disponible</p> : <p className="text-[12px] font-bold text-[#0004FF] mt-0.5">{kAr(v.precio)}</p>}{v.proyectado && <span className="text-[8px] font-semibold text-[#b45309] bg-[#fdf0dd] rounded px-1 py-0.5">proyectado</span>}</div>
                      {q === 0 ? (
                        <button onClick={() => onAdd(v, modelo.modelo)} className="w-full mt-1.5 rounded-lg bg-[#0004FF] text-white py-1.5 text-[11px] font-semibold flex items-center justify-center gap-1"><Plus size={12} />Agregar</button>
                      ) : (
                        <>
                          <div className="flex items-center justify-between mt-1.5">
                            <button onClick={() => onSetQty(v.codigo, q - 1)} className="w-7 h-7 rounded-lg border border-black/10 flex items-center justify-center"><Minus size={13} /></button>
                            <span className="text-sm font-bold">{q}</span>
                            <button onClick={() => onSetQty(v.codigo, q + 1)} disabled={q >= v.stock} className="w-7 h-7 rounded-lg border border-black/10 flex items-center justify-center disabled:opacity-30"><Plus size={13} /></button>
                          </div>
                          {q >= v.stock && <p className="text-[9px] text-neutral-400 text-center mt-0.5">Sin más stock</p>}
                        </>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
            <button onClick={onVerDetalle} className="w-full text-[12px] text-[#0004FF] font-medium py-2 mt-1">Ver fotos y detalle →</button>
          </div>
        )}
      </div>
    </div>
  )
}

// Postventa abierto con un acceso que no es de óptica (clave general, vendedor, campaña):
// el panel es de cada óptica, se ve con su link personal. Lo que cargan llega a la Suite.
function SinOptica({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white w-full sm:max-w-md sm:rounded-2xl rounded-t-2xl p-5">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-base font-bold">Postventa · Mi óptica</h2>
          <button onClick={onClose} className="p-1.5 rounded-full hover:bg-black/5"><X size={20} /></button>
        </div>
        <p className="text-sm text-neutral-600 font-sans leading-relaxed">
          Este panel es de cada óptica y se abre con <b>su link personal del catálogo</b>: ahí carga garantías y repuestos,
          ve los anteojos que nos compró (y tacha los que ya no tiene) y manda sus publicaciones.
        </p>
        <p className="text-sm text-neutral-600 font-sans leading-relaxed mt-2">
          Lo que cargan las ópticas se ve en Orbital Suite → <b>Red de ópticas</b>.
        </p>
        <a href="/red-opticas" className="mt-4 block text-center bg-[#0004FF] text-white rounded-xl py-2.5 text-sm font-medium">Abrir Red de ópticas</a>
      </div>
    </div>
  )
}

// ── Crear contenido: buscar un modelo y abrir su ficha para redes (sin precio ni carrito) ──
// Para ópticas suma "Mis anteojos" y "Mis publicaciones": todo lo de redes junto, separado de postventa.
function ContenidoBuscar({ modelos, clave, esOptica, onElegir, onClose }: {
  modelos: Modelo[]; clave: string; esOptica: boolean; onElegir: (m: Modelo) => void; onClose: () => void
}) {
  const [q, setQ] = useState('')
  const [solapa, setSolapa] = useState<'crear' | 'anteojos' | 'publicaciones'>('crear')
  const lista = modelos.filter((m) => !q.trim() || m.modelo.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 60)
  return (
    <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white w-full sm:max-w-lg sm:rounded-2xl rounded-t-2xl max-h-[92vh] flex flex-col">
        <div className="px-4 pt-3 pb-3 border-b border-black/5">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold">Crear contenido</h2>
            <button onClick={onClose} className="p-1.5 rounded-full hover:bg-black/5"><X size={20} /></button>
          </div>
          {esOptica && (
            <div className="flex gap-1 mt-1 mb-2 overflow-x-auto">
              {([['crear', 'Crear contenido'], ['anteojos', 'Mis anteojos'], ['publicaciones', 'Mis publicaciones']] as const).map(([k, l]) => (
                <button key={k} onClick={() => setSolapa(k)}
                  className={`whitespace-nowrap text-[11px] font-semibold uppercase tracking-wide px-3 py-1.5 rounded-full border ${solapa === k ? 'bg-fuchsia-600 text-white border-transparent' : 'bg-white border-black/10 text-neutral-600'}`}>{l}</button>
              ))}
            </div>
          )}
          {solapa === 'crear' && <>
          <p className="text-[11px] text-neutral-500 font-sans mb-2">Elegí un modelo y te armamos historia, posteo y guion para las redes de tu óptica. No toca tu pedido.</p>
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar modelo…"
              className="w-full rounded-full bg-[#F5F5F7] border border-black/10 pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-fuchsia-300" />
          </div>
          </>}
        </div>
        {solapa === 'anteojos' && <div className="overflow-y-auto p-4"><MisAnteojos clave={clave} /></div>}
        {solapa === 'publicaciones' && <div className="overflow-y-auto p-4"><MisPublicaciones clave={clave} /></div>}
        {solapa === 'crear' && <div className="overflow-y-auto p-3 grid grid-cols-3 sm:grid-cols-4 gap-2">
          {lista.map((m) => (
            <button key={m.modelo} onClick={() => onElegir(m)} className="rounded-xl border border-black/10 p-1.5 text-left hover:border-fuchsia-400">
              <div className="aspect-square bg-white rounded-lg overflow-hidden">
                {m.imagenes?.[0] ? <img src={m.imagenes[0]} alt={m.modelo} className="w-full h-full object-contain" loading="lazy" /> : null}
              </div>
              <p className="text-[10px] font-bold mt-1 truncate">{m.modelo}</p>
            </button>
          ))}
          {lista.length === 0 && <p className="col-span-full text-sm text-neutral-400 text-center py-6">Sin modelos con ese nombre.</p>}
        </div>}
      </div>
    </div>
  )
}

// ── Ficha del modelo con carrusel de colores ──
function ModeloSheet({ modelo, clave, esOptica, soloContenido, cart, onAdd, onSetQty, onClose }: {
  modelo: Modelo; clave: string; esOptica: boolean; soloContenido?: boolean; cart: Record<string, CartItem>
  onAdd: (v: Variante, modelo: string) => void; onSetQty: (codigo: string, n: number) => void; onClose: () => void
}) {
  const [vars, setVars] = useState<Variante[]>([])
  const [i, setI] = useState(0)
  const [loading, setLoading] = useState(true)
  const [medidas, setMedidas] = useState<Medidas | null>(null)
  const [ficha, setFicha] = useState<{ linea: string | null; descripcion: string | null } | null>(null)
  const sinPrecios = useSinPrecios()
  useEffect(() => {
    supabase.rpc('catalogo_modelo_v2', { p_clave: clave, p_modelo: modelo.modelo, p_tipo: null, p_clasif: null, p_trat: null }).then(({ data, error }) => {
      setVars(error ? [] : ((data as Variante[]) ?? [])); setLoading(false)
    })
    supabase.rpc('catalogo_medidas', { p_clave: clave, p_modelo: modelo.modelo }).then(({ data }) => setMedidas((data as Medidas) ?? null))
    supabase.rpc('catalogo_ficha_tienda', { p_clave: clave, p_modelo: modelo.modelo }).then(({ data }) => setFicha((data as typeof ficha) ?? null))
  }, [clave, modelo.modelo])
  const v = vars[i]
  // "Sobre este anteojo": la misma "Data del anteojo" que ven los colaboradores, por color:
  // ficha de la tienda + armazón / lente / tratamiento del color elegido + medidas.
  // Sale para todos los modelos (aunque la tienda no tenga descripción).
  const sobre = useMemo(() => {
    if (!v) return null
    const tipo = (v.tipo || '').toUpperCase() === 'RECETA' ? 'RECETA' : 'SOL'
    const trat = v.tratamiento && !/^(ninguno|sin tratamiento|-)$/i.test(v.tratamiento) ? v.tratamiento : null
    const cp = copiesDe(
      { modelo: modelo.modelo, linea: ficha?.linea ?? null, tipos: [tipo], descripcion: ficha?.descripcion ?? null, nuevo: false, best: false, precio_desde: null, colores: [] },
      { product_id: 0, handle: '', color: colorLegible(v.descripcion) || null, imagen: null, price: null, compare_at: null, sku: null, tipo, tratamiento: trat }, 0)
    const datos = [...cp.datos]
    // Si la tienda no trae la ficha técnica, se completa con las medidas cargadas en la Suite
    if (medidas && !datos.some((d) => /^Frente:/.test(d)) && medidas.frente) datos.push(`Frente: ${cap(medidas.frente)}`)
    if (medidas && !datos.some((d) => /^Varillas:/.test(d)) && medidas.patilla) datos.push(`Varillas: ${cap(medidas.patilla)}`)
    if (medidas?.formato) datos.push(`Formato: ${cap(medidas.formato)}`)
    if (medidas && (medidas.ancho || medidas.alto || medidas.largo) && !datos.some((d) => /^Medidas:/.test(d)))
      datos.push(`Medidas: ${[medidas.ancho && `ancho ${medidas.ancho} cm`, medidas.alto && `alto ${medidas.alto} cm`, medidas.largo && `varilla ${medidas.largo} cm`].filter(Boolean).join(' · ')}`)
    if (medidas?.para) datos.push(`Para: ${cap(medidas.para)}`)
    // Qué hace cada tratamiento, contado para el cliente
    const extra: string[] = []
    const t = `${trat ?? ''} ${v.descripcion ?? ''}`
    if (/infrarrojo/i.test(t)) extra.push('Triple Protección: UV400 + Blue Cut 420 nm (hasta 98% menos luz azul de pantallas) + filtro infrarrojo 808 nm (bloquea el calor del sol que llega al ojo). Adentro y afuera, en un mismo cristal.')
    else if (/blue ?cut/i.test(t)) extra.push('Blue Cut: filtra la luz azul de pantallas y LEDs. Menos fatiga visual frente a la compu y el celular.')
    if (/polariz/i.test(t)) extra.push('Polarizado: corta el reflejo del agua, la ruta y el asfalto mojado. Se ve más nítido y cansa menos.')
    if (/espej/i.test(t)) extra.push('Espejado: refleja parte de la luz antes de que entre al ojo. Ideal para mucho sol.')
    if (/(ocre|naranja|rojo|amarill)/i.test(cp.datos.find((d) => /^Lente:/.test(d)) ?? '')) extra.push('Cristal de color: suma contraste cuando baja la luz, en días grises o con niebla.')
    // Copies para las redes de la óptica. Solo B2B: sin precios, sin links ni códigos de la tienda
    // online de Orbital; el cierre siempre lleva al local de la óptica.
    const { armazon, lente } = partesColor(colorLegible(v.descripcion) || null)
    const nombre = modelo.modelo.toLowerCase().replace(/(^|\s)\S/g, (x) => x.toUpperCase())
    const colorTxt = [armazon, lente && `lente ${lente.toLowerCase()}`].filter(Boolean).join(' con ')
    // El label del acceso es razón social / código de Tango: no sirve para publicar.
    const local = 'nuestra óptica'
    const dest = cp.destacados
    const esSol = tipo === 'SOL'
    const historia = [
      'Nuevo en la óptica 🕶️',
      `${nombre} de Orbital${colorTxt ? ` · ${colorTxt}` : ''}`,
      dest.length ? `✔ ${dest.slice(0, 2).join('\n✔ ')}` : null,
      'Vení a probártelo 📍',
    ].filter(Boolean).join('\n')
    const posteo = [
      `${nombre}${colorTxt ? ` · ${colorTxt}` : ''} ✨`,
      cp.intro,
      dest.length ? `✔ ${dest.slice(0, 4).join('\n✔ ')}` : null,
      /infrarrojo/i.test(t) ? 'Triple Protección: UV400 + Blue Cut + filtro infrarrojo, en un mismo cristal.' : null,
      `📍 Lo tenés en ${local}. Vení a probártelo o escribinos por privado.`,
      ['#OrbitalEyewear', `#${modelo.modelo.replace(/[^A-Za-z0-9]/g, '')}`, esSol ? '#AnteojosDeSol' : '#AnteojosDeReceta'].join(' '),
    ].filter(Boolean).join('\n\n')
    const guion = [
      'Guion de 15 segundos (Reel / TikTok)',
      `0–3 s · Sacalo de la vitrina o de la caja: "Llegó lo nuevo de Orbital".`,
      `3–8 s · Que se lo pruebe alguien del equipo y mire a cámara. Texto en pantalla: "${nombre}${lente ? ` · ${lente}` : ''}".`,
      `8–12 s · Detalle de cerca${dest.length ? `: ${dest.slice(0, 2).join(' + ')}` : ''}.`,
      `12–15 s · Cierre en la puerta del local: "Lo tenés en ${local}, vení a probártelo". Sumá la ubicación en la historia.`,
    ].join('\n')
    return { intro: cp.intro, destacados: cp.destacados, datos, extra, historia, posteo, guion }
  }, [ficha, v, modelo.modelo, medidas])
  const [tabCopy, setTabCopy] = useState<'historia' | 'posteo' | 'guion'>('historia')
  const enCarrito = v ? cart[v.codigo]?.cantidad ?? 0 : 0

  return (
    <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white w-full sm:max-w-lg sm:rounded-2xl rounded-t-2xl max-h-[92vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-black/5 px-4 py-3 flex items-center justify-between z-10">
          <div>
            <h2 className="text-base font-bold">{modelo.modelo}</h2>
            <p className="text-[11px] text-neutral-400">{soloContenido ? 'Modo contenido · no suma al pedido' : `${vars.length} colores con stock`}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-full hover:bg-black/5"><X size={20} /></button>
        </div>

        {loading ? <p className="text-sm text-neutral-500 p-8 text-center">Cargando colores…</p> : !v ? (
          <p className="text-sm text-neutral-400 p-8 text-center">Sin stock disponible.</p>
        ) : (
          <div className="p-4">
            {/* Imagen grande */}
            <div className="aspect-square bg-white rounded-xl border border-black/5 relative overflow-hidden">
              {(v.imagen || modelo.imagenes?.[0]) ? <img src={v.imagen || modelo.imagenes[0]} alt={v.descripcion ?? ''} className="w-full h-full object-contain" /> : <Placeholder label="Sin foto aún" />}
              {vars.length > 1 && (
                <>
                  <button onClick={() => setI((i - 1 + vars.length) % vars.length)} className="absolute left-2 top-1/2 -translate-y-1/2 bg-white/90 rounded-full p-1.5 shadow"><ChevronLeft size={18} /></button>
                  <button onClick={() => setI((i + 1) % vars.length)} className="absolute right-2 top-1/2 -translate-y-1/2 bg-white/90 rounded-full p-1.5 shadow"><ChevronRight size={18} /></button>
                </>
              )}
              {v.tiene_preventa && <span className="absolute top-2 right-2 bg-red-500 text-white text-[10px] font-bold rounded-full px-2 py-0.5">PREVENTA</span>}
              {v.proyectado && <span className="absolute top-2 left-2 bg-[#b45309] text-white text-[10px] font-bold rounded-full px-2 py-0.5">📅 PROYECTADO</span>}
            </div>

            {/* Tira de colores */}
            {vars.length > 1 && (
              <div className="flex gap-2 overflow-x-auto py-3 -mx-1 px-1">
                {vars.map((vv, idx) => (
                  <button key={vv.codigo} onClick={() => setI(idx)}
                    className={`shrink-0 w-14 h-14 rounded-lg border-2 overflow-hidden relative ${idx === i ? 'border-[#0004FF]' : 'border-black/10'}`}
                    style={{ background: vv.imagen ? '#fff' : colorSwatch(vv.descripcion) }}>
                    {vv.imagen && <img src={vv.imagen} alt="" className="w-full h-full object-contain" />}
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
                  <span key={t} className="text-[10px] rounded-full px-2 py-0.5 bg-[#EEEEF0] text-neutral-600">{cap(t)}</span>
                ))}
              </div>
              {soloContenido ? null : sinPrecios ? (
                <div className="flex items-baseline gap-2 mt-3">
                  <span className="text-base font-bold text-emerald-600">{v.proyectado ? 'Proyectado' : 'Disponible'}</span>
                  <span className="text-[11px] text-neutral-400">{v.proyectado ? 'en producción' : 'stock en depósito'}</span>
                </div>
              ) : (
                <div className="flex items-baseline gap-2 mt-3">
                  <span className="text-2xl font-bold text-[#0004FF]">{kAr(v.precio)}</span>
                  {v.tiene_preventa && <span className="text-sm text-neutral-400 line-through">{kAr(v.precio_lista)}</span>}
                  <span className="text-[11px] text-neutral-400">+ IVA</span>
                </div>
              )}
            </div>

            {/* Medidas del modelo (ficha técnica) */}
            {medidas && (medidas.ancho || medidas.alto || medidas.largo || medidas.formato) && (
              <div className="mt-4 border border-black/10 rounded-xl p-3">
                <p className="text-[10px] font-bold tracking-[0.2em] uppercase text-neutral-500 mb-2">Medidas</p>
                <div className="grid grid-cols-3 gap-2 text-center">
                  {[['Ancho', medidas.ancho], ['Alto', medidas.alto], ['Varilla', medidas.largo]].map(([lbl, val]) => (
                    <div key={lbl as string} className="bg-[#F5F5F7] rounded-lg py-2">
                      <p className="text-sm font-bold">{val != null ? `${val} cm` : '—'}</p>
                      <p className="text-[10px] text-neutral-500 uppercase tracking-wide">{lbl}</p>
                    </div>
                  ))}
                </div>
                <div className="flex flex-wrap gap-1.5 mt-2.5">
                  {[medidas.formato && `Formato: ${cap(medidas.formato)}`, medidas.frente && `Frente: ${cap(medidas.frente)}`, medidas.patilla && `Varilla: ${cap(medidas.patilla)}`, medidas.para && cap(medidas.para)].filter(Boolean).map((t) => (
                    <span key={t as string} className="text-[10px] rounded-full px-2 py-0.5 bg-[#EEEEF0] text-neutral-600">{t}</span>
                  ))}
                </div>
              </div>
            )}

            {/* Sobre este anteojo (ficha de la tienda) */}
            {sobre && (
              <div className="mt-4 border border-black/10 rounded-xl p-3">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <p className="text-[10px] font-bold tracking-[0.2em] uppercase text-neutral-500">Sobre este anteojo</p>
                  <BotonCopiar texto={[`${modelo.modelo} · ${colorLegible(v.descripcion) ?? ''}`, ...sobre.datos.map((d) => `• ${d}`), ...sobre.extra].join('\n')} />
                </div>
                {sobre.intro && <p className="text-[12px] text-neutral-700 leading-relaxed font-sans">{sobre.intro}</p>}
                {sobre.destacados.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-2 font-sans">
                    {sobre.destacados.map((d) => <span key={d} className="text-[10px] rounded-full px-2 py-0.5 bg-[#0004FF]/[0.07] text-[#0004FF] font-semibold">✔ {d}</span>)}
                  </div>
                )}
                {sobre.datos.length > 0 && (
                  <ul className={`space-y-1 text-[11px] text-neutral-700 font-sans ${sobre.intro || sobre.destacados.length ? 'mt-2 pt-2 border-t border-black/5' : ''}`}>
                    {sobre.datos.map((d) => <li key={d} className="flex gap-2"><span className="text-neutral-300">•</span><span>{d}</span></li>)}
                  </ul>
                )}
                {sobre.extra.map((d) => (
                  <p key={d} className="mt-2 text-[11px] text-neutral-600 leading-relaxed font-sans rounded-lg bg-[#F5F5F7] px-2.5 py-2">{d}</p>
                ))}
              </div>
            )}

            {/* Copies para las redes de la óptica (no para vendedores del distribuidor) */}
            {sobre && !sinPrecios && (
              <div className="mt-4 border border-fuchsia-200 rounded-xl p-3 bg-gradient-to-br from-fuchsia-50/60 to-orange-50/60">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <p className="text-[10px] font-bold tracking-[0.2em] uppercase text-fuchsia-700">Para tus redes</p>
                  <div className="flex rounded-lg border border-black/10 overflow-hidden text-[10px] bg-white">
                    {(['historia', 'posteo', 'guion'] as const).map((t) => (
                      <button key={t} onClick={() => setTabCopy(t)} className={`px-2 py-1 font-semibold ${tabCopy === t ? 'bg-neutral-900 text-white' : 'text-neutral-600'}`}>
                        {t === 'historia' ? 'Historia' : t === 'posteo' ? 'Posteo' : 'Guion'}
                      </button>
                    ))}
                  </div>
                </div>
                <p className="text-[10px] text-neutral-500 mb-2 font-sans">Texto listo para publicar este anteojo en las redes de tu óptica. Copialo y sumale tu foto o la de acá.</p>
                <pre className="whitespace-pre-wrap font-sans text-[12px] leading-relaxed rounded-lg bg-white border border-black/5 p-3">{sobre[tabCopy]}</pre>
                <div className="flex justify-end gap-2 mt-2">
                  {(v.imagen || modelo.imagenes?.[0]) && (
                    <a href={v.imagen || modelo.imagenes[0]} target="_blank" rel="noreferrer" className="inline-flex items-center rounded-lg border border-black/10 bg-white px-2 py-1 text-[10px] font-bold">Abrir foto</a>
                  )}
                  <BotonCopiar texto={sobre[tabCopy]} label="Copiar texto" />
                </div>
                {esOptica && <PublicarLink clave={clave} modelo={modelo.modelo} color={colorLegible(v.descripcion) || null} />}
              </div>
            )}

            {/* Agregar (en modo contenido no hay carrito: no se cruza con el pedido) */}
            {!soloContenido && <div className="mt-4">
              {enCarrito === 0 ? (
                <button onClick={() => onAdd(v, modelo.modelo)} className="w-full bg-[#0004FF] text-white rounded-xl py-3 text-sm font-medium flex items-center justify-center gap-2">
                  <Plus size={16} /> Agregar al pedido
                </button>
              ) : (
                <div>
                  <div className="flex items-center justify-between bg-[#EEEEF0] rounded-xl p-1.5">
                    <button onClick={() => onSetQty(v.codigo, enCarrito - 1)} className="w-11 h-11 rounded-lg bg-white flex items-center justify-center"><Minus size={16} /></button>
                    <span className="text-base font-bold">{enCarrito} en el pedido</span>
                    <button onClick={() => onSetQty(v.codigo, enCarrito + 1)} disabled={enCarrito >= v.stock} className="w-11 h-11 rounded-lg bg-white flex items-center justify-center disabled:opacity-30"><Plus size={16} /></button>
                  </div>
                  {enCarrito >= v.stock && <p className="text-[11px] text-neutral-400 text-center mt-1.5">{v.proyectado ? 'Llegaste al máximo en proyectado' : 'Llegaste al stock disponible'}</p>}
                </div>
              )}
            </div>}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Carrito + checkout ──
function CarritoSheet({ cart, clave, acceso, bono, modoPack, onSetQty, onClose, onDone }: {
  cart: Record<string, CartItem>; clave: string; acceso: Acceso | null; bono?: BonoEstado | null; modoPack?: boolean
  onSetQty: (codigo: string, n: number) => void; onClose: () => void; onDone: () => void
}) {
  const items = Object.values(cart)
  const total = items.reduce((a, c) => a + c.cantidad * c.precio, 0)
  const unidades = items.reduce((a, c) => a + c.cantidad, 0)
  const oportUnidades = items.filter((i) => i.oportunidad).reduce((a, c) => a + c.cantidad, 0)
  const packCalc = modoPack ? calcularPack(unidades - oportUnidades, oportUnidades) : null
  const bonoPct = esBonoPct(bono)
  const sinCargoUnidades = packCalc && bonoPct ? packCalc.eligio : 0
  const sinCargoImp = sinCargoUnidades > 0 ? importeSinCargo(items, sinCargoUnidades) : 0
  const bonoCalc = calcularBono(total, bono ?? null, unidades, sinCargoImp)
  const digital = bonoPct && bonoCalc && !bonoCalc.vencido ? { bono: bono!, calc: bonoCalc } : null
  const [contado, setContado] = useState<boolean | null>(null)
  const [enviado, setEnviado] = useState<{ neto: number; bono: number; contado: boolean; totalContado: number } | null>(null)
  // si el link ya trae la óptica, queda pre-cargada y bloqueada
  const identFijo = acceso?.cod_cliente || ''
  const esRev = acceso?.tipo === 'revendedor'
  const sinPrecios = useSinPrecios()
  const [fase, setFase] = useState<'carrito' | 'datos' | 'ok'>('carrito')
  const [ident, setIdent] = useState(identFijo)
  const [razon, setRazon] = useState('')
  const [pedirRazon, setPedirRazon] = useState(false)
  const [contacto, setContacto] = useState('')
  const [wsp, setWsp] = useState('')
  const [mail, setMail] = useState('')
  const [obs, setObs] = useState('')
  const [paraQuien, setParaQuien] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [result, setResult] = useState<{ cliente: string; identificado: boolean } | null>(null)

  async function enviar() {
    setEnviando(true); setErr(null)
    const payload = items.map((c) => ({ codigo: c.codigo, modelo: c.modelo, descripcion: c.descripcion, cantidad: c.cantidad, precio: c.precio }))
    // Revendedor: marcamos el pedido y sumamos "para quién" (informativo) a las observaciones,
    // así Adrián sabe aplicar 15% bonif. + 30/60/90 + retira al aprobar.
    const obsFinal = esRev
      ? ['🔁 REVENDEDOR — aplicar 15% bonif. · 30/60/90 · retira',
         paraQuien.trim() ? 'Para: ' + paraQuien.trim() : '', obs.trim()].filter(Boolean).join(' · ')
      : packCalc
        // Pack de bienvenida: el vendedor ve en el pedido qué corresponde sin cargo.
        ? [packObs(packCalc), obs.trim()].filter(Boolean).join(' · ')
        : obs.trim()
    // Compra digital con bono en %: condiciones estructuradas (el servidor revalida el bono).
    const condiciones = digital ? {
      sin_cargo_unidades: sinCargoUnidades, sin_cargo_importe: sinCargoImp, contado: contado === true,
      plazo: unidades > 24 ? '30/60/90/120' : '30/60/90', unidades,
    } : null
    const obsDigital = digital
      ? [`💻 COMPRA DIGITAL (${digital.bono.campana ?? 'bono'}) — bono ${kAr(digital.calc.bonificacion)}` +
         (sinCargoUnidades ? ` · ${sinCargoUnidades} sin cargo (${kAr(sinCargoImp)})` : '') +
         ` · neto ${kAr(digital.calc.neto)} + IVA · plazo ${condiciones!.plazo}` +
         (contado ? ` · PAGA CONTADO/TRANSFERENCIA ${digital.bono.contado_pct ?? 0}% extra → ${kAr(digital.calc.pagaEfectivo)} + IVA` : ''),
         obsFinal].filter(Boolean).join(' · ')
      : obsFinal
    const { data, error } = await supabase.rpc('catalogo_checkout', {
      p_clave: clave, p_identificador: ident.trim(), p_contacto: contacto.trim(),
      p_wsp: wsp.trim(), p_mail: mail.trim(), p_items: payload, p_obs: obsDigital, p_razon: razon.trim() || null,
      p_acceso: acceso?.codigo || clave,
      ...(condiciones ? { p_condiciones: condiciones } : {}),
    })
    setEnviando(false)
    if (error) { setErr('No se pudo enviar. Revisá la conexión.'); return }
    const r = data as { ok: boolean; need?: string; error?: string; precarga_id?: number; cliente?: string; identificado?: boolean }
    if (!r.ok) {
      if (r.need === 'razon') { setPedirRazon(true); setFase('datos'); setErr('No encontramos tu óptica. Ingresá la razón social para registrar el pedido.') }
      else setErr(r.error || 'No se pudo enviar.')
      return
    }
    setResult({ cliente: r.cliente!, identificado: !!r.identificado })
    if (digital) setEnviado({ neto: digital.calc.neto, bono: digital.calc.bonificacion, contado: contado === true, totalContado: digital.calc.pagaEfectivo })
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
            <p className="text-sm font-semibold">¡Recibimos tu pedido!</p>
            <p className="text-sm text-neutral-500 mt-1">{result.cliente}</p>
            {enviado && bono ? (
              <div className="text-left rounded-xl border border-[#0004FF]/20 bg-[#0004FF]/[0.04] p-3 mt-4 space-y-1 text-sm">
                <div className="flex justify-between"><span className="text-neutral-600">Bono compra por catálogo</span><span className="font-semibold text-[#0004FF]">− {kAr(enviado.bono)}</span></div>
                <div className="flex justify-between"><span className="text-neutral-600">Total</span><span className="font-bold">{kAr(enviado.neto)} + IVA</span></div>
                {enviado.contado && <div className="flex justify-between"><span className="text-neutral-600">Pagando contado</span><span className="font-bold text-emerald-700">{kAr(enviado.totalContado)} + IVA</span></div>}
                <p className="text-[12px] text-neutral-600 pt-2">
                  Te mandamos el detalle por WhatsApp. Tu vendedor es <b>{bono.contacto_nombre}</b>
                  {bono.contacto_wsp && <> · <a className="text-[#0004FF] underline" href={`https://wa.me/${bono.contacto_wsp.replace(/\D/g, '')}`} target="_blank" rel="noreferrer">escribile por WhatsApp</a></>}.
                </p>
              </div>
            ) : (
              <p className="text-xs text-neutral-400 mt-3">
                {result.identificado ? 'Tu vendedor asignado lo va a revisar y confirmar a la brevedad.' : 'Un asesor comercial se va a contactar para confirmar los datos.'}
              </p>
            )}
            <button onClick={onClose} className="mt-5 bg-[#0004FF] text-white rounded-xl py-2.5 px-6 text-sm font-medium">Seguir viendo</button>
          </div>
        ) : items.length === 0 ? (
          <p className="text-sm text-neutral-400 p-10 text-center">Tu pedido está vacío.</p>
        ) : fase === 'carrito' ? (
          <>
            <div className="p-3 space-y-2">
              {items.map((c) => (
                <div key={c.codigo} className="flex items-center gap-3 bg-[#F5F5F7] rounded-xl p-2">
                  <div className="w-14 h-14 rounded-lg bg-white border border-black/5 overflow-hidden shrink-0">
                    {c.imagen ? <img src={c.imagen} alt="" className="w-full h-full object-contain" /> : <Placeholder />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{c.modelo}</p>
                    <p className="text-[11px] text-neutral-500 truncate">{colorLegible(c.descripcion)}</p>
                    <div className="flex items-center gap-1.5">
                      {!sinPrecios && <p className="text-sm font-bold text-[#0004FF]">{kAr(c.precio)}</p>}
                      {packCalc && (
                        <span className={`text-[9px] font-bold uppercase tracking-wide rounded-full px-1.5 py-0.5 ${c.oportunidad ? 'bg-emerald-100 text-emerald-700' : 'bg-[#0004FF]/10 text-[#0004FF]'}`}>
                          {c.oportunidad ? 'Oportunidad' : 'Línea'}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button onClick={() => onSetQty(c.codigo, c.cantidad - 1)} className="w-8 h-8 rounded-lg bg-white border border-black/10 flex items-center justify-center"><Minus size={14} /></button>
                    <span className="w-6 text-center text-sm font-bold">{c.cantidad}</span>
                    <button onClick={() => onSetQty(c.codigo, c.cantidad + 1)} disabled={!!c.stock && c.cantidad >= c.stock} className="w-8 h-8 rounded-lg bg-white border border-black/10 flex items-center justify-center disabled:opacity-30"><Plus size={14} /></button>
                    <button onClick={() => onSetQty(c.codigo, 0)} className="w-8 h-8 rounded-lg text-red-500 flex items-center justify-center"><Trash2 size={14} /></button>
                  </div>
                </div>
              ))}
            </div>
            <div className="sticky bottom-0 bg-white border-t border-black/10 p-4">
              {sinPrecios
                ? <div className="flex justify-between text-sm mb-3"><span className="text-neutral-500">Total del pedido</span><span className="font-bold text-lg">{unidades} unidades</span></div>
                : <div className="flex justify-between text-sm mb-3"><span className="text-neutral-500">{unidades} unidades · subtotal</span><span className="font-bold text-lg">{kAr(total)} <span className="text-[11px] font-normal text-neutral-400">+ IVA</span></span></div>}
              {packCalc && <PackResumen calc={packCalc} />}
              {digital && (
                <ResumenCompraDigital bono={digital.bono} calc={digital.calc} subtotal={total} unidades={unidades}
                  sinCargoUnidades={sinCargoUnidades} sinCargoImporte={sinCargoImp} contado={contado} onContado={setContado} />
              )}
              {!packCalc && !bonoPct && bonoCalc && !bonoCalc.vencido && <BonoResumen calc={bonoCalc} financieroPct={bono?.financiero_pct ?? 0} />}
              {/* Óptica identificada por el link: se envía de un toque, sin formulario */}
              {identFijo ? (
                <>
                  <p className="text-[11px] text-neutral-500 mb-2">Pedido para <b className="text-neutral-800">{sinPrecios ? empresaDe(acceso?.label) || identFijo : acceso?.label || identFijo}</b></p>
                  {err && <p className="text-sm text-red-600 mb-2">{err}</p>}
                  <button onClick={enviar} disabled={enviando} className="w-full bg-[#0004FF] text-white rounded-xl py-3.5 text-sm font-bold disabled:opacity-50">
                    {enviando ? 'Enviando…' : `Enviar pedido (${unidades} u.)`}
                  </button>
                  <button onClick={() => setFase('datos')} className="w-full text-[12px] text-neutral-500 underline mt-2">Agregar una observación</button>
                </>
              ) : (
                <button onClick={() => setFase('datos')} className="w-full bg-[#0004FF] text-white rounded-xl py-3 text-sm font-medium">Continuar</button>
              )}
            </div>
          </>
        ) : (
          <div className="p-4 space-y-3">
            {identFijo ? (
              <div className="rounded-lg bg-[#0004FF]/5 border border-[#0004FF]/20 px-3 py-2.5">
                <p className="text-[11px] font-medium text-[#0004FF]">{esRev ? 'Tu cuenta revendedor' : sinPrecios ? 'Pedido a nombre de' : 'Pedido para tu óptica'}</p>
                <p className="text-sm font-semibold">{sinPrecios ? empresaDe(acceso?.label) || identFijo : acceso?.label || identFijo}</p>
              </div>
            ) : (
              <div>
                <label className="text-[11px] font-medium text-neutral-500">Código de cliente, CUIT o email *</label>
                <input value={ident} onChange={(e) => setIdent(e.target.value)} placeholder="Ej: 030554 · 30-12345678-9 · optica@mail.com"
                  className="w-full mt-1 rounded-lg border border-black/10 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0004FF]/30" />
              </div>
            )}
            {pedirRazon && (
              <div>
                <label className="text-[11px] font-medium text-neutral-500">Razón social / nombre de la óptica *</label>
                <input value={razon} onChange={(e) => setRazon(e.target.value)} placeholder="Nombre de tu óptica"
                  className="w-full mt-1 rounded-lg border border-black/10 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0004FF]/30" />
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[11px] font-medium text-neutral-500">WhatsApp</label>
                <input value={wsp} onChange={(e) => setWsp(e.target.value)} className="w-full mt-1 rounded-lg border border-black/10 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0004FF]/30" />
              </div>
              <div>
                <label className="text-[11px] font-medium text-neutral-500">Email</label>
                <input value={mail} onChange={(e) => setMail(e.target.value)} className="w-full mt-1 rounded-lg border border-black/10 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0004FF]/30" />
              </div>
            </div>
            <div>
              <label className="text-[11px] font-medium text-neutral-500">Contacto / nombre</label>
              <input value={contacto} onChange={(e) => setContacto(e.target.value)} className="w-full mt-1 rounded-lg border border-black/10 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0004FF]/30" />
            </div>
            {esRev && (
              <div>
                <label className="text-[11px] font-medium text-neutral-500">¿Para qué cliente es? <span className="text-neutral-400">(opcional · informativo)</span></label>
                <input value={paraQuien} onChange={(e) => setParaQuien(e.target.value)} placeholder="Óptica / cliente al que se lo vas a revender"
                  className="w-full mt-1 rounded-lg border border-black/10 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0004FF]/30" />
              </div>
            )}
            <div>
              <label className="text-[11px] font-medium text-neutral-500">Observaciones</label>
              <textarea value={obs} onChange={(e) => setObs(e.target.value)} rows={2} className="w-full mt-1 rounded-lg border border-black/10 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0004FF]/30" />
            </div>
            {err && <p className="text-sm text-red-600">{err}</p>}
            {digital ? (
              <div className="rounded-lg bg-[#0004FF]/5 border border-[#0004FF]/15 px-3 py-2 text-sm space-y-0.5">
                <div className="flex justify-between"><span className="text-neutral-500">{unidades} unidades · subtotal</span><span>{kAr(total)}</span></div>
                {sinCargoUnidades > 0 && <div className="flex justify-between"><span className="text-neutral-500">Sin cargo ({sinCargoUnidades})</span><span className="text-emerald-700">− {kAr(sinCargoImp)}</span></div>}
                <div className="flex justify-between"><span className="text-neutral-500">Bono {digital.bono.pct}%</span><span className="text-[#0004FF]">− {kAr(digital.calc.bonificacion)}</span></div>
                <div className="flex justify-between font-bold"><span>Total</span><span>{kAr(digital.calc.neto)} + IVA</span></div>
                {contado && <div className="flex justify-between font-bold text-emerald-700"><span>Pagando contado</span><span>{kAr(digital.calc.pagaEfectivo)} + IVA</span></div>}
              </div>
            ) : (
              <div className="flex justify-between text-sm pt-1"><span className="text-neutral-500">{sinPrecios ? 'Total del pedido' : `${unidades} unidades`}</span><span className="font-bold text-lg">{sinPrecios ? `${unidades} unidades` : kAr(total)}</span></div>
            )}
            <div className="flex gap-2">
              <button onClick={() => setFase('carrito')} className="rounded-xl border border-black/10 py-3 px-5 text-sm font-medium">Volver</button>
              <button onClick={enviar} disabled={enviando || !ident.trim() || (pedirRazon && !razon.trim())} className="flex-1 bg-[#0004FF] text-white rounded-xl py-3 text-sm font-medium disabled:opacity-50">
                {enviando ? 'Enviando…' : 'Enviar pedido'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
