import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { Actividad, Cliente, Propuesta } from '../../lib/types'

const NOMBRE_OPERADOR: Record<string, string> = {
  Marketing: 'Luna',
  ProspeccionVenta: 'Damián',
  Adrian: 'Adrián',
  Martin: 'Martín',
  Corporativo: 'Corporativo',
}

export default function HistorialModal({
  cliente,
  propuestas,
  onClose,
}: {
  cliente: Cliente
  propuestas: Propuesta[]
  onClose: () => void
}) {
  const [rows, setRows] = useState<Actividad[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase
      .from('actividad_diaria')
      .select('*')
      .eq('cod_cliente', cliente.cod)
      .order('fecha', { ascending: false })
      .then(({ data }) => {
        setRows((data as Actividad[]) ?? [])
        setLoading(false)
      })
  }, [cliente.cod])

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-end md:items-center justify-center p-0 md:p-4" onClick={onClose}>
      <div
        className="bg-white rounded-t-2xl md:rounded-2xl border border-black/10 w-full md:max-w-lg max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-white border-b border-black/10 px-4 py-3 flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-ink">{cliente.nomcomerc || cliente.razon}</p>
            <p className="text-xs text-faint">Historial de contactos</p>
          </div>
          <button onClick={onClose} className="text-sm text-muted">
            Cerrar ✕
          </button>
        </div>
        <div className="p-4 space-y-3">
          {loading ? (
            <p className="text-sm text-muted">Cargando...</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-faint text-center py-8">Todavía no hay actividad registrada con este cliente.</p>
          ) : (
            rows.map((a) => {
              const prop = a.propuesta_enviada_id ? propuestas.find((p) => p.id === a.propuesta_enviada_id) : null
              return (
                <div key={a.id} className="border-l-2 border-brand/30 pl-3">
                  <p className="text-xs text-faint">
                    {new Date(a.fecha + 'T00:00:00').toLocaleDateString('es-AR', {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                    })}{' '}
                    · <span className="text-brandDark font-semibold">{a.vendedor ? NOMBRE_OPERADOR[a.vendedor] ?? a.vendedor : '—'}</span>
                  </p>
                  <p className="text-sm text-ink">{a.actividad_desarrollo}</p>
                  {prop && (
                    <p className="text-xs text-emerald-700 bg-emerald-50 inline-block rounded-full px-2 py-0.5 mt-1">
                      ✓ {prop.nombre}
                    </p>
                  )}
                  {a.voz_cliente_nota && <p className="text-xs text-muted mt-1">📝 {a.voz_cliente_nota}</p>}
                  {a.actividad_futura && <p className="text-xs text-ink mt-1">➡ {a.actividad_futura}</p>}
                  {(a.unidades_vendidas ?? 0) > 0 && (
                    <p className="text-xs text-amber-700 mt-1">
                      🛒 Venta: {a.unidades_vendidas} u.{' '}
                      {a.monto_vendido ? `· $${Math.round(a.monto_vendido).toLocaleString()}` : ''}
                    </p>
                  )}
                </div>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}
