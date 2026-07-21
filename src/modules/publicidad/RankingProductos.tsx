import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { fetchPaged } from '../../lib/fetchAll'

interface PedidoItemLite {
  codigo: string
  modelo: string
  descripcion: string | null
  cantidad: number
}

interface PedidoLite {
  fecha: string | null
  cod_cliente: string | null
  items: PedidoItemLite[] | null
}

interface InsightLite {
  fecha: string
  clicks: number
}

interface ModeloAgg {
  codigo: string
  modelo: string
  descripcion: string | null
  unidades: number
  pedidos: number
}

const CANALES = [
  { cod: '888888', nombre: 'Línea', icono: '🛍' },
  { cod: '888889', nombre: 'Outlet', icono: '🏷' },
] as const

const TIMEFRAMES = [
  { label: '30D', dias: 30 },
  { label: '90D', dias: 90 },
  { label: 'Año', dias: 365 },
  { label: 'Todo', dias: 0 },
] as const

function inicioDeEsteMes(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

function agregar(pedidos: PedidoLite[], canalCod: string, corte: string | null) {
  const agg = new Map<string, ModeloAgg>()
  let totalPedidos = 0
  for (const p of pedidos) {
    if (p.cod_cliente !== canalCod) continue
    if (corte && (p.fecha ?? '') < corte) continue
    totalPedidos++
    for (const it of p.items ?? []) {
      const cur = agg.get(it.codigo) ?? {
        codigo: it.codigo,
        modelo: it.modelo,
        descripcion: it.descripcion,
        unidades: 0,
        pedidos: 0,
      }
      cur.unidades += Number(it.cantidad) || 0
      cur.pedidos += 1
      agg.set(it.codigo, cur)
    }
  }
  const lista = [...agg.values()].sort((a, b) => b.unidades - a.unidades)
  return {
    top: lista.slice(0, 5),
    bottom: lista.slice(Math.max(5, lista.length - 5)).reverse(),
    totalModelos: lista.length,
    totalPedidos,
  }
}

export default function RankingProductos({ insights }: { insights: InsightLite[] }) {
  const [pedidos, setPedidos] = useState<PedidoLite[]>([])
  const [loading, setLoading] = useState(true)
  const [rango, setRango] = useState<number>(90)
  const [comparar, setComparar] = useState(false)

  useEffect(() => {
    fetchPaged<PedidoLite>(() =>
      supabase
        .from('pedidos')
        .select('fecha, cod_cliente, items')
        .in('cod_cliente', CANALES.map((c) => c.cod))
    ).then((data) => {
      setPedidos(data)
      setLoading(false)
    })
  }, [])

  const corte = useMemo(
    () => (rango > 0 ? new Date(Date.now() - rango * 86400000).toISOString().slice(0, 10) : null),
    [rango],
  )
  const corteMes = useMemo(() => inicioDeEsteMes(), [])

  const porCanal = useMemo(() => {
    return CANALES.map((canal) => ({
      canal,
      ...agregar(pedidos, canal.cod, corte),
      ...(comparar ? { mes: agregar(pedidos, canal.cod, corteMes) } : {}),
    }))
  }, [pedidos, corte, comparar, corteMes])

  const clicksPeriodo = useMemo(() => {
    return insights.reduce((a, i) => (!corte || i.fecha >= corte ? a + (Number(i.clicks) || 0) : a), 0)
  }, [insights, corte])

  const pedidosTotal = porCanal.reduce((a, c) => a + c.totalPedidos, 0)

  if (loading) return null

  const sinDatos = porCanal.every((c) => c.totalModelos === 0)
  if (sinDatos) return null

  return (
    <div className="bg-white border border-black/10 rounded-xl p-4 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-sm font-semibold">👓 Ganadores y perdedores por tienda</h2>
          <p className="text-[11px] text-muted mt-0.5">
            Ranking por ventas reales (unidades + cantidad de pedidos distintos que lo incluyeron). No incluye qué
            anuncio originó cada venta — Shopify no guarda esa relación hoy, solo el gasto y las ventas totales del
            día.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex rounded-lg border border-black/10 overflow-hidden">
            {TIMEFRAMES.map((tf) => (
              <button
                key={tf.label}
                onClick={() => setRango(tf.dias)}
                disabled={comparar}
                className={`px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-40 ${
                  rango === tf.dias && !comparar ? 'bg-brand text-white' : 'bg-white text-muted hover:bg-[#F1EDE4]'
                }`}
              >
                {tf.label}
              </button>
            ))}
          </div>
          <button
            onClick={() => setComparar((c) => !c)}
            className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
              comparar ? 'bg-brand text-white border-brand' : 'border-black/10 text-muted hover:bg-[#F1EDE4]'
            }`}
          >
            📊 Comparar Año vs Mes
          </button>
        </div>
      </div>

      {clicksPeriodo > 0 && !comparar && (
        <div className="border border-black/10 rounded-lg bg-[#F1EDE4] px-3 py-2 text-[11px] text-muted">
          <b className="text-ink">Contexto del período:</b> {clicksPeriodo.toLocaleString('es-AR')} clicks en anuncios
          de Meta (toda la cuenta, aprox. de "visitas") → {(pedidosTotal).toLocaleString('es-AR')} pedidos reales en
          Línea+Outlet
          {clicksPeriodo > 0 && <> ({((pedidosTotal / clicksPeriodo) * 100).toFixed(1)}% conversión aprox.)</>}. No es
          por producto — Shopify no guarda qué anuncio originó cada venta puntual.
        </div>
      )}

      {!comparar ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {porCanal.map(({ canal, top, bottom, totalModelos }) => (
            <div key={canal.cod} className="space-y-3">
              <p className="text-xs font-semibold text-muted uppercase tracking-wide">
                {canal.icono} {canal.nombre} · {totalModelos} modelo{totalModelos !== 1 ? 's' : ''} con ventas
              </p>

              {top.length === 0 ? (
                <p className="text-xs text-faint">Sin ventas en esta ventana.</p>
              ) : (
                <div>
                  <p className="text-[11px] text-emerald-700 font-medium mb-1">🏆 Más vendidos</p>
                  <RankingTabla filas={top} tono="ok" />
                </div>
              )}

              {bottom.length > 0 && (
                <div>
                  <p className="text-[11px] text-red-700 font-medium mb-1 mt-2">📉 Menos vendidos</p>
                  <RankingTabla filas={bottom} tono="bajo" />
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {porCanal.map(({ canal, top, totalModelos, mes }) => (
            <div key={canal.cod} className="space-y-3">
              <p className="text-xs font-semibold text-muted uppercase tracking-wide">
                {canal.icono} {canal.nombre} · {totalModelos} modelo{totalModelos !== 1 ? 's' : ''} en el año
              </p>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <p className="text-[11px] text-muted font-medium mb-1">📅 Todo el año</p>
                  {top.length === 0 ? <p className="text-xs text-faint">Sin ventas.</p> : <RankingTabla filas={top} tono="ok" compacta />}
                </div>
                <div>
                  <p className="text-[11px] text-muted font-medium mb-1">🗓️ Este mes</p>
                  {!mes || mes.top.length === 0 ? (
                    <p className="text-xs text-faint">Sin ventas todavía.</p>
                  ) : (
                    <RankingTabla filas={mes.top} tono="ok" compacta destacar={new Set(top.map((m) => m.codigo))} />
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function RankingTabla({
  filas,
  tono,
  compacta,
  destacar,
}: {
  filas: ModeloAgg[]
  tono: 'ok' | 'bajo'
  compacta?: boolean
  destacar?: Set<string>
}) {
  return (
    <div className="border border-black/10 rounded-lg overflow-hidden">
      <table className="w-full text-xs">
        <tbody>
          {filas.map((m, i) => (
            <tr key={m.codigo} className="border-t first:border-t-0 border-black/5 hover:bg-[#F1EDE4]/50 transition-colors">
              <td className="px-2 py-1.5 text-faint w-5">{i + 1}</td>
              <td className="px-2 py-1.5">
                <div className={`font-medium truncate ${compacta ? 'max-w-[100px]' : 'max-w-[180px]'}`}>
                  {m.modelo}
                  {destacar && !destacar.has(m.codigo) && <span title="No estaba en el top del año" className="ml-1">🆕</span>}
                </div>
                {!compacta && m.descripcion && <div className="text-[10px] text-faint truncate max-w-[180px]">{m.descripcion}</div>}
              </td>
              <td className="px-2 py-1.5 text-right whitespace-nowrap">
                <span className={`font-semibold ${tono === 'ok' ? 'text-emerald-700' : 'text-red-700'}`}>{m.unidades}</span>
                <span className="text-faint"> un.</span>
              </td>
              {!compacta && <td className="px-2 py-1.5 text-right text-faint whitespace-nowrap">{m.pedidos} ped.</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
