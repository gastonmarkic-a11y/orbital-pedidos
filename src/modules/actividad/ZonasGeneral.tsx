import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'

// Panel general de zonas (admin / administración): los 3 vendedores juntos, con UN mapa de CABA + conurbano
// con los mismos colores por vendedor (barrios de CABA pintados por dueño, localidades del conurbano como
// manchas por cantidad de clientes) y todas las cabezas de zona marcadas. Sale de panel_zonas_general().

type ZonaG = { vendedor: string; micro_zona: string; area: string; n: number; activos: number; recuperar: number; prospectos: number; lat: number | null; lon: number | null }
type CabezaG = { vendedor: string; micro_zona: string; area: string; cod: string; sector: number; motivo: string; n_clientes: number | null; prioridad: number; lat: number | null; lon: number | null; nombre: string | null; proxima: string | null }
type VendG = {
  vendedor: string; clientes: number; activos: number; zonas: number; cabezas: number
  hoy_zona: string | null; hoy_checkin: boolean | null; visitas_hoy: number; visitas_periodo: number
  contactos_hoy: number; contactos_periodo: number; agendados: number; pop_periodo: number; dias_habiles: number
}
type Datos = { zonas: ZonaG[]; cabezas: CabezaG[]; vendedores: VendG[] }
type Feature = { properties: { nombre: string; lon?: number; lat?: number }; geometry: { type: 'Polygon' | 'MultiPolygon'; coordinates: number[][][] | number[][][][] } }

// punto dentro de polígono (ray casting) sobre el anillo exterior de cada parte
function enAnillo(r: number[][], x: number, y: number) {
  let ok = false
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i], [xj, yj] = r[j]
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) ok = !ok
  }
  return ok
}
function dentro(f: Feature, x: number, y: number) {
  return f.geometry.type === 'Polygon'
    ? enAnillo((f.geometry.coordinates as number[][][])[0], x, y)
    : (f.geometry.coordinates as number[][][][]).some((p) => enAnillo(p[0], x, y))
}

// Un color por vendedor, el mismo en CABA y en el conurbano.
export const COLOR_VENDEDOR: Record<string, string> = { Lola: '#7C3AED', Bruno: '#0284C7', Adrian: '#D97706' }
const NOMBRE: Record<string, string> = { Lola: 'Lola', Bruno: 'Bruno', Adrian: 'Adrián' }
const MOTIVO: Record<string, string> = { ancla: 'ancla', recuperar: 'a recuperar', prospecto: 'prospecto' }
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\./g, '').trim()
const ddmm = (f: string | null) => (f ? `${f.slice(8, 10)}/${f.slice(5, 7)}` : '')

// Encuadres del mapa (lon/lat): todo el AMBA, CABA y los tres corredores.
const VISTAS = {
  amba: { label: 'Todo', lon: [-59.25, -57.8], lat: [-35.1, -34.05] },
  caba: { label: 'CABA', lon: [-58.54, -58.33], lat: [-34.71, -34.52] },
  norte: { label: 'Norte / noroeste', lon: [-59.0, -58.45], lat: [-34.65, -34.3] },
  sur: { label: 'Sur / La Plata', lon: [-58.55, -57.85], lat: [-35.0, -34.62] },
} as const
type Vista = keyof typeof VISTAS
const W = 900

export default function ZonasGeneral() {
  const [d, setD] = useState<Datos | null>(null)
  const [geo, setGeo] = useState<Feature[]>([])
  const [partidos, setPartidos] = useState<Feature[]>([])
  const [error, setError] = useState<string | null>(null)
  const [vista, setVista] = useState<Vista>('amba')
  const [solo, setSolo] = useState('')
  const [sel, setSel] = useState<CabezaG | null>(null)
  const [orden, setOrden] = useState<'vendedor' | 'n' | 'recuperar'>('vendedor')

  useEffect(() => {
    supabase.rpc('panel_zonas_general').then(({ data, error }) => {
      if (error) setError(error.message)
      else setD(data as Datos)
    })
    fetch('/geo/caba-barrios.json').then((r) => r.json()).then((g) => setGeo(g.features ?? [])).catch(() => setGeo([]))
    // límites oficiales de los partidos del AMBA (IGN, vía datos.gob.ar)
    fetch('/geo/amba-partidos.json').then((r) => r.json()).then((g) => setPartidos(g.features ?? [])).catch(() => setPartidos([]))
  }, [])

  // dueño de cada partido: se ubica el centro de cada localidad del conurbano dentro de su partido
  // y gana el vendedor con más clientes sumados
  const duenoPartido = useMemo(() => {
    const m = new Map<string, { v: string; por: Record<string, number> }>()
    for (const z of d?.zonas ?? []) {
      if (z.area !== 'Conurbano' || z.lat == null || z.lon == null) continue
      // primero por nombre (la localidad que es cabecera del partido), si no por ubicación
      const f = partidos.find((p) => norm(p.properties.nombre) === norm(z.micro_zona)) ?? partidos.find((p) => dentro(p, z.lon!, z.lat!))
      if (!f) continue
      const o = m.get(f.properties.nombre) ?? { v: z.vendedor, por: {} }
      o.por[z.vendedor] = (o.por[z.vendedor] ?? 0) + z.n
      o.v = Object.entries(o.por).sort((a, b) => b[1] - a[1])[0][0]
      m.set(f.properties.nombre, o)
    }
    return m
  }, [d, partidos])

  // dueño de cada barrio de CABA: el vendedor con más clientes ahí
  const duenoBarrio = useMemo(() => {
    const m = new Map<string, { v: string; n: number }>()
    for (const z of d?.zonas ?? []) {
      if (z.area !== 'CABA') continue
      const k = norm(z.micro_zona)
      if (!m.has(k) || m.get(k)!.n < z.n) m.set(k, { v: z.vendedor, n: z.n })
    }
    return m
  }, [d])

  const v = VISTAS[vista]
  const kx = Math.cos((((v.lat[0] + v.lat[1]) / 2) * Math.PI) / 180)
  const H = Math.round((W * (v.lat[1] - v.lat[0])) / ((v.lon[1] - v.lon[0]) * kx))
  const px = (lon: number) => ((lon - v.lon[0]) / (v.lon[1] - v.lon[0])) * W
  const py = (lat: number) => ((v.lat[1] - lat) / (v.lat[1] - v.lat[0])) * H
  const escala = vista === 'caba' ? 2.2 : vista === 'amba' ? 1 : 1.5
  const ring = (r: number[][]) => r.map((p, i) => `${i ? 'L' : 'M'}${px(p[0]).toFixed(1)},${py(p[1]).toFixed(1)}`).join('') + 'Z'
  const pathDe = (f: Feature) =>
    f.geometry.type === 'Polygon'
      ? (f.geometry.coordinates as number[][][]).map(ring).join('')
      : (f.geometry.coordinates as number[][][][]).map((p) => p.map(ring).join('')).join('')

  const cabezas = (d?.cabezas ?? []).filter((k) => k.lat != null && k.lon != null)
  const atenua = (vend: string) => (solo && solo !== vend ? 0.15 : 1)

  const tabla = useMemo(() => {
    const cabPorZona = new Map<string, CabezaG[]>()
    for (const k of d?.cabezas ?? []) {
      const key = k.vendedor + '|' + k.micro_zona
      cabPorZona.set(key, [...(cabPorZona.get(key) ?? []), k])
    }
    return (d?.zonas ?? [])
      .filter((z) => !solo || z.vendedor === solo)
      .map((z) => ({ ...z, cabezas: cabPorZona.get(z.vendedor + '|' + z.micro_zona) ?? [] }))
      .sort((a, b) => orden === 'n' ? b.n - a.n : orden === 'recuperar' ? b.recuperar - a.recuperar
        : a.vendedor.localeCompare(b.vendedor) || b.cabezas.length - a.cabezas.length || b.n - a.n)
  }, [d, solo, orden])

  if (error) return <p className="text-sm text-red-600 p-4">No se pudo cargar el panel general: {error}</p>
  if (!d) return <p className="text-sm text-muted p-4">Cargando todas las zonas…</p>

  return (
    <div className="space-y-3">
      {/* resumen por vendedor */}
      <div className="grid md:grid-cols-3 gap-2">
        {d.vendedores.map((x) => {
          const metaV = x.dias_habiles * 5, metaC = x.dias_habiles * 25
          return (
            <button key={x.vendedor} onClick={() => setSolo(solo === x.vendedor ? '' : x.vendedor)}
              className={`text-left bg-white border rounded-xl p-3 space-y-1 ${solo === x.vendedor ? 'ring-2' : ''}`}
              style={{ borderColor: COLOR_VENDEDOR[x.vendedor], ['--tw-ring-color' as string]: COLOR_VENDEDOR[x.vendedor] + '55' }}>
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full" style={{ background: COLOR_VENDEDOR[x.vendedor] }} />
                <b>{NOMBRE[x.vendedor]}</b>
                <span className="ml-auto text-[11px] text-muted">{x.clientes} clientes · {x.activos} activos</span>
              </div>
              <p className="text-[11px] text-muted">{x.zonas} zonas · <b className="text-ink">{x.cabezas} cabezas</b> · hoy: {x.hoy_zona ?? '—'} {x.hoy_zona ? (x.hoy_checkin ? '✅' : '⏳ sin check-in') : ''}</p>
              <p className="text-[11px]">Visitas hoy <b>{x.visitas_hoy}/5</b> · desde 14/10 <b>{x.visitas_periodo}/{metaV}</b></p>
              <p className="text-[11px]">Contactos hoy <b>{x.contactos_hoy}/25</b> · desde 14/10 <b>{x.contactos_periodo}/{metaC}</b> · 📅 {x.agendados}</p>
              <p className="text-[11px]">POP instalados desde 14/10 <b>{x.pop_periodo}/{metaV}</b></p>
            </button>
          )
        })}
      </div>

      {/* mapa */}
      <div className="bg-white border border-black/10 rounded-xl p-2.5 space-y-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {(Object.keys(VISTAS) as Vista[]).map((k) => (
            <button key={k} onClick={() => setVista(k)}
              className={`text-[11px] rounded-full border px-2.5 py-1 ${vista === k ? 'border-brand text-brandDark font-semibold' : 'border-black/10 text-muted'}`}>{VISTAS[k].label}</button>
          ))}
          <span className="ml-auto flex items-center gap-3 text-[11px]">
            {Object.keys(COLOR_VENDEDOR).map((x) => (
              <button key={x} onClick={() => setSolo(solo === x ? '' : x)} className={`flex items-center gap-1 ${solo && solo !== x ? 'opacity-40' : ''}`}>
                <span className="w-3 h-3 rounded-sm" style={{ background: COLOR_VENDEDOR[x] }} />{NOMBRE[x]}
              </button>
            ))}
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-white border-2 border-ink" />cabeza de zona</span>
          </span>
        </div>
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto bg-[#F7F5F0] rounded-lg" onClick={() => setSel(null)}>
          {/* conurbano: cada partido pintado con el color del vendedor que tiene más clientes ahí */}
          {partidos.map((f) => {
            const p = duenoPartido.get(f.properties.nombre)
            const col = p ? COLOR_VENDEDOR[p.v] : '#cfcac0'
            const detalle = p ? Object.entries(p.por).sort((a, b) => b[1] - a[1]).map(([vv, n]) => `${NOMBRE[vv]} ${n}`).join(' · ') : 'sin clientes'
            return (
              <path key={'p' + f.properties.nombre} d={pathDe(f)} fill={col} fillOpacity={p ? 0.32 * atenua(p.v) : 0.35} stroke="#fff" strokeWidth={vista === 'amba' ? 1 : 1.5}>
                <title>{`${f.properties.nombre} · ${detalle}`}</title>
              </path>
            )
          })}
          {vista !== 'caba' && partidos.filter((f) => f.properties.lon != null).map((f) => {
            const x = px(f.properties.lon!), y = py(f.properties.lat!)
            if (x < 0 || x > W || y < 0 || y > H) return null
            return <text key={'pt' + f.properties.nombre} x={x} y={y} fontSize={vista === 'amba' ? 8 : 10} textAnchor="middle" fill="#44403c" fontWeight={600} pointerEvents="none">{f.properties.nombre}</text>
          })}
          {/* CABA: barrios pintados por dueño */}
          {geo.map((f) => {
            const due = duenoBarrio.get(norm(f.properties.nombre))
            const col = due ? COLOR_VENDEDOR[due.v] : '#cfcac0'
            return (
              <path key={f.properties.nombre} d={pathDe(f)} fill={col} fillOpacity={due ? 0.35 * atenua(due.v) : 0.4} stroke="#fff" strokeWidth={vista === 'caba' ? 1.5 : 0.6}>
                <title>{`${f.properties.nombre}${due ? ' · ' + NOMBRE[due.v] + ' · ' + due.n + ' clientes' : ' · sin clientes'}`}</title>
              </path>
            )
          })}
          {vista === 'caba' && geo.map((f) => {
            const pts = (f.geometry.type === 'Polygon' ? (f.geometry.coordinates as number[][][])[0] : (f.geometry.coordinates as number[][][][])[0][0])
            const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length, cy = pts.reduce((s, p) => s + p[1], 0) / pts.length
            return <text key={'t' + f.properties.nombre} x={px(cx)} y={py(cy)} fontSize={9} textAnchor="middle" fill="#57534e" pointerEvents="none">{f.properties.nombre}</text>
          })}
          {/* cabezas de zona */}
          {cabezas.map((k) => (
            <circle key={k.vendedor + k.cod} cx={px(k.lon!)} cy={py(k.lat!)} r={(k.sector === 1 ? 4.2 : 3.2) * Math.min(escala, 1.6)}
              fill="#fff" stroke={COLOR_VENDEDOR[k.vendedor]} strokeWidth={2.4} opacity={atenua(k.vendedor)} className="cursor-pointer"
              onClick={(e) => { e.stopPropagation(); setSel(k) }}>
              <title>{`🎯 ${k.nombre} · ${k.micro_zona}${k.sector > 1 ? ' (sector ' + k.sector + ')' : ''} · ${NOMBRE[k.vendedor]} · ${MOTIVO[k.motivo] ?? k.motivo}${k.proxima ? ' · próxima ' + ddmm(k.proxima) : ''}`}</title>
            </circle>
          ))}
        </svg>
        {sel && (
          <div className="text-[12px] rounded-lg border px-3 py-2" style={{ borderColor: COLOR_VENDEDOR[sel.vendedor] }}>
            🎯 <b>{sel.nombre}</b> <span className="text-faint">· {sel.cod}</span> — {sel.micro_zona}{sel.sector > 1 ? ` (sector ${sel.sector})` : ''} · {NOMBRE[sel.vendedor]} · {MOTIVO[sel.motivo] ?? sel.motivo}
            {sel.n_clientes ? ` · ${sel.n_clientes} clientes cerca` : ''}{sel.proxima ? ` · próxima visita ${ddmm(sel.proxima)}` : ' · sin fecha en el plan'}
          </div>
        )}
        <p className="text-[10px] text-faint">Barrios de CABA y partidos del conurbano pintados con el color del vendedor que tiene más clientes ahí (pasá el mouse para ver el reparto). Los círculos blancos son las cabezas de zona (más grandes = sector 1). Tocá uno para ver el detalle.</p>
      </div>

      {/* todas las zonas */}
      <div className="bg-white border border-black/10 rounded-xl p-2.5 overflow-x-auto">
        <div className="flex items-center gap-2 mb-1">
          <p className="text-[12px] font-semibold">Todas las zonas ({tabla.length}){solo ? ` de ${NOMBRE[solo]}` : ''}</p>
          <span className="ml-auto text-[10px] text-faint">Ordenar:</span>
          {([['vendedor', 'vendedor'], ['n', 'clientes'], ['recuperar', 'a recuperar']] as const).map(([k, l]) => (
            <button key={k} onClick={() => setOrden(k)} className={`text-[11px] ${orden === k ? 'text-brandDark font-semibold' : 'text-muted'}`}>{l}</button>
          ))}
        </div>
        <table className="w-full text-[12px]">
          <thead><tr className="text-[10px] uppercase text-faint text-left"><th className="py-1 pr-2">Zona</th><th className="pr-2">Vendedor</th><th className="pr-2 text-right">Clientes</th><th className="pr-2 text-right">Activos</th><th className="pr-2 text-right">A recuperar</th><th className="pr-2 text-right">Prospectos</th><th>Cabezas de zona</th></tr></thead>
          <tbody>
            {tabla.map((z) => (
              <tr key={z.vendedor + z.micro_zona} className="border-t border-black/5 align-top">
                <td className="py-1 pr-2 whitespace-nowrap">{z.micro_zona} <span className="text-faint text-[10px]">{z.area}</span></td>
                <td className="pr-2 whitespace-nowrap"><span className="inline-block w-2 h-2 rounded-full mr-1" style={{ background: COLOR_VENDEDOR[z.vendedor] }} />{NOMBRE[z.vendedor]}</td>
                <td className="pr-2 text-right tabular-nums">{z.n}</td>
                <td className="pr-2 text-right tabular-nums">{z.activos}</td>
                <td className="pr-2 text-right tabular-nums">{z.recuperar || ''}</td>
                <td className="pr-2 text-right tabular-nums">{z.prospectos || ''}</td>
                <td className="text-muted">{z.cabezas.length ? z.cabezas.map((k) => `🎯 ${k.nombre}${k.proxima ? ' (' + ddmm(k.proxima) + ')' : ''}`).join(' · ') : <span className="text-faint">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
