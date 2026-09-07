// Landing pública del Plan Canje 2026 — ver.orbitaleyewear.com.ar/canje
// Independiente de /bienvenida. Contenido: renovación de stock para clientes activos.
import { useRegistrarVisita, tokenDeLaUrl } from '../../lib/visita'

const AZUL = '#1e50ff'
// El CTA no puede ser azul: el azul es el acento de toda la página y el botón
// se mezclaba. Negro sólido, que es lo que más contrasta sobre el blanco.
const CTA = '#0f0f10'
const WA = '5491178548316'
const waLink = (msg: string) => `https://wa.me/${WA}?text=${encodeURIComponent(msg)}`
const HERO = 'https://orbitaleyewear.com.ar/cdn/shop/files/Orbital_025.png?width=900'
// Si la óptica llegó con su token (…/canje?c=xxx) el catálogo le abre directo,
// con sus precios y sin clave. Sin token cae en la pantalla de acceso.
const catalogoUrl = () => {
  const t = tokenDeLaUrl()
  return t ? `https://ver.orbitaleyewear.com.ar/catalogo?k=${encodeURIComponent(t)}`
           : 'https://ver.orbitaleyewear.com.ar/catalogo'
}

// El mismo botón arriba y en el cierre. Área de toque grande y ancho completo
// en celular, que es donde se lee la landing.
function BotonCatalogo({ className = '', texto = '🕶️ Ver el mix y armar mi pedido' }: { className?: string; texto?: string }) {
  return (
    <a
      href={catalogoUrl()}
      target="_blank"
      rel="noreferrer"
      className={`inline-flex w-full sm:w-auto items-center justify-center gap-2 rounded-xl text-white font-bold text-[15px] px-7 py-4 no-underline shadow-lg shadow-black/20 hover:shadow-xl hover:-translate-y-0.5 active:translate-y-0 transition-all ${className}`}
      style={{ background: CTA }}
    >
      {texto}
    </a>
  )
}

const CONTRASTE = [
  { estado: 'HOY', tono: 'gris', titulo: 'Stock parado', texto: 'Modelos que llevan meses en el exhibidor sin moverse, ocupando espacio visual y físico.' },
  { estado: 'HOY', tono: 'gris', titulo: 'Espacio sin vender', texto: 'Cada percha con un modelo que no rota es una oportunidad de venta que no se está usando.' },
  { estado: 'CON EL CANJE', tono: 'azul', titulo: 'Exhibidor renovado', texto: 'Cambiás lo que no funciona por el mix más actual, pensado para lo que se está vendiendo hoy.' },
  { estado: 'CON EL CANJE', tono: 'azul', titulo: 'Más rotación', texto: 'Arrancás la temporada con productos con mejor desempeño de mercado, no con lo que sobró.' },
]

const PASOS = [
  'Revisamos juntos tu exhibidor y detectamos los modelos que no están rotando.',
  'Armás tu pedido nuevo con el mix más actual de la temporada.',
  'Hasta el 20 % del pedido va por canje: se factura a precio de lista, sin descuento — y por lo que devolvés emitimos una nota de crédito al precio actual de ese producto.',
  'El resto del pedido mantiene tu descuento habitual de compra.',
  'Ejecutás de una vez o en etapas — vos definís el ritmo.',
]

// Mix de temporada del Plan Canje. Las fotos salen del bucket de destacados.
const IMG = 'https://towcgvphxeqilpdnboki.supabase.co/storage/v1/object/public/catalogo/destacados'
const MIX: { nombre: string; tag: string; foto: string }[] = [
  { nombre: 'ASCARI', tag: 'Preventa 2026', foto: `${IMG}/ASCARI.png` },
  { nombre: 'CIVIC CENTER', tag: 'Contemporáneo', foto: `${IMG}/CIVICCENTER.png` },
  { nombre: 'CASA BLANCA', tag: 'Preventa 2026', foto: `${IMG}/CASABLANCA.png` },
  { nombre: '5TH AVENUE', tag: 'Urbano', foto: `${IMG}/5THAVENUE.png` },
]

const INCLUYE = [
  'Hasta el 20 % del pedido se resuelve vía canje, a precio de lista.',
  'Nota de crédito por lo que devolvés, al precio actual del producto — no perdés valor.',
  'El resto del pedido mantiene tu descuento habitual de compra.',
  'Ejecución en etapas o de una vez — el ritmo lo definís vos.',
  'Sin pedido mínimo para activarlo.',
  'Acceso al mix más nuevo de la temporada, incluida la preventa exclusiva.',
  'Menos stock inmovilizado, más rotación en tu exhibidor.',
  'Kit digital de relanzamiento incluido para comunicar la renovación en tus redes.',
]

const ACTIVACION = [
  'Revisás tu exhibidor con tu vendedor asignado.',
  'Armás el pedido nuevo con el mix de temporada.',
  'Hasta el 20 % va por canje a precio de lista, con nota de crédito por lo devuelto.',
  'Definimos si se ejecuta de una vez o en etapas.',
  'Arrancás la temporada con el exhibidor renovado.',
]

export default function LandingCanje() {
  useRegistrarVisita('canje')
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
            EXCLUSIVO PARA CLIENTES ACTIVOS
          </span>
          <p className="text-[11px] font-semibold tracking-[0.3em] uppercase mt-4 mb-3" style={{ color: AZUL }}>Plan Canje 2026</p>
          <h1 className="text-4xl sm:text-5xl font-black leading-[0.95] tracking-tight" style={{ textWrap: 'balance' } as React.CSSProperties}>
            Empezá la temporada con lo que realmente vende.
          </h1>
          <p className="text-black/55 mt-4 text-sm sm:text-base">
            Renovamos tu stock: cambiamos lo que no rota por el mix más nuevo de Orbital. Sin inversión adicional, sin letra chica.
          </p>
          <div className="flex flex-wrap gap-2 mt-5">
            {['Hasta 20 % del pedido', 'Descuento intacto en el resto', 'Sin pedido mínimo'].map((t) => (
              <span key={t} className="rounded-full border border-black/10 px-3 py-1 text-[11px] font-semibold text-black/60">{t}</span>
            ))}
          </div>
          {/* La acción principal, apenas entra: sin scrollear. */}
          <div className="mt-6">
            <BotonCatalogo />
            <p className="text-[11px] text-black/40 mt-2">Entrás con tu acceso, sin clave, y armás el pedido con tus precios.</p>
          </div>
        </div>
        <div className="order-1 md:order-2">
          <img src={HERO} alt="Orbital Eyewear" className="w-full h-auto max-h-[38vh] md:max-h-none object-cover object-top rounded-2xl border border-black/10" />
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-5">
        {/* Problema / solución */}
        <div className="mt-14">
          <p className="text-[11px] font-semibold tracking-[0.3em] uppercase mb-1" style={{ color: AZUL }}>Todos tenemos modelos que no rotan</p>
          <h2 className="text-2xl sm:text-3xl font-black">Ese espacio del exhibidor podría estar vendiendo.</h2>
          <p className="text-black/55 text-sm mt-2 max-w-2xl">
            No es un problema de calidad. Es un problema de rotación. Cada modelo parado ocupa un lugar que podría estar generando venta ahora mismo, en plena temporada.
          </p>
          <div className="grid sm:grid-cols-2 gap-3 mt-5">
            {CONTRASTE.map((c) => {
              const azul = c.tono === 'azul'
              return (
                <div key={c.titulo} className="rounded-2xl border p-5"
                  style={{ borderColor: azul ? `${AZUL}33` : 'rgba(0,0,0,0.1)', background: azul ? `${AZUL}08` : '#fff' }}>
                  <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full"
                    style={{ background: azul ? `${AZUL}1a` : 'rgba(0,0,0,0.06)', color: azul ? AZUL : 'rgba(0,0,0,0.45)' }}>
                    {c.estado}
                  </span>
                  <h3 className="font-bold mt-2.5 text-[15px]">{c.titulo}</h3>
                  <p className="text-black/60 text-[13px] leading-relaxed mt-1.5">{c.texto}</p>
                </div>
              )
            })}
          </div>

          {/* Dato 20% */}
          <div className="mt-4 rounded-2xl border border-black/10 p-6 flex flex-col sm:flex-row gap-5 sm:items-center" style={{ background: `${AZUL}06`, boxShadow: `inset 3px 0 0 ${AZUL}` }}>
            <div className="shrink-0">
              <p className="text-5xl font-black tracking-tight" style={{ color: AZUL }}>20 %</p>
              <p className="text-[11px] font-semibold text-black/50 uppercase tracking-wider">del pedido vía canje</p>
            </div>
            <p className="text-[13px] text-black/70 leading-relaxed">
              Esa porción se factura a precio de lista, sin descuento, y generamos una nota de crédito por el mismo valor al precio actual de lo que devolvés — no perdés valor. El resto del pedido sigue con tu descuento habitual.
            </p>
          </div>
        </div>

        {/* Cómo funciona */}
        <div className="mt-14 rounded-2xl border border-black/10 p-6 sm:p-8">
          <p className="text-[11px] font-semibold tracking-[0.3em] uppercase mb-1" style={{ color: AZUL }}>Cómo funciona</p>
          <h2 className="text-2xl font-black">Cambiamos lo que no rota por lo que sí vende.</h2>
          <p className="text-black/55 text-sm mt-2">
            El canje se aplica sobre el pedido nuevo que hacés para arrancar la temporada. Así de simple.
          </p>
          <ol className="mt-5 space-y-3">
            {PASOS.map((p, i) => (
              <li key={p} className="flex gap-3 text-[13px] text-black/75 leading-relaxed">
                <span className="font-mono font-bold shrink-0" style={{ color: AZUL }}>{String(i + 1).padStart(2, '0')}</span>{p}
              </li>
            ))}
          </ol>
          <p className="mt-6 text-[13px] italic text-black/55 border-l-2 pl-4" style={{ borderColor: `${AZUL}55` }}>
            “La parte de canje se factura a precio lleno de los dos lados — lo que devolvés y lo que comprás. Así nadie pierde valor ni margen en la operación.”
          </p>
          <div className="grid sm:grid-cols-3 gap-2.5 mt-6">
            {['Hasta 20 % del pedido', 'Descuento intacto en el resto', 'Sin pedido mínimo'].map((t) => (
              <div key={t} className="rounded-xl bg-black/[0.03] px-3 py-3 text-center text-[12px] font-bold text-black/70">{t}</div>
            ))}
          </div>
        </div>

        {/* Mix de temporada */}
        <div className="mt-14">
          <p className="text-[11px] font-semibold tracking-[0.3em] uppercase mb-1" style={{ color: AZUL }}>Lo mejor disponible para esta temporada</p>
          <h2 className="text-2xl sm:text-3xl font-black">El mix con el que arrancás la temporada.</h2>
          <p className="text-black/55 text-sm mt-2 max-w-2xl">
            Cuatro modelos pensados para liderar el exhibidor renovado. Ningún cliente con Plan Canje activo se queda afuera de esta selección.
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mt-5">
            {MIX.map((m) => (
              <a key={m.nombre} href={catalogoUrl()} target="_blank" rel="noreferrer"
                className="rounded-xl border border-black/10 overflow-hidden bg-white hover:border-black/25 transition-colors no-underline text-inherit block">
                <div className="aspect-square bg-white">
                  <img src={m.foto} alt={m.nombre} loading="lazy" className="w-full h-full object-contain" />
                </div>
                <div className="px-2 pb-2.5 text-center">
                  <p className="text-[13px] font-black tracking-tight truncate">{m.nombre}</p>
                  <p className="text-[10px] text-black/45 mt-0.5">{m.tag}</p>
                </div>
              </a>
            ))}
          </div>
          <p className="text-center text-black/50 text-[13px] mt-4">
            Selección curada · Temporada 2026 — el mismo criterio de éxito que ya conocés, actualizado.
          </p>
        </div>

        {/* Todo lo que incluye */}
        <div className="mt-14 rounded-2xl p-7 sm:p-10 text-white relative overflow-hidden" style={{ background: '#0a0e1a' }}>
          <div className="absolute inset-x-0 top-0 h-0.5" style={{ background: AZUL }} />
          <p className="text-[11px] font-semibold tracking-[0.3em] uppercase mb-1" style={{ color: '#8fa6ff' }}>Todo lo que incluye</p>
          <h2 className="text-2xl sm:text-3xl font-black">Renovación total. Sin inversión extra.</h2>
          <ul className="grid sm:grid-cols-2 gap-x-6 gap-y-2.5 mt-6">
            {INCLUYE.map((x) => (
              <li key={x} className="flex gap-2 text-[13px] text-white/75 leading-relaxed"><span style={{ color: '#8fa6ff' }}>✓</span>{x}</li>
            ))}
          </ul>
        </div>

        {/* Activación + CTA */}
        <div className="mt-14 rounded-2xl border border-black/10 p-6 sm:p-8">
          <h2 className="text-2xl font-black">¿Activamos tu canje?</h2>
          <p className="text-black/55 text-sm mt-1">Tu vendedor ya tiene todo listo para armar tu pedido de temporada.</p>
          <ol className="mt-5 space-y-2.5">
            {ACTIVACION.map((p, i) => (
              <li key={p} className="flex gap-3 text-[13px] text-black/75">
                <span className="font-mono font-bold shrink-0" style={{ color: AZUL }}>{String(i + 1).padStart(2, '0')}</span>{p}
              </li>
            ))}
          </ol>
          <div className="flex flex-col sm:flex-row gap-3 mt-7">
            <a href={waLink('¡Hola! Quiero activar el Plan Canje para renovar el stock de mi óptica.')} target="_blank" rel="noreferrer"
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 transition-colors text-white font-bold px-6 py-3.5 no-underline">
              💬 Activá el Plan Canje
            </a>
            <BotonCatalogo texto="🕶️ Ver el mix de temporada" />
          </div>
        </div>

        <p className="text-center text-black/35 text-[11px] mt-10 pb-10">
          ORBITAL™ · Made in Argentina · Hablá con tu vendedor · @orbital.eyewear · orbitaleyewear.com.ar
        </p>
      </div>
    </div>
  )
}
