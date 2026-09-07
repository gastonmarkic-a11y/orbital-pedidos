// Landing pública del Pack de Bienvenida a la Comunidad Orbital — ver.orbitaleyewear.com.ar/bienvenida
// Independiente de /canje. Contenido: propuesta de incorporación de nuevas ópticas a la red.

import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useRegistrarVisita } from '../../lib/visita'

const AZUL = '#1e50ff'
const WA = '5491178548316'
const waLink = (msg: string) => `https://wa.me/${WA}?text=${encodeURIComponent(msg)}`
const HERO = 'https://orbitaleyewear.com.ar/cdn/shop/files/Orbital_025.png?width=900'
// Link que arma el pack: entra al catálogo con la clave de campaña y en modo pack,
// que es el que enciende los carteles de "cómo armás tu pack".
const CLAVE_PACK = 'bienvenida2026'
const CATALOGO_PACK = `https://ver.orbitaleyewear.com.ar/catalogo?k=${CLAVE_PACK}&pack=bienvenida`

// Deportivos con toma profesional en 45° (bucket catalogo/tapa45).
const IMG45 = 'https://towcgvphxeqilpdnboki.supabase.co/storage/v1/object/public/catalogo/tapa45'
const DEPORTIVOS: [string, string][] = [
  ['ZERO', 'ZERO'], ['QUARTZ', 'QUARTZ'], ['VELOCITY', 'VELOCITY'], ['ADRENALINE', 'ADRENALINE'],
  ['ZETA 3', 'ZETA3'], ['ZETA 4', 'ZETA4'], ['ZETA 7', 'ZETA7'], ['ZETA 8', 'ZETA8'], ['ZETA 11', 'ZETA11'],
]

// Escala de piezas sin cargo: desde 12 de línea, 25 % — 1 cada 4.
const ESCALA: [number, number][] = [[12, 3], [16, 4], [20, 5], [24, 6], [32, 8], [40, 10]]

interface Destacado { modelo: string; foto: string }

const BENEFICIOS = [
  { emoji: '🪟', titulo: 'Exhibidor + POP físico', texto: 'Exhibidor, POP de la última colección, cartel de vidriera e intervenciones específicas para potenciar la marca en tu punto de venta.' },
  { emoji: '📱', titulo: 'Kit digital para tus redes', texto: 'Reels, stories, posts y copies listos para publicar. Publicamos juntos tu apertura: nuestra comunidad se entera de que Orbital está en tu tienda.' },
  { emoji: '⚡', titulo: 'Preventa exclusiva', texto: 'Acceso anticipado a cada lanzamiento, con precio especial y entrega garantizada antes que nadie.' },
  { emoji: '🛡️', titulo: '100 % ventas garantizadas', texto: 'Si algo no funciona, lo reponemos sin costo. Tu único objetivo: vender nuestros productos.' },
  { emoji: '🧾', titulo: 'Nota de crédito por discontinuados', texto: 'Si un producto baja de precio o se discontinúa, generamos una nota de crédito por la diferencia.' },
  { emoji: '🛒', titulo: 'Red oficial Mercado Libre', texto: 'Vendedor oficial de la red Orbital en ML. Usá Mercado Flex para tu zona o vendé a todo el país.' },
]

const POP = [
  'Exhibidor incluido',
  'Material POP completo para tu local',
  'Señalética ORBITAL™ — Óptica Autorizada',
  'Armado rápido, sin herramientas',
  'Backing con logo para mostrador',
  'Todo listo para abrir el mismo día',
]

const KIT = [
  { t: 'REEL 15 seg', d: 'Listo para Instagram y TikTok — por modelo' },
  { t: 'STORY estética', d: 'Con tu nombre y ciudad personalizado' },
  { t: 'POST cuadrado', d: 'Para feed, WhatsApp Status y Facebook' },
  { t: 'COPY sugerido', d: 'Caption redactado, adaptalo como quieras' },
  { t: 'MENCIÓN coordinada', d: '@orbital.eyewear publica el mismo día que vos' },
  { t: 'DRIVE compartido', d: 'Assets actualizados mes a mes' },
]

const PREVENTA = [
  'Anunciamos el nuevo modelo con imágenes y ficha técnica',
  'Recibís el precio especial de preventa — menor al catálogo',
  'Confirmás cantidad y te reservamos el stock',
  'Entrega garantizada en la fecha acordada',
  'Publicamos el lanzamiento en conjunto en redes',
]

const PASOS = [
  'Entrás al catálogo y armás tu pack: 12 o más piezas de línea',
  'Sumás tus piezas sin cargo desde Oportunidades — 1 cada 4 de línea',
  'Enviás el pedido y tu vendedor confirma la propuesta con precio',
  'Acordamos entrega del pack y fecha de lanzamiento',
  'Publicamos juntos tu apertura en redes',
  'Empezás a vender con 100 % ventas garantizadas',
]

const INCLUYE_FISICO = [
  'Las piezas de línea que elegís vos, desde 12',
  'Piezas sin cargo de Oportunidades — 1 cada 4 de línea',
  'Exhibidor de bienvenida',
  'Material POP completo para tu local',
  'Señalética y backing para mostrador',
]

const INCLUYE_DIGITAL = [
  'Kit de redes: reel + story + post · 4 modelos',
  'Copy sugerido para cada pieza',
  'Mención en @orbital.eyewear el día del lanzamiento',
  '100 % ventas garantizadas — reposición sin costo',
  'Nota de crédito por discontinuados o bajada de precio',
  'Descuento exclusivo de incorporación en preventa',
  'Acceso a la red oficial de Mercado Libre',
]

export default function LandingBienvenida() {
  useRegistrarVisita('bienvenida')
  const [destacados, setDestacados] = useState<Destacado[]>([])
  useEffect(() => {
    supabase.rpc('proteccion_destacados').then(({ data }) => setDestacados((data as Destacado[]) ?? []))
  }, [])

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
            EL PACK DE BIENVENIDA
          </span>
          <p className="text-[11px] font-semibold tracking-[0.3em] uppercase mt-4 mb-3" style={{ color: AZUL }}>Bienvenido</p>
          <h1 className="text-4xl sm:text-5xl font-black leading-[0.95] tracking-tight" style={{ textWrap: 'balance' } as React.CSSProperties}>
            A la comunidad<br />Orbital.
          </h1>
          <p className="text-black/55 mt-4 text-sm sm:text-base">
            Tu nuevo punto de venta. Tu nueva comunidad. Tu nuevo canal. Un pack diseñado para vender desde el día 1.
          </p>
          <div className="flex flex-wrap gap-2 mt-5">
            {['Exhibidor incluido', 'Kit digital', '100 % ventas garantizadas', 'Lanzamiento colaborativo'].map((t) => (
              <span key={t} className="rounded-full border border-black/10 px-3 py-1 text-[11px] font-semibold text-black/60">{t}</span>
            ))}
          </div>
        </div>
        <div className="order-1 md:order-2">
          <img src={HERO} alt="Orbital Eyewear" className="w-full h-auto max-h-[38vh] md:max-h-none object-cover object-top rounded-2xl border border-black/10" />
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-5">
        {/* Beneficios */}
        <div className="mt-14">
          <p className="text-[11px] font-semibold tracking-[0.3em] uppercase mb-1" style={{ color: AZUL }}>Desde el primer día</p>
          <h2 className="text-2xl sm:text-3xl font-black">Todo lo que recibís</h2>
          <div className="grid sm:grid-cols-2 gap-3 mt-5">
            {BENEFICIOS.map((b) => (
              <div key={b.titulo} className="rounded-2xl border border-black/10 p-5">
                <span className="text-2xl">{b.emoji}</span>
                <h3 className="font-bold mt-2 text-[15px]">{b.titulo}</h3>
                <p className="text-black/60 text-[13px] leading-relaxed mt-1.5">{b.texto}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Pack físico + Kit digital */}
        <div className="mt-14 grid md:grid-cols-2 gap-4">
          <div className="rounded-2xl border border-black/10 p-6" style={{ background: `${AZUL}06`, boxShadow: `inset 3px 0 0 ${AZUL}` }}>
            <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: AZUL }}>Pack físico</p>
            <h3 className="text-xl font-black mt-1">Exhibidor + material POP</h3>
            <p className="text-black/60 text-[13px] mt-2 leading-relaxed">
              Tu local recibe todo lo necesario para presentar Orbital de forma profesional desde el primer día, sin inversión adicional en mobiliario ni diseño.
            </p>
            <ul className="mt-4 space-y-2">
              {POP.map((x) => (
                <li key={x} className="flex gap-2 text-[13px] text-black/75"><span style={{ color: AZUL }}>✓</span>{x}</li>
              ))}
            </ul>
          </div>
          <div className="rounded-2xl border border-black/10 p-6">
            <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: AZUL }}>Material digital</p>
            <h3 className="text-xl font-black mt-1">Tu apertura en nuestras redes</h3>
            <p className="text-black/60 text-[13px] mt-2 leading-relaxed">
              Al incorporarte lanzamos tu apertura de forma coordinada: vos publicás con el kit que te damos y nosotros te mencionamos en @orbital.eyewear el mismo día.
            </p>
            <div className="mt-4 space-y-2.5">
              {KIT.map((k) => (
                <div key={k.t} className="border-l-2 pl-3" style={{ borderColor: `${AZUL}40` }}>
                  <p className="text-[12px] font-bold">{k.t}</p>
                  <p className="text-[12px] text-black/55">{k.d}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Selección curada — destacados reales, con foto */}
        <div className="mt-14">
          <p className="text-[11px] font-semibold tracking-[0.3em] uppercase mb-1" style={{ color: AZUL }}>Selección curada</p>
          <h2 className="text-2xl sm:text-3xl font-black">Los modelos que más venden</h2>
          <p className="text-black/55 text-sm mt-2 max-w-2xl">
            Tenemos más de 500 posiciones disponibles. Estos son los destacados de la marca: con los que arrancás con el mejor pie.
          </p>
          {destacados.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2.5 mt-5">
              {destacados.map((m) => (
                <a key={m.modelo} href={CATALOGO_PACK} target="_blank" rel="noreferrer"
                  className="rounded-xl border border-black/10 overflow-hidden bg-white hover:border-black/25 transition-colors no-underline text-inherit block">
                  <div className="aspect-square bg-white">
                    <img src={m.foto} alt={m.modelo} loading="lazy" className="w-full h-full object-contain" />
                  </div>
                  <p className="text-[11px] font-bold text-center px-2 py-2 truncate">{m.modelo}</p>
                </a>
              ))}
            </div>
          )}

          {/* Deportivos en 45° */}
          <div className="mt-8">
            <p className="text-[11px] font-semibold tracking-[0.3em] uppercase mb-1" style={{ color: AZUL }}>Línea deportiva</p>
            <h3 className="text-xl font-black">Performance, en 45°</h3>
            <div className="grid grid-cols-3 sm:grid-cols-5 md:grid-cols-9 gap-2 mt-4">
              {DEPORTIVOS.map(([nombre, file]) => (
                <a key={nombre} href={CATALOGO_PACK} target="_blank" rel="noreferrer"
                  className="rounded-xl border border-black/10 overflow-hidden bg-white hover:border-black/25 transition-colors no-underline text-inherit block">
                  <div className="aspect-square bg-white">
                    <img src={`${IMG45}/${file}.png`} alt={nombre} loading="lazy" className="w-full h-full object-contain" />
                  </div>
                  <p className="text-[10px] font-bold text-center px-1 py-1.5 truncate">{nombre}</p>
                </a>
              ))}
            </div>
          </div>
        </div>

        {/* Cómo se arma el pack: la escala de piezas sin cargo */}
        <div className="mt-14 rounded-2xl border border-black/10 p-6 sm:p-8" style={{ background: `${AZUL}06`, boxShadow: `inset 3px 0 0 ${AZUL}` }}>
          <p className="text-[11px] font-semibold tracking-[0.3em] uppercase mb-1" style={{ color: AZUL }}>Piezas sin cargo</p>
          <h2 className="text-2xl sm:text-3xl font-black">Desde 12 de línea sumás piezas sin cargo.</h2>
          <p className="text-black/60 text-sm mt-2 max-w-2xl">
            Armás tu pack en el catálogo: cada 4 piezas de línea sumás 1 pieza sin cargo. Las piezas sin cargo se
            eligen siempre de la sección <b>Oportunidades</b> —no de línea— y entran al pedido en $0. Cuanto más
            grande el pack, más piezas sin cargo.
          </p>
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2.5 mt-5">
            {ESCALA.map(([linea, gratis]) => (
              <div key={linea} className="rounded-xl bg-white border border-black/10 p-3 text-center">
                <p className="text-[10px] text-black/45 uppercase tracking-wider">{linea} de línea</p>
                <p className="text-2xl font-black mt-0.5" style={{ color: AZUL }}>+{gratis}</p>
                <p className="text-[10px] text-black/45">sin cargo<br />de oportunidad</p>
              </div>
            ))}
          </div>
          <a href={CATALOGO_PACK} target="_blank" rel="noreferrer"
            className="inline-flex items-center justify-center gap-2 rounded-xl text-white font-bold px-6 py-3.5 mt-6 no-underline" style={{ background: AZUL }}>
            🕶️ Armar mi pack en el catálogo
          </a>
        </div>

        {/* Tecnología */}
        <div className="mt-14">
          <p className="text-[11px] font-semibold tracking-[0.3em] uppercase mb-1" style={{ color: AZUL }}>Tecnología Orbital</p>
          <h2 className="text-2xl sm:text-3xl font-black">Lo que hay adentro de cada Orbital</h2>
          <p className="text-black/55 text-sm mt-2 max-w-2xl">
            Cada anteojo combina dos plataformas propias: una óptica y una de materialidad. No vendés solo un marco, vendés tecnología aplicada al confort diario.
          </p>
          <div className="grid md:grid-cols-2 gap-3 mt-5">
            <div className="rounded-2xl border border-black/10 p-6">
              <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: AZUL }}>Cristales</p>
              <h3 className="text-lg font-black mt-1">ORBITAL VSL Technology</h3>
              <p className="text-black/50 text-[12px] mt-1">La plataforma óptica para la luz real.</p>
              <ul className="mt-3 space-y-2 text-[13px] text-black/75">
                <li><b>Protección UV400</b> — filtra UVA y UVB en las versiones solares.</li>
                <li><b>Confort frente al exceso de luz</b> — menos encandilamiento y tensión ocular.</li>
                <li><b>Claridad y contraste</b> — percepción más nítida y equilibrada.</li>
                <li><b>Uso prolongado</b> — pantallas, manejo y largas jornadas al sol.</li>
              </ul>
            </div>
            <div className="rounded-2xl border border-black/10 p-6">
              <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: AZUL }}>Material de marco</p>
              <h3 className="text-lg font-black mt-1">XYLON® Technology</h3>
              <p className="text-black/50 text-[12px] mt-1">Poliamida de alta performance.</p>
              <ul className="mt-3 space-y-2 text-[13px] text-black/75">
                <li><b>Liviano</b> — estructuras ligeras, más cómodas sobre el rostro.</li>
                <li><b>Flexible</b> — acompaña el movimiento y el uso diario.</li>
                <li><b>Resistente</b> — durabilidad real para el día a día.</li>
                <li><b>Confort prolongado</b> — ergonomía natural en jornadas largas.</li>
              </ul>
            </div>
          </div>
          <p className="text-center text-black/50 text-[13px] mt-4">
            XYLON cuida la experiencia física. VSL cuida la experiencia visual. Ver mejor, sentir mejor y usar mejor, todo el día.
          </p>
        </div>

        {/* Preventa */}
        <div className="mt-14 rounded-2xl border border-black/10 p-6 sm:p-8">
          <p className="text-[11px] font-semibold tracking-[0.3em] uppercase mb-1" style={{ color: AZUL }}>Preventa exclusiva</p>
          <h2 className="text-2xl font-black">Acceso anticipado a cada lanzamiento</h2>
          <p className="text-black/55 text-sm mt-2">
            Como parte de la comunidad Orbital tenés acceso anticipado a cada nuevo modelo, con precio especial y entrega garantizada antes que nadie.
          </p>
          <ol className="mt-5 space-y-2.5">
            {PREVENTA.map((p, i) => (
              <li key={p} className="flex gap-3 text-[13px] text-black/75">
                <span className="font-mono font-bold shrink-0" style={{ color: AZUL }}>{String(i + 1).padStart(2, '0')}</span>{p}
              </li>
            ))}
          </ol>
          <div className="mt-5 rounded-xl bg-black/[0.03] p-4">
            <p className="text-[12px] font-bold mb-2">Beneficios exclusivos en cada preventa</p>
            <ul className="space-y-1.5 text-[12px] text-black/65">
              <li>· Precio especial inferior al catálogo regular</li>
              <li>· Entrega garantizada antes del lanzamiento oficial</li>
              <li>· Material de comunicación digital completo incluido</li>
              <li>· Primera opción en nuevos modelos, antes que la competencia</li>
              <li>· Descuento adicional por volumen en cada reposición</li>
              <li>· Acceso a la línea curada con precio diferencial para miembros de la red</li>
            </ul>
          </div>
        </div>

        {/* Garantía */}
        <div className="mt-14 rounded-2xl p-7 sm:p-10 text-white relative overflow-hidden" style={{ background: '#0a0e1a' }}>
          <div className="absolute inset-x-0 top-0 h-0.5" style={{ background: AZUL }} />
          <h2 className="text-2xl sm:text-3xl font-black text-center">100 % ventas garantizadas</h2>
          <p className="text-white/60 mt-2 text-sm text-center max-w-lg mx-auto">
            Si algo no funciona, lo reponemos. Sin discusiones. Sin costo. Nuestra única preocupación es que vendas el 100 % de nuestros productos.
          </p>
          <div className="grid sm:grid-cols-2 gap-3 mt-7">
            <div className="rounded-xl bg-white/5 p-5">
              <p className="text-[11px] font-bold uppercase tracking-wider" style={{ color: '#8fa6ff' }}>Reposición sin costo</p>
              <p className="text-white/70 text-[13px] mt-2 leading-relaxed">Si un producto no rota como esperabas, lo reponemos por otro de la línea sin costo adicional. Estamos comprometidos con tu éxito de venta.</p>
            </div>
            <div className="rounded-xl bg-white/5 p-5">
              <p className="text-[11px] font-bold uppercase tracking-wider" style={{ color: '#8fa6ff' }}>Nota de crédito</p>
              <p className="text-white/70 text-[13px] mt-2 leading-relaxed">Si un modelo se discontinúa o baja de precio, emitimos una nota de crédito por la diferencia para que rotes el stock más rápido y sin pérdida.</p>
            </div>
          </div>
          <p className="text-center text-white/45 text-[13px] italic mt-6">
            “Nuestro éxito depende de tu éxito. Por eso garantizamos cada producto que ponés en tu local.”
          </p>
        </div>

        {/* Pack completo */}
        <div className="mt-14">
          <p className="text-[11px] font-semibold tracking-[0.3em] uppercase mb-1" style={{ color: AZUL }}>El pack completo</p>
          <h2 className="text-2xl sm:text-3xl font-black">Todo incluido. Sin letra chica.</h2>
          <div className="grid md:grid-cols-2 gap-3 mt-5">
            <div className="rounded-2xl border border-black/10 p-6">
              <p className="text-[10px] font-bold uppercase tracking-wider text-black/40">Físico</p>
              <ul className="mt-3 space-y-2">
                {INCLUYE_FISICO.map((x) => (
                  <li key={x} className="flex gap-2 text-[13px] text-black/75"><span style={{ color: AZUL }}>✓</span>{x}</li>
                ))}
              </ul>
            </div>
            <div className="rounded-2xl border border-black/10 p-6">
              <p className="text-[10px] font-bold uppercase tracking-wider text-black/40">Digital + garantías</p>
              <ul className="mt-3 space-y-2">
                {INCLUYE_DIGITAL.map((x) => (
                  <li key={x} className="flex gap-2 text-[13px] text-black/75"><span style={{ color: AZUL }}>✓</span>{x}</li>
                ))}
              </ul>
            </div>
          </div>
          <p className="text-center text-black/55 text-[13px] mt-4">
            Inversión del pack: <b>a convenir con tu vendedor asignado</b> · Condición especial de bienvenida.
          </p>
        </div>

        {/* Pasos + CTA */}
        <div className="mt-14 rounded-2xl border border-black/10 p-6 sm:p-8">
          <h2 className="text-2xl font-black">¿Empezamos?</h2>
          <p className="text-black/55 text-sm mt-1">Tu vendedor ya tiene todo listo para vos.</p>
          <ol className="mt-5 space-y-2.5">
            {PASOS.map((p, i) => (
              <li key={p} className="flex gap-3 text-[13px] text-black/75">
                <span className="font-mono font-bold shrink-0" style={{ color: AZUL }}>{String(i + 1).padStart(2, '0')}</span>{p}
              </li>
            ))}
          </ol>
          <div className="flex flex-col sm:flex-row gap-3 mt-7">
            <a href={waLink('¡Hola! Vi el Pack de Bienvenida de Orbital y quiero sumar la marca a mi óptica.')} target="_blank" rel="noreferrer"
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 transition-colors text-white font-bold px-6 py-3.5 no-underline">
              💬 Quiero el pack de bienvenida
            </a>
            <a href={CATALOGO_PACK} target="_blank" rel="noreferrer"
              className="inline-flex items-center justify-center gap-2 rounded-xl text-white font-bold px-6 py-3.5 transition-colors no-underline" style={{ background: AZUL }}>
              🕶️ Armar mi pack en el catálogo
            </a>
          </div>
        </div>

        <p className="text-center text-black/35 text-[11px] mt-10 pb-10">
          ORBITAL™ · Made in Argentina · orbital.eyewear@gmail.com · @orbital.eyewear · orbitaleyewear.com.ar
        </p>
      </div>
    </div>
  )
}
