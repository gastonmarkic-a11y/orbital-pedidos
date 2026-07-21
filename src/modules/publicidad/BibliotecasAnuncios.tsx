interface Herramienta {
  nombre: string
  costo: 'Gratis' | 'Freemium' | 'Pago'
  plataformas: string
  profundidad: 'Baja' | 'Media' | 'Alta'
  mejorPara: string
  coberturaAr: string
  url: string
}

interface Competidor {
  nombre: string
  dominio: string | null
}

// Competidores directos de Orbital en el segmento premium/diseño de anteojos en Argentina
// (relevado por búsqueda web el 2026-07-21: Infinit, Vulk y Palo Santo son las marcas
// nacionales de diseño más mencionadas junto a Orbital; Hardem compite en el segmento
// de precio más accesible con fuerte presencia online).
const COMPETIDORES: Competidor[] = [
  { nombre: 'Infinit Eyewear', dominio: 'infiniteyewear.com' },
  { nombre: 'Vulk Eyewear', dominio: 'vulkeyewear.com' },
  { nombre: 'Hardem', dominio: 'hardem.com.ar' },
  { nombre: 'Palo Santo', dominio: 'palosantoargentina.com.ar' },
  { nombre: '360 Eyewear', dominio: null },
]

function metaAdLibraryUrl(nombre: string): string {
  return `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=AR&q=${encodeURIComponent(nombre)}&search_type=keyword_unordered`
}

function googleTransparencyUrl(dominio: string | null): string {
  return dominio
    ? `https://adstransparency.google.com/?region=AR&domain=${encodeURIComponent(dominio)}`
    : `https://adstransparency.google.com/?region=AR`
}

interface Relevamiento {
  marca: string
  hallazgo: string
  fuente: string
  url: string
}

// Relevado por búsqueda web el 2026-07-21 — no son creativos de anuncio (Meta/Google no
// se pueden scrapear desde acá, requieren sesión/JS), sino actividad pública verificable
// de marketing de competidores directos. Sirve como punto de partida; para ver los
// anuncios reales corriendo hoy, usá los links de "ver en vivo" de abajo.
const RELEVAMIENTO: Relevamiento[] = [
  {
    marca: 'Vulk Eyewear',
    hallazgo: 'Lanzamiento de colección con evento presencial en Buenos Aires — típico de marca que sostiene pauta activa alrededor del lanzamiento.',
    fuente: 'Infama',
    url: 'https://infama.com.ar/espectaculo/moda-hoby-de-fino-la-coleccion-2025-de-vulk-eyewear-se-lanzo-en-el-deseo-buenos-aires/',
  },
  {
    marca: 'Infinit Eyewear',
    hallazgo: 'Participando de Hot Sale 2026 con descuentos — señal de pauta de performance activa durante el evento.',
    fuente: 'Hot Sale Argentina',
    url: 'https://www.hotsale.com.ar/infinit-eyewear',
  },
  {
    marca: 'Hardem',
    hallazgo: 'Descuento permanente por transferencia + 3 cuotas sin interés en su sitio propio — estrategia de precio agresiva típica de quien pauta fuerte en Meta/Google performance.',
    fuente: 'hardem.com.ar',
    url: 'https://hardem.com.ar/',
  },
]

const HERRAMIENTAS: Herramienta[] = [
  {
    nombre: 'Meta Ad Library',
    costo: 'Gratis',
    plataformas: 'Facebook, Instagram',
    profundidad: 'Baja',
    mejorPara: 'Ver los creativos activos de cualquier competidor en FB/IG, sin límite de cuenta',
    coberturaAr: 'Completa — es la fuente oficial de Meta, no depende de muestreo',
    url: 'https://www.facebook.com/ads/library',
  },
  {
    nombre: 'Google Ads Transparency Center',
    costo: 'Gratis',
    plataformas: 'Search, Display, YouTube',
    profundidad: 'Baja',
    mejorPara: 'Ver qué anuncia un dominio en la red de Google, incluido YouTube',
    coberturaAr: 'Completa — fuente oficial de Google',
    url: 'https://adstransparency.google.com',
  },
  {
    nombre: 'TikTok Creative Center',
    costo: 'Gratis',
    plataformas: 'TikTok',
    profundidad: 'Media',
    mejorPara: 'Detectar tendencias de formato/sonido y los anuncios top por región',
    coberturaAr: 'Buena — tiene filtro específico por Argentina',
    url: 'https://ads.tiktok.com/business/creativecenter',
  },
  {
    nombre: 'Minea',
    costo: 'Pago',
    plataformas: 'Facebook, TikTok, tiendas Shopify',
    profundidad: 'Alta',
    mejorPara: 'Encontrar "productos ganadores" y estimar gasto/volumen de un anuncio puntual',
    coberturaAr: 'Parcial — más denso en mercados EN/BR, sirve pero con menos volumen para AR',
    url: 'https://minea.com',
  },
  {
    nombre: 'BigSpy',
    costo: 'Freemium',
    plataformas: 'Facebook, Instagram, TikTok, YouTube y más',
    profundidad: 'Alta',
    mejorPara: 'Espionaje multi-plataforma de un competidor puntual en un solo lugar',
    coberturaAr: 'Global — incluye Argentina, con menos densidad que EE.UU.',
    url: 'https://bigspy.com',
  },
  {
    nombre: 'SEMrush (Advertising Research)',
    costo: 'Pago',
    plataformas: 'Google Search Ads + SEO',
    profundidad: 'Alta',
    mejorPara: 'Estimar keywords y presupuesto de búsqueda pagada de la competencia',
    coberturaAr: 'Buena para dominios .com.ar de tráfico medio/alto',
    url: 'https://semrush.com',
  },
]

const COSTO_STYLE: Record<Herramienta['costo'], string> = {
  Gratis: 'bg-emerald-50 text-emerald-700',
  Freemium: 'bg-amber-50 text-amber-700',
  Pago: 'bg-black/5 text-muted',
}

export default function BibliotecasAnuncios() {
  return (
    <div className="space-y-2">
      <div>
        <h2 className="text-sm font-semibold">🔎 Bibliotecas de anuncios — referencia para Argentina</h2>
        <p className="text-[11px] text-muted mt-0.5">
          Para investigar qué está haciendo la competencia, no solo tu propia cuenta. Empezá siempre por las dos
          gratuitas y oficiales — cubren el 100% de lo que corre en Meta y Google.
        </p>
      </div>
      <div className="border border-black/10 rounded-xl overflow-x-auto bg-white">
        <table className="w-full text-sm">
          <thead className="bg-[#F1EDE4]">
            <tr>
              <th className="px-3 py-2 text-left font-semibold whitespace-nowrap">Herramienta</th>
              <th className="px-3 py-2 text-left font-semibold whitespace-nowrap">Costo</th>
              <th className="px-3 py-2 text-left font-semibold whitespace-nowrap">Plataformas</th>
              <th className="px-3 py-2 text-left font-semibold whitespace-nowrap">Profundidad</th>
              <th className="px-3 py-2 text-left font-semibold min-w-[220px]">Mejor para</th>
              <th className="px-3 py-2 text-left font-semibold min-w-[200px]">Cobertura en Argentina</th>
            </tr>
          </thead>
          <tbody>
            {HERRAMIENTAS.map((h) => (
              <tr key={h.nombre} className="border-t border-black/5 align-top hover:bg-[#F1EDE4]/50 transition-colors">
                <td className="px-3 py-2 font-medium whitespace-nowrap">
                  <a href={h.url} target="_blank" rel="noreferrer" className="hover:underline">
                    {h.nombre}
                  </a>
                </td>
                <td className="px-3 py-2">
                  <span className={`inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full ${COSTO_STYLE[h.costo]}`}>
                    {h.costo}
                  </span>
                </td>
                <td className="px-3 py-2 text-muted whitespace-nowrap">{h.plataformas}</td>
                <td className="px-3 py-2 text-muted">{h.profundidad}</td>
                <td className="px-3 py-2 text-muted">{h.mejorPara}</td>
                <td className="px-3 py-2 text-muted">{h.coberturaAr}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-faint">
        Para Orbital (B2C, gasto concentrado en Meta): revisá Meta Ad Library de tus 3-4 competidores directos una vez
        por semana. Sumá Google Ads Transparency Center si empezás a pautar Search. Las de pago (Minea, BigSpy,
        SEMrush) valen la pena recién cuando necesitás sistematizar la búsqueda de creativos ganadores fuera de tus
        competidores ya conocidos. Precios y cobertura cambian seguido — confirmá en el sitio de cada una antes de
        contratar.
      </p>

      {/* ---- Competidores: ver en vivo ---- */}
      <div className="pt-2">
        <h3 className="text-xs font-semibold text-muted uppercase tracking-wide">
          Competidores directos — ver anuncios en vivo
        </h3>
        <p className="text-[11px] text-faint mt-0.5 mb-2">
          No puedo traer los creativos de Meta/Google acá adentro (esas páginas requieren sesión y JS, no tienen API
          pública) — pero estos links ya vienen filtrados por marca, un clic y ves lo que están corriendo hoy.
        </p>
        <div className="border border-black/10 rounded-xl bg-white divide-y divide-black/5">
          {COMPETIDORES.map((c) => (
            <div key={c.nombre} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
              <span className="font-medium">{c.nombre}</span>
              <div className="flex gap-2 shrink-0">
                <a
                  href={metaAdLibraryUrl(c.nombre)}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[11px] font-medium px-2 py-1 rounded-lg border border-black/10 hover:bg-[#F1EDE4] transition-colors"
                >
                  Meta Ad Library
                </a>
                <a
                  href={googleTransparencyUrl(c.dominio)}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[11px] font-medium px-2 py-1 rounded-lg border border-black/10 hover:bg-[#F1EDE4] transition-colors"
                >
                  Google Transparency
                </a>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ---- Relevamiento reciente ---- */}
      <div className="pt-2">
        <h3 className="text-xs font-semibold text-muted uppercase tracking-wide">Relevamiento reciente (21/07/2026)</h3>
        <p className="text-[11px] text-faint mt-0.5 mb-2">
          Actividad pública real de estos competidores encontrada por búsqueda web — no son capturas de anuncios (eso
          lo ves con los links de arriba), son señales de que sostienen marketing activo ahora mismo.
        </p>
        <div className="space-y-1.5">
          {RELEVAMIENTO.map((r, i) => (
            <a
              key={i}
              href={r.url}
              target="_blank"
              rel="noreferrer"
              className="block border border-black/10 rounded-lg p-2.5 text-xs bg-white hover:bg-[#F1EDE4]/50 transition-colors"
            >
              <span className="font-semibold">{r.marca}</span>
              <span className="text-faint"> · fuente: {r.fuente}</span>
              <p className="text-muted mt-0.5">{r.hallazgo}</p>
            </a>
          ))}
        </div>
      </div>
    </div>
  )
}
