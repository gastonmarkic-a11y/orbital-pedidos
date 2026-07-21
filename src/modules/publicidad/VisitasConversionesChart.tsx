import { useMemo, useState } from 'react'
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts'

interface Insight {
  fecha: string
  clicks: number
  purchases_meta: number
  spend: number
}

const TIMEFRAMES = [
  { label: '7D', dias: 7 },
  { label: '30D', dias: 30 },
  { label: '90D', dias: 90 },
] as const

function diaCorto(fecha: string): string {
  const [, m, d] = fecha.split('-')
  return `${d}/${m}`
}

function fmtCompacto(n: number): string {
  if (!isFinite(n)) return '—'
  if (Math.abs(n) >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (Math.abs(n) >= 1_000) return Math.round(n / 1000) + 'k'
  return String(Math.round(n))
}

export default function VisitasConversionesChart({ insights }: { insights: Insight[] }) {
  const [rango, setRango] = useState<number>(30)

  const serie = useMemo(() => {
    const porDia = new Map<string, { clicks: number; conversiones: number; inversion: number }>()
    for (const i of insights) {
      const cur = porDia.get(i.fecha) ?? { clicks: 0, conversiones: 0, inversion: 0 }
      cur.clicks += Number(i.clicks) || 0
      cur.conversiones += Number(i.purchases_meta) || 0
      cur.inversion += Number(i.spend) || 0
      porDia.set(i.fecha, cur)
    }
    const dias = [...porDia.entries()].sort((a, b) => b[0].localeCompare(a[0]))
    const cortados = dias.slice(0, rango)
    return cortados
      .slice()
      .reverse()
      .map(([fecha, v]) => ({ label: diaCorto(fecha), ...v }))
  }, [insights, rango])

  const hayDatos = serie.length > 1

  return (
    <div className="bg-white border border-black/10 rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-sm font-semibold">🖱️ Visitas, conversiones e inversión</h2>
          <p className="text-[11px] text-muted mt-0.5">
            "Visitas" = clicks en los anuncios de Meta, no tráfico total del sitio (no hay Analytics conectado hoy) —
            es la aproximación más cercana disponible.
          </p>
        </div>
        <div className="flex rounded-lg border border-black/10 overflow-hidden">
          {TIMEFRAMES.map((tf) => (
            <button
              key={tf.label}
              onClick={() => setRango(tf.dias)}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                rango === tf.dias ? 'bg-brand text-white' : 'bg-white text-muted hover:bg-[#F1EDE4]'
              }`}
            >
              {tf.label}
            </button>
          ))}
        </div>
      </div>

      {!hayDatos ? (
        <div className="h-[260px] flex items-center justify-center text-xs text-faint">
          Todavía no hay suficientes días con datos de Meta para graficar esta ventana.
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={260}>
          <ComposedChart data={serie} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="#00000010" vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 11, fill: '#9B968B' }}
              axisLine={{ stroke: '#00000014' }}
              tickLine={false}
              minTickGap={24}
            />
            <YAxis
              yAxisId="left"
              tick={{ fontSize: 11, fill: '#9B968B' }}
              axisLine={false}
              tickLine={false}
              width={36}
              tickFormatter={fmtCompacto}
            />
            <YAxis
              yAxisId="right"
              orientation="right"
              tick={{ fontSize: 11, fill: '#9B968B' }}
              axisLine={false}
              tickLine={false}
              width={40}
              tickFormatter={(v) => '$' + fmtCompacto(v)}
            />
            <Tooltip cursor={{ stroke: '#9B968B', strokeWidth: 1, strokeDasharray: '3 3' }} content={<VisitasTooltip />} />
            <Line
              yAxisId="left"
              type="monotone"
              dataKey="clicks"
              name="Visitas (clicks)"
              stroke="#3291ff"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
              isAnimationActive={false}
            />
            <Line
              yAxisId="left"
              type="monotone"
              dataKey="conversiones"
              name="Conversiones"
              stroke="#059669"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
              isAnimationActive={false}
            />
            <Line
              yAxisId="right"
              type="monotone"
              dataKey="inversion"
              name="Inversión"
              stroke="#C8A96E"
              strokeWidth={2}
              strokeDasharray="4 3"
              dot={false}
              activeDot={{ r: 4 }}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      )}

      <div className="flex items-center gap-4 text-[11px] text-muted flex-wrap">
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-0.5 bg-[#3291ff]" /> Visitas (clicks)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-0.5 bg-[#059669]" /> Conversiones
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 border-t-2 border-dashed border-[#C8A96E]" /> Inversión ($, eje derecho)
        </span>
      </div>
    </div>
  )
}

function VisitasTooltip({ active, payload, label }: any) {
  if (!active || !payload || !payload.length) return null
  const clicks = payload.find((p: any) => p.dataKey === 'clicks')?.value
  const conv = payload.find((p: any) => p.dataKey === 'conversiones')?.value
  const inv = payload.find((p: any) => p.dataKey === 'inversion')?.value
  return (
    <div className="bg-white border border-black/10 rounded-lg shadow-sm px-3 py-2 text-xs space-y-1">
      <div className="font-semibold text-ink">{label}</div>
      <div className="flex items-center justify-between gap-4">
        <span className="text-muted">Visitas (clicks)</span>
        <span className="font-medium tabular-nums text-[#1a6fd6]">{clicks ?? 0}</span>
      </div>
      <div className="flex items-center justify-between gap-4">
        <span className="text-muted">Conversiones</span>
        <span className="font-medium tabular-nums text-emerald-700">{conv ?? 0}</span>
      </div>
      <div className="flex items-center justify-between gap-4">
        <span className="text-muted">Inversión</span>
        <span className="font-medium tabular-nums text-[#8F6A34]">$ {Math.round(inv ?? 0).toLocaleString('es-AR')}</span>
      </div>
    </div>
  )
}
