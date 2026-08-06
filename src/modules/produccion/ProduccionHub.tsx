import { useState } from 'react'
import { useAuth } from '../../lib/auth'
import Produccion from '../pedidos/Produccion'
import GeneradorProduccion from './GeneradorProduccion'
import PedidosProduccion from './PedidosProduccion'
import PanelCosteo from './PanelCosteo'

// Hub de Producción: un solo ítem de menú con pestañas (Ingresos / Generar / Pedidos / Costeo),
// para no tener 4 entradas sueltas. Depósito solo ve Ingresos.

type Tab = 'ingresos' | 'generar' | 'pedidos' | 'costeo'

export default function ProduccionHub() {
  const { rolEfectivo } = useAuth()
  const esProd = rolEfectivo === 'produccion' || rolEfectivo === 'admin'
  const tabs: { key: Tab; label: string }[] = esProd
    ? [
        { key: 'pedidos', label: '📋 Pedidos' },
        { key: 'generar', label: '⚙️ Orden de producción' },
        { key: 'costeo', label: '🧮 Costeo' },
      ]
    : [{ key: 'ingresos', label: '📦 Ingresos a confirmar' }]
  const [tab, setTab] = useState<Tab>(tabs[0].key)

  return (
    <div className="space-y-4">
      {tabs.length > 1 && (
        <div className="flex gap-1 bg-white border border-black/10 rounded-lg p-0.5 overflow-x-auto">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`text-xs px-3 py-1.5 rounded-md font-medium whitespace-nowrap ${tab === t.key ? 'bg-brand text-white' : 'text-muted'}`}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}
      {tab === 'ingresos' && <Produccion />}
      {tab === 'generar' && <GeneradorProduccion />}
      {tab === 'pedidos' && <PedidosProduccion />}
      {tab === 'costeo' && <PanelCosteo />}
    </div>
  )
}
