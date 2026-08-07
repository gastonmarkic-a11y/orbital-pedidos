import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'

// Selector de TERRITORIOS (sin mapa): Región → Provincia → Clientes, con tarjetas.
// Nivel 1 (regiones): CABA · AMBA Norte/Sur/Oeste · Interior Bs As · NOA · NEA · CUYO · CENTRO · Patagonia.
// Datos reales 2026 (Tango B2B + Shopify B2C), igual que el resto del sistema.

interface ZonaRow { zona: string; clientes: number; con_venta: number; sin_contactar: number; b2b_ars: number; b2c_ars: number }
interface CliRow { cod: string; nombre: string | null; provincia: string | null; localidad: string | null; vendedor: string | null; b2b_ars: number; ultima_actividad: string | null }
type Metric = 'facturacion' | 'clientes' | 'frio'

const METRICAS: { k: Metric; label: string }[] = [
  { k: 'facturacion', label: '💰 Facturación 2026' },
  { k: 'clientes', label: '👥 Clientes' },
  { k: 'frio', label: '❄ Sin contactar' },
]
// Regiones con provincias adentro (se abren a provincias); el resto abre directo a clientes.
const MULTIPROV: Record<string, number> = { NOA: 5, NEA: 4, CUYO: 3, CENTRO: 3, Patagonia: 6 }
const kAr = (n: number) => '$' + Math.round(n).toLocaleString('es-AR')
const NOMBRE_OP: Record<string, string> = { Marketing: 'Luna', ProspeccionVenta: 'Damián', Damian: 'Damián', Adrian: 'Adrián', Martin: 'Martín', Corporativo: 'Corporativo' }
function dias(f: string | null): number | null { if (!f) return null; const d = new Date(f + 'T00:00:00'); if (isNaN(d.getTime())) return null; return Math.floor((Date.now() - d.getTime()) / 86400000) }

// Tarjeta de zona (región o provincia). Reutilizable; con slots para KPIs futuros.
function ZonaCard({ r, subtitulo, metric, onClick }: { r: ZonaRow; subtitulo: string; metric: Metric; onClick: () => void }) {
  const totFact = Number(r.b2b_ars) + Number(r.b2c_ars)
  const val = metric === 'facturacion' ? kAr(totFact) : metric === 'clientes' ? r.clientes.toLocaleString('es-AR') : r.sin_contactar.toLocaleString('es-AR')
  const pctB2b = totFact > 0 ? (Number(r.b2b_ars) / totFact) * 100 : 100
  return (
    <button onClick={onClick} className="text-left bg-white rounded-xl border border-black/10 p-4 w-full transition hover:border-brand/40">
      <p className="text-sm font-semibold text-ink">{r.zona}</p>
      <p className="text-[11px] text-faint">{subtitulo}</p>
      <p className="text-xl font-bold mt-2 leading-none" style={{ color: metric === 'frio' ? '#2563eb' : '#8F6A34' }}>{val}</p>
      {metric === 'facturacion' && totFact > 0 && (
        <div className="h-1.5 bg-black/5 rounded-full overflow-hidden flex mt-2">
          <div className="h-full" style={{ width: `${pctB2b}%`, background: '#c0392b' }} />
          <div className="h-full" style={{ width: `${100 - pctB2b}%`, background: '#f59e0b' }} />
        </div>
      )}
      <p className="text-[10px] text-muted mt-1.5">
        {r.clientes} clientes · {r.con_venta} con venta 2026
        {metric === 'facturacion' && Number(r.b2c_ars) > 0 ? ` · B2B ${kAr(Number(r.b2b_ars))} · B2C ${kAr(Number(r.b2c_ars))}` : ''}
      </p>
    </button>
  )
}

export default function Territorios() {
  const [region, setRegion] = useState<string | null>(null)
  const [prov, setProv] = useState<string | null>(null)
  const [verCli, setVerCli] = useState(false)
  const [zonaRows, setZonaRows] = useState<ZonaRow[]>([])
  const [cliRows, setCliRows] = useState<CliRow[]>([])
  const [loading, setLoading] = useState(true)
  const [metric, setMetric] = useState<Metric>('facturacion')

  useEffect(() => {
    setLoading(true)
    if (verCli) {
      supabase.rpc('mapa_clientes', { p_region: region, p_provincia: prov }).then(({ data, error }) => { setCliRows(error ? [] : ((data as CliRow[]) ?? [])); setLoading(false) })
    } else {
      supabase.rpc('mapa_zonas', { p_region: region }).then(({ data, error }) => { setZonaRows(error ? [] : ((data as ZonaRow[]) ?? [])); setLoading(false) })
    }
  }, [region, prov, verCli])

  const val = (r: ZonaRow) => (metric === 'facturacion' ? Number(r.b2b_ars) + Number(r.b2c_ars) : metric === 'clientes' ? r.clientes : r.sin_contactar)
  const ordenadas = [...zonaRows].sort((a, b) => val(b) - val(a))

  function volver() {
    if (verCli && prov) { setVerCli(false); setProv(null) }
    else if (verCli) { setVerCli(false); setRegion(null) }
    else { setRegion(null); setProv(null) }
  }
  function tapZona(z: string) {
    if (!region) { if (MULTIPROV[z]) setRegion(z); else { setRegion(z); setVerCli(true) } }
    else { setProv(z); setVerCli(true) }
  }
  const subtitulo = (z: string) => !region ? (MULTIPROV[z] ? `${MULTIPROV[z]} provincias` : z === 'CABA' ? '1 territorio' : 'zona') : 'provincia'

  return (
    <div className="space-y-4 text-ink">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 text-sm flex-wrap">
        <button onClick={() => { setRegion(null); setProv(null); setVerCli(false) }} className={`font-medium ${region ? 'text-brandDark' : 'text-ink'}`}>🗺 Territorios</button>
        {region && (<><span className="text-faint">›</span><button onClick={() => { setProv(null); setVerCli(MULTIPROV[region] ? false : true) }} className={`font-medium ${prov ? 'text-brandDark' : 'text-ink'}`}>{region}</button></>)}
        {prov && (<><span className="text-faint">›</span><span className="text-ink font-medium">{prov}</span></>)}
        {(region || verCli) && <button onClick={volver} className="ml-2 text-xs text-brandDark font-medium">← Volver</button>}
      </div>

      {!verCli && (
        <div className="flex gap-1.5 flex-wrap items-center">
          {METRICAS.map((m) => (
            <button key={m.k} onClick={() => setMetric(m.k)} className={`text-[11px] rounded-full px-3 py-1.5 border font-medium ${metric === m.k ? 'bg-brand text-white border-brand' : 'border-black/10 text-muted'}`}>{m.label}</button>
          ))}
          {metric === 'facturacion' && (
            <span className="flex items-center gap-3 text-[10px] text-muted ml-1">
              <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-sm bg-[#c0392b]" />B2B mayorista</span>
              <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-sm bg-amber-500" />B2C e-commerce</span>
            </span>
          )}
        </div>
      )}
      <p className="text-[11px] text-faint -mt-1">
        {verCli ? `Clientes de ${prov || region} — detalle y última actividad.` : region ? `Provincias de ${region} — tocá una para ver clientes.` : 'Elegí una región. CABA/AMBA/Interior abren clientes; NOA/NEA/CUYO/CENTRO/Patagonia abren provincias.'}
      </p>

      {loading ? (
        <p className="text-sm text-muted p-2">Cargando…</p>
      ) : verCli ? (
        <div className="space-y-1.5">
          <p className="text-[11px] text-faint">{cliRows.length} cliente{cliRows.length !== 1 ? 's' : ''}</p>
          {cliRows.map((c) => {
            const d = dias(c.ultima_actividad)
            return (
              <div key={c.cod} className="bg-white rounded-xl border border-black/10 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium truncate">{c.nombre || c.cod}</span>
                  <span className="text-sm font-bold tabular-nums" style={{ color: c.b2b_ars > 0 ? '#8F6A34' : '#9ca3af' }}>{kAr(c.b2b_ars)}</span>
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
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
          {ordenadas.map((r) => <ZonaCard key={r.zona} r={r} subtitulo={subtitulo(r.zona)} metric={metric} onClick={() => tapZona(r.zona)} />)}
        </div>
      )}
    </div>
  )
}
