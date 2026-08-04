import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'

// Comparación de los últimos 3 meses por vendedor/prospecto (contactos, propuestas,
// ventas, unidades). Muestra la tendencia mes a mes con barras.

interface Row {
  mes: string
  vendedor: string
  contactos: number
  propuestas: number
  ventas: number
  unidades: number
}
type Metric = 'contactos' | 'propuestas' | 'ventas' | 'unidades'

const METRICAS: { k: Metric; label: string; color: string }[] = [
  { k: 'contactos', label: 'Contactos', color: '#2563eb' },
  { k: 'propuestas', label: 'Propuestas', color: '#7b2ff7' },
  { k: 'ventas', label: 'Ventas', color: '#2a9d5c' },
  { k: 'unidades', label: 'Unidades', color: '#c8a96e' },
]
const NOMBRE: Record<string, string> = {
  Adrian: 'Adrián',
  Martin: 'Martín',
  Corporativo: 'Corporativo',
  Damian: 'Damián',
  Marketing: 'Luna (prosp.)',
}
const mesLabel = (m: string) => {
  const [, mm] = m.split('-')
  return ['', 'Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'][parseInt(mm)] ?? m
}

export default function Comparativa3Meses() {
  const [rows, setRows] = useState<Row[]>([])
  const [metric, setMetric] = useState<Metric>('ventas')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.rpc('comparativa_3meses').then(({ data }) => {
      setRows((data as Row[]) ?? [])
      setLoading(false)
    })
  }, [])

  const { meses, porVendedor } = useMemo(() => {
    const meses = [...new Set(rows.map((r) => r.mes))].sort()
    const map = new Map<string, Record<string, Row>>()
    for (const r of rows) {
      if (!map.has(r.vendedor)) map.set(r.vendedor, {})
      map.get(r.vendedor)![r.mes] = r
    }
    return { meses, porVendedor: [...map.entries()] }
  }, [rows])

  const conf = METRICAS.find((m) => m.k === metric)!
  const maxGlobal = Math.max(1, ...rows.map((r) => r[metric]))

  const flecha = (vals: number[]) => {
    if (vals.length < 2) return ''
    const d = vals[vals.length - 1] - vals[0]
    return d > 0 ? '↑' : d < 0 ? '↓' : '→'
  }

  return (
    <div className="bg-white rounded-xl p-4 border border-black/10">
      <div className="flex items-center justify-between gap-2 flex-wrap mb-3">
        <p className="text-sm font-semibold text-ink">📈 Comparación últimos 3 meses</p>
        <div className="flex gap-1 flex-wrap">
          {METRICAS.map((m) => (
            <button
              key={m.k}
              onClick={() => setMetric(m.k)}
              className="text-[11px] rounded-full px-2.5 py-1 border font-medium"
              style={
                metric === m.k
                  ? { background: m.color, color: '#fff', borderColor: m.color }
                  : { borderColor: 'rgba(0,0,0,.1)', color: '#6b7280' }
              }
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-muted">Cargando…</p>
      ) : porVendedor.length === 0 ? (
        <p className="text-sm text-faint">Sin datos en los últimos 3 meses.</p>
      ) : (
        <div className="space-y-3">
          {porVendedor.map(([vend, porMes]) => {
            const vals = meses.map((m) => porMes[m]?.[metric] ?? 0)
            return (
              <div key={vend}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-semibold text-ink">{NOMBRE[vend] ?? vend}</span>
                  <span className="text-[11px] text-faint">
                    {conf.label} · {flecha(vals)} {vals[0]}→{vals[vals.length - 1]}
                  </span>
                </div>
                <div className="flex items-end gap-2 h-16">
                  {meses.map((m, i) => {
                    const v = vals[i]
                    const h = Math.max(3, Math.round((v / maxGlobal) * 100))
                    return (
                      <div key={m} className="flex-1 flex flex-col items-center justify-end h-full">
                        <span className="text-[10px] font-semibold text-ink mb-0.5">{v}</span>
                        <div className="w-full rounded-t" style={{ height: `${h}%`, background: conf.color, opacity: 0.55 + 0.45 * (i / Math.max(1, meses.length - 1)) }} />
                        <span className="text-[9px] text-faint mt-0.5">{mesLabel(m)}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      )}
      <p className="text-[10px] text-faint mt-2">
        La barra más oscura es el mes más reciente. Ventas = contactos que cerraron unidades.
      </p>
    </div>
  )
}
