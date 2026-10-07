// ── Marca: manual y kit de la marca para las ópticas, dentro del catálogo mayorista ──
// Manual (esencia, logo, paleta, tipografía, voz y reglas para publicar) + todo el material de
// orbitaleyewear.com.ar listo para bajar: logo, fotos de producto, en cara, estuche, campaña y videos.
// El índice lo arma scripts/marca-kit.mjs en public/marca/kit.json; los archivos vienen del CDN de la tienda.
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Download, Search, X, Check } from 'lucide-react'

type Kit = {
  actualizado: string
  logo: string
  videos: { src: string; poster: string | null }[]
  campana: string[]
  packaging: { standard: string[]; zaira: string[] }
  modelos: { modelo: string; handle: string; producto: string[]; cara: { src: string; quien: 'mujer' | 'hombre' }[]; estuche: string[]; lifestyle: string[] }[]
}
type Para = 'optica' | 'influencer'
type Solapa = 'manual' | 'logo' | 'fotos' | 'videos' | 'campana'
type TipoFoto = 'producto' | 'cara' | 'estuche'
type Foto = { src: string; modelo?: string; etiqueta?: string }

// Miniatura del CDN de Shopify (el original queda para la descarga)
const mini = (u: string, w = 480) => u + (u.includes('?') ? '&' : '?') + `width=${w}`
const nombreArchivo = (u: string) => decodeURIComponent(u.split('/').pop()!.split('?')[0])

async function descargar(url: string, nombre = nombreArchivo(url)) {
  try {
    const r = await fetch(url)
    const blob = await r.blob()
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob); a.download = nombre
    document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(a.href), 4000)
  } catch { window.open(url, '_blank', 'noopener') }
}

// Logo en blanco: se pinta el PNG negro de blanco conservando la transparencia
async function descargarLogoBlanco(url: string) {
  const img = new Image(); img.crossOrigin = 'anonymous'; img.src = url
  await img.decode()
  const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight
  const ctx = c.getContext('2d')!
  ctx.drawImage(img, 0, 0); ctx.globalCompositeOperation = 'source-in'; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height)
  c.toBlob((b) => {
    if (!b) return
    const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'ORBITAL_logo_blanco.png'; a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 4000)
  }, 'image/png')
}

const PALETA: { n: string; hex: string; uso: string; claro?: boolean }[] = [
  { n: 'Negro', hex: '#050505', uso: 'Base de la marca: logo, titulares, fondos' },
  { n: 'Marfil', hex: '#F2F0EA', uso: 'Fondo cálido, alternativa al blanco', claro: true },
  { n: 'Blanco', hex: '#FFFFFF', uso: 'Fondo de producto y logo sobre oscuro', claro: true },
  { n: 'Azul señal', hex: '#0004FF', uso: 'Acento: un botón o un dato por pieza, nunca de fondo' },
  { n: 'Grafito', hex: '#3A3D42', uso: 'Textos secundarios, fondos oscuros' },
  { n: 'Concreto', hex: '#B8B3AA', uso: 'Neutro para fondos y separadores', claro: true },
  { n: 'Arena', hex: '#D3C0A0', uso: 'Verano, sol, playa', claro: true },
  { n: 'Habano', hex: '#8A5B3A', uso: 'Acompaña los armazones carey y habano' },
  { n: 'Hielo', hex: '#A9D8F5', uso: 'Lentes espejados y celestes', claro: true },
  { n: 'Azul profundo', hex: '#0B1A3F', uso: 'Fondos nocturnos, Triple Protección' },
]

const TIPOS = [
  { f: 'Space Grotesk', uso: 'Títulos y textos. En mayúsculas para titulares.', css: "'Space Grotesk', Helvetica, Arial, sans-serif", ej: 'ENGINEERED IDENTITY.' },
  { f: 'IBM Plex Mono', uso: 'Datos técnicos, medidas, etiquetas chicas.', css: "'IBM Plex Mono', ui-monospace, monospace", ej: 'XYLON® / VSL™ · UV400' },
  { f: 'Fraunces', uso: 'Toque editorial: una frase, nunca un párrafo.', css: "Fraunces, Georgia, serif", ej: 'Desde Argentina para los ojos del mundo.' },
]

// Sin onClose va dentro de la página (panel de colaboradores); con onClose, como ventana (catálogo).
// "para" cambia las reglas de publicación: óptica (cierre al local) o influencer (su link, colaboración).
export default function MarcaKit({ onClose, para = 'optica' }: { onClose?: () => void; para?: Para }) {
  const [kit, setKit] = useState<Kit | null>(null)
  const [error, setError] = useState(false)
  const [solapa, setSolapa] = useState<Solapa>('manual')
  const [tipo, setTipo] = useState<TipoFoto>('producto')
  const [q, setQ] = useState('')
  const [cuantas, setCuantas] = useState(48)
  const [ver, setVer] = useState<Foto | null>(null)

  useEffect(() => {
    fetch('/marca/kit.json').then((r) => r.json()).then(setKit).catch(() => setError(true))
  }, [])
  useEffect(() => setCuantas(48), [tipo, q, solapa])

  const fotos = useMemo<Foto[]>(() => {
    if (!kit) return []
    if (tipo === 'estuche') return [
      ...kit.packaging.standard.map((src) => ({ src, etiqueta: 'Estuche Orbital' })),
      ...kit.packaging.zaira.map((src) => ({ src, etiqueta: 'Estuche Orbital x Zaira' })),
    ]
    const qn = q.trim().toUpperCase()
    return kit.modelos.filter((m) => !qn || m.modelo.includes(qn)).flatMap((m) =>
      tipo === 'cara'
        ? m.cara.map((c) => ({ src: c.src, modelo: m.modelo, etiqueta: `En cara · ${c.quien}` }))
        : m.producto.map((src) => ({ src, modelo: m.modelo })))
  }, [kit, tipo, q])

  const solapas: [Solapa, string][] = [['manual', 'Manual'], ['logo', 'Logo'], ['fotos', 'Fotos'], ['videos', 'Videos'], ['campana', 'Campaña']]

  return (
    <div className={onClose ? "fixed inset-0 z-40 flex items-end sm:items-center justify-center" : ""}>
      {onClose && <div className="absolute inset-0 bg-black/40" onClick={onClose} />}
      <div className={onClose ? "relative bg-white w-full sm:max-w-3xl sm:rounded-2xl rounded-t-2xl max-h-[94vh] flex flex-col" : "bg-white rounded-xl border border-black/10"}>
        <div className="px-4 pt-3 pb-2 border-b border-black/5">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold tracking-[0.12em]">Marca ORBITAL®</h2>
              <p className="text-[11px] text-neutral-500 font-sans">{para === 'influencer' ? 'Manual, logo, fotos y videos oficiales para tu contenido.' : 'Manual, logo, fotos y videos oficiales para tus redes y tu vidriera.'}</p>
            </div>
            {onClose && <button onClick={onClose} className="p-1.5 rounded-full hover:bg-black/5"><X size={20} /></button>}
          </div>
          <div className="flex gap-1 mt-2 overflow-x-auto [scrollbar-width:none]">
            {solapas.map(([k, l]) => (
              <button key={k} onClick={() => setSolapa(k)}
                className={`whitespace-nowrap text-[11px] font-semibold uppercase tracking-wide px-3 py-1.5 rounded-full border ${solapa === k ? 'bg-[#0a0a0a] text-white border-transparent' : 'bg-white border-black/10 text-neutral-600'}`}>{l}</button>
            ))}
          </div>
          {solapa === 'fotos' && (
            <div className="flex flex-wrap items-center gap-2 mt-2">
              <div className="flex rounded-full border border-black/10 p-0.5">
                {([['producto', 'Producto'], ['cara', 'En cara'], ['estuche', 'Estuche']] as const).map(([k, l]) => (
                  <button key={k} onClick={() => setTipo(k)}
                    className={`text-[11px] font-semibold px-3 py-1 rounded-full ${tipo === k ? 'bg-[#0004FF] text-white' : 'text-neutral-600'}`}>{l}</button>
                ))}
              </div>
              {tipo !== 'estuche' && (
                <div className="relative flex-1 min-w-[160px]">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
                  <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar modelo…"
                    className="w-full rounded-full bg-[#F5F5F7] border border-black/10 pl-8 pr-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0004FF]/30" />
                </div>
              )}
            </div>
          )}
        </div>

        <div className={`${onClose ? 'overflow-y-auto ' : ''}p-4 font-sans`}>
          {error && <p className="text-sm text-neutral-500 text-center py-10">No pudimos cargar el kit de marca. Probá de nuevo en un rato.</p>}
          {!kit && !error && <p className="text-sm text-neutral-400 text-center py-10">Cargando…</p>}
          {kit && solapa === 'manual' && <Manual kit={kit} ir={setSolapa} para={para} />}
          {kit && solapa === 'logo' && <Logo kit={kit} />}
          {kit && solapa === 'fotos' && (
            <>
              <p className="text-[11px] text-neutral-500 mb-2">
                {fotos.length} fotos · {tipo === 'cara' ? 'el mismo anteojo puesto, en mujer y en hombre' : tipo === 'estuche' ? 'lo que recibe tu cliente con cada anteojo' : 'fondo de tienda, listas para posteo y catálogo'}
              </p>
              <Grilla fotos={fotos.slice(0, cuantas)} onVer={setVer} vertical={tipo === 'cara'} />
              {fotos.length > cuantas && (
                <button onClick={() => setCuantas((n) => n + 48)} className="w-full mt-3 text-[12px] font-semibold text-[#0004FF] py-2 border border-[#0004FF]/20 rounded-full">Ver más ({fotos.length - cuantas})</button>
              )}
              {!fotos.length && <p className="text-sm text-neutral-400 text-center py-8">Sin fotos para ese modelo.</p>}
            </>
          )}
          {kit && solapa === 'videos' && (
            <div className="grid sm:grid-cols-3 gap-3">
              {kit.videos.map((v, i) => <Video key={v.src} v={v} n={i + 1} />)}
              <p className="sm:col-span-3 text-[11px] text-neutral-500">Videos de campaña de la tienda, en 1080p. Subilos sin cortar el cierre con el logo y sin música encima de la original.</p>
            </div>
          )}
          {kit && solapa === 'campana' && (
            <>
              <p className="text-[11px] text-neutral-500 mb-2">Banners y fotos de la temporada 26·27 que usa la tienda. Para vidriera, pantalla del local o historias.</p>
              <Grilla fotos={[...kit.campana, ...kit.modelos.flatMap((m) => m.lifestyle)].map((src) => ({ src }))} onVer={setVer} />
            </>
          )}
        </div>
      </div>
      {ver && <Visor foto={ver} onClose={() => setVer(null)} />}
    </div>
  )
}

// El formato sale del propio video: vertical para historias y reels, horizontal para la pantalla del local
function Video({ v, n }: { v: Kit['videos'][number]; n: number }) {
  const [horizontal, setHorizontal] = useState<boolean | null>(null)
  return (
    <div className="rounded-xl border border-black/10 overflow-hidden flex flex-col">
      <video src={v.src} poster={v.poster ?? undefined} controls muted playsInline preload="metadata"
        onLoadedMetadata={(e) => setHorizontal(e.currentTarget.videoWidth > e.currentTarget.videoHeight)}
        className="w-full aspect-[9/16] object-contain bg-black" />
      <p className="text-[10px] font-mono text-neutral-500 text-center pt-1.5">
        {horizontal === null ? '·' : horizontal ? 'Horizontal 16:9 · pantalla del local, YouTube' : 'Vertical 9:16 · historias y reels'}
      </p>
      <button onClick={() => descargar(v.src, `ORBITAL_video_${n}.mp4`)}
        className="w-full flex items-center justify-center gap-1.5 text-[12px] font-semibold py-2 hover:bg-black/5"><Download size={14} /> Descargar video {n}</button>
    </div>
  )
}

function Grilla({ fotos, onVer, vertical }: { fotos: Foto[]; onVer: (f: Foto) => void; vertical?: boolean }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
      {fotos.map((f) => (
        <button key={f.src} onClick={() => onVer(f)} className="group rounded-lg border border-black/10 overflow-hidden text-left bg-[#F2F2F2]">
          <img src={mini(f.src)} alt={f.modelo ?? ''} loading="lazy" className={`w-full ${vertical ? 'aspect-[4/5]' : 'aspect-square'} object-cover group-hover:scale-[1.02] transition`} />
          {(f.modelo || f.etiqueta) && (
            <div className="bg-white px-2 py-1">
              {f.modelo && <p className="text-[10px] font-bold truncate">{f.modelo}</p>}
              {f.etiqueta && <p className="text-[9px] text-neutral-500 truncate">{f.etiqueta}</p>}
            </div>
          )}
        </button>
      ))}
    </div>
  )
}

function Visor({ foto, onClose }: { foto: Foto; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/85 flex flex-col items-center justify-center p-4" onClick={onClose}>
      <img src={mini(foto.src, 1400)} alt={foto.modelo ?? ''} className="max-h-[78vh] max-w-full object-contain" onClick={(e) => e.stopPropagation()} />
      <div className="flex items-center gap-2 mt-3" onClick={(e) => e.stopPropagation()}>
        <span className="text-white/80 text-[12px] mr-2">{[foto.modelo, foto.etiqueta].filter(Boolean).join(' · ')}</span>
        <button onClick={() => descargar(foto.src)} className="flex items-center gap-1.5 bg-white text-black text-[12px] font-semibold rounded-full px-4 py-2"><Download size={14} /> Descargar original</button>
        <button onClick={onClose} className="text-white/80 p-2"><X size={20} /></button>
      </div>
    </div>
  )
}

function Bloque({ n, titulo, children }: { n: string; titulo: string; children: ReactNode }) {
  return (
    <section className="py-5 border-b border-black/10 last:border-0">
      <p className="font-mono text-[10px] text-neutral-400 tracking-widest">{n}</p>
      <h3 className="text-[15px] font-bold tracking-wide mb-2">{titulo}</h3>
      <div className="text-[13px] text-neutral-700 leading-relaxed space-y-2">{children}</div>
    </section>
  )
}

function SiNo({ si, no }: { si: string[]; no: string[] }) {
  return (
    <div className="grid sm:grid-cols-2 gap-2">
      <ul className="rounded-lg bg-emerald-50 border border-emerald-200 p-3 space-y-1">
        {si.map((t) => <li key={t} className="flex gap-1.5 text-[12px]"><Check size={14} className="text-emerald-600 shrink-0 mt-0.5" />{t}</li>)}
      </ul>
      <ul className="rounded-lg bg-red-50 border border-red-200 p-3 space-y-1">
        {no.map((t) => <li key={t} className="flex gap-1.5 text-[12px]"><X size={14} className="text-red-600 shrink-0 mt-0.5" />{t}</li>)}
      </ul>
    </div>
  )
}

function Manual({ kit, ir, para }: { kit: Kit; ir: (s: Solapa) => void; para: Para }) {
  const [copiado, setCopiado] = useState<string | null>(null)
  const copiar = (t: string) => { navigator.clipboard?.writeText(t); setCopiado(t); setTimeout(() => setCopiado(null), 1200) }
  return (
    <div>
      <div className="rounded-xl bg-[#050505] text-[#F2F0EA] p-6 text-center">
        <img src={kit.logo} alt="ORBITAL" className="h-16 mx-auto invert" />
        <p className="font-mono text-[10px] tracking-[0.3em] mt-3 opacity-70">ARGENTINA · EST. 1996</p>
        <p className="text-2xl font-bold tracking-tight mt-4">TAKE A LOOK.</p>
      </div>

      <Bloque n="01" titulo="Quiénes somos">
        <p>ORBITAL® fabrica anteojos en Argentina desde 1996, con fábrica propia en Buenos Aires y diseño entre Argentina y Estados Unidos. Material de base biológica Xylon® y acero inoxidable, trabajados a mano, con lentes VSL™ que cumplen estándares europeos y de la FDA.</p>
        <p className="font-semibold">Lo que siempre se puede decir:</p>
        <ul className="list-disc pl-5 space-y-0.5">
          <li>Hechos en Argentina desde 1996.</li>
          <li>Xylon®: material de base biológica, liviano y resistente.</li>
          <li>Lentes VSL™ con protección UV400 y gestión de luz azul.</li>
          <li>Triple Protección: UV400 + luz azul 420 nm + infrarrojo IR-A, en un mismo cristal (solo en los modelos que la tienen).</li>
        </ul>
      </Bloque>

      <Bloque n="02" titulo="Logo">
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-lg border border-black/10 bg-white h-24 flex items-center justify-center"><img src={kit.logo} alt="" className="h-14" /></div>
          <div className="rounded-lg bg-[#050505] h-24 flex items-center justify-center"><img src={kit.logo} alt="" className="h-14 invert" /></div>
        </div>
        <SiNo
          si={['Negro sobre fondos claros, blanco sobre oscuros o fotos', 'Aire alrededor igual a la altura de la “O”', 'Mínimo 80 px de ancho en pantalla, 20 mm impreso', 'Siempre con el ™ del archivo original']}
          no={['Estirarlo, inclinarlo o rotarlo', 'Cambiarle el color (ni azul, ni dorado, ni degradé)', 'Sombras, contornos o efectos', 'Reescribirlo con otra tipografía', 'Ponerlo sobre una zona de la foto con poco contraste',
            para === 'influencer' ? 'Usarlo en tu foto de perfil o como si fuera tu marca' : 'Usarlo como si fuera el logo de tu óptica']} />
        {para === 'influencer'
          ? <p><b>Con tu nombre:</b> el contenido es tuyo y ORBITAL acompaña. Para una colaboración, “<i>Tu nombre</i> × ORBITAL” con los dos del mismo tamaño; en el resto, alcanza con etiquetar @orbital.eyewear.</p>
          : <p><b>Con tu óptica:</b> tu logo manda y ORBITAL acompaña. Firmá “Disponible en <i>tu óptica</i>” o “<i>Tu óptica</i> · ORBITAL®”, con una línea fina entre los dos logos y ORBITAL más chico o igual al tuyo.</p>}
        <button onClick={() => ir('logo')} className="text-[12px] font-semibold text-[#0004FF]">Descargar el logo →</button>
      </Bloque>

      <Bloque n="03" titulo="Cómo se escribe">
        <ul className="list-disc pl-5 space-y-0.5">
          <li><b>ORBITAL</b> en mayúsculas en titulares y piezas; <b>Orbital</b> en texto corrido. El ® va la primera vez.</li>
          <li>Los modelos, siempre en mayúsculas y como figuran: ASCARI, ADELAIDA, 5th AVENUE, BUENOS AIRES.</li>
          <li>Las tecnologías con su marca: <span className="font-mono">Xylon®</span>, <span className="font-mono">VSL™</span>, <span className="font-mono">UV400</span>.</li>
          <li>Redes: <a href="https://www.instagram.com/orbital.eyewear/" target="_blank" rel="noreferrer" className="text-[#0004FF]">@orbital.eyewear</a> · <span className="font-mono">#OrbitalEyewear #HechoEnArgentina</span></li>
        </ul>
      </Bloque>

      <Bloque n="04" titulo="Paleta">
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          {PALETA.map((c) => (
            <button key={c.hex} onClick={() => copiar(c.hex)} className="rounded-lg border border-black/10 overflow-hidden text-left">
              <div className={`h-14 flex items-end p-1.5 ${c.claro ? 'text-black' : 'text-white'}`} style={{ background: c.hex }}>
                <span className="font-mono text-[10px]">{copiado === c.hex ? 'Copiado' : c.hex}</span>
              </div>
              <div className="p-1.5"><p className="text-[11px] font-bold">{c.n}</p><p className="text-[10px] text-neutral-500 leading-tight">{c.uso}</p></div>
            </button>
          ))}
        </div>
        <p className="text-[12px] text-neutral-500">Blanco y negro son la marca; el azul señal es un acento. Los otros tonos acompañan la foto, no compiten con ella.</p>
      </Bloque>

      <Bloque n="05" titulo="Tipografía">
        {TIPOS.map((t) => (
          <div key={t.f} className="rounded-lg border border-black/10 p-3">
            <p className="text-lg" style={{ fontFamily: t.css }}>{t.ej}</p>
            <p className="text-[11px] text-neutral-500 mt-1"><b>{t.f}</b> · {t.uso}</p>
          </div>
        ))}
        <p className="text-[12px] text-neutral-500">Las tres son gratis en <a href="https://fonts.google.com" target="_blank" rel="noreferrer" className="text-[#0004FF]">Google Fonts</a>. En Canva o Instagram, si no están, usá una sans de palo seco (Helvetica, Inter) en mayúsculas.</p>
      </Bloque>

      <Bloque n="06" titulo="Voz">
        <p>Frases cortas y afirmativas. Hablamos de vos, sin exagerar ni gritar. Primero cómo se siente y se ve; después el dato técnico.</p>
        <div className="grid sm:grid-cols-3 gap-2">
          {['El negro no es un color. Es una decisión.', '9 gramos. Más libertad.', 'Nuevas geometrías. Nuevos materiales.'].map((f) => (
            <p key={f} className="rounded-lg bg-[#F2F0EA] p-3 text-[13px] font-semibold">“{f}”</p>
          ))}
        </div>
        <SiNo si={['Signos de exclamación y emojis con moderación', 'Un dato técnico por pieza, bien dicho']} no={['“Los mejores anteojos del mundo”, “calidad premium”', 'Prometer lo que el modelo no tiene (polarizado, receta, Triple Protección)']} />
      </Bloque>

      <Bloque n="07" titulo="Fotos y video">
        <SiNo
          si={['Usá las fotos como vienen: el color del armazón y del cristal es el real', 'Recortes: 1:1 feed, 4:5 posteo, 9:16 historias y reels', 'Combiná producto + en cara del mismo modelo',
            para === 'influencer' ? 'Lo que más funciona: vos con el anteojo puesto, con luz natural' : 'Tus fotos en el local suman: con buena luz y el anteojo limpio']}
          no={['Filtros que cambien el color del lente o del armazón', 'Recortar la patilla o el logo del anteojo', 'Fotos de otras marcas mezcladas en la misma pieza', 'Pegar texto encima de la cara o del anteojo']} />
        <div className="flex flex-wrap gap-2">
          <button onClick={() => ir('fotos')} className="text-[12px] font-semibold text-[#0004FF]">Fotos por modelo →</button>
          <button onClick={() => ir('videos')} className="text-[12px] font-semibold text-[#0004FF]">Videos →</button>
          <button onClick={() => ir('campana')} className="text-[12px] font-semibold text-[#0004FF]">Campaña →</button>
        </div>
      </Bloque>

      {para === 'influencer' ? (
        <Bloque n="08" titulo="Para publicar como colaborador">
          <ul className="list-disc pl-5 space-y-0.5">
            <li>Siempre con <b>tu link o tu código</b>: así cada venta queda a tu nombre.</li>
            <li>Marcá la publicación como colaboración (“Colaboración pagada” en Instagram, “Contenido de marca” en TikTok) y etiquetá <b>@orbital.eyewear</b>.</li>
            <li>Los únicos descuentos que se comunican son los de tu código: no inventes promos ni cuotas.</li>
            <li>Contá lo que vos viviste con el anteojo; los datos técnicos, tal cual figuran en <b>Anteojos</b>.</li>
          </ul>
        </Bloque>
      ) : (
        <Bloque n="08" titulo="Para publicar desde tu óptica">
          <ul className="list-disc pl-5 space-y-0.5">
            <li>El cierre siempre lleva a tu local: “Vení a probártelo”, tu dirección o tu WhatsApp.</li>
            <li>No publiques precios, links, cupones ni promos de la tienda online de Orbital: son de otro canal.</li>
            <li>Etiquetá <b>@orbital.eyewear</b>: lo que publiques puede salir en nuestras historias.</li>
            <li>¿Querés el texto armado? En <b>Crear contenido</b> elegís el modelo y te damos historia, posteo y guion.</li>
          </ul>
        </Bloque>
      )}
      <p className="font-mono text-[10px] text-neutral-400 pt-2">Material de orbitaleyewear.com.ar · actualizado {kit.actualizado}</p>
    </div>
  )
}

function Logo({ kit }: { kit: Kit }) {
  return (
    <div className="space-y-3">
      <div className="grid sm:grid-cols-2 gap-3">
        <div className="rounded-xl border border-black/10">
          <div className="h-40 flex items-center justify-center bg-white"><img src={kit.logo} alt="ORBITAL negro" className="h-24" /></div>
          <button onClick={() => descargar(kit.logo, 'ORBITAL_logo_negro.png')} className="w-full flex items-center justify-center gap-1.5 text-[12px] font-semibold py-2.5 border-t border-black/10 hover:bg-black/5"><Download size={14} /> Negro · PNG</button>
        </div>
        <div className="rounded-xl border border-black/10 overflow-hidden">
          <div className="h-40 flex items-center justify-center bg-[#050505]"><img src={kit.logo} alt="ORBITAL blanco" className="h-24 invert" /></div>
          <button onClick={() => descargarLogoBlanco(kit.logo)} className="w-full flex items-center justify-center gap-1.5 text-[12px] font-semibold py-2.5 hover:bg-black/5"><Download size={14} /> Blanco · PNG</button>
        </div>
      </div>
      <p className="text-[12px] text-neutral-500">PNG con fondo transparente, en alta. Negro para fondos claros, blanco para fondos oscuros y fotos. Las reglas de uso están en <b>Manual → Logo</b>.</p>
    </div>
  )
}
