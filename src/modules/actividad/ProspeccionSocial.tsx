import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'
import { useToast } from '../../lib/toast'
import { Copy, Check, ExternalLink, Send, Plus, Trash2 } from 'lucide-react'
import { RUBROS, mensajePara } from '../../lib/guiones'

// Cola de prospección social: cada contacto con su mensaje ya armado y un botón para marcar enviado.
// El sistema arma el mensaje; la persona copia, abre el perfil y envía (2 clics), y queda todo registrado.

interface Item {
  id: number; canal: 'ig' | 'linkedin'; nombre: string | null; perfil: string | null; url: string | null
  rubro: string | null; zona: string | null; mensaje: string | null; estado: string
  operador: string | null; proximo_toque: string | null; nota: string | null; created_at: string; enviado_at: string | null
}

const ESTADOS: Record<string, { t: string; c: string }> = {
  nuevo: { t: 'A enviar', c: 'bg-amber-100 text-amber-700' },
  enviado: { t: 'Enviado', c: 'bg-blue-100 text-blue-700' },
  respondio: { t: 'Respondió', c: 'bg-emerald-100 text-emerald-700' },
  whatsapp: { t: 'En WhatsApp', c: 'bg-emerald-100 text-emerald-700' },
  cerrado: { t: 'Cerrado', c: 'bg-violet-100 text-violet-700' },
  descartado: { t: 'Descartado', c: 'bg-black/5 text-faint' },
}
const hoyMas = (d: number) => { const x = new Date(); x.setDate(x.getDate() + d); return x.toISOString().slice(0, 10) }

export default function ProspeccionSocial() {
  const { codigoEfectivo } = useAuth()
  const toast = useToast()
  const [items, setItems] = useState<Item[]>([])
  const [loading, setLoading] = useState(true)
  const [filtro, setFiltro] = useState<'pend' | 'enviado' | 'respondio' | 'todos'>('pend')
  const [copiado, setCopiado] = useState<number | null>(null)
  const [nuevoOpen, setNuevoOpen] = useState(false)
  const [nv, setNv] = useState({ canal: 'ig' as 'ig' | 'linkedin', nombre: '', perfil: '', url: '', rubro: 'opticas', zona: '' })
  const [guardando, setGuardando] = useState(false)

  async function cargar() {
    setLoading(true)
    const { data } = await supabase.from('prospeccion_social').select('*').order('created_at', { ascending: false }).limit(400)
    setItems((data as Item[]) ?? [])
    setLoading(false)
  }
  useEffect(() => { cargar() }, [])

  const filtrados = useMemo(() => {
    if (filtro === 'pend') return items.filter((i) => i.estado === 'nuevo')
    if (filtro === 'enviado') return items.filter((i) => i.estado === 'enviado')
    if (filtro === 'respondio') return items.filter((i) => ['respondio', 'whatsapp'].includes(i.estado))
    return items.filter((i) => i.estado !== 'descartado')
  }, [items, filtro])

  const cuenta = (e: string) => items.filter((i) => (e === 'respondio' ? ['respondio', 'whatsapp'].includes(i.estado) : i.estado === e)).length

  async function agregar() {
    if (!nv.nombre.trim() && !nv.perfil.trim()) { toast('Poné al menos nombre o perfil', 'error'); return }
    setGuardando(true)
    const mensaje = mensajePara(nv.rubro, nv.canal === 'linkedin' ? 'linkedin' : 'ig', nv.nombre)
    const { error } = await supabase.from('prospeccion_social').insert({
      canal: nv.canal, nombre: nv.nombre.trim() || null, perfil: nv.perfil.trim() || null, url: nv.url.trim() || null,
      rubro: nv.rubro, zona: nv.zona.trim() || null, mensaje, estado: 'nuevo', operador: codigoEfectivo,
    })
    setGuardando(false)
    if (error) { toast('No se pudo agregar: ' + error.message, 'error'); return }
    toast('✓ Agregado a la cola', 'success')
    setNv({ canal: nv.canal, nombre: '', perfil: '', url: '', rubro: nv.rubro, zona: nv.zona })
    setNuevoOpen(false); cargar()
  }

  async function copiar(it: Item) {
    try { await navigator.clipboard.writeText(it.mensaje ?? ''); setCopiado(it.id); toast('✓ Mensaje copiado', 'success'); setTimeout(() => setCopiado(null), 1500) } catch { toast('No se pudo copiar', 'error') }
  }
  async function setEstado(it: Item, estado: string, extra: Partial<Item> = {}) {
    setItems((xs) => xs.map((x) => (x.id === it.id ? { ...x, estado, ...extra } : x)))
    await supabase.from('prospeccion_social').update({ estado, ...extra }).eq('id', it.id)
  }
  const marcarEnviado = (it: Item) => setEstado(it, 'enviado', { enviado_at: new Date().toISOString(), proximo_toque: hoyMas(4) })

  const rubroLabel = (id: string | null) => RUBROS.find((r) => r.id === id)?.nombre ?? id ?? '—'

  return (
    <div className="space-y-4 text-ink">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h1 className="text-lg font-bold">📣 Cola de prospección social</h1>
          <p className="text-xs text-muted">Cada contacto con su mensaje listo. Copiás, abrís el perfil y enviás — 2 clics.</p>
        </div>
        <button onClick={() => setNuevoOpen((o) => !o)} className="text-xs font-medium bg-brand text-white rounded-lg px-3 py-1.5 flex items-center gap-1"><Plus size={14} />Agregar</button>
      </div>

      {/* Alta manual (mientras el descubridor sea manual) */}
      {nuevoOpen && (
        <div className="bg-white rounded-2xl border border-black/10 p-3 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <label className="text-[11px] text-muted">Canal
              <select value={nv.canal} onChange={(e) => setNv({ ...nv, canal: e.target.value as 'ig' | 'linkedin' })} className="w-full mt-1 border border-black/10 rounded-lg px-2 py-2 text-sm">
                <option value="ig">📷 Instagram</option><option value="linkedin">💼 LinkedIn</option>
              </select>
            </label>
            <label className="text-[11px] text-muted">Rubro
              <select value={nv.rubro} onChange={(e) => setNv({ ...nv, rubro: e.target.value })} className="w-full mt-1 border border-black/10 rounded-lg px-2 py-2 text-sm">
                {RUBROS.map((r) => <option key={r.id} value={r.id}>{r.emoji} {r.nombre}</option>)}
              </select>
            </label>
            <input value={nv.nombre} onChange={(e) => setNv({ ...nv, nombre: e.target.value })} placeholder="Nombre / óptica" className="border border-black/10 rounded-lg px-3 py-2 text-sm" />
            <input value={nv.perfil} onChange={(e) => setNv({ ...nv, perfil: e.target.value })} placeholder="@usuario / perfil" className="border border-black/10 rounded-lg px-3 py-2 text-sm" />
            <input value={nv.url} onChange={(e) => setNv({ ...nv, url: e.target.value })} placeholder="Link al perfil (opcional)" className="border border-black/10 rounded-lg px-3 py-2 text-sm col-span-2" />
            <input value={nv.zona} onChange={(e) => setNv({ ...nv, zona: e.target.value })} placeholder="Zona (opcional)" className="border border-black/10 rounded-lg px-3 py-2 text-sm col-span-2" />
          </div>
          <p className="text-[10px] text-faint">El mensaje se arma solo según el rubro y el canal.</p>
          <button onClick={agregar} disabled={guardando} className="w-full bg-brand text-white rounded-lg py-2 text-sm font-semibold disabled:opacity-50">{guardando ? 'Agregando…' : '+ Sumar a la cola'}</button>
        </div>
      )}

      {/* Filtros */}
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {([['pend', `A enviar (${cuenta('nuevo')})`], ['enviado', `Enviados (${cuenta('enviado')})`], ['respondio', `Respondieron (${cuenta('respondio')})`], ['todos', 'Todos']] as const).map(([k, l]) => (
          <button key={k} onClick={() => setFiltro(k)} className={`shrink-0 text-[12px] rounded-full px-3 py-1.5 border font-medium ${filtro === k ? 'bg-ink text-white border-ink' : 'bg-white border-black/10 text-muted'}`}>{l}</button>
        ))}
      </div>

      {loading ? <p className="text-sm text-muted p-4">Cargando…</p> : filtrados.length === 0 ? (
        <div className="text-sm text-faint text-center py-10 bg-white rounded-xl border border-black/10">Sin contactos en esta vista. Agregá targets o esperá al descubridor.</div>
      ) : (
        <div className="space-y-2">
          {filtrados.map((it) => (
            <div key={it.id} className="bg-white rounded-2xl border border-black/10 p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold truncate">{it.canal === 'ig' ? '📷' : '💼'} {it.nombre || it.perfil}</p>
                  <p className="text-[10px] text-faint">{[it.perfil && it.nombre ? it.perfil : null, rubroLabel(it.rubro), it.zona].filter(Boolean).join(' · ')}</p>
                </div>
                <span className={`shrink-0 text-[10px] font-bold rounded-full px-2 py-0.5 ${ESTADOS[it.estado]?.c ?? 'bg-black/5'}`}>{ESTADOS[it.estado]?.t ?? it.estado}</span>
              </div>
              <p className="text-[12px] text-muted bg-[#F6F4EF] rounded-lg p-2 whitespace-pre-wrap">{it.mensaje}</p>
              <div className="flex flex-wrap gap-1.5">
                <button onClick={() => copiar(it)} className="text-[11px] font-semibold rounded-lg border border-black/10 px-2.5 py-1.5 flex items-center gap-1 text-brandDark">{copiado === it.id ? <Check size={13} /> : <Copy size={13} />}{copiado === it.id ? 'Copiado' : 'Copiar'}</button>
                {it.url && <a href={it.url} target="_blank" rel="noreferrer" className="text-[11px] font-semibold rounded-lg border border-black/10 px-2.5 py-1.5 flex items-center gap-1 text-brandDark"><ExternalLink size={13} />Abrir perfil</a>}
                {it.estado === 'nuevo' && (
                  <>
                    <button onClick={() => marcarEnviado(it)} className="text-[11px] font-semibold rounded-lg bg-brand text-white px-2.5 py-1.5 flex items-center gap-1"><Send size={13} />Marqué enviado</button>
                    <button onClick={() => setEstado(it, 'descartado')} className="text-[11px] font-medium rounded-lg border border-red-200 text-red-600 px-2 py-1.5 flex items-center gap-1"><Trash2 size={12} />Descartar</button>
                  </>
                )}
                {it.estado === 'enviado' && (
                  <>
                    <button onClick={() => setEstado(it, 'respondio')} className="text-[11px] font-semibold rounded-lg bg-emerald-600 text-white px-2.5 py-1.5">Respondió →</button>
                    {it.proximo_toque && <span className="text-[10px] text-faint self-center">Seguimiento: {it.proximo_toque}</span>}
                  </>
                )}
                {['respondio', 'whatsapp'].includes(it.estado) && (
                  <button onClick={() => setEstado(it, 'cerrado')} className="text-[11px] font-semibold rounded-lg border border-black/10 px-2.5 py-1.5 text-brandDark">Marcar cerrado</button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      <p className="text-[11px] text-faint text-center">Los que responden pasan a WhatsApp, donde IRIS cotiza. Límite sugerido: ~20-30 envíos por día y por cuenta.</p>
    </div>
  )
}
