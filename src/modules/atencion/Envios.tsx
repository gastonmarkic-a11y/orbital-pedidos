import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'

// Panel de Envíos: espejo de los envíos de Envia.com (e-commerce / B2C).
// Resumen por estado + búsqueda/listado. Botón para sincronizar contra Envia.

interface EnvioRow {
  tracking_number: string
  carrier: string | null
  estado: string
  service: string | null
  consignee_name: string | null
  consignee_city: string | null
  consignee_phone: string | null
  shipped_at: string | null
  delivered_at: string | null
  estimated_delivery: string | null
  carrier_track_url: string | null
}
interface Resumen {
  total: number
  entregado: number
  en_transito: number
  generado: number
  incidencia: number
  cancelado: number
  ult_sync: string | null
}

const ESTADOS: { k: string; label: string; color: string; bg: string }[] = [
  { k: '', label: 'Todos', color: '#374151', bg: '#f3f4f6' },
  { k: 'En tránsito', label: '🚚 En tránsito', color: '#1d4ed8', bg: '#dbeafe' },
  { k: 'Generado', label: '⏳ Generado', color: '#a16207', bg: '#fef9c3' },
  { k: 'Incidencia', label: '⚠ Incidencia', color: '#b91c1c', bg: '#fee2e2' },
  { k: 'Entregado', label: '✅ Entregado', color: '#15803d', bg: '#dcfce7' },
  { k: 'Cancelado', label: '❌ Cancelado', color: '#6b7280', bg: '#f3f4f6' },
]

function colorEstado(e: string) {
  return ESTADOS.find((x) => x.k === e) ?? { color: '#374151', bg: '#f3f4f6' }
}
function fecha(v: string | null) {
  if (!v) return '—'
  try {
    return new Date(v).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
  } catch {
    return v
  }
}
function linkTrack(url: string | null, tn: string) {
  if (!url) return null
  return url.trim().endsWith('=') ? url + tn : url
}

interface PedidoDespacho {
  id: number
  cliente: string | null
  estado: string | null
  fecha_entrega: string | null
  tipo_transporte: string | null
  nro_guia: string | null
  contacto_entrega: string | null
  direccion_entrega: string | null
  vendedor: string | null
}

export default function Envios() {
  const [resumen, setResumen] = useState<Resumen | null>(null)
  const [rows, setRows] = useState<EnvioRow[]>([])
  const [pedidos, setPedidos] = useState<PedidoDespacho[]>([])
  const [q, setQ] = useState('')
  const [estado, setEstado] = useState('')
  const [loading, setLoading] = useState(true)
  const [sync, setSync] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const cargarResumen = useCallback(() => {
    supabase.rpc('envios_resumen').then(({ data }) => setResumen((data as Resumen) ?? null))
  }, [])

  const cargarLista = useCallback(() => {
    setLoading(true)
    supabase
      .rpc('buscar_envios', { q: q || null, p_estado: estado || null, p_limit: 60, p_offset: 0 })
      .then(({ data, error }) => {
        setRows(error ? [] : ((data as EnvioRow[]) ?? []))
        setLoading(false)
      })
  }, [q, estado])

  useEffect(() => {
    cargarResumen()
    // Pedidos del sistema (B2B) en estados de despacho — no solo e-commerce.
    supabase
      .from('pedidos')
      .select('id, cliente, estado, fecha_entrega, tipo_transporte, nro_guia, contacto_entrega, direccion_entrega, vendedor')
      .in('estado', ['listo_despachar', 'despachado'])
      .neq('vendedor', 'Tienda')
      .order('id', { ascending: false })
      .then(({ data }) => setPedidos((data as PedidoDespacho[]) ?? []))
  }, [cargarResumen])

  useEffect(() => {
    const t = setTimeout(cargarLista, 250) // debounce búsqueda
    return () => clearTimeout(t)
  }, [cargarLista])

  async function sincronizar() {
    setSync(true)
    setMsg(null)
    try {
      const { data, error } = await supabase.functions.invoke('sync-envios', { body: {} })
      if (error) throw error
      const d = data as { total?: number; estados?: Record<string, number> }
      setMsg(`Sincronizados ${d?.total ?? 0} envíos recientes desde Envia.`)
      cargarResumen()
      cargarLista()
    } catch (e) {
      setMsg('No se pudo sincronizar: ' + (e as Error).message)
    } finally {
      setSync(false)
    }
  }

  return (
    <div className="space-y-3 text-ink">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h2 className="text-base font-semibold">📦 Envíos</h2>
          <p className="text-[11px] text-faint">
            Pedidos B2B del sistema para despacho + envíos de e-commerce (Envia){resumen?.ult_sync ? ` · sync ${fecha(resumen.ult_sync)}` : ''}
          </p>
        </div>
        <button
          onClick={sincronizar}
          disabled={sync}
          className="text-xs rounded-full px-3 py-1.5 bg-brand text-white font-medium disabled:opacity-50"
        >
          {sync ? 'Sincronizando…' : '↻ Sincronizar'}
        </button>
      </div>

      {msg && <p className="text-[11px] text-brandDark bg-brand/5 rounded-lg px-3 py-2">{msg}</p>}

      {/* Pedidos del sistema (B2B) para despacho */}
      <div className="bg-white rounded-xl border border-black/10 p-3">
        <p className="text-sm font-semibold mb-1">
          🚚 Pedidos B2B para despacho
          <span className="text-[11px] text-faint font-normal">
            {' '}· {pedidos.filter((p) => p.estado === 'listo_despachar').length} listos ·{' '}
            {pedidos.filter((p) => p.estado === 'despachado').length} despachados
          </span>
        </p>
        {pedidos.length === 0 ? (
          <p className="text-[11px] text-faint">No hay pedidos del sistema en estado de despacho.</p>
        ) : (
          <div className="space-y-1 max-h-56 overflow-y-auto">
            {pedidos.map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-2 text-xs border-t border-black/5 pt-1 first:border-0 first:pt-0">
                <span className="truncate">
                  <b>{p.cliente || `#${p.id}`}</b>
                  <span className="text-faint"> · {p.tipo_transporte || 's/transporte'}{p.nro_guia ? ` · guía ${p.nro_guia}` : ''}</span>
                </span>
                <span
                  className="text-[10px] font-bold rounded-full px-2 py-0.5 whitespace-nowrap"
                  style={p.estado === 'despachado' ? { background: '#dbeafe', color: '#1d4ed8' } : { background: '#fef9c3', color: '#a16207' }}
                >
                  {p.estado === 'despachado' ? '🚚 despachado' : '📦 listo p/despachar'}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <p className="text-[10px] uppercase text-faint font-semibold tracking-wide pt-1">E-commerce (Envia)</p>
      {/* Tiles de resumen */}
      {resumen && (
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5">
          {([
            ['Total', resumen.total, '#374151', '#f3f4f6'],
            ['En tránsito', resumen.en_transito, '#1d4ed8', '#dbeafe'],
            ['Generado', resumen.generado, '#a16207', '#fef9c3'],
            ['Incidencia', resumen.incidencia, '#b91c1c', '#fee2e2'],
            ['Entregado', resumen.entregado, '#15803d', '#dcfce7'],
            ['Cancelado', resumen.cancelado, '#6b7280', '#f3f4f6'],
          ] as [string, number, string, string][]).map(([lbl, val, color, bg]) => (
            <div key={lbl} className="rounded-xl p-2.5 text-center" style={{ background: bg }}>
              <div className="text-lg font-bold tabular-nums" style={{ color }}>
                {(val ?? 0).toLocaleString('es-AR')}
              </div>
              <div className="text-[10px] font-medium" style={{ color }}>
                {lbl}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Filtros */}
      <div className="flex gap-1.5 flex-wrap">
        {ESTADOS.map((e) => (
          <button
            key={e.k || 'todos'}
            onClick={() => setEstado(e.k)}
            className="text-[11px] rounded-full px-3 py-1.5 border font-medium"
            style={
              estado === e.k
                ? { background: e.color, color: '#fff', borderColor: e.color }
                : { borderColor: 'rgba(0,0,0,.1)', color: '#6b7280' }
            }
          >
            {e.label}
          </button>
        ))}
      </div>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Buscar por tracking, nombre, teléfono, email o ciudad…"
        className="w-full border border-black/10 rounded-xl px-3 py-2 text-sm outline-none focus:border-brand"
      />

      {/* Lista */}
      {loading ? (
        <p className="text-sm text-muted p-2">Cargando…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-faint text-center py-8 bg-white rounded-xl border border-black/10">Sin envíos.</p>
      ) : (
        <div className="space-y-1.5">
          {rows.map((r) => {
            const c = colorEstado(r.estado)
            const link = linkTrack(r.carrier_track_url, r.tracking_number)
            return (
              <div key={r.tracking_number} className="bg-white rounded-xl border border-black/10 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold truncate">{r.consignee_name || 'Sin nombre'}</span>
                  <span
                    className="text-[10px] font-bold rounded-full px-2 py-0.5 whitespace-nowrap"
                    style={{ background: c.bg, color: c.color }}
                  >
                    {r.estado}
                  </span>
                </div>
                <p className="text-[11px] text-muted mt-0.5">
                  #{r.tracking_number} · {r.carrier ?? '—'} · {r.consignee_city ?? '—'}
                  {r.consignee_phone ? ` · ${r.consignee_phone}` : ''}
                </p>
                <p className="text-[10px] text-faint mt-1">
                  {r.estado === 'Entregado'
                    ? `Entregado: ${fecha(r.delivered_at)}`
                    : r.estado === 'En tránsito'
                    ? `Estimada: ${fecha(r.estimated_delivery)}`
                    : r.shipped_at
                    ? `Despachado: ${fecha(r.shipped_at)}`
                    : 'Aún sin despachar'}
                  {link && (
                    <>
                      {' · '}
                      <a href={link} target="_blank" rel="noreferrer" className="text-brandDark font-medium">
                        Seguir ↗
                      </a>
                    </>
                  )}
                </p>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
