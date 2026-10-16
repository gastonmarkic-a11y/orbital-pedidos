import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'
import TelefonoAcciones from '../../lib/TelefonoAcciones'
import ZonasGeneral from './ZonasGeneral'

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
  // punto de venta: lo que leyó la última foto del check-in, POP y material especial
  foto_fecha: string | null
  foto_url: string | null
  tiene_orbital: boolean | null
  exhibidor: boolean | null
  marcas: string[] | null
  participacion: { marca: string; porcentaje: number }[] | null
  espacio: string | null
  pop_nivel: number | null
  kit: string | null
  especial: string | null
  ult_checkin: string | null
  contacto: { fecha: string; estado: string; visita: string | null } | null
}
type Dia = { fecha: string; visitas: number; fotos: number; fotos_leidas: number; contactos_lista: number; contactos: number; agendados: number; pop: number; zona: string | null; checkin_cabeza: boolean | null }
type Cabeza = {
  micro_zona: string
  area: string
  cod: string
  motivo: 'ancla' | 'recuperar' | 'prospecto'
  prioridad: number
  nombre: string | null
  plan: string[] | null
  sector: number
  n_clientes: number | null
}
type Zona = { zona: string; area: string; cabezas: Cabeza[]; clientes: Cliente[]; peso: number }

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
const ESTADO_CONTACTO: Record<string, string> = { pendiente: '💬 por escribir', enviado: '💬 escrito', agendado: '📅 agendó', no_responde: '💬 no responde', no_interesa: '🚫 no le interesa' }
// Arranque de la acción de campo (cabeza de zona + 25 contactos + 5 POP)
const DESDE = '2026-10-14'
const ddmm = (f: string | null) => (f ? `${f.slice(8, 10)}/${f.slice(5, 7)}` : '')

function Meta({ v, meta, label, sub, activo, onClick }: { v: number; meta: number; label: string; sub?: string; activo?: boolean; onClick?: () => void }) {
  const ok = v >= meta
  const p = meta ? Math.min(100, Math.round((v / meta) * 100)) : 0
  return (
    <button onClick={onClick} className={`text-left bg-white border rounded-xl p-2.5 hover:border-brand/60 ${activo ? 'border-brand ring-2 ring-brand/20' : 'border-black/10'}`}>
      <p className="text-[10px] text-muted uppercase font-semibold tracking-wide">{label}</p>
      <p className={`text-xl font-bold tabular-nums ${ok ? 'text-emerald-700' : ''}`}>{v}<span className="text-sm text-faint">/{meta}</span></p>
      <div className="h-1 bg-black/5 rounded-full overflow-hidden mt-1"><div className={`h-full ${ok ? 'bg-emerald-500' : 'bg-brand'}`} style={{ width: `${p}%` }} /></div>
      {sub && <p className="text-[10px] text-faint mt-1">{sub}</p>}
    </button>
  )
}

// Filtros que se activan tocando las tarjetas de seguimiento: la lista muestra solo esos clientes.
type Filtro = 'visitas' | 'contactos' | 'agendados' | 'pop' | 'fotos' | 'orbital' | 'sin_exh' | 'especial' | 'relevar'
const FILTRO_LABEL: Record<Filtro, string> = {
  visitas: 'Visitados (check-in) en el período',
  contactos: 'Contactos para agendar del día',
  agendados: 'Agendaron visita',
  pop: 'Con POP instalado',
  fotos: 'Con foto de PDV leída',
  orbital: 'Con Orbital en el PDV',
  sin_exh: 'Con Orbital y sin exhibidor (Kit Exhibición)',
  especial: 'Con material especial',
  relevar: 'Material especial a relevar (foto + medidas)',
}

// Lectura del punto de venta en una línea: Orbital / exhibidor / marcas / POP / material especial.
function LecturaPDV({ c }: { c: Cliente }) {
  if (!c.foto_fecha && !c.kit && !c.especial && c.tiene_orbital == null) return <span className="text-faint">sin foto</span>
  const part = (c.participacion ?? []).slice(0, 3).map((x) => `${x.marca} ${x.porcentaje}%`).join(' · ')
  const marcas = (c.marcas ?? []).slice(0, 3).join(', ')
  return (
    <span className="space-x-1">
      {c.foto_url ? <a href={c.foto_url} target="_blank" rel="noreferrer" className="text-brandDark">📸 {ddmm(c.foto_fecha)}</a> : c.foto_fecha ? <span>📸 {ddmm(c.foto_fecha)}</span> : null}
      {c.tiene_orbital != null && <span className={c.tiene_orbital ? 'text-emerald-700' : 'text-red-600'}>{c.tiene_orbital ? 'Orbital ✓' : 'sin Orbital'}</span>}
      {c.tiene_orbital && c.exhibidor != null && <span className={c.exhibidor ? 'text-emerald-700' : 'text-orange-700'}>{c.exhibidor ? 'exhibidor ✓' : 'sin exhibidor'}</span>}
      {(part || marcas) && <span className="text-muted">· {part || marcas}</span>}
      {c.kit && <span>· 🧰 {c.kit.toLowerCase()}</span>}
      {c.especial && <span className="text-violet-700">· ⭐ especial: {c.especial}</span>}
    </span>
  )
}

function ordenarClientes(cs: Cliente[], cabezas: Set<string>) {
  return [...cs].sort((a, b) => {
    if (cabezas.has(a.cod) !== cabezas.has(b.cod)) return cabezas.has(a.cod) ? -1 : 1
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
  const [dias, setDias] = useState<Dia[]>([])
  const [kits, setKits] = useState<{ exhibicion: number; presencia: number } | null>(null)
  const [filtro, setFiltro] = useState<Filtro | null>(null)
  const tocar = (f: Filtro) => { setAbierta(null); setFiltro((x) => (x === f ? null : f)) }
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
    if (ven === 'General') { setLoading(false); return }
    supabase.rpc('panel_zonas', { p_vendedor: ven }).then(({ data, error }) => {
      if (error) { setError(error.message); setLoading(false); return }
      const d = data as { clientes: Cliente[]; cabezas: Cabeza[]; dias: Dia[]; kits: { exhibicion: number; presencia: number } }
      setClientes(d?.clientes ?? [])
      setCabezas(d?.cabezas ?? [])
      setDias(d?.dias ?? [])
      setKits(d?.kits ?? null)
      setLoading(false)
    })
  }, [ven])

  const zonas = useMemo(() => {
    const m = new Map<string, Zona>()
    const get = (zona: string, area: string) => {
      if (!m.has(zona)) m.set(zona, { zona, area, cabezas: [], clientes: [], peso: 0 })
      return m.get(zona)!
    }
    for (const c of clientes) get(c.micro_zona, c.area).clientes.push(c)
    for (const k of cabezas) { const z = get(k.micro_zona, k.area); z.cabezas.push(k); z.peso += k.prioridad }
    for (const z of m.values()) {
      z.cabezas.sort((a, b) => a.sector - b.sector)
      if (!z.cabezas.length) z.peso = z.clientes.reduce((s, c) => s + (c.estado === 'Activo' ? Math.max(0, n0(c.u12)) : 0), 0)
      z.clientes = ordenarClientes(z.clientes, new Set(z.cabezas.map((k) => k.cod)))
    }
    // primero las zonas con cabeza (por lo que hay en juego), después el resto
    return [...m.values()].sort((a, b) => Number(b.cabezas.length > 0) - Number(a.cabezas.length > 0) || b.peso - a.peso || b.clientes.length - a.clientes.length)
  }, [clientes, cabezas])

  const areas = useMemo(() => [...new Set(zonas.map((z) => z.area))].sort(), [zonas])
  const coincide = useCallback((c: Cliente, f: Filtro) => {
    switch (f) {
      case 'visitas': return !!c.ult_checkin && c.ult_checkin.slice(0, 10) >= DESDE
      case 'contactos': return !!c.contacto && c.contacto.fecha >= DESDE
      case 'agendados': return c.contacto?.estado === 'agendado' && c.contacto.fecha >= DESDE
      case 'pop': return !!c.kit
      case 'fotos': return !!c.foto_fecha
      case 'orbital': return !!c.foto_fecha && !!c.tiene_orbital
      case 'sin_exh': return !!c.tiene_orbital && c.exhibidor === false
      case 'especial': return !!c.especial
      case 'relevar': return c.especial === 'relevar'
    }
  }, [])
  const visibles = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    return zonas
      // con un filtro de las tarjetas, cada zona queda solo con esos clientes (y se ocultan las zonas sin ninguno)
      .map((z) => (filtro ? { ...z, clientes: z.clientes.filter((c) => coincide(c, filtro)) } : z))
      .filter((z) => {
        if (filtro && !z.clientes.length) return false
        if (areaF && z.area !== areaF) return false
        if (soloCabeza && !z.cabezas.length) return false
        if (!q) return true
        return z.zona.toLowerCase().includes(q) || z.clientes.some((c) => (c.nombre || '').toLowerCase().includes(q) || c.cod.toLowerCase().includes(q))
      })
  }, [zonas, areaF, soloCabeza, busqueda, filtro, coincide])
  const nFiltro = useMemo(() => (filtro ? clientes.filter((c) => coincide(c, filtro)).length : 0), [clientes, filtro, coincide])

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
            {[...VENDEDORES, { cod: 'General', label: '🗺 General' }].map((v) => (
              <button key={v.cod} onClick={() => { setVen(v.cod); setAbierta(null) }}
                className={`text-xs px-3 py-1.5 rounded-md font-medium ${ven === v.cod ? 'bg-brand text-white' : 'text-muted'}`}>{v.label}</button>
            ))}
          </div>
        )}
      </div>

      {ven === 'General' ? <ZonasGeneral /> : loading ? <p className="text-sm text-muted p-4">Cargando zonas…</p> : error ? <p className="text-sm text-red-600 p-4">No se pudieron cargar las zonas: {error}</p> : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {[
              { l: 'Zonas', v: zonas.length, s: `${zonas.filter((z) => z.cabezas.length).length} con cabeza · ${cabezas.length} cabezas en total` },
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

          {/* Seguimiento del campo: objetivo diario (5 visitas + 25 contactos + 5 POP) y lectura de fotos */}
          {(() => {
            const hoy = dias[0]
            const per = dias.filter((d) => d.fecha >= DESDE)
            const suma = (k: 'visitas' | 'contactos' | 'agendados' | 'pop') => per.reduce((s, d) => s + d[k], 0)
            const conFoto = clientes.filter((c) => c.foto_fecha)
            const conOrb = conFoto.filter((c) => c.tiene_orbital)
            const sinExh = conOrb.filter((c) => c.exhibidor === false)
            const especiales = clientes.filter((c) => c.especial)
            const chip = (f: Filtro, txt: string, cls = '') => (
              <span role="button" onClick={(e) => { e.stopPropagation(); tocar(f) }}
                className={`underline decoration-dotted cursor-pointer ${filtro === f ? 'text-brandDark font-semibold' : cls}`}>{txt}</span>
            )
            return (
              <div className="space-y-2">
                <p className="text-[11px] text-faint">Tocá una tarjeta para ver solo esos clientes abajo. Período: desde el {fechaCorta(DESDE)}, cuando arrancó la acción.</p>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                  <Meta label={`Visitas hoy${hoy?.zona ? ' · ' + hoy.zona : ''}`} v={hoy?.visitas ?? 0} meta={5} activo={filtro === 'visitas'} onClick={() => tocar('visitas')}
                    sub={`${hoy?.checkin_cabeza ? '✅ check-in en la cabeza' : 'sin check-in en la cabeza'} · desde ${ddmm(DESDE)}: ${suma('visitas')}`} />
                  <Meta label="Contactos para agendar" v={hoy?.contactos ?? 0} meta={25} activo={filtro === 'contactos'} onClick={() => tocar('contactos')}
                    sub={`${hoy?.contactos_lista ?? 0} en la lista hoy · desde ${ddmm(DESDE)}: ${suma('contactos')} · 📅 ${suma('agendados')} agendaron`} />
                  <Meta label="POP instalados hoy" v={hoy?.pop ?? 0} meta={5} activo={filtro === 'pop'} onClick={() => tocar('pop')}
                    sub={`desde ${ddmm(DESDE)}: ${suma('pop')} · quedan ${kits?.exhibicion ?? 0} kits exhibición · ${kits?.presencia ?? 0} presencia`} />
                  <button onClick={() => tocar('fotos')} className={`text-left bg-white border rounded-xl p-2.5 hover:border-brand/60 ${filtro === 'fotos' ? 'border-brand ring-2 ring-brand/20' : 'border-black/10'}`}>
                    <p className="text-[10px] text-muted uppercase font-semibold tracking-wide">Fotos de PDV leídas</p>
                    <p className="text-xl font-bold tabular-nums">{conFoto.length}</p>
                    <p className="text-[10px] text-faint mt-1">{chip('orbital', `${conOrb.length} con Orbital`)} · {chip('sin_exh', `${sinExh.length} sin exhibidor`, 'text-orange-700 font-semibold')} (Kit Exhibición)</p>
                  </button>
                  <button onClick={() => tocar('especial')} className={`text-left bg-white border rounded-xl p-2.5 hover:border-brand/60 ${filtro === 'especial' ? 'border-brand ring-2 ring-brand/20' : 'border-black/10'}`}>
                    <p className="text-[10px] text-muted uppercase font-semibold tracking-wide">Material especial</p>
                    <p className="text-xl font-bold tabular-nums">{especiales.length}</p>
                    <p className="text-[10px] text-faint mt-1">{chip('relevar', `${especiales.filter((c) => c.especial === 'relevar').length} a relevar`)} (foto + medidas) · {especiales.filter((c) => c.especial === 'instalado').length} instalados</p>
                  </button>
                </div>
                {filtro && (
                  <div className="flex items-center gap-2 bg-brand/10 text-brandDark rounded-lg px-3 py-1.5 text-[12px]">
                    <span>Filtro: <b>{FILTRO_LABEL[filtro]}</b>{['visitas', 'contactos', 'agendados'].includes(filtro) ? ` (desde ${ddmm(DESDE)})` : ''} · {nFiltro} clientes</span>
                    {filtro === 'contactos' && <span role="button" onClick={() => tocar('agendados')} className="underline cursor-pointer">ver solo los que agendaron</span>}
                    <button onClick={() => setFiltro(null)} className="ml-auto font-semibold">✕ Quitar filtro</button>
                  </div>
                )}
                {per.length > 0 && (
                  <div className="bg-white border border-black/10 rounded-xl p-2.5 overflow-x-auto">
                    <p className="text-[11px] font-semibold mb-1">Días hábiles desde el {fechaCorta(DESDE)}</p>
                    <table className="text-[11px] w-full">
                      <thead><tr className="text-[10px] uppercase text-faint text-left"><th className="pr-3">Día</th><th className="pr-3">Cabeza</th><th className="pr-3 text-right">Visitas /5</th><th className="pr-3 text-right">Fotos (leídas)</th><th className="pr-3 text-right">Contactos /25</th><th className="pr-3 text-right">Agendados</th><th className="text-right">POP /5</th></tr></thead>
                      <tbody>
                        {per.map((d) => (
                          <tr key={d.fecha} className="border-t border-black/5">
                            <td className="pr-3 whitespace-nowrap">{fechaCorta(d.fecha)}</td>
                            <td className="pr-3 text-muted">{d.zona ?? '—'}{d.zona ? (d.checkin_cabeza ? ' ✅' : ' ⏳') : ''}</td>
                            <td className={`pr-3 text-right tabular-nums ${d.visitas >= 5 ? 'text-emerald-700 font-semibold' : d.visitas ? '' : 'text-faint'}`}>{d.visitas}</td>
                            <td className="pr-3 text-right tabular-nums">{d.fotos} ({d.fotos_leidas})</td>
                            <td className={`pr-3 text-right tabular-nums ${d.contactos >= 25 ? 'text-emerald-700 font-semibold' : d.contactos ? '' : 'text-faint'}`}>{d.contactos_lista ? `${d.contactos}/${d.contactos_lista}` : '—'}</td>
                            <td className="pr-3 text-right tabular-nums">{d.agendados || ''}</td>
                            <td className={`text-right tabular-nums ${d.pop >= 5 ? 'text-emerald-700 font-semibold' : d.pop ? '' : 'text-faint'}`}>{d.pop}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )
          })()}

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
              // con filtro las zonas vienen abiertas (tocar la zona la cierra)
              const open = filtro ? abierta !== z.zona : abierta === z.zona
              const todos = verTodos.has(z.zona)
              const lista = todos ? z.clientes : z.clientes.slice(0, 40)
              const proximos = [...new Set(z.cabezas.flatMap((k) => k.plan ?? []))].sort().slice(0, 4)
              const fotos = z.clientes.filter((c) => c.foto_fecha)
              const sinExh = fotos.filter((c) => c.tiene_orbital && c.exhibidor === false).length
              return (
                <div key={z.zona} className={`bg-white rounded-xl border ${open ? 'border-brand/50' : 'border-black/10'}`}>
                  <button onClick={() => setAbierta(abierta === z.zona ? null : z.zona)} className="w-full text-left p-3">
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
                    <p className="mt-1 text-[12px] text-muted">
                      🎯 <b className="text-ink">{z.cabezas.length > 1 ? `Cabezas (${z.cabezas.length}):` : 'Cabeza:'}</b>{' '}
                      {z.cabezas.length
                        ? z.cabezas.map((k) => `${k.nombre} (${MOTIVO[k.motivo] ?? k.motivo}${z.cabezas.length > 1 && k.n_clientes ? `, ${k.n_clientes} clientes cerca` : ''}${k.plan?.length ? ' · ' + k.plan.slice(0, 2).map(fechaCorta).join(', ') : ''})`).join('  ·  ')
                        : 'sin cabeza (zona sin clientes con ventas, sin ubicación o de otro vendedor)'}
                    </p>
                    {fotos.length > 0 && (
                      <p className="text-[11px] text-faint">📸 {fotos.length} PDV con foto · {fotos.filter((c) => c.tiene_orbital).length} con Orbital{sinExh ? ` · ${sinExh} sin exhibidor` : ''}</p>
                    )}
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
                              <th className="py-1 pr-2">Punto de venta (foto)</th>
                              <th className="py-1 pr-2">Dirección</th>
                              <th className="py-1">Contacto</th>
                            </tr>
                          </thead>
                          <tbody>
                            {lista.map((c) => {
                              const esCabeza = z.cabezas.some((k) => k.cod === c.cod)
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
                                  <td className="py-1 pr-2 max-w-[320px]"><LecturaPDV c={c} /></td>
                                  <td className="py-1 pr-2 text-muted truncate max-w-[220px]">{c.direccion ?? ''}</td>
                                  <td className="py-1">
                                    <TelefonoAcciones whatsapp={c.tel} telefono={null} compact />
                                    {c.contacto && <span className="block text-[10px] text-muted whitespace-nowrap">{ESTADO_CONTACTO[c.contacto.estado] ?? c.contacto.estado}{c.contacto.visita ? ` · visita ${ddmm(c.contacto.visita)}` : ''}</span>}
                                  </td>
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
