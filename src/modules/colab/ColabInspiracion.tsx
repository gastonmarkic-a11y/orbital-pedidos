// ── Inspiración · referencias de TikTok e Instagram para los colaboradores ─────
// Solo referencia de formato: se muestra el link a la publicación original, nada se copia.
// Tres secciones: Virales · Triple protección (con el link a la landing) · Lentes de color.
// Cada tarjeta trae los datos reales de la publicación, de qué se trata y por qué es viral.
// Lo llena colab-inspiracion-sync todos los días; Orbital puede buscar al momento.
// optica: la misma pestaña dentro del catálogo mayorista (clave o token), con los textos
// pensados para la óptica y los modelos que salen del propio catálogo.
import { useEffect, useMemo, useState } from 'react'
import { ExternalLink, RefreshCw, AlertTriangle } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { ACENTO, Rol } from './colabUtil'

type Seccion = 'viral' | 'triple' | 'color'
type Item = {
  id: number; seccion: Seccion; fuente: 'tiktok' | 'instagram'; url: string; autor: string | null; texto: string | null
  vistas: number | null; likes: number | null; comentarios: number | null; compartidos: number | null; guardados: number | null
  duracion_seg: number | null; seguidores: number | null; audio: string | null; hashtags: string[] | null
  publicado_at: string | null
  formato: string | null; de_que_trata: string | null; por_que: string | null; como_orbital: string | null; aviso: string | null
  fijo: boolean; created_at: string
}
type Datos = { items: Item[]; modelos_color: string[]; modelos_triple?: string[] }
const ROJO_TRIPLE = '#E11D2E'
// Video que explica la Triple Protección (se muestra en el kit cuando está cargado)
const VIDEO_TRIPLE: string | null = null
// Presentación completa de Blue Cut + Infrarrojo (Drive de Orbital)
const PDF_TRIPLE = 'https://drive.google.com/file/d/1UK0wi3Z_HuB60bFMFtmAckWZCg6ujG4T/view'

export const LANDING_TRIPLE = 'https://ver.orbitaleyewear.com.ar/tripleproteccion'

const SECCIONES: [Seccion, string][] = [['viral', 'Virales'], ['triple', 'Triple protección'], ['color', 'Lentes de color']]
const RED = { tiktok: { t: 'TikTok', c: '#111827' }, instagram: { t: 'Instagram', c: '#c13584' } }

const hace = (iso: string) => {
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
  return d <= 0 ? 'hoy' : d === 1 ? 'ayer' : `hace ${d} días`
}
// 1.234.567 → "1,2 M" · 45.300 → "45 mil"
const corto = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toLocaleString('es-AR', { maximumFractionDigits: 1 })} M`
    : n >= 10_000 ? `${Math.round(n / 1000).toLocaleString('es-AR')} mil`
    : n.toLocaleString('es-AR')
const duracion = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`

export default function ColabInspiracion({ clave, rol, onVerTriple, optica, modelosTriple, modelosColor, onModelo }: {
  clave: string; rol?: Rol; onVerTriple?: () => void
  optica?: boolean; modelosTriple?: string[]; modelosColor?: string[]; onModelo?: (m: string) => void
}) {
  const [datos, setDatos] = useState<Datos | null>(null)
  const [sec, setSec] = useState<Seccion>('viral')
  const [buscando, setBuscando] = useState(false)
  const [aviso, setAviso] = useState<string | null>(null)

  const cargar = () => optica
    ? supabase.rpc('catalogo_inspiracion', { p_clave: clave })
      .then(({ data }) => setDatos({ items: (data as Item[] | null) ?? [], modelos_color: [] }))
    : supabase.rpc('colab_inspiracion_lista', { p_clave: clave })
      .then(({ data }) => setDatos((data as Datos | null) ?? { items: [], modelos_color: [] }))
  useEffect(() => { cargar() }, [clave])
  const mTriple = optica ? modelosTriple ?? [] : datos?.modelos_triple ?? []
  const mColor = optica ? modelosColor ?? [] : datos?.modelos_color ?? []

  async function buscarAhora() {
    setBuscando(true); setAviso(null)
    const { data, error } = await supabase.functions.invoke('colab-inspiracion-sync', { body: { clave } })
    const r = data as { nuevos?: number; error?: string } | null
    setBuscando(false)
    if (r?.error === 'falta_token') setAviso('Falta cargar la clave de Apify (APIFY_TOKEN) en Supabase.')
    else if (error || r?.error) setAviso('No se pudo buscar ahora. Probá de nuevo en un rato.')
    else setAviso(`Listo: ${r?.nuevos ?? 0} publicaciones nuevas.`)
    cargar()
  }

  const items = useMemo(() => (datos?.items ?? []).filter((i) => i.seccion === sec), [datos, sec])

  if (!datos) return <p className="text-sm text-neutral-500 py-16 text-center">Cargando inspiración…</p>

  return (
    <>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-[15px] font-bold tracking-wide uppercase">{optica ? 'Conocé más' : 'Inspiración'}</h1>
          <p className="text-[11px] text-neutral-500 mt-1">
            {optica
              ? <>Lo que está funcionando en TikTok e Instagram con anteojos, y todo sobre la <b>Triple Protección</b>. Te sirve para saber qué van a buscar tus clientes y para armar el contenido de tu óptica.</>
              : <>Publicaciones que están funcionando en TikTok e Instagram. Son <b>referencias de formato</b>: mirá el original y hacé tu versión con Orbital, no copies el video.</>}
          </p>
        </div>
        {rol === 'orbital' && (
          <button onClick={buscarAhora} disabled={buscando}
            className="shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-black/10 px-2.5 py-1.5 text-[11px] font-semibold disabled:opacity-50">
            <RefreshCw size={12} className={buscando ? 'animate-spin' : ''} /> {buscando ? 'Buscando…' : 'Buscar ahora'}
          </button>
        )}
      </div>
      {aviso && <p className="mb-3 text-[11px] text-neutral-600">{aviso}</p>}

      <div className="flex flex-wrap gap-2 mb-4">
        {SECCIONES.map(([id, t]) => {
          // Triple protección va en rojo: es lo que Orbital más quiere que se promocione
          const color = id === 'triple' ? ROJO_TRIPLE : ACENTO
          return (
            <button key={id} onClick={() => setSec(id)}
              className={`rounded-full px-3 py-1.5 text-[11px] font-semibold border ${sec === id ? 'text-white border-transparent' : id === 'triple' ? 'text-white border-transparent' : 'bg-white border-black/10'}`}
              style={sec === id || id === 'triple' ? { background: color, opacity: sec === id || id !== 'triple' ? 1 : 0.85 } : undefined}>
              {t} <span className="opacity-70">{(datos.items ?? []).filter((i) => i.seccion === id).length}</span>
            </button>
          )
        })}
      </div>

      {sec === 'triple' && <KitTriple modelos={mTriple} onVer={onVerTriple} optica={optica} onModelo={onModelo} />}
      {sec === 'color' && <KitColor modelos={mColor} onModelo={onModelo} />}

      {items.length === 0
        ? <p className="text-sm text-neutral-500 py-10 text-center">Todavía no hay publicaciones en esta sección. Se suman solas cada día.</p>
        : (
          <div className="grid gap-3 sm:grid-cols-2">
            {items.map((i) => <Tarjeta key={i.id} i={i} />)}
          </div>
        )}

      <p className="text-[10px] text-neutral-400 mt-4 leading-relaxed">
        Usá la música de la biblioteca de cada red y aclará que es publicidad (#publi o "Colaboración pagada").
        No descargues ni vuelvas a subir videos de otras personas.
      </p>
    </>
  )
}

function Tarjeta({ i }: { i: Item }) {
  const red = RED[i.fuente]
  const pos = (n: number | null) => (n != null && n > 0 ? n : null)
  const vistas = pos(i.vistas)
  const interaccion = vistas
    ? ([i.likes, i.comentarios, i.compartidos, i.guardados].reduce<number>((s, v) => s + (pos(v) ?? 0), 0) / vistas) * 100
    : null
  const alcance = vistas && pos(i.seguidores) ? vistas / (i.seguidores as number) : null

  const datos: [string, string][] = []
  if (vistas) datos.push(['Vistas', corto(vistas)])
  if (pos(i.likes)) datos.push(['Me gusta', corto(i.likes as number)])
  if (pos(i.comentarios)) datos.push(['Comentarios', corto(i.comentarios as number)])
  if (pos(i.compartidos)) datos.push(['Compartidos', corto(i.compartidos as number)])
  if (pos(i.guardados)) datos.push(['Guardados', corto(i.guardados as number)])
  if (interaccion) datos.push(['Interacción', `${interaccion.toLocaleString('es-AR', { maximumFractionDigits: 1 })}%`])
  if (pos(i.duracion_seg)) datos.push(['Duración', duracion(i.duracion_seg as number)])
  if (pos(i.seguidores)) datos.push(['Seguidores del autor', corto(i.seguidores as number)])
  if (alcance) datos.push(['Vistas / seguidores', `${alcance.toLocaleString('es-AR', { maximumFractionDigits: alcance < 10 ? 1 : 0 })}×`])
  if (i.publicado_at) datos.push(['Publicado', new Date(i.publicado_at).toLocaleDateString('es-AR')])

  return (
    <div className="bg-white rounded-xl border border-black/10 p-3 flex flex-col gap-2">
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="rounded-full px-1.5 py-0.5 text-[9px] font-bold text-white" style={{ background: red.c }}>{red.t}</span>
        {i.formato && <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ background: '#EBEBFF', color: ACENTO }}>{i.formato}</span>}
        <span className="ml-auto text-[10px] text-neutral-400">{i.fijo ? 'Clásico' : hace(i.created_at)}</span>
      </div>

      <div>
        <div className="text-[12px] font-bold">@{(i.autor ?? '').replace(/^@/, '') || 'publicación'}</div>
        {i.texto && <p className="text-[11px] text-neutral-500 line-clamp-2">{i.texto}</p>}
      </div>

      {i.de_que_trata && (
        <div className="rounded-lg bg-[#F5F5F7] px-2.5 py-2">
          <div className="text-[9px] uppercase tracking-wide text-neutral-400 font-bold">De qué se trata</div>
          <p className="text-[11px] text-neutral-800 mt-0.5">{i.de_que_trata}</p>
        </div>
      )}

      {datos.length > 0 && (
        <div className="grid grid-cols-3 gap-x-2 gap-y-1.5 border-y border-black/5 py-2">
          {datos.map(([k, v]) => (
            <div key={k} className="min-w-0">
              <div className="text-[9px] uppercase tracking-wide text-neutral-400 truncate">{k}</div>
              <div className="text-[12px] font-bold tabular-nums">{v}</div>
            </div>
          ))}
        </div>
      )}
      {(i.audio || (i.hashtags?.length ?? 0) > 0) && (
        <div className="text-[10px] text-neutral-500 space-y-1">
          {i.audio && <div><b className="text-neutral-700">Audio:</b> {i.audio}</div>}
          {(i.hashtags?.length ?? 0) > 0 && (
            <div className="flex flex-wrap gap-1">
              {(i.hashtags ?? []).slice(0, 8).map((h) => <span key={h} className="rounded bg-[#F5F5F7] px-1.5 py-0.5">#{h}</span>)}
            </div>
          )}
        </div>
      )}

      {i.por_que && <p className="text-[11px]"><b>Por qué es viral:</b> <span className="text-neutral-600">{i.por_que}</span></p>}
      {i.como_orbital && <p className="text-[11px]"><b>Con Orbital:</b> <span className="text-neutral-600">{i.como_orbital}</span></p>}
      {i.aviso && (
        <p className="text-[10px] rounded-lg bg-amber-50 border border-amber-200 text-amber-900 px-2 py-1.5 flex gap-1.5">
          <AlertTriangle size={11} className="shrink-0 mt-0.5" />{i.aviso}
        </p>
      )}
      <a href={i.url} target="_blank" rel="noopener noreferrer"
        className="mt-auto inline-flex items-center justify-center gap-1.5 rounded-lg border border-black/10 px-3 py-1.5 text-[11px] font-bold hover:border-black/30">
        <ExternalLink size={12} /> Ver publicación
      </a>
    </div>
  )
}

// Chip de modelo: en el catálogo abre la ficha del anteojo
function Chip({ m, onModelo, className }: { m: string; onModelo?: (m: string) => void; className: string }) {
  return onModelo
    ? <button onClick={() => onModelo(m)} className={`${className} hover:border-black/40 hover:underline underline-offset-2`}>{m}</button>
    : <span className={className}>{m}</span>
}

function KitTriple({ modelos, onVer, optica, onModelo }: { modelos: string[]; onVer?: () => void; optica?: boolean; onModelo?: (m: string) => void }) {
  return (
    <div className="bg-white rounded-xl border-2 p-4 mb-4" style={{ borderColor: ROJO_TRIPLE }}>
      <div className="-mx-4 -mt-4 mb-3 rounded-t-[10px] px-4 py-2.5 text-white text-center" style={{ background: ROJO_TRIPLE }}>
        <div className="text-[13px] font-extrabold tracking-wide">{optica ? 'EL DIFERENCIAL PARA TU ÓPTICA' : 'TE RECOMIENDO PROMOCIONARLO'}</div>
        <div className="text-[10px] font-bold tracking-[0.18em] opacity-90">ÚNICO EN EL MERCADO ARGENTINO</div>
      </div>
      {modelos.length > 0 && (
        <div className="mb-3 rounded-lg bg-[#F5F5F7] p-2.5">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="text-[11px] font-bold">{modelos.length} modelos {optica ? '' : 'de sol '}con Triple Protección en stock</div>
            {onVer && (
              <button onClick={onVer} className="rounded-full text-white px-3 py-1.5 text-[11px] font-bold" style={{ background: ROJO_TRIPLE }}>
                Ver los anteojos con Triple Protección →
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-1 mt-2">
            {modelos.map((m) => <Chip key={m} m={m} onModelo={onModelo} className="rounded-full border border-black/10 bg-white px-2 py-0.5 text-[10px] font-semibold" />)}
          </div>
        </div>
      )}
      <div className="text-[10px] font-bold uppercase tracking-[0.2em]" style={{ color: ROJO_TRIPLE }}>UV400 · Blue Cut 420 nm · Infrarrojo 808 nm</div>
      <h2 className="text-[15px] font-bold mt-1">Protección total. Adentro y afuera, en un mismo cristal.</h2>

      {/* El foco del promotor: la landing es la explicación para él, no un link para compartir */}
      <div className="mt-3 rounded-lg border-2 p-3" style={{ borderColor: ROJO_TRIPLE }}>
        <div className="text-[14px] font-extrabold tracking-wide">{optica ? 'PARA EXPLICARLE A TU CLIENTE' : 'ESTE ES TU FOCO PARA DIFERENCIARTE'}</div>
        <p className="text-[11px] text-neutral-600 mt-1">
          {optica
            ? 'La explicación completa de la Triple Protección, para contarla en el mostrador o mandársela a tu cliente.'
            : 'Acá te explico los beneficios para que los cuentes con tus palabras. No hace falta que compartas el link: es la explicación completa y te puede servir para armar tus contenidos.'}
        </p>
        <a href={LANDING_TRIPLE} target="_blank" rel="noopener noreferrer"
          className="mt-2 inline-flex items-center gap-1.5 rounded-full text-white px-3 py-1.5 text-[11px] font-bold" style={{ background: ROJO_TRIPLE }}>
          <ExternalLink size={12} /> Ver la explicación de la Triple Protección
        </a>
        <a href={PDF_TRIPLE} target="_blank" rel="noopener noreferrer"
          className="mt-2 ml-2 inline-flex items-center gap-1.5 rounded-full border-2 px-3 py-1 text-[11px] font-bold" style={{ borderColor: ROJO_TRIPLE, color: ROJO_TRIPLE }}>
          <ExternalLink size={12} /> Ver más en detalle (PDF)
        </a>
        {VIDEO_TRIPLE && (
          <div className="mt-3">
            <div className="text-[10px] uppercase tracking-wide text-neutral-400 font-bold mb-1">Video: cómo funciona la Triple Protección</div>
            <video src={VIDEO_TRIPLE} controls playsInline className="w-full max-h-[60vh] rounded-lg bg-black" />
          </div>
        )}
      </div>

      {/* La idea fuerza */}
      <div className="mt-3 rounded-lg bg-[#F5F5F7] p-3">
        <div className="text-[10px] uppercase tracking-wide text-neutral-400 font-bold">La idea fuerza</div>
        <div className="text-[13px] font-bold mt-0.5">El único lugar de la cara donde no llega el protector solar.</div>
        <p className="text-[11px] text-neutral-600 mt-1 italic">
          "Te ponés protector solar en toda la cara y esquivás el contorno de ojos. Esto es lo único que protege esa zona. Y encima ves mejor."
        </p>
        <p className="text-[10px] text-neutral-500 mt-1">El 90% de los cambios visibles del envejecimiento de la piel se explican por el sol (fotoenvejecimiento).</p>
      </div>

      {/* Qué lleva el cristal */}
      <div className="mt-3">
        <div className="text-[11px] font-bold uppercase tracking-wide">Qué lleva el cristal</div>
        <ul className="text-[11px] text-neutral-600 mt-1.5 space-y-1">
          <li><b className="text-black">UV400:</b> protección total contra rayos UVA y UVB.</li>
          <li><b className="text-black">Blue Light Cut 420 nm:</b> hasta 98% menos luz azul nociva de pantallas y LEDs.</li>
          <li><b className="text-black">Filtro infrarrojo 808 nm:</b> bloquea el calor radiante del sol que llega a la retina y reduce el efecto de humo, neblina y niebla.</li>
          <li><b className="text-black">VSL™ HD Real:</b> más contraste y definición, colores naturales, sin el tinte amarillo de los filtros comunes.</li>
          <li><b className="text-black">Armazón Xylon®:</b> liviano, flexible y resistente, cómodo todo el día.</li>
        </ul>
      </div>

      {/* Adentro y afuera */}
      <div className="grid gap-2 sm:grid-cols-2 mt-3">
        {[
          ['Adentro · Blue Light Cut', 'Luz azul de pantallas y LEDs. Trabajo digital, estudio, celular.', 'Menos fatiga visual y mejor descanso.'],
          ['Afuera · Infrarrojo 808 nm','Calor del sol (infrarrojo cercano). Manejo, deporte, ciudad.', 'Ojos más frescos y visión más nítida.'],
        ].map(([t, d, b]) => (
          <div key={t} className="rounded-lg bg-[#F5F5F7] p-2.5">
            <div className="text-[11px] font-bold">{t}</div>
            <p className="text-[10px] text-neutral-600 mt-0.5">{d}</p>
            <p className="text-[10px] font-semibold mt-1" style={{ color: ROJO_TRIPLE }}>{b}</p>
          </div>
        ))}
      </div>

      {/* Beneficios para contar */}
      <div className="mt-3">
        <div className="text-[11px] font-bold uppercase tracking-wide">Cuatro beneficios que se explican en un minuto</div>
        <div className="grid gap-2 sm:grid-cols-2 mt-1.5">
          {[
            ['01', 'Antiage en el contorno de ojos', 'El filtro UV + infrarrojo frena el envejecimiento por sol en la única zona donde no llega el protector: menos patas de gallo y flacidez a largo plazo.'],
            ['02', 'Descanso con pantallas', 'El Blue Cut reduce la luz azul de pantallas que afecta el descanso. Usarlos desde la tarde ayuda a llegar mejor a la noche.'],
            ['03', 'Protección completa', 'Un solo cristal cubre UV, luz azul y calor infrarrojo. Menos fatiga visual en el día a día.'],
            ['04', 'Manejo de día más cómodo', 'Menos encandilamiento y mejor contraste al volante.'],
          ].map(([n, t, d]) => (
            <div key={n} className="rounded-lg border border-black/10 p-2.5">
              <div className="flex items-baseline gap-2">
                <span className="font-mono text-[11px] font-bold" style={{ color: ROJO_TRIPLE }}>{n}</span>
                <span className="text-[11px] font-bold">{t}</span>
              </div>
              <p className="text-[10px] text-neutral-600 mt-0.5">{d}</p>
            </div>
          ))}
        </div>
      </div>

      {/* A quién le hablás */}
      <div className="mt-3">
        <div className="text-[11px] font-bold uppercase tracking-wide">{optica ? 'A quién se lo ofrecés' : 'A quién le hablás en cada contenido'}</div>
        <div className="grid gap-2 grid-cols-2 sm:grid-cols-4 mt-1.5">
          {[
            ['Profesional digital', '8 a 10 horas de pantalla, cansancio de ojos.', 'Fatiga + descanso + antiage'],
            ['Conductor / urbano', 'Maneja todos los días y se encandila.', 'Contraste y ojos frescos'],
            ['Público antiage', 'Ya usa cremas y protector solar.', 'El paso que le falta a su rutina'],
            ['Práctico', 'No quiere pensar qué anteojo usar.', 'Un solo anteojo, adentro y afuera'],
          ].map(([t, d, a]) => (
            <div key={t} className="rounded-lg bg-[#F5F5F7] p-2.5">
              <div className="text-[11px] font-bold">{t}</div>
              <p className="text-[10px] text-neutral-600 mt-0.5">{d}</p>
              <p className="text-[10px] font-semibold mt-1">{a}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Datos para contar */}
      <div className="mt-3 rounded-lg bg-[#F5F5F7] p-3 space-y-1.5">
        <div className="text-[10px] uppercase tracking-wide text-neutral-400 font-bold">Datos para contar</div>
        <p className="text-[11px]"><b>El color del cristal no define la protección.</b> <span className="text-neutral-600">Un cristal oscuro sin filtro es peor que no usar nada: dilata la pupila y deja entrar más radiación.</span></p>
        <p className="text-[11px]"><b>Blue cut lo vende todo el mundo. El infrarrojo no lo nombra nadie.</b> <span className="text-neutral-600">Ese es el diferencial.</span></p>
        <p className="text-[11px]"><b>Sin tinte amarillo.</b> <span className="text-neutral-600">El filtro trabaja sobre la luz que daña y deja intacta la luz visible.</span></p>
      </div>

      {/* Guiones */}
      {optica && <div className="text-[11px] font-bold uppercase tracking-wide mt-3">Ideas para las redes de tu óptica</div>}
      <div className={`grid gap-2 sm:grid-cols-3 ${optica ? 'mt-1.5' : 'mt-3'}`}>
        {[
          ['El protector solar de tus ojos', '0–3 s: "¿Sabés qué es lo único que protege el contorno de tus ojos?". 3–12 s: protector en la cara… y el anteojo. 12–15 s: "Y encima ves mejor".'],
          ['Adentro y afuera', 'Primero con la compu o el celular (Blue Cut), después al sol (infrarrojo). Cierre: "Un solo anteojo para todo el día".'],
          ['3 protecciones en 15 segundos', 'Plano de cerca del cristal: UV400, Blue Cut e infrarrojo, una por una con texto en pantalla. ' + (optica ? 'Cierre: "Pedilo en nuestra óptica".' : 'Cierre con tu código de descuento.')],
        ].map(([t, d]) => (
          <div key={t} className="rounded-lg bg-[#F5F5F7] p-2.5">
            <div className="text-[11px] font-bold">{t}</div>
            <p className="text-[10px] text-neutral-600 mt-0.5">{d}</p>
          </div>
        ))}
      </div>
      <p className="text-[10px] text-neutral-500 mt-2">
        Contalo como lo explica Orbital: son beneficios de protección y confort, no tratamientos médicos.{' '}
        {optica
          ? 'Los anteojos con Triple Protección están en la sección Triple Protección del catálogo.'
          : 'Antes de publicar, fijate que el anteojo que mostrás tenga la etiqueta roja de Triple Protección en Anteojos.'}
      </p>
    </div>
  )
}

function KitColor({ modelos, onModelo }: { modelos: string[]; onModelo?: (m: string) => void }) {
  return (
    <div className="bg-white rounded-xl border border-black/10 p-4 mb-4">
      <h2 className="text-[14px] font-bold">Lentes ocre, naranja y rojo</h2>
      <p className="text-[11px] text-neutral-600 mt-1">
        Futbolistas e influencers los usan como parte del look, de día y de noche. Referencias para armar tu versión con Orbital.
      </p>
      {modelos.length > 0 && (
        <div className="mt-2">
          <div className="text-[10px] uppercase tracking-wide text-neutral-400 mb-1">Modelos de Orbital con lente de color, con stock</div>
          <div className="flex flex-wrap gap-1">
            {modelos.map((m) => <Chip key={m} m={m} onModelo={onModelo} className="rounded-full border border-transparent bg-[#F5F5F7] px-2 py-0.5 text-[10px] font-semibold" />)}
          </div>
        </div>
      )}
      <p className="text-[10px] rounded-lg bg-amber-50 border border-amber-200 text-amber-900 px-2 py-1.5 mt-3 flex gap-1.5">
        <AlertTriangle size={11} className="shrink-0 mt-0.5" />
        No prometas que ayudan a dormir ni otros beneficios para la salud, y no muestres anteojos de sol para manejar de noche. Para pantallas, hablá del Blue Cut de los cristales con Triple Protección.
      </p>
    </div>
  )
}
