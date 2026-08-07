import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'

// Mapa de zonas por FACTURACIÓN REAL 2026 (Tango B2B + Shopify B2C).
// Niveles: Provincias → (Ciudades solo en CABA/Buenos Aires/Santa Fe) → Clientes (con su actividad).

interface ZonaRow { zona: string; clientes: number; con_venta: number; activos_90: number; sin_contactar: number; b2b_ars: number; b2c_ars: number }
interface CliRow { cod: string; nombre: string | null; localidad: string | null; vendedor: string | null; b2b_ars: number; ultima_actividad: string | null }
type Metric = 'facturacion' | 'clientes' | 'frio'

const METRICAS: { k: Metric; label: string }[] = [
  { k: 'facturacion', label: '💰 Facturación 2026' },
  { k: 'clientes', label: '👥 Clientes' },
  { k: 'frio', label: '❄ Sin contactar' },
]
const kAr = (n: number) => '$' + Math.round(n).toLocaleString('es-AR')
const DRILL = new Set(['CABA', 'Buenos Aires', 'Santa Fe']) // solo estas se abren por ciudad
const NOMBRE_OP: Record<string, string> = { Marketing: 'Luna', ProspeccionVenta: 'Damián', Damian: 'Damián', Adrian: 'Adrián', Martin: 'Martín', Corporativo: 'Corporativo' }
function diasDesde(f: string | null): number | null { if (!f) return null; const d = new Date(f + 'T00:00:00'); if (isNaN(d.getTime())) return null; return Math.floor((Date.now() - d.getTime()) / 86400000) }

export default function MapaZonas() {
  const [prov, setProv] = useState<string | null>(null)
  const [loc, setLoc] = useState<string | null>(null)
  const [verCli, setVerCli] = useState(false)
  const [zonaRows, setZonaRows] = useState<ZonaRow[]>([])
  const [cliRows, setCliRows] = useState<CliRow[]>([])
  const [loading, setLoading] = useState(true)
  const [metric, setMetric] = useState<Metric>('facturacion')

  useEffect(() => {
    setLoading(true)
    if (verCli) {
      supabase.rpc('zonas_clientes', { p_provincia: prov, p_localidad: loc }).then(({ data, error }) => {
        setCliRows(error ? [] : ((data as CliRow[]) ?? [])); setLoading(false)
      })
    } else {
      supabase.rpc('zonas_facturacion', { p_provincia: prov }).then(({ data, error }) => {
        setZonaRows(error ? [] : ((data as ZonaRow[]) ?? [])); setLoading(false)
      })
    }
  }, [prov, loc, verCli])

  const total = (r: ZonaRow) => Number(r.b2b_ars) + Number(r.b2c_ars)
  const valor = (r: ZonaRow) => (metric === 'facturacion' ? total(r) : metric === 'clientes' ? r.clientes : r.sin_contactar)
  const ordenadas = [...zonaRows].sort((a, b) => valor(b) - valor(a))
  const max = Math.max(1, ...ordenadas.map(valor))
  const esFrio = metric === 'frio'
  const esFact = metric === 'facturacion'

  function volver() {
    if (verCli && loc) { setVerCli(false); setLoc(null) }        // clientes de ciudad → ciudades
    else if (verCli) { setVerCli(false); setProv(null) }          // clientes de provincia → provincias
    else { setProv(null); setLoc(null) }                          // ciudades → provincias
  }
  function tapZona(z: string) {
    if (!prov) { if (DRILL.has(z)) setProv(z); else { setProv(z); setVerCli(true) } } // provincia
    else { setLoc(z); setVerCli(true) }                                               // ciudad → clientes
  }

  const titulo = verCli ? `Clientes de ${loc || prov}` : prov ? `Ciudades de ${prov}` : 'Provincias'

  return (
    <div className="space-y-3 text-ink">
      <div className="flex items-center gap-2 flex-wrap">
        <h2 className="text-base font-semibold">🗺 Mapa de zonas</h2>
        {(prov || verCli) && <button onClick={volver} className="text-xs text-brandDark font-medium">← Volver</button>}
      </div>
      <p className="text-[11px] text-faint -mt-1">
        {titulo} · facturación real 2026 (Tango + Shopify).{' '}
        {!prov && !verCli ? 'Tocá CABA, Buenos Aires o Santa Fe para ver ciudades; el resto abre directo los clientes.' : verCli ? 'Detalle de cada cliente y su última actividad.' : 'Tocá una ciudad para ver sus clientes.'}
      </p>

      {!verCli && (
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
      )}

      {loading ? (
        <p className="text-sm text-muted p-2">Cargando...</p>
      ) : verCli ? (
        /* ---- Clientes de la zona ---- */
        <div className="space-y-1.5">
          <p className="text-[11px] text-faint">{cliRows.length} cliente{cliRows.length !== 1 ? 's' : ''}</p>
          {cliRows.map((c) => {
            const d = diasDesde(c.ultima_actividad)
            return (
              <div key={c.cod} className="bg-white rounded-xl border border-black/10 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium truncate">{c.nombre || c.cod}</span>
                  <span className="text-sm font-bold tabular-nums" style={{ color: c.b2b_ars > 0 ? '#c0392b' : '#9ca3af' }}>{kAr(c.b2b_ars)}</span>
                </div>
                <p className="text-[10px] text-muted mt-0.5">
                  {c.cod}{c.localidad ? ` · ${c.localidad}` : ''}{c.vendedor ? ` · ${NOMBRE_OP[c.vendedor] || c.vendedor}` : ''} ·{' '}
                  {d === null ? <span className="text-red-600 font-medium">sin contactar</span> : d === 0 ? <span className="text-emerald-600">actividad hoy</span> : <span className={d <= 21 ? 'text-amber-600' : 'text-red-600'}>hace {d}d</span>}
                </p>
              </div>
            )
          })}
          {cliRows.length === 0 && <p className="text-sm text-faint text-center py-8 bg-white rounded-xl border border-black/10">Sin clientes en esta zona.</p>}
        </div>
      ) : ordenadas.length === 0 ? (
        <p className="text-sm text-faint text-center py-8 bg-white rounded-xl border border-black/10">Sin datos.</p>
      ) : (
        /* ---- Zonas (provincias o ciudades) ---- */
        <div className="space-y-1.5">
          {ordenadas.map((r) => {
            const v = valor(r)
            const pct = (v / max) * 100
            const b2bW = esFact && total(r) > 0 ? (Number(r.b2b_ars) / total(r)) * pct : pct
            const b2cW = esFact && total(r) > 0 ? (Number(r.b2c_ars) / total(r)) * pct : 0
            const abre = !prov ? (DRILL.has(r.zona) ? 'ciudad' : 'cli') : 'cli'
            return (
              <button key={r.zona} onClick={() => tapZona(r.zona)} className="w-full text-left bg-white rounded-xl border border-black/10 p-3 hover:border-brand/40 cursor-pointer">
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <span className="text-sm font-medium truncate">▸ {r.zona}</span>
                  <span className="text-sm font-bold tabular-nums" style={{ color: esFrio ? '#2563eb' : '#c0392b' }}>{esFact ? kAr(v) : v.toLocaleString('es-AR')}</span>
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
                  {r.clientes} clientes · {r.con_venta} con venta 2026 · {r.sin_contactar} sin contactar
                  {esFact ? ` · B2B ${kAr(Number(r.b2b_ars))}${Number(r.b2c_ars) > 0 ? ` · B2C ${kAr(Number(r.b2c_ars))}` : ''}` : ''}
                  {abre === 'cli' ? ' · tocá para ver los clientes' : ' · tocá para ver ciudades'}
                </p>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
