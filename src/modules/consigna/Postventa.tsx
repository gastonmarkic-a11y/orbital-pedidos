// ── Postventa y repuestos de la consigna ────────────────────────────────────
// La central o una sucursal carga el pedido (queda en consigna_postventa para el equipo)
// y se lo pasa a IRIS por el mismo canal identificado que usa el chat del catálogo
// (webhook-web con cod_cliente). IRIS contesta lo que puede; si no, deriva al grupo de
// Telegram con la razón social. Cada intercambio se guarda en el pedido.
import { useEffect, useState } from 'react'
import { Wrench, Send } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useToast } from '../../lib/toast'
import type { Central, Sucursal } from './CentralConsigna'

const WEBHOOK = 'https://towcgvphxeqilpdnboki.supabase.co/functions/v1/webhook-web'

type Msg = { de: 'cliente' | 'iris'; texto: string; at: string }
type Ticket = {
  id: number; sucursal_id: number | null; tipo: 'postventa' | 'repuesto'; producto: string | null; cantidad: number | null
  detalle: string; estado: 'abierto' | 'en_proceso' | 'resuelto'; solicitado_por: string | null
  conversacion_id: string | null; chat: Msg[]; created_at: string
}

const ESTADO: Record<Ticket['estado'], [string, string]> = {
  abierto: ['Abierto', 'bg-amber-100 text-amber-800'],
  en_proceso: ['En proceso', 'bg-sky-100 text-sky-800'],
  resuelto: ['Resuelto', 'bg-emerald-100 text-emerald-800'],
}

async function preguntarIris(t: Ticket, texto: string, madre: Central['madre'], sucNombre: string) {
  const res = await fetch(WEBHOOK, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      conversacionId: t.conversacion_id,
      sesionId: `consigna-pv-${t.id}`,
      texto,
      identidad: {
        cod_cliente: madre?.cod ?? null,
        label: `${madre?.cod ?? ''} - ${madre?.nombre ?? ''} · ${sucNombre}`,
        vendedor: null,
        origen: 'consigna_postventa',
      },
    }),
  })
  const j = await res.json()
  return { conversacionId: (j.conversacionId as string) ?? null, texto: (j.texto as string) || (j.silencio ? '' : 'Recibimos tu pedido, en breve te responde el equipo de postventa.') }
}

export default function Postventa({ clave, data, suc, editable, quien }: {
  clave: string; data: Central; suc: Sucursal; editable: boolean; quien: string
}) {
  const toast = useToast()
  const [tickets, setTickets] = useState<Ticket[] | null>(null)
  const [tipo, setTipo] = useState<Ticket['tipo']>('postventa')
  const [producto, setProducto] = useState('')
  const [cantidad, setCantidad] = useState(1)
  const [detalle, setDetalle] = useState('')
  const [enviando, setEnviando] = useState(false)

  const cargar = () => supabase.rpc('consigna_postventa_lista', { p_k: clave }).then(({ data }) => setTickets((data as Ticket[]) ?? []))
  useEffect(() => { cargar() }, [clave])

  const nombreSuc = (id: number | null) => data.sucursales.find((s) => s.id === id)?.nombre ?? 'Central'
  // productos que la sucursal tiene, para elegir rápido
  const opciones = [...new Set(data.stock.filter((l) => l.sucursal_id === suc.id).map((l) => `${l.modelo} · ${l.descripcion}`))].sort()

  const conversar = async (t: Ticket, texto: string) => {
    const ahora = new Date().toISOString()
    let r: { conversacionId: string | null; texto: string }
    try {
      r = await preguntarIris(t, texto, data.madre, nombreSuc(t.sucursal_id))
    } catch {
      r = { conversacionId: null, texto: 'No pudimos conectar con IRIS. El pedido quedó registrado y lo ve el equipo de postventa.' }
    }
    const msgs: Msg[] = [{ de: 'cliente', texto, at: ahora }]
    if (r.texto) msgs.push({ de: 'iris', texto: r.texto, at: new Date().toISOString() })
    await supabase.rpc('consigna_postventa_chat', { p_k: clave, p_id: t.id, p_conversacion: r.conversacionId, p_msgs: msgs })
    await cargar()
  }

  const crear = async () => {
    if (!quien.trim()) return toast('Poné tu nombre arriba antes de cargar el pedido', 'error')
    if (!detalle.trim()) return toast('Contanos qué pasó o qué repuesto necesitás', 'error')
    setEnviando(true)
    const { data: r, error } = await supabase.rpc('consigna_postventa_crear', {
      p_k: clave, p_sucursal: suc.id, p_tipo: tipo, p_producto: producto || null,
      p_cantidad: cantidad || null, p_detalle: detalle, p_quien: quien.trim(),
    })
    if (error) { setEnviando(false); return toast('No se pudo cargar el pedido. Probá de nuevo.', 'error') }
    const t: Ticket = {
      id: (r as { id: number }).id, sucursal_id: suc.id, tipo, producto: producto || null, cantidad, detalle,
      estado: 'abierto', solicitado_por: quien, conversacion_id: null, chat: [], created_at: new Date().toISOString(),
    }
    const texto = `[${tipo === 'repuesto' ? 'PEDIDO DE REPUESTO' : 'POSTVENTA'} · consigna ${data.madre?.nombre ?? ''} · sucursal ${suc.nombre} · pedido #${t.id}]\n` +
      (producto ? `Producto: ${producto}${tipo === 'repuesto' ? ` · Cantidad: ${cantidad}` : ''}\n` : '') +
      `${detalle.trim()}\n(Carga: ${quien.trim()})`
    await conversar(t, texto)
    setEnviando(false)
    setDetalle(''); setProducto(''); setCantidad(1)
    toast('Pedido de postventa cargado', 'success')
  }

  const campo = 'w-full bg-white border border-black/15 rounded-lg px-3 py-2 text-sm'

  return (
    <div className="grid lg:grid-cols-[minmax(0,380px)_1fr] gap-4 items-start">
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
              {enviando ? 'Enviando…' : 'Cargar y consultar a IRIS'}
            </button>
            <p className="text-[11px] text-faint">IRIS responde lo que puede al instante. Si hace falta alguien del equipo, se lo deriva y el pedido queda abierto acá.</p>
          </>
        )}
      </section>

      <section className="flex flex-col gap-3">
        {tickets == null ? (
          <p className="text-sm text-muted">Cargando…</p>
        ) : tickets.length === 0 ? (
          <p className="text-sm text-muted bg-white border border-black/10 rounded-lg px-4 py-6">Todavía no hay pedidos de postventa ni repuestos.</p>
        ) : (
          tickets.map((t) => <TicketCard key={t.id} t={t} sucNombre={nombreSuc(t.sucursal_id)} puede={editable && t.sucursal_id === suc.id} onEscribir={(txt) => conversar(t, txt)} />)
        )}
      </section>
    </div>
  )
}

function TicketCard({ t, sucNombre, puede, onEscribir }: { t: Ticket; sucNombre: string; puede: boolean; onEscribir: (t: string) => Promise<void> }) {
  const [texto, setTexto] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [e0, e1] = ESTADO[t.estado]
  const mandar = async () => {
    if (!texto.trim()) return
    setEnviando(true)
    await onEscribir(texto.trim())
    setTexto('')
    setEnviando(false)
  }
  return (
    <article className="bg-white border border-black/10 rounded-lg">
      <header className="px-4 py-3 border-b border-black/10 flex flex-wrap items-center gap-2">
        <div className="mr-auto min-w-0">
          <div className="font-semibold text-sm">
            #{t.id} · {t.tipo === 'repuesto' ? 'Repuesto' : 'Postventa'} · {sucNombre}
          </div>
          <div className="text-xs text-muted">
            {new Date(t.created_at).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
            {t.solicitado_por ? ` · ${t.solicitado_por}` : ''}
            {t.producto ? ` · ${t.producto}` : ''}{t.tipo === 'repuesto' && t.cantidad ? ` × ${t.cantidad}` : ''}
          </div>
        </div>
        <span className={`text-[11px] font-medium rounded-full px-2 py-0.5 ${e1}`}>{e0}</span>
      </header>
      <div className="px-4 py-3 flex flex-col gap-2 max-h-72 overflow-y-auto bg-[#FBFAF7]">
        {t.chat.length === 0 && <p className="text-sm whitespace-pre-wrap">{t.detalle}</p>}
        {t.chat.map((m, i) => (
          <div key={i} className={`max-w-[88%] rounded-2xl px-3 py-2 text-[13px] leading-snug whitespace-pre-wrap ${
            m.de === 'cliente' ? 'ml-auto bg-ink text-white rounded-br-md' : 'bg-white border border-black/10 rounded-bl-md'}`}>
            {m.de === 'iris' && <div className="text-[10px] font-semibold text-gold mb-0.5">IRIS · Orbital</div>}
            {m.texto}
          </div>
        ))}
      </div>
      {puede && t.estado !== 'resuelto' && (
        <div className="flex items-center gap-2 border-t border-black/10 px-3 py-2">
          <input id={`pv-msg-${t.id}`} value={texto} onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') mandar() }}
            placeholder="Agregar información o responder…" className="flex-1 text-sm outline-none bg-transparent py-1.5" />
          <button onClick={mandar} disabled={enviando || !texto.trim()} aria-label="Enviar" className="rounded-full bg-ink text-white p-2 disabled:opacity-40">
            <Send size={14} />
          </button>
        </div>
      )}
    </article>
  )
}
