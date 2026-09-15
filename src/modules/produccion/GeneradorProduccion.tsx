import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'
import { useToast } from '../../lib/toast'
import { cristalLabel, type CristalResumen } from './CristalesProduccion'

// Generador de pedidos de producción — criterio "lo justo": por SKU se produce solo lo que falta para cubrir la
// demanda de la cobertura objetivo, descontando stock y lo que ya viene en camino (ingresos proyectados no
// reservados + órdenes pendientes). Sin redondear al lote mínimo ni reponer sin demanda. Cada cristal se reparte
// primero a los SKUs con menos días de cobertura, sin pasar el proyectado disponible.

interface Params {
  alarma_min: number
  lote_min: number
  lote_max: number
  cobertura_objetivo_dias: number
  ventana_dias: number
}
const DEF_PARAMS: Params = { alarma_min: 25, lote_min: 100, lote_max: 300, cobertura_objetivo_dias: 75, ventana_dias: 75 }

interface SkuRow {
  sku: string
  modelo: string
  descripcion: string
  armazon_id: string
  color_armazon: string
  stock: number
  enCamino: number
  ventaDiaria: number
  dias: number // cobertura con stock + en camino
  deficit: number
  enAlarma: boolean
  cristal_id: number | null
}
interface ItemProp {
  sku: string
  modelo: string
  descripcion: string
  stock: number
  enCamino: number
  dias: number
  deficit: number
  cantidad: number
  topeCristal: boolean
  cristal_id: number | null
}
interface Propuesta {
  familia: string
  titulo: string
  loteTotal: number
  items: ItemProp[]
  sumDeficits: number
}

const ent = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 })
const num1 = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 })
const ESTADOS_PENDIENTES = ['pendiente', 'en_observacion']

// Reparte `lote` proporcional al déficit sin que ningún SKU pase su déficit (enteros que suman lote).
function repartirJusto(items: { sku: string; deficit: number }[], lote: number): Record<string, number> {
  const out: Record<string, number> = {}
  const suma = items.reduce((a, i) => a + i.deficit, 0)
  if (lote >= suma) {
    for (const i of items) out[i.sku] = i.deficit
    return out
  }
  const f = lote / suma
  let asignado = 0
  const restos: { sku: string; r: number }[] = []
  for (const i of items) {
    out[i.sku] = Math.floor(i.deficit * f)
    asignado += out[i.sku]
    restos.push({ sku: i.sku, r: i.deficit * f - out[i.sku] })
  }
  restos.sort((a, b) => b.r - a.r)
  for (let k = 0; k < restos.length && asignado < lote; k++) {
    out[restos[k].sku] += 1
    asignado++
  }
  return out
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
  // Foto del proyectado de cristales al abrir (lo generado en esta sesión se descuenta aparte)
  const [cristales, setCristales] = useState<Record<number, CristalResumen>>({})

  useEffect(() => {
    async function cargar() {
      const { data: par } = await supabase.from('parametros_produccion').select('*').eq('id', 1).maybeSingle()
      const p: Params = { ...DEF_PARAMS, ...(par ?? {}) }
      setParams(p)
      const [{ data: hab }, { data: dem }, { data: cri }, { data: pend }] = await Promise.all([
        supabase.from('skus_habilitados_produccion').select('sku, armazon_id, color_armazon, cristal_id').eq('activo', true),
        supabase.rpc('demanda_ventana', { p_dias: p.ventana_dias }),
        supabase.rpc('cristales_resumen'),
        supabase.from('pedidos_produccion').select('id').in('estado', ESTADOS_PENDIENTES),
      ])
      const cm: Record<number, CristalResumen> = {}
      for (const c of (cri as CristalResumen[]) ?? []) cm[c.cristal_id] = c
      setCristales(cm)

      const habil = (hab as { sku: string; armazon_id: string; color_armazon: string; cristal_id: number | null }[]) ?? []
      const codigos = habil.map((h) => h.sku)
      const stockRows: { codigo: string; modelo: string; descripcion: string; cantidad: number; demanda: number | null }[] = []
      const enCamino = new Map<string, number>()
      const sumar = (sku: string, n: number) => enCamino.set(sku, (enCamino.get(sku) ?? 0) + n)
      for (let i = 0; i < codigos.length; i += 300) {
        const lote = codigos.slice(i, i + 300)
        const [{ data: st }, { data: ing }] = await Promise.all([
          supabase.from('stock').select('codigo, modelo, descripcion, cantidad, demanda').in('codigo', lote),
          supabase.from('stock_ingresos').select('codigo, cantidad, nota').eq('estado', 'proyectado').in('codigo', lote),
        ])
        stockRows.push(...((st as typeof stockRows) ?? []))
        // Los proyectados reservados para un cliente no cubren demanda general
        for (const r of (ing as { codigo: string; cantidad: number; nota: string | null }[]) ?? []) {
          if (!/^\s*reservad/i.test(r.nota ?? '')) sumar(r.codigo, r.cantidad ?? 0)
        }
      }
      const pendIds = ((pend as { id: number }[]) ?? []).map((x) => x.id)
      if (pendIds.length) {
        const { data: its } = await supabase.from('pedidos_produccion_items').select('sku, cantidad').in('pedido_id', pendIds)
        for (const r of (its as { sku: string; cantidad: number }[]) ?? []) sumar(r.sku, r.cantidad ?? 0)
      }
      const stMap = new Map(stockRows.map((s) => [s.codigo, s]))
      const demMap = new Map(((dem as { sku: string; unidades: number }[]) ?? []).map((d) => [d.sku, Number(d.unidades)]))

      const rows: SkuRow[] = habil
        .map((h) => {
          const st = stMap.get(h.sku)
          if (!st) return null
          const unidadesVentana = demMap.get(h.sku) ?? 0
          // venta diaria: la real de la ventana; si no hubo, cae al indicador demanda (mensual → /30)
          const ventaDiaria = Math.max(unidadesVentana / p.ventana_dias, (st.demanda ?? 0) / 30)
          const stock = st.cantidad ?? 0
          const camino = enCamino.get(h.sku) ?? 0
          const disponible = stock + camino
          return {
            sku: h.sku,
            modelo: st.modelo,
            descripcion: st.descripcion,
            armazon_id: h.armazon_id || (st.modelo || '').toUpperCase(),
            color_armazon: h.color_armazon || '',
            stock,
            enCamino: camino,
            ventaDiaria,
            dias: ventaDiaria > 0 ? Math.max(0, disponible) / ventaDiaria : Infinity,
            deficit: Math.max(0, Math.round(ventaDiaria * p.cobertura_objetivo_dias - disponible)),
            enAlarma: disponible <= p.alarma_min,
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
    // 1) Lo justo por familia: solo si hay alarma real (stock + en camino) y demanda sin cubrir.
    const out: Propuesta[] = []
    for (const [familia, items] of grupos) {
      if (!items.some((i) => i.enAlarma)) continue
      const conDeficit = items.filter((i) => i.deficit > 0)
      const sumDeficits = conDeficit.reduce((a, i) => a + i.deficit, 0)
      if (sumDeficits <= 0) continue
      const lote = Math.min(params.lote_max, sumDeficits)
      const asign = repartirJusto(conDeficit, lote)
      out.push({
        familia,
        titulo: porColor ? `${items[0].modelo} · ${items[0].color_armazon}` : items[0].modelo,
        loteTotal: lote,
        sumDeficits,
        items: conDeficit.map((i) => ({
          sku: i.sku,
          modelo: i.modelo,
          descripcion: i.descripcion,
          stock: i.stock,
          enCamino: i.enCamino,
          dias: i.dias,
          deficit: i.deficit,
          cantidad: asign[i.sku] ?? 0,
          topeCristal: false,
          cristal_id: i.cristal_id,
        })),
      })
    }
    // 2) Tope por cristal: el proyectado se reparte primero a los SKUs con menos días de cobertura.
    const pool = new Map<number, number>()
    for (const c of Object.values(cristales)) pool.set(c.cristal_id, Math.max(0, c.proyectado))
    const todos = out.flatMap((p) => p.items).filter((i) => i.cristal_id && pool.has(i.cristal_id))
    todos.sort((a, b) => a.dias - b.dias || b.deficit - a.deficit)
    for (const i of todos) {
      const consumo = Number(cristales[i.cristal_id!].consumo_por_unidad ?? 1)
      const alcanza = Math.floor(pool.get(i.cristal_id!)! / consumo)
      if (i.cantidad > alcanza) {
        i.cantidad = alcanza
        i.topeCristal = true
      }
      pool.set(i.cristal_id!, pool.get(i.cristal_id!)! - Math.ceil(i.cantidad * consumo))
    }
    for (const p of out) {
      p.items.sort((a, b) => b.cantidad - a.cantidad || a.dias - b.dias)
      p.loteTotal = p.items.reduce((a, i) => a + i.cantidad, 0)
    }
    return out.sort((a, b) => b.loteTotal - a.loteTotal)
  }, [skus, porColor, params, cristales])

  // cantidad efectiva de un SKU: el ajuste manual si existe, si no lo que propuso el sistema
  const cantEfectiva = (familia: string, i: ItemProp) => overrides[familia]?.[i.sku] ?? i.cantidad
  const loteEfectivo = (p: Propuesta) => p.items.reduce((a, i) => a + cantEfectiva(p.familia, i), 0)

  // Cristal que usan las órdenes ya generadas en esta sesión (fuera de la familia indicada)
  const usoGenerado = (cristalId: number, salvo: string) => {
    let u = 0
    for (const p of propuestas) {
      if (p.familia === salvo || !generadas.has(p.familia)) continue
      for (const i of p.items) if (i.cristal_id === cristalId) u += cantEfectiva(p.familia, i)
    }
    return Math.ceil(u * Number(cristales[cristalId]?.consumo_por_unidad ?? 1))
  }

  // Cristales que usa la orden (con los ajustes) contra el proyectado
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
      const necesita = Math.ceil(cant * Number(c.consumo_por_unidad ?? 1))
      return { id, label: cristalLabel(c), necesita, queda: c.proyectado - usoGenerado(id, p.familia) - necesita }
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
    const faltantes = necesidadCristales(p).filas.filter((f) => f.queda < 0)
    if (
      faltantes.length &&
      !window.confirm(
        `Faltan cristales:\n${faltantes.map((f) => `• ${f.label}: usa ${f.necesita}, faltan ${-f.queda}`).join('\n')}\n\n¿Generar igual?`
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
    toast(`✓ Orden de producción generada — ${p.titulo} (${loteTotal} u.)`, 'success')
  }

  if (loading) return <p className="text-sm text-muted p-4">Analizando demanda, stock y lo que viene en camino…</p>

  const totalUnidades = propuestas.reduce((a, p) => a + p.loteTotal, 0)
  const totalNecesidad = propuestas.reduce((a, p) => a + p.sumDeficits, 0)

  return (
    <div className="space-y-4 text-ink">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h2 className="text-base font-semibold">🏭 Órdenes de producción</h2>
          <p className="text-[11px] text-faint">
            {propuestas.length} familias · {ent.format(totalUnidades)} u. a producir
            {totalNecesidad > totalUnidades && ` (necesidad ${ent.format(totalNecesidad)}, recortada por tope de familia o cristales)`} · lo
            justo para {params.cobertura_objetivo_dias}d de demanda − stock − en camino · alarma ≤{params.alarma_min} · tope {params.lote_max}/familia
          </p>
        </div>
        <label className="flex items-center gap-2 text-xs text-muted">
          <input type="checkbox" checked={porColor} onChange={(e) => setPorColor(e.target.checked)} />
          Familia por modelo + color de armazón
        </label>
      </div>

      {propuestas.length === 0 ? (
        <p className="text-sm text-faint text-center py-10">No hay familias con demanda sin cubrir para producir.</p>
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
                    {p.items.length} SKUs · necesidad {ent.format(p.sumDeficits)} u.
                    {loteEff > 0 && loteEff < params.lote_min && (
                      <span className="text-amber-600"> · debajo del lote mínimo ({params.lote_min})</span>
                    )}
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
                      disabled={generando === p.familia || loteEff <= 0}
                      className="text-xs px-3 py-2 rounded-lg bg-brand text-white font-medium disabled:opacity-50 whitespace-nowrap"
                    >
                      {generando === p.familia ? 'Generando…' : 'Generar orden'}
                    </button>
                  )}
                </div>
              </div>
              <div className="p-4 overflow-x-auto">
                <table className="w-full text-[11px] min-w-[620px]">
                  <thead className="text-faint uppercase">
                    <tr>
                      <th className="text-left font-medium pb-1">SKU / color</th>
                      <th className="text-right font-medium pb-1">Stock</th>
                      <th className="text-right font-medium pb-1">En camino</th>
                      <th className="text-right font-medium pb-1">Cobertura</th>
                      <th className="text-right font-medium pb-1">Necesita</th>
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
                            {i.topeCristal && <span className="block text-amber-600">🔬 recortado por cristal disponible</span>}
                          </td>
                          <td className="py-1 text-right">
                            <span className={i.stock <= params.alarma_min ? 'text-red-600 font-semibold' : ''}>{i.stock}</span>
                          </td>
                          <td className="py-1 text-right text-muted">{i.enCamino ? ent.format(i.enCamino) : '—'}</td>
                          <td className="py-1 text-right text-muted">{Number.isFinite(i.dias) ? `${ent.format(i.dias)}d` : '—'}</td>
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
                    {filas.map((f) => (
                      <div key={f.id} className="flex justify-between gap-2 flex-wrap border-t border-black/5 py-1">
                        <span>{f.label}</span>
                        <span className={f.queda < 0 ? 'text-red-600 font-semibold' : 'text-muted'}>
                          usa {ent.format(f.necesita)} · quedan {ent.format(f.queda)}
                          {f.queda < 0 && ' ⚠ faltan'}
                        </span>
                      </div>
                    ))}
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
