import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { Pedido, StockItem } from '../../lib/types'
import { formatPrecio, clienteCorto } from '../../lib/format'
import { addDias, diasDesde, formatFecha, parsePedidoFecha } from '../../lib/dates'
import { fetchPaged } from '../../lib/fetchAll'
import { estadoLabel, ESTADO_COLORS, importeDe, parseFP } from './calc'

const FACTURABLES = ['facturado', 'listo_despachar', 'despachado']
const ESTADOS_ORDEN = ['pendiente', 'en_preparacion', 'observado', 'listo', 'facturado', 'listo_despachar', 'despachado']

export default function DashboardPedidos() {
  const [pedidos, setPedidos] = useState<Pedido[]>([])
  const [stock, setStock] = useState<StockItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      supabase.from('pedidos').select('*').order('created_at', { ascending: false }),
      fetchPaged<StockItem>(() => supabase.from('stock').select('*')),
    ]).then(([p, s]) => {
      setPedidos((p.data as Pedido[]) ?? [])
      setStock(s)
      setLoading(false)
    })
  }, [])

  if (loading) return <p className="text-sm text-muted p-4">Cargando dashboard...</p>

  const hoy = new Date()
  const mesActual = hoy.getMonth()
  const anioActual = hoy.getFullYear()
  const refAnterior = new Date(anioActual, mesActual - 1, 1)

  const pedidosMesActual: Pedido[] = []
  const pedidosMesAnterior: Pedido[] = []
  for (const l of pedidos) {
    const d = parsePedidoFecha(l.fecha)
    if (!d) continue
    if (d.getMonth() === mesActual && d.getFullYear() === anioActual) pedidosMesActual.push(l)
    else if (d.getMonth() === refAnterior.getMonth() && d.getFullYear() === refAnterior.getFullYear())
      pedidosMesAnterior.push(l)
  }

  const imp = (l: Pedido) => importeDe(l, stock)
  const facturadoMesActual = pedidosMesActual.filter((l) => FACTURABLES.includes(l.estado ?? '')).reduce((a, l) => a + imp(l), 0)
  const facturadoMesAnterior = pedidosMesAnterior.filter((l) => FACTURABLES.includes(l.estado ?? '')).reduce((a, l) => a + imp(l), 0)
  const facturadosCount = pedidosMesActual.filter((l) => FACTURABLES.includes(l.estado ?? '')).length
  const observadosMes = pedidosMesActual.filter((l) => l.estado === 'observado').length
  const tasaFacturacion = pedidosMesActual.length > 0 ? Math.round((facturadosCount / pedidosMesActual.length) * 100) : 0
  const ticketProm = facturadosCount > 0 ? Math.round(facturadoMesActual / facturadosCount) : 0
  const pctObservado = pedidosMesActual.length > 0 ? Math.round((observadosMes / pedidosMesActual.length) * 100) : 0

  function trend(actual: number, anterior: number) {
    if (anterior === 0 && actual === 0) return <span className="text-[10px] text-faint">Sin datos del mes anterior</span>
    if (anterior === 0) return <span className="text-[10px] text-emerald-600">▲ Nuevo vs mes anterior</span>
    const delta = Math.round(((actual - anterior) / anterior) * 100)
    if (delta > 0) return <span className="text-[10px] text-emerald-600">▲ +{delta}% vs mes anterior</span>
    if (delta < 0) return <span className="text-[10px] text-red-600">▼ {delta}% vs mes anterior</span>
    return <span className="text-[10px] text-faint">= sin cambios</span>
  }

  // Ranking vendedores
  const vendMap: Record<string, { pedidos: number; facturado: number; observados: number }> = {}
  for (const l of pedidosMesActual) {
    const v = l.vendedor || '—'
    if (!vendMap[v]) vendMap[v] = { pedidos: 0, facturado: 0, observados: 0 }
    vendMap[v].pedidos++
    if (FACTURABLES.includes(l.estado ?? '')) vendMap[v].facturado += imp(l)
    if (l.estado === 'observado') vendMap[v].observados++
  }
  // Gastón es admin, no vendedor: no se lista en el ranking de facturación.
  const NO_VENDEDORES = new Set(['Gaston', 'Gastón', '—', ''])
  const vendArr = Object.entries(vendMap)
    .filter(([nombre]) => !NO_VENDEDORES.has(nombre))
    .map(([nombre, d]) => ({ nombre, ...d }))
    .sort((a, b) => b.facturado - a.facturado)
  const maxFact = Math.max(...vendArr.map((v) => v.facturado), 1)

  // Conclusiones
  const conclusiones: string[] = []
  if (vendArr.length && vendArr[0].facturado > 0) {
    const total = vendArr.reduce((a, v) => a + v.facturado, 0)
    conclusiones.push(
      `${vendArr[0].nombre} lidera el mes con ${formatPrecio(vendArr[0].facturado)} facturados${
        total > 0 ? ` (${Math.round((vendArr[0].facturado / total) * 100)}% del total del equipo)` : ''
      }.`
    )
  }
  if (pedidosMesActual.length > 0) {
    if (pctObservado >= 15)
      conclusiones.push(
        `El ${pctObservado}% de los pedidos del mes fueron observados por Depósito — vale la pena reforzar la carga con el equipo.`
      )
    else conclusiones.push(`Solo el ${pctObservado}% de los pedidos requirió corrección de Depósito — buen nivel de calidad de carga.`)
  }
  if (facturadoMesAnterior > 0) {
    const delta = Math.round(((facturadoMesActual - facturadoMesAnterior) / facturadoMesAnterior) * 100)
    if (delta >= 10) conclusiones.push(`La facturación viene ${delta}% arriba del mes pasado — buen ritmo.`)
    else if (delta <= -10)
      conclusiones.push(`La facturación bajó ${Math.abs(delta)}% respecto al mes pasado — conviene revisar qué frenó el cierre.`)
  }
  const pendCobro = pedidos.filter((l) => FACTURABLES.includes(l.estado ?? '') && !l.cobrado).reduce((a, l) => a + imp(l), 0)
  if (pendCobro > 0) conclusiones.push(`Hay ${formatPrecio(pendCobro)} ya facturados y todavía sin cobrar — revisalo en Cobranzas.`)
  const observadosActivos = pedidos.filter((l) => l.estado === 'observado').length
  if (observadosActivos > 0)
    conclusiones.push(
      `${observadosActivos} pedido${observadosActivos !== 1 ? 's siguen observados' : ' sigue observado'} esperando el ajuste del vendedor.`
    )
  if (!conclusiones.length)
    conclusiones.push('Sin datos suficientes este mes — a medida que se carguen pedidos vas a ver acá el análisis automático.')

  // KPI cards por estado
  const counts: Record<string, number> = {}
  let totalListo = 0
  let totalPendCobroCard = 0
  for (const l of pedidos) {
    const e = l.estado ?? 'pendiente'
    counts[e] = (counts[e] ?? 0) + 1
    const n = imp(l)
    if (e === 'listo') totalListo += n
    if (FACTURABLES.includes(e) && !l.cobrado) totalPendCobroCard += n
  }

  // Alertas
  const alertas: { tipo: 'danger' | 'warn' | 'info'; icono: string; msg: string }[] = []
  for (const l of pedidos) {
    const dias = diasDesde(l.fecha)
    if (l.estado === 'observado')
      alertas.push({
        tipo: 'danger',
        icono: '⚠',
        msg: `${clienteCorto(l.cliente)} — Observado por depósito. ${l.obs_deposito ? `"${l.obs_deposito}"` : ''} (${l.vendedor})`,
      })
    if (l.estado === 'pendiente' && dias >= 2)
      alertas.push({
        tipo: 'warn',
        icono: '⏰',
        msg: `${clienteCorto(l.cliente)} — Pendiente hace ${dias} días sin que depósito lo tome (${l.vendedor})`,
      })
    if (l.estado === 'en_preparacion' && dias >= 3)
      alertas.push({ tipo: 'warn', icono: '🔧', msg: `${clienteCorto(l.cliente)} — En preparación hace ${dias} días sin cerrarse` })
    if (l.estado === 'listo' && dias >= 2)
      alertas.push({
        tipo: 'info',
        icono: '📄',
        msg: `${clienteCorto(l.cliente)} — Listo para facturar hace ${dias} días — ${formatPrecio(imp(l))}`,
      })
    if (FACTURABLES.includes(l.estado ?? '') && !l.cobrado) {
      const n = imp(l)
      for (const v of parseFP(l.cond_pago, l.cuotas_detalle)) {
        const fVto = addDias(l.fecha_entrega || l.fecha_factura || l.fecha || '', v.dias)
        if (fVto && fVto < hoy)
          alertas.push({
            tipo: 'danger',
            icono: '💸',
            msg: `${clienteCorto(l.cliente)} — Cobro VENCIDO ${formatFecha(fVto)} — ${formatPrecio(Math.round(n * v.pct))}`,
          })
      }
    }
  }

  // Flujo de caja
  const cobros: { fecha: Date | null; monto: number; cliente: string | null; vencido: boolean }[] = []
  for (const l of pedidos.filter((l) => !l.cobrado)) {
    const n = imp(l)
    if (n <= 0) continue
    const base = l.fecha_entrega || l.fecha_factura || l.fecha || ''
    for (const v of parseFP(l.cond_pago, l.cuotas_detalle)) {
      const fVto = addDias(base, v.dias)
      cobros.push({ fecha: fVto, monto: Math.round(n * v.pct), cliente: l.cliente, vencido: !!fVto && fVto < hoy })
    }
  }
  cobros.sort((a, b) => (a.fecha?.getTime() ?? 9e15) - (b.fecha?.getTime() ?? 9e15))
  const totalFlujo = cobros.reduce((a, b) => a + b.monto, 0)
  const totalVencido = cobros.filter((c) => c.vencido).reduce((a, b) => a + b.monto, 0)
  const totalProximo = totalFlujo - totalVencido
  const porMes: Record<string, { label: string; total: number; items: typeof cobros; vencido: boolean }> = {}
  for (const c of cobros) {
    const key = c.fecha ? `${c.fecha.getFullYear()}-${String(c.fecha.getMonth() + 1).padStart(2, '0')}` : 'sin-fecha'
    const label = c.fecha ? c.fecha.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' }) : 'Sin fecha'
    if (!porMes[key]) porMes[key] = { label, total: 0, items: [], vencido: c.vencido }
    porMes[key].total += c.monto
    porMes[key].items.push(c)
  }
  const maxMes = Math.max(...Object.values(porMes).map((m) => m.total), 1)

  const kanban = ESTADOS_ORDEN.filter((e) => e !== 'listo_despachar' || (counts['listo_despachar'] ?? 0) > 0)

  return (
    <div className="space-y-5 text-ink">
      {/* RESUMEN EJECUTIVO */}
      <div className="bg-ink text-white rounded-2xl p-4">
        <p className="text-sm font-semibold mb-3">
          📊 Resumen ejecutivo — {hoy.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' })}
        </p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {[
            { label: 'Facturado este mes', val: formatPrecio(facturadoMesActual) || '$ 0', t: trend(facturadoMesActual, facturadoMesAnterior) },
            { label: 'Pedidos cargados', val: String(pedidosMesActual.length), t: trend(pedidosMesActual.length, pedidosMesAnterior.length) },
            { label: 'Tasa de facturación', val: tasaFacturacion + '%', t: <span className="text-[10px] text-white/50">Facturados / cargados</span> },
            { label: 'Ticket promedio', val: formatPrecio(ticketProm) || '$ 0', t: <span className="text-[10px] text-white/50">Por pedido facturado</span> },
          ].map((k) => (
            <div key={k.label} className="bg-white/10 rounded-xl p-3">
              <p className="text-[10px] uppercase tracking-wide text-white/60 font-semibold mb-1">{k.label}</p>
              <p className="text-xl font-bold">{k.val}</p>
              {k.t}
            </div>
          ))}
        </div>
        {vendArr.length > 0 && (
          <div className="mt-4 space-y-1.5">
            <p className="text-xs font-semibold text-white/70">Facturación por vendedor (este mes)</p>
            {vendArr.map((v) => (
              <div key={v.nombre} className="flex items-center gap-2 text-xs">
                <span className="w-20 truncate">{v.nombre}</span>
                <div className="flex-1 h-2 bg-white/10 rounded-full overflow-hidden">
                  <div className="h-full bg-gold rounded-full" style={{ width: `${Math.round((v.facturado / maxFact) * 100)}%` }} />
                </div>
                <span className="w-24 text-right font-semibold">{formatPrecio(v.facturado) || '$ 0'}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* CONCLUSIONES */}
      <div className="bg-white rounded-xl border border-black/10 p-4">
        <p className="text-xs font-semibold text-muted uppercase tracking-wide mb-2">💡 Conclusiones automáticas</p>
        {conclusiones.map((c, i) => (
          <p key={i} className="text-sm text-ink flex gap-2 py-0.5">
            <span className="text-brand">•</span>
            <span>{c}</span>
          </p>
        ))}
      </div>

      {/* KPI POR ESTADO */}
      <p className="text-xs font-semibold text-muted uppercase tracking-wide -mb-1">📦 Pipeline actual (todos los pedidos en proceso, no solo del mes)</p>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {[
          { label: 'En proceso (a facturar)', value: (counts['pendiente'] ?? 0) + (counts['en_preparacion'] ?? 0) + (counts['observado'] ?? 0) + (counts['listo'] ?? 0), color: '#0a0a0a', sub: 'previo a facturación' },
          { label: '⏳ Pendiente', value: counts['pendiente'] ?? 0, color: '#e07020', sub: '' },
          { label: '🔧 En preparación', value: counts['en_preparacion'] ?? 0, color: '#1a7abf', sub: '' },
          { label: '⚠ Observado', value: counts['observado'] ?? 0, color: '#c0392b', sub: (counts['observado'] ?? 0) > 0 ? '¡Atención!' : '' },
          { label: '✓ Listo p/facturar', value: counts['listo'] ?? 0, color: '#2a9d5c', sub: formatPrecio(totalListo) },
          { label: '📄 Facturado', value: counts['facturado'] ?? 0, color: '#4a4adf', sub: 'Cobrar: ' + (formatPrecio(totalPendCobroCard) || '$ 0') },
          { label: '📦 P/despachar', value: counts['listo_despachar'] ?? 0, color: '#7b2ff7', sub: '' },
          { label: '🚚 Despachado', value: counts['despachado'] ?? 0, color: '#c8a96e', sub: '' },
        ].map((c) => (
          <div key={c.label} className="bg-white rounded-xl border p-3" style={{ borderColor: c.color + '30' }}>
            <p className="text-2xl font-bold" style={{ color: c.color }}>
              {c.value}
            </p>
            <p className="text-[11px] text-muted">{c.label}</p>
            {c.sub && (
              <p className="text-[11px] font-semibold" style={{ color: c.color }}>
                {c.sub}
              </p>
            )}
          </div>
        ))}
      </div>

      {/* ALERTAS */}
      {alertas.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-muted uppercase tracking-wide mb-2">🚨 Alertas ({alertas.length})</p>
          <div className="space-y-1.5">
            {alertas.map((a, i) => (
              <div
                key={i}
                className={`flex gap-2 items-start text-xs rounded-lg px-3 py-2 border-l-2 ${
                  a.tipo === 'danger'
                    ? 'bg-red-50 border-red-600'
                    : a.tipo === 'warn'
                      ? 'bg-orange-50 border-orange-500'
                      : 'bg-blue-50 border-blue-500'
                }`}
              >
                <span>{a.icono}</span>
                <span>{a.msg}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* KANBAN */}
      <div>
        <p className="text-xs font-semibold text-muted uppercase tracking-wide mb-2">📋 Kanban — Estado del proceso</p>
        <div className="grid gap-2 overflow-x-auto" style={{ gridTemplateColumns: `repeat(${kanban.length}, minmax(120px, 1fr))` }}>
          {kanban.map((col) => {
            const colLogs = pedidos.filter((l) => (l.estado ?? 'pendiente') === col)
            const colTotal = colLogs.reduce((a, l) => a + imp(l), 0)
            const color = ESTADO_COLORS[col]
            return (
              <div key={col} className="bg-white rounded-lg border border-black/10 overflow-hidden">
                <div className="px-2.5 py-2 text-white" style={{ background: color }}>
                  <p className="text-[9px] font-bold uppercase tracking-wide">{estadoLabel(col as Pedido['estado'])}</p>
                  <p className="text-lg font-black leading-tight">{colLogs.length}</p>
                  {colTotal > 0 && <p className="text-[9px] opacity-85">{formatPrecio(colTotal)}</p>}
                </div>
                <div className="p-1.5 max-h-72 overflow-y-auto space-y-1">
                  {colLogs.length === 0 ? (
                    <p className="text-center text-faint text-xs py-3">—</p>
                  ) : (
                    colLogs.map((l) => {
                      const dias = diasDesde(l.fecha)
                      const n = imp(l)
                      return (
                        <div
                          key={l.id}
                          className={`rounded-md p-1.5 text-[10px] border-l-2 ${l.estado === 'observado' ? 'bg-red-50' : 'bg-[#F1EDE4]'}`}
                          style={{ borderColor: color }}
                        >
                          <p className="font-bold truncate">{clienteCorto(l.cliente)}</p>
                          <p className="text-muted">
                            {l.vendedor || ''} · {l.total_units ?? 0} uds
                          </p>
                          {n > 0 && (
                            <p className="font-bold" style={{ color }}>
                              {formatPrecio(n)}
                            </p>
                          )}
                          <p className={dias >= 3 ? 'text-red-600' : 'text-faint'}>
                            {dias === 0 ? 'Hoy' : dias === 1 ? 'Ayer' : `Hace ${dias} días`}
                          </p>
                          {l.estado === 'observado' && l.obs_deposito && (
                            <p className="text-red-600 italic">"{l.obs_deposito.slice(0, 40)}..."</p>
                          )}
                        </div>
                      )
                    })
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* LÍNEA DE TIEMPO */}
      <div>
        <p className="text-xs font-semibold text-muted uppercase tracking-wide mb-2">📅 Estado de pedidos activos</p>
        <div className="space-y-2">
          {pedidos
            .filter((l) => l.estado !== 'despachado')
            .slice(0, 15)
            .map((l) => {
              const e = l.estado ?? 'pendiente'
              const idx = ESTADOS_ORDEN.indexOf(e)
              const color = ESTADO_COLORS[e] ?? '#999'
              const n = imp(l)
              const dias = diasDesde(l.fecha)
              const alerta = e === 'observado' || (dias >= 3 && e !== 'despachado')
              return (
                <div
                  key={l.id}
                  className="bg-white rounded-lg border p-3"
                  style={{ borderColor: alerta ? color + '60' : '#e8e8e8', borderLeftWidth: alerta ? 3 : 1, borderLeftColor: color }}
                >
                  <div className="flex justify-between items-center mb-2 gap-2">
                    <div className="min-w-0">
                      <p className="font-bold text-xs truncate">{clienteCorto(l.cliente)}</p>
                      <p className="text-faint text-[10px]">
                        {l.vendedor || ''} · {l.total_units ?? 0} uds{n > 0 ? ' · ' + formatPrecio(n) : ''}
                      </p>
                    </div>
                    <span
                      className="text-[9px] font-bold uppercase rounded-full px-2 py-0.5 text-white shrink-0"
                      style={{ background: color }}
                    >
                      {estadoLabel(e)}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    {ESTADOS_ORDEN.map((s, i) => (
                      <div
                        key={s}
                        className="flex-1 h-1 rounded-full"
                        style={{ background: i <= idx ? ESTADO_COLORS[s] ?? '#ddd' : '#eee' }}
                      />
                    ))}
                  </div>
                  <div className="flex justify-between mt-1 text-[9px]">
                    <span className="text-faint">Nuevo</span>
                    <span className={alerta ? 'font-bold' : 'text-faint'} style={{ color: alerta ? color : undefined }}>
                      {dias === 0 ? 'Hoy' : dias === 1 ? 'Ayer' : `Hace ${dias}d`}
                    </span>
                    <span className="text-faint">Despachado</span>
                  </div>
                </div>
              )
            })}
        </div>
      </div>

      {/* FLUJO DE CAJA */}
      <div>
        <p className="text-xs font-semibold text-muted uppercase tracking-wide mb-2">💰 Flujo de caja proyectado</p>
        <div className="bg-white rounded-xl border border-black/10 p-4">
          {cobros.length === 0 ? (
            <p className="text-faint text-sm text-center py-6">Sin pedidos para proyectar</p>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-2 mb-4">
                <div className="bg-emerald-50 rounded-lg p-2.5 text-center">
                  <p className="text-sm font-bold text-emerald-600">{formatPrecio(totalFlujo) || '$ 0'}</p>
                  <p className="text-[9px] uppercase tracking-wide text-emerald-700 font-semibold">Total</p>
                </div>
                <div className={`rounded-lg p-2.5 text-center ${totalVencido > 0 ? 'bg-red-50' : 'bg-black/5'}`}>
                  <p className={`text-sm font-bold ${totalVencido > 0 ? 'text-red-600' : 'text-faint'}`}>
                    {formatPrecio(totalVencido) || '$ 0'}
                  </p>
                  <p className={`text-[9px] uppercase tracking-wide font-semibold ${totalVencido > 0 ? 'text-red-700' : 'text-faint'}`}>
                    Vencido
                  </p>
                </div>
                <div className="bg-indigo-50 rounded-lg p-2.5 text-center">
                  <p className="text-sm font-bold text-indigo-600">{formatPrecio(totalProximo) || '$ 0'}</p>
                  <p className="text-[9px] uppercase tracking-wide text-indigo-700 font-semibold">Por cobrar</p>
                </div>
              </div>
              {Object.values(porMes).map((mes) => (
                <div key={mes.label} className="mb-3">
                  <div className="flex justify-between mb-1">
                    <span className="text-xs font-semibold capitalize">{mes.label}</span>
                    <span className={`text-xs font-bold ${mes.vencido ? 'text-red-600' : 'text-emerald-600'}`}>
                      {formatPrecio(mes.total)}
                    </span>
                  </div>
                  <div className="h-2.5 bg-black/5 rounded overflow-hidden">
                    <div
                      className={`h-full rounded ${mes.vencido ? 'bg-red-600' : 'bg-emerald-600'}`}
                      style={{ width: `${Math.round((mes.total / maxMes) * 100)}%` }}
                    />
                  </div>
                  <div className="mt-1">
                    {mes.items.map((c, i) => (
                      <div key={i} className="flex justify-between text-[11px] py-0.5 text-muted">
                        <span>{clienteCorto(c.cliente)}</span>
                        <span className={`font-semibold ${c.vencido ? 'text-red-600' : 'text-ink'}`}>
                          {formatPrecio(c.monto)}
                          {c.vencido ? ' ⚠' : ''}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
