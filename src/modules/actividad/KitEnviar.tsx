import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { PiezaMarketing } from '../../lib/types'
import { abrirWhatsApp, telefonosCliente } from '../../lib/telefono'

// Kit de envío (p.ej. lanzamiento ASCARI): las piezas de una carpeta que comparten el prefijo del título
// ("ASCARI · Video", "ASCARI · Foto 1", "ASCARI · Texto WhatsApp"). Se elige la óptica, se abre su chat
// con el texto ya escrito y el video + fotos se comparten desde el celu (WhatsApp no deja adjuntar por link).

type Cliente = { cod: string; razon: string | null; nomcomerc: string | null; whatsapp: string | null; telefono: string | null }

export const prefijoKit = (titulo: string) => (titulo.includes(' · ') ? titulo.split(' · ')[0].trim() : '')
const urlDe = (p: PiezaMarketing) => p.url_publica || (p.url?.startsWith('http') ? p.url : null)
const nombreDe = (c: Cliente) => (c.nomcomerc?.trim() || c.razon || '').replace(/^\d+\s*-\s*/, '')

export function piezasDelKit(piezas: PiezaMarketing[], p: PiezaMarketing) {
  const pre = prefijoKit(p.titulo)
  if (!pre) return []
  const kit = piezas.filter((x) => x.activa && x.tema === p.tema && prefijoKit(x.titulo) === pre)
  const tieneMedia = kit.some((x) => (x.categoria === 'video' || x.categoria === 'imagen') && urlDe(x))
  return kit.length > 1 && tieneMedia ? kit : []
}

export default function KitEnviar({ kit }: { kit: PiezaMarketing[] }) {
  const media = kit.filter((x) => (x.categoria === 'video' || x.categoria === 'imagen') && urlDe(x))
  const textoBase = kit.find((x) => x.contenido_texto)?.contenido_texto ?? ''
  const [q, setQ] = useState('')
  const [res, setRes] = useState<Cliente[]>([])
  const [cliente, setCliente] = useState<Cliente | null>(null)
  const [numero, setNumero] = useState('')
  const [estado, setEstado] = useState('')

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

  const tels = useMemo(() => (cliente ? telefonosCliente(cliente.whatsapp, cliente.telefono).filter((n) => n.wa) : []), [cliente])
  const wa = numero.replace(/\D/g, '') || tels[0]?.wa || ''
  const nombre = cliente ? nombreDe(cliente) : ''
  const texto = textoBase.replace(/\s*\{nombre\}/g, nombre ? ` ${nombre}` : '')

  function elegir(c: Cliente) { setCliente(c); setQ(nombreDe(c)); setRes([]); setNumero('') }

  // En el celu: hoja de compartir con video + fotos + texto (se elige WhatsApp y el contacto).
  // En la compu no se pueden compartir archivos: se descargan para arrastrarlos al chat.
  async function compartirArchivos() {
    setEstado('Preparando archivos…')
    try {
      const files = await Promise.all(media.map(async (m, i) => {
        const b = await (await fetch(urlDe(m)!)).blob()
        const ext = m.categoria === 'video' ? 'mp4' : 'jpg'
        return new File([b], `${prefijoKit(m.titulo).toLowerCase()}-${i + 1}.${ext}`, { type: b.type })
      }))
      if (navigator.canShare?.({ files })) {
        await navigator.share({ files, text: texto })
        setEstado('')
        return
      }
      for (const f of files) {
        const a = document.createElement('a')
        a.href = URL.createObjectURL(f); a.download = f.name; a.click()
        setTimeout(() => URL.revokeObjectURL(a.href), 4000)
      }
      setEstado('Descargados: arrastralos al chat de WhatsApp.')
    } catch (e) {
      setEstado((e as Error)?.name === 'AbortError' ? '' : 'No se pudieron preparar los archivos.')
    }
  }

  return (
    <div className="rounded-2xl border-2 border-emerald-500/40 bg-emerald-50/40 p-4 space-y-3">
      <p className="text-sm font-bold">📲 Enviar el kit por WhatsApp</p>

      <div className="grid grid-cols-4 gap-1.5">
        {media.map((m) => m.categoria === 'video'
          ? <video key={m.id} src={urlDe(m)!} muted playsInline loop autoPlay className="w-full h-24 object-cover rounded-lg bg-black" />
          : <img key={m.id} src={urlDe(m)!} alt={m.titulo} className="w-full h-24 object-cover rounded-lg" />)}
      </div>

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
        <label className="text-[11px] font-semibold text-muted uppercase tracking-wide">2 · El mensaje</label>
        <p className="text-[12.5px] text-ink bg-white border border-black/10 rounded-lg p-3 whitespace-pre-wrap max-h-48 overflow-y-auto mt-1">{texto}</p>
      </div>

      <div className="grid sm:grid-cols-2 gap-2">
        <button disabled={!wa} onClick={() => abrirWhatsApp(normalizarWa(wa), texto)}
          className="rounded-xl bg-emerald-600 text-white py-2.5 text-sm font-semibold disabled:opacity-40">
          💬 Abrir chat{nombre ? ` con ${nombre.slice(0, 22)}` : ''} con el texto
        </button>
        <button onClick={compartirArchivos} className="rounded-xl border border-emerald-600 text-emerald-700 py-2.5 text-sm font-semibold bg-white">
          🎬 Mandar video y fotos
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
