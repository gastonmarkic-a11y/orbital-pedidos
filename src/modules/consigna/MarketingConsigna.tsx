// ── Marketing y redes para el cliente de consigna ───────────────────────────
// Lo mismo que tienen las ópticas en su catálogo (Inspiración, Crear contenido, Mis publicaciones,
// Postventa) más Triple Protección e IRIS. Cada acceso de consigna tiene su propio link de catálogo
// (consigna_acceso.catalogo) y el catálogo abre directo en la sección con ?ver=.
import { Sparkles, PenLine, Megaphone, Wrench, ShieldCheck, MessageCircle } from 'lucide-react'
import type { Central } from './CentralConsigna'

type Tarjeta = { ver: string | null; titulo: string; texto: string; icono: typeof Sparkles; tono: string; boton: string; accion?: () => void }

export default function MarketingConsigna({ data, onVista }: { data: Central; onVista: (v: 'postventa' | 'consultas') => void }) {
  const cat = data.acceso.catalogo
  const url = (ver: string) => `/catalogo?k=${cat}&ver=${ver}`
  const tarjetas: Tarjeta[] = [
    { ver: 'inspiracion', titulo: 'Inspiración', icono: Sparkles, tono: 'from-fuchsia-600 via-pink-500 to-orange-400 text-white', boton: 'Ver inspiración',
      texto: 'Las publicaciones virales de anteojos en TikTok e Instagram, con sus números, por qué funcionaron y cómo hacerlo con un Orbital.' },
    { ver: 'contenido', titulo: 'Crear contenido', icono: PenLine, tono: 'from-white to-white text-ink border border-fuchsia-300', boton: 'Crear contenido',
      texto: 'Elegí un anteojo y copiá la historia, el posteo o el guion de video listos, con la ficha técnica y la foto.' },
    { ver: 'publicaciones', titulo: 'Influencers y publicaciones', icono: Megaphone, tono: 'from-white to-white text-ink border border-black/10', boton: 'Mandar publicación',
      texto: 'Pegá el link de lo que publicaron ustedes o un influencer con Orbital: Orbital lo comparte en sus redes con la tienda.' },
    { ver: null, titulo: 'Triple Protección', icono: ShieldCheck, tono: 'from-[#8A6420] to-[#8A6420] text-white', boton: 'Contenido de Triple',
      texto: 'Infrarrojo, UV400 y Blue Cut en un mismo cristal. En Inspiración hay una solapa con contenido listo para explicarlo.' },
    { ver: null, titulo: 'Postventa directa', icono: Wrench, tono: 'from-white to-white text-ink border border-black/10', boton: 'Ir a postventa', accion: () => onVista('postventa'),
      texto: 'Garantía, rotura o repuesto con fotos. Llega directo a Orbital y la charla queda en la misma pantalla.' },
    { ver: null, titulo: 'IRIS → sus tiendas', icono: MessageCircle, tono: 'from-ink to-ink text-white', boton: 'Ver consultas', accion: () => onVista('consultas'),
      texto: 'Quien le pregunta a Orbital por un anteojo y está cerca, llega a la tienda que lo tiene en stock. La consulta aparece acá.' },
  ]
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted max-w-3xl">
        Todo lo que Orbital pone a disposición para vender más en las tiendas: contenido para redes, influencers, postventa y la demanda que manda IRIS.
      </p>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {tarjetas.map((t) => {
          const Icono = t.icono
          const href = t.ver ? url(t.ver) : t.titulo === 'Triple Protección' ? url('triple') : null
          return (
            <section key={t.titulo} className={`rounded-xl px-4 py-4 flex flex-col gap-3 bg-gradient-to-br ${t.tono}`}>
              <div className="flex items-center gap-2">
                <Icono size={18} />
                <h3 className="font-semibold">{t.titulo}</h3>
              </div>
              <p className="text-sm opacity-85 flex-1">{t.texto}</p>
              {t.accion
                ? <button onClick={t.accion} className="self-start text-xs font-semibold rounded-lg px-3 py-1.5 bg-black/10 hover:bg-black/20">{t.boton} →</button>
                : href && cat
                  ? <a href={href} target="_blank" rel="noreferrer" className="self-start text-xs font-semibold rounded-lg px-3 py-1.5 bg-black/10 hover:bg-black/20">{t.boton} →</a>
                  : <span className="text-[11px] opacity-70">Se habilita con el link de catálogo de la tienda.</span>}
            </section>
          )
        })}
      </div>
    </div>
  )
}
