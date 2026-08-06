import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { fetchPaged } from '../../lib/fetchAll'
import { useAuth } from '../../lib/auth'
import { useToast } from '../../lib/toast'
import { StockIngreso } from '../../lib/types'

// Ingresos a confirmar. El stock proyectado lo genera la orden de producción / el movimiento de
// ventas; acá depósito CONFIRMA lo que llega físicamente. Permite ingreso PARCIAL: se carga lo que
// realmente llegó y el resto queda pendiente. (La carga manual de proyectado quedó obsoleta.)

export default function Produccion() {
  const { rolEfectivo, codigoEfectivo } = useAuth()
  const esProd = rolEfectivo === 'produccion' || rolEfectivo === 'admin'
  const esDeposito = rolEfectivo === 'deposito' || rolEfectivo === 'admin'
  const toast = useToast()

  const [ingresos, setIngresos] = useState<StockIngreso[]>([])
  const [loading, setLoading] = useState(true)
  const [recarga, setRecarga] = useState(0)
  const [cantConf, setCantConf] = useState<Record<number, string>>({})
  const [confirmando, setConfirmando] = useState<number | null>(null)

  useEffect(() => {
    async function cargar() {
      const ing = await fetchPaged<StockIngreso>(() =>
        supabase.from('stock_ingresos').select('*').eq('estado', 'proyectado').order('created_at', { ascending: false })
      )
      setIngresos(ing)
      setLoading(false)
    }
    cargar()
  }, [recarga])

  const totalProyectado = ingresos.reduce((a, i) => a + i.cantidad, 0)

  async function confirmar(i: StockIngreso) {
    const raw = cantConf[i.id]
    const n = raw === undefined || raw === '' ? i.cantidad : parseInt(raw, 10)
    if (!n || n <= 0) {
      toast('Ingresá una cantidad válida', 'error')
      return
    }
    if (n > i.cantidad) {
      toast(`No podés ingresar más de ${i.cantidad} u. (lo pendiente)`, 'error')
      return
    }
    setConfirmando(i.id)
    const { error } = await supabase.rpc('confirmar_ingreso_parcial', { p_id: i.id, p_por: codigoEfectivo, p_cant: n })
    setConfirmando(null)
    if (error) {
      toast('No se pudo confirmar: ' + error.message, 'error')
      return
    }
    const parcial = n < i.cantidad
    setCantConf((prev) => { const c = { ...prev }; delete c[i.id]; return c })
    setRecarga((r) => r + 1)
    toast(
      parcial
        ? `✓ Ingresaron ${n} u. de ${i.modelo} · quedan ${i.cantidad - n} u. pendientes`
        : `✓ Ingreso confirmado — ${n} u. de ${i.modelo} sumadas al stock`,
      'success'
    )
  }

  async function anular(i: StockIngreso) {
    if (!window.confirm(`¿Anular el proyectado de ${i.cantidad} u. de ${i.modelo}?`)) return
    const { error } = await supabase.from('stock_ingresos').update({ estado: 'anulado' }).eq('id', i.id)
    if (error) {
      toast('No se pudo anular: ' + error.message, 'error')
      return
    }
    setIngresos((prev) => prev.filter((x) => x.id !== i.id))
    toast('Proyectado anulado', 'success')
  }

  if (loading) return <p className="text-sm text-muted p-4">Cargando ingresos...</p>

  return (
    <div className="space-y-4 text-ink">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">📦 Ingresos a confirmar</h2>
        <span className="text-xs text-muted">
          {ingresos.length} artículo{ingresos.length !== 1 ? 's' : ''} · {totalProyectado} u. pendientes
        </span>
      </div>

      <div className="bg-white rounded-xl p-4 border border-black/10">
        <p className="text-[11px] text-faint mb-3">
          {esDeposito
            ? 'Confirmá el ingreso cuando el producto llegue físicamente. Podés cargar un ingreso PARCIAL: escribí lo que realmente llegó y el resto queda pendiente.'
            : 'Estos artículos están en producción. Depósito los confirma (total o parcial) cuando ingresan.'}
        </p>
        {ingresos.length === 0 ? (
          <p className="text-sm text-faint text-center py-6">No hay ingresos pendientes.</p>
        ) : (
          <div className="space-y-2">
            {ingresos.map((i) => (
              <div key={i.id} className="flex items-center justify-between gap-2 border-t border-black/5 pt-2 first:border-0 first:pt-0">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">
                    {i.modelo} <span className="text-muted font-normal">{i.descripcion || ''}</span>
                  </p>
                  <p className="text-[10px] font-mono text-faint">
                    {i.codigo} · {i.creado_por || '—'} ·{' '}
                    {i.created_at ? new Date(i.created_at).toLocaleDateString('es-AR') : ''}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {esDeposito ? (
                    <>
                      <label className="flex items-center gap-1 text-[11px] text-muted">
                        <input
                          type="number"
                          min={1}
                          max={i.cantidad}
                          value={cantConf[i.id] ?? String(i.cantidad)}
                          onChange={(e) => setCantConf((prev) => ({ ...prev, [i.id]: e.target.value }))}
                          className="w-16 bg-white border border-black/10 rounded-lg px-2 py-1 text-sm text-right"
                        />
                        <span className="whitespace-nowrap">de {i.cantidad}</span>
                      </label>
                      <button
                        onClick={() => confirmar(i)}
                        disabled={confirmando === i.id}
                        className="rounded-lg bg-emerald-600 text-white px-3 py-1.5 text-xs font-semibold disabled:opacity-50 whitespace-nowrap"
                      >
                        {confirmando === i.id ? '...' : '✓ Confirmar'}
                      </button>
                    </>
                  ) : (
                    <span className="text-sm font-bold">{i.cantidad} u.</span>
                  )}
                  {esProd && !esDeposito && (
                    <button onClick={() => anular(i)} className="rounded-lg border border-red-200 text-red-600 px-2.5 py-1.5 text-xs">
                      Anular
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
