import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'
import { useToast } from '../../lib/toast'
import { cristalLabel, type CristalResumen } from './CristalesProduccion'

// Generador de pedidos de producción (Fase 2): detecta SKUs en alarma, agrupa por familia
// de armazón y reparte el lote mínimo entre los SKUs según déficit de demanda, con cap por SKU
// y redistribución. Solo entran los SKUs de la lista blanca (skus_habilitados_produccion).

interface Params {
  alarma_min: number
  lote_min: number
  lote_max: number
  cap_sku_pct: number
  cobertura_objetivo_dias: number
  ventana_dias: number
}
const DEF_PARAMS: Params = { alarma_min: 25, lote_min: 100, lote_max: 300, cap_sku_pct: 0.45, cobertura_objetivo_dias: 75, ventana_dias: 75 }

interface SkuRow {
  sku: string
  modelo: string
  descripcion: string
  armazon_id: string
  color_armazon: string
  clasificacion: string | null
  stock: number
  demandaCol: number // stock.demanda (fallback)
  ventaDiaria: number
  stockObjetivo: number
  deficit: number
  enAlarma: boolean
  cristal_id: number | null
}
interface ItemProp {
  sku: string
  modelo: string
  descripcion: string
  stock: number
  deficit: number
  cantidad: number
  cristal_id: number | null
}
interface Propuesta {
  familia: string
  titulo: string
  loteTotal: number
  items: ItemProp[]
  sumDeficits: number
  capOk: boolean
}

const ent = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 })
const num1 = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 })

// Reparte `lote` entre items (deficit>0) proporcional al déficit, con tope capUnits por SKU.
// Los que superan el tope se fijan en el tope y se redistribuye el resto (loop). Devuelve enteros que suman lote.
function repartir(items: { sku: string; deficit: number }[], lote: number, capUnits: number): Record<string, number> {
  const asign: Record<string, number> = {}
  for (const i of items) asign[i.sku] = 0
  const capped = new Set<string>()
  for (let iter = 0; iter < items.length + 2; iter++) {
    const activos = items.filter((i) => !capped.has(i.sku))
    const sumD = activos.reduce((a, i) => a + i.deficit, 0)
    if (activos.length === 0 || sumD <= 0) break
    const poolActivos = lote - [...capped].reduce((a, s) => a + asign[s], 0)
    let nuevoCap = false
    for (const i of activos) {
      const val = poolActivos * (i.deficit / sumD)
      if (val > capUnits + 1e-9) {
        asign[i.sku] = capUnits
        capped.add(i.sku)
        nuevoCap = true
      } else {
        asign[i.sku] = val
      }
    }
    if (!nuevoCap) break
  }
  // Si quedó pool sin repartir (todos en el tope), lo agrega por déficit desc ignorando el tope.
  let usado = Object.values(asign).reduce((a, b) => a + b, 0)
  let rem = lote - usado
  if (rem > 0.5) {
    const orden = [...items].sort((a, b) => b.deficit - a.deficit)
    for (const i of orden) {
      if (rem <= 0) break
      asign[i.sku] += rem
      rem = 0
    }
  }
  // Redondeo por mayor resto para que la suma sea exactamente lote.
  const piso: Record<string, number> = {}
  let sumaPiso = 0
  const restos: { sku: string; r: number }[] = []
  for (const i of items) {
    piso[i.sku] = Math.floor(asign[i.sku])
    sumaPiso += piso[i.sku]
    restos.push({ sku: i.sku, r: asign[i.sku] - piso[i.sku] })
  }
  let faltan = Math.round(lote) - sumaPiso
  restos.sort((a, b) => b.r - a.r)
  for (let k = 0; k < restos.length && faltan > 0; k++) {
    piso[restos[k].sku] += 1
    faltan--
  }
  return piso
}

export default function GeneradorProduccion() {
  const { codigoEfectivo } = useAuth()
  const toast = useToast()
  const [params, setParams] = useState<Params>(DEF_PARAMS)
  const [skus, setSkus] = useState<SkuRow[]>([])
  const [loading, setLoading] = useState(true)
  const [porColor, setPorColor] = useState(false) // familia = modelo (false) o modelo+color de armazón (true)
  const [generando, setGenerando] = useState<string | null>(null)
  const [generadas, setGeneradas] = useState<Set<string>>(new Set())
  // Ajustes manuales sobre lo que propone el sistema: overrides[familia][sku] = cantidad
  const [overrides, setOverrides] = useState<Record<string, Record<string, number>>>({})
  const setOverride = (familia: string, sku: string, val: number) =>
    setOverrides((prev) => ({ ...prev, [familia]: { ...(prev[familia] ?? {}), [sku]: Math.max(0, Math.floor(val || 0)) } }))
  const [cristales, setCristales] = useState<Record<number, CristalResumen>>({})

  async function cargarCristales() {
    const { data } = await supabase.rpc('cristales_resumen')
    const m: Record<number, CristalResumen> = {}
    for (const c of (data as CristalResumen[]) ?? []) m[c.cristal_id] = c
    setCristales(m)
  }

  useEffect(() => {
    cargarCristales()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    async function cargar() {
      const { data: par } = await supabase.from('parametros_produccion').select('*').eq('id', 1).maybeSingle()
      const p: Params = { ...DEF_PARAMS, ...(par ?? {}) }
      setParams(p)
      const [{ data: hab }, { data: dem }] = await Promise.all([
        supabase.from('skus_habilitados_produccion').select('sku, armazon_id, color_armazon, cristal_id').eq('activo', true),
        supabase.rpc('demanda_ventana', { p_dias: p.ventana_dias }),
      ])
      const habil = (hab as { sku: string; armazon_id: string; color_armazon: string; cristal_id: number | null }[]) ?? []
      const codigos = habil.map((h) => h.sku)
      const stockRows: { codigo: string; modelo: string; descripcion: string; clasificacion: string | null; cantidad: number; demanda: number | null }[] = []
      for (let i = 0; i < codigos.length; i += 300) {
        const { data } = await supabase
          .from('stock')
          .select('codigo, modelo, descripcion, clasificacion, cantidad, demanda')
          .in('codigo', codigos.slice(i, i + 300))
        stockRows.push(...((data as typeof stockRows) ?? []))
      }
      const stMap = new Map(stockRows.map((s) => [s.codigo, s]))
      const demMap = new Map(((dem as { sku: string; unidades: number }[]) ?? []).map((d) => [d.sku, Number(d.unidades)]))

      const rows: SkuRow[] = habil
        .map((h) => {
          const st = stMap.get(h.sku)
          if (!st) return null
          const unidadesVentana = demMap.get(h.sku) ?? 0
          const demandaCol = st.demanda ?? 0
          // venta diaria: la real de la ventana; si no hubo, cae al indicador demanda (mensual → /30)
          const ventaDiaria = Math.max(unidadesVentana / p.ventana_dias, demandaCol / 30)
          const stockObjetivo = ventaDiaria * p.cobertura_objetivo_dias
          const stock = st.cantidad ?? 0
          const deficit = Math.max(0, Math.round(stockObjetivo - stock))
          return {
            sku: h.sku,
            modelo: st.modelo,
            descripcion: st.descripcion,
            armazon_id: h.armazon_id || (st.modelo || '').toUpperCase(),
            color_armazon: h.color_armazon || '',
            clasificacion: st.clasificacion,
            stock,
            demandaCol,
            ventaDiaria,
            stockObjetivo,
            deficit,
            enAlarma: stock <= p.alarma_min,
            cristal_id: h.cristal_id,
          } as SkuRow
        })
        .filter(Boolean) as SkuRow[]
      setSkus(rows)
      setLoading(false)
    }
    cargar()
  }, [])

  const propuestas: Propuesta[] = useMemo(() => {
    const grupos = new Map<string, SkuRow[]>()
    for (const s of skus) {
      const key = porColor ? `${s.armazon_id}|${s.color_armazon}` : s.armazon_id
      if (!grupos.has(key)) grupos.set(key, [])
      grupos.get(key)!.push(s)
    }
    const out: Propuesta[] = []
    for (const [familia, items] of grupos) {
      if (!items.some((i) => i.enAlarma)) continue // solo familias con al menos un SKU en alarma
      let conDeficit = items.filter((i) => i.deficit > 0)
      let sumDeficits = conDeficit.reduce((a, i) => a + i.deficit, 0)
      // Si no hay déficit calculado pero hay alarma, repone al menos hasta el nivel de alarma.
      if (sumDeficits <= 0) {
        conDeficit = items.filter((i) => i.enAlarma).map((i) => ({ ...i, deficit: Math.max(1, params.alarma_min - i.stock) }))
        sumDeficits = conDeficit.reduce((a, i) => a + i.deficit, 0)
      }
      if (sumDeficits <= 0) continue
      // Redondea el déficit al lote mínimo, pero NUNCA supera el tope realista por familia.
      const loteTotal = Math.min(
        params.lote_max,
        Math.max(params.lote_min, Math.ceil(sumDeficits / params.lote_min) * params.lote_min)
      )
      const capUnits = loteTotal * params.cap_sku_pct
      const asign = repartir(conDeficit.map((i) => ({ sku: i.sku, deficit: i.deficit })), loteTotal, capUnits)
      const itemsProp: ItemProp[] = conDeficit
        .map((i) => ({ sku: i.sku, modelo: i.modelo, descripcion: i.descripcion, stock: i.stock, deficit: i.deficit, cantidad: asign[i.sku] ?? 0, cristal_id: i.cristal_id }))
        .filter((i) => i.cantidad > 0)
        .sort((a, b) => b.cantidad - a.cantidad)
      const capOk = itemsProp.every((i) => i.cantidad <= capUnits + 1)
      out.push({
        familia,
        titulo: porColor ? `${items[0].modelo} · ${items[0].color_armazon}` : items[0].modelo,
        loteTotal,
        items: itemsProp,
        sumDeficits,
        capOk,
      })
    }
    return out.sort((a, b) => b.loteTotal - a.loteTotal)
  }, [skus, porColor, params])

  // cantidad efectiva de un SKU: el ajuste manual si existe, si no lo que propuso el sistema
  const cantEfectiva = (familia: string, i: ItemProp) => overrides[familia]?.[i.sku] ?? i.cantidad
  const loteEfectivo = (p: Propuesta) => p.items.reduce((a, i) => a + cantEfectiva(p.familia, i), 0)

  // Cristales que usa la orden (con los ajustes) contra el proyectado (stock − comprometido en pendientes)
  const necesidadCristales = (p: Propuesta) => {
    const porCristal = new Map<number, number>()
    let sinCristal = 0
    for (const i of p.items) {
      const cant = cantEfectiva(p.familia, i)
      if (cant <= 0) continue
      if (!i.cristal_id || !cristales[i.cristal_id]) {
        sinCristal += cant
        continue
      }
      porCristal.set(i.cristal_id, (porCristal.get(i.cristal_id) ?? 0) + cant)
    }
    const filas = [...porCristal.entries()].map(([id, cant]) => {
      const c = cristales[id]
      return { id, label: cristalLabel(c), necesita: Math.ceil(cant * Number(c.consumo_por_unidad ?? 1)), proyectado: c.proyectado }
    })
    return { filas, sinCristal }
  }

  async function generar(p: Propuesta) {
    const itemsAjust = p.items
      .map((i) => ({ ...i, cantidad: cantEfectiva(p.familia, i) }))
      .filter((i) => i.cantidad > 0)
    const loteTotal = itemsAjust.reduce((a, i) => a + i.cantidad, 0)
    if (loteTotal <= 0) {
      toast('La orden quedó en 0 unidades — ajustá las cantidades', 'error')
      return
    }
    const faltantes = necesidadCristales(p).filas.filter((f) => f.proyectado - f.necesita < 0)
    if (
      faltantes.length &&
      !window.confirm(
        `Faltan cristales:\n${faltantes.map((f) => `• ${f.label}: usa ${f.necesita}, proyectado ${f.proyectado}`).join('\n')}\n\n¿Generar igual?`
      )
    )
      return
    setGenerando(p.familia)
    const { data: ped, error } = await supabase
      .from('pedidos_produccion')
      .insert({ familia_armazon: p.familia, estado: 'pendiente', lote_total: loteTotal, creado_por: codigoEfectivo })
      .select('id')
      .single()
    if (error || !ped) {
      setGenerando(null)
      toast('No se pudo generar: ' + (error?.message ?? ''), 'error')
      return
    }
    const items = itemsAjust.map((i) => ({
      pedido_id: (ped as { id: number }).id,
      sku: i.sku,
      modelo: i.modelo,
      descripcion: i.descripcion,
      cantidad: i.cantidad,
      stock_al_momento: i.stock,
      deficit_calculado: i.deficit,
      cristal_id: i.cristal_id,
    }))
    const { error: e2 } = await supabase.from('pedidos_produccion_items').insert(items)
    setGenerando(null)
    if (e2) {
      toast('Orden creada pero falló el detalle: ' + e2.message, 'error')
      return
    }
    setGeneradas((prev) => new Set(prev).add(p.familia))
    cargarCristales()
    toast(`✓ Orden de producción generada — ${p.titulo} (${loteTotal} u.)`, 'success')
  }

  if (loading) return <p className="text-sm text-muted p-4">Analizando demanda y stock…</p>

  const totalUnidades = propuestas.reduce((a, p) => a + p.loteTotal, 0)

  return (
    <div className="space-y-4 text-ink">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h2 className="text-base font-semibold">🏭 Órdenes de producción</h2>
          <p className="text-[11px] text-faint">
            {propuestas.length} familias propuestas · {ent.format(totalUnidades)} u. · podés ajustar cada SKU antes de generar · lote {params.lote_min}–{params.lote_max} · alarma ≤{params.alarma_min} · cobertura {params.cobertura_objetivo_dias}d
          </p>
        </div>
        <label className="flex items-center gap-2 text-xs text-muted">
          <input type="checkbox" checked={porColor} onChange={(e) => setPorColor(e.target.checked)} />
          Familia por modelo + color de armazón
        </label>
      </div>

      {!porColor && (
        <div className="bg-[#F7F5F0] rounded-xl p-3 text-[11px] text-muted">
          Familia = <b>modelo</b> (una corrida del armazón se reparte entre sus colores/cristales). Si tu producción separa
          por color de marco, tildá la opción de arriba. Con “por color” muchas familias quedan de 1 SKU y el cap del 45% no
          se puede cumplir (se marca al lado).
        </div>
      )}

      {propuestas.length === 0 ? (
        <p className="text-sm text-faint text-center py-10">No hay familias en alarma para producir con estos parámetros.</p>
      ) : (
        propuestas.map((p) => {
          const generada = generadas.has(p.familia)
          const loteEff = loteEfectivo(p)
          return (
            <div key={p.familia} className={`bg-white rounded-xl border ${generada ? 'border-emerald-300' : 'border-black/10'}`}>
              <div className="p-4 flex items-center justify-between gap-2 flex-wrap border-b border-black/5">
                <div>
                  <p className="text-sm font-semibold">{p.titulo}</p>
                  <p className="text-[11px] text-faint">
                    {p.items.length} SKUs · déficit total {ent.format(p.sumDeficits)} u.
                    {!p.capOk && <span className="text-amber-600"> · ⚠ cap 45% no alcanzable (pocos SKUs)</span>}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <p className="text-[10px] text-faint uppercase tracking-wide">Lote {loteEff !== p.loteTotal && <span className="text-amber-600">(ajustado)</span>}</p>
                    <p className="text-xl font-bold text-brandDark leading-none">{ent.format(loteEff)} u.</p>
                  </div>
                  {generada ? (
                    <span className="text-xs bg-emerald-50 text-emerald-700 rounded-lg px-3 py-2 font-medium">✓ generada</span>
                  ) : (
                    <button
                      onClick={() => generar(p)}
                      disabled={generando === p.familia}
                      className="text-xs px-3 py-2 rounded-lg bg-brand text-white font-medium disabled:opacity-50 whitespace-nowrap"
                    >
                      {generando === p.familia ? 'Generando…' : 'Generar orden'}
                    </button>
                  )}
                </div>
              </div>
              <div className="p-4 overflow-x-auto">
                <table className="w-full text-[11px] min-w-[520px]">
                  <thead className="text-faint uppercase">
                    <tr>
                      <th className="text-left font-medium pb-1">SKU / color</th>
                      <th className="text-right font-medium pb-1">Stock</th>
                      <th className="text-right font-medium pb-1">Déficit</th>
                      <th className="text-right font-medium pb-1">A producir</th>
                      <th className="text-right font-medium pb-1">% lote</th>
                    </tr>
                  </thead>
                  <tbody>
                    {p.items.map((i) => {
                      const cantEff = cantEfectiva(p.familia, i)
                      return (
                      <tr key={i.sku} className="border-t border-black/5">
                        <td className="py-1">
                          {i.descripcion} <span className="text-faint font-mono">· {i.sku}</span>
                        </td>
                        <td className="py-1 text-right">
                          <span className={i.stock <= params.alarma_min ? 'text-red-600 font-semibold' : ''}>{i.stock}</span>
                        </td>
                        <td className="py-1 text-right text-muted">{ent.format(i.deficit)}</td>
                        <td className="py-1 text-right">
                          {generada ? (
                            <span className="font-bold text-ink">{ent.format(cantEff)}</span>
                          ) : (
                            <input
                              type="number"
                              min={0}
                              value={cantEff}
                              onChange={(e) => setOverride(p.familia, i.sku, Number(e.target.value))}
                              className="w-16 bg-white border border-black/10 rounded px-1.5 py-0.5 text-right text-[11px] font-bold text-ink"
                            />
                          )}
                        </td>
                        <td className="py-1 text-right text-faint">{loteEff > 0 ? num1.format((cantEff / loteEff) * 100) : '0'}%</td>
                      </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              {(() => {
                const { filas, sinCristal } = necesidadCristales(p)
                if (!filas.length && !sinCristal) return null
                return (
                  <div className="px-4 pb-4 text-[11px]">
                    <p className="text-faint uppercase font-medium mb-1">🔬 Cristales {generada ? '(ya comprometidos)' : 'que usa esta orden'}</p>
                    {filas.map((f) => {
                      // generada: el proyectado ya incluye esta orden
                      const queda = generada ? f.proyectado : f.proyectado - f.necesita
                      return (
                        <div key={f.id} className="flex justify-between gap-2 flex-wrap border-t border-black/5 py-1">
                          <span>{f.label}</span>
                          <span className={queda < 0 ? 'text-red-600 font-semibold' : 'text-muted'}>
                            usa {ent.format(f.necesita)} · quedan {ent.format(queda)}
                            {queda < 0 && ' ⚠ faltan'}
                          </span>
                        </div>
                      )
                    })}
                    {sinCristal > 0 && (
                      <p className="text-amber-600 pt-1">⚠ {ent.format(sinCristal)} u. sin cristal asociado (asignalo en la pestaña Cristales)</p>
                    )}
                  </div>
                )
              })()}
            </div>
          )
        })
      )}
    </div>
  )
}
