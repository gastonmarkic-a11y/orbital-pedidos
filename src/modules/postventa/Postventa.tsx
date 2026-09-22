// ── Postventa ────────────────────────────────────────────────────────────────
// La pantalla de trabajo de Postventa, en cinco solapas:
//   · Mensajes: todas las charlas del bot (WhatsApp/IG/web) agrupadas por óptica, con el
//     historial y para responder desde ahí (at-responder, igual que en Conversaciones).
//   · Garantías y repuestos: lo que cargan las ópticas desde el catálogo (optica_postventa, con fotos).
//   · Pedidos: en qué estado está cada pedido, buscable por óptica. Sin importes: Postventa no ve plata.
//   · Envíos: el panel de envíos de siempre (B2B para despacho + e-commerce de Envia).
//   · Enviar catálogo: el link (token) del catálogo de cualquier óptica, o alta de una óptica
//     nueva como cliente provisorio con su link (RPCs postventa_buscar_opticas / postventa_optica_nueva).
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useToast } from '../../lib/toast'
import { useAuth } from '../../lib/auth'
import { estadoLabel, ESTADO_COLORS } from '../pedidos/calc'
import type { EstadoPedido } from '../../lib/types'
import Envios from '../atencion/Envios'
import { PostventaTickets } from '../consigna/RedOpticas'

type Vista = 'mensajes' | 'garantias' | 'pedidos' | 'envios' | 'catalogo'

export default function Postventa() {
  const [vista, setVista] = useState<Vista>('mensajes')
  const TABS: [Vista, string][] = [['mensajes', 'Mensajes por óptica'], ['garantias', 'Garantías y repuestos'], ['pedidos', 'Estado de pedidos'], ['envios', 'Envíos'], ['catalogo', 'Enviar catálogo']]
  return (
    <div className="max-w-5xl mx-auto px-4 py-6 text-ink">
      <h1 className="text-xl font-semibold">Postventa</h1>
      <p className="text-sm text-muted mt-1 mb-4">Lo que escriben las ópticas, cómo va cada pedido y dónde está cada envío.</p>
      <div className="flex gap-1 border-b border-black/10 mb-4 overflow-x-auto">
        {TABS.map(([k, l]) => (
          <button key={k} onClick={() => setVista(k)} className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px whitespace-nowrap ${vista === k ? 'border-[#0004FF] text-[#0004FF]' : 'border-transparent text-muted'}`}>{l}</button>
        ))}
      </div>
      {vista === 'mensajes' && <Mensajes />}
      {vista === 'garantias' && <PostventaTickets />}
      {vista === 'pedidos' && <EstadoPedidos />}
      {vista === 'envios' && <Envios />}
      {vista === 'catalogo' && <EnviarCatalogo />}
    </div>
  )
}

const fdt = (s: string | null) => s ? new Date(s).toLocaleString('es-AR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''

// ── Mensajes por óptica ──────────────────────────────────────────────────────
interface Conv { id: string; contacto_id: string; canal_origen: string | null; estado: string | null; updated_at: string | null; created_at: string | null }
interface Contacto { id: string; nombre: string | null; telefono: string | null; tipo_cliente: string | null; cod_cliente: string | null }
interface Msg { emisor: string; contenido: string; created_at?: string }
interface Grupo { key: string; nombre: string; cod: string | null; telefono: string | null; esOptica: boolean; convs: Conv[]; ultima: string }

const estadoConv = (e: string | null) => e === 'derivada' ? { t: 'Con asesor', c: 'bg-amber-100 text-amber-700' } : e === 'resuelta' ? { t: 'Resuelta', c: 'bg-emerald-100 text-emerald-700' } : { t: 'Bot activo', c: 'bg-blue-100 text-blue-700' }

function Mensajes() {
  const [grupos, setGrupos] = useState<Grupo[]>([])
  const [loading, setLoading] = useState(true)
  const [soloOpticas, setSoloOpticas] = useState(true)
  const [q, setQ] = useState('')
  const [abierto, setAbierto] = useState<string | null>(null)
  const [msgs, setMsgs] = useState<Record<string, Msg[]>>({})
  const [resp, setResp] = useState<Record<string, string>>({})
  const [enviando, setEnviando] = useState<string | null>(null)
  const toast = useToast()

  useEffect(() => {
    async function cargar() {
      const { data } = await supabase.from('at_conversaciones').select('id, contacto_id, canal_origen, estado, updated_at, created_at').order('updated_at', { ascending: false, nullsFirst: false }).limit(1000)
      const convs = (data as Conv[]) ?? []
      const ids = [...new Set(convs.map((c) => c.contacto_id).filter(Boolean))]
      const cts: Record<string, Contacto> = {}
      for (let i = 0; i < ids.length; i += 300) {
        const { data: d } = await supabase.from('contactos').select('id, nombre, telefono, tipo_cliente, cod_cliente').in('id', ids.slice(i, i + 300))
        for (const ct of (d as Contacto[]) ?? []) cts[ct.id] = ct
      }
      // Una óptica puede escribir desde varios números o canales: se agrupa por su código de
      // cliente; si no lo tiene, por contacto.
      const m = new Map<string, Grupo>()
      for (const c of convs) {
        const ct = cts[c.contacto_id]
        const key = ct?.cod_cliente || `ct:${c.contacto_id}`
        const g = m.get(key) ?? { key, nombre: ct?.nombre || ct?.telefono || 'Contacto', cod: ct?.cod_cliente ?? null, telefono: ct?.telefono ?? null, esOptica: ct?.tipo_cliente === 'mayorista' || !!ct?.cod_cliente, convs: [], ultima: '' }
        g.convs.push(c)
        const t = c.updated_at || c.created_at || ''
        if (t > g.ultima) g.ultima = t
        m.set(key, g)
      }
      setGrupos([...m.values()].sort((a, b) => b.ultima.localeCompare(a.ultima)))
      setLoading(false)
    }
    cargar()
  }, [])

  const filtrados = useMemo(() => {
    const s = q.trim().toLowerCase()
    return grupos.filter((g) => (!soloOpticas || g.esOptica) && (!s || g.nombre.toLowerCase().includes(s) || (g.telefono || '').includes(s) || (g.cod || '').toLowerCase().includes(s)))
  }, [grupos, soloOpticas, q])

  async function abrir(g: Grupo) {
    if (abierto === g.key) { setAbierto(null); return }
    setAbierto(g.key)
    const faltan = g.convs.filter((c) => !msgs[c.id]).map((c) => c.id)
    if (!faltan.length) return
    const { data } = await supabase.from('at_mensajes').select('conversacion_id, emisor, contenido, created_at').in('conversacion_id', faltan).order('created_at', { ascending: true })
    const nuevo: Record<string, Msg[]> = Object.fromEntries(faltan.map((id) => [id, []]))
    for (const r of (data as (Msg & { conversacion_id: string })[]) ?? []) nuevo[r.conversacion_id].push(r)
    setMsgs((m) => ({ ...m, ...nuevo }))
  }

  async function responder(id: string) {
    const texto = (resp[id] ?? '').trim(); if (!texto) return
    setEnviando(id)
    const { data, error } = await supabase.functions.invoke('at-responder', { body: { conversacion_id: id, texto } })
    setEnviando(null)
    if (error) { toast('No se pudo enviar: ' + error.message, 'error'); return }
    const res = data as { enviado?: boolean; canal?: string; detalle?: string }
    setMsgs((m) => ({ ...m, [id]: [...(m[id] ?? []), { emisor: 'agente', contenido: texto }] }))
    setResp((r) => ({ ...r, [id]: '' }))
    // Si pasaron las 24 h o el contacto no tiene ese canal, queda registrado pero no le llega.
    toast(
      res?.enviado ? `✓ Enviado por ${res.canal ?? 'el canal'}` : `⚠ Quedó registrado pero NO le llegó al cliente${res?.detalle ? ': ' + res.detalle : ''}`,
      res?.enviado ? 'success' : 'error',
    )
  }

  if (loading) return <p className="text-sm text-muted p-2">Cargando…</p>
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar óptica, teléfono o código…" className="flex-1 min-w-[200px] text-sm bg-white border border-black/10 rounded-lg px-3 py-2" />
        <div className="flex rounded-lg border border-black/10 overflow-hidden text-xs font-medium">
          <button onClick={() => setSoloOpticas(true)} className={`px-3 py-2 ${soloOpticas ? 'bg-ink text-white' : 'bg-white text-muted'}`}>Ópticas</button>
          <button onClick={() => setSoloOpticas(false)} className={`px-3 py-2 ${!soloOpticas ? 'bg-ink text-white' : 'bg-white text-muted'}`}>Todos</button>
        </div>
      </div>
      <p className="text-[11px] text-faint">{filtrados.length} {soloOpticas ? 'ópticas' : 'contactos'} con mensajes</p>
      <div className="bg-white rounded-xl border border-black/10 divide-y divide-black/5">
        {filtrados.map((g) => {
          const conAsesor = g.convs.some((c) => c.estado === 'derivada')
          return (
            <div key={g.key} className="p-3">
              <button onClick={() => abrir(g)} className="w-full flex items-center justify-between gap-2 text-left">
                <span className="min-w-0">
                  <span className="text-sm font-medium">{g.nombre}</span>
                  <span className="block text-[11px] text-faint">{[g.cod, g.telefono, `${g.convs.length} ${g.convs.length === 1 ? 'charla' : 'charlas'}`, fdt(g.ultima)].filter(Boolean).join(' · ')}</span>
                </span>
                {conAsesor && <span className="text-[10px] font-semibold rounded-full px-2 py-0.5 shrink-0 bg-amber-100 text-amber-700">Con asesor</span>}
              </button>
              {abierto === g.key && (
                <div className="mt-2 space-y-2">
                  {g.convs.map((c) => {
                    const est = estadoConv(c.estado)
                    return (
                      <div key={c.id} className="bg-[#F7F5F0] rounded-lg p-2">
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <span className="text-[10px] uppercase text-faint">{c.canal_origen || '—'} · {fdt(c.updated_at || c.created_at)}</span>
                          <span className={`text-[10px] font-semibold rounded-full px-2 py-0.5 ${est.c}`}>{est.t}</span>
                        </div>
                        <div className="max-h-64 overflow-y-auto space-y-1">
                          {!msgs[c.id] ? <p className="text-[11px] text-faint">Cargando…</p> : msgs[c.id].length === 0 ? <p className="text-[11px] text-faint">Sin mensajes.</p> : msgs[c.id].map((m, i) => (
                            <div key={i} className={`text-xs ${m.emisor === 'cliente' ? 'text-ink font-medium' : m.emisor === 'agente' ? 'text-emerald-700' : 'text-muted'}`}>
                              <span className="text-[9px] mr-1">{m.emisor === 'cliente' ? '👤' : m.emisor === 'agente' ? '🧑‍💼' : '🤖'}</span>{m.contenido}
                            </div>
                          ))}
                        </div>
                        <div className="flex items-end gap-1.5 pt-1.5 border-t border-black/10 mt-1.5">
                          <textarea value={resp[c.id] ?? ''} onChange={(e) => setResp((r) => ({ ...r, [c.id]: e.target.value }))} rows={2} placeholder={c.canal_origen === 'whatsapp' ? 'Responder por WhatsApp…' : 'Responder…'} className="flex-1 rounded-lg border border-black/10 px-2 py-1.5 text-xs" />
                          <button onClick={() => responder(c.id)} disabled={enviando === c.id || !(resp[c.id] ?? '').trim()} className="rounded-lg bg-emerald-600 text-white px-3 py-2 text-xs font-semibold disabled:opacity-50 shrink-0">{enviando === c.id ? '…' : 'Enviar'}</button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
        {filtrados.length === 0 && <p className="text-sm text-faint text-center py-6">No hay mensajes que coincidan.</p>}
      </div>
    </div>
  )
}

// ── Estado de pedidos ────────────────────────────────────────────────────────
interface Ped {
  id: number; fecha: string | null; created_at: string; cliente: string | null; cod_cliente: string | null; vendedor: string | null
  estado: EstadoPedido | null; total_units: number | null; tipo_transporte: string | null; nro_guia: string | null
  fecha_entrega: string | null; nro_factura: string | null; obs_deposito: string | null; esperando_stock: boolean | null; entrega_parcial: boolean | null
}
const ESTADOS: string[] = ['pendiente', 'en_preparacion', 'observado', 'listo', 'facturado', 'listo_despachar', 'despachado']

function EstadoPedidos() {
  const [peds, setPeds] = useState<Ped[]>([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [estado, setEstado] = useState('')

  useEffect(() => {
    supabase.from('pedidos')
      .select('id, fecha, created_at, cliente, cod_cliente, vendedor, estado, total_units, tipo_transporte, nro_guia, fecha_entrega, nro_factura, obs_deposito, esperando_stock, entrega_parcial')
      .neq('vendedor', 'Tienda')
      .order('id', { ascending: false }).limit(500)
      .then(({ data }) => { setPeds((data as Ped[]) ?? []); setLoading(false) })
  }, [])

  const cuenta = useMemo(() => {
    const m = new Map<string, number>()
    for (const p of peds) m.set(p.estado ?? 'pendiente', (m.get(p.estado ?? 'pendiente') ?? 0) + 1)
    return m
  }, [peds])

  const filtrados = useMemo(() => {
    const s = q.trim().toLowerCase()
    return peds.filter((p) => (!estado || (p.estado ?? 'pendiente') === estado) &&
      (!s || (p.cliente || '').toLowerCase().includes(s) || (p.cod_cliente || '').toLowerCase().includes(s) || String(p.id) === s.replace('#', '') || (p.nro_guia || '').toLowerCase().includes(s)))
  }, [peds, q, estado])

  if (loading) return <p className="text-sm text-muted p-2">Cargando…</p>
  return (
    <div className="space-y-3">
      <div className="flex gap-1.5 flex-wrap">
        <button onClick={() => setEstado('')} className={`text-[11px] rounded-full px-3 py-1.5 border font-medium ${!estado ? 'bg-ink text-white border-ink' : 'border-black/10 text-muted'}`}>Todos · {peds.length}</button>
        {ESTADOS.filter((e) => cuenta.get(e)).map((e) => (
          <button key={e} onClick={() => setEstado(e)} className="text-[11px] rounded-full px-3 py-1.5 border font-medium"
            style={estado === e ? { background: ESTADO_COLORS[e], color: '#fff', borderColor: ESTADO_COLORS[e] } : { borderColor: 'rgba(0,0,0,.1)', color: '#6b7280' }}>
            {estadoLabel(e as EstadoPedido)} · {cuenta.get(e)}
          </button>
        ))}
      </div>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por óptica, código, nº de pedido o guía…" className="w-full text-sm bg-white border border-black/10 rounded-lg px-3 py-2" />
      <div className="bg-white rounded-xl border border-black/10 divide-y divide-black/5">
        {filtrados.map((p) => {
          const color = ESTADO_COLORS[p.estado ?? 'pendiente'] ?? '#6b7280'
          const extra = [
            p.total_units ? `${p.total_units} u.` : null,
            p.vendedor,
            p.nro_factura ? `Fact. ${p.nro_factura}` : null,
            p.tipo_transporte,
            p.nro_guia ? `Guía ${p.nro_guia}` : null,
            p.fecha_entrega ? `Entrega ${p.fecha_entrega}` : null,
          ].filter(Boolean).join(' · ')
          return (
            <div key={p.id} className="p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium truncate">#{p.id} · {p.cliente || p.cod_cliente || 'Sin cliente'}</span>
                <span className="text-[10px] font-bold rounded-full px-2 py-0.5 whitespace-nowrap text-white" style={{ background: color }}>{estadoLabel(p.estado)}</span>
              </div>
              <p className="text-[11px] text-faint mt-0.5">{fdt(p.created_at)}{extra ? ` · ${extra}` : ''}</p>
              {(p.esperando_stock || p.entrega_parcial) && (
                <p className="text-[11px] text-amber-700 mt-0.5">{[p.esperando_stock && 'Esperando stock', p.entrega_parcial && 'Entrega parcial'].filter(Boolean).join(' · ')}</p>
              )}
              {p.obs_deposito && <p className="text-[11px] text-muted mt-0.5">Depósito: {p.obs_deposito}</p>}
            </div>
          )
        })}
        {filtrados.length === 0 && <p className="text-sm text-faint text-center py-6">No hay pedidos que coincidan.</p>}
      </div>
    </div>
  )
}

// ── Enviar catálogo ──────────────────────────────────────────────────────────
interface Optica { cod: string; nombre: string | null; localidad: string | null; telefono: string | null; vendedor: string | null; token: string | null }
const linkCatalogo = (k: string) => `https://ver.orbitaleyewear.com.ar/catalogo?k=${k}`
const msgCatalogo = (k: string) =>
  `¡Hola! Te comparto el catálogo mayorista de Orbital para que armes tu pedido directo desde acá 🕶️\n\n${linkCatalogo(k)}\n\nEntrás sin clave y el pedido queda asociado a tu óptica. Cualquier cosa te ayudo.`

function EnviarCatalogo() {
  const { codigoEfectivo } = useAuth()
  const toast = useToast()
  const [q, setQ] = useState('')
  const [res, setRes] = useState<Optica[]>([])
  const [buscando, setBuscando] = useState(false)
  const [link, setLink] = useState<{ codigo: string; label: string } | null>(null)
  const [generando, setGenerando] = useState<string | null>(null)
  const [nueva, setNueva] = useState(false)
  const [form, setForm] = useState({ razon: '', contacto: '', telefono: '', localidad: '' })

  useEffect(() => {
    const s = q.trim()
    if (s.length < 2) { setRes([]); return }
    const t = setTimeout(async () => {
      setBuscando(true)
      const { data } = await supabase.rpc('postventa_buscar_opticas', { p_q: s })
      setRes((data as Optica[]) ?? [])
      setBuscando(false)
    }, 300)
    return () => clearTimeout(t)
  }, [q])

  // Trae el link de la óptica (si no tenía, lo crea) y lo deja registrado como enviado por Postventa.
  async function generar(o: Optica) {
    setGenerando(o.cod); setLink(null)
    const { data, error } = await supabase.rpc('catalogo_link_cliente', { p_cod_cliente: o.cod, p_vendedor: codigoEfectivo })
    setGenerando(null)
    const r = data as { ok?: boolean; codigo?: string; label?: string; error?: string } | null
    if (error || !r?.ok || !r.codigo) { toast(r?.error || 'No se pudo generar el link', 'error'); return }
    setLink({ codigo: r.codigo, label: o.nombre || r.label || o.cod })
  }

  async function crearNueva() {
    setGenerando('nueva'); setLink(null)
    const { data, error } = await supabase.rpc('postventa_optica_nueva', { p_razon: form.razon, p_contacto: form.contacto, p_telefono: form.telefono, p_localidad: form.localidad })
    setGenerando(null)
    const r = data as { ok?: boolean; codigo?: string; label?: string; error?: string } | null
    if (error || !r?.ok || !r.codigo) { toast(r?.error || error?.message || 'No se pudo dar de alta', 'error'); return }
    setLink({ codigo: r.codigo, label: form.razon.trim() })
    setForm({ razon: '', contacto: '', telefono: '', localidad: '' })
    setNueva(false)
    toast('Óptica dada de alta ✓', 'success')
  }

  const copiar = (t: string) => { navigator.clipboard?.writeText(t); toast('Copiado ✓', 'success') }
  const inp = 'w-full rounded-lg border border-black/10 px-3 py-2 text-sm bg-white'

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar óptica por nombre, código, localidad o teléfono…" className="flex-1 min-w-[220px] text-sm bg-white border border-black/10 rounded-lg px-3 py-2" />
        <button onClick={() => setNueva((v) => !v)} className="rounded-lg bg-[#0004FF] text-white px-3 py-2 text-sm font-medium">+ Óptica nueva</button>
      </div>

      {nueva && (
        <div className="bg-white rounded-xl border border-black/10 p-3 space-y-2">
          <p className="text-sm font-semibold">Óptica nueva</p>
          <p className="text-[11px] text-faint">Queda como cliente provisorio (Administración le pone el N° después) y sale con su link del catálogo.</p>
          <div className="grid sm:grid-cols-2 gap-2">
            <input value={form.razon} onChange={(e) => setForm({ ...form, razon: e.target.value })} placeholder="Nombre de la óptica *" className={inp} />
            <input value={form.contacto} onChange={(e) => setForm({ ...form, contacto: e.target.value })} placeholder="Contacto" className={inp} />
            <input value={form.telefono} onChange={(e) => setForm({ ...form, telefono: e.target.value })} placeholder="Teléfono / WhatsApp" className={inp} />
            <input value={form.localidad} onChange={(e) => setForm({ ...form, localidad: e.target.value })} placeholder="Localidad" className={inp} />
          </div>
          <button onClick={crearNueva} disabled={generando === 'nueva' || form.razon.trim().length < 2} className="rounded-lg bg-[#0004FF] text-white px-4 py-2 text-sm font-medium disabled:opacity-50">
            {generando === 'nueva' ? 'Creando…' : 'Dar de alta y generar link'}
          </button>
        </div>
      )}

      {link && (
        <div className="rounded-xl bg-[#0004FF]/5 border border-[#0004FF]/20 p-3 space-y-2">
          <p className="text-sm font-semibold">{link.label}</p>
          <p className="text-[12px] break-all bg-white border border-black/10 rounded-lg p-2">{linkCatalogo(link.codigo)}</p>
          <div className="flex gap-2 flex-wrap">
            <button onClick={() => copiar(linkCatalogo(link.codigo))} className="flex-1 rounded-lg border border-black/10 bg-white py-2 text-[13px] font-medium">Copiar link</button>
            <button onClick={() => copiar(msgCatalogo(link.codigo))} className="flex-1 rounded-lg border border-black/10 bg-white py-2 text-[13px] font-medium">Copiar mensaje</button>
            <a href={`https://wa.me/?text=${encodeURIComponent(msgCatalogo(link.codigo))}`} target="_blank" rel="noreferrer" className="flex-1 rounded-lg bg-[#25D366] text-white py-2 text-[13px] font-medium text-center">WhatsApp</a>
          </div>
        </div>
      )}

      {q.trim().length >= 2 && (
        <div className="bg-white rounded-xl border border-black/10 divide-y divide-black/5">
          {buscando && res.length === 0 && <p className="text-sm text-muted p-3">Buscando…</p>}
          {!buscando && res.length === 0 && <p className="text-sm text-faint text-center py-6">No aparece. Si es nueva, dala de alta con “+ Óptica nueva”.</p>}
          {res.map((o) => (
            <div key={o.cod} className="p-3 flex items-center justify-between gap-2">
              <span className="min-w-0">
                <span className="text-sm font-medium">{o.nombre || o.cod}</span>
                <span className="block text-[11px] text-faint">{[o.cod, o.localidad, o.telefono, o.vendedor].filter(Boolean).join(' · ')}{o.token ? ' · ya tiene link' : ''}</span>
              </span>
              <button onClick={() => generar(o)} disabled={generando === o.cod} className="rounded-lg border border-black/10 px-3 py-1.5 text-[12px] font-medium shrink-0 disabled:opacity-50">
                {generando === o.cod ? '…' : 'Link'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
