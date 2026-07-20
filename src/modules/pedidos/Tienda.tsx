import { useState } from 'react'
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
