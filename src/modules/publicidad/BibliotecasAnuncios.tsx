interface Herramienta {
  nombre: string
  costo: 'Gratis' | 'Freemium' | 'Pago'
  plataformas: string
  profundidad: 'Baja' | 'Media' | 'Alta'
  mejorPara: string
  coberturaAr: string
  url: string
}

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
    </div>
  )
}
