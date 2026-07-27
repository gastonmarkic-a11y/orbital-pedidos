import { useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useToast } from '../../lib/toast'
import { formatPrecio } from '../../lib/format'

type Grupo = 'publicado_sin_stock' | 'con_stock_no_publicado' | 'desincronizado' | 'fantasma'

interface Cruce {
  generado: string
  resumen: Record<string, number>
  publicado_sin_stock: Record<string, unknown>[]
  con_stock_no_publicado: Record<string, unknown>[]
  desincronizado: Record<string, unknown>[]
  fantasma: Record<string, unknown>[]
}

interface FaltanSecretos {
  error: 'faltan_secretos'
  faltan: string[]
}

interface PrecioItem {
  variant_id: number
  producto: string
  variante: string
  sku: string | null
  estado: string
  price: number
  compare_at_price: number | null
}

const GRUPOS: { key: Grupo; label: string; ayuda: string }[] = [
  {
    key: 'publicado_sin_stock',
    label: 'Publicado sin stock',
    ayuda: 'Está a la venta en la tienda pero Orbital marca 0 unidades. Riesgo de vender algo que no tenés.',
  },
  {
    key: 'con_stock_no_publicado',
    label: 'Con stock, no publicado',
    ayuda: 'Tenés unidades en Orbital y no están en la tienda. Venta que se está perdiendo.',
  },
  {
    key: 'desincronizado',
    label: 'Cantidades distintas',
    ayuda: 'Ambos lo tienen, pero con números diferentes. Hay que decidir cuál manda.',
  },
  {
    key: 'fantasma',
    label: 'SKU sin identificar',
    ayuda: 'El SKU de Shopify no existe en el stock de Orbital. Falta cargarlo o mapearlo.',
  },
]

export default function Tienda() {
  const toast = useToast()
  const [cruce, setCruce] = useState<Cruce | null>(null)
  const [sinSecretos, setSinSecretos] = useState<FaltanSecretos | null>(null)
  const [cargando, setCargando] = useState(false)
  const [grupo, setGrupo] = useState<Grupo>('publicado_sin_stock')
  const [importando, setImportando] = useState(false)
  const [importe, setImporte] = useState<Record<string, unknown> | null>(null)

  // --- Editor de precios de Shopify ---
  const [tienda, setTienda] = useState<'linea' | 'outlet'>('linea')
  const [buscarPrec, setBuscarPrec] = useState('')
  const [items, setItems] = useState<PrecioItem[] | null>(null)
  const [cargandoPrec, setCargandoPrec] = useState(false)
  const [edits, setEdits] = useState<Record<number, { price: string; compare: string }>>({})
  const [guardandoId, setGuardandoId] = useState<number | null>(null)
  const [guardandoModelo, setGuardandoModelo] = useState<string | null>(null)
  const [modelosAbiertos, setModelosAbiertos] = useState<Set<string>>(new Set())

  // Variantes agrupadas por modelo (producto): la lista muestra modelos y adentro los colores.
  const porModelo = useMemo(() => {
    const m = new Map<string, PrecioItem[]>()
    for (const it of items ?? []) {
      const arr = m.get(it.producto) ?? []
      arr.push(it)
      m.set(it.producto, arr)
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [items])

  function toggleModelo(m: string) {
    setModelosAbiertos((prev) => {
      const n = new Set(prev)
      if (n.has(m)) n.delete(m)
      else n.add(m)
      return n
    })
  }

  async function listarPrecios() {
    setCargandoPrec(true)
    const { data, error } = await supabase.functions.invoke('shopify-precios', {
      body: { accion: 'listar', tienda, q: buscarPrec.trim() },
    })
    setCargandoPrec(false)
    const cuerpo = (data ?? {}) as { error?: string; detalle?: string; items?: PrecioItem[] }
    if (error || cuerpo.error) {
      toast(cuerpo.detalle || cuerpo.error || error?.message || 'No se pudieron traer los precios', 'error')
      return
    }
    setItems(cuerpo.items ?? [])
    setEdits({})
  }

  function valorEdit(it: PrecioItem, campo: 'price' | 'compare') {
    const e = edits[it.variant_id]
    if (e) return e[campo]
    return campo === 'price' ? String(it.price) : it.compare_at_price != null ? String(it.compare_at_price) : ''
  }

  function setEdit(it: PrecioItem, campo: 'price' | 'compare', v: string) {
    setEdits((prev) => {
      const base = prev[it.variant_id] ?? {
        price: String(it.price),
        compare: it.compare_at_price != null ? String(it.compare_at_price) : '',
      }
      return { ...prev, [it.variant_id]: { ...base, [campo]: v } }
    })
  }

  // Escribe un color en Shopify. Sin confirmación ni toast de éxito: eso lo ponen los wrappers,
  // para poder reutilizarlo en el guardado de todo el modelo. Devuelve true si salió bien.
  async function enviarPrecio(it: PrecioItem): Promise<boolean> {
    const price = valorEdit(it, 'price')
    const compare = valorEdit(it, 'compare')
    setGuardandoId(it.variant_id)
    const { data, error } = await supabase.functions.invoke('shopify-precios', {
      body: { accion: 'guardar', tienda, variant_id: it.variant_id, price, compare_at_price: compare },
    })
    setGuardandoId(null)
    const cuerpo = (data ?? {}) as {
      ok?: boolean
      error?: string
      detalle?: string
      price?: number
      compare_at_price?: number | null
    }
    if (error || cuerpo.error) {
      toast(cuerpo.detalle || cuerpo.error || error?.message || 'No se pudo guardar', 'error')
      return false
    }
    setItems((prev) =>
      prev
        ? prev.map((x) =>
            x.variant_id === it.variant_id
              ? { ...x, price: cuerpo.price ?? x.price, compare_at_price: cuerpo.compare_at_price ?? null }
              : x
          )
        : prev
    )
    setEdits((prev) => {
      const n = { ...prev }
      delete n[it.variant_id]
      return n
    })
    return true
  }

  async function guardarPrecio(it: PrecioItem) {
    const price = valorEdit(it, 'price')
    const compare = valorEdit(it, 'compare')
    if (
      !window.confirm(
        `Actualizar en Shopify (tienda ${tienda}):\n\n${it.producto}${it.variante && it.variante !== 'Default Title' ? ' · ' + it.variante : ''}\n` +
          `Promocionado (precio de venta): ${price || '—'}\nReferencia (tachado): ${compare || '— sin referencia —'}\n\n` +
          `⚠ Esto cambia el precio EN VIVO en la tienda online.`
      )
    )
      return
    if (await enviarPrecio(it)) toast('✓ Precio actualizado en Shopify', 'success')
  }

  // Guarda de una todos los colores del modelo que tengan cambios sin guardar.
  async function guardarModelo(modelo: string, variantes: PrecioItem[]) {
    const conCambios = variantes.filter((v) => edits[v.variant_id])
    if (!conCambios.length) {
      toast('No hay cambios sin guardar en este modelo', 'error')
      return
    }
    if (
      !window.confirm(
        `Guardar ${conCambios.length} color(es) de "${modelo}" en Shopify (tienda ${tienda}).\n\n⚠ Cambia los precios EN VIVO en la tienda online.`
      )
    )
      return
    setGuardandoModelo(modelo)
    let ok = 0
    for (const v of conCambios) if (await enviarPrecio(v)) ok++
    setGuardandoModelo(null)
    toast(`✓ ${ok}/${conCambios.length} color(es) actualizados en ${modelo}`, ok === conCambios.length ? 'success' : 'error')
  }

  async function comparar() {
    setCargando(true)
    setSinSecretos(null)
    const { data, error } = await supabase.functions.invoke('shopify-productos')
    setCargando(false)
    const cuerpo = (data ?? {}) as Partial<FaltanSecretos>
    if (cuerpo.error === 'faltan_secretos') {
      setSinSecretos(cuerpo as FaltanSecretos)
      return
    }
    if (error) {
      toast('No se pudo consultar Shopify: ' + error.message, 'error')
      return
    }
    setCruce(data as Cruce)
  }

  async function importarPedidos(dry: boolean) {
    setImportando(true)
    setSinSecretos(null)
    const { data, error } = await supabase.functions.invoke(
      'shopify-import' + (dry ? '?dry=1' : '')
    )
    setImportando(false)
    const cuerpo = (data ?? {}) as Partial<FaltanSecretos>
    if (cuerpo.error === 'faltan_secretos') {
      setSinSecretos(cuerpo as FaltanSecretos)
      return
    }
    if (error) {
      toast('Falló la importación: ' + error.message, 'error')
      return
    }
    setImporte(data as Record<string, unknown>)
    if (!dry) toast('Pedidos importados. Ya los ve Depósito.', 'success')
  }

  const filas = cruce ? cruce[grupo] : []

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-xl font-semibold">🛍 Tienda vs Sistema</h1>
        <button
          onClick={comparar}
          disabled={cargando}
          className="px-3 py-2 rounded-lg bg-[#15151A] text-white text-sm disabled:opacity-50"
        >
          {cargando ? 'Consultando Shopify…' : '↻ Comparar con Shopify'}
        </button>
      </div>

      {sinSecretos && (
        <div className="border border-[#C8A96E] bg-[#FBF7EE] rounded-lg p-4 text-sm space-y-2">
          <p className="font-semibold">Falta conectar la tienda</p>
          <p>
            La integración está construida y lista, pero todavía no tiene las credenciales de Shopify.
            Faltan estos secretos en Supabase → Project Settings → Edge Functions → Secrets:
          </p>
          <ul className="list-disc pl-5">
            {sinSecretos.faltan.map((f) => (
              <li key={f}>
                <code>{f}</code>
              </li>
            ))}
          </ul>
          <p className="text-black/60">
            El token se genera en Shopify → Configuración → Apps → Desarrollar aplicaciones, con permisos
            de solo lectura (<code>read_orders</code>, <code>read_products</code>, <code>read_inventory</code>).
          </p>
        </div>
      )}

      {cruce && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {GRUPOS.map((g) => {
              const n = cruce.resumen[g.key] ?? 0
              return (
                <button
                  key={g.key}
                  onClick={() => setGrupo(g.key)}
                  className={`text-left p-3 rounded-lg border ${
                    grupo === g.key ? 'border-[#C8A96E] bg-[#FBF7EE]' : 'border-black/10 bg-[#F1EDE4]'
                  }`}
                >
                  <div className="text-2xl font-semibold">{n}</div>
                  <div className="text-xs text-black/70">{g.label}</div>
                </button>
              )
            })}
          </div>

          <p className="text-xs text-black/60">{GRUPOS.find((g) => g.key === grupo)?.ayuda}</p>

          <div className="border border-black/10 rounded-lg overflow-x-auto">
            {filas.length === 0 ? (
              <p className="p-4 text-sm text-black/60">Sin diferencias en esta categoría. 👌</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-[#F1EDE4]">
                  <tr>
                    {Object.keys(filas[0]).map((k) => (
                      <th key={k} className="px-3 py-2 text-left font-semibold whitespace-nowrap">
                        {k.replace(/_/g, ' ')}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filas.slice(0, 200).map((f, i) => (
                    <tr key={i} className="border-t border-black/5">
                      {Object.entries(f).map(([k, v]) => (
                        <td key={k} className="px-3 py-2 whitespace-nowrap">
                          {k.startsWith('precio') && typeof v === 'number'
                            ? formatPrecio(v)
                            : String(v ?? '—')}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          {filas.length > 200 && (
            <p className="text-xs text-black/60">Mostrando las primeras 200 de {filas.length}.</p>
          )}
        </>
      )}

      <div className="border border-black/10 rounded-lg p-4 space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h2 className="font-semibold">💲 Editar precios en Shopify</h2>
          <div className="inline-flex rounded-lg bg-[#F1EDE4] p-0.5">
            {(['linea', 'outlet'] as const).map((t) => (
              <button
                key={t}
                onClick={() => {
                  setTienda(t)
                  setItems(null)
                }}
                className={`px-3 py-1 text-sm rounded-md ${tienda === t ? 'bg-white shadow-sm font-medium' : 'text-black/60'}`}
              >
                {t === 'linea' ? 'Línea' : 'Outlet'}
              </button>
            ))}
          </div>
        </div>
        <p className="text-sm text-black/70">
          <strong>Promocionado</strong> = precio de venta (Shopify <code>price</code>).{' '}
          <strong>Referencia</strong> = precio tachado (Shopify <code>compare_at_price</code>); dejalo vacío para sacar
          el tachado. Los cambios se publican <strong>en vivo</strong> en la tienda.
        </p>
        <div className="flex gap-2 flex-wrap">
          <input
            value={buscarPrec}
            onChange={(e) => setBuscarPrec(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && listarPrecios()}
            placeholder="Buscar por producto o SKU (vacío = todos)"
            className="flex-1 min-w-[200px] border border-black/10 rounded-lg px-3 py-2 text-sm"
          />
          <button
            onClick={listarPrecios}
            disabled={cargandoPrec}
            className="px-3 py-2 rounded-lg bg-[#15151A] text-white text-sm disabled:opacity-50"
          >
            {cargandoPrec ? 'Buscando…' : '🔍 Ver modelos'}
          </button>
        </div>

        {items && (
          <>
            <p className="text-xs text-black/60">
              {porModelo.length} modelo{porModelo.length !== 1 ? 's' : ''} · {items.length} color
              {items.length !== 1 ? 'es' : ''}. Tocá un modelo para abrir sus colores.
            </p>
            {porModelo.length === 0 ? (
              <p className="p-4 text-sm text-black/60 border border-black/10 rounded-lg">Sin resultados.</p>
            ) : (
              <div className="border border-black/10 rounded-lg divide-y divide-black/5">
                {porModelo.map(([modelo, vars]) => {
                  const abierto = modelosAbiertos.has(modelo)
                  const cambios = vars.filter((v) => edits[v.variant_id]).length
                  return (
                    <div key={modelo}>
                      <button
                        onClick={() => toggleModelo(modelo)}
                        className="w-full flex items-center justify-between gap-2 px-3 py-2.5 text-left hover:bg-[#FBF7EE]"
                      >
                        <span className="font-medium">
                          {abierto ? '▾' : '▸'} {modelo}
                        </span>
                        <span className="text-xs text-black/50 whitespace-nowrap">
                          {vars.length} color{vars.length !== 1 ? 'es' : ''}
                          {cambios > 0 && <span className="text-[#C8A96E] font-semibold"> · {cambios} sin guardar</span>}
                        </span>
                      </button>
                      {abierto && (
                        <div className="px-3 pb-3 overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead className="bg-[#F1EDE4]">
                              <tr>
                                <th className="px-2 py-1.5 text-left font-semibold">Color</th>
                                <th className="px-2 py-1.5 text-left font-semibold">SKU</th>
                                <th className="px-2 py-1.5 text-left font-semibold whitespace-nowrap">Promocionado</th>
                                <th className="px-2 py-1.5 text-left font-semibold whitespace-nowrap">Referencia</th>
                                <th className="px-2 py-1.5"></th>
                              </tr>
                            </thead>
                            <tbody>
                              {vars.map((it) => {
                                const cambiado = !!edits[it.variant_id]
                                return (
                                  <tr key={it.variant_id} className="border-t border-black/5">
                                    <td className="px-2 py-1.5">
                                      {it.variante && it.variante !== 'Default Title' ? it.variante : '(único)'}
                                      {it.estado !== 'active' && (
                                        <span className="ml-1 text-[10px] uppercase text-amber-700">({it.estado})</span>
                                      )}
                                    </td>
                                    <td className="px-2 py-1.5 text-xs text-black/60 whitespace-nowrap">{it.sku ?? '—'}</td>
                                    <td className="px-2 py-1.5">
                                      <input
                                        value={valorEdit(it, 'price')}
                                        onChange={(e) => setEdit(it, 'price', e.target.value)}
                                        inputMode="decimal"
                                        className="w-28 border border-black/15 rounded-md px-2 py-1 text-sm"
                                      />
                                    </td>
                                    <td className="px-2 py-1.5">
                                      <input
                                        value={valorEdit(it, 'compare')}
                                        onChange={(e) => setEdit(it, 'compare', e.target.value)}
                                        inputMode="decimal"
                                        placeholder="sin tachado"
                                        className="w-28 border border-black/15 rounded-md px-2 py-1 text-sm placeholder:text-black/30"
                                      />
                                    </td>
                                    <td className="px-2 py-1.5">
                                      <button
                                        onClick={() => guardarPrecio(it)}
                                        disabled={!cambiado || guardandoId === it.variant_id}
                                        className="px-2.5 py-1 rounded-lg border border-[#C8A96E] text-[#8F6A34] text-xs font-semibold disabled:opacity-30"
                                      >
                                        {guardandoId === it.variant_id ? '…' : 'Guardar'}
                                      </button>
                                    </td>
                                  </tr>
                                )
                              })}
                            </tbody>
                          </table>
                          <button
                            onClick={() => guardarModelo(modelo, vars)}
                            disabled={cambios === 0 || guardandoModelo === modelo}
                            className="mt-2 px-3 py-2 rounded-lg bg-[#C8A96E] text-white text-xs font-semibold disabled:opacity-40"
                          >
                            {guardandoModelo === modelo ? 'Guardando…' : `💾 Guardar todos los colores del modelo (${cambios})`}
                          </button>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </>
        )}
        {items && items.length >= 2000 && (
          <p className="text-xs text-black/60">Mostrando las primeras 2000 variantes. Afiná la búsqueda para ver el resto.</p>
        )}
      </div>

      <div className="border border-black/10 rounded-lg p-4 space-y-3">
        <h2 className="font-semibold">Importar pedidos de la tienda</h2>
        <p className="text-sm text-black/70">
          Trae los pedidos de Shopify de los últimos 30 días y los carga como pedidos de Orbital para que
          Depósito los prepare. Cada ítem entra con el <strong>precio que pagó el cliente en la web</strong>,
          no con la lista de Orbital. Lo de línea factura a <strong>888888 · Cons final Tienda</strong> y lo
          de outlet a <strong>888889 · Cons final Outlet</strong>; si un pedido mezcla las dos secciones se
          parte en dos. No se duplican: cada pedido se importa una sola vez. <strong>No descuenta stock</strong>
          — eso lo sigue haciendo Depósito al preparar.
        </p>
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => importarPedidos(true)}
            disabled={importando}
            className="px-3 py-2 rounded-lg border border-black/20 text-sm disabled:opacity-50"
          >
            👁 Simular (no escribe nada)
          </button>
          <button
            onClick={() => importarPedidos(false)}
            disabled={importando}
            className="px-3 py-2 rounded-lg bg-[#15151A] text-white text-sm disabled:opacity-50"
          >
            ⬇ Importar de verdad
          </button>
        </div>
        {importe && (
          <pre className="text-xs bg-[#F1EDE4] rounded p-3 overflow-x-auto max-h-80">
            {JSON.stringify(importe, null, 2)}
          </pre>
        )}
      </div>
    </div>
  )
}
