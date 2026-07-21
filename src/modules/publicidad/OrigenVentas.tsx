import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { fetchPaged } from '../../lib/fetchAll'
import { formatPrecio } from '../../lib/format'

interface VentaLite {
  creado_en_shopify: string | null
  total: number | null
  provincia: string | null
  referring_site: string | null
  landing_site: string | null
}

const TIMEFRAMES = [
  { label: '30D', dias: 30 },
  { label: '90D', dias: 90 },
  { label: 'Año', dias: 365 },
  { label: 'Todo', dias: 0 },
] as const

// referring_site llega como URL completa de Shopify (ej: https://www.google.com/) — nos
// quedamos con el dominio para agrupar, y con "Directo" cuando Shopify no registró nada.
function origenDe(referring: string | null): string {
  if (!referring) return 'Directo / no registrado'
  try {
    return new URL(referring).hostname.replace(/^www\./, '')
  } catch {
    return referring
  }
}

export default function OrigenVentas() {
  const [ventas, setVentas] = useState<VentaLite[]>([])
  const [loading, setLoading] = useState(true)
  const [rango, setRango] = useState<number>(90)

  useEffect(() => {
    fetchPaged<VentaLite>(() =>
      supabase.from('ventas_shopify').select('creado_en_shopify, total, provincia, referring_site, landing_site')
    ).then((data) => {
      setVentas(data)
      setLoading(false)
    })
  }, [])

  const filtradas = useMemo(() => {
    if (rango === 0) return ventas
    const corte = new Date(Date.now() - rango * 86400000)
    return ventas.filter((v) => v.creado_en_shopify && new Date(v.creado_en_shopify) >= corte)
  }, [ventas, rango])

  const porProvincia = useMemo(() => {
    const agg = new Map<string, { pedidos: number; total: number }>()
    for (const v of filtradas) {
      const k = v.provincia || 'Sin dato'
      const cur = agg.get(k) ?? { pedidos: 0, total: 0 }
      cur.pedidos++
      cur.total += Number(v.total) || 0
      agg.set(k, cur)
    }
    return [...agg.entries()].map(([nombre, v]) => ({ nombre, ...v })).sort((a, b) => b.pedidos - a.pedidos).slice(0, 8)
  }, [filtradas])

  const porOrigen = useMemo(() => {
    const agg = new Map<string, { pedidos: number; total: number }>()
    for (const v of filtradas) {
      const k = origenDe(v.referring_site)
      const cur = agg.get(k) ?? { pedidos: 0, total: 0 }
      cur.pedidos++
      cur.total += Number(v.total) || 0
      agg.set(k, cur)
    }
    return [...agg.entries()].map(([nombre, v]) => ({ nombre, ...v })).sort((a, b) => b.pedidos - a.pedidos).slice(0, 8)
  }, [filtradas])

  const conRegistroDeOrigen = filtradas.some((v) => v.referring_site)

  if (loading || filtradas.length === 0) return null

  return (
    <div className="bg-white border border-black/10 rounded-xl p-4 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-sm font-semibold">📍 Origen de las ventas</h2>
          <p className="text-[11px] text-muted mt-0.5">
            De pedidos reales de Shopify (Línea + Outlet) — no es tráfico total del sitio, solo lo que terminó en
            venta.
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

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <p className="text-[11px] text-muted font-medium mb-1 uppercase tracking-wide">Por provincia</p>
          <OrigenTabla filas={porProvincia} />
        </div>
        <div>
          <p className="text-[11px] text-muted font-medium mb-1 uppercase tracking-wide">Por sitio de referencia</p>
          <OrigenTabla filas={porOrigen} />
          {!conRegistroDeOrigen && (
            <p className="text-[10px] text-faint mt-1">
              Todo cae en "Directo / no registrado" porque el registro de origen recién se activó el 21/07/2026 — los
              pedidos nuevos ya lo van a traer.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

function OrigenTabla({ filas }: { filas: { nombre: string; pedidos: number; total: number }[] }) {
  return (
    <div className="border border-black/10 rounded-lg overflow-hidden">
      <table className="w-full text-xs">
        <tbody>
          {filas.map((f) => (
            <tr key={f.nombre} className="border-t first:border-t-0 border-black/5 hover:bg-[#F1EDE4]/50 transition-colors">
              <td className="px-2 py-1.5 truncate max-w-[140px]">{f.nombre}</td>
              <td className="px-2 py-1.5 text-right whitespace-nowrap text-faint">{f.pedidos} ped.</td>
              <td className="px-2 py-1.5 text-right whitespace-nowrap font-medium">{formatPrecio(f.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
