// ── Red de ópticas ───────────────────────────────────────────────────────────
// Lo que llega de las ópticas por el catálogo, en una pantalla:
//   · Postventa: tickets de garantía / rotura / repuesto con fotos (optica_postventa). Cada alta
//     avisa al grupo de Telegram para Postventa (trigger optica_postventa_aviso).
//   · Dónde comprar: qué ópticas tienen cada modelo según lo que les vendimos (Tango + Suite),
//     menos lo que la óptica tachó. Es lo mismo que usa IRIS para derivar al cliente final.
//   · Publicaciones: links y fotos que mandan las ópticas para que Orbital los comparta. Al compartir,
//     siempre a la dirección de la óptica: nunca precios, catálogo ni tienda online.
import { useEffect, useState } from 'react'
import { ExternalLink, MapPin, Search } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useToast } from '../../lib/toast'

type Vista = 'postventa' | 'donde' | 'publicaciones'
type Cli = { cod: string; nomcomerc: string | null; razon: string | null; direccion: string | null; localidad: string | null; provincia: string | null; telefono: string | null }
type Ticket = { id: number; cod_cliente: string; tipo: string; fotos: string[]; producto: string | null; cantidad: number | null; detalle: string; estado: 'abierto' | 'en_proceso' | 'resuelto'; solicitado_por: string | null; created_at: string }
type Pub = { id: number; cod_cliente: string; modelo: string | null; color: string | null; url: string; fotos: string[]; estado: 'nueva' | 'compartida' | 'descartada'; created_at: string }
type Donde = { cod: string; nombre: string; direccion: string | null; localidad: string | null; provincia: string | null; anio: number; unidades: number }

// Fotos que subió la óptica (bucket optica-fotos): miniatura que abre la foto completa para descargar.
function Fotos({ urls }: { urls?: string[] }) {
  if (!urls?.length) return null
  return (
    <div className="flex flex-wrap gap-2 mt-2">
      {urls.map((u) => <a key={u} href={u} target="_blank" rel="noreferrer"><img src={u} alt="" className="w-20 h-20 rounded-lg object-cover border border-black/10" /></a>)}
    </div>
  )
}

const nombreDe = (c?: Cli) => (c?.nomcomerc?.trim() || c?.razon || '')
const dirDe = (c?: Cli) => [c?.direccion, c?.localidad, c?.provincia].filter(Boolean).join(', ')

async function clientesDe(cods: string[]) {
  const m = new Map<string, Cli>()
  if (!cods.length) return m
  const { data } = await supabase.from('clientes').select('cod, nomcomerc, razon, direccion, localidad, provincia, telefono').in('cod', [...new Set(cods)])
  for (const c of (data ?? []) as Cli[]) m.set(c.cod, c)
  return m
}

export default function RedOpticas() {
  const [vista, setVista] = useState<Vista>('postventa')
  const TABS: [Vista, string][] = [['postventa', 'Postventa'], ['donde', 'Dónde comprar'], ['publicaciones', 'Publicaciones']]
  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      <h1 className="text-xl font-semibold">Red de ópticas</h1>
      <p className="text-sm text-muted mt-1 mb-4">Lo que mandan las ópticas desde el catálogo y dónde se consigue cada modelo.</p>
      <div className="flex gap-1 border-b border-black/10 mb-4">
        {TABS.map(([k, l]) => (
          <button key={k} onClick={() => setVista(k)} className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px ${vista === k ? 'border-[#0004FF] text-[#0004FF]' : 'border-transparent text-muted'}`}>{l}</button>
        ))}
      </div>
      {vista === 'postventa' && <PostventaTickets />}
      {vista === 'donde' && <DondeComprar />}
      {vista === 'publicaciones' && <Publicaciones />}
    </div>
  )
}

const ESTADO_T: Record<Ticket['estado'], [string, string]> = {
  abierto: ['Abierto', 'bg-amber-100 text-amber-800'],
  en_proceso: ['En proceso', 'bg-sky-100 text-sky-800'],
  resuelto: ['Resuelto', 'bg-emerald-100 text-emerald-800'],
}

export function PostventaTickets() {
  const toast = useToast()
  const [ts, setTs] = useState<Ticket[] | null>(null)
  const [clis, setClis] = useState<Map<string, Cli>>(new Map())
  const [verResueltos, setVerResueltos] = useState(false)
  const cargar = async () => {
    const { data } = await supabase.from('optica_postventa').select('*').order('id', { ascending: false }).limit(300)
    const t = (data ?? []) as Ticket[]
    setClis(await clientesDe(t.map((x) => x.cod_cliente)))
    setTs(t)
  }
  useEffect(() => { cargar() }, [])
  const cambiar = async (t: Ticket, estado: Ticket['estado']) => {
    const { error } = await supabase.from('optica_postventa').update({ estado, updated_at: new Date().toISOString() }).eq('id', t.id)
    if (error) return toast('No se pudo actualizar', 'error')
    cargar()
  }
  if (!ts) return <p className="text-sm text-muted">Cargando…</p>
  const lista = ts.filter((t) => verResueltos || t.estado !== 'resuelto')
  return (
    <div>
      <label className="flex items-center gap-2 text-sm text-muted mb-3">
        <input type="checkbox" checked={verResueltos} onChange={(e) => setVerResueltos(e.target.checked)} /> Ver resueltos
      </label>
      {lista.length === 0 ? <p className="text-sm text-muted bg-white border border-black/10 rounded-xl px-4 py-6">Sin pedidos de postventa.</p> : (
        <ul className="space-y-2">
          {lista.map((t) => {
            const c = clis.get(t.cod_cliente)
            return (
              <li key={t.id} className="bg-white border border-black/10 rounded-xl px-4 py-3">
                <div className="flex flex-wrap items-center gap-2 justify-between">
                  <div className="text-sm font-semibold">#{t.id} · {t.tipo === 'repuesto' ? 'Repuesto' : 'Postventa'} · {nombreDe(c) || t.cod_cliente} <span className="text-muted font-normal">({t.cod_cliente})</span></div>
                  <span className={`text-[11px] rounded-full px-2 py-0.5 ${ESTADO_T[t.estado][1]}`}>{ESTADO_T[t.estado][0]}</span>
                </div>
                {t.producto && <div className="text-sm mt-1">Producto: <b>{t.producto}</b>{t.cantidad ? ` · ${t.cantidad} u.` : ''}</div>}
                <p className="text-sm text-neutral-700 mt-1 whitespace-pre-wrap">{t.detalle}</p>
                <Fotos urls={t.fotos} />
                <div className="text-[11px] text-muted mt-1">{new Date(t.created_at).toLocaleString('es-AR')}{t.solicitado_por ? ` · ${t.solicitado_por}` : ''}{c?.telefono ? ` · tel ${c.telefono}` : ''}</div>
                <div className="flex gap-2 mt-2">
                  {(['abierto', 'en_proceso', 'resuelto'] as const).filter((e) => e !== t.estado).map((e) => (
                    <button key={e} onClick={() => cambiar(t, e)} className="text-[12px] rounded-lg border border-black/15 px-2.5 py-1 hover:bg-black/5">Pasar a {ESTADO_T[e][0].toLowerCase()}</button>
                  ))}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

function DondeComprar() {
  const [modelo, setModelo] = useState('')
  const [zona, setZona] = useState('')
  const [res, setRes] = useState<Donde[] | null>(null)
  const [buscando, setBuscando] = useState(false)
  const buscar = async () => {
    if (!modelo.trim()) return
    setBuscando(true)
    const { data } = await supabase.rpc('donde_comprar', { p_modelo: modelo.trim(), p_zona: zona.trim() || null })
    setRes((data as Donde[]) ?? []); setBuscando(false)
  }
  return (
    <div>
      <p className="text-sm text-muted mb-3">Ópticas que compraron el modelo este año o el anterior y no lo tacharon en su catálogo. Es lo que IRIS le pasa al cliente final que pregunta dónde conseguirlo (solo nombre y dirección).</p>
      <form onSubmit={(e) => { e.preventDefault(); buscar() }} className="flex flex-wrap gap-2 mb-4">
        <input value={modelo} onChange={(e) => setModelo(e.target.value)} placeholder="Modelo (ej: Adelaida)" className="flex-1 min-w-[160px] bg-white border border-black/15 rounded-lg px-3 py-2 text-sm" />
        <input value={zona} onChange={(e) => setZona(e.target.value)} placeholder="Zona (opcional: Rosario, Palermo…)" className="flex-1 min-w-[160px] bg-white border border-black/15 rounded-lg px-3 py-2 text-sm" />
        <button disabled={buscando || !modelo.trim()} className="flex items-center gap-1.5 bg-[#0004FF] text-white rounded-lg px-4 py-2 text-sm disabled:opacity-50"><Search size={15} /> Buscar</button>
      </form>
      {res && (res.length === 0 ? <p className="text-sm text-muted">Ninguna óptica con ese modelo{zona ? ' en esa zona' : ''}.</p> : (
        <>
          <p className="text-[12px] text-muted mb-2">{res.length} ópticas</p>
          <ul className="bg-white border border-black/10 rounded-xl divide-y divide-black/5">
            {res.map((d) => (
              <li key={d.cod} className="px-4 py-2.5 flex items-start gap-3">
                <MapPin size={15} className="mt-0.5 text-muted shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium">{d.nombre} <span className="text-muted font-normal text-[12px]">({d.cod})</span></div>
                  <div className="text-[12px] text-muted">{[d.direccion, d.localidad, d.provincia].filter(Boolean).join(', ')}</div>
                </div>
                <div className="text-[11px] text-muted shrink-0 text-right">{d.unidades} u.<br />{d.anio}</div>
              </li>
            ))}
          </ul>
        </>
      ))}
    </div>
  )
}

const ESTADO_P: Record<Pub['estado'], [string, string]> = {
  nueva: ['Nueva', 'bg-amber-100 text-amber-800'],
  compartida: ['Compartida', 'bg-emerald-100 text-emerald-800'],
  descartada: ['Descartada', 'bg-neutral-100 text-neutral-600'],
}

function Publicaciones() {
  const toast = useToast()
  const [ps, setPs] = useState<Pub[] | null>(null)
  const [clis, setClis] = useState<Map<string, Cli>>(new Map())
  const cargar = async () => {
    const { data } = await supabase.from('optica_publicacion').select('*').order('id', { ascending: false }).limit(300)
    const p = (data ?? []) as Pub[]
    setClis(await clientesDe(p.map((x) => x.cod_cliente)))
    setPs(p)
  }
  useEffect(() => { cargar() }, [])
  const cambiar = async (p: Pub, estado: Pub['estado']) => {
    const { error } = await supabase.from('optica_publicacion').update({ estado, updated_at: new Date().toISOString() }).eq('id', p.id)
    if (error) return toast('No se pudo actualizar', 'error')
    cargar()
  }
  // Texto para las redes de Orbital: siempre a la dirección de la óptica, nunca a la tienda online.
  const textoRepost = (p: Pub, c?: Cli) =>
    `${p.modelo ? `${p.modelo.charAt(0) + p.modelo.slice(1).toLowerCase()}${p.color ? ` · ${p.color}` : ''}` : 'Orbital'} en ${nombreDe(c)} 🕶️\n📍 ${dirDe(c)}\nVení a probártelo.`
  if (!ps) return <p className="text-sm text-muted">Cargando…</p>
  return (
    <div>
      <p className="text-sm text-muted mb-3">Publicaciones que las ópticas hicieron con anteojos Orbital. Al compartirlas en las redes de Orbital, mandá siempre a la dirección de la óptica: sin precios ni links a la tienda online.</p>
      {ps.length === 0 ? <p className="text-sm text-muted bg-white border border-black/10 rounded-xl px-4 py-6">Todavía no llegaron publicaciones.</p> : (
        <ul className="space-y-2">
          {ps.map((p) => {
            const c = clis.get(p.cod_cliente)
            const txt = textoRepost(p, c)
            return (
              <li key={p.id} className="bg-white border border-black/10 rounded-xl px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm font-semibold">{nombreDe(c) || p.cod_cliente} <span className="text-muted font-normal">({p.cod_cliente})</span>{p.modelo ? ` · ${p.modelo}` : ''}</div>
                  <span className={`text-[11px] rounded-full px-2 py-0.5 ${ESTADO_P[p.estado][1]}`}>{ESTADO_P[p.estado][0]}</span>
                </div>
                {p.url && <a href={p.url} target="_blank" rel="noreferrer" className="text-[13px] text-[#0004FF] flex items-center gap-1 mt-1 break-all"><ExternalLink size={13} /> {p.url}</a>}
                <Fotos urls={p.fotos} />
                <div className="text-[12px] text-muted mt-1">{dirDe(c) || 'Sin dirección cargada en la ficha del cliente'} · {new Date(p.created_at).toLocaleDateString('es-AR')}</div>
                <pre className="whitespace-pre-wrap text-[12px] bg-[#F5F5F7] rounded-lg p-2 mt-2 font-sans">{txt}</pre>
                <div className="flex flex-wrap gap-2 mt-2">
                  <button onClick={() => { navigator.clipboard?.writeText(txt); toast('Texto copiado', 'success') }} className="text-[12px] rounded-lg border border-black/15 px-2.5 py-1 hover:bg-black/5">Copiar texto</button>
                  {p.estado !== 'compartida' && <button onClick={() => cambiar(p, 'compartida')} className="text-[12px] rounded-lg bg-emerald-600 text-white px-2.5 py-1">Marcar compartida</button>}
                  {p.estado !== 'descartada' && <button onClick={() => cambiar(p, 'descartada')} className="text-[12px] rounded-lg border border-black/15 px-2.5 py-1 hover:bg-black/5">Descartar</button>}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
