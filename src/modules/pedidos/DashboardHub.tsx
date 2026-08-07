import { useState } from 'react'
import DashboardPedidos from './Dashboard'
import DashboardVentas from './DashboardVentas'
import MapaZonas from '../atencion/MapaZonas'

// Dashboard general con pestañas: operativo + ventas histórico + mapa de zonas,
// para que convivan en un solo lugar (menos ítems de menú sueltos).

type Tab = 'operativo' | 'ventas' | 'mapa'

export default function DashboardHub() {
  const [tab, setTab] = useState<Tab>('operativo')
  const hoy = new Date()
  const mesAnio = hoy.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' })
  const tabs: { key: Tab; label: string }[] = [
    { key: 'operativo', label: `📊 Operativo · ${mesAnio}` },
    { key: 'ventas', label: '📈 Ventas' },
    { key: 'mapa', label: '🗺 Mapa de zonas' },
  ]
  return (
    <div className="space-y-4">
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
      {tab === 'operativo' && <DashboardPedidos />}
      {tab === 'ventas' && <DashboardVentas />}
      {tab === 'mapa' && <MapaZonas />}
    </div>
  )
}
