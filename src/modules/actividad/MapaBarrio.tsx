import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useToast } from '../../lib/toast'
import TelefonoAcciones from '../../lib/TelefonoAcciones'

// Mapa comercial por barrio (CABA) o localidad (conurbano / interior) de un vendedor.
// Sale de la función mapa_barrio(): ventas reales, nivel Partners 2025 y puntaje de prospectos.
// Ancla = clientes activos que juntan ~70% de lo que se vende en el barrio (hasta 3).
// Prospecto estratégico = 45+ puntos o marcado a mano por el vendedor (⭐ suma 10).

type ClienteMapa = {
  cod: string
  nombre: string | null
  area: string
  micro_zona: string
  direccion: string | null
  tel: string | null
  estado: 'Activo' | 'En caída' | 'Perdido reciente' | 'Perdido'
  nivel_partner: string | null
  u_mejor_anio: number
  u12: number
  ult_mes: string | null
  meses_sin_compra: number | null
  prioridad_recupero: number | null
}

type ProspectoMapa = {
  cod: string
  nombre: string | null
  area: string
  micro_zona: string
  direccion: string | null
  tel: string | null
  tipo_oportunidad: string
  marca: string | null
  suc_amba: number | null
  nivel_partner: string | null
  pts_ubicacion: number
  seguidores_ig: number | null
  puntaje_prospecto: number
  marcado: boolean
  nota_vendedor: string | null
}

type TipoBarrio = 'Defender' | 'Crecer' | 'Abrir'

type Barrio = {
  zona: string
  area: string
  tipo: TipoBarrio
  u12: number
  perdidas: number
  anclas: ClienteMapa[]
  activos: ClienteMapa[]
  recuperar: ClienteMapa[]
  estrategicos: ProspectoMapa[]
  secundarios: ProspectoMapa[]
}

const UMBRAL_ESTRATEGICO = 45

const TIPO_ESTILO: Record<TipoBarrio, { pill: string; d: string }> = {
  Defender: { pill: 'bg-emerald-100 text-emerald-800', d: 'Mucha venta y poco potencial libre: cuidar las anclas.' },
  Crecer: { pill: 'bg-sky-100 text-sky-800', d: 'Hay venta y hay potencial: recuperar y sumar prospectos.' },
  Abrir: { pill: 'bg-amber-100 text-amber-800', d: 'Sin clientes activos: arrancar por recuperar o por un prospecto fuerte.' },
}

const ESTADO_ESTILO: Record<string, string> = {
  'En caída': 'bg-orange-100 text-orange-800',
  'Perdido reciente': 'bg-red-100 text-red-700',
  Perdido: 'bg-red-50 text-red-600',
}

const n0 = (v: number | null | undefined) => Math.round(Number(v ?? 0))
const mesCorto = (m: string | null) => (m ? `${m.slice(5, 7)}/${m.slice(2, 4)}` : '—')
const esEstrategico = (p: ProspectoMapa) => p.marcado || n0(p.puntaje_prospecto) >= UMBRAL_ESTRATEGICO

function armarBarrios(clientes: ClienteMapa[], prospectos: ProspectoMapa[]): Barrio[] {
  const m = new Map<string, { area: string; cli: ClienteMapa[]; pro: ProspectoMapa[] }>()
  const get = (zona: string, area: string) => {
    if (!m.has(zona)) m.set(zona, { area, cli: [], pro: [] })
    return m.get(zona)!
  }
  for (const c of clientes) get(c.micro_zona, c.area).cli.push(c)
  for (const p of prospectos) get(p.micro_zona, p.area).pro.push(p)

  const out: Barrio[] = []
  for (const [zona, { area, cli, pro }] of m) {
    const activos = cli.filter((c) => c.estado === 'Activo').sort((a, b) => n0(b.u12) - n0(a.u12))
    const u12 = activos.reduce((s, c) => s + Math.max(0, n0(c.u12)), 0)
    const anclas: ClienteMapa[] = []
    let acum = 0
    for (const c of activos) {
      if (u12 > 0 && acum / u12 >= 0.7) break
      anclas.push(c)
      acum += Math.max(0, n0(c.u12))
      if (anclas.length >= 3) break
    }
    const recuperar = cli.filter((c) => c.estado !== 'Activo').sort((a, b) => n0(b.prioridad_recupero) - n0(a.prioridad_recupero))
    const perdidas = recuperar.reduce((s, c) => s + Math.max(0, n0(c.u_mejor_anio) - Math.max(0, n0(c.u12))), 0)
    const ordenP = [...pro].sort((a, b) => n0(b.puntaje_prospecto) + (b.marcado ? 10 : 0) - (n0(a.puntaje_prospecto) + (a.marcado ? 10 : 0)))
    const estrategicos = ordenP.filter(esEstrategico)
    const secundarios = ordenP.filter((p) => !esEstrategico(p))
    const tipo: TipoBarrio = u12 >= 150 && estrategicos.length === 0 ? 'Defender' : u12 > 0 ? 'Crecer' : 'Abrir'
    out.push({ zona, area, tipo, u12, perdidas, anclas, activos, recuperar, estrategicos, secundarios })
  }
  return out.sort((a, b) => b.u12 + b.perdidas - (a.u12 + a.perdidas))
}

export default function MapaBarrio({ vendedor }: { vendedor: string }) {
  const toast = useToast()
  const [clientes, setClientes] = useState<ClienteMapa[]>([])
  const [prospectos, setProspectos] = useState<ProspectoMapa[]>([])
  const [corte, setCorte] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [areaF, setAreaF] = useState<string>('')
  const [tipoF, setTipoF] = useState<TipoBarrio | ''>('')
  const [busqueda, setBusqueda] = useState('')
  const [abierto, setAbierto] = useState<string | null>(null)
  const [verSecundarios, setVerSecundarios] = useState<Set<string>>(new Set())
  const [guardando, setGuardando] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    supabase.rpc('mapa_barrio', { p_vendedor: vendedor }).then(({ data, error }) => {
      if (error) {
        setError(error.message)
        setLoading(false)
        return
      }
      const d = data as { clientes: ClienteMapa[]; prospectos: ProspectoMapa[]; corte: string | null }
      setClientes(d?.clientes ?? [])
      // El puntaje del servidor ya suma 10 si está marcado: lo guardamos sin la marca y la sumamos al mostrar.
      setProspectos((d?.prospectos ?? []).map((p) => ({ ...p, puntaje_prospecto: n0(p.puntaje_prospecto) - (p.marcado ? 10 : 0) })))
      setCorte(d?.corte ?? null)
      setLoading(false)
    })
  }, [vendedor])

  const barrios = useMemo(() => armarBarrios(clientes, prospectos), [clientes, prospectos])
  const areas = useMemo(() => [...new Set(barrios.map((b) => b.area))].sort(), [barrios])

  const visibles = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    return barrios.filter((b) => {
      if (areaF && b.area !== areaF) return false
      if (tipoF && b.tipo !== tipoF) return false
      if (!q) return true
      if (b.zona.toLowerCase().includes(q)) return true
      return [...b.activos, ...b.recuperar, ...b.estrategicos, ...b.secundarios].some((x) => (x.nombre || '').toLowerCase().includes(q))
    })
  }, [barrios, areaF, tipoF, busqueda])

  async function toggleMarca(p: ProspectoMapa) {
    const nuevo = !p.marcado
    setGuardando(p.cod)
    const { error } = await supabase.rpc('marcar_prospecto', { p_cod: p.cod, p_estrategico: nuevo, p_nota: null })
    setGuardando(null)
    if (error) {
      toast('No se pudo guardar la marca: ' + error.message, 'error')
      return
    }
    setProspectos((prev) => prev.map((x) => (x.cod === p.cod ? { ...x, marcado: nuevo } : x)))
    toast(nuevo ? '⭐ Marcado como estratégico' : 'Marca quitada', 'success')
  }

  if (loading) return <p className="text-sm text-muted p-4">Cargando mapa por barrio...</p>
  if (error) return <p className="text-sm text-red-600 p-4">No se pudo cargar el mapa: {error}</p>

  const totActivos = clientes.filter((c) => c.estado === 'Activo').length
  const totRecuperar = clientes.length - totActivos
  const totEstrategicos = prospectos.filter(esEstrategico).length
  const conteoTipo = (t: TipoBarrio) => barrios.filter((b) => (!areaF || b.area === areaF) && b.tipo === t).length

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {[
          { l: 'Barrios / localidades', v: barrios.length, s: 'con clientes o prospectos' },
          { l: 'Clientes activos', v: totActivos, s: 'compraron en los últimos 5 meses' },
          { l: 'A recuperar', v: totRecuperar, s: 'en caída o perdidos' },
          { l: 'Prospectos estratégicos', v: totEstrategicos, s: `${UMBRAL_ESTRATEGICO}+ puntos o marcados ⭐` },
        ].map((k) => (
          <div key={k.l} className="bg-white border border-black/10 rounded-xl p-3">
            <p className="text-[10px] text-muted uppercase font-semibold tracking-wide mb-1">{k.l}</p>
            <p className="text-2xl font-bold tabular-nums">{k.v}</p>
            <p className="text-[10px] text-faint mt-0.5 leading-tight">{k.s}</p>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-black/10 p-2.5 space-y-2">
        <div className="flex flex-wrap gap-1.5 items-center">
          <span className="text-[10px] text-faint uppercase tracking-wide mr-1">Área</span>
          {['', ...areas].map((a) => (
            <button key={a || 'todas'} onClick={() => setAreaF(a)}
              className={`text-[11px] rounded-full border px-2.5 py-1 ${areaF === a ? 'border-brand text-brandDark font-semibold' : 'border-black/10 text-muted'}`}>
              {a || 'Todas'}
            </button>
          ))}
          <span className="text-[10px] text-faint uppercase tracking-wide ml-3 mr-1">Tipo</span>
          {(['', 'Defender', 'Crecer', 'Abrir'] as (TipoBarrio | '')[]).map((t) => (
            <button key={t || 'todos'} onClick={() => setTipoF(t)}
              className={`text-[11px] rounded-full border px-2.5 py-1 ${tipoF === t ? 'border-brand text-brandDark font-semibold' : 'border-black/10 text-muted'}`}>
              {t ? `${t} ${conteoTipo(t)}` : 'Todos'}
            </button>
          ))}
        </div>
        <input value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Buscar barrio, localidad u óptica…"
          className="w-full text-sm border border-black/10 rounded-lg px-3 py-1.5" />
        <p className="text-[10px] text-faint">
          Ventas hasta {mesCorto(corte)} · ordenado por volumen en juego (venta actual + unidades perdidas). Tocá un barrio para ver el detalle.
        </p>
      </div>

      {visibles.length === 0 && <p className="text-sm text-muted p-2">No hay barrios con ese filtro.</p>}

      <div className="space-y-2">
        {visibles.map((b) => {
          const open = abierto === b.zona
          const verSec = verSecundarios.has(b.zona)
          return (
            <div key={b.zona} className={`bg-white rounded-xl border ${open ? 'border-brand/50' : 'border-black/10'}`}>
              <button onClick={() => setAbierto(open ? null : b.zona)} className="w-full text-left p-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold">{b.zona}</span>
                  <span className={`text-[10px] font-semibold rounded-full px-2 py-0.5 ${TIPO_ESTILO[b.tipo].pill}`}>{b.tipo}</span>
                  <span className="text-[10px] text-faint">{b.area}</span>
                  <span className="ml-auto text-[11px] text-muted tabular-nums">
                    {n0(b.u12)} u/12m · {b.recuperar.length} a recuperar · {b.estrategicos.length} ⭐
                  </span>
                </div>
                <div className="mt-1 grid md:grid-cols-3 gap-x-4 gap-y-0.5 text-[11px] text-muted">
                  <p className="truncate"><b className="text-ink">Ancla:</b> {b.anclas.length ? b.anclas.map((c) => c.nombre).join(' · ') : '—'}</p>
                  <p className="truncate"><b className="text-ink">Recuperar:</b> {b.recuperar[0]?.nombre ?? '—'}</p>
                  <p className="truncate"><b className="text-ink">Prospecto:</b> {b.estrategicos[0]?.nombre ?? '—'}</p>
                </div>
              </button>

              {open && (
                <div className="border-t border-black/5 p-3 space-y-3">
                  <p className="text-[11px] text-muted">{TIPO_ESTILO[b.tipo].d}</p>

                  <section>
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700 mb-1">Anclas y activos ({b.activos.length})</p>
                    {b.activos.length === 0 && <p className="text-[11px] text-faint">Sin clientes activos.</p>}
                    {b.activos.map((c) => (
                      <div key={c.cod} className="flex items-center gap-2 py-1 border-b border-black/5 last:border-0 text-[12px]">
                        <span className={`w-1.5 h-1.5 rounded-full ${b.anclas.includes(c) ? 'bg-emerald-500' : 'bg-black/15'}`} />
                        <span className="font-medium truncate">{c.nombre}</span>
                        {c.nivel_partner && <span className="text-[10px] text-violet-700">{c.nivel_partner}</span>}
                        <span className="ml-auto tabular-nums text-muted whitespace-nowrap">{n0(c.u12)} u · últ. {mesCorto(c.ult_mes)}</span>
                        <TelefonoAcciones whatsapp={c.tel} telefono={null} compact />
                      </div>
                    ))}
                  </section>

                  <section>
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-orange-700 mb-1">A recuperar ({b.recuperar.length})</p>
                    {b.recuperar.length === 0 && <p className="text-[11px] text-faint">Nadie para recuperar.</p>}
                    {b.recuperar.map((c) => (
                      <div key={c.cod} className="flex items-center gap-2 py-1 border-b border-black/5 last:border-0 text-[12px]">
                        <span className="tabular-nums text-[11px] font-bold w-7 text-right">{n0(c.prioridad_recupero)}</span>
                        <span className="font-medium truncate">{c.nombre}</span>
                        <span className={`text-[10px] rounded-full px-1.5 py-0.5 whitespace-nowrap ${ESTADO_ESTILO[c.estado] ?? ''}`}>{c.estado}</span>
                        {c.nivel_partner && <span className="text-[10px] text-violet-700">{c.nivel_partner}</span>}
                        <span className="ml-auto tabular-nums text-muted whitespace-nowrap">supo {n0(c.u_mejor_anio)} u/año · últ. {mesCorto(c.ult_mes)}</span>
                        <TelefonoAcciones whatsapp={c.tel} telefono={null} compact />
                      </div>
                    ))}
                  </section>

                  <section>
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-sky-700 mb-1">Prospectos estratégicos ({b.estrategicos.length})</p>
                    {b.estrategicos.length === 0 && <p className="text-[11px] text-faint">Sin prospectos estratégicos. Marcá con ⭐ los que conozcas.</p>}
                    {[...b.estrategicos, ...(verSec ? b.secundarios : [])].map((p) => (
                      <div key={p.cod} className="flex items-center gap-2 py-1 border-b border-black/5 last:border-0 text-[12px]">
                        <button onClick={() => toggleMarca(p)} disabled={guardando === p.cod}
                          title={p.marcado ? 'Quitar marca de estratégico' : 'Marcar como estratégico (+10)'}
                          className={`text-base leading-none ${p.marcado ? '' : 'opacity-30 hover:opacity-70'}`}>⭐</button>
                        <span className="tabular-nums text-[11px] font-bold w-7 text-right">{n0(p.puntaje_prospecto) + (p.marcado ? 10 : 0)}</span>
                        <span className="font-medium truncate">{p.nombre}</span>
                        <span className="text-[10px] text-faint whitespace-nowrap">{p.tipo_oportunidad}{p.suc_amba ? ` · ${p.suc_amba} suc.` : ''}</span>
                        {p.nivel_partner && <span className="text-[10px] text-violet-700">{p.nivel_partner}</span>}
                        <span className="ml-auto text-muted truncate max-w-[30%] hidden md:inline">{p.direccion ?? ''}</span>
                        <TelefonoAcciones whatsapp={p.tel} telefono={null} compact />
                      </div>
                    ))}
                    {b.secundarios.length > 0 && (
                      <button onClick={() => setVerSecundarios((s) => { const n = new Set(s); if (n.has(b.zona)) n.delete(b.zona); else n.add(b.zona); return n })}
                        className="text-[11px] text-brandDark font-medium mt-1">
                        {verSec ? 'Ocultar secundarios' : `Ver ${b.secundarios.length} prospectos secundarios`}
                      </button>
                    )}
                  </section>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
