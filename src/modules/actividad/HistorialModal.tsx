import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { Actividad, Cliente, Propuesta } from '../../lib/types'
import { NOMBRE_OPERADOR } from '../../lib/operadores'

// Ícono del canal/tipo de cada contacto, para el gráfico de secuencia
function iconoDe(desarrollo: string | null): { icono: string; label: string } {
  const d = (desarrollo || '').toLowerCase()
  if (d.includes('llamada')) return { icono: '📞', label: 'Llamada' }
  if (d.includes('whatsapp')) return { icono: '💬', label: 'WhatsApp' }
  if (d.includes('mail') || d.includes('correo')) return { icono: '✉️', label: 'Mail' }
  if (d.includes('venta')) return { icono: '🛒', label: 'Venta' }
  if (d.includes('visita') || d.includes('derivad')) return { icono: '🏪', label: 'Visita' }
  if (d.includes('reuni')) return { icono: '📅', label: 'Reunión' }
  return { icono: '📝', label: 'Nota' }
}

type Compras = {
  anios: { anio: number; unidades: number; importe: number; compras: number }[]
  ultima: string | null
  modelos: { modelo: string; unidades: number; ultimo: number }[]
  suite: { id: number; fecha: string; unidades: number; importe: number; estado: string }[]
}

const pesos = (n: number) => '$' + Math.round(n).toLocaleString('es-AR')
const mesLabel = (am: string) =>
  new Date(am + '-01T00:00:00').toLocaleDateString('es-AR', { month: 'short', year: 'numeric' })

function HistorialCompras({ cod }: { cod: string }) {
  const [data, setData] = useState<Compras | null>(null)
  const [verTodos, setVerTodos] = useState(false)

  useEffect(() => {
    supabase.rpc('cliente_historial_compras', { p_cod: cod }).then(({ data }) => setData((data as Compras) ?? null))
  }, [cod])

  if (!data) return null
  if (data.anios.length === 0 && data.suite.length === 0)
    return (
      <div className="border-b border-black/10 px-4 py-3">
        <p className="text-[10px] uppercase text-faint font-semibold mb-1">🛒 Historial de compras</p>
        <p className="text-xs text-faint">Sin compras registradas con este código.</p>
      </div>
    )

  const totU = data.anios.reduce((a, r) => a + Number(r.unidades), 0)
  const totI = data.anios.reduce((a, r) => a + Number(r.importe), 0)
  const modelos = verTodos ? data.modelos : data.modelos.slice(0, 10)

  return (
    <div className="border-b border-black/10 px-4 py-3 space-y-3">
      <div className="flex items-baseline justify-between">
        <p className="text-[10px] uppercase text-faint font-semibold">🛒 Historial de compras</p>
        <p className="text-xs text-muted">
          {totU} u. · {pesos(totI)}
          {data.ultima && <> · última {mesLabel(data.ultima)}</>}
        </p>
      </div>

      <table className="w-full text-xs">
        <thead>
          <tr className="text-faint text-left">
            <th className="font-normal">Año</th>
            <th className="font-normal text-right">Unid.</th>
            <th className="font-normal text-right">Neto</th>
            <th className="font-normal text-right">Compras</th>
          </tr>
        </thead>
        <tbody>
          {data.anios.map((r) => (
            <tr key={r.anio} className="border-t border-black/5">
              <td className="py-1 text-ink font-semibold">{r.anio}</td>
              <td className="py-1 text-right">{r.unidades}</td>
              <td className="py-1 text-right">{pesos(r.importe)}</td>
              <td className="py-1 text-right">{r.compras}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {data.modelos.length > 0 && (
        <div>
          <p className="text-[10px] uppercase text-faint font-semibold mb-1">Modelos que compró</p>
          <div className="flex flex-wrap gap-1">
            {modelos.map((m) => (
              <span key={m.modelo} className="text-[11px] bg-[#F7F5F0] border border-black/10 rounded-full px-2 py-0.5" title={`Último: ${m.ultimo}`}>
                {m.modelo} <span className="text-faint">×{m.unidades} · {m.ultimo}</span>
              </span>
            ))}
            {data.modelos.length > 10 && (
              <button onClick={() => setVerTodos(!verTodos)} className="text-[11px] text-brandDark underline px-1">
                {verTodos ? 'ver menos' : `+${data.modelos.length - 10} más`}
              </button>
            )}
          </div>
        </div>
      )}

      {data.suite.length > 0 && (
        <div>
          <p className="text-[10px] uppercase text-faint font-semibold mb-1">Pedidos en la Suite</p>
          {data.suite.map((p) => (
            <p key={p.id} className="text-xs text-ink">
              #{p.id} · {new Date(p.fecha + 'T00:00:00').toLocaleDateString('es-AR', { day: 'numeric', month: 'short', year: 'numeric' })} ·{' '}
              {p.unidades} u. {p.importe ? `· ${pesos(p.importe)}` : ''} <span className="text-faint">({p.estado})</span>
            </p>
          ))}
        </div>
      )}
      <p className="text-[10px] text-faint">Tango hasta jul-26 + Suite desde ago-26. Importes netos en pesos de cada momento.</p>
    </div>
  )
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
            <p className="text-xs text-faint">Historial de compras y contactos</p>
          </div>
          <button onClick={onClose} className="text-sm text-muted">
            Cerrar ✕
          </button>
        </div>
        <HistorialCompras cod={cliente.cod} />
        {/* Gráfico de secuencia de contactos (viejo → nuevo) */}
        {!loading && rows.length > 0 && (
          <div className="border-b border-black/10 px-4 py-3 bg-[#F7F5F0]">
            <p className="text-[10px] uppercase text-faint font-semibold mb-2">🔗 Secuencia de contactos</p>
            <div className="flex items-center gap-0.5 overflow-x-auto pb-1">
              {[...rows].reverse().map((a, i, arr) => {
                const ic = iconoDe(a.actividad_desarrollo)
                return (
                  <div key={a.id} className="flex items-center shrink-0">
                    <div
                      className="flex flex-col items-center px-0.5"
                      title={`${ic.label} · ${a.actividad_desarrollo ?? ''}`}
                    >
                      <span className="text-lg leading-none">{ic.icono}</span>
                      <span className="text-[9px] text-faint mt-0.5">
                        {new Date(a.fecha + 'T00:00:00').toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })}
                      </span>
                    </div>
                    {i < arr.length - 1 && <span className="text-faint text-xs">→</span>}
                  </div>
                )
              })}
            </div>
          </div>
        )}
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
