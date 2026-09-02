import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { Search, X, ChevronLeft, ChevronRight, ShoppingCart, Plus, Minus, Trash2, Check, Star, Info } from 'lucide-react'
import { colorLegible, colorSwatch } from './colorLegible'
import { calcularBono, type BonoEstado } from './bono'
import { BonoBanner, BonoBarra, BonoCelebra, BonoResumen } from './BonoUI'

// ── Catálogo B2B público (acceso con clave, independiente del login de la app) ──
// La óptica navega modelos → colores con stock (sin ver cantidades) → arma el pedido.
// Datos en vivo de `stock`; el checkout crea un pedido web en el flujo normal.

interface Modelo {
  modelo: string; precio_desde: number | null; caliente: boolean; n_colores: number
  imagenes: string[]
}
interface Variante {
  codigo: string; descripcion: string | null; tipo: string | null; tratamiento: string | null
  clasificacion: string | null; precio: number; precio_lista: number; tiene_preventa: boolean
  caliente: boolean; imagen: string | null; stock: number; proyectado?: boolean
}
interface CartItem { codigo: string; modelo: string; descripcion: string | null; precio: number; cantidad: number; imagen: string | null; stock?: number }
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
const DEVICE_KEY = 'orbital_catalogo_device'
// Id estable por navegador para contar entradas y detectar si el link se comparte.
function deviceId(): string {
  try {
    let d = localStorage.getItem(DEVICE_KEY)
    if (!d) { d = (crypto.randomUUID?.() || Math.random().toString(36).slice(2) + Date.now().toString(36)); localStorage.setItem(DEVICE_KEY, d) }
    return d
  } catch { return '' }
}
interface Acceso { tipo: string; codigo?: string; cod_cliente?: string | null; label?: string | null; vendedor?: string | null }
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
function BloqueoGate({ label, vendedorTel, codigo }: {
  label: string | null; vendedorTel?: string | null; codigo?: string | null
}) {
  const optica = (label?.split(' - ')[1] || label || 'tu óptica').trim()
  const [tel, setTel] = useState(vendedorTel || null)
  const [agotado, setAgotado] = useState(false)
  const [yendo, setYendo] = useState(false)
  // El pedido de acceso va al vendedor del token; si no tiene teléfono cargado, cae en IRIS.
  const wa = (tel || '').replace(/\D/g, '') || '5491178548316'
  const msg = `Hola! Soy ${optica}. Quiero abrir mi catálogo Orbital desde este dispositivo, ¿me lo habilitás?`
  const waLink = `https://wa.me/${wa}?text=${encodeURIComponent(msg)}`

  // Primera vez que un cliente choca con el candado, se habilita solo y entra.
  // A partir de la segunda ya necesita que lo habilite el vendedor.
  async function entrarIgual() {
    if (!codigo) return
    setYendo(true)
    const { data } = await supabase.rpc('catalogo_autoacceso', { p: codigo, p_device: deviceId() })
    const r = data as { ok: boolean; motivo?: string; vendedor_tel?: string | null }
    if (r?.ok) { window.location.reload(); return }
    if (r?.vendedor_tel) setTel(r.vendedor_tel)
    setAgotado(true); setYendo(false)
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-white px-4 font-mono">
      <div className="w-full max-w-sm bg-white border border-black/10 rounded-2xl shadow-sm p-8 text-center">
        <Logo />
        <div className="h-px bg-gradient-to-r from-[#0004FF]/60 to-transparent my-4" />
        <div className="text-4xl mb-3">🔒</div>
        <p className="text-sm font-bold text-[#0a0a0a] mb-1">Catálogo exclusivo de {optica}</p>
        {agotado ? (
          <>
            <p className="text-sm text-neutral-600 mb-5">
              Este link ya se abrió en varios dispositivos. Para sumar uno más te lo tiene que habilitar tu vendedor.
            </p>
            <a href={waLink} target="_blank" rel="noreferrer"
              className="block w-full rounded-lg bg-[#0004FF] text-white py-2.5 text-sm font-medium">
              Pedir acceso a mi vendedor
            </a>
            <p className="text-[11px] text-neutral-400 mt-3">Ya le avisamos. En cuanto te habilite, recargá esta página.</p>
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
            <a href={waLink} target="_blank" rel="noreferrer"
              className="block w-full rounded-lg border border-black/10 text-neutral-600 py-2.5 text-sm font-medium mt-2">
              Prefiero avisarle a mi vendedor
            </a>
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
        <p className="text-base font-bold mt-1 text-[#0004FF]">{kAr(m.precio_desde)}</p>
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

export default function CatalogoPublico() {
  // token del link (?k=) tiene prioridad sobre la clave guardada
  const [clave, setClave] = useState<string | null>(() => {
    try { const k = new URLSearchParams(window.location.search).get('k'); if (k) return k.trim() } catch { /* noop */ }
    return localStorage.getItem(CLAVE_KEY)
  })
  const [claveOk, setClaveOk] = useState(false)
  const [bloqueo, setBloqueo] = useState<{ label: string | null; vendedor_tel?: string | null } | null>(null)
  const [acceso, setAcceso] = useState<Acceso | null>(() => {
    try { return JSON.parse(localStorage.getItem(ACCESO_KEY) || 'null') } catch { return null }
  })
  const [todos, setTodos] = useState<HomeModelo[]>([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [grupoActivo, setGrupoActivo] = useState<string | null>(null)
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
    supabase.rpc('catalogo_entrar', { p: clave, p_device: deviceId() }).then(({ data }) => {
      const r = data as any
      if (r?.ok) {
        setClaveOk(true); setBloqueo(null)
        localStorage.setItem(CLAVE_KEY, clave)
        const acc: Acceso = { tipo: r.tipo, codigo: r.codigo, cod_cliente: r.cod_cliente, label: r.label, vendedor: r.vendedor }
        setAcceso(acc); localStorage.setItem(ACCESO_KEY, JSON.stringify(acc))
      } else if (r?.motivo === 'otro_dispositivo') {
        // El link ya está en uso en otro equipo: no lo borramos, mostramos la pantalla de pedir acceso.
        setBloqueo({ label: r.label ?? null, vendedor_tel: r.vendedor_tel ?? null })
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
    // los de precio 32.645 van al final de cada categoría
    const pa = a.m.precio_desde === 32645 ? 1 : 0, pb = b.m.precio_desde === 32645 ? 1 : 0
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

  // ¿este token trae bono? Se consulta una vez, al validar el acceso.
  useEffect(() => {
    if (!claveOk) { setBono(null); return }
    const cod = acceso?.codigo || clave
    if (!cod) return
    supabase.rpc('catalogo_bono_estado', { p_acceso: cod }).then(({ data }) => {
      setBono((data as BonoEstado) ?? null)
    })
  }, [claveOk, acceso?.codigo, clave])

  const bonoCalc = useMemo(() => calcularBono(cartTotal, bono, cartCount), [cartTotal, bono, cartCount])

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
      return { ...c, [v.codigo]: { codigo: v.codigo, modelo, descripcion: v.descripcion, precio: v.precio, imagen: v.imagen, stock: v.stock, cantidad } }
    })
  }
  function setQty(codigo: string, cantidad: number) {
    setCart((c) => {
      if (cantidad <= 0) { const { [codigo]: _x, ...rest } = c; return rest }
      const max = c[codigo]?.stock
      return { ...c, [codigo]: { ...c[codigo], cantidad: max ? Math.min(cantidad, max) : cantidad } }
    })
  }

  function verGrupo(k: string) { setGrupoActivo(k); setQ(''); window.scrollTo({ top: 0 }) }
  function irInicio() { setGrupoActivo(null); setQ('') }

  if (loading) return <div className="min-h-screen flex items-center justify-center text-sm text-neutral-500 bg-white font-mono">Cargando catálogo…</div>
  if (bloqueo) return <BloqueoGate label={bloqueo.label} vendedorTel={bloqueo.vendedor_tel} codigo={clave} />
  if (!clave || !claveOk) return <ClaveGate onOk={(c) => { setClave(c); setClaveOk(true) }} />

  const navPill = (active: boolean, accent: Grupo['accent']) =>
    `text-[11px] rounded-full px-3 py-1.5 font-semibold whitespace-nowrap tracking-wide uppercase transition border ${active ? ACCENT[accent] + ' border-transparent' : 'bg-white border-black/10 text-neutral-600 hover:border-[#0004FF]/40'}`

  return (
    <div className="min-h-screen bg-white text-[#0a0a0a] font-mono">
      {/* Banner chico estilo tienda */}
      <div className="bg-[#0a0a0a] text-white text-[10px] tracking-[0.25em] uppercase text-center py-1.5 px-3">
        Orbital® · Catálogo mayorista — pedido online sobre stock real
      </div>
      {/* Marca de agua: catálogo personalizado del cliente (link con token) */}
      {acceso?.tipo === 'optica' && acceso.label && (
        <div className="bg-[#0004FF]/[0.06] border-b border-[#0004FF]/15 text-[#0004FF] text-[11px] text-center py-1.5 px-3 font-semibold">
          🔒 Catálogo con precios exclusivos de {(acceso.label.split(' - ')[1] || acceso.label).trim()} · uso personal
        </div>
      )}
      {/* Bono de campaña: solo si el token lo trae */}
      {bono && <BonoBanner bono={bono} />}
      {/* Header */}
      <header className="bg-white border-b border-black/10 sticky top-0 z-20">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <button onClick={irInicio} className="shrink-0"><Logo /></button>
          <button onClick={() => setCarritoOpen(true)} className="relative flex items-center gap-1.5 text-sm bg-[#0004FF] text-white rounded-full px-4 py-2 font-medium">
            <ShoppingCart size={16} /> <span className="hidden sm:inline">Pedido</span>
            {cartCount > 0 && <span className="absolute -top-1.5 -right-1.5 bg-red-500 text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">{cartCount}</span>}
          </button>
        </div>
        {/* Buscador */}
        <div className="max-w-6xl mx-auto px-4 pb-2">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
            <input value={q} onChange={(e) => { setQ(e.target.value); setGrupoActivo(null) }} placeholder="Buscar modelo…"
              className="w-full rounded-full bg-[#F5F5F7] border border-black/10 pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0004FF]/30" />
          </div>
        </div>
        {/* Propuestas: acceso directo a cada grupo */}
        <div className="max-w-6xl mx-auto px-4 pb-3">
          <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
            <button onClick={irInicio} className={navPill(!buscando && !grupoActivo, 'dark')}>Inicio</button>
            {GRUPOS.map((g) => (
              <button key={g.key} onClick={() => verGrupo(g.key)} className={navPill(grupoActivo === g.key, g.accent)}>{g.nombre}</button>
            ))}
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-3 py-4">
        {buscando ? (
          <>
            <p className="text-[11px] text-neutral-400 mb-3">{resultados.length} resultado{resultados.length !== 1 ? 's' : ''} para “{q.trim()}”</p>
            {resultados.length ? (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
                {resultados.map((m) => <ModelCard key={m.modelo} m={m} onOpen={() => setSel(m)} onQuick={() => setQuick(m)} />)}
              </div>
            ) : <p className="text-sm text-neutral-400 text-center py-16">No hay modelos con ese nombre.</p>}
          </>
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
      {sel && <ModeloSheet modelo={sel} clave={clave} cart={cart} onAdd={addCart} onSetQty={setQty} onClose={() => setSel(null)} />}
      {carritoOpen && <CarritoSheet cart={cart} clave={clave} acceso={acceso} bono={bono} onSetQty={setQty} onClose={() => setCarritoOpen(false)} onDone={() => setCart({})} />}

      {/* Bono: cartel de escalón desbloqueado + barra de progreso fija */}
      {celebra && <BonoCelebra texto={celebra} onClose={() => setCelebra(null)} />}
      {bonoCalc && !bonoCalc.vencido && !carritoOpen && !sel && !quick && (
        <BonoBarra calc={bonoCalc} onVerPares={() => verGrupo('oportunidades')} />
      )}

      {/* Barra flotante de pedido en mobile */}
      {cartCount > 0 && !carritoOpen && !sel && (
        <button onClick={() => setCarritoOpen(true)} className={`md:hidden fixed ${bonoCalc && !bonoCalc.vencido ? 'bottom-28' : 'bottom-4'} inset-x-4 bg-[#0004FF] text-white rounded-xl py-3 px-4 flex items-center justify-between shadow-lg z-20`}>
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
                      <div className="flex items-center gap-1 flex-wrap"><p className="text-[12px] font-bold text-[#0004FF] mt-0.5">{kAr(v.precio)}</p>{v.proyectado && <span className="text-[8px] font-semibold text-[#b45309] bg-[#fdf0dd] rounded px-1 py-0.5">proyectado</span>}</div>
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

// ── Ficha del modelo con carrusel de colores ──
function ModeloSheet({ modelo, clave, cart, onAdd, onSetQty, onClose }: {
  modelo: Modelo; clave: string; cart: Record<string, CartItem>
  onAdd: (v: Variante, modelo: string) => void; onSetQty: (codigo: string, n: number) => void; onClose: () => void
}) {
  const [vars, setVars] = useState<Variante[]>([])
  const [i, setI] = useState(0)
  const [loading, setLoading] = useState(true)
  const [medidas, setMedidas] = useState<Medidas | null>(null)
  useEffect(() => {
    supabase.rpc('catalogo_modelo_v2', { p_clave: clave, p_modelo: modelo.modelo, p_tipo: null, p_clasif: null, p_trat: null }).then(({ data, error }) => {
      setVars(error ? [] : ((data as Variante[]) ?? [])); setLoading(false)
    })
    supabase.rpc('catalogo_medidas', { p_clave: clave, p_modelo: modelo.modelo }).then(({ data }) => setMedidas((data as Medidas) ?? null))
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
              <div className="flex items-baseline gap-2 mt-3">
                <span className="text-2xl font-bold text-[#0004FF]">{kAr(v.precio)}</span>
                {v.tiene_preventa && <span className="text-sm text-neutral-400 line-through">{kAr(v.precio_lista)}</span>}
                <span className="text-[11px] text-neutral-400">+ IVA</span>
              </div>
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

            {/* Agregar */}
            <div className="mt-4">
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
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Carrito + checkout ──
function CarritoSheet({ cart, clave, acceso, bono, onSetQty, onClose, onDone }: {
  cart: Record<string, CartItem>; clave: string; acceso: Acceso | null; bono?: BonoEstado | null
  onSetQty: (codigo: string, n: number) => void; onClose: () => void; onDone: () => void
}) {
  const items = Object.values(cart)
  const total = items.reduce((a, c) => a + c.cantidad * c.precio, 0)
  const unidades = items.reduce((a, c) => a + c.cantidad, 0)
  const bonoCalc = calcularBono(total, bono ?? null, unidades)
  // si el link ya trae la óptica, queda pre-cargada y bloqueada
  const identFijo = acceso?.cod_cliente || ''
  const esRev = acceso?.tipo === 'revendedor'
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
      : obs.trim()
    const { data, error } = await supabase.rpc('catalogo_checkout', {
      p_clave: clave, p_identificador: ident.trim(), p_contacto: contacto.trim(),
      p_wsp: wsp.trim(), p_mail: mail.trim(), p_items: payload, p_obs: obsFinal, p_razon: razon.trim() || null,
      p_acceso: acceso?.codigo || clave,
    })
    setEnviando(false)
    if (error) { setErr('No se pudo enviar. Revisá la conexión.'); return }
    const r = data as { ok: boolean; need?: string; error?: string; precarga_id?: number; cliente?: string; identificado?: boolean }
    if (!r.ok) {
      if (r.need === 'razon') { setPedirRazon(true); setErr('No encontramos tu óptica. Ingresá la razón social para registrar el pedido.') }
      else setErr(r.error || 'No se pudo enviar.')
      return
    }
    setResult({ cliente: r.cliente!, identificado: !!r.identificado })
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
            <p className="text-xs text-neutral-400 mt-3">
              {result.identificado ? 'Tu vendedor asignado lo va a revisar y confirmar a la brevedad.' : 'Un asesor comercial se va a contactar para confirmar los datos.'}
            </p>
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
                    <p className="text-sm font-bold text-[#0004FF]">{kAr(c.precio)}</p>
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
              <div className="flex justify-between text-sm mb-3"><span className="text-neutral-500">{unidades} unidades · subtotal</span><span className="font-bold text-lg">{kAr(total)} <span className="text-[11px] font-normal text-neutral-400">+ IVA</span></span></div>
              {bonoCalc && !bonoCalc.vencido && <BonoResumen calc={bonoCalc} financieroPct={bono?.financiero_pct ?? 0} />}
              <button onClick={() => setFase('datos')} className="w-full bg-[#0004FF] text-white rounded-xl py-3 text-sm font-medium">Continuar</button>
            </div>
          </>
        ) : (
          <div className="p-4 space-y-3">
            {identFijo ? (
              <div className="rounded-lg bg-[#0004FF]/5 border border-[#0004FF]/20 px-3 py-2.5">
                <p className="text-[11px] font-medium text-[#0004FF]">{esRev ? 'Tu cuenta revendedor' : 'Pedido para tu óptica'}</p>
                <p className="text-sm font-semibold">{acceso?.label || identFijo}</p>
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
            <div className="flex justify-between text-sm pt-1"><span className="text-neutral-500">{unidades} unidades</span><span className="font-bold text-lg">{kAr(total)}</span></div>
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
