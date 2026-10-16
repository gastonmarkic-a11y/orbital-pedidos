import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'
import TelefonoAcciones from '../../lib/TelefonoAcciones'

// Panel "Zonas": por vendedor, cada barrio (CABA) / localidad (conurbano / interior) con su CABEZA DE ZONA,
// los días del plan en que le toca y TODOS los clientes de la zona. Sale de panel_zonas():
// el vendedor ve solo lo suyo; admin y administración eligen el vendedor.

type Cliente = {
  cod: string
  nombre: string | null
  area: string
  micro_zona: string
  estado: string
  nivel: string | null
  u12: number | null
  u_mejor: number | null
  ult_mes: string | null
  prioridad: number | null
  puntaje: number | null
  oportunidad: string | null
  direccion: string | null
  tel: string | null
}
type Cabeza = {
  micro_zona: string
  area: string
  cod: string
  motivo: 'ancla' | 'recuperar' | 'prospecto'
  prioridad: number
  nombre: string | null
  plan: string[] | null
}
type Zona = { zona: string; area: string; cabeza: Cabeza | null; clientes: Cliente[]; peso: number }

const VENDEDORES = [
  { cod: 'Lola', label: 'Lola' },
  { cod: 'Bruno', label: 'Bruno' },
  { cod: 'Adrian', label: 'Adrián' },
]
const MOTIVO: Record<string, string> = { ancla: 'ancla', recuperar: 'a recuperar', prospecto: 'prospecto' }
const ESTADO_ORDEN: Record<string, number> = { Activo: 0, 'En caída': 1, 'Perdido reciente': 2, Perdido: 3, Histórico: 4, 'Nunca compró': 5 }
const ESTADO_ESTILO: Record<string, string> = {
  Activo: 'bg-emerald-100 text-emerald-800',
  'En caída': 'bg-orange-100 text-orange-800',
  'Perdido reciente': 'bg-red-100 text-red-700',
  Perdido: 'bg-red-50 text-red-600',
  Histórico: 'bg-black/5 text-muted',
  'Nunca compró': 'bg-sky-50 text-sky-700',
}
const DIA = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb']
const n0 = (v: number | null | undefined) => Math.round(Number(v ?? 0))
const mes = (m: string | null) => (m ? `${m.slice(5, 7)}/${m.slice(2, 4)}` : '—')
const fechaCorta = (f: string) => {
  const d = new Date(f + 'T12:00:00')
  return `${DIA[d.getDay()]} ${f.slice(8, 10)}/${f.slice(5, 7)}`
}
const esProspectoFuerte = (c: Cliente) => n0(c.puntaje) >= 45

function ordenarClientes(cs: Cliente[], cabeza: string | undefined) {
  return [...cs].sort((a, b) => {
    if (a.cod === cabeza) return -1
    if (b.cod === cabeza) return 1
    const ea = ESTADO_ORDEN[a.estado] ?? 9, eb = ESTADO_ORDEN[b.estado] ?? 9
    if (ea !== eb) return ea - eb
    if (a.estado === 'Activo') return n0(b.u12) - n0(a.u12)
    if (a.estado === 'Nunca compró' || a.estado === 'Histórico') return n0(b.puntaje) - n0(a.puntaje)
    return n0(b.prioridad) - n0(a.prioridad)
  })
}

export default function ZonasPanel() {
  const { rolEfectivo, codigoEfectivo } = useAuth()
  const esSupervisor = rolEfectivo === 'admin' || rolEfectivo === 'administracion'
  const [ven, setVen] = useState<string>(VENDEDORES.some((v) => v.cod === codigoEfectivo) ? (codigoEfectivo as string) : 'Lola')
  const [clientes, setClientes] = useState<Cliente[]>([])
  const [cabezas, setCabezas] = useState<Cabeza[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [areaF, setAreaF] = useState('')
  const [soloCabeza, setSoloCabeza] = useState(false)
  const [busqueda, setBusqueda] = useState('')
  const [abierta, setAbierta] = useState<string | null>(null)
  const [verTodos, setVerTodos] = useState<Set<string>>(new Set())

  useEffect(() => {
    setLoading(true)
    setError(null)
    supabase.rpc('panel_zonas', { p_vendedor: ven }).then(({ data, error }) => {
      if (error) { setError(error.message); setLoading(false); return }
      const d = data as { clientes: Cliente[]; cabezas: Cabeza[] }
      setClientes(d?.clientes ?? [])
      setCabezas(d?.cabezas ?? [])
      setLoading(false)
    })
  }, [ven])

  const zonas = useMemo(() => {
    const m = new Map<string, Zona>()
    const get = (zona: string, area: string) => {
      if (!m.has(zona)) m.set(zona, { zona, area, cabeza: null, clientes: [], peso: 0 })
      return m.get(zona)!
    }
    for (const c of clientes) get(c.micro_zona, c.area).clientes.push(c)
    for (const k of cabezas) { const z = get(k.micro_zona, k.area); z.cabeza = k; z.peso = k.prioridad }
    for (const z of m.values()) {
      if (!z.cabeza) z.peso = z.clientes.reduce((s, c) => s + (c.estado === 'Activo' ? Math.max(0, n0(c.u12)) : 0), 0)
      z.clientes = ordenarClientes(z.clientes, z.cabeza?.cod)
    }
    // primero las zonas con cabeza (por lo que hay en juego), después el resto
    return [...m.values()].sort((a, b) => Number(!!b.cabeza) - Number(!!a.cabeza) || b.peso - a.peso || b.clientes.length - a.clientes.length)
  }, [clientes, cabezas])

  const areas = useMemo(() => [...new Set(zonas.map((z) => z.area))].sort(), [zonas])
  const visibles = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    return zonas.filter((z) => {
      if (areaF && z.area !== areaF) return false
      if (soloCabeza && !z.cabeza) return false
      if (!q) return true
      return z.zona.toLowerCase().includes(q) || z.clientes.some((c) => (c.nombre || '').toLowerCase().includes(q) || c.cod.toLowerCase().includes(q))
    })
  }, [zonas, areaF, soloCabeza, busqueda])

  const cuenta = (cs: Cliente[], e: string) => cs.filter((c) => c.estado === e).length

  return (
    <div className="space-y-3 text-ink">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h1 className="text-lg font-bold">Zonas</h1>
          <p className="text-xs text-muted">Cada barrio / localidad con su cabeza de zona, los días que le tocan y todos sus clientes</p>
        </div>
        {esSupervisor && (
          <div className="flex gap-1 bg-white border border-black/10 rounded-lg p-0.5">
            {VENDEDORES.map((v) => (
              <button key={v.cod} onClick={() => { setVen(v.cod); setAbierta(null) }}
                className={`text-xs px-3 py-1.5 rounded-md font-medium ${ven === v.cod ? 'bg-brand text-white' : 'text-muted'}`}>{v.label}</button>
            ))}
          </div>
        )}
      </div>

      {loading ? <p className="text-sm text-muted p-4">Cargando zonas…</p> : error ? <p className="text-sm text-red-600 p-4">No se pudieron cargar las zonas: {error}</p> : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {[
              { l: 'Zonas', v: zonas.length, s: `${zonas.filter((z) => z.cabeza).length} con cabeza de zona` },
              { l: 'Clientes', v: clientes.length, s: `${cuenta(clientes, 'Activo')} activos` },
              { l: 'A recuperar', v: cuenta(clientes, 'En caída') + cuenta(clientes, 'Perdido reciente') + cuenta(clientes, 'Perdido'), s: 'en caída o perdidos' },
              { l: 'Prospectos fuertes', v: clientes.filter(esProspectoFuerte).length, s: '45+ puntos' },
            ].map((k) => (
              <div key={k.l} className="bg-white border border-black/10 rounded-xl p-3">
                <p className="text-[10px] text-muted uppercase font-semibold tracking-wide mb-1">{k.l}</p>
                <p className="text-2xl font-bold tabular-nums">{k.v}</p>
                <p className="text-[10px] text-faint mt-0.5">{k.s}</p>
              </div>
            ))}
          </div>

          <div className="bg-white rounded-xl border border-black/10 p-2.5 space-y-2">
            <div className="flex flex-wrap gap-1.5 items-center">
              <span className="text-[10px] text-faint uppercase tracking-wide mr-1">Área</span>
              {['', ...areas].map((a) => (
                <button key={a || 'todas'} onClick={() => setAreaF(a)}
                  className={`text-[11px] rounded-full border px-2.5 py-1 ${areaF === a ? 'border-brand text-brandDark font-semibold' : 'border-black/10 text-muted'}`}>{a || 'Todas'}</button>
              ))}
              <button onClick={() => setSoloCabeza((v) => !v)}
                className={`text-[11px] rounded-full border px-2.5 py-1 ml-2 ${soloCabeza ? 'border-brand text-brandDark font-semibold' : 'border-black/10 text-muted'}`}>🎯 Solo con cabeza de zona</button>
            </div>
            <input value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Buscar barrio, localidad, óptica o código…"
              className="w-full text-sm border border-black/10 rounded-lg px-3 py-1.5" />
          </div>

          {visibles.length === 0 && <p className="text-sm text-muted p-2">No hay zonas con ese filtro.</p>}

          <div className="space-y-2">
            {visibles.map((z) => {
              const open = abierta === z.zona
              const todos = verTodos.has(z.zona)
              const lista = todos ? z.clientes : z.clientes.slice(0, 40)
              const proximos = (z.cabeza?.plan ?? []).slice(0, 4)
              return (
                <div key={z.zona} className={`bg-white rounded-xl border ${open ? 'border-brand/50' : 'border-black/10'}`}>
                  <button onClick={() => setAbierta(open ? null : z.zona)} className="w-full text-left p-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold">{z.zona}</span>
                      <span className="text-[10px] text-faint">{z.area}</span>
                      {proximos.length > 0 && (
                        <span className="text-[10px] rounded-full px-2 py-0.5 bg-brand/10 text-brandDark font-semibold">📅 {proximos.map(fechaCorta).join(' · ')}</span>
                      )}
                      <span className="ml-auto text-[11px] text-muted tabular-nums">
                        {z.clientes.length} clientes · {cuenta(z.clientes, 'Activo')} activos · {cuenta(z.clientes, 'En caída') + cuenta(z.clientes, 'Perdido reciente') + cuenta(z.clientes, 'Perdido')} a recuperar · {z.clientes.filter(esProspectoFuerte).length} prospectos fuertes
                      </span>
                    </div>
                    <p className="mt-1 text-[12px] text-muted truncate">
                      🎯 <b className="text-ink">Cabeza:</b> {z.cabeza ? `${z.cabeza.nombre} (${MOTIVO[z.cabeza.motivo] ?? z.cabeza.motivo})` : 'sin cabeza (zona sin clientes con ventas o sin ubicación)'}
                    </p>
                  </button>

                  {open && (
                    <div className="border-t border-black/5 p-3">
                      <div className="overflow-x-auto">
                        <table className="w-full text-[12px]">
                          <thead>
                            <tr className="text-left text-[10px] uppercase tracking-wide text-faint">
                              <th className="py-1 pr-2">Óptica</th>
                              <th className="py-1 pr-2">Estado</th>
                              <th className="py-1 pr-2 text-right">12m</th>
                              <th className="py-1 pr-2 text-right">Mejor año</th>
                              <th className="py-1 pr-2">Últ. compra</th>
                              <th className="py-1 pr-2 text-right">Prior./Puntaje</th>
                              <th className="py-1 pr-2">Dirección</th>
                              <th className="py-1">Contacto</th>
                            </tr>
                          </thead>
                          <tbody>
                            {lista.map((c) => {
                              const esCabeza = c.cod === z.cabeza?.cod
                              return (
                                <tr key={c.cod} className={`border-t border-black/5 ${esCabeza ? 'bg-brand/5' : ''}`}>
                                  <td className="py-1 pr-2">
                                    <span className="font-medium">{esCabeza && '🎯 '}{c.nombre}</span>
                                    <span className="text-faint"> · {c.cod}</span>
                                    {c.nivel && <span className="text-violet-700"> · {c.nivel}</span>}
                                  </td>
                                  <td className="py-1 pr-2 whitespace-nowrap"><span className={`text-[10px] rounded-full px-1.5 py-0.5 ${ESTADO_ESTILO[c.estado] ?? ''}`}>{c.estado}</span></td>
                                  <td className="py-1 pr-2 text-right tabular-nums">{n0(c.u12) || ''}</td>
                                  <td className="py-1 pr-2 text-right tabular-nums">{n0(c.u_mejor) || ''}</td>
                                  <td className="py-1 pr-2 tabular-nums">{mes(c.ult_mes)}</td>
                                  <td className="py-1 pr-2 text-right tabular-nums">
                                    {c.prioridad != null ? n0(c.prioridad) : c.puntaje != null ? <span title={c.oportunidad ?? ''}>{n0(c.puntaje)}</span> : ''}
                                  </td>
                                  <td className="py-1 pr-2 text-muted truncate max-w-[220px]">{c.direccion ?? ''}</td>
                                  <td className="py-1"><TelefonoAcciones whatsapp={c.tel} telefono={null} compact /></td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                      {z.clientes.length > 40 && (
                        <button onClick={() => setVerTodos((s) => { const n = new Set(s); if (n.has(z.zona)) n.delete(z.zona); else n.add(z.zona); return n })}
                          className="text-[11px] text-brandDark font-medium mt-2">
                          {todos ? 'Mostrar menos' : `Ver los ${z.clientes.length} clientes`}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
