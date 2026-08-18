import { useState } from 'react'

// Landing público de Triple Protección — link comercial de Orbital (ruta /proteccion).
// Estética de marca: claro, negro, acento AZUL tech + logo correcto. Infrarrojo primero.

const WA = '5491178548316' // WhatsApp de Orbital (IRIS)
const waLink = (msg: string) => `https://wa.me/${WA}?text=${encodeURIComponent(msg)}`
const AZUL = '#1e50ff'
const HERO = 'https://orbitaleyewear.com.ar/cdn/shop/files/Orbital_025.png?width=900'

interface Prot { id: string; nombre: string; emoji: string; color: string; tag: string; titulo: string; texto: string }

const PROTECCIONES: Prot[] = [
  {
    id: 'infrarrojo', nombre: 'Infrarrojo', emoji: '🔥', color: '#e0562e', tag: 'El diferencial',
    titulo: 'Filtro Infrarrojo',
    texto: 'Casi ningún anteojo del mercado lo tiene. Bloquea la radiación infrarroja —la que genera el calor y la fatiga visual bajo sol fuerte—. Resultado: menos cansancio y más confort en las jornadas largas al aire libre. Este es el filtro que marca la diferencia real.',
  },
  {
    id: 'uv400', nombre: 'UV400', emoji: '☀️', color: '#c9971f', tag: 'Protección total',
    titulo: 'Protección UV400',
    texto: 'Bloquea el 100% de los rayos UVA y UVB. Es la protección que de verdad importa: cuida los ojos del daño solar acumulativo, ese que no se ve pero se paga con los años.',
  },
  {
    id: 'bluecut', nombre: 'Blue Cut', emoji: '💠', color: AZUL, tag: 'Para el día a día',
    titulo: 'Filtro Blue Cut',
    texto: 'Filtra la luz azul de pantallas y LEDs. Ideal para el uso cotidiano, entre el sol de la calle y las horas frente al celular y la compu. Un plus de confort que el cliente agradece.',
  },
]

export default function ProteccionPublica() {
  const [sel, setSel] = useState('infrarrojo')
  const p = PROTECCIONES.find((x) => x.id === sel) ?? PROTECCIONES[0]

  return (
    <div className="min-h-screen bg-white text-[#0f0f10]" style={{ fontFamily: 'ui-sans-serif, system-ui, sans-serif' }}>
      {/* Barra de marca con logo correcto */}
      <div className="border-b border-black/10">
        <div className="max-w-4xl mx-auto px-5 h-16 flex items-center justify-between">
          <img src="/logo-orbital-tm.png" alt="Orbital Eyewear" className="h-8 w-auto" />
          <span className="text-[10px] tracking-[0.25em] text-black/45 uppercase">Hecho en Argentina</span>
        </div>
      </div>

      {/* Hero: texto + foto del modelo (banners_web-08, retrato) */}
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
        {/* Tabs — Infrarrojo primero */}
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

        {/* Panel de la protección seleccionada */}
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

        {/* Por qué Orbital */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-10">
          {[
            { n: 'Fabricantes', d: 'Fábrica en Buenos Aires' },
            { n: '+80', d: 'Modelos con entrega inmediata' },
            { n: 'Premium', d: 'Diseño actual, no se compite por precio' },
            { n: 'Exclusivo', d: 'Posiciones exclusivas por zona' },
          ].map((f) => (
            <div key={f.n} className="rounded-xl border border-black/10 p-4 text-center">
              <div className="text-lg font-black">{f.n}</div>
              <div className="text-[11px] text-black/50 mt-1 leading-tight">{f.d}</div>
            </div>
          ))}
        </div>

        {/* CTA */}
        <div className="mt-12 rounded-2xl p-7 sm:p-9 text-center text-white relative overflow-hidden" style={{ background: '#0a0e1a' }}>
          <div className="absolute inset-x-0 top-0 h-0.5" style={{ background: AZUL }} />
          <h3 className="text-2xl sm:text-3xl font-black">¿Sumás la Triple Protección a tu óptica?</h3>
          <p className="text-white/60 mt-2 text-sm max-w-md mx-auto">Te paso catálogo, lista de precios y te armo una primera selección para arrancar sin riesgo.</p>
          <a href={waLink('¡Hola! Vi la info de la Triple Protección y me interesa para mi óptica. ¿Me pasás catálogo y lista?')} target="_blank" rel="noreferrer"
            className="inline-flex items-center gap-2 mt-6 rounded-xl bg-emerald-500 hover:bg-emerald-400 transition-colors text-white font-bold px-6 py-3.5">
            📲 Pedir catálogo por WhatsApp
          </a>
        </div>

        <p className="text-center text-black/35 text-[11px] mt-10 pb-10">Orbital Eyewear · Fabricante argentino · Triple Protección: Infrarrojo + UV400 + Blue Cut</p>
      </div>
    </div>
  )
}
