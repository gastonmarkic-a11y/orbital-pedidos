import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { PiezaMarketing } from '../../lib/types'
import { abrirWhatsApp, telefonosCliente } from '../../lib/telefono'
import { useAuth } from '../../lib/auth'

// Kit de envío (p.ej. lanzamiento ASCARI): las piezas de una carpeta que comparten el prefijo del título
// ("ASCARI · Video", "ASCARI · Foto 1", "ASCARI · Texto WhatsApp"). Se elige la óptica, se abre su chat
// con el texto ya escrito y el video + fotos se comparten desde el celu (WhatsApp no deja adjuntar por link).
// Siempre va con el link al catálogo de ESA óptica (su token), abierto en el modelo del kit (?ver=ascari).
// Los mismos kits aparecen en Preparar envío (Envíos/Cartera) para sumarlos al mensaje del cliente.

type Cliente = { cod: string; razon: string | null; nomcomerc: string | null; whatsapp: string | null; telefono: string | null }

const URL_CATALOGO = 'https://ver.orbitaleyewear.com.ar/catalogo'
export const prefijoKit = (titulo: string) => (titulo.includes(' · ') ? titulo.split(' · ')[0].trim() : '')
export const urlDe = (p: PiezaMarketing) => p.url_publica || (p.url?.startsWith('http') ? p.url : null)
const nombreDe = (c: Cliente) => (c.nomcomerc?.trim() || c.razon || '').replace(/^\d+\s*-\s*/, '')

export function piezasDelKit(piezas: PiezaMarketing[], p: PiezaMarketing) {
  const pre = prefijoKit(p.titulo)
  if (!pre) return []
  const kit = piezas.filter((x) => x.activa && x.tema === p.tema && prefijoKit(x.titulo) === pre)
  const tieneMedia = kit.some((x) => (x.categoria === 'video' || x.categoria === 'imagen') && urlDe(x))
  return kit.length > 1 && tieneMedia ? kit : []
}

// Todos los kits activos (uno por tema + prefijo), para listarlos en Preparar envío.
export function kitsActivos(piezas: PiezaMarketing[]) {
  const out = new Map<string, { clave: string; nombre: string; piezas: PiezaMarketing[] }>()
  for (const p of piezas) {
    const nombre = prefijoKit(p.titulo)
    const clave = `${p.tema}|${nombre}`
    if (!nombre || out.has(clave)) continue
    const kit = piezasDelKit(piezas, p)
    if (kit.length) out.set(clave, { clave, nombre, piezas: kit })
  }
  return [...out.values()]
}

// Link al catálogo del cliente (su token), abierto en el modelo del kit.
export const linkCatalogoKit = (nombreKit: string, codigo: string) =>
  `${URL_CATALOGO}?ver=${encodeURIComponent(nombreKit.toLowerCase())}&k=${codigo}`

// Texto del kit para un cliente: el copy cargado en Marketing + el link a su catálogo.
export function textoKit(kit: PiezaMarketing[], nombre: string, link: string | null) {
  const base = (kit.find((x) => x.contenido_texto)?.contenido_texto ?? '')
    .replace(/\s*\{nombre\}/g, nombre ? ` ${nombre}` : '')
    .trim()
  return link ? `${base}\n\n👉 Miralo en tu catálogo y sumalo al pedido:\n${link}` : base
}

// En el celu: hoja de compartir con video + fotos + texto (se elige WhatsApp y el contacto).
// En la compu no se pueden compartir archivos: se descargan para arrastrarlos al chat.
// Devuelve el aviso a mostrar ('' si salió bien o se canceló).
export async function compartirMediaKit(kit: PiezaMarketing[], texto: string): Promise<string> {
  const r = await compartirKit(kit, texto)
  return r === 'descargado' ? 'Descargados: arrastralos al chat de WhatsApp.' : r === 'error' ? 'No se pudieron preparar los archivos.' : ''
}

// Archivos ya bajados, por pieza. Se precargan al elegir el kit: si se bajan recién al tocar
// "compartir", el video tarda y el navegador ya no deja abrir la hoja de compartir (pide un toque reciente).
const cacheArchivos = new Map<number, Promise<File>>()
function archivoDe(m: PiezaMarketing): Promise<File> {
  let p = cacheArchivos.get(m.id)
  if (!p) {
    p = fetch(urlDe(m)!)
      .then((r) => r.blob())
      .then((b) => new File([b], `${(prefijoKit(m.titulo) || 'orbital').toLowerCase()}-${m.id}.${m.categoria === 'video' ? 'mp4' : 'jpg'}`, { type: b.type }))
    p.catch(() => cacheArchivos.delete(m.id))
    cacheArchivos.set(m.id, p)
  }
  return p
}
const esMediaKit = (x: PiezaMarketing) => (x.categoria === 'video' || x.categoria === 'imagen') && !!urlDe(x)
export function precargarMediaKit(kit: PiezaMarketing[]) {
  kit.filter(esMediaKit).forEach((m) => void archivoDe(m).catch(() => {}))
}

// Comparte fotos/video + texto juntos. 'descargado' = el equipo no comparte archivos (compu):
// se bajaron para arrastrarlos al chat y el texto hay que mandarlo aparte.
export async function compartirKit(kit: PiezaMarketing[], texto: string): Promise<'compartido' | 'cancelado' | 'descargado' | 'error'> {
  try {
    const files = await Promise.all(kit.filter(esMediaKit).map(archivoDe))
    if (navigator.canShare?.({ files, text: texto })) {
      await navigator.share({ files, text: texto })
      return 'compartido'
    }
    for (const f of files) {
      const a = document.createElement('a')
      a.href = URL.createObjectURL(f); a.download = f.name; a.click()
      setTimeout(() => URL.revokeObjectURL(a.href), 4000)
    }
    return 'descargado'
  } catch (e) {
    return (e as Error)?.name === 'AbortError' ? 'cancelado' : 'error'
  }
}

export default function KitEnviar({ kit }: { kit: PiezaMarketing[] }) {
  const { codigoEfectivo } = useAuth()
  const media = kit.filter((x) => (x.categoria === 'video' || x.categoria === 'imagen') && urlDe(x))
  const [q, setQ] = useState('')
  const [res, setRes] = useState<Cliente[]>([])
  const [cliente, setCliente] = useState<Cliente | null>(null)
  const [numero, setNumero] = useState('')
  const [estado, setEstado] = useState('')
  const [linkCat, setLinkCat] = useState<string | null>(null)
  const [linkBusy, setLinkBusy] = useState(false)
  useEffect(() => precargarMediaKit(kit), [kit])
  // Fotos y videos que se mandan como archivo (arrancan todos marcados).
  const [sinMarcar, setSinMarcar] = useState<Set<number>>(new Set())
  const elegidas = media.filter((m) => !sinMarcar.has(m.id))
  const marcar = (id: number) => setSinMarcar((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })

  useEffect(() => {
    const t = q.trim()
    if (t.length < 2 || cliente) { setRes([]); return }
    const h = window.setTimeout(async () => {
      const like = `%${t.replace(/[%,]/g, ' ')}%`
      const { data } = await supabase.from('clientes').select('cod, razon, nomcomerc, whatsapp, telefono')
        .or(`razon.ilike.${like},nomcomerc.ilike.${like},cod.ilike.${like}`).limit(8)
      setRes((data as Cliente[]) ?? [])
    }, 250)
    return () => window.clearTimeout(h)
  }, [q, cliente])

  // Link al catálogo de la óptica elegida (mismo token que usa Preparar envío).
  useEffect(() => {
    setLinkCat(null)
    if (!cliente) return
    let vivo = true
    setLinkBusy(true)
    supabase.rpc('catalogo_link_cliente', { p_cod_cliente: cliente.cod, p_vendedor: codigoEfectivo }).then(({ data }) => {
      if (!vivo) return
      const r = data as { ok?: boolean; codigo?: string } | null
      setLinkCat(r?.ok && r.codigo ? linkCatalogoKit(prefijoKit(kit[0]?.titulo ?? ''), r.codigo) : null)
      setLinkBusy(false)
    })
    return () => { vivo = false }
  }, [cliente?.cod, codigoEfectivo, kit])

  const tels = useMemo(() => (cliente ? telefonosCliente(cliente.whatsapp, cliente.telefono).filter((n) => n.wa) : []), [cliente])
  const wa = numero.replace(/\D/g, '') || tels[0]?.wa || ''
  const nombre = cliente ? nombreDe(cliente) : ''
  const texto = textoKit(kit, nombre, linkCat)

  function elegir(c: Cliente) { setCliente(c); setQ(nombreDe(c)); setRes([]); setNumero('') }

  async function compartirArchivos() {
    setEstado('Preparando archivos…')
    setEstado(await compartirMediaKit(elegidas, texto))
  }

  return (
    <div className="rounded-2xl border-2 border-emerald-500/40 bg-emerald-50/40 p-4 space-y-3">
      <p className="text-sm font-bold">📲 Enviar el kit por WhatsApp</p>

      <div className="grid grid-cols-4 gap-1.5">
        {media.map((m) => {
          const on = !sinMarcar.has(m.id)
          return (
            <button key={m.id} type="button" onClick={() => marcar(m.id)} title={m.titulo}
              className={`relative rounded-lg overflow-hidden border-2 transition ${on ? 'border-emerald-600' : 'border-transparent opacity-40'}`}>
              {m.categoria === 'video'
                ? <video src={urlDe(m)!} muted playsInline loop autoPlay className="w-full h-24 object-cover bg-black" />
                : <img src={urlDe(m)!} alt={m.titulo} className="w-full h-24 object-cover" />}
              <span className="absolute top-1 left-1 w-4 h-4 rounded bg-white/90 text-[10px] font-bold text-emerald-700 flex items-center justify-center">{on ? '✓' : ''}</span>
              {m.categoria === 'video' && <span className="absolute bottom-1 right-1 text-[9px] font-semibold bg-black/60 text-white rounded px-1">▶ video</span>}
            </button>
          )
        })}
      </div>
      <p className="text-[11px] text-muted -mt-1">Tocá para marcar o desmarcar: lo marcado va como archivo, no como link.</p>

      <div className="relative">
        <label className="text-[11px] font-semibold text-muted uppercase tracking-wide">1 · Elegí la óptica</label>
        <input value={q} onChange={(e) => { setQ(e.target.value); setCliente(null) }} placeholder="Buscar por nombre, razón social o código…"
          className="w-full mt-1 border border-black/10 rounded-lg px-3 py-2 text-sm bg-white" />
        {res.length > 0 && (
          <div className="absolute z-10 left-0 right-0 mt-1 bg-white border border-black/10 rounded-lg shadow-lg max-h-64 overflow-y-auto">
            {res.map((c) => (
              <button key={c.cod} onClick={() => elegir(c)} className="w-full text-left px-3 py-2 text-sm hover:bg-black/[0.04]">
                <span className="font-medium">{nombreDe(c)}</span> <span className="text-[11px] text-faint">· {c.cod}{c.whatsapp || c.telefono ? '' : ' · sin teléfono'}</span>
              </button>
            ))}
          </div>
        )}
        {cliente && tels.length > 1 && (
          <select value={wa} onChange={(e) => setNumero(e.target.value)} className="w-full mt-1.5 border border-black/10 rounded-lg px-3 py-2 text-sm bg-white">
            {tels.map((t) => <option key={t.wa} value={t.wa}>{t.original}</option>)}
          </select>
        )}
        {(!cliente || !tels.length) && (
          <input value={numero} onChange={(e) => setNumero(e.target.value)} placeholder={cliente ? 'No tiene WhatsApp cargado: escribí el número' : '…o escribí el número directo (ej. 11 5555 1234)'}
            className="w-full mt-1.5 border border-black/10 rounded-lg px-3 py-2 text-sm bg-white" />
        )}
      </div>

      <div>
        <label className="text-[11px] font-semibold text-muted uppercase tracking-wide">2 · El mensaje{linkBusy ? ' · generando link al catálogo…' : cliente && !linkCat ? ' · ⚠ sin link al catálogo' : ''}</label>
        <p className="text-[12.5px] text-ink bg-white border border-black/10 rounded-lg p-3 whitespace-pre-wrap max-h-48 overflow-y-auto mt-1">{texto}</p>
      </div>

      <div className="grid sm:grid-cols-2 gap-2">
        <button disabled={!wa || linkBusy} onClick={() => abrirWhatsApp(normalizarWa(wa), texto)}
          className="rounded-xl bg-emerald-600 text-white py-2.5 text-sm font-semibold disabled:opacity-40">
          💬 Abrir chat{nombre ? ` con ${nombre.slice(0, 22)}` : ''} con el texto
        </button>
        <button onClick={compartirArchivos} disabled={!elegidas.length} className="rounded-xl border border-emerald-600 text-emerald-700 py-2.5 text-sm font-semibold bg-white disabled:opacity-40">
          🎬 {elegidas.length ? `Mandar ${elegidas.length} archivo${elegidas.length > 1 ? 's' : ''}` : 'Marcá una foto o video'}
        </button>
      </div>
      <p className="text-[11px] text-muted leading-snug">
        {estado || 'WhatsApp no deja adjuntar archivos desde un link. En el celu, “Mandar video y fotos” abre compartir: elegí WhatsApp y la óptica. En la compu, los descarga para que los arrastres al chat.'}
      </p>
    </div>
  )
}

// Número escrito a mano: si no trae país, va como celular de Argentina (54 9 + área + número).
function normalizarWa(d: string) {
  if (d.startsWith('54')) return d
  const n = d.replace(/^0/, '').replace(/^(\d{2,4})15/, '$1')
  return `549${n}`
}
