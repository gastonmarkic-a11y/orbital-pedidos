// ── Panel de la óptica dentro del catálogo ──────────────────────────────────
// Solo accesos de óptica (el token trae cod_cliente):
//   · Postventa (ventana propia): garantía / rotura / repuesto, con fotos. Queda el ticket
//     (optica_postventa) y un trigger avisa al grupo de Telegram para Postventa.
//   · Mis anteojos y Mis publicaciones: van dentro de "Crear contenido", separados de postventa.
//     Mis anteojos = lo que Orbital le vendió; lo que tacha deja de salir como "dónde comprar"
//     en IRIS (al consumidor solo le llega nombre y dirección: nada de precios ni catálogo).
//     Mis publicaciones = link y/o fotos de lo que publicó, para que Orbital lo comparta.
// Las fotos van al bucket optica-fotos bajo <clave>/ (la política exige un token de óptica válido).
import { useEffect, useRef, useState } from 'react'
import { X, Wrench, ExternalLink, Camera } from 'lucide-react'
import { supabase } from '../../lib/supabase'

const QUIEN_KEY = 'orbital_catalogo_quien'
const MAX_FOTOS = 4

const leer = (k: string) => { try { return localStorage.getItem(k) } catch { return null } }
const guardar = (k: string, v: string) => { try { localStorage.setItem(k, v) } catch { /* sin storage */ } }

type Ticket = {
  id: number; tipo: 'postventa' | 'repuesto'; producto: string | null; cantidad: number | null
  detalle: string; estado: 'abierto' | 'en_proceso' | 'resuelto'; solicitado_por: string | null; created_at: string; fotos?: string[]
}
type MiModelo = { modelo: string; anio: number; unidades: number; baja: boolean }
type Publicacion = { id: number; modelo: string | null; color: string | null; url: string; fotos: string[]; estado: string; created_at: string }

const ESTADO: Record<Ticket['estado'], [string, string]> = {
  abierto: ['Abierto', 'bg-amber-100 text-amber-800'],
  en_proceso: ['En proceso', 'bg-sky-100 text-sky-800'],
  resuelto: ['Resuelto', 'bg-emerald-100 text-emerald-800'],
}

async function subirFotos(clave: string, files: File[]): Promise<string[]> {
  const urls: string[] = []
  for (const f of files) {
    const ext = (f.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg'
    const path = `${clave}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
    const { error } = await supabase.storage.from('optica-fotos').upload(path, f, { contentType: f.type || 'image/jpeg' })
    if (error) throw error
    urls.push(supabase.storage.from('optica-fotos').getPublicUrl(path).data.publicUrl)
  }
  return urls
}

// Selector de fotos con miniaturas (hasta MAX_FOTOS)
function Fotos({ files, onChange }: { files: File[]; onChange: (f: File[]) => void }) {
  const input = useRef<HTMLInputElement | null>(null)
  const [previews, setPreviews] = useState<string[]>([])
  useEffect(() => {
    const u = files.map((f) => URL.createObjectURL(f))
    setPreviews(u)
    return () => u.forEach((x) => URL.revokeObjectURL(x))
  }, [files])
  return (
    <div className="flex flex-wrap items-center gap-2">
      {previews.map((p, i) => (
        <div key={p} className="relative w-14 h-14 rounded-lg overflow-hidden border border-black/10">
          <img src={p} alt="" className="w-full h-full object-cover" />
          <button onClick={() => onChange(files.filter((_, j) => j !== i))} className="absolute top-0 right-0 bg-black/60 text-white rounded-bl-md p-0.5"><X size={11} /></button>
        </div>
      ))}
      {files.length < MAX_FOTOS && (
        <button type="button" onClick={() => input.current?.click()}
          className="flex items-center gap-1.5 rounded-lg border border-dashed border-black/25 px-3 py-2 text-[12px] font-sans text-neutral-600 hover:bg-black/[0.03]">
          <Camera size={14} /> {files.length ? 'Otra foto' : 'Agregar fotos'}
        </button>
      )}
      <input ref={input} type="file" accept="image/*" multiple className="hidden"
        onChange={(e) => { const n = [...files, ...Array.from(e.target.files ?? [])].slice(0, MAX_FOTOS); onChange(n); e.target.value = '' }} />
    </div>
  )
}

function Miniaturas({ urls }: { urls?: string[] }) {
  if (!urls?.length) return null
  return (
    <div className="flex gap-1.5 mt-1.5">
      {urls.map((u) => <a key={u} href={u} target="_blank" rel="noreferrer"><img src={u} alt="" className="w-12 h-12 rounded-md object-cover border border-black/10" /></a>)}
    </div>
  )
}

export function PublicarLink({ clave, modelo, color }: { clave: string; modelo: string; color: string | null }) {
  const [url, setUrl] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [estado, setEstado] = useState<'no' | 'enviando' | 'ok' | 'error'>('no')
  const [err, setErr] = useState('')
  async function enviar() {
    const u = url.trim()
    if (u && !/^https?:\/\//i.test(u)) { setErr('Pegá el link completo (empieza con https://).'); setEstado('error'); return }
    if (!u && !files.length) { setErr('Pegá el link o subí una foto.'); setEstado('error'); return }
    setEstado('enviando')
    try {
      const fotos = await subirFotos(clave, files)
      const { error } = await supabase.rpc('catalogo_publicacion_crear', { p_clave: clave, p_modelo: modelo, p_color: color, p_url: u, p_fotos: fotos })
      if (error) throw error
      setEstado('ok'); setUrl(''); setFiles([])
    } catch { setErr('No se pudo enviar. Probá de nuevo.'); setEstado('error') }
  }
  if (estado === 'ok') return <p className="mt-2 text-[11px] text-emerald-700 font-sans font-semibold">¡Gracias! Lo recibimos: el equipo de Orbital lo va a compartir mandando a tu óptica.</p>
  return (
    <div className="mt-3 pt-3 border-t border-fuchsia-200 space-y-1.5">
      <p className="text-[11px] font-semibold font-sans">¿Ya lo publicaste? Mandanos el link o tus fotos</p>
      <p className="text-[10px] text-neutral-500 font-sans">Orbital comparte las publicaciones de sus ópticas en sus redes, con la dirección de tu local.</p>
      <div className="flex gap-2">
        <input value={url} onChange={(e) => { setUrl(e.target.value); if (estado === 'error') setEstado('no') }} placeholder="https://instagram.com/p/…"
          className="flex-1 min-w-0 rounded-lg border border-black/10 bg-white px-2.5 py-1.5 text-[12px] font-sans" />
        <button onClick={enviar} disabled={estado === 'enviando' || (!url.trim() && !files.length)} className="rounded-lg bg-neutral-900 text-white px-3 text-[11px] font-bold disabled:opacity-40">
          {estado === 'enviando' ? '…' : 'Enviar'}
        </button>
      </div>
      <Fotos files={files} onChange={setFiles} />
      {estado === 'error' && <p className="text-[10px] text-red-600 font-sans">{err}</p>}
    </div>
  )
}

// Postventa: ventana propia, separada de lo de contenido (Mis anteojos / Mis publicaciones)
export default function PostventaOptica({ clave, onClose }: { clave: string; onClose: () => void }) {
  const [modelos, setModelos] = useState<MiModelo[]>([])
  const [tickets, setTickets] = useState<Ticket[] | null>(null)
  const cargarTickets = () => supabase.rpc('catalogo_postventa_lista', { p_clave: clave }).then(({ data }) => setTickets((data as Ticket[]) ?? []))
  useEffect(() => {
    supabase.rpc('catalogo_mis_modelos', { p_clave: clave }).then(({ data }) => setModelos((data as MiModelo[]) ?? []))
    cargarTickets()
  }, [clave]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white w-full sm:max-w-lg sm:rounded-2xl rounded-t-2xl max-h-[92vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-black/5 px-4 py-3 z-10 flex items-center justify-between">
          <h2 className="text-base font-bold flex items-center gap-2"><Wrench size={16} /> Postventa</h2>
          <button onClick={onClose} className="p-1.5 rounded-full hover:bg-black/5"><X size={20} /></button>
        </div>
        <div className="p-4"><SolapaPostventa clave={clave} modelos={modelos} tickets={tickets} onCargado={cargarTickets} /></div>
      </div>
    </div>
  )
}

// Mis anteojos y Mis publicaciones: van dentro de "Crear contenido" (se cargan solos)
export function MisAnteojos({ clave }: { clave: string }) {
  const [modelos, setModelos] = useState<MiModelo[] | null>(null)
  const cargar = () => supabase.rpc('catalogo_mis_modelos', { p_clave: clave }).then(({ data }) => setModelos((data as MiModelo[]) ?? []))
  useEffect(() => { cargar() }, [clave]) // eslint-disable-line react-hooks/exhaustive-deps
  return <SolapaAnteojos clave={clave} modelos={modelos} onCambio={cargar} />
}

export function MisPublicaciones({ clave }: { clave: string }) {
  const [modelos, setModelos] = useState<MiModelo[]>([])
  const [pubs, setPubs] = useState<Publicacion[] | null>(null)
  const cargar = () => supabase.rpc('catalogo_publicaciones', { p_clave: clave }).then(({ data }) => setPubs((data as Publicacion[]) ?? []))
  useEffect(() => {
    supabase.rpc('catalogo_mis_modelos', { p_clave: clave }).then(({ data }) => setModelos((data as MiModelo[]) ?? []))
    cargar()
  }, [clave]) // eslint-disable-line react-hooks/exhaustive-deps
  return <SolapaPublicaciones clave={clave} modelos={modelos} pubs={pubs} onCargado={cargar} />
}

const campo = 'w-full bg-white border border-black/15 rounded-lg px-3 py-2 text-sm font-sans'

function SolapaPostventa({ clave, modelos, tickets, onCargado }: {
  clave: string; modelos: MiModelo[]; tickets: Ticket[] | null; onCargado: () => void
}) {
  const [tipo, setTipo] = useState<Ticket['tipo']>('postventa')
  const [producto, setProducto] = useState('')
  const [cantidad, setCantidad] = useState(1)
  const [detalle, setDetalle] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [quien, setQuien] = useState(() => leer(QUIEN_KEY) ?? '')
  const [enviando, setEnviando] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null)

  async function crear() {
    if (!detalle.trim()) { setMsg({ ok: false, t: 'Contanos qué pasó o qué repuesto necesitás.' }); return }
    setEnviando(true); setMsg(null)
    if (quien.trim()) guardar(QUIEN_KEY, quien.trim())
    try {
      const fotos = await subirFotos(clave, files)
      const { data, error } = await supabase.rpc('catalogo_postventa_crear', {
        p_clave: clave, p_tipo: tipo, p_producto: producto || null, p_cantidad: tipo === 'repuesto' ? cantidad : null,
        p_detalle: detalle, p_quien: quien.trim() || null, p_fotos: fotos,
      })
      if (error) throw error
      const id = (data as { id: number }).id
      setDetalle(''); setProducto(''); setCantidad(1); setFiles([])
      setMsg({ ok: true, t: `Listo, quedó el pedido #${id}. Ya le llegó al equipo de postventa de Orbital.` })
      onCargado()
    } catch {
      setMsg({ ok: false, t: 'No se pudo cargar. Probá de nuevo.' })
    }
    setEnviando(false)
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-black/10 p-3 space-y-2.5">
        <p className="text-[11px] text-neutral-500 font-sans">Garantías, roturas y repuestos. Cargalo acá con fotos y le llega directo al equipo de postventa de Orbital.</p>
        <div className="flex gap-1.5">
          {(['postventa', 'repuesto'] as const).map((t) => (
            <button key={t} onClick={() => setTipo(t)}
              className={`flex-1 text-[12px] rounded-lg border px-3 py-2 font-semibold ${tipo === t ? 'bg-[#0004FF] text-white border-transparent' : 'bg-white border-black/15 text-neutral-700'}`}>
              {t === 'postventa' ? 'Garantía / rotura' : 'Repuesto'}
            </button>
          ))}
        </div>
        <input list="mi-optica-modelos" value={producto} onChange={(e) => setProducto(e.target.value)} placeholder="Modelo y color (ej: ADELAIDA negro brillo)" className={campo} />
        <datalist id="mi-optica-modelos">{modelos.map((m) => <option key={m.modelo} value={m.modelo} />)}</datalist>
        {tipo === 'repuesto' && (
          <label className="flex items-center gap-2 text-sm font-sans">Cantidad
            <input type="number" min={1} value={cantidad} onChange={(e) => setCantidad(Math.max(1, Number(e.target.value) || 1))} className="w-20 bg-white border border-black/15 rounded-lg px-2 py-1.5" />
          </label>
        )}
        <textarea value={detalle} onChange={(e) => setDetalle(e.target.value)} rows={3}
          placeholder={tipo === 'repuesto' ? '¿Qué repuesto necesitás? (varilla, tornillo, plaqueta…)' : '¿Qué pasó?'} className={campo} />
        <Fotos files={files} onChange={setFiles} />
        <input value={quien} onChange={(e) => setQuien(e.target.value)} placeholder="Tu nombre (opcional)" className={campo} />
        <button onClick={crear} disabled={enviando} className="w-full bg-[#0004FF] text-white rounded-xl py-2.5 text-sm font-medium disabled:opacity-50">
          {enviando ? (files.length ? 'Subiendo fotos…' : 'Enviando…') : 'Cargar pedido'}
        </button>
        {msg && <p className={`text-[12px] font-sans ${msg.ok ? 'text-emerald-700' : 'text-red-600'}`}>{msg.t}</p>}
      </div>
      <div>
        <p className="text-[10px] font-bold tracking-[0.2em] uppercase text-neutral-500 mb-2">Tus pedidos</p>
        {tickets === null ? <p className="text-sm text-neutral-400">Cargando…</p> : tickets.length === 0 ? (
          <p className="text-sm text-neutral-400 font-sans">Todavía no cargaste pedidos de postventa.</p>
        ) : (
          <ul className="space-y-2">
            {tickets.map((t) => (
              <li key={t.id} className="rounded-lg border border-black/10 px-3 py-2 font-sans">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[12px] font-semibold">#{t.id} · {t.tipo === 'repuesto' ? 'Repuesto' : 'Postventa'}{t.producto ? ` · ${t.producto}` : ''}</span>
                  <span className={`text-[10px] rounded-full px-2 py-0.5 font-semibold ${ESTADO[t.estado][1]}`}>{ESTADO[t.estado][0]}</span>
                </div>
                <p className="text-[12px] text-neutral-600 mt-0.5">{t.detalle}</p>
                <Miniaturas urls={t.fotos} />
                <p className="text-[10px] text-neutral-400 mt-0.5">{new Date(t.created_at).toLocaleDateString('es-AR')}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function SolapaAnteojos({ clave, modelos, onCambio }: { clave: string; modelos: MiModelo[] | null; onCambio: () => void }) {
  const [trabajando, setTrabajando] = useState<string | null>(null)
  async function marcar(m: MiModelo) {
    setTrabajando(m.modelo)
    await supabase.rpc('catalogo_mis_modelos_baja', { p_clave: clave, p_modelo: m.modelo, p_baja: !m.baja })
    await onCambio()
    setTrabajando(null)
  }
  return (
    <div>
      <p className="text-[12px] text-neutral-600 font-sans mb-3 rounded-lg bg-[#F5F5F7] px-3 py-2">
        Estos son los modelos que te vendimos. Cuando alguien le pregunta a Orbital dónde conseguir uno, le pasamos la dirección de las ópticas que lo tienen.
        <b> Tachá los que ya no tenés</b> y dejás de aparecer para ese modelo.
      </p>
      {modelos === null ? <p className="text-sm text-neutral-400">Cargando…</p> : modelos.length === 0 ? (
        <p className="text-sm text-neutral-400 font-sans">No encontramos compras recientes a tu nombre.</p>
      ) : (
        <ul className="divide-y divide-black/5 border border-black/10 rounded-xl">
          {modelos.map((m) => (
            <li key={m.modelo} className="flex items-center gap-3 px-3 py-2.5">
              <div className="flex-1 min-w-0">
                <div className={`text-[13px] font-semibold ${m.baja ? 'line-through text-neutral-400' : ''}`}>{m.modelo}</div>
                <div className="text-[10px] text-neutral-400 font-sans">{m.unidades} u. · última compra {m.anio}</div>
              </div>
              <button onClick={() => marcar(m)} disabled={trabajando === m.modelo}
                className={`shrink-0 text-[11px] rounded-full px-3 py-1.5 font-semibold border disabled:opacity-40 ${m.baja ? 'bg-white border-black/15 text-neutral-700' : 'bg-emerald-50 border-emerald-200 text-emerald-800'}`}>
                {m.baja ? 'Ya no lo tengo · volver a sumar' : '✓ Lo tengo'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function SolapaPublicaciones({ clave, modelos, pubs, onCargado }: {
  clave: string; modelos: MiModelo[]; pubs: Publicacion[] | null; onCargado: () => void
}) {
  const [modelo, setModelo] = useState('')
  const [url, setUrl] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  async function enviar() {
    const u = url.trim()
    if (u && !/^https?:\/\//i.test(u)) { setErr('Pegá el link completo de la publicación (empieza con https://).'); return }
    if (!u && !files.length) { setErr('Pegá el link o subí al menos una foto.'); return }
    setEnviando(true); setErr(null)
    try {
      const fotos = await subirFotos(clave, files)
      const { error } = await supabase.rpc('catalogo_publicacion_crear', { p_clave: clave, p_modelo: modelo || null, p_color: null, p_url: u, p_fotos: fotos })
      if (error) throw error
      setUrl(''); setModelo(''); setFiles([]); onCargado()
    } catch { setErr('No se pudo guardar. Probá de nuevo.') }
    setEnviando(false)
  }
  const ESTADO_PUB: Record<string, [string, string]> = {
    nueva: ['Recibida', 'bg-amber-100 text-amber-800'],
    compartida: ['Compartida por Orbital', 'bg-emerald-100 text-emerald-800'],
    descartada: ['No compartida', 'bg-neutral-100 text-neutral-600'],
  }
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-fuchsia-200 bg-gradient-to-br from-fuchsia-50/60 to-orange-50/60 p-3 space-y-2">
        <p className="text-[12px] text-neutral-700 font-sans">
          ¿Publicaste un anteojo Orbital en las redes de tu óptica? Mandanos el link o tus fotos: Orbital lo comparte en sus redes <b>con la dirección de tu local</b>.
        </p>
        <input list="mi-optica-modelos-pub" value={modelo} onChange={(e) => setModelo(e.target.value)} placeholder="Modelo (opcional)" className={campo} />
        <datalist id="mi-optica-modelos-pub">{modelos.map((m) => <option key={m.modelo} value={m.modelo} />)}</datalist>
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Link de la publicación (opcional si subís fotos)" className={campo} />
        <Fotos files={files} onChange={setFiles} />
        <button onClick={enviar} disabled={enviando || (!url.trim() && !files.length)} className="w-full bg-neutral-900 text-white rounded-xl py-2.5 text-sm font-medium disabled:opacity-40">
          {enviando ? (files.length ? 'Subiendo fotos…' : 'Enviando…') : 'Enviar publicación'}
        </button>
        {err && <p className="text-[11px] text-red-600 font-sans">{err}</p>}
      </div>
      <div>
        <p className="text-[10px] font-bold tracking-[0.2em] uppercase text-neutral-500 mb-2">Tus publicaciones</p>
        {pubs === null ? <p className="text-sm text-neutral-400">Cargando…</p> : pubs.length === 0 ? (
          <p className="text-sm text-neutral-400 font-sans">Todavía no mandaste publicaciones.</p>
        ) : (
          <ul className="space-y-2">
            {pubs.map((p) => (
              <li key={p.id} className="rounded-lg border border-black/10 px-3 py-2 font-sans">
                <div className="flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-[12px] font-semibold">{p.modelo ?? 'Publicación'}{p.color ? ` · ${p.color}` : ''}</div>
                    {p.url && <a href={p.url} target="_blank" rel="noreferrer" className="text-[11px] text-[#0004FF] truncate flex items-center gap-1"><ExternalLink size={11} /> {p.url.replace(/^https?:\/\//, '')}</a>}
                  </div>
                  <span className={`shrink-0 text-[10px] rounded-full px-2 py-0.5 font-semibold ${(ESTADO_PUB[p.estado] ?? ESTADO_PUB.nueva)[1]}`}>{(ESTADO_PUB[p.estado] ?? ESTADO_PUB.nueva)[0]}</span>
                </div>
                <Miniaturas urls={p.fotos} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
