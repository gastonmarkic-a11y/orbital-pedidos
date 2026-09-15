// ── Inspiración · referencias de TikTok e Instagram para los colaboradores ─────
// Solo referencia de formato: se muestra el link a la publicación original, nada se copia.
// Tres secciones: Virales · Triple protección (con el link a la landing) · Lentes de color.
// Cada tarjeta trae los datos reales de la publicación, de qué se trata y por qué es viral.
// Lo llena colab-inspiracion-sync todos los días; Orbital puede buscar al momento.
import { useEffect, useMemo, useState } from 'react'
import { ExternalLink, RefreshCw, AlertTriangle } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { ACENTO, Rol } from './colabUtil'
import { BotonCopiar } from './ColabAnteojos'

type Seccion = 'viral' | 'triple' | 'color'
type Item = {
  id: number; seccion: Seccion; fuente: 'tiktok' | 'instagram'; url: string; autor: string | null; texto: string | null
  vistas: number | null; likes: number | null; comentarios: number | null; compartidos: number | null; guardados: number | null
  duracion_seg: number | null; seguidores: number | null; audio: string | null; hashtags: string[] | null
  publicado_at: string | null
  formato: string | null; de_que_trata: string | null; por_que: string | null; como_orbital: string | null; aviso: string | null
  fijo: boolean; created_at: string
}
type Datos = { items: Item[]; modelos_color: string[] }

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

export default function ColabInspiracion({ clave, rol }: { clave: string; rol: Rol }) {
  const [datos, setDatos] = useState<Datos | null>(null)
  const [sec, setSec] = useState<Seccion>('viral')
  const [buscando, setBuscando] = useState(false)
  const [aviso, setAviso] = useState<string | null>(null)

  const cargar = () => supabase.rpc('colab_inspiracion_lista', { p_clave: clave })
    .then(({ data }) => setDatos((data as Datos | null) ?? { items: [], modelos_color: [] }))
  useEffect(() => { cargar() }, [clave])

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
          <h1 className="text-[15px] font-bold tracking-wide uppercase">Inspiración</h1>
          <p className="text-[11px] text-neutral-500 mt-1">
            Publicaciones que están funcionando en TikTok e Instagram. Son <b>referencias de formato</b>: mirá el original y hacé tu versión con Orbital, no copies el video.
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
        {SECCIONES.map(([id, t]) => (
          <button key={id} onClick={() => setSec(id)}
            className={`rounded-full px-3 py-1.5 text-[11px] font-semibold border ${sec === id ? 'text-white border-transparent' : 'bg-white border-black/10'}`}
            style={sec === id ? { background: ACENTO } : undefined}>
            {t} <span className="opacity-60">{(datos.items ?? []).filter((i) => i.seccion === id).length}</span>
          </button>
        ))}
      </div>

      {sec === 'triple' && <KitTriple />}
      {sec === 'color' && <KitColor modelos={datos.modelos_color} />}

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

function KitTriple() {
  return (
    <div className="bg-white rounded-xl border-2 p-4 mb-4" style={{ borderColor: ACENTO }}>
      <div className="text-[10px] font-bold uppercase tracking-[0.2em]" style={{ color: ACENTO }}>Infrarrojo · UV400 · Blue Cut</div>
      <h2 className="text-[14px] font-bold mt-1">Triple Protección: tres protecciones en un mismo cristal</h2>
      <ul className="text-[11px] text-neutral-600 mt-2 space-y-1">
        <li><b className="text-black">Infrarrojo:</b> bloquea la radiación que genera calor y fatiga visual bajo sol fuerte.</li>
        <li><b className="text-black">UV400:</b> bloquea el 100% de los rayos UVA y UVB.</li>
        <li><b className="text-black">Blue Cut:</b> filtra la luz azul de pantallas y LEDs.</li>
      </ul>
      <div className="mt-3 flex items-center gap-2 rounded-lg bg-[#F5F5F7] px-2.5 py-1.5">
        <span className="flex-1 truncate font-mono text-[11px] font-bold">{LANDING_TRIPLE.replace('https://', '')}</span>
        <BotonCopiar texto={LANDING_TRIPLE} label="Copiar link" />
        <a href={LANDING_TRIPLE} target="_blank" rel="noopener noreferrer" className="shrink-0 p-1 rounded-md border border-black/10 bg-white" title="Abrir"><ExternalLink size={12} /></a>
      </div>
      <p className="text-[10px] text-neutral-500 mt-1">Sumalo en el posteo o en un sticker de enlace para que tu comunidad lo lea completo.</p>

      <div className="grid gap-2 sm:grid-cols-3 mt-3">
        {[
          ['3 protecciones en 15 segundos', '0–3 s: "¿Sabés todo lo que te protege este anteojo?". 3–12 s: una por una, con texto en pantalla. 12–15 s: "Te dejo el link".'],
          ['Del sol a la pantalla', 'Primero al sol en la calle, después con la compu o el celular. Contá que el Blue Cut filtra la luz azul de pantallas y LEDs.'],
          ['Lo que no se ve', 'Plano de cerca del cristal y el texto "Infrarrojo + UV400 + Blue Cut". Cerrá con el link de la Triple Protección.'],
        ].map(([t, d]) => (
          <div key={t} className="rounded-lg bg-[#F5F5F7] p-2.5">
            <div className="text-[11px] font-bold">{t}</div>
            <p className="text-[10px] text-neutral-600 mt-0.5">{d}</p>
          </div>
        ))}
      </div>
      <p className="text-[10px] text-neutral-500 mt-2">Antes de publicar, confirmá con Orbital que el anteojo que mostrás tiene cristales con Triple Protección.</p>
    </div>
  )
}

function KitColor({ modelos }: { modelos: string[] }) {
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
            {modelos.map((m) => <span key={m} className="rounded-full bg-[#F5F5F7] px-2 py-0.5 text-[10px] font-semibold">{m}</span>)}
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
