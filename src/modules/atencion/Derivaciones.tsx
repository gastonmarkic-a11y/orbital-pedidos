import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'
import { useToast } from '../../lib/toast'
import { responsableLabel, esMia } from './ruteo'

// Derivaciones del bot de atención (multicanal): cuando el bot no puede resolver,
// crea una derivación en la tabla `derivaciones`. Acá el equipo las ve en tiempo real
// (Supabase Realtime), las toma y las resuelve (reactivando el bot para esa conversación).

interface Derivacion {
  id: string
  conversacion_id: string
  motivo: string
  resumen: string
  tipo_cliente: 'mayorista' | 'minorista' | null
  estado: 'pendiente' | 'tomada' | 'resuelta'
  created_at: string
}

const MOTIVO: Record<string, { label: string; color: string }> = {
  sin_respuesta: { label: '❓ Sin respuesta en la base', color: 'border-amber-400' },
  confirmar_stock: { label: '📦 Confirmar stock', color: 'border-emerald-500' },
  reclamo_excepcion: { label: '⚠ Reclamo / excepción', color: 'border-red-500' },
  precio_mayorista: { label: '💲 Precio mayorista (óptica)', color: 'border-brand' },
  iris_deriva: { label: '🤖 IRIS derivó la charla', color: 'border-amber-400' },
  envio_incidencia: { label: '🚚 Incidencia con el envío', color: 'border-red-500' },
  recuperada: { label: '↩ Conversación recuperada', color: 'border-amber-400' },
}
function motivoInfo(m: string) {
  return MOTIVO[m] ?? { label: `🔔 ${m.replace(/_/g, ' ')}`, color: 'border-amber-400' }
}


export default function Derivaciones() {
  const { vendedor, codigoEfectivo, rolEfectivo } = useAuth()
  const [soloMias, setSoloMias] = useState(false)
  const toast = useToast()
  const [derivaciones, setDerivaciones] = useState<Derivacion[]>([])
  const [loading, setLoading] = useState(true)
  const [abierta, setAbierta] = useState<string | null>(null)
  const [conv, setConv] = useState<Record<string, { emisor: string; contenido: string }[]>>({})
  const [contacto, setContacto] = useState<Record<string, string | null>>({})
  const [respuesta, setRespuesta] = useState<Record<string, string>>({})
  const [enviando, setEnviando] = useState<string | null>(null)
  const [piezas, setPiezas] = useState<{ titulo: string; link: string | null; texto: string | null }[]>([])

  useEffect(() => {
    supabase.from('piezas_marketing').select('titulo, url_publica, url_corta, url, contenido_texto').eq('activa', true)
      .then(({ data }) => {
        const rows = (data as { titulo: string; url_publica: string | null; url_corta: string | null; url: string | null; contenido_texto: string | null }[]) ?? []
        setPiezas(rows.map((p) => ({ titulo: p.titulo, link: p.url_corta || p.url_publica || p.url, texto: p.contenido_texto })))
      })
  }, [])

  // Inserta el material elegido (link o texto) en la respuesta de esa conversación.
  function adjuntar(convId: string, idx: number) {
    const p = piezas[idx]; if (!p) return
    const frag = p.link ? `${p.titulo}: ${p.link}` : (p.texto || p.titulo)
    setRespuesta((r) => ({ ...r, [convId]: ((r[convId] ?? '').trim() + (r[convId]?.trim() ? '\n\n' : '') + frag) }))
  }

  async function responderConv(d: Derivacion) {
    const texto = (respuesta[d.conversacion_id] ?? '').trim()
    if (!texto) return
    setEnviando(d.id)
    const { data, error } = await supabase.functions.invoke('at-responder', {
      body: { conversacion_id: d.conversacion_id, texto, agente: vendedor?.nombre ?? null },
    })
    setEnviando(null)
    if (error) { toast('No se pudo enviar: ' + error.message, 'error'); return }
    const res = data as { enviado?: boolean; detalle?: string }
    setConv((c) => ({ ...c, [d.conversacion_id]: [...(c[d.conversacion_id] ?? []), { emisor: 'agente', contenido: texto }] }))
    setRespuesta((r) => ({ ...r, [d.conversacion_id]: '' }))
    toast(res?.enviado ? '✓ Respuesta enviada por WhatsApp' : res?.detalle || 'Respuesta registrada', 'success')
  }

  async function verConversacion(d: Derivacion) {
    if (abierta === d.id) { setAbierta(null); return }
    setAbierta(d.id)
    if (!conv[d.conversacion_id]) {
      const { data: msgs } = await supabase
        .from('at_mensajes')
        .select('emisor, contenido, created_at')
        .eq('conversacion_id', d.conversacion_id)
        .order('created_at', { ascending: true })
      setConv((c) => ({ ...c, [d.conversacion_id]: (msgs as { emisor: string; contenido: string }[]) ?? [] }))
      // teléfono del contacto para poder responder por WhatsApp
      const { data: cv } = await supabase.from('at_conversaciones').select('contacto_id').eq('id', d.conversacion_id).maybeSingle()
      if (cv?.contacto_id) {
        const { data: ct } = await supabase.from('contactos').select('telefono').eq('id', cv.contacto_id).maybeSingle()
        setContacto((p) => ({ ...p, [d.conversacion_id]: (ct as { telefono: string | null } | null)?.telefono ?? null }))
      }
    }
  }

  useEffect(() => {
    supabase
      .from('derivaciones')
      .select('*')
      .neq('estado', 'resuelta')
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        setDerivaciones((data as Derivacion[]) ?? [])
        setLoading(false)
      })

    const canal = supabase
      .channel('derivaciones-rt')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'derivaciones' }, (p) => {
        setDerivaciones((a) => [p.new as Derivacion, ...a])
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'derivaciones' }, (p) => {
        setDerivaciones((a) => a.map((d) => (d.id === (p.new as Derivacion).id ? (p.new as Derivacion) : d)))
      })
      .subscribe()

    return () => {
      supabase.removeChannel(canal)
    }
  }, [])

  async function tomar(id: string) {
    const { error } = await supabase.from('derivaciones').update({ estado: 'tomada', asignado_a: vendedor?.id ?? null }).eq('id', id)
    if (error) toast('No se pudo tomar: ' + error.message, 'error')
  }

  async function resolver(id: string, conversacionId: string) {
    const { error } = await supabase
      .from('derivaciones')
      .update({ estado: 'resuelta', resuelta_at: new Date().toISOString() })
      .eq('id', id)
    if (error) {
      toast('No se pudo resolver: ' + error.message, 'error')
      return
    }
    // Reactiva el bot para esa conversación
    await supabase.from('at_conversaciones').update({ estado: 'bot_activo' }).eq('id', conversacionId)
    setDerivaciones((a) => a.filter((d) => d.id !== id))
    toast('✓ Derivación resuelta', 'success')
  }

  const todas = derivaciones.filter((d) => d.estado !== 'resuelta')
  const mias = todas.filter((d) => esMia(d.motivo, d.tipo_cliente, codigoEfectivo ?? null, rolEfectivo ?? null))
  const pendientes = soloMias ? mias : todas

  return (
    <div className="space-y-3 text-ink">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="text-base font-semibold">🔔 Derivaciones del bot</h2>
        <div className="flex items-center gap-2">
          <div className="flex bg-[#F1EDE4] rounded-lg p-0.5 text-[11px]">
            <button onClick={() => setSoloMias(false)} className={`px-2.5 py-1 rounded-md font-medium ${!soloMias ? 'bg-brand text-white' : 'text-muted'}`}>Todas ({todas.length})</button>
            <button onClick={() => setSoloMias(true)} className={`px-2.5 py-1 rounded-md font-medium ${soloMias ? 'bg-brand text-white' : 'text-muted'}`}>Mías ({mias.length})</button>
          </div>
        </div>
      </div>
      <p className="text-[11px] text-faint -mt-1">Consultas que el bot de atención (WhatsApp/IG/web) no pudo resolver. Se actualizan en vivo. "Mías" = las de tu tema (envíos/comercial/pagos/…).</p>

      {loading ? (
        <p className="text-sm text-muted p-2">Cargando...</p>
      ) : pendientes.length === 0 ? (
        <p className="text-sm text-faint text-center py-10 bg-white rounded-xl border border-black/10">
          No hay derivaciones pendientes. 👌
        </p>
      ) : (
        <div className="space-y-2">
          {pendientes.map((d) => (
            <div key={d.id} className={`bg-white rounded-xl border border-black/10 border-l-4 ${motivoInfo(d.motivo).color} p-3`}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-semibold text-muted">
                  {motivoInfo(d.motivo).label}
                  {d.tipo_cliente ? ` · ${d.tipo_cliente}` : ''}
                  <span className="ml-1 inline-block rounded-full bg-brand/10 text-brandDark px-2 py-0.5 text-[10px] font-medium">→ {responsableLabel(d.motivo, d.tipo_cliente)}</span>
                </span>
                <span className="text-[10px] text-faint">
                  {new Date(d.created_at).toLocaleString('es-AR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
              <p className="text-sm text-ink mt-1">{d.resumen}</p>
              {abierta === d.id && (
                <div className="mt-2 bg-[#F7F5F0] rounded-lg p-2 max-h-64 overflow-y-auto space-y-1.5">
                  {(conv[d.conversacion_id] ?? []).length === 0 ? (
                    <p className="text-[11px] text-faint">Sin mensajes en esta conversación.</p>
                  ) : (
                    (conv[d.conversacion_id] ?? []).map((m, i) => (
                      <div key={i} className={`text-xs ${m.emisor === 'cliente' ? 'text-ink font-medium' : m.emisor === 'agente' ? 'text-emerald-700' : 'text-muted'}`}>
                        <span className="text-[9px] uppercase text-faint mr-1">{m.emisor === 'cliente' ? '👤 Cliente' : m.emisor === 'agente' ? '🧑‍💼 Vos' : '🤖 IRIS'}</span>
                        {m.contenido}
                      </div>
                    ))
                  )}
                  {/* Responder centralizado (WhatsApp) */}
                  <div className="pt-1.5 mt-1 border-t border-black/10">
                    {piezas.length > 0 && (
                      <div className="mb-1.5">
                        <select
                          value=""
                          onChange={(e) => { if (e.target.value !== '') adjuntar(d.conversacion_id, Number(e.target.value)); e.currentTarget.value = '' }}
                          className="text-[11px] rounded-lg border border-black/10 px-2 py-1 bg-white w-full max-w-xs"
                        >
                          <option value="">📎 Adjuntar material (catálogo, lista de precios…)</option>
                          {piezas.map((p, i) => <option key={i} value={i}>{p.link ? '🔗 ' : '📄 '}{p.titulo}</option>)}
                        </select>
                      </div>
                    )}
                    <div className="flex items-end gap-1.5">
                    <textarea
                      value={respuesta[d.conversacion_id] ?? ''}
                      onChange={(e) => setRespuesta((r) => ({ ...r, [d.conversacion_id]: e.target.value }))}
                      placeholder="Escribí la respuesta al cliente…"
                      rows={2}
                      className="flex-1 rounded-lg border border-black/10 px-2 py-1.5 text-xs"
                    />
                    <button
                      onClick={() => responderConv(d)}
                      disabled={enviando === d.id || !(respuesta[d.conversacion_id] ?? '').trim()}
                      className="rounded-lg bg-emerald-600 text-white px-3 py-2 text-xs font-semibold disabled:opacity-50 shrink-0"
                    >
                      {enviando === d.id ? '…' : 'Enviar'}
                    </button>
                    </div>
                  </div>
                  {contacto[d.conversacion_id] && (
                    <p className="text-[10px] text-faint">Contacto: {contacto[d.conversacion_id]}</p>
                  )}
                </div>
              )}
              <div className="flex gap-2 mt-2">
                <button onClick={() => verConversacion(d)} className="rounded-lg border border-black/10 px-3 py-1.5 text-xs font-medium text-brandDark">
                  {abierta === d.id ? 'Ocultar' : '💬 Ver conversación'}
                </button>
                {d.estado === 'pendiente' && (
                  <button onClick={() => tomar(d.id)} className="rounded-lg border border-black/10 px-3 py-1.5 text-xs font-medium text-brandDark">
                    Tomar
                  </button>
                )}
                {d.estado === 'tomada' && (
                  <button onClick={() => resolver(d.id, d.conversacion_id)} className="rounded-lg bg-emerald-600 text-white px-3 py-1.5 text-xs font-semibold">
                    ✓ Marcar resuelta
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
