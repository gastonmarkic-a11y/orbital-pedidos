import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'
import { useToast } from '../../lib/toast'

// Fase 3 (flujo del jefe de producción: aceptar/observar/fechar → activa y carga el proyectado)
// + Fase 4 (dashboard: producción futura, costos por modelo editables, sobrante de cristales).

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
  const [reservados, setReservados] = useState<{ color_cristal: string; reservado: number }[]>([])
  const [stockCristales, setStockCristales] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [fechas, setFechas] = useState<Record<number, string>>({})
  const [obs, setObs] = useState<Record<number, string>>({})
  const [costoEdit, setCostoEdit] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<number | null>(null)

  async function cargar() {
    const [{ data: par }, { data: peds }, { data: cost }, { data: res }, { data: scr }] = await Promise.all([
      supabase.from('parametros_produccion').select('costo_placeholder_usd').eq('id', 1).maybeSingle(),
      supabase.from('pedidos_produccion').select('*').neq('estado', 'anulado').order('fecha_generado', { ascending: false }),
      supabase.from('costos_produccion').select('sku_o_familia, costo_unitario_usd, vigente_desde').eq('nivel', 'familia'),
      supabase.rpc('cristales_reservados'),
      supabase.from('stock_cristales').select('color_cristal, cantidad_disponible'),
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
    setReservados((res as { color_cristal: string; reservado: number }[]) ?? [])
    const sc: Record<string, number> = {}
    for (const r of (scr as { color_cristal: string; cantidad_disponible: number }[]) ?? []) sc[r.color_cristal] = r.cantidad_disponible
    setStockCristales(sc)
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
      .update({ estado: 'activo', fecha_entrega_estimada: f, aceptado_por: codigoEfectivo })
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
  const activos = pedidos.filter((p) => p.estado === 'activo')

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

  if (loading) return <p className="text-sm text-muted p-4">Cargando pedidos de producción…</p>

  return (
    <div className="space-y-4 text-ink">
      <h2 className="text-base font-semibold">🏭 Pedidos de producción</h2>

      {/* A REVISAR */}
      <div>
        <p className="text-xs font-semibold text-muted uppercase tracking-wide mb-2">A revisar ({aRevisar.length})</p>
        {aRevisar.length === 0 ? (
          <p className="text-sm text-faint">No hay pedidos pendientes. Generalos en “Generar”.</p>
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
                          <td className="py-1">{i.descripcion} <span className="text-faint font-mono">· {i.sku}</span></td>
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
          <p className="text-sm font-semibold">📦 Producción futura (activos)</p>
          <div className="text-right">
            <p className="text-[10px] text-faint uppercase tracking-wide">{ent.format(unidadesFuturo)} u. · costo total</p>
            <p className="text-lg font-bold text-brandDark leading-none">{usd.format(costoTotalFuturo)}</p>
          </div>
        </div>
        {activos.length === 0 ? (
          <p className="text-sm text-faint">Todavía no hay pedidos activos.</p>
        ) : (
          <div className="space-y-2">
            {activos.map((p) => {
              const its = itemsDe(p.id)
              const u = its.reduce((s, i) => s + i.cantidad, 0)
              const costo = its.reduce((s, i) => s + i.cantidad * costoModelo((i.modelo || p.familia_armazon).toUpperCase()), 0)
              return (
                <div key={p.id} className="flex items-center justify-between gap-2 border-t border-black/5 pt-2 first:border-0 first:pt-0 text-sm">
                  <div className="min-w-0">
                    <p className="font-medium truncate">{p.familia_armazon}</p>
                    <p className="text-[11px] text-faint">
                      {its.length} SKUs · {ent.format(u)} u. · entrega {p.fecha_entrega_estimada ?? '—'}
                    </p>
                  </div>
                  <span className="font-semibold shrink-0">{usd.format(costo)}</span>
                </div>
              )
            })}
          </div>
        )}
      </div>

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

      {/* SOBRANTE / RESERVAS DE CRISTALES */}
      <div className="bg-white rounded-xl p-4 border border-black/10">
        <p className="text-sm font-semibold mb-1">🔬 Cristales — reservados y sobrante</p>
        <p className="text-[11px] text-faint mb-2">
          Cristales asignados a pedidos activos/pendientes por color. El sobrante = comprados − asignados (cargá el stock de
          cristales comprados para ver el disponible).
        </p>
        {reservados.length === 0 ? (
          <p className="text-sm text-faint">Sin cristales reservados todavía.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-[10px] text-faint uppercase">
              <tr>
                <th className="text-left font-medium pb-1">Color de cristal</th>
                <th className="text-right font-medium pb-1">Reservado</th>
                <th className="text-right font-medium pb-1">Comprado</th>
                <th className="text-right font-medium pb-1">Sobrante</th>
              </tr>
            </thead>
            <tbody>
              {reservados.map((r) => {
                const comprado = stockCristales[r.color_cristal] ?? null
                const sobrante = comprado != null ? comprado - Number(r.reservado) : null
                return (
                  <tr key={r.color_cristal} className="border-t border-black/5">
                    <td className="py-1">{r.color_cristal}</td>
                    <td className="py-1 text-right font-medium">{ent.format(Number(r.reservado))}</td>
                    <td className="py-1 text-right text-muted">{comprado != null ? ent.format(comprado) : '—'}</td>
                    <td className={`py-1 text-right font-semibold ${sobrante != null && sobrante < 0 ? 'text-red-600' : ''}`}>
                      {sobrante != null ? ent.format(sobrante) : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
