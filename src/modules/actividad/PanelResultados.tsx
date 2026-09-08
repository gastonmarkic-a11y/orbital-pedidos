import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'
import { RefreshCw, Search, ShoppingCart, MessageCircle, Eye, FileText, Clock, Send, Wallet, ChevronDown } from 'lucide-react'

// Panel de resultados — tablero de variables con el detalle abajo.
//
// La idea es leerlo en dos tiempos: arriba las variables, y al tocar cualquiera
// se abre exactamente el listado de ópticas que hay detrás de ese número, ordenado
// por lo que importa en esa variable. Después, tocando una óptica, se abre todo lo
// que sabemos de ella. Nada de buscar a mano en una tabla larga.

interface Fila {
  cod: string
  nombre: string | null
  zona: string | null
  provincia: string | null
  vendedor: string | null
  posta: string | null
  envios: number
  ultimo_envio: string | null
  ultima_pieza: string | null
  ultimo_canal: string | null
  visitas_catalogo: number
  abrio_catalogo: string | null
  sesiones: number
  minutos: number
  ultima_sesion: string | null
  visitas_landing: number
  abrio_propuesta: string | null
  propuesta: string | null
  respuestas: number
  respondio: string | null
  carrito_unidades: number | null
  carrito_importe: number | string | null
  carrito_at: string | null
  /** false = lo dejó cargado en la pantalla y nunca lo confirmó. */
  carrito_confirmado: boolean
  carrito_pedido: number | null
  pedidos: number
  comprado: number | string | null
  ultima_compra: string | null
}

interface Lead {
  id: number
  nombre: string | null
  estado: string | null
  zona: string | null
  asignado_a: string | null
  created_at: string
}

const POSTA: Record<string, string> = {
  P0_frio: 'Primer contacto', P1_presentacion: 'Seguimiento', P2_interaccion: 'Respondió',
  P3_propuesta: 'Está decidiendo', P4_activo: 'Cliente activo',
  P5_dormido: 'Reactivación', P6_perdido: 'Recuperación',
}

const PROPUESTA: Record<string, string> = {
  bienvenida: 'Bienvenida', canje: 'Plan Canje', tripleproteccion: 'Triple Protección',
}

const haceCuanto = (iso: string | null): string => {
  if (!iso) return ''
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)
  if (d <= 0) return 'hoy'
  if (d === 1) return 'ayer'
  if (d < 30) return `hace ${d} d`
  const m = Math.round(d / 30)
  return `hace ${m} ${m === 1 ? 'mes' : 'meses'}`
}

const fecha = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('es-AR', { day: '2-digit', month: 'short' }) : '—'

const plata = (n: number) =>
  n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `$${Math.round(n / 1000)}k` : `$${Math.round(n)}`

const num = (v: number | string | null | undefined) => Number(v ?? 0) || 0

const sinCerrar = (f: Fila) => !!f.carrito_unidades && !f.carrito_pedido && f.pedidos === 0

/**
 * Las variables del tablero. Cada una sabe contarse, filtrar su propio listado y
 * ordenarlo por lo que importa en ella: al abrir "minutos mirando" el primero tiene
 * que ser el que más miró, no el último que entró.
 */
interface Variable {
  key: string
  label: string
  icono: typeof Eye
  /** Quiénes están detrás del número. */
  filtro: (f: Fila) => boolean
  /** El número grande. Por defecto, cuántas ópticas. */
  valor?: (fs: Fila[]) => string
  /** La línea chica de abajo. */
  pie?: (fs: Fila[]) => string
  orden: (a: Fila, b: Fila) => number
  /** Qué explicar cuando se abre el detalle. */
  ayuda: string
  destacar?: boolean
}

const desc = (v: (f: Fila) => number) => (a: Fila, b: Fila) => v(b) - v(a)
const fechaDesc = (v: (f: Fila) => string | null) => (a: Fila, b: Fila) =>
  new Date(v(b) ?? 0).getTime() - new Date(v(a) ?? 0).getTime()

const VARIABLES: Variable[] = [
  {
    key: 'enviados', label: 'Mensajes enviados', icono: Send,
    filtro: (f) => f.envios > 0,
    valor: (fs) => String(fs.reduce((a, f) => a + f.envios, 0)),
    pie: (fs) => `a ${fs.length} ${fs.length === 1 ? 'óptica' : 'ópticas'}`,
    orden: desc((f) => f.envios),
    ayuda: 'Lo que salió desde Mi tanda en el período. El número grande son mensajes; abajo, a cuántas ópticas.',
  },
  {
    key: 'abrieron', label: 'Abrieron el catálogo', icono: Eye,
    filtro: (f) => f.visitas_catalogo > 0 || f.sesiones > 0,
    orden: desc((f) => Math.max(f.visitas_catalogo, f.sesiones)),
    ayuda: 'Entraron al catálogo con su propio link. Ordenadas por cuántas veces volvieron.',
  },
  {
    key: 'tiempo', label: 'Minutos mirando', icono: Clock,
    filtro: (f) => f.minutos > 0,
    valor: (fs) => String(fs.reduce((a, f) => a + f.minutos, 0)),
    pie: (fs) => `${fs.length} ${fs.length === 1 ? 'óptica' : 'ópticas'} con tiempo medido`,
    orden: desc((f) => f.minutos),
    ayuda: 'Tiempo con el catálogo a la vista. No cuenta la pestaña abierta de fondo. La que más miró va primero.',
  },
  {
    key: 'propuesta', label: 'Abrieron una propuesta', icono: FileText,
    filtro: (f) => f.visitas_landing > 0,
    orden: fechaDesc((f) => f.abrio_propuesta),
    ayuda: 'Abrieron Bienvenida, Plan Canje o Triple Protección desde su link.',
  },
  {
    key: 'contestaron', label: 'Contestaron', icono: MessageCircle,
    filtro: (f) => f.respuestas > 0,
    orden: fechaDesc((f) => f.respondio),
    ayuda: 'Escribieron de vuelta. La respuesta más fresca arriba.',
  },
  {
    key: 'carrito', label: 'Armaron carrito', icono: ShoppingCart,
    filtro: (f) => !!f.carrito_unidades,
    pie: (fs) => plata(fs.reduce((a, f) => a + num(f.carrito_importe), 0)) + ' cargados',
    orden: desc((f) => num(f.carrito_importe)),
    ayuda: 'Eligieron productos en el catálogo. Ordenadas por lo que tienen cargado.',
  },
  {
    key: 'sin_cerrar', label: 'Carrito sin cerrar', icono: Wallet, destacar: true,
    filtro: sinCerrar,
    pie: (fs) => plata(fs.reduce((a, f) => a + num(f.carrito_importe), 0)) + ' sin cerrar',
    orden: desc((f) => num(f.carrito_importe)),
    ayuda: 'Armaron el pedido y no lo terminaron. Es la plata más cerca de entrar: son las llamadas de hoy.',
  },
  {
    key: 'compraron', label: 'Compraron', icono: Wallet,
    filtro: (f) => f.pedidos > 0,
    pie: (fs) => plata(fs.reduce((a, f) => a + num(f.comprado), 0)) + ' facturados',
    orden: desc((f) => num(f.comprado)),
    ayuda: 'Terminaron en pedido dentro del período.',
  },
]

export default function PanelResultados() {
  const { rolEfectivo } = useAuth()
  const [filas, setFilas] = useState<Fila[]>([])
  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)
  const [dias, setDias] = useState(30)
  const [foco, setFoco] = useState<string>('sin_cerrar')
  const [vendedorFoco, setVendedorFoco] = useState<string | null>(null)
  const [abierta, setAbierta] = useState<string | null>(null)
  const [busca, setBusca] = useState('')

  // Lo ve todo el que participa del circuito comercial, con los números de todo el
  // equipo: la idea es que cada uno vea dónde está parado respecto del resto.
  const habilitado = rolEfectivo !== 'revendedor'

  const cargar = useCallback(async (d: number) => {
    setLoading(true)
    const desde = new Date(Date.now() - d * 86400000).toISOString()
    const [res, lea] = await Promise.all([
      supabase.rpc('panel_resultados', { p_dias: d }),
      supabase.from('prospeccion_social')
        .select('id, nombre, estado, zona, asignado_a, created_at')
        .eq('canal', 'meta_b2b').gte('created_at', desde).order('created_at', { ascending: false }),
    ])
    setFilas(res.error ? [] : ((res.data as Fila[]) ?? []))
    setLeads(lea.error ? [] : ((lea.data as Lead[]) ?? []))
    setLoading(false)
  }, [])

  useEffect(() => { if (habilitado) void cargar(dias) }, [dias, cargar, habilitado])

  // El corte por vendedor manda sobre todo el tablero: si elegís uno, las variables
  // pasan a contar solo lo suyo.
  const base = useMemo(
    () => (vendedorFoco ? filas.filter((f) => (f.vendedor || 'sin asignar') === vendedorFoco) : filas),
    [filas, vendedorFoco],
  )

  const variable = VARIABLES.find((v) => v.key === foco) ?? VARIABLES[0]

  const detalle = useMemo(() => {
    const q = busca.trim().toLowerCase()
    return base
      .filter(variable.filtro)
      .filter((f) => !q || (f.nombre ?? '').toLowerCase().includes(q) || f.cod.toLowerCase().includes(q))
      .sort(variable.orden)
  }, [base, variable, busca])

  const porVendedor = useMemo(() => {
    const m = new Map<string, { opticas: number; envios: number; abrio: number; carrito: number; vendido: number }>()
    for (const f of filas) {
      const k = f.vendedor || 'sin asignar'
      const v = m.get(k) ?? { opticas: 0, envios: 0, abrio: 0, carrito: 0, vendido: 0 }
      v.opticas++
      v.envios += f.envios
      if (f.visitas_catalogo > 0 || f.visitas_landing > 0) v.abrio++
      if (f.carrito_unidades) v.carrito++
      if (f.pedidos > 0) v.vendido += num(f.comprado)
      m.set(k, v)
    }
    return [...m.entries()].sort((a, b) => b[1].vendido - a[1].vendido || b[1].envios - a[1].envios)
  }, [filas])

  if (!habilitado)
    return (
      <div className="max-w-[1000px] mx-auto px-4 py-16 text-center">
        <p className="text-lg font-medium tracking-tight">Este panel es del equipo de Orbital</p>
        <p className="text-sm text-muted mt-2">Lo tuyo está en Cartera y en Pedidos.</p>
      </div>
    )

  return (
    <div className="max-w-[1200px] mx-auto px-4 py-8">
      <div className="flex flex-wrap items-end justify-between gap-4 mb-5">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Panel de resultados</h1>
          <p className="text-sm text-muted mt-1">
            Tocá cualquier variable y abajo se abre el detalle de las ópticas que hay detrás.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select value={dias} onChange={(e) => setDias(Number(e.target.value))}
            className="rounded-md border border-black/10 bg-white px-3 py-1.5 text-xs text-muted">
            <option value={7}>Últimos 7 días</option>
            <option value={30}>Últimos 30 días</option>
            <option value={90}>Últimos 90 días</option>
          </select>
          <button onClick={() => void cargar(dias)}
            className="rounded-md p-1.5 text-faint hover:bg-black/5 transition-colors" title="Actualizar">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {vendedorFoco && (
        <div className="flex items-center gap-2 mb-4 text-[12px]">
          <span className="text-muted">Mirando solo</span>
          <span className="rounded-full bg-brand text-white px-3 py-1 font-medium">{vendedorFoco}</span>
          <button onClick={() => setVendedorFoco(null)} className="text-faint hover:text-ink transition-colors">
            ver todo el equipo
          </button>
        </div>
      )}

      {/* Las variables. La que está abierta queda marcada. */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {VARIABLES.map((v) => {
          const suyas = base.filter(v.filtro)
          const activa = v.key === foco
          const Icono = v.icono
          return (
            <button key={v.key} onClick={() => { setFoco(v.key); setAbierta(null) }}
              className={`text-left rounded-lg border p-3 transition-colors ${
                activa ? 'border-brand bg-brand/[0.06] ring-1 ring-brand/20'
                       : v.destacar && suyas.length > 0 ? 'border-brandDark/30 bg-goldSoft/40 hover:bg-goldSoft/60'
                       : 'border-black/10 bg-white hover:bg-black/[0.02]'}`}>
              <div className="flex items-center gap-1.5 text-faint mb-1">
                <Icono size={12} />
                <p className="text-[11px] leading-tight">{v.label}</p>
              </div>
              <p className="text-2xl font-semibold tabular-nums tracking-tight">
                {v.valor ? v.valor(suyas) : suyas.length}
              </p>
              <p className="text-[11px] text-muted mt-0.5 tabular-nums">
                {v.pie ? v.pie(suyas) : `${suyas.length} ${suyas.length === 1 ? 'óptica' : 'ópticas'}`}
              </p>
            </button>
          )
        })}
      </div>

      {/* Por vendedor. Tocando una fila, todo el tablero se acota a esa persona. */}
      {porVendedor.length > 0 && (
        <div className="rounded-lg border border-black/10 bg-white overflow-x-auto mb-6">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="text-faint text-left border-b border-black/[0.07]">
                <th className="px-3 py-2 font-medium">Vendedor</th>
                <th className="px-3 py-2 font-medium text-right">Enviados</th>
                <th className="px-3 py-2 font-medium text-right">Ópticas</th>
                <th className="px-3 py-2 font-medium text-right">Abrieron</th>
                <th className="px-3 py-2 font-medium text-right">Carrito</th>
                <th className="px-3 py-2 font-medium text-right">Vendido</th>
              </tr>
            </thead>
            <tbody>
              {porVendedor.map(([k, v]) => (
                <tr key={k} onClick={() => setVendedorFoco(vendedorFoco === k ? null : k)}
                  className={`border-b border-black/[0.04] last:border-0 cursor-pointer transition-colors ${
                    vendedorFoco === k ? 'bg-brand/[0.06]' : 'hover:bg-black/[0.02]'}`}>
                  <td className="px-3 py-2 font-medium">{k}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{v.envios || '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{v.opticas}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{v.abrio || '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{v.carrito || '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-medium">{v.vendido ? plata(v.vendido) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* El detalle de la variable abierta. */}
      <div className="flex flex-wrap items-end justify-between gap-3 mb-3">
        <div>
          <h2 className="text-[15px] font-semibold tracking-tight">
            {variable.label} · {detalle.length}
          </h2>
          <p className="text-[12px] text-muted mt-0.5 max-w-2xl">{variable.ayuda}</p>
        </div>
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar óptica"
            className="rounded-md border border-black/10 bg-white pl-8 pr-3 py-1.5 text-xs w-48 focus:outline-none focus:ring-2 focus:ring-brand/20" />
        </div>
      </div>

      {loading && <p className="text-sm text-faint text-center py-16">Cargando…</p>}

      {!loading && detalle.length === 0 && (
        <div className="rounded-lg border border-black/10 bg-white text-center py-14">
          <p className="text-[15px] font-medium tracking-tight">Todavía no hay ninguna acá</p>
          <p className="text-sm text-muted mt-1.5">{variable.ayuda}</p>
        </div>
      )}

      {!loading && detalle.length > 0 && (
        <div className="rounded-lg border border-black/10 bg-white divide-y divide-black/[0.05]">
          {detalle.map((f) => (
            <div key={f.cod}>
              <button onClick={() => setAbierta(abierta === f.cod ? null : f.cod)}
                className="w-full text-left px-3 py-2.5 hover:bg-black/[0.02] transition-colors">
                <div className="flex items-center gap-3">
                  <ChevronDown size={13}
                    className={`shrink-0 text-faint transition-transform ${abierta === f.cod ? '' : '-rotate-90'}`} />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-[13px] truncate">{f.nombre}</p>
                    <p className="text-[11px] text-faint truncate">
                      {[f.vendedor, f.zona || f.provincia, f.posta ? POSTA[f.posta] ?? f.posta : null]
                        .filter(Boolean).join(' · ')}
                    </p>
                  </div>
                  {/* A la derecha, el número por el que está en esta lista. */}
                  <div className="shrink-0 text-right text-[12px] tabular-nums">
                    {foco === 'enviados' && <span>{f.envios} {f.envios === 1 ? 'mensaje' : 'mensajes'}</span>}
                    {foco === 'abrieron' && <span>{Math.max(f.visitas_catalogo, f.sesiones)} visitas</span>}
                    {foco === 'tiempo' && <span className="font-medium">{f.minutos} min</span>}
                    {foco === 'propuesta' && <span>{f.propuesta ? PROPUESTA[f.propuesta] ?? f.propuesta : 'Propuesta'}</span>}
                    {foco === 'contestaron' && <span>{f.respuestas} {f.respuestas === 1 ? 'respuesta' : 'respuestas'}</span>}
                    {(foco === 'carrito' || foco === 'sin_cerrar') && (
                      <span className="font-medium">{f.carrito_unidades}u · {plata(num(f.carrito_importe))}</span>
                    )}
                    {foco === 'compraron' && <span className="font-medium">{plata(num(f.comprado))}</span>}
                    <p className="text-faint text-[11px]">
                      {foco === 'tiempo' ? haceCuanto(f.ultima_sesion)
                        : foco === 'contestaron' ? haceCuanto(f.respondio)
                        : foco === 'propuesta' ? haceCuanto(f.abrio_propuesta)
                        : foco === 'carrito' || foco === 'sin_cerrar' ? haceCuanto(f.carrito_at)
                        : haceCuanto(f.abrio_catalogo ?? f.ultimo_envio)}
                    </p>
                  </div>
                </div>
              </button>

              {/* Todo lo que sabemos de esa óptica, para no tener que ir a buscarlo. */}
              {abierta === f.cod && (
                <div className="px-3 pb-3.5 pt-1 bg-black/[0.015]">
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                    {[
                      { l: 'Le mandamos', v: f.envios ? `${f.envios} mensajes` : '—', s: f.ultima_pieza ?? f.ultimo_canal ?? '', d: f.ultimo_envio },
                      { l: 'Catálogo', v: f.visitas_catalogo || f.sesiones ? `${Math.max(f.visitas_catalogo, f.sesiones)} visitas` : '—', s: f.minutos ? `${f.minutos} min mirando` : '', d: f.abrio_catalogo ?? f.ultima_sesion },
                      { l: 'Propuesta', v: f.visitas_landing ? (f.propuesta ? PROPUESTA[f.propuesta] ?? f.propuesta : 'Abrió') : '—', s: '', d: f.abrio_propuesta },
                      { l: 'Contestó', v: f.respuestas ? `${f.respuestas} mensajes` : '—', s: '', d: f.respondio },
                      { l: 'Carrito', v: f.carrito_unidades ? `${f.carrito_unidades}u · ${plata(num(f.carrito_importe))}` : '—', s: f.carrito_unidades ? (f.carrito_pedido || f.pedidos > 0 ? 'cerrado' : f.carrito_confirmado ? 'sin cerrar' : 'lo dejó cargado') : '', d: f.carrito_at },
                      { l: 'Compró', v: f.pedidos ? plata(num(f.comprado)) : '—', s: f.pedidos ? `${f.pedidos} ${f.pedidos === 1 ? 'pedido' : 'pedidos'}` : '', d: null },
                    ].map((c) => (
                      <div key={c.l} className="rounded-md border border-black/[0.07] bg-white p-2.5">
                        <p className="text-[10px] uppercase tracking-wider text-faint">{c.l}</p>
                        <p className="text-[13px] font-medium tabular-nums mt-0.5">{c.v}</p>
                        {c.s && <p className="text-[11px] text-muted truncate">{c.s}</p>}
                        {c.d && <p className="text-[11px] text-faint tabular-nums">{fecha(c.d)}</p>}
                      </div>
                    ))}
                  </div>
                  <p className="text-[11px] text-faint mt-2 tabular-nums">
                    {f.cod}
                    {f.ultima_compra ? ` · última compra ${fecha(f.ultima_compra)}` : ' · nunca compró'}
                  </p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Leads de Meta: entran por afuera de la tanda, así que se cuentan aparte. */}
      {leads.length > 0 && (
        <div className="mt-6 rounded-lg border border-black/10 bg-white p-4">
          <p className="text-[11px] font-semibold tracking-[0.2em] uppercase text-faint mb-3">
            Leads de Meta ({leads.length})
          </p>
          <div className="flex flex-wrap gap-2">
            {Object.entries(
              leads.reduce<Record<string, number>>((acc, l) => {
                const k = l.estado || 'nuevo'
                acc[k] = (acc[k] ?? 0) + 1
                return acc
              }, {}),
            ).map(([k, n]) => (
              <span key={k} className="rounded-full border border-black/10 px-3 py-1 text-[11px]">
                {k} · <span className="tabular-nums font-medium">{n}</span>
              </span>
            ))}
          </div>
          <p className="text-[11px] text-muted mt-3">
            Los que ya tienen ficha de cliente aparecen también arriba, con toda su interacción.
          </p>
        </div>
      )}
    </div>
  )
}
