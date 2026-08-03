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
  motivo: 'sin_respuesta' | 'confirmar_stock' | 'reclamo_excepcion'
  resumen: string
  tipo_cliente: 'mayorista' | 'minorista' | null
  estado: 'pendiente' | 'tomada' | 'resuelta'
  created_at: string
}

const MOTIVO: Record<Derivacion['motivo'], { label: string; color: string }> = {
  sin_respuesta: { label: '❓ Sin respuesta en la base', color: 'border-amber-400' },
  confirmar_stock: { label: '📦 Confirmar stock', color: 'border-emerald-500' },
  reclamo_excepcion: { label: '⚠ Reclamo / excepción', color: 'border-red-500' },
}

export default function Derivaciones() {
  const { vendedor } = useAuth()
  const toast = useToast()
  const [derivaciones, setDerivaciones] = useState<Derivacion[]>([])
  const [loading, setLoading] = useState(true)

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
            <div key={d.id} className={`bg-white rounded-xl border border-black/10 border-l-4 ${MOTIVO[d.motivo].color} p-3`}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-semibold text-muted">
                  {MOTIVO[d.motivo].label}
                  {d.tipo_cliente ? ` · ${d.tipo_cliente}` : ''}
                </span>
                <span className="text-[10px] text-faint">
                  {new Date(d.created_at).toLocaleString('es-AR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
              <p className="text-sm text-ink mt-1">{d.resumen}</p>
              <div className="flex gap-2 mt-2">
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
