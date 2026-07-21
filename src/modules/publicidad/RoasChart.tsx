import { useMemo, useState } from 'react'
import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
} from 'recharts'

interface DiaRoas {
  fecha: string
  roas_real: number | null
  roas_meta: number | null
  pedidos_shopify: number
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

function fmt(n: number | null | undefined, dec = 2): string {
  if (n === null || n === undefined || !isFinite(n)) return '—'
  return n.toFixed(dec)
}

export default function RoasChart({
  dias,
  roasObjetivo,
  breakEven,
}: {
  dias: DiaRoas[]
  roasObjetivo?: number
  breakEven?: number
}) {
  const [rango, setRango] = useState<number>(30)

  const serie = useMemo(() => {
    // dias llega ordenado desc (más nuevo primero) — el gráfico va cronológico, izquierda→derecha.
    const conDatos = [...dias].filter((d) => d.pedidos_shopify > 0)
    const cortados = conDatos.slice(0, rango)
    return cortados
      .slice()
      .reverse()
      .map((d) => ({
        fecha: d.fecha,
        label: diaCorto(d.fecha),
        real: d.roas_real === null ? null : Number(d.roas_real),
        meta: d.roas_meta === null ? null : Number(d.roas_meta),
      }))
  }, [dias, rango])

  const hayDatos = serie.length > 1

  return (
    <div className="bg-white border border-black/10 rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-sm font-semibold">📈 Histórico de ROAS</h2>
          <p className="text-[11px] text-muted mt-0.5">
            Pasá el mouse por el gráfico para ver el valor exacto de cada día.
          </p>
        </div>
        <div className="flex rounded-lg border border-black/10 overflow-hidden">
          {TIMEFRAMES.map((tf) => (
            <button
              key={tf.label}
              onClick={() => setRango(tf.dias)}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                rango === tf.dias
                  ? 'bg-brand text-white'
                  : 'bg-white text-muted hover:bg-[#F1EDE4]'
              }`}
            >
              {tf.label}
            </button>
          ))}
        </div>
      </div>

      {!hayDatos ? (
        <div className="h-[260px] flex items-center justify-center text-xs text-faint">
          Todavía no hay suficientes días con ventas para graficar esta ventana.
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
              tick={{ fontSize: 11, fill: '#9B968B' }}
              axisLine={false}
              tickLine={false}
              width={36}
              tickFormatter={(v) => fmt(v, 1)}
            />
            {breakEven !== undefined && (
              <ReferenceLine
                y={breakEven}
                stroke="#e5484d"
                strokeDasharray="4 4"
                strokeWidth={1}
                label={{ value: `Break-even ${fmt(breakEven)}`, position: 'insideBottomLeft', fontSize: 10, fill: '#e5484d' }}
              />
            )}
            {roasObjetivo !== undefined && (
              <ReferenceLine
                y={roasObjetivo}
                stroke="#8F6A34"
                strokeDasharray="4 4"
                strokeWidth={1}
                label={{ value: `Objetivo ${fmt(roasObjetivo)}`, position: 'insideTopLeft', fontSize: 10, fill: '#8F6A34' }}
              />
            )}
            <Tooltip
              cursor={{ stroke: '#9B968B', strokeWidth: 1, strokeDasharray: '3 3' }}
              content={<RoasTooltip />}
            />
            <Area
              type="monotone"
              dataKey="real"
              stroke="none"
              fill="#15151A"
              fillOpacity={0.05}
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="real"
              name="ROAS real"
              stroke="#15151A"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
              connectNulls
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="meta"
              name="ROAS Meta"
              stroke="#C8A96E"
              strokeWidth={2}
              strokeDasharray="4 3"
              dot={false}
              activeDot={{ r: 4 }}
              connectNulls
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      )}

      <div className="flex items-center gap-4 text-[11px] text-muted">
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-0.5 bg-[#15151A]" /> ROAS real
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 border-t-2 border-dashed border-[#C8A96E]" />
          ROAS Meta
        </span>
      </div>
    </div>
  )
}

function RoasTooltip({ active, payload, label }: any) {
  if (!active || !payload || !payload.length) return null
  const real = payload.find((p: any) => p.dataKey === 'real')?.value
  const meta = payload.find((p: any) => p.dataKey === 'meta')?.value
  return (
    <div className="bg-white border border-black/10 rounded-lg shadow-sm px-3 py-2 text-xs space-y-1">
      <div className="font-semibold text-ink">{label}</div>
      <div className="flex items-center justify-between gap-4">
        <span className="text-muted">ROAS real</span>
        <span className="font-medium tabular-nums">{fmt(real)}</span>
      </div>
      <div className="flex items-center justify-between gap-4">
        <span className="text-muted">ROAS Meta</span>
        <span className="font-medium tabular-nums text-[#8F6A34]">{fmt(meta)}</span>
      </div>
    </div>
  )
}
