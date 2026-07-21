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
} from 'recharts'

interface DiaRoas {
  fecha: string
  spend_meta: number
  spend_b2c: number
  ventas_shopify_linea: number
  ventas_shopify_outlet: number
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

function fmtCompacto(n: number): string {
  if (!isFinite(n)) return '—'
  if (Math.abs(n) >= 1_000_000) return '$' + (n / 1_000_000).toFixed(1) + 'M'
  if (Math.abs(n) >= 1_000) return '$' + Math.round(n / 1000) + 'k'
  return '$' + Math.round(n)
}

function fmtCompleto(n: number): string {
  return '$ ' + Math.round(n).toLocaleString('es-AR')
}

export default function GastoVentasChart({ dias }: { dias: DiaRoas[] }) {
  const [rango, setRango] = useState<number>(30)

  const serie = useMemo(() => {
    const conDatos = [...dias].filter((d) => d.pedidos_shopify > 0)
    const cortados = conDatos.slice(0, rango)
    return cortados
      .slice()
      .reverse()
      .map((d) => ({
        label: diaCorto(d.fecha),
        gasto: Number(d.spend_b2c || d.spend_meta) || 0,
        ventas: Number(d.ventas_shopify_linea) + Number(d.ventas_shopify_outlet) || 0,
      }))
  }, [dias, rango])

  const hayDatos = serie.length > 1

  return (
    <div className="bg-white border border-black/10 rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-sm font-semibold">💰 Gasto vs Ventas reales</h2>
          <p className="text-[11px] text-muted mt-0.5">
            Montos absolutos por día — te muestra si el ROAS cambia porque varió la venta o porque varió el gasto.
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
              width={44}
              tickFormatter={fmtCompacto}
            />
            <Tooltip
              cursor={{ stroke: '#9B968B', strokeWidth: 1, strokeDasharray: '3 3' }}
              content={<GastoVentasTooltip />}
            />
            <Area type="monotone" dataKey="ventas" stroke="none" fill="#10b981" fillOpacity={0.06} isAnimationActive={false} />
            <Line
              type="monotone"
              dataKey="ventas"
              name="Ventas reales"
              stroke="#059669"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="gasto"
              name="Gasto en ads"
              stroke="#e5484d"
              strokeWidth={2}
              strokeDasharray="4 3"
              dot={false}
              activeDot={{ r: 4 }}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      )}

      <div className="flex items-center gap-4 text-[11px] text-muted">
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-0.5 bg-[#059669]" /> Ventas reales
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 border-t-2 border-dashed border-[#e5484d]" /> Gasto en ads
        </span>
      </div>
    </div>
  )
}

function GastoVentasTooltip({ active, payload, label }: any) {
  if (!active || !payload || !payload.length) return null
  const ventas = payload.find((p: any) => p.dataKey === 'ventas')?.value
  const gasto = payload.find((p: any) => p.dataKey === 'gasto')?.value
  return (
    <div className="bg-white border border-black/10 rounded-lg shadow-sm px-3 py-2 text-xs space-y-1">
      <div className="font-semibold text-ink">{label}</div>
      <div className="flex items-center justify-between gap-4">
        <span className="text-muted">Ventas reales</span>
        <span className="font-medium tabular-nums text-emerald-700">{fmtCompleto(ventas ?? 0)}</span>
      </div>
      <div className="flex items-center justify-between gap-4">
        <span className="text-muted">Gasto en ads</span>
        <span className="font-medium tabular-nums text-red-700">{fmtCompleto(gasto ?? 0)}</span>
      </div>
    </div>
  )
}
