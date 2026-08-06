import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'
import { useToast } from '../../lib/toast'

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
  const { vendedor } = useAuth()
  const toast = useToast()
  const [derivaciones, setDerivaciones] = useState<Derivacion[]>([])
  const [loading, setLoading] = useState(true)
  const [abierta, setAbierta] = useState<string | null>(null)
  const [conv, setConv] = useState<Record<string, { emisor: string; contenido: string }[]>>({})
  const [contacto, setContacto] = useState<Record<string, string | null>>({})

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

  const pendientes = derivaciones.filter((d) => d.estado !== 'resuelta')

  return (
    <div className="space-y-3 text-ink">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">🔔 Derivaciones del bot</h2>
        <span className="text-xs text-muted">
          {pendientes.length} pendiente{pendientes.length !== 1 ? 's' : ''}
        </span>
      </div>
      <p className="text-[11px] text-faint -mt-1">Consultas que el bot de atención (WhatsApp/IG/web) no pudo resolver. Se actualizan en vivo.</p>

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
                      <div key={i} className={`text-xs ${m.emisor === 'bot' ? 'text-muted' : 'text-ink font-medium'}`}>
                        <span className="text-[9px] uppercase text-faint mr-1">{m.emisor === 'bot' ? '🤖 IRIS' : '👤 Cliente'}</span>
                        {m.contenido}
                      </div>
                    ))
                  )}
                  {contacto[d.conversacion_id] && (
                    <a
                      href={`https://wa.me/${(contacto[d.conversacion_id] || '').replace(/\D/g, '')}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-block mt-1 text-[11px] font-semibold text-emerald-700"
                    >
                      💬 Responder por WhatsApp ({contacto[d.conversacion_id]}) →
                    </a>
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
