import { useState } from 'react'

// Landing público de Triple Protección — link comercial de Orbital (ruta /proteccion).
// Estética fiel al sitio: fondo claro, negro, acento dorado, fotos de producto. Infrarrojo primero.

const WA = '5491178548316' // WhatsApp de Orbital (IRIS)
const waLink = (msg: string) => `https://wa.me/${WA}?text=${encodeURIComponent(msg)}`
const ORO = '#a8813f'
const HERO = 'https://orbitaleyewear.com.ar/cdn/shop/files/banners_web-07.png'

interface Prot { id: string; nombre: string; emoji: string; color: string; tag: string; titulo: string; texto: string }

const PROTECCIONES: Prot[] = [
  {
    id: 'infrarrojo', nombre: 'Infrarrojo', emoji: '🔥', color: '#c0562e', tag: 'El diferencial',
    titulo: 'Filtro Infrarrojo',
    texto: 'Casi ningún anteojo del mercado lo tiene. Bloquea la radiación infrarroja —la que genera el calor y la fatiga visual bajo sol fuerte—. Resultado: menos cansancio y más confort en las jornadas largas al aire libre. Este es el filtro que marca la diferencia real.',
  },
  {
    id: 'uv400', nombre: 'UV400', emoji: '☀️', color: '#9a7b2f', tag: 'Protección total',
    titulo: 'Protección UV400',
    texto: 'Bloquea el 100% de los rayos UVA y UVB. Es la protección que de verdad importa: cuida los ojos del daño solar acumulativo, ese que no se ve pero se paga con los años.',
  },
  {
    id: 'bluecut', nombre: 'Blue Cut', emoji: '💻', color: '#2f6fb8', tag: 'Para el día a día',
    titulo: 'Filtro Blue Cut',
    texto: 'Filtra la luz azul de pantallas y LEDs. Ideal para el uso cotidiano, entre el sol de la calle y las horas frente al celular y la compu. Un plus de confort que el cliente agradece.',
  },
]

export default function ProteccionPublica() {
  const [sel, setSel] = useState('infrarrojo')
  const p = PROTECCIONES.find((x) => x.id === sel) ?? PROTECCIONES[0]

  return (
    <div className="min-h-screen bg-white text-[#0f0f10]" style={{ fontFamily: 'ui-sans-serif, system-ui, sans-serif' }}>
      {/* Barra de marca */}
      <div className="border-b border-black/10">
        <div className="max-w-4xl mx-auto px-5 h-14 flex items-center justify-between">
          <img src="/logo-orbital.png" alt="Orbital" className="h-6 w-auto" />
          <span className="text-[10px] tracking-[0.25em] text-black/45 uppercase">Eyewear · Hecho en Argentina</span>
        </div>
      </div>

      {/* Hero: banner de marca completo + título debajo */}
      <div className="w-full bg-[#ecebe9]">
        <img src={HERO} alt="Orbital Eyewear" className="w-full h-auto block" />
      </div>
      <div className="max-w-4xl mx-auto px-5 pt-10">
        <p className="text-[11px] font-semibold tracking-[0.3em] uppercase mb-3" style={{ color: ORO }}>La tecnología · Triple Protección</p>
        <h1 className="text-4xl sm:text-6xl font-black leading-[0.95] tracking-tight" style={{ textWrap: 'balance' } as React.CSSProperties}>
          Tres protecciones.<br />Un cristal.
        </h1>
        <p className="text-black/55 mt-4 max-w-xl text-sm sm:text-base">
          La única línea de Argentina con las tres protecciones en un mismo cristal. La diferencia real está en lo que el cliente no ve a simple vista.
        </p>
      </div>

      <div className="max-w-4xl mx-auto px-5 py-10">
        {/* Tabs — Infrarrojo primero */}
        <div className="flex flex-wrap gap-2.5">
          {PROTECCIONES.map((x) => {
            const activo = x.id === sel
            return (
              <button key={x.id} onClick={() => setSel(x.id)}
                className="rounded-xl px-4 py-2.5 text-sm font-semibold border transition-all flex items-center gap-2"
                style={{
                  borderColor: activo ? x.color : 'rgba(0,0,0,0.12)',
                  background: activo ? `${x.color}12` : '#fff',
                  color: activo ? x.color : 'rgba(0,0,0,0.6)',
                }}>
                <span>{x.emoji}</span>{x.nombre}
              </button>
            )
          })}
        </div>

        {/* Panel de la protección seleccionada */}
        <div className="mt-5 rounded-2xl border border-black/10 p-6 sm:p-8" style={{ background: `${p.color}08` }}>
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
        <div className="mt-12 rounded-2xl p-7 sm:p-9 text-center text-white" style={{ background: '#0f0f10' }}>
          <h3 className="text-2xl sm:text-3xl font-black">¿Sumás la Triple Protección a tu óptica?</h3>
          <p className="text-white/60 mt-2 text-sm max-w-md mx-auto">Te paso catálogo, lista de precios y te armo una primera selección para arrancar sin riesgo.</p>
          <a href={waLink('¡Hola! Vi la info de la Triple Protección y me interesa para mi óptica. ¿Me pasás catálogo y lista?')} target="_blank" rel="noreferrer"
            className="inline-flex items-center gap-2 mt-6 rounded-xl bg-emerald-500 hover:bg-emerald-400 transition-colors text-white font-bold px-6 py-3.5">
            📲 Pedir catálogo por WhatsApp
          </a>
        </div>

        <p className="text-center text-black/35 text-[11px] mt-10">Orbital Eyewear · Fabricante argentino · Triple Protección: Infrarrojo + UV400 + Blue Cut</p>
      </div>
    </div>
  )
}
