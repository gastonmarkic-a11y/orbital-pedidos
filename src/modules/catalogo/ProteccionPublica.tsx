import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'

interface Destacado { modelo: string; foto: string }

// Landing público de Triple Protección — link comercial de Orbital (/proteccion y /tripleproteccion).
// Rediseño: hero + tecnología + DESTACADOS + 2 CTAs (catálogo con descuentos / coordinar visita → Iris).

const WA = '5491178548316' // WhatsApp de Orbital (IRIS)
const waLink = (msg: string) => `https://wa.me/${WA}?text=${encodeURIComponent(msg)}`
const AZUL = '#1e50ff'
const HERO = 'https://orbitaleyewear.com.ar/cdn/shop/files/Orbital_025.png?width=900'
// El catálogo vive en el subdominio ver.* (en proteccion.* el hostname fuerza esta landing)
const CATALOGO_URL = 'https://ver.orbitaleyewear.com.ar/catalogo'

interface Prot { id: string; nombre: string; emoji: string; color: string; tag: string; titulo: string; texto: string }
const PROTECCIONES: Prot[] = [
  { id: 'infrarrojo', nombre: 'Infrarrojo', emoji: '🔥', color: '#e0562e', tag: 'El diferencial', titulo: 'Filtro Infrarrojo',
    texto: 'Casi ningún anteojo del mercado lo tiene. Bloquea la radiación infrarroja —la que genera el calor y la fatiga visual bajo sol fuerte—. Menos cansancio y más confort en las jornadas largas. Este filtro marca la diferencia real.' },
  { id: 'uv400', nombre: 'UV400', emoji: '☀️', color: '#c9971f', tag: 'Protección total', titulo: 'Protección UV400',
    texto: 'Bloquea el 100% de los rayos UVA y UVB. La protección que de verdad importa: cuida los ojos del daño solar acumulativo, ese que no se ve pero se paga con los años.' },
  { id: 'bluecut', nombre: 'Blue Cut', emoji: '💠', color: AZUL, tag: 'Día a día', titulo: 'Filtro Blue Cut',
    texto: 'Filtra la luz azul de pantallas y LEDs. Ideal para el uso cotidiano, entre el sol de la calle y las horas frente al celular y la compu. Un plus de confort que el cliente agradece.' },
]

export default function ProteccionPublica() {
  const [sel, setSel] = useState('infrarrojo')
  const [destacados, setDestacados] = useState<Destacado[]>([])
  useEffect(() => {
    supabase.rpc('proteccion_destacados').then(({ data }) => setDestacados((data as Destacado[]) ?? []))
  }, [])
  const p = PROTECCIONES.find((x) => x.id === sel) ?? PROTECCIONES[0]

  return (
    <div className="min-h-screen bg-white text-[#0f0f10]" style={{ fontFamily: 'ui-sans-serif, system-ui, sans-serif' }}>
      {/* Barra de marca */}
      <div className="border-b border-black/10">
        <div className="max-w-4xl mx-auto px-5 h-16 flex items-center justify-between">
          <img src="/logo-orbital-tm.png" alt="Orbital Eyewear" className="h-8 w-auto" />
          <span className="text-[10px] tracking-[0.25em] text-black/45 uppercase">Hecho en Argentina</span>
        </div>
      </div>

      {/* Hero */}
      <div className="max-w-4xl mx-auto px-5 pt-8 grid md:grid-cols-2 gap-6 md:gap-10 md:items-center">
        <div className="order-2 md:order-1">
          <span className="inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-[11px] font-mono font-semibold tracking-wider" style={{ borderColor: AZUL, color: AZUL, background: `${AZUL}0a` }}>
            <span className="inline-block w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: AZUL }} />
            IR · UV400 · BLUE&nbsp;CUT
          </span>
          <p className="text-[11px] font-semibold tracking-[0.3em] uppercase mt-4 mb-3" style={{ color: AZUL }}>La tecnología</p>
          <h1 className="text-4xl sm:text-5xl font-black leading-[0.95] tracking-tight" style={{ textWrap: 'balance' } as React.CSSProperties}>
            Tres protecciones.<br />Un cristal.
          </h1>
          <p className="text-black/55 mt-4 text-sm sm:text-base">
            La única línea de Argentina con las tres protecciones en un mismo cristal. La diferencia real está en lo que el cliente no ve a simple vista.
          </p>
        </div>
        <div className="order-1 md:order-2">
          <img src={HERO} alt="Orbital Eyewear" className="w-full h-auto rounded-2xl border border-black/10" />
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-5">
        {/* Tecnología — tabs */}
        <div className="flex flex-wrap gap-2.5 mt-10">
          {PROTECCIONES.map((x) => {
            const activo = x.id === sel
            return (
              <button key={x.id} onClick={() => setSel(x.id)}
                className="rounded-xl px-4 py-2.5 text-sm font-semibold border transition-all flex items-center gap-2"
                style={{ borderColor: activo ? x.color : 'rgba(0,0,0,0.12)', background: activo ? `${x.color}12` : '#fff', color: activo ? x.color : 'rgba(0,0,0,0.6)' }}>
                <span>{x.emoji}</span>{x.nombre}
              </button>
            )
          })}
        </div>
        <div className="mt-5 rounded-2xl border border-black/10 p-6 sm:p-8" style={{ background: `${p.color}08`, boxShadow: `inset 3px 0 0 ${p.color}` }}>
          <div className="flex items-center gap-3 mb-3">
            <span className="text-3xl">{p.emoji}</span>
            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full" style={{ background: `${p.color}1a`, color: p.color }}>{p.tag}</span>
              <h2 className="text-xl font-bold mt-1">{p.titulo}</h2>
            </div>
          </div>
          <p className="text-black/70 leading-relaxed text-[15px]">{p.texto}</p>
        </div>

        {/* Destacados */}
        {destacados.length > 0 && (
          <div className="mt-14">
            <div className="flex items-end justify-between gap-3 mb-4">
              <div>
                <p className="text-[11px] font-semibold tracking-[0.3em] uppercase mb-1" style={{ color: AZUL }}>La línea</p>
                <h3 className="text-2xl font-black">Modelos destacados</h3>
              </div>
              <a href={CATALOGO_URL} target="_blank" rel="noreferrer" className="hidden sm:inline text-[13px] font-bold whitespace-nowrap" style={{ color: AZUL }}>Ver catálogo completo →</a>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {destacados.map((m) => (
                <a key={m.modelo} href={CATALOGO_URL} target="_blank" rel="noreferrer"
                  className="rounded-xl border border-black/10 overflow-hidden bg-white hover:border-black/25 transition-colors no-underline text-inherit block">
                  <div className="aspect-square bg-white">
                    <img src={m.foto} alt={m.modelo} loading="lazy" className="w-full h-full object-contain" />
                  </div>
                  <p className="text-[12px] font-bold text-center px-2 py-2 truncate">{m.modelo}</p>
                </a>
              ))}
            </div>
          </div>
        )}

        {/* CTAs */}
        <div className="mt-14 rounded-2xl p-7 sm:p-10 text-center text-white relative overflow-hidden" style={{ background: '#0a0e1a' }}>
          <div className="absolute inset-x-0 top-0 h-0.5" style={{ background: AZUL }} />
          <h3 className="text-2xl sm:text-3xl font-black">¿Sumás la Triple Protección a tu óptica?</h3>
          <p className="text-white/60 mt-2 text-sm max-w-md mx-auto">Mirá el catálogo con descuentos exclusivos o coordiná una visita y te armamos una primera selección sin riesgo.</p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center mt-7">
            <a href={CATALOGO_URL} target="_blank" rel="noreferrer"
              className="inline-flex items-center justify-center gap-2 rounded-xl text-white font-bold px-6 py-3.5 transition-colors" style={{ background: AZUL }}>
              🕶️ Ver catálogo · descuentos exclusivos
            </a>
            <a href={waLink('¡Hola! Vi la info de la Triple Protección y quiero coordinar una visita / más información para mi óptica.')} target="_blank" rel="noreferrer"
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 transition-colors text-white font-bold px-6 py-3.5">
              📅 Coordinar visita / Más info
            </a>
          </div>
        </div>

        <p className="text-center text-black/35 text-[11px] mt-10 pb-10">Orbital Eyewear · Fabricante argentino · Triple Protección: Infrarrojo + UV400 + Blue Cut</p>
      </div>
    </div>
  )
}
