import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'

// Mapa de zonas por FACTURACIÓN REAL 2026 (Tango B2B + Shopify B2C), drill-down provincia → localidad.
// Barra en dos colores: B2B (mayorista) + B2C (minorista e-commerce).

interface ZonaRow {
  zona: string
  clientes: number
  con_venta: number
  activos_90: number
  sin_contactar: number
  b2b_ars: number
  b2c_ars: number
}
type Metric = 'facturacion' | 'clientes' | 'frio'

const METRICAS: { k: Metric; label: string }[] = [
  { k: 'facturacion', label: '💰 Facturación 2026' },
  { k: 'clientes', label: '👥 Clientes' },
  { k: 'frio', label: '❄ Sin contactar' },
]
const kAr = (n: number) => '$' + Math.round(n).toLocaleString('es-AR')

export default function MapaZonas() {
  const [prov, setProv] = useState<string | null>(null)
  const [rows, setRows] = useState<ZonaRow[]>([])
  const [loading, setLoading] = useState(true)
  const [metric, setMetric] = useState<Metric>('facturacion')

  useEffect(() => {
    setLoading(true)
    supabase.rpc('zonas_facturacion', { p_provincia: prov }).then(({ data, error }) => {
      setRows(error ? [] : ((data as ZonaRow[]) ?? []))
      setLoading(false)
    })
  }, [prov])

  const total = (r: ZonaRow) => Number(r.b2b_ars) + Number(r.b2c_ars)
  const valor = (r: ZonaRow) => (metric === 'facturacion' ? total(r) : metric === 'clientes' ? r.clientes : r.sin_contactar)
  const ordenadas = [...rows].sort((a, b) => valor(b) - valor(a))
  const max = Math.max(1, ...ordenadas.map(valor))
  const esFrio = metric === 'frio'
  const esFact = metric === 'facturacion'

  return (
    <div className="space-y-3 text-ink">
      <div className="flex items-center gap-2 flex-wrap">
        <h2 className="text-base font-semibold">🗺 Mapa de zonas</h2>
        {prov && (
          <button onClick={() => setProv(null)} className="text-xs text-brandDark font-medium">← Provincias</button>
        )}
      </div>
      <p className="text-[11px] text-faint -mt-1">
        {prov ? `Localidades de ${prov}` : 'Provincias'} · facturación real 2026 (Tango + Shopify) · tocá una zona para {prov ? 'volver' : 'ver sus localidades'}.
      </p>

      <div className="flex gap-1.5 flex-wrap items-center">
        {METRICAS.map((m) => (
          <button key={m.k} onClick={() => setMetric(m.k)} className={`text-[11px] rounded-full px-3 py-1.5 border font-medium ${metric === m.k ? 'bg-brand text-white border-brand' : 'border-black/10 text-muted'}`}>{m.label}</button>
        ))}
        {esFact && (
          <span className="flex items-center gap-3 text-[10px] text-muted ml-1">
            <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-sm bg-[#c0392b]" />B2B mayorista</span>
            <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-sm bg-amber-500" />B2C e-commerce</span>
          </span>
        )}
      </div>

      {loading ? (
        <p className="text-sm text-muted p-2">Cargando...</p>
      ) : ordenadas.length === 0 ? (
        <p className="text-sm text-faint text-center py-8 bg-white rounded-xl border border-black/10">Sin datos.</p>
      ) : (
        <div className="space-y-1.5">
          {ordenadas.map((r) => {
            const v = valor(r)
            const pct = (v / max) * 100
            const b2bW = esFact && total(r) > 0 ? (Number(r.b2b_ars) / total(r)) * pct : pct
            const b2cW = esFact && total(r) > 0 ? (Number(r.b2c_ars) / total(r)) * pct : 0
            return (
              <button key={r.zona} onClick={() => !prov && setProv(r.zona)} className={`w-full text-left bg-white rounded-xl border border-black/10 p-3 ${!prov ? 'hover:border-brand/40' : 'cursor-default'}`}>
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <span className="text-sm font-medium truncate">{!prov && '▸ '}{r.zona}</span>
                  <span className="text-sm font-bold tabular-nums" style={{ color: esFrio ? '#2563eb' : '#c0392b' }}>
                    {esFact ? kAr(v) : v.toLocaleString('es-AR')}
                  </span>
                </div>
                <div className="h-2 bg-black/5 rounded-full overflow-hidden flex">
                  {esFact ? (
                    <>
                      <div className="h-full" style={{ width: `${b2bW}%`, background: '#c0392b' }} />
                      <div className="h-full" style={{ width: `${b2cW}%`, background: '#f59e0b' }} />
                    </>
                  ) : (
                    <div className="h-full rounded-full" style={{ width: `${pct}%`, background: esFrio ? '#3b82f6' : '#e0503a' }} />
                  )}
                </div>
                <p className="text-[10px] text-muted mt-1.5">
                  {r.clientes} clientes · {r.con_venta} con venta 2026 · {r.activos_90} activos 90d · {r.sin_contactar} sin contactar
                  {esFact && (Number(r.b2c_ars) > 0 || !prov) ? ` · B2B ${kAr(Number(r.b2b_ars))}${Number(r.b2c_ars) > 0 ? ` · B2C ${kAr(Number(r.b2c_ars))}` : ''}` : ''}
                </p>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
