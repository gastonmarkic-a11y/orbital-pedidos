import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import Derivaciones from './Derivaciones'

// Panel de Conversaciones del bot de atención: estadísticas + Derivaciones (pendientes) adentro +
// archivo de TODAS las charlas (buscables, con su historial). Todo sale de at_conversaciones/at_mensajes.

interface Conv { id: string; contacto_id: string; canal_origen: string | null; estado: string | null; updated_at: string | null; created_at: string | null }
interface Contacto { id: string; nombre: string | null; telefono: string | null; tipo_cliente: string | null }
interface Deriv { motivo: string; estado: string; created_at: string }

const MOTIVO_LABEL: Record<string, string> = {
  reclamo_excepcion: 'Reclamo/excepción', precio_mayorista: 'Precio mayorista', iris_deriva: 'IRIS derivó',
  envio_incidencia: 'Incidencia envío', sin_respuesta: 'Sin respuesta', confirmar_stock: 'Confirmar stock',
}
const ml = (m: string) => MOTIVO_LABEL[m] ?? m.replace(/_/g, ' ')
const estadoConv = (e: string | null) => e === 'derivada' ? { t: 'Con asesor', c: 'bg-amber-100 text-amber-700' } : e === 'resuelta' ? { t: 'Resuelta', c: 'bg-emerald-100 text-emerald-700' } : { t: 'Bot activo', c: 'bg-blue-100 text-blue-700' }
const fdt = (s: string | null) => s ? new Date(s).toLocaleString('es-AR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''

export default function Conversaciones() {
  const [convs, setConvs] = useState<Conv[]>([])
  const [contactos, setContactos] = useState<Record<string, Contacto>>({})
  const [derivs, setDerivs] = useState<Deriv[]>([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [abierta, setAbierta] = useState<string | null>(null)
  const [msgs, setMsgs] = useState<Record<string, { emisor: string; contenido: string }[]>>({})
  const [resp, setResp] = useState<Record<string, string>>({})
  const [enviando, setEnviando] = useState<string | null>(null)

  async function responder(id: string) {
    const texto = (resp[id] ?? '').trim(); if (!texto) return
    setEnviando(id)
    const { error } = await supabase.functions.invoke('at-responder', { body: { conversacion_id: id, texto } })
    setEnviando(null)
    if (error) return
    setMsgs((m) => ({ ...m, [id]: [...(m[id] ?? []), { emisor: 'agente', contenido: texto }] }))
    setResp((r) => ({ ...r, [id]: '' }))
  }

  useEffect(() => {
    async function cargar() {
      const [c, d] = await Promise.all([
        supabase.from('at_conversaciones').select('id, contacto_id, canal_origen, estado, updated_at, created_at').order('updated_at', { ascending: false, nullsFirst: false }).limit(400),
        supabase.from('derivaciones').select('motivo, estado, created_at').order('created_at', { ascending: false }).limit(2000),
      ])
      const cv = (c.data as Conv[]) ?? []
      setConvs(cv)
      setDerivs((d.data as Deriv[]) ?? [])
      const ids = [...new Set(cv.map((x) => x.contacto_id).filter(Boolean))]
      if (ids.length) {
        const map: Record<string, Contacto> = {}
        for (let i = 0; i < ids.length; i += 300) {
          const { data } = await supabase.from('contactos').select('id, nombre, telefono, tipo_cliente').in('id', ids.slice(i, i + 300))
          for (const ct of (data as Contacto[]) ?? []) map[ct.id] = ct
        }
        setContactos(map)
      }
      setLoading(false)
    }
    cargar()
  }, [])

  const stats = useMemo(() => {
    const total = convs.length
    const derivadas = convs.filter((c) => c.estado === 'derivada').length
    const derivPend = derivs.filter((d) => d.estado === 'pendiente').length
    const derivResueltas = derivs.filter((d) => d.estado === 'resuelta').length
    const porMotivo = new Map<string, number>()
    for (const d of derivs) porMotivo.set(d.motivo, (porMotivo.get(d.motivo) ?? 0) + 1)
    const porCanal = new Map<string, number>()
    for (const c of convs) { const k = c.canal_origen || 'otro'; porCanal.set(k, (porCanal.get(k) ?? 0) + 1) }
    const totDeriv = derivs.length
    const resueltasPorBot = total > 0 ? Math.round(((total - derivadas) / total) * 100) : 0
    return { total, derivadas, derivPend, derivResueltas, totDeriv, resueltasPorBot,
      motivos: [...porMotivo.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6),
      canales: [...porCanal.entries()].sort((a, b) => b[1] - a[1]) }
  }, [convs, derivs])

  async function verHistorial(id: string) {
    if (abierta === id) { setAbierta(null); return }
    setAbierta(id)
    if (!msgs[id]) {
      const { data } = await supabase.from('at_mensajes').select('emisor, contenido, created_at').eq('conversacion_id', id).order('created_at', { ascending: true })
      setMsgs((m) => ({ ...m, [id]: (data as { emisor: string; contenido: string }[]) ?? [] }))
    }
  }

  const filtradas = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return convs
    return convs.filter((c) => { const ct = contactos[c.contacto_id]; return (ct?.nombre || '').toLowerCase().includes(s) || (ct?.telefono || '').includes(s) || (c.canal_origen || '').includes(s) })
  }, [q, convs, contactos])

  const Stat = ({ n, l, color }: { n: number | string; l: string; color?: string }) => (
    <div className="bg-white rounded-xl border border-black/10 p-3">
      <p className="text-2xl font-bold" style={{ color: color || '#0a0a0a' }}>{n}</p>
      <p className="text-[11px] text-muted">{l}</p>
    </div>
  )

  return (
    <div className="space-y-4 text-ink">
      <div>
        <h2 className="text-base font-semibold">💬 Conversaciones</h2>
        <p className="text-[11px] text-faint">Bot de atención (WhatsApp/IG/web). Derivaciones, archivo de charlas y estadísticas.</p>
      </div>

      {loading ? <p className="text-sm text-muted p-2">Cargando…</p> : (
        <>
          {/* Estadísticas */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
            <Stat n={stats.total} l="Conversaciones (últimas 400)" />
            <Stat n={`${stats.resueltasPorBot}%`} l="Resueltas por el bot" color="#2a9d5c" />
            <Stat n={stats.derivPend} l="Derivaciones pendientes" color={stats.derivPend > 0 ? '#c0392b' : '#0a0a0a'} />
            <Stat n={stats.derivResueltas} l="Derivaciones resueltas" color="#2a9d5c" />
            <Stat n={stats.totDeriv} l="Derivaciones totales" />
          </div>
          {(stats.motivos.length > 0 || stats.canales.length > 0) && (
            <div className="grid md:grid-cols-2 gap-3">
              <div className="bg-white rounded-xl border border-black/10 p-3">
                <p className="text-[11px] font-semibold text-muted uppercase tracking-wide mb-2">Derivaciones por motivo</p>
                {stats.motivos.map(([m, n]) => (
                  <div key={m} className="flex justify-between text-xs py-0.5"><span className="text-ink">{ml(m)}</span><span className="font-semibold">{n}</span></div>
                ))}
                {stats.motivos.length === 0 && <p className="text-xs text-faint">Sin derivaciones.</p>}
              </div>
              <div className="bg-white rounded-xl border border-black/10 p-3">
                <p className="text-[11px] font-semibold text-muted uppercase tracking-wide mb-2">Por canal</p>
                {stats.canales.map(([c, n]) => (
                  <div key={c} className="flex justify-between text-xs py-0.5"><span className="text-ink capitalize">{c}</span><span className="font-semibold">{n}</span></div>
                ))}
              </div>
            </div>
          )}

          {/* Derivaciones (pendientes) adentro */}
          <div className="bg-[#F7F5F0] rounded-xl p-3">
            <Derivaciones />
          </div>

          {/* Archivo de todas las conversaciones */}
          <div className="bg-white rounded-xl border border-black/10 p-4">
            <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
              <p className="text-sm font-semibold">🗂 Todas las conversaciones</p>
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nombre, teléfono o canal…" className="text-sm bg-white border border-black/10 rounded-lg px-3 py-1.5 w-64 max-w-full" />
            </div>
            <div className="space-y-1.5">
              {filtradas.map((c) => {
                const ct = contactos[c.contacto_id]
                const est = estadoConv(c.estado)
                return (
                  <div key={c.id} className="border-t border-black/5 pt-1.5 first:border-0 first:pt-0">
                    <button onClick={() => verHistorial(c.id)} className="w-full flex items-center justify-between gap-2 text-left">
                      <span className="min-w-0">
                        <span className="text-sm font-medium">{ct?.nombre || ct?.telefono || 'Contacto'}</span>
                        <span className="block text-[10px] text-faint">{c.canal_origen || '—'}{ct?.tipo_cliente ? ` · ${ct.tipo_cliente}` : ''} · {fdt(c.updated_at || c.created_at)}</span>
                      </span>
                      <span className={`text-[10px] font-semibold rounded-full px-2 py-0.5 shrink-0 ${est.c}`}>{est.t}</span>
                    </button>
                    {abierta === c.id && (
                      <div className="mt-2 bg-[#F7F5F0] rounded-lg p-2 max-h-64 overflow-y-auto space-y-1">
                        {(msgs[c.id] ?? []).length === 0 ? <p className="text-[11px] text-faint">Sin mensajes.</p> : (msgs[c.id] ?? []).map((m, i) => (
                          <div key={i} className={`text-xs ${m.emisor === 'cliente' ? 'text-ink font-medium' : m.emisor === 'agente' ? 'text-emerald-700' : 'text-muted'}`}>
                            <span className="text-[9px] uppercase text-faint mr-1">{m.emisor === 'cliente' ? '👤' : m.emisor === 'agente' ? '🧑‍💼' : '🤖'}</span>{m.contenido}
                          </div>
                        ))}
                        <div className="flex items-end gap-1.5 pt-1.5 border-t border-black/10 mt-1">
                          <textarea value={resp[c.id] ?? ''} onChange={(e) => setResp((r) => ({ ...r, [c.id]: e.target.value }))} rows={2} placeholder={c.canal_origen === 'whatsapp' ? 'Responder por WhatsApp…' : 'Responder…'} className="flex-1 rounded-lg border border-black/10 px-2 py-1.5 text-xs" />
                          <button onClick={() => responder(c.id)} disabled={enviando === c.id || !(resp[c.id] ?? '').trim()} className="rounded-lg bg-emerald-600 text-white px-3 py-2 text-xs font-semibold disabled:opacity-50 shrink-0">{enviando === c.id ? '…' : 'Enviar'}</button>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
              {filtradas.length === 0 && <p className="text-sm text-faint text-center py-6">No hay conversaciones que coincidan.</p>}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
