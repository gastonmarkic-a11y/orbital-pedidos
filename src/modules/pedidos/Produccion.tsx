import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { fetchPaged } from '../../lib/fetchAll'
import { useAuth } from '../../lib/auth'
import { useToast } from '../../lib/toast'
import { StockIngreso } from '../../lib/types'

interface StockMin {
  codigo: string
  modelo: string | null
  descripcion: string | null
  precio: number | null
  cantidad: number
}

export default function Produccion() {
  const { rolEfectivo, codigoEfectivo } = useAuth()
  const esProd = rolEfectivo === 'produccion' || rolEfectivo === 'admin'
  const esDeposito = rolEfectivo === 'deposito' || rolEfectivo === 'admin'
  const toast = useToast()

  const [ingresos, setIngresos] = useState<StockIngreso[]>([])
  const [stock, setStock] = useState<StockMin[]>([])
  const [loading, setLoading] = useState(true)
  const [recarga, setRecarga] = useState(0)

  // Alta individual
  const [busq, setBusq] = useState('')
  const [sel, setSel] = useState<StockMin | null>(null)
  const [nuevoModo, setNuevoModo] = useState(false)
  const [nuevo, setNuevo] = useState({ codigo: '', modelo: '', descripcion: '', precio: '' })
  const [cant, setCant] = useState('1')
  const [guardando, setGuardando] = useState(false)

  // Alta masiva
  const [masivo, setMasivo] = useState('')
  const [guardandoMasivo, setGuardandoMasivo] = useState(false)

  useEffect(() => {
    async function cargar() {
      const [ing, st] = await Promise.all([
        fetchPaged<StockIngreso>(() =>
          supabase.from('stock_ingresos').select('*').eq('estado', 'proyectado').order('created_at', { ascending: false })
        ),
        fetchPaged<StockMin>(() => supabase.from('stock').select('codigo, modelo, descripcion, precio, cantidad').order('modelo')),
      ])
      setIngresos(ing)
      setStock(st)
      setLoading(false)
    }
    cargar()
  }, [recarga])

  const sugerencias = useMemo(() => {
    const q = busq.trim().toLowerCase()
    if (q.length < 2 || sel) return []
    return stock
      .filter(
        (s) =>
          s.codigo.toLowerCase().includes(q) ||
          (s.modelo || '').toLowerCase().includes(q) ||
          (s.descripcion || '').toLowerCase().includes(q)
      )
      .slice(0, 8)
  }, [busq, stock, sel])

  const totalProyectado = ingresos.reduce((a, i) => a + i.cantidad, 0)

  async function cargarProyectado() {
    const n = parseInt(cant, 10)
    if (!n || n <= 0) {
      toast('Ingresá una cantidad válida', 'error')
      return
    }
    let fila: { codigo: string; modelo: string | null; descripcion: string | null; precio: number | null }
    if (nuevoModo) {
      if (!nuevo.codigo.trim() || !nuevo.modelo.trim()) {
        toast('El SKU nuevo necesita al menos código y modelo', 'error')
        return
      }
      fila = {
        codigo: nuevo.codigo.trim(),
        modelo: nuevo.modelo.trim(),
        descripcion: nuevo.descripcion.trim() || null,
        precio: nuevo.precio ? parseFloat(nuevo.precio) : null,
      }
    } else {
      if (!sel) {
        toast('Elegí un artículo o cargá uno nuevo', 'error')
        return
      }
      fila = { codigo: sel.codigo, modelo: sel.modelo, descripcion: sel.descripcion, precio: sel.precio }
    }
    setGuardando(true)
    const { error } = await supabase.from('stock_ingresos').insert({
      codigo: fila.codigo,
      modelo: fila.modelo,
      descripcion: fila.descripcion,
      cantidad: n,
      precio: fila.precio,
      estado: 'proyectado',
      creado_por: codigoEfectivo,
    })
    setGuardando(false)
    if (error) {
      toast('No se pudo cargar: ' + error.message, 'error')
      return
    }
    setSel(null)
    setBusq('')
    setNuevo({ codigo: '', modelo: '', descripcion: '', precio: '' })
    setNuevoModo(false)
    setCant('1')
    setRecarga((r) => r + 1)
    toast(`✓ ${n} u. de ${fila.modelo} cargadas como proyectado`, 'success')
  }

  async function cargarMasivo() {
    const lineas = masivo
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
    if (!lineas.length) return
    const filas: Record<string, unknown>[] = []
    const errores: string[] = []
    for (const l of lineas) {
      const partes = l.split(/[,;\t]+/).map((x) => x.trim())
      const codigo = partes[0]
      const cantidad = parseInt(partes[1], 10)
      if (!codigo || !cantidad || cantidad <= 0) {
        errores.push(l)
        continue
      }
      const existente = stock.find((s) => s.codigo === codigo)
      filas.push({
        codigo,
        modelo: partes[2] || existente?.modelo || codigo,
        descripcion: partes[3] || existente?.descripcion || null,
        cantidad,
        precio: existente?.precio ?? null,
        estado: 'proyectado',
        creado_por: codigoEfectivo,
      })
    }
    if (!filas.length) {
      toast('No se pudo leer ninguna línea. Formato: código, cantidad', 'error')
      return
    }
    setGuardandoMasivo(true)
    const { error } = await supabase.from('stock_ingresos').insert(filas)
    setGuardandoMasivo(false)
    if (error) {
      toast('No se pudo cargar: ' + error.message, 'error')
      return
    }
    setMasivo('')
    setRecarga((r) => r + 1)
    toast(
      `✓ ${filas.length} artículos cargados como proyectado${errores.length ? ` · ${errores.length} líneas se ignoraron` : ''}`,
      'success'
    )
  }

  async function confirmar(i: StockIngreso) {
    const { error } = await supabase.rpc('confirmar_ingreso_stock', { p_id: i.id, p_por: codigoEfectivo })
    if (error) {
      toast('No se pudo confirmar: ' + error.message, 'error')
      return
    }
    setIngresos((prev) => prev.filter((x) => x.id !== i.id))
    toast(`✓ Ingreso confirmado — ${i.cantidad} u. de ${i.modelo} sumadas al stock`, 'success')
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

  if (loading) return <p className="text-sm text-muted p-4">Cargando producción...</p>

  return (
    <div className="space-y-4 text-ink">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">🏭 Producción — Stock proyectado</h2>
        <span className="text-xs text-muted">
          {ingresos.length} artículo{ingresos.length !== 1 ? 's' : ''} · {totalProyectado} u. proyectadas
        </span>
      </div>

      {esProd && (
        <>
          {/* Alta individual */}
          <div className="bg-white rounded-xl p-4 border border-black/10 space-y-3">
            <p className="text-sm font-semibold">Cargar proyectado (individual)</p>
            {!nuevoModo ? (
              <>
                {sel ? (
                  <div className="flex items-center justify-between gap-2 bg-[#F1EDE4] rounded-lg px-3 py-2 text-sm">
                    <span className="min-w-0">
                      <b>{sel.modelo}</b> <span className="text-muted">{sel.descripcion || sel.codigo}</span>
                      <span className="block text-[10px] font-mono text-faint">{sel.codigo} · en stock: {sel.cantidad}</span>
                    </span>
                    <button onClick={() => setSel(null)} className="text-xs text-muted underline shrink-0">
                      cambiar
                    </button>
                  </div>
                ) : (
                  <>
                    <input
                      value={busq}
                      onChange={(e) => setBusq(e.target.value)}
                      placeholder="Buscar artículo por código, modelo o descripción..."
                      className="w-full bg-white border border-black/10 rounded-lg px-3 py-2 text-sm placeholder:text-faint"
                    />
                    {sugerencias.map((s) => (
                      <button
                        key={s.codigo}
                        onClick={() => {
                          setSel(s)
                          setBusq('')
                        }}
                        className="w-full text-left rounded-lg border border-black/10 px-3 py-2 text-sm hover:border-brand/40"
                      >
                        <b>{s.modelo}</b> <span className="text-muted">{s.descripcion || ''}</span>
                        <span className="block text-[10px] font-mono text-faint">{s.codigo}</span>
                      </button>
                    ))}
                    <button onClick={() => setNuevoModo(true)} className="text-xs text-brandDark font-medium">
                      + Es un artículo nuevo (no está en el stock todavía)
                    </button>
                  </>
                )}
              </>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium text-brandDark">Artículo nuevo</p>
                  <button onClick={() => setNuevoModo(false)} className="text-xs text-muted underline">
                    buscar existente
                  </button>
                </div>
                {(
                  [
                    ['codigo', 'Código (SKU) *'],
                    ['modelo', 'Modelo *'],
                    ['descripcion', 'Descripción / color'],
                    ['precio', 'Precio (opcional)'],
                  ] as const
                ).map(([k, ph]) => (
                  <input
                    key={k}
                    value={nuevo[k]}
                    onChange={(e) => setNuevo({ ...nuevo, [k]: e.target.value })}
                    placeholder={ph}
                    className="w-full bg-white border border-black/10 rounded-lg px-3 py-2 text-sm placeholder:text-faint"
                  />
                ))}
              </div>
            )}
            <div className="flex items-end gap-2">
              <label className="block text-xs text-muted">
                Cantidad proyectada
                <input
                  type="number"
                  min={1}
                  value={cant}
                  onChange={(e) => setCant(e.target.value)}
                  className="w-28 mt-1 block bg-white border border-black/10 rounded-lg px-3 py-2 text-sm"
                />
              </label>
              <button
                onClick={cargarProyectado}
                disabled={guardando}
                className="flex-1 rounded-lg bg-brand text-white py-2 text-sm font-semibold disabled:opacity-50"
              >
                {guardando ? 'Cargando...' : 'Cargar como proyectado'}
              </button>
            </div>
          </div>

          {/* Alta masiva */}
          <div className="bg-white rounded-xl p-4 border border-black/10 space-y-2">
            <p className="text-sm font-semibold">Cargar proyectado (masivo)</p>
            <p className="text-xs text-faint">
              Pegá una línea por artículo: <b>código, cantidad</b> (opcional: código, cantidad, modelo, descripción).
            </p>
            <textarea
              value={masivo}
              onChange={(e) => setMasivo(e.target.value)}
              rows={5}
              placeholder={'002050A48974002, 24\n002051A38905198, 12'}
              className="w-full bg-white border border-black/10 rounded-lg px-3 py-2 text-sm font-mono placeholder:text-faint"
            />
            <button
              onClick={cargarMasivo}
              disabled={guardandoMasivo || !masivo.trim()}
              className="w-full rounded-lg bg-brand text-white py-2 text-sm font-semibold disabled:opacity-50"
            >
              {guardandoMasivo ? 'Cargando...' : 'Cargar lista'}
            </button>
          </div>
        </>
      )}

      {/* Bandeja de proyectados / ingresos a confirmar */}
      <div className="bg-white rounded-xl p-4 border border-black/10">
        <p className="text-sm font-semibold mb-1">
          {esDeposito && !esProd ? '📥 Ingresos a confirmar' : '📋 Proyectado pendiente de ingresar'}
        </p>
        <p className="text-[11px] text-faint mb-3">
          {esDeposito
            ? 'Confirmá el ingreso cuando el producto llegue físicamente a depósito — recién ahí suma al stock disponible.'
            : 'Estos artículos están en producción. Depósito los confirma cuando ingresan.'}
        </p>
        {ingresos.length === 0 ? (
          <p className="text-sm text-faint text-center py-6">No hay stock proyectado pendiente.</p>
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
                  <span className="text-sm font-bold">{i.cantidad} u.</span>
                  {esDeposito && (
                    <button
                      onClick={() => confirmar(i)}
                      className="rounded-lg bg-emerald-600 text-white px-3 py-1.5 text-xs font-semibold"
                    >
                      ✓ Confirmar ingreso
                    </button>
                  )}
                  {esProd && (
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
