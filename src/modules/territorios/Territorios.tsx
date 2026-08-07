import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { TERRITORIOS, PROVINCIAS_MAPEADAS, Territorio } from '../../lib/territorios'

// Selector de TERRITORIOS: Región → Provincia → Clientes. Sin mapa geográfico.
// KPIs reales 2026 (Tango B2B + Shopify B2C); campos extra quedan preparados para futuro.

interface ProvRow { provincia: string; clientes: number; con_venta: number; sin_contactar: number; b2b_ars: number; b2c_ars: number }
interface CliRow { cod: string; nombre: string | null; localidad: string | null; vendedor: string | null; b2b_ars: number; ultima_actividad: string | null }

const kAr = (n: number) => '$' + Math.round(n).toLocaleString('es-AR')
const NOMBRE_OP: Record<string, string> = { Marketing: 'Luna', ProspeccionVenta: 'Damián', Damian: 'Damián', Adrian: 'Adrián', Martin: 'Martín', Corporativo: 'Corporativo' }
function dias(f: string | null): number | null { if (!f) return null; const d = new Date(f + 'T00:00:00'); if (isNaN(d.getTime())) return null; return Math.floor((Date.now() - d.getTime()) / 86400000) }
const VACIO: ProvRow = { provincia: '', clientes: 0, con_venta: 0, sin_contactar: 0, b2b_ars: 0, b2c_ars: 0 }

// Tarjeta de región (bloque seleccionable del primer nivel).
function RegionCard({ t, r, sel, onClick }: { t: Territorio; r: ProvRow; sel: boolean; onClick: () => void }) {
  const n = t.provincias.length
  return (
    <button
      onClick={onClick}
      className={`text-left bg-white rounded-xl border p-4 transition w-full ${sel ? 'border-brand ring-2 ring-brand/30' : 'border-black/10 hover:border-brand/40'}`}
    >
      <p className="text-sm font-semibold tracking-wide text-ink">{t.region}</p>
      <p className="text-[11px] text-faint">{t.unico ? '1 territorio' : `${n} provincias`}</p>
      <p className="text-xl font-bold text-brandDark mt-2 leading-none">{kAr(r.b2b_ars + r.b2c_ars)}</p>
      <p className="text-[10px] text-muted mt-1">{r.clientes} clientes · {r.con_venta} con venta 2026</p>
    </button>
  )
}

// Tarjeta de provincia (nivel intermedio). Reutilizable; con slots para KPIs futuros.
function ProvinceCard({ nombre, r, onClick }: { nombre: string; r: ProvRow; onClick: () => void }) {
  return (
    <button onClick={onClick} className="text-left bg-white rounded-xl border border-black/10 p-4 transition w-full hover:border-brand/40">
      <p className="text-sm font-semibold text-ink">{nombre}</p>
      <p className="text-xl font-bold text-brandDark mt-1.5 leading-none">{kAr(r.b2b_ars + r.b2c_ars)}</p>
      <div className="mt-2 space-y-0.5 text-[11px] text-muted">
        <p>{r.clientes} clientes · {r.con_venta} con venta 2026</p>
        {r.b2c_ars > 0 && <p>B2B {kAr(r.b2b_ars)} · B2C {kAr(r.b2c_ars)}</p>}
        {r.sin_contactar > 0 && <p className="text-faint">{r.sin_contactar} sin contactar</p>}
        {/* Campos preparados para futura integración (objetivo, cobertura, vendedor):
            no se muestran hasta que existan datos. */}
      </div>
    </button>
  )
}

export default function Territorios() {
  const [resumen, setResumen] = useState<Record<string, ProvRow>>({})
  const [loading, setLoading] = useState(true)
  const [region, setRegion] = useState<Territorio | null>(null)
  const [provincia, setProvincia] = useState<string | null>(null)
  const [clientes, setClientes] = useState<CliRow[]>([])
  const [loadCli, setLoadCli] = useState(false)

  useEffect(() => {
    supabase.rpc('provincia_resumen').then(({ data }) => {
      const map: Record<string, ProvRow> = {}
      for (const r of (data as ProvRow[]) ?? []) map[r.provincia] = r
      setResumen(map)
      setLoading(false)
    })
  }, [])

  useEffect(() => {
    if (!provincia) return
    setLoadCli(true)
    supabase.rpc('clientes_provincia', { p_provincia: provincia }).then(({ data }) => {
      setClientes((data as CliRow[]) ?? [])
      setLoadCli(false)
    })
  }, [provincia])

  const rProv = (p: string) => resumen[p] ?? { ...VACIO, provincia: p }
  const rRegion = (t: Territorio): ProvRow =>
    t.provincias.reduce((a, p) => {
      const r = rProv(p)
      return { ...a, clientes: a.clientes + r.clientes, con_venta: a.con_venta + r.con_venta, sin_contactar: a.sin_contactar + r.sin_contactar, b2b_ars: a.b2b_ars + r.b2b_ars, b2c_ars: a.b2c_ars + r.b2c_ars }
    }, { ...VACIO })

  // "Otros" = provincias con datos que no están en ninguna región (ej. La Rioja, exterior, sin provincia).
  const otras = useMemo(() => Object.values(resumen).filter((r) => !PROVINCIAS_MAPEADAS.has(r.provincia)), [resumen])
  const otrasTerr: Territorio | null = otras.length ? { region: 'OTROS', provincias: otras.map((o) => o.provincia) } : null

  function abrirRegion(t: Territorio) {
    setRegion(t)
    if (t.unico) setProvincia(t.provincias[0])
    else setProvincia(null)
  }
  function volver() {
    if (provincia && region && !region.unico) setProvincia(null) // clientes → provincias
    else { setRegion(null); setProvincia(null) } // provincias/clientes(único) → regiones
  }

  const regionesOrden = useMemo(() => {
    const base = [...TERRITORIOS]
    if (otrasTerr) base.push(otrasTerr)
    return base
  }, [otrasTerr])

  if (loading) return <p className="text-sm text-muted p-4">Cargando territorios…</p>

  return (
    <div className="space-y-4 text-ink">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 text-sm flex-wrap">
        <button onClick={() => { setRegion(null); setProvincia(null) }} className={`font-medium ${region ? 'text-brandDark' : 'text-ink'}`}>🗺 Territorios</button>
        {region && (<><span className="text-faint">›</span><button onClick={() => region.unico ? undefined : setProvincia(null)} className={`font-medium ${provincia && !region.unico ? 'text-brandDark' : 'text-ink'}`}>{region.region}</button></>)}
        {provincia && !region?.unico && (<><span className="text-faint">›</span><span className="text-ink font-medium">{provincia}</span></>)}
        {(region || provincia) && <button onClick={volver} className="ml-2 text-xs text-brandDark font-medium">← Volver</button>}
      </div>

      {/* NIVEL 1 — Regiones */}
      {!region && (
        <>
          <p className="text-[11px] text-faint -mt-2">Elegí una región. Facturación real 2026 (Tango + Shopify).</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
            {regionesOrden.map((t) => (
              <RegionCard key={t.region} t={t} r={rRegion(t)} sel={false} onClick={() => abrirRegion(t)} />
            ))}
          </div>
        </>
      )}

      {/* NIVEL 2 — Provincias de la región */}
      {region && !provincia && !region.unico && (
        <>
          <p className="text-[11px] text-faint -mt-2">Provincias de {region.region} — tocá una para ver sus clientes.</p>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2.5">
            {region.provincias.map((p) => (
              <ProvinceCard key={p} nombre={p} r={rProv(p)} onClick={() => setProvincia(p)} />
            ))}
          </div>
        </>
      )}

      {/* NIVEL 3 — Clientes de la provincia */}
      {provincia && (
        <div className="space-y-1.5">
          <p className="text-[11px] text-faint -mt-2">{loadCli ? 'Cargando…' : `${clientes.length} cliente${clientes.length !== 1 ? 's' : ''} en ${provincia}`}</p>
          {clientes.map((c) => {
            const d = dias(c.ultima_actividad)
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
          {!loadCli && clientes.length === 0 && <p className="text-sm text-faint text-center py-8 bg-white rounded-xl border border-black/10">Sin clientes en esta provincia.</p>}
        </div>
      )}
    </div>
  )
}
