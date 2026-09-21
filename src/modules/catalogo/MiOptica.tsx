// ── Panel de la óptica dentro del catálogo ──────────────────────────────────
// Tres solapas, solo para accesos de óptica (el token trae cod_cliente):
//   · Postventa: garantía / rotura / repuesto. Queda el ticket (optica_postventa) y el aviso
//     entra por la misma conversación del chat del catálogo (webhook-web), así IRIS lo deriva
//     a posventa y la respuesta vuelve al chat.
//   · Mis anteojos: lo que Orbital le vendió (Tango + Suite). Lo que tacha deja de salir como
//     "dónde comprar" cuando un cliente final le pregunta al bot. Al consumidor solo le llega
//     nombre y dirección de la óptica: nada de precios ni catálogo mayorista.
//   · Mis publicaciones: los links de lo que publicó con Orbital, para que Orbital lo comparta
//     mandando a la dirección de la óptica.
import { useEffect, useState } from 'react'
import { X, Wrench, Glasses, Megaphone, ExternalLink } from 'lucide-react'
import { supabase } from '../../lib/supabase'

const WEBHOOK = 'https://towcgvphxeqilpdnboki.supabase.co/functions/v1/webhook-web'
const CHAT_CONV_KEY = 'orbital_catalogo_conv'
const CHAT_SES_KEY = 'orbital_catalogo_chat_ses'
const QUIEN_KEY = 'orbital_catalogo_quien'

const leer = (k: string) => { try { return localStorage.getItem(k) } catch { return null } }
const guardar = (k: string, v: string) => { try { localStorage.setItem(k, v) } catch { /* sin storage */ } }

type Ticket = {
  id: number; tipo: 'postventa' | 'repuesto'; producto: string | null; cantidad: number | null
  detalle: string; estado: 'abierto' | 'en_proceso' | 'resuelto'; solicitado_por: string | null; created_at: string
}
type MiModelo = { modelo: string; anio: number; unidades: number; baja: boolean }
type Publicacion = { id: number; modelo: string | null; color: string | null; url: string; estado: string; created_at: string }

const ESTADO: Record<Ticket['estado'], [string, string]> = {
  abierto: ['Abierto', 'bg-amber-100 text-amber-800'],
  en_proceso: ['En proceso', 'bg-sky-100 text-sky-800'],
  resuelto: ['Resuelto', 'bg-emerald-100 text-emerald-800'],
}

export type Solapa = 'postventa' | 'anteojos' | 'publicaciones'

// Aviso al equipo por la conversación del chat del catálogo (misma que usa ChatIris).
export async function avisarOrbital(texto: string, identidad: { cod_cliente: string | null; label: string | null; vendedor: string | null }) {
  let ses = leer(CHAT_SES_KEY)
  if (!ses) { ses = 'cat-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8); guardar(CHAT_SES_KEY, ses) }
  try {
    const res = await fetch(WEBHOOK, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ conversacionId: leer(CHAT_CONV_KEY) || null, sesionId: ses, texto, identidad: { ...identidad, origen: 'catalogo' } }),
    })
    const j = await res.json()
    if (j.conversacionId) guardar(CHAT_CONV_KEY, j.conversacionId)
  } catch { /* el ticket ya quedó registrado */ }
}

export function PublicarLink({ clave, modelo, color }: {
  clave: string; modelo: string; color: string | null
}) {
  const [url, setUrl] = useState('')
  const [estado, setEstado] = useState<'no' | 'enviando' | 'ok' | 'error'>('no')
  async function enviar() {
    if (!/^https?:\/\//i.test(url.trim())) { setEstado('error'); return }
    setEstado('enviando')
    const { error } = await supabase.rpc('catalogo_publicacion_crear', { p_clave: clave, p_modelo: modelo, p_color: color, p_url: url.trim(), p_foto: null })
    if (error) { setEstado('error'); return }
    setEstado('ok'); setUrl('')
  }
  if (estado === 'ok') return <p className="mt-2 text-[11px] text-emerald-700 font-sans font-semibold">¡Gracias! Lo recibimos: el equipo de Orbital lo va a compartir mandando a tu óptica.</p>
  return (
    <div className="mt-3 pt-3 border-t border-fuchsia-200">
      <p className="text-[11px] font-semibold font-sans">¿Ya lo publicaste? Pegá el link</p>
      <p className="text-[10px] text-neutral-500 font-sans mb-1.5">Orbital comparte las publicaciones de sus ópticas en sus redes, con la dirección de tu local.</p>
      <div className="flex gap-2">
        <input value={url} onChange={(e) => { setUrl(e.target.value); if (estado === 'error') setEstado('no') }} placeholder="https://instagram.com/p/…"
          className="flex-1 min-w-0 rounded-lg border border-black/10 bg-white px-2.5 py-1.5 text-[12px] font-sans" />
        <button onClick={enviar} disabled={estado === 'enviando' || !url.trim()} className="rounded-lg bg-neutral-900 text-white px-3 text-[11px] font-bold disabled:opacity-40">
          {estado === 'enviando' ? '…' : 'Enviar'}
        </button>
      </div>
      {estado === 'error' && <p className="text-[10px] text-red-600 mt-1 font-sans">Pegá el link completo de la publicación (empieza con https://).</p>}
    </div>
  )
}

export default function MiOptica({ clave, identidad, inicial, onClose }: {
  clave: string
  identidad: { cod_cliente: string | null; label: string | null; vendedor: string | null }
  inicial: Solapa
  onClose: () => void
}) {
  const [solapa, setSolapa] = useState<Solapa>(inicial)
  const [modelos, setModelos] = useState<MiModelo[] | null>(null)
  const [tickets, setTickets] = useState<Ticket[] | null>(null)
  const [pubs, setPubs] = useState<Publicacion[] | null>(null)

  const cargarModelos = () => supabase.rpc('catalogo_mis_modelos', { p_clave: clave }).then(({ data }) => setModelos((data as MiModelo[]) ?? []))
  const cargarTickets = () => supabase.rpc('catalogo_postventa_lista', { p_clave: clave }).then(({ data }) => setTickets((data as Ticket[]) ?? []))
  const cargarPubs = () => supabase.rpc('catalogo_publicaciones', { p_clave: clave }).then(({ data }) => setPubs((data as Publicacion[]) ?? []))
  useEffect(() => { cargarModelos(); cargarTickets(); cargarPubs() }, [clave]) // eslint-disable-line react-hooks/exhaustive-deps

  const SOLAPAS: [Solapa, string, typeof Wrench][] = [
    ['postventa', 'Postventa', Wrench],
    ['anteojos', 'Mis anteojos', Glasses],
    ['publicaciones', 'Mis publicaciones', Megaphone],
  ]

  return (
    <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white w-full sm:max-w-lg sm:rounded-2xl rounded-t-2xl max-h-[92vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-black/5 px-4 pt-3 z-10">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold">Mi óptica</h2>
            <button onClick={onClose} className="p-1.5 rounded-full hover:bg-black/5"><X size={20} /></button>
          </div>
          <div className="flex gap-1 mt-2 -mb-px">
            {SOLAPAS.map(([k, label, Icono]) => (
              <button key={k} onClick={() => setSolapa(k)}
                className={`flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide px-3 py-2 border-b-2 ${solapa === k ? 'border-[#0004FF] text-[#0004FF]' : 'border-transparent text-neutral-500'}`}>
                <Icono size={13} /> {label}
              </button>
            ))}
          </div>
        </div>
        <div className="p-4">
          {solapa === 'postventa' && <SolapaPostventa clave={clave} identidad={identidad} modelos={modelos ?? []} tickets={tickets} onCargado={cargarTickets} />}
          {solapa === 'anteojos' && <SolapaAnteojos clave={clave} modelos={modelos} onCambio={cargarModelos} />}
          {solapa === 'publicaciones' && <SolapaPublicaciones clave={clave} modelos={modelos ?? []} pubs={pubs} onCargado={cargarPubs} />}
        </div>
      </div>
    </div>
  )
}

const campo = 'w-full bg-white border border-black/15 rounded-lg px-3 py-2 text-sm font-sans'

function SolapaPostventa({ clave, identidad, modelos, tickets, onCargado }: {
  clave: string; identidad: { cod_cliente: string | null; label: string | null; vendedor: string | null }
  modelos: MiModelo[]; tickets: Ticket[] | null; onCargado: () => void
}) {
  const [tipo, setTipo] = useState<Ticket['tipo']>('postventa')
  const [producto, setProducto] = useState('')
  const [cantidad, setCantidad] = useState(1)
  const [detalle, setDetalle] = useState('')
  const [quien, setQuien] = useState(() => leer(QUIEN_KEY) ?? '')
  const [enviando, setEnviando] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null)

  async function crear() {
    if (!detalle.trim()) { setMsg({ ok: false, t: 'Contanos qué pasó o qué repuesto necesitás.' }); return }
    setEnviando(true); setMsg(null)
    if (quien.trim()) guardar(QUIEN_KEY, quien.trim())
    const { data, error } = await supabase.rpc('catalogo_postventa_crear', {
      p_clave: clave, p_tipo: tipo, p_producto: producto || null, p_cantidad: tipo === 'repuesto' ? cantidad : null,
      p_detalle: detalle, p_quien: quien.trim() || null,
    })
    if (error) { setEnviando(false); setMsg({ ok: false, t: 'No se pudo cargar. Probá de nuevo.' }); return }
    const id = (data as { id: number }).id
    await avisarOrbital(
      `[${tipo === 'repuesto' ? 'PEDIDO DE REPUESTO' : 'POSTVENTA'} #${id} · catálogo${quien.trim() ? ` · ${quien.trim()}` : ''}]\n` +
      (producto ? `Producto: ${producto}${tipo === 'repuesto' ? ` · Cantidad: ${cantidad}` : ''}\n` : '') + detalle.trim(),
      identidad,
    )
    setEnviando(false); setDetalle(''); setProducto(''); setCantidad(1)
    setMsg({ ok: true, t: `Listo, quedó el pedido #${id}. Te respondemos por el chat del catálogo.` })
    onCargado()
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-black/10 p-3 space-y-2.5">
        <p className="text-[11px] text-neutral-500 font-sans">Garantías, roturas y repuestos. Cargalo acá y te respondemos por el chat del catálogo.</p>
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
          placeholder={tipo === 'repuesto' ? '¿Qué repuesto necesitás? (varilla, tornillo, plaqueta…)' : '¿Qué pasó? Si podés, mandanos después una foto por el chat.'} className={campo} />
        <input value={quien} onChange={(e) => setQuien(e.target.value)} placeholder="Tu nombre (opcional)" className={campo} />
        <button onClick={crear} disabled={enviando} className="w-full bg-[#0004FF] text-white rounded-xl py-2.5 text-sm font-medium disabled:opacity-50">
          {enviando ? 'Enviando…' : 'Cargar pedido'}
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
  clave: string
  modelos: MiModelo[]; pubs: Publicacion[] | null; onCargado: () => void
}) {
  const [modelo, setModelo] = useState('')
  const [url, setUrl] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  async function enviar() {
    if (!/^https?:\/\//i.test(url.trim())) { setErr('Pegá el link completo de la publicación (empieza con https://).'); return }
    setEnviando(true); setErr(null)
    const { error } = await supabase.rpc('catalogo_publicacion_crear', { p_clave: clave, p_modelo: modelo || null, p_color: null, p_url: url.trim(), p_foto: null })
    setEnviando(false)
    if (error) { setErr('No se pudo guardar. Probá de nuevo.'); return }
    setUrl(''); setModelo(''); onCargado()
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
          ¿Publicaste un anteojo Orbital en las redes de tu óptica? Pegá el link: Orbital lo comparte en sus redes <b>con la dirección de tu local</b>.
        </p>
        <input list="mi-optica-modelos-pub" value={modelo} onChange={(e) => setModelo(e.target.value)} placeholder="Modelo (opcional)" className={campo} />
        <datalist id="mi-optica-modelos-pub">{modelos.map((m) => <option key={m.modelo} value={m.modelo} />)}</datalist>
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://instagram.com/p/…" className={campo} />
        <button onClick={enviar} disabled={enviando || !url.trim()} className="w-full bg-neutral-900 text-white rounded-xl py-2.5 text-sm font-medium disabled:opacity-40">
          {enviando ? 'Enviando…' : 'Enviar publicación'}
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
              <li key={p.id} className="rounded-lg border border-black/10 px-3 py-2 flex items-center gap-2 font-sans">
                <div className="flex-1 min-w-0">
                  <div className="text-[12px] font-semibold">{p.modelo ?? 'Publicación'}{p.color ? ` · ${p.color}` : ''}</div>
                  <a href={p.url} target="_blank" rel="noreferrer" className="text-[11px] text-[#0004FF] truncate flex items-center gap-1"><ExternalLink size={11} /> {p.url.replace(/^https?:\/\//, '')}</a>
                </div>
                <span className={`shrink-0 text-[10px] rounded-full px-2 py-0.5 font-semibold ${(ESTADO_PUB[p.estado] ?? ESTADO_PUB.nueva)[1]}`}>{(ESTADO_PUB[p.estado] ?? ESTADO_PUB.nueva)[0]}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
