import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'

// Mapa de zonas: drill-down provincia → localidad, con barras de "calor" por métrica.
// (Versión sin geografía literal — heat ranking; un mapa coroplético real se puede
// sumar después con un GeoJSON de provincias/departamentos.)

interface ZonaRow {
  zona: string
  clientes: number
  con_venta: number
  activos_90: number
  sin_contactar: number
  unidades_2025: number
}
type Metric = 'unidades' | 'clientes' | 'frio'

const METRICAS: { k: Metric; label: string }[] = [
  { k: 'unidades', label: '🔥 Volumen (u. 2025)' },
  { k: 'clientes', label: '👥 Clientes' },
  { k: 'frio', label: '❄ Sin contactar' },
]

export default function MapaZonas() {
  const [prov, setProv] = useState<string | null>(null)
  const [rows, setRows] = useState<ZonaRow[]>([])
  const [loading, setLoading] = useState(true)
  const [metric, setMetric] = useState<Metric>('unidades')

  useEffect(() => {
    setLoading(true)
    supabase.rpc('zonas_agregado', { p_provincia: prov }).then(({ data, error }) => {
      setRows(error ? [] : ((data as ZonaRow[]) ?? []))
      setLoading(false)
    })
  }, [prov])

  const valor = (r: ZonaRow) => (metric === 'unidades' ? r.unidades_2025 : metric === 'clientes' ? r.clientes : r.sin_contactar)
  const ordenadas = [...rows].sort((a, b) => valor(b) - valor(a))
  const max = Math.max(1, ...ordenadas.map(valor))
  const esFrio = metric === 'frio'

  return (
    <div className="space-y-3 text-ink">
      <div className="flex items-center gap-2 flex-wrap">
        <h2 className="text-base font-semibold">🗺 Mapa de zonas</h2>
        {prov && (
          <button onClick={() => setProv(null)} className="text-xs text-brandDark font-medium">
            ← Provincias
          </button>
        )}
      </div>
      <p className="text-[11px] text-faint -mt-1">
        {prov ? `Localidades de ${prov}` : 'Provincias'} · tocá una zona para {prov ? 'volver' : 'ver sus localidades'}.
      </p>

      <div className="flex gap-1.5 flex-wrap">
        {METRICAS.map((m) => (
          <button
            key={m.k}
            onClick={() => setMetric(m.k)}
            className={`text-[11px] rounded-full px-3 py-1.5 border font-medium ${
              metric === m.k ? 'bg-brand text-white border-brand' : 'border-black/10 text-muted'
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-sm text-muted p-2">Cargando...</p>
      ) : ordenadas.length === 0 ? (
        <p className="text-sm text-faint text-center py-8 bg-white rounded-xl border border-black/10">Sin datos.</p>
      ) : (
        <div className="space-y-1.5">
          {ordenadas.map((r) => {
            const v = valor(r)
            const pct = (v / max) * 100
            return (
              <button
                key={r.zona}
                onClick={() => !prov && setProv(r.zona)}
                className={`w-full text-left bg-white rounded-xl border border-black/10 p-3 ${!prov ? 'hover:border-brand/40' : 'cursor-default'}`}
              >
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <span className="text-sm font-medium truncate">
                    {!prov && '▸ '}
                    {r.zona}
                  </span>
                  <span className="text-sm font-bold tabular-nums" style={{ color: esFrio ? '#2563eb' : '#c0392b' }}>
                    {v.toLocaleString('es-AR')}
                  </span>
                </div>
                <div className="h-2 bg-black/5 rounded-full overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${pct}%`, background: esFrio ? '#3b82f6' : '#e0503a' }} />
                </div>
                <p className="text-[10px] text-muted mt-1.5">
                  {r.clientes} clientes · {r.con_venta} con venta · {r.activos_90} activos 90d · {r.sin_contactar} sin contactar · {r.unidades_2025} u.
                </p>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
