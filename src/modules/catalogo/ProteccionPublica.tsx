import { useState } from 'react'

// Landing público de Triple Protección — el link comercial de Orbital (ruta /proteccion).
// Autocontenido, sin login. Infrarrojo primero (es el diferencial que casi nadie tiene).

const WA = '5491178548316' // WhatsApp de Orbital (IRIS)
const waLink = (msg: string) => `https://wa.me/${WA}?text=${encodeURIComponent(msg)}`

interface Prot {
  id: string
  nombre: string
  emoji: string
  color: string
  tag: string
  titulo: string
  texto: string
}

const PROTECCIONES: Prot[] = [
  {
    id: 'infrarrojo', nombre: 'Infrarrojo', emoji: '🔥', color: '#f97316', tag: 'El diferencial',
    titulo: 'Filtro Infrarrojo',
    texto: 'Casi ningún anteojo del mercado lo tiene. Bloquea la radiación infrarroja —la que genera el calor y la fatiga visual bajo sol fuerte—. Resultado: menos cansancio y más confort en las jornadas largas al aire libre. Este es el filtro que marca la diferencia real.',
  },
  {
    id: 'uv400', nombre: 'UV400', emoji: '☀️', color: '#a855f7', tag: 'Protección total',
    titulo: 'Protección UV400',
    texto: 'Bloquea el 100% de los rayos UVA y UVB. Es la protección que de verdad importa: cuida los ojos del daño solar acumulativo, ese que no se ve pero se paga con los años.',
  },
  {
    id: 'bluecut', nombre: 'Blue Cut', emoji: '💻', color: '#06b6d4', tag: 'Para el día a día',
    titulo: 'Filtro Blue Cut',
    texto: 'Filtra la luz azul de pantallas y LEDs. Ideal para el uso cotidiano, entre el sol de la calle y las horas frente al celular y la compu. Un plus de confort que el cliente agradece.',
  },
]

export default function ProteccionPublica() {
  const [sel, setSel] = useState('infrarrojo')
  const p = PROTECCIONES.find((x) => x.id === sel) ?? PROTECCIONES[0]

  return (
    <div className="min-h-screen bg-[#0a0e1a] text-white overflow-x-hidden" style={{ fontFamily: 'ui-sans-serif, system-ui, sans-serif' }}>
      {/* Fondo con grilla sutil */}
      <div className="fixed inset-0 pointer-events-none opacity-[0.06]" style={{ backgroundImage: 'linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)', backgroundSize: '44px 44px' }} />

      <div className="relative max-w-3xl mx-auto px-5 py-8">
        {/* Marca */}
        <div className="flex items-center justify-between mb-14">
          <span className="text-xl font-black tracking-tight">ORBITAL</span>
          <span className="text-[10px] text-white/40 uppercase tracking-[0.2em]">Eyewear · Argentina</span>
        </div>

        {/* Hero */}
        <p className="text-center text-[11px] font-semibold tracking-[0.3em] text-indigo-300 uppercase mb-4">La tecnología</p>
        <h1 className="text-center text-4xl sm:text-5xl font-black leading-tight tracking-tight" style={{ textWrap: 'balance' } as React.CSSProperties}>
          Tres protecciones.<br />Un cristal.
        </h1>
        <p className="text-center text-white/60 mt-4 max-w-lg mx-auto text-sm sm:text-base">
          La única línea de Argentina con las tres protecciones en un mismo cristal. Tocá cada una: la diferencia real está en lo que el cliente no ve a simple vista.
        </p>

        {/* Tabs de protección — Infrarrojo primero */}
        <div className="flex flex-wrap justify-center gap-2.5 mt-8">
          {PROTECCIONES.map((x) => {
            const activo = x.id === sel
            return (
              <button key={x.id} onClick={() => setSel(x.id)}
                className="rounded-xl px-4 py-2.5 text-sm font-semibold border transition-all flex items-center gap-2"
                style={{
                  borderColor: activo ? x.color : 'rgba(255,255,255,0.12)',
                  background: activo ? `${x.color}1a` : 'rgba(255,255,255,0.03)',
                  color: activo ? '#fff' : 'rgba(255,255,255,0.7)',
                  boxShadow: activo ? `0 0 0 1px ${x.color}` : 'none',
                }}>
                <span>{x.emoji}</span>{x.nombre}
              </button>
            )
          })}
        </div>

        {/* Panel de la protección seleccionada */}
        <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.03] p-6 sm:p-8" style={{ boxShadow: `inset 0 1px 0 rgba(255,255,255,0.05), 0 0 60px -20px ${p.color}` }}>
          <div className="flex items-center gap-3 mb-3">
            <span className="text-3xl">{p.emoji}</span>
            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full" style={{ background: `${p.color}22`, color: p.color }}>{p.tag}</span>
              <h2 className="text-xl font-bold mt-1">{p.titulo}</h2>
            </div>
          </div>
          <p className="text-white/70 leading-relaxed text-[15px]">{p.texto}</p>
        </div>

        {/* Por qué Orbital */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-10">
          {[
            { n: 'Fabricantes', d: 'Fábrica en Buenos Aires' },
            { n: '+80', d: 'Modelos con entrega inmediata' },
            { n: 'Premium', d: 'Diseño actual, no se compite por precio' },
            { n: 'Exclusivo', d: 'Posiciones exclusivas por zona' },
          ].map((f) => (
            <div key={f.n} className="rounded-xl border border-white/10 bg-white/[0.02] p-4 text-center">
              <div className="text-lg font-black text-white">{f.n}</div>
              <div className="text-[11px] text-white/50 mt-1 leading-tight">{f.d}</div>
            </div>
          ))}
        </div>

        {/* CTA */}
        <div className="mt-12 rounded-2xl border border-white/10 p-6 sm:p-8 text-center" style={{ background: 'linear-gradient(135deg, rgba(249,115,22,0.12), rgba(168,85,247,0.08))' }}>
          <h3 className="text-2xl font-black">¿Sumás la Triple Protección a tu óptica?</h3>
          <p className="text-white/60 mt-2 text-sm max-w-md mx-auto">Te paso catálogo, lista de precios y te armo una primera selección para arrancar sin riesgo.</p>
          <a href={waLink('¡Hola! Vi la info de la Triple Protección y me interesa para mi óptica. ¿Me pasás catálogo y lista?')} target="_blank" rel="noreferrer"
            className="inline-flex items-center gap-2 mt-5 rounded-xl bg-emerald-500 hover:bg-emerald-400 transition-colors text-white font-bold px-6 py-3.5">
            📲 Pedir catálogo por WhatsApp
          </a>
        </div>

        <p className="text-center text-white/30 text-[11px] mt-10 mb-4">Orbital Eyewear · Fabricante argentino · Triple Protección: Infrarrojo + UV400 + Blue Cut</p>
      </div>
    </div>
  )
}
