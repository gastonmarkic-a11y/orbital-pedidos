// ── Postventa y repuestos de la consigna ────────────────────────────────────
// La central o una sucursal carga el pedido (consigna_postventa, lo administra la Suite en
// Consignas) y lo manda a la conversación del cliente por el mismo canal identificado que el
// chat del catálogo (webhook-web con cod_cliente):
//   · IRIS contesta al instante lo que puede.
//   · Si deriva, llega al grupo de Telegram; lo que responde el equipo desde Telegram o desde
//     Conversaciones de la Suite queda en at_mensajes y se ve acá (consigna_chat, cada 8 s).
import { useEffect, useRef, useState } from 'react'
import { Wrench, Send } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useToast } from '../../lib/toast'
import type { Central, Sucursal } from './CentralConsigna'

const WEBHOOK = 'https://towcgvphxeqilpdnboki.supabase.co/functions/v1/webhook-web'
const CONV_KEY = 'orbital_consigna_conv'

type MsgChat = { id: string; emisor: string; contenido: string; created_at: string }
type Ticket = {
  id: number; sucursal_id: number | null; tipo: 'postventa' | 'repuesto'; producto: string | null; cantidad: number | null
  detalle: string; estado: 'abierto' | 'en_proceso' | 'resuelto'; solicitado_por: string | null; created_at: string
}

const ESTADO: Record<Ticket['estado'], [string, string]> = {
  abierto: ['Abierto', 'bg-amber-100 text-amber-800'],
  en_proceso: ['En proceso', 'bg-sky-100 text-sky-800'],
  resuelto: ['Resuelto', 'bg-emerald-100 text-emerald-800'],
}

const leer = (k: string) => { try { return localStorage.getItem(k) } catch { return null } }
const guardar = (k: string, v: string) => { try { localStorage.setItem(k, v) } catch { /* sin storage */ } }

export default function Postventa({ clave, data, suc, editable, quien }: {
  clave: string; data: Central; suc: Sucursal; editable: boolean; quien: string
}) {
  const toast = useToast()
  const [tickets, setTickets] = useState<Ticket[] | null>(null)
  const [chat, setChat] = useState<MsgChat[]>([])
  const [esperando, setEsperando] = useState(false)
  const [tipo, setTipo] = useState<Ticket['tipo']>('postventa')
  const [producto, setProducto] = useState('')
  const [cantidad, setCantidad] = useState(1)
  const [detalle, setDetalle] = useState('')
  const [texto, setTexto] = useState('')
  const [enviando, setEnviando] = useState(false)
  const caja = useRef<HTMLDivElement | null>(null)

  const cargarTickets = () => supabase.rpc('consigna_postventa_lista', { p_k: clave }).then(({ data }) => setTickets((data as Ticket[]) ?? []))
  const cargarChat = () => supabase.rpc('consigna_chat', { p_k: clave, p_desde: null }).then(({ data }) => { if (data) setChat(data as MsgChat[]) })

  useEffect(() => { cargarTickets(); cargarChat() }, [clave])
  // Respuestas del equipo (Telegram / Suite) entran solas.
  useEffect(() => { const t = setInterval(cargarChat, 8000); return () => clearInterval(t) }, [clave])
  useEffect(() => { if (caja.current) caja.current.scrollTop = caja.current.scrollHeight }, [chat, esperando])

  const nombreSuc = (id: number | null) => data.sucursales.find((s) => s.id === id)?.nombre ?? 'Central'
  const opciones = [...new Set(data.stock.filter((l) => l.sucursal_id === suc.id).map((l) => `${l.modelo} · ${l.descripcion}`))].sort()

  // Todo mensaje sale firmado con sucursal y persona: el equipo ve de dónde viene.
  const mandar = async (contenido: string) => {
    setEsperando(true)
    try {
      const res = await fetch(WEBHOOK, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          conversacionId: leer(CONV_KEY),
          sesionId: `consigna-${data.madre?.cod ?? ''}`,
          texto: contenido,
          identidad: {
            cod_cliente: data.madre?.cod ?? null,
            label: `${data.madre?.cod ?? ''} - ${data.madre?.nombre ?? ''} · ${suc.nombre}`,
            vendedor: null,
            origen: 'consigna',
          },
        }),
      })
      const j = await res.json()
      if (j.conversacionId) guardar(CONV_KEY, j.conversacionId)
    } catch {
      toast('No pudimos conectar. El pedido quedó registrado y lo ve el equipo de Orbital.', 'error')
    }
    setEsperando(false)
    await cargarChat()
  }

  const crear = async () => {
    if (!quien.trim()) return toast('Poné tu nombre arriba antes de cargar el pedido', 'error')
    if (!detalle.trim()) return toast('Contanos qué pasó o qué repuesto necesitás', 'error')
    setEnviando(true)
    const { data: r, error } = await supabase.rpc('consigna_postventa_crear', {
      p_k: clave, p_sucursal: suc.id, p_tipo: tipo, p_producto: producto || null,
      p_cantidad: tipo === 'repuesto' ? cantidad : null, p_detalle: detalle, p_quien: quien.trim(),
    })
    if (error) { setEnviando(false); return toast('No se pudo cargar el pedido. Probá de nuevo.', 'error') }
    const id = (r as { id: number }).id
    await cargarTickets()
    await mandar(
      `[${tipo === 'repuesto' ? 'PEDIDO DE REPUESTO' : 'POSTVENTA'} #${id} · ${data.madre?.nombre ?? ''} · sucursal ${suc.nombre} · ${quien.trim()}]\n` +
      (producto ? `Producto: ${producto}${tipo === 'repuesto' ? ` · Cantidad: ${cantidad}` : ''}\n` : '') +
      detalle.trim(),
    )
    setEnviando(false)
    setDetalle(''); setProducto(''); setCantidad(1)
    toast('Pedido cargado y enviado a Orbital', 'success')
  }

  const responder = async () => {
    const t = texto.trim()
    if (!t) return
    if (!quien.trim()) return toast('Poné tu nombre arriba antes de escribir', 'error')
    setTexto('')
    await mandar(`[${suc.nombre} · ${quien.trim()}] ${t}`)
  }

  const campo = 'w-full bg-white border border-black/15 rounded-lg px-3 py-2 text-sm'

  return (
    <div className="grid lg:grid-cols-[minmax(0,360px)_1fr] gap-4 items-start">
      <div className="flex flex-col gap-4">
        <section className="bg-white border border-black/10 rounded-lg p-4 flex flex-col gap-3">
          <h2 className="font-semibold flex items-center gap-2"><Wrench size={16} /> Nuevo pedido · {suc.nombre}</h2>
          {!editable ? (
            <p className="text-sm text-red-600">Con este link no podés cargar pedidos para {suc.nombre}.</p>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-1 bg-black/5 rounded-lg p-1">
                {(['postventa', 'repuesto'] as const).map((t) => (
                  <button key={t} onClick={() => setTipo(t)}
                    className={`text-sm rounded-md py-1.5 ${tipo === t ? 'bg-white shadow-sm font-semibold' : 'text-muted'}`}>
                    {t === 'postventa' ? 'Postventa / garantía' : 'Repuesto'}
                  </button>
                ))}
              </div>
              <label className="text-xs text-muted flex flex-col gap-1">
                Producto
                <input id="pv-producto" list="pv-productos" value={producto} onChange={(e) => setProducto(e.target.value)}
                  placeholder="Modelo y color (podés escribirlo)" className={campo} />
                <datalist id="pv-productos">{opciones.map((o) => <option key={o} value={o} />)}</datalist>
              </label>
              {tipo === 'repuesto' && (
                <label className="text-xs text-muted flex flex-col gap-1">
                  Cantidad
                  <input id="pv-cantidad" type="number" min={1} value={cantidad}
                    onChange={(e) => setCantidad(Math.max(1, Math.floor(Number(e.target.value) || 1)))} className={campo} />
                </label>
              )}
              <label className="text-xs text-muted flex flex-col gap-1">
                {tipo === 'repuesto' ? 'Qué repuesto necesitás' : 'Qué pasó'}
                <textarea id="pv-detalle" value={detalle} onChange={(e) => setDetalle(e.target.value)} rows={4}
                  placeholder={tipo === 'repuesto' ? 'Ej: patilla izquierda, tornillos de bisagra, plaquetas…' : 'Ej: se despegó la bisagra, el cliente lo compró hace 2 meses…'}
                  className={campo} />
              </label>
              <button onClick={crear} disabled={enviando} className="bg-ink text-white rounded-lg py-2.5 text-sm font-medium disabled:opacity-40">
                {enviando ? 'Enviando…' : 'Cargar y enviar a Orbital'}
              </button>
            </>
          )}
        </section>

        <section className="bg-white border border-black/10 rounded-lg">
          <h3 className="text-sm font-semibold px-4 py-3 border-b border-black/10">Pedidos cargados</h3>
          {tickets == null ? <p className="text-sm text-muted px-4 py-3">Cargando…</p> : tickets.length === 0 ? (
            <p className="text-sm text-muted px-4 py-3">Todavía no hay pedidos.</p>
          ) : (
            <ul className="divide-y divide-black/5">
              {tickets.map((t) => (
                <li key={t.id} className="px-4 py-2 text-sm flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium">#{t.id} · {t.tipo === 'repuesto' ? 'Repuesto' : 'Postventa'} · {nombreSuc(t.sucursal_id)}</div>
                    <div className="text-xs text-muted truncate">{t.producto ? `${t.producto} · ` : ''}{t.detalle}</div>
                  </div>
                  <span className={`text-[11px] font-medium rounded-full px-2 py-0.5 whitespace-nowrap ${ESTADO[t.estado][1]}`}>{ESTADO[t.estado][0]}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="bg-white border border-black/10 rounded-lg flex flex-col">
        <header className="px-4 py-3 border-b border-black/10">
          <h3 className="font-semibold text-sm">Conversación con Orbital</h3>
          <p className="text-xs text-muted">IRIS responde al instante lo que puede; si hace falta, te contesta alguien del equipo por acá.</p>
        </header>
        <div ref={caja} className="px-4 py-3 flex flex-col gap-2 h-[460px] overflow-y-auto bg-[#FBFAF7]">
          {chat.length === 0 && !esperando && <p className="text-sm text-muted">Cuando cargues un pedido, la charla aparece acá.</p>}
          {chat.map((m) => {
            const propio = m.emisor === 'cliente'
            const equipo = m.emisor === 'agente' || m.emisor === 'humano'
            return (
              <div key={m.id} className={`max-w-[85%] rounded-2xl px-3 py-2 text-[13px] leading-snug whitespace-pre-wrap ${
                propio ? 'ml-auto bg-ink text-white rounded-br-md' : 'bg-white border border-black/10 rounded-bl-md'}`}>
                {!propio && <div className="text-[10px] font-semibold text-gold mb-0.5">{equipo ? 'Equipo Orbital' : 'IRIS · Orbital'}</div>}
                {m.contenido}
                <div className={`text-[10px] mt-1 ${propio ? 'text-white/50' : 'text-faint'}`}>
                  {new Date(m.created_at).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>
            )
          })}
          {esperando && <div className="bg-white border border-black/10 rounded-2xl rounded-bl-md px-3 py-2 text-sm text-faint w-14">…</div>}
        </div>
        {editable && (
          <div className="flex items-center gap-2 border-t border-black/10 px-3 py-2">
            <input id="pv-responder" value={texto} onChange={(e) => setTexto(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') responder() }}
              placeholder="Escribí a Orbital…" className="flex-1 text-sm outline-none bg-transparent py-1.5" />
            <button onClick={responder} disabled={esperando || !texto.trim()} aria-label="Enviar" className="rounded-full bg-ink text-white p-2 disabled:opacity-40">
              <Send size={14} />
            </button>
          </div>
        )}
      </section>
    </div>
  )
}
