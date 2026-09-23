import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'
import { useToast } from '../../lib/toast'
import { cristalLabel } from './CristalesProduccion'

// Fase 3 (flujo del jefe de producción: aceptar/observar/fechar → activa, carga el proyectado y descuenta cristales)
// + Fase 4 (dashboard: producción futura, costos por modelo editables). El stock de cristales vive en la pestaña Cristales.

interface Pedido {
  id: number
  familia_armazon: string
  estado: string
  lote_total: number | null
  fecha_generado: string
  fecha_entrega_estimada: string | null
  observacion: string | null
  creado_por: string | null
  aceptado_por: string | null
  activado_at: string | null
  fecha_entrega_original: string | null
}
interface Item {
  id: number
  pedido_id: number
  sku: string
  modelo: string | null
  descripcion: string | null
  cantidad: number
  stock_al_momento: number | null
  deficit_calculado: number | null
  cristal_id: number | null
  producido: number
}
interface Costo {
  sku_o_familia: string
  costo_unitario_usd: number
  vigente_desde: string
}

const usd = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
const ent = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 })

export default function PedidosProduccion() {
  const { codigoEfectivo, rolEfectivo } = useAuth()
  const puedeGestionar = rolEfectivo === 'produccion' || rolEfectivo === 'admin'
  const toast = useToast()
  const [pedidos, setPedidos] = useState<Pedido[]>([])
  const [items, setItems] = useState<Item[]>([])
  const [costos, setCostos] = useState<Record<string, number>>({}) // familia(modelo) -> costo USD vigente
  const [placeholder, setPlaceholder] = useState(10)
  const [cristalesLbl, setCristalesLbl] = useState<Record<number, string>>({})
  const [cristalesInfo, setCristalesInfo] = useState<Record<number, { stock: number; consumo: number }>>({})
  const [abiertos, setAbiertos] = useState<Set<number>>(new Set())
  const [vista, setVista] = useState<'ordenes' | 'skus'>('ordenes')
  const [hechosEdit, setHechosEdit] = useState<Record<number, string>>({})
  const [fechaEdit, setFechaEdit] = useState<Record<number, string>>({})
  const [sel, setSel] = useState<Set<number>>(new Set()) // órdenes marcadas para exportar
  const [loading, setLoading] = useState(true)
  const [fechas, setFechas] = useState<Record<number, string>>({})
  const [obs, setObs] = useState<Record<number, string>>({})
  const [costoEdit, setCostoEdit] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<number | null>(null)

  async function cargar() {
    const [{ data: par }, { data: peds }, { data: cost }, { data: cri }] = await Promise.all([
      supabase.from('parametros_produccion').select('costo_placeholder_usd').eq('id', 1).maybeSingle(),
      supabase.from('pedidos_produccion').select('*').neq('estado', 'anulado').order('fecha_generado', { ascending: false }),
      supabase.from('costos_produccion').select('sku_o_familia, costo_unitario_usd, vigente_desde').eq('nivel', 'familia'),
      supabase.from('cristales').select('id, base, color, tipo, stock, consumo_por_unidad'),
    ])
    setPlaceholder(Number(par?.costo_placeholder_usd ?? 10))
    const lista = (peds as Pedido[]) ?? []
    setPedidos(lista)
    const ids = lista.map((p) => p.id)
    if (ids.length) {
      const { data: its } = await supabase.from('pedidos_produccion_items').select('*').in('pedido_id', ids)
      setItems((its as Item[]) ?? [])
    } else setItems([])
    // costo vigente = el de mayor vigente_desde por familia
    const cmap: Record<string, number> = {}
    const seen: Record<string, string> = {}
    for (const c of (cost as Costo[]) ?? []) {
      if (!seen[c.sku_o_familia] || c.vigente_desde > seen[c.sku_o_familia]) {
        seen[c.sku_o_familia] = c.vigente_desde
        cmap[c.sku_o_familia] = Number(c.costo_unitario_usd)
      }
    }
    setCostos(cmap)
    const lbl: Record<number, string> = {}
    const info: Record<number, { stock: number; consumo: number }> = {}
    for (const c of (cri as { id: number; base: string; color: string; tipo: string; stock: number; consumo_por_unidad: number }[]) ?? []) {
      lbl[c.id] = cristalLabel(c)
      info[c.id] = { stock: Number(c.stock ?? 0), consumo: Number(c.consumo_por_unidad ?? 1) }
    }
    setCristalesLbl(lbl)
    setCristalesInfo(info)
    setLoading(false)
  }

  useEffect(() => {
    cargar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const itemsDe = (pid: number) => items.filter((i) => i.pedido_id === pid)
  const costoModelo = (modelo: string) => costos[modelo] ?? placeholder

  async function aceptar(p: Pedido) {
    const f = fechas[p.id]
    if (!f) {
      toast('Poné la fecha de entrega estimada antes de aceptar', 'error')
      return
    }
    setBusy(p.id)
    const { error } = await supabase
      .from('pedidos_produccion')
      .update({ estado: 'activo', fecha_entrega_estimada: f, fecha_entrega_original: f, aceptado_por: codigoEfectivo })
      .eq('id', p.id)
    setBusy(null)
    if (error) {
      toast('No se pudo aceptar: ' + error.message, 'error')
      return
    }
    toast(`✓ ${p.familia_armazon} aceptado — proyectado cargado para vendedores`, 'success')
    cargar()
  }

  async function observar(p: Pedido) {
    const o = obs[p.id]?.trim()
    if (!o) {
      toast('Escribí la observación', 'error')
      return
    }
    setBusy(p.id)
    const { error } = await supabase.from('pedidos_produccion').update({ estado: 'en_observacion', observacion: o }).eq('id', p.id)
    setBusy(null)
    if (error) return toast('No se pudo guardar: ' + error.message, 'error')
    toast('Observación registrada', 'success')
    cargar()
  }

  async function anular(p: Pedido) {
    if (!window.confirm(`¿Anular el pedido de producción de ${p.familia_armazon}?`)) return
    const { error } = await supabase.from('pedidos_produccion').update({ estado: 'anulado' }).eq('id', p.id)
    if (error) return toast('No se pudo anular: ' + error.message, 'error')
    toast('Pedido anulado', 'success')
    cargar()
  }

  // Avance: cuántas unidades de cada SKU ya se hicieron
  async function guardarHechos(i: Item, valor: number) {
    const v = Math.max(0, Math.min(i.cantidad, Math.round(valor)))
    const { error } = await supabase.from('pedidos_produccion_items').update({ producido: v }).eq('id', i.id)
    if (error) return toast('No se pudo guardar el avance: ' + error.message, 'error')
    await supabase.from('pedidos_produccion').update({ avance_at: new Date().toISOString() }).eq('id', i.pedido_id)
    setItems((prev) => prev.map((x) => (x.id === i.id ? { ...x, producido: v } : x)))
    setHechosEdit((prev) => {
      const n = { ...prev }
      delete n[i.id]
      return n
    })
  }

  async function marcarTodoHecho(p: Pedido) {
    if (!window.confirm(`¿Marcar ${p.familia_armazon} como terminada (todas las unidades hechas)?`)) return
    for (const i of itemsDe(p.id)) if (i.producido !== i.cantidad) await guardarHechos(i, i.cantidad)
    toast(`✓ ${p.familia_armazon} terminada`, 'success')
  }

  async function cambiarFecha(p: Pedido) {
    const f = fechaEdit[p.id]
    if (!f) return
    const { error } = await supabase
      .from('pedidos_produccion')
      .update({ fecha_entrega_estimada: f, fecha_entrega_original: p.fecha_entrega_original ?? p.fecha_entrega_estimada })
      .eq('id', p.id)
    if (error) return toast('No se pudo cambiar la fecha: ' + error.message, 'error')
    toast(`Entrega de ${p.familia_armazon} → ${f}`, 'success')
    setFechaEdit((prev) => ({ ...prev, [p.id]: '' }))
    cargar()
  }

  async function guardarCosto(modelo: string) {
    const v = parseFloat(costoEdit[modelo] ?? '')
    if (!v || v <= 0) return toast('Ingresá un costo válido', 'error')
    const { error } = await supabase.from('costos_produccion').insert({
      sku_o_familia: modelo,
      nivel: 'familia',
      tipo: 'nacional',
      costo_unitario_usd: v,
      vigente_desde: new Date().toISOString().slice(0, 10),
    })
    if (error) return toast('No se pudo guardar el costo: ' + error.message, 'error')
    setCostos((prev) => ({ ...prev, [modelo]: v }))
    setCostoEdit((prev) => ({ ...prev, [modelo]: '' }))
    toast(`Costo de ${modelo} actualizado a ${usd.format(v)}`, 'success')
  }

  const aRevisar = pedidos.filter((p) => p.estado === 'pendiente' || p.estado === 'en_observacion')
  // Activas ordenadas por fecha de entrega: lo más próximo primero
  const activos = pedidos
    .filter((p) => p.estado === 'activo')
    .sort((a, b) => (a.fecha_entrega_estimada ?? '9999').localeCompare(b.fecha_entrega_estimada ?? '9999'))

  // Modelos presentes en activos (para el editor de costos) + costo total de producción futura
  const modelosActivos = useMemo(() => {
    const set = new Set<string>()
    for (const p of activos) for (const i of itemsDe(p.id)) set.add((i.modelo || p.familia_armazon).toUpperCase())
    return [...set].sort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activos, items])

  const costoTotalFuturo = activos.reduce(
    (a, p) => a + itemsDe(p.id).reduce((s, i) => s + i.cantidad * costoModelo((i.modelo || p.familia_armazon).toUpperCase()), 0),
    0
  )
  const unidadesFuturo = activos.reduce((a, p) => a + itemsDe(p.id).reduce((s, i) => s + i.cantidad, 0), 0)
  const hechasFuturo = activos.reduce((a, p) => a + itemsDe(p.id).reduce((s, i) => s + Math.min(i.producido ?? 0, i.cantidad), 0), 0)

  // Semáforo: avance real vs. el esperado según el tiempo transcurrido entre la activación y la entrega
  function estadoAvance(p: Pedido) {
    const its = itemsDe(p.id)
    const total = its.reduce((s, i) => s + i.cantidad, 0)
    const hechas = its.reduce((s, i) => s + Math.min(i.producido ?? 0, i.cantidad), 0)
    const pct = total ? Math.round((hechas / total) * 100) : 0
    const hoy = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00')
    const fin = p.fecha_entrega_estimada ? new Date(p.fecha_entrega_estimada + 'T00:00:00') : null
    const ini = new Date(p.activado_at ?? p.fecha_generado)
    const dias = fin ? Math.round((fin.getTime() - hoy.getTime()) / 86400000) : null
    let esperado = 0
    if (fin && fin > ini) esperado = Math.max(0, Math.min(100, ((hoy.getTime() - ini.getTime()) / (fin.getTime() - ini.getTime())) * 100))
    let color: 'listo' | 'verde' | 'amarillo' | 'rojo' = 'verde'
    let txt = 'en tiempo'
    if (pct >= 100) {
      color = 'listo'
      txt = 'terminada'
    } else if (dias !== null && dias < 0) {
      color = 'rojo'
      txt = `vencida hace ${-dias}d`
    } else if (pct < esperado - 25 || (dias !== null && dias <= 7 && pct < 70)) {
      color = 'rojo'
      txt = 'atrasada'
    } else if (pct < esperado - 10 || (dias !== null && dias <= 14 && pct < 50)) {
      color = 'amarillo'
      txt = 'un poco atrasada'
    } else if (pct === 0) {
      txt = 'sin empezar'
    }
    const movida = !!p.fecha_entrega_original && !!p.fecha_entrega_estimada && p.fecha_entrega_original !== p.fecha_entrega_estimada
    return { total, hechas, pct, dias, color, txt, movida }
  }
  const SEMAFORO = { listo: '✅', verde: '🟢', amarillo: '🟡', rojo: '🔴' } as const
  const BARRA = { listo: 'bg-emerald-500', verde: 'bg-emerald-500', amarillo: 'bg-amber-400', rojo: 'bg-red-500' } as const

  // Lo que producción va a necesitar: cristales de todas las órdenes activas (el stock ya viene descontado)
  const necesidadCristales = useMemo(() => {
    const m = new Map<number, number>()
    let sinCristal = 0
    for (const p of activos)
      for (const i of itemsDe(p.id)) {
        if (!i.cristal_id) {
          sinCristal += i.cantidad
          continue
        }
        m.set(i.cristal_id, (m.get(i.cristal_id) ?? 0) + i.cantidad * (cristalesInfo[i.cristal_id]?.consumo ?? 1))
      }
    const filas = [...m.entries()]
      .map(([id, cant]) => ({ id, label: cristalesLbl[id] ?? `#${id}`, cant, stock: cristalesInfo[id]?.stock ?? 0 }))
      .sort((a, b) => a.label.localeCompare(b.label))
    return { filas, sinCristal }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activos, items, cristalesLbl, cristalesInfo])

  // Todos los SKUs de las órdenes activas, en una sola lista (por fecha de entrega)
  const todosSkus = useMemo(
    () =>
      activos
        .flatMap((p) =>
          itemsDe(p.id).map((i) => ({ ...i, modeloTxt: (i.modelo || p.familia_armazon).toUpperCase(), entrega: p.fecha_entrega_estimada }))
        )
        .sort(
          (a, b) =>
            (a.entrega ?? '9999').localeCompare(b.entrega ?? '9999') ||
            a.modeloTxt.localeCompare(b.modeloTxt) ||
            (a.descripcion ?? '').localeCompare(b.descripcion ?? '')
        ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activos, items]
  )

  const toggle = (id: number) =>
    setAbiertos((prev) => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })

  // Excel de las órdenes activas (todas o las marcadas): detalle por SKU, resumen por orden y cristales
  async function exportarExcel() {
    const lista = sel.size ? activos.filter((p) => sel.has(p.id)) : activos
    if (!lista.length) return
    const XLSX = await import('xlsx')
    const detalle = lista.flatMap((p) =>
      itemsDe(p.id).map((i) => ({
        Orden: p.id,
        Modelo: (i.modelo || p.familia_armazon).toUpperCase(),
        Entrega: p.fecha_entrega_estimada ?? '',
        SKU: i.sku,
        Color: i.descripcion ?? '',
        Cristal: i.cristal_id ? cristalesLbl[i.cristal_id] ?? '' : 'SIN CRISTAL',
        'A hacer': i.cantidad,
        Hechas: i.producido ?? 0,
        Faltan: Math.max(0, i.cantidad - (i.producido ?? 0)),
      }))
    )
    const resumen = lista.map((p) => {
      const av = estadoAvance(p)
      return {
        Orden: p.id,
        Modelo: p.familia_armazon,
        SKUs: itemsDe(p.id).length,
        'A hacer': av.total,
        Hechas: av.hechas,
        'Avance %': av.pct,
        Estado: av.txt,
        Entrega: p.fecha_entrega_estimada ?? '',
        'Entrega original': p.fecha_entrega_original ?? '',
      }
    })
    const cri = new Map<string, number>()
    for (const d of detalle) cri.set(d.Cristal, (cri.get(d.Cristal) ?? 0) + d['A hacer'])
    const cristalesHoja = [...cri.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([Cristal, u]) => ({ Cristal, Unidades: u }))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(resumen), 'Resumen')
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(detalle), 'Detalle SKUs')
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(cristalesHoja), 'Cristales')
    const hoy = new Date().toISOString().slice(0, 10)
    XLSX.writeFile(wb, sel.size ? `Ordenes_produccion_${lista.map((p) => p.id).join('-')}_${hoy}.xlsx` : `Ordenes_produccion_todas_${hoy}.xlsx`)
  }

  const inputHechos = (i: Item) => (
    <input
      type="number"
      min={0}
      max={i.cantidad}
      disabled={!puedeGestionar}
      value={hechosEdit[i.id] ?? String(i.producido ?? 0)}
      onChange={(e) => setHechosEdit((prev) => ({ ...prev, [i.id]: e.target.value }))}
      onBlur={() => {
        const v = hechosEdit[i.id]
        if (v !== undefined && Number(v) !== (i.producido ?? 0)) guardarHechos(i, Number(v) || 0)
      }}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      className="w-14 rounded border border-black/10 px-1 py-0.5 text-right text-[11px]"
    />
  )

  if (loading) return <p className="text-sm text-muted p-4">Cargando pedidos de producción…</p>

  return (
    <div className="space-y-4 text-ink">
      <h2 className="text-base font-semibold">🏭 Órdenes de producción</h2>

      {/* A REVISAR */}
      <div>
        <p className="text-xs font-semibold text-muted uppercase tracking-wide mb-2">A revisar ({aRevisar.length})</p>
        {aRevisar.length === 0 ? (
          <p className="text-sm text-faint">No hay órdenes pendientes. Se generan en “Calcular”.</p>
        ) : (
          <div className="space-y-3">
            {aRevisar.map((p) => (
              <div key={p.id} className="bg-white rounded-xl border border-black/10">
                <div className="p-4 flex items-center justify-between gap-2 flex-wrap border-b border-black/5">
                  <div>
                    <p className="text-sm font-semibold">
                      {p.familia_armazon}
                      {p.estado === 'en_observacion' && <span className="text-[10px] bg-amber-50 text-amber-700 rounded-full px-2 py-0.5 ml-2">en observación</span>}
                    </p>
                    <p className="text-[11px] text-faint">
                      {itemsDe(p.id).length} SKUs · lote {ent.format(p.lote_total ?? 0)} u.
                      {p.observacion && <span className="text-amber-600"> · {p.observacion}</span>}
                    </p>
                  </div>
                </div>
                <div className="p-4 overflow-x-auto">
                  <table className="w-full text-[11px] min-w-[420px]">
                    <tbody>
                      {itemsDe(p.id).map((i) => (
                        <tr key={i.id} className="border-b border-black/5 last:border-0">
                          <td className="py-1">
                            {i.descripcion} <span className="text-faint font-mono">· {i.sku}</span>
                            <span className={`block ${i.cristal_id ? 'text-faint' : 'text-amber-600'}`}>
                              🔬 {i.cristal_id ? cristalesLbl[i.cristal_id] ?? '—' : 'sin cristal asociado'}
                            </span>
                          </td>
                          <td className="py-1 text-right text-muted">stock {i.stock_al_momento}</td>
                          <td className="py-1 text-right font-bold w-20">{ent.format(i.cantidad)} u.</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {puedeGestionar && (
                  <div className="px-4 pb-4 flex flex-wrap items-end gap-2 border-t border-black/5 pt-3">
                    <label className="text-xs text-muted">
                      Fecha de entrega estimada
                      <input
                        type="date"
                        value={fechas[p.id] ?? ''}
                        onChange={(e) => setFechas((prev) => ({ ...prev, [p.id]: e.target.value }))}
                        className="block mt-1 rounded-lg border border-black/10 px-2 py-1.5 text-sm"
                      />
                    </label>
                    <button
                      onClick={() => aceptar(p)}
                      disabled={busy === p.id}
                      className="rounded-lg bg-emerald-600 text-white px-3 py-2 text-xs font-semibold disabled:opacity-50"
                    >
                      Aceptar y activar
                    </button>
                    <input
                      value={obs[p.id] ?? ''}
                      onChange={(e) => setObs((prev) => ({ ...prev, [p.id]: e.target.value }))}
                      placeholder="Observación…"
                      className="flex-1 min-w-[140px] rounded-lg border border-black/10 px-2 py-2 text-sm"
                    />
                    <button onClick={() => observar(p)} disabled={busy === p.id} className="rounded-lg border border-black/10 text-muted px-3 py-2 text-xs">
                      Observar
                    </button>
                    <button onClick={() => anular(p)} className="rounded-lg border border-red-200 text-red-600 px-3 py-2 text-xs">
                      Anular
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* PRODUCCIÓN FUTURA (activos) */}
      <div className="bg-white rounded-xl p-4 border border-black/10">
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm font-semibold">📦 En producción (activas)</p>
          <div className="text-right">
            <p className="text-[10px] text-faint uppercase tracking-wide">
              {ent.format(hechasFuturo)} de {ent.format(unidadesFuturo)} u. hechas · costo total
            </p>
            <p className="text-lg font-bold text-brandDark leading-none">{usd.format(costoTotalFuturo)}</p>
          </div>
        </div>
        {activos.length === 0 ? (
          <p className="text-sm text-faint">Todavía no hay órdenes activas.</p>
        ) : (
          <>
            <p className="text-[11px] text-faint mb-2">
              Ordenadas por fecha de entrega. Abrí cada orden y cargá cuántas unidades de cada SKU ya están hechas: el semáforo compara el avance con el tiempo que pasó.
            </p>
            <div className="flex items-center justify-between gap-2 flex-wrap mb-3">
              <div className="flex gap-1 bg-black/5 rounded-lg p-0.5 w-fit">
                {(['ordenes', 'skus'] as const).map((v) => (
                  <button
                    key={v}
                    onClick={() => setVista(v)}
                    className={`text-xs px-3 py-1 rounded-md font-medium ${vista === v ? 'bg-white shadow-sm' : 'text-muted'}`}
                  >
                    {v === 'ordenes' ? 'Por orden' : `Todos los SKUs (${todosSkus.length})`}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2">
                {sel.size > 0 && (
                  <button onClick={() => setSel(new Set())} className="text-[11px] text-muted underline">
                    limpiar selección
                  </button>
                )}
                <button onClick={exportarExcel} className="text-xs px-3 py-1.5 rounded-lg border border-black/10 font-medium">
                  ⬇ Excel {sel.size ? `(${sel.size} seleccionada${sel.size > 1 ? 's' : ''})` : '(todas)'}
                </button>
              </div>
            </div>
            {vista === 'ordenes' && <p className="text-[11px] text-faint mb-2">Marcá el casillero de las órdenes que quieras exportar solas.</p>}
            {vista === 'ordenes' ? (
              <div className="space-y-2">
                {activos.map((p) => {
                  const its = itemsDe(p.id)
                  const costo = its.reduce((s, i) => s + i.cantidad * costoModelo((i.modelo || p.familia_armazon).toUpperCase()), 0)
                  const av = estadoAvance(p)
                  const abierto = abiertos.has(p.id)
                  return (
                    <div key={p.id} className="border-t border-black/5 pt-2 first:border-0 first:pt-0">
                      <div className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        checked={sel.has(p.id)}
                        onChange={() =>
                          setSel((prev) => {
                            const n = new Set(prev)
                            if (n.has(p.id)) n.delete(p.id)
                            else n.add(p.id)
                            return n
                          })
                        }
                        className="mt-1"
                        title="Seleccionar para exportar"
                      />
                      <button onClick={() => toggle(p.id)} className="flex-1 min-w-0 flex items-center justify-between gap-2 text-sm text-left">
                        <div className="min-w-0 flex-1">
                          <p className="font-medium truncate">
                            <span className="text-faint mr-1">{abierto ? '▾' : '▸'}</span>
                            {SEMAFORO[av.color]} {p.familia_armazon} <span className="text-faint text-[11px]">#{p.id}</span>
                          </p>
                          <p className="text-[11px] text-faint">
                            {its.length} SKUs · {ent.format(av.hechas)}/{ent.format(av.total)} u. · entrega {p.fecha_entrega_estimada ?? '—'}
                            {av.dias !== null && av.dias >= 0 && ` (faltan ${av.dias}d)`}
                            {av.movida && <span className="text-amber-600"> · era {p.fecha_entrega_original}</span>}
                            {' · '}
                            <span className={av.color === 'rojo' ? 'text-red-600' : av.color === 'amarillo' ? 'text-amber-600' : ''}>{av.txt}</span>
                          </p>
                          <div className="h-1.5 bg-black/5 rounded-full mt-1 max-w-xs">
                            <div className={`h-1.5 rounded-full ${BARRA[av.color]}`} style={{ width: `${av.pct}%` }} />
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="font-semibold">{av.pct}%</p>
                          <p className="text-[11px] text-faint">{usd.format(costo)}</p>
                        </div>
                      </button>
                      </div>
                      {abierto && (
                        <div className="mt-2 pl-4">
                          <div className="overflow-x-auto">
                            <table className="w-full text-[11px] min-w-[460px]">
                              <thead>
                                <tr className="text-faint text-left border-b border-black/10">
                                  <th className="py-1 font-medium">SKU / color</th>
                                  <th className="py-1 font-medium text-right">A hacer</th>
                                  <th className="py-1 font-medium text-right">Hechas</th>
                                  <th className="py-1 font-medium text-right">Faltan</th>
                                </tr>
                              </thead>
                              <tbody>
                                {[...its]
                                  .sort((a, b) => b.cantidad - a.cantidad)
                                  .map((i) => {
                                    const faltan = i.cantidad - (i.producido ?? 0)
                                    return (
                                      <tr key={i.id} className="border-b border-black/5 last:border-0">
                                        <td className="py-1">
                                          {i.descripcion} <span className="text-faint font-mono">· {i.sku}</span>
                                          <span className={`block ${i.cristal_id ? 'text-faint' : 'text-amber-600'}`}>
                                            🔬 {i.cristal_id ? cristalesLbl[i.cristal_id] ?? '—' : 'sin cristal asociado'}
                                          </span>
                                        </td>
                                        <td className="py-1 text-right font-bold">{ent.format(i.cantidad)}</td>
                                        <td className="py-1 text-right">{inputHechos(i)}</td>
                                        <td className={`py-1 text-right ${faltan > 0 ? '' : 'text-emerald-600'}`}>{faltan > 0 ? ent.format(faltan) : '✓'}</td>
                                      </tr>
                                    )
                                  })}
                              </tbody>
                            </table>
                          </div>
                          {puedeGestionar && (
                            <div className="flex flex-wrap items-center gap-2 mt-2">
                              <label className="text-[11px] text-muted flex items-center gap-1">
                                Mover entrega
                                <input
                                  type="date"
                                  value={fechaEdit[p.id] ?? ''}
                                  onChange={(e) => setFechaEdit((prev) => ({ ...prev, [p.id]: e.target.value }))}
                                  className="rounded border border-black/10 px-1.5 py-0.5 text-[11px]"
                                />
                              </label>
                              <button
                                onClick={() => cambiarFecha(p)}
                                disabled={!fechaEdit[p.id]}
                                className="text-[11px] px-2 py-1 rounded-lg border border-black/10 disabled:opacity-40"
                              >
                                Guardar fecha
                              </button>
                              {av.pct < 100 && (
                                <button onClick={() => marcarTodoHecho(p)} className="text-[11px] px-2 py-1 rounded-lg bg-emerald-600 text-white">
                                  Marcar terminada
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[11px] min-w-[640px]">
                  <thead>
                    <tr className="text-faint text-left border-b border-black/10">
                      <th className="py-1 font-medium">Entrega</th>
                      <th className="py-1 font-medium">Modelo</th>
                      <th className="py-1 font-medium">Color</th>
                      <th className="py-1 font-medium">SKU</th>
                      <th className="py-1 font-medium">Cristal</th>
                      <th className="py-1 font-medium text-right">A hacer</th>
                      <th className="py-1 font-medium text-right">Hechas</th>
                    </tr>
                  </thead>
                  <tbody>
                    {todosSkus.map((i) => (
                      <tr key={i.id} className="border-b border-black/5 last:border-0">
                        <td className="py-1 text-muted whitespace-nowrap">{i.entrega ?? '—'}</td>
                        <td className="py-1 font-medium">{i.modeloTxt}</td>
                        <td className="py-1">{i.descripcion}</td>
                        <td className="py-1 font-mono text-faint">{i.sku}</td>
                        <td className={`py-1 ${i.cristal_id ? 'text-muted' : 'text-amber-600'}`}>
                          {i.cristal_id ? cristalesLbl[i.cristal_id] ?? '—' : 'sin cristal'}
                        </td>
                        <td className="py-1 text-right font-bold">{ent.format(i.cantidad)}</td>
                        <td className="py-1 text-right">{inputHechos(i)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>

      {/* LO QUE VA A NECESITAR PRODUCCIÓN */}
      {activos.length > 0 && (
        <div className="bg-white rounded-xl p-4 border border-black/10">
          <p className="text-sm font-semibold mb-1">🔬 Cristales que van a necesitar</p>
          <p className="text-[11px] text-faint mb-2">Total de todas las órdenes activas. El stock que queda ya tiene esto descontado.</p>
          <table className="w-full text-[11px]">
            <thead>
              <tr className="text-faint text-left border-b border-black/10">
                <th className="py-1 font-medium">Cristal</th>
                <th className="py-1 font-medium text-right">Necesitan</th>
                <th className="py-1 font-medium text-right">Quedan en stock</th>
              </tr>
            </thead>
            <tbody>
              {necesidadCristales.filas.map((c) => (
                <tr key={c.id} className="border-b border-black/5 last:border-0">
                  <td className="py-1">{c.label}</td>
                  <td className="py-1 text-right font-bold">{ent.format(c.cant)}</td>
                  <td className={`py-1 text-right ${c.stock < 0 ? 'text-red-600 font-semibold' : 'text-muted'}`}>{ent.format(c.stock)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {necesidadCristales.sinCristal > 0 && (
            <p className="text-[11px] text-amber-600 mt-2">
              ⚠️ {ent.format(necesidadCristales.sinCristal)} u. sin cristal asociado (asignalo en la pestaña Cristales).
            </p>
          )}
        </div>
      )}

      {/* COSTO POR MODELO (editable) */}
      {puedeGestionar && modelosActivos.length > 0 && (
        <div className="bg-white rounded-xl p-4 border border-black/10">
          <p className="text-sm font-semibold mb-1">💲 Costo por modelo (USD/unidad)</p>
          <p className="text-[11px] text-faint mb-2">Default {usd.format(placeholder)} hasta cargar el real. Cada cambio queda con su fecha (historial).</p>
          <div className="grid sm:grid-cols-2 gap-2">
            {modelosActivos.map((m) => (
              <div key={m} className="flex items-center gap-2 text-sm">
                <span className="flex-1 truncate">{m}</span>
                <span className="text-muted text-xs">actual {usd.format(costoModelo(m))}</span>
                <input
                  type="number"
                  step={0.5}
                  value={costoEdit[m] ?? ''}
                  onChange={(e) => setCostoEdit((prev) => ({ ...prev, [m]: e.target.value }))}
                  placeholder="nuevo"
                  className="w-20 rounded-lg border border-black/10 px-2 py-1 text-sm"
                />
                <button onClick={() => guardarCosto(m)} className="text-xs px-2 py-1 rounded-lg bg-brand/10 text-brandDark font-medium">
                  Guardar
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

    </div>
  )
}
