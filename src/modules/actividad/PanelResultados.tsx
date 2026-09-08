import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'
import { RefreshCw, Search, ShoppingCart, MessageCircle, Eye, FileText } from 'lucide-react'

// Panel de resultados — qué pasó con cada óptica, venga de donde venga el contacto.
//
// Seguimiento le contesta al vendedor "qué pasó con lo que MANDÉ". Este panel le
// contesta a la dirección "qué está pasando con TODO": la tanda, los leads de Meta,
// el que entró al catálogo solo. Una fila por óptica con la interacción entera, y
// arriba el embudo, que es lo que dice dónde se está cayendo la venta.

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
  visitas_landing: number
  abrio_propuesta: string | null
  propuesta: string | null
  respuestas: number
  respondio: string | null
  carrito_unidades: number | null
  carrito_importe: number | string | null
  carrito_estado: string | null
  carrito_at: string | null
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

const plata = (n: number) =>
  n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `$${Math.round(n / 1000)}k` : `$${Math.round(n)}`

const num = (v: number | string | null | undefined) => Number(v ?? 0) || 0

/** El escalón más alto que alcanzó la óptica: define en qué fila del embudo cuenta. */
function escalon(f: Fila): 'compro' | 'carrito' | 'respondio' | 'abrio' | 'contactado' {
  if (f.pedidos > 0) return 'compro'
  if (f.carrito_unidades) return 'carrito'
  if (f.respuestas > 0) return 'respondio'
  if (f.visitas_catalogo > 0 || f.visitas_landing > 0) return 'abrio'
  return 'contactado'
}

type Filtro = 'todos' | 'abandonaron' | 'reaccionaron' | 'sin_reaccion'

export default function PanelResultados() {
  const { rolEfectivo } = useAuth()
  const [filas, setFilas] = useState<Fila[]>([])
  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)
  const [dias, setDias] = useState(30)
  const [filtro, setFiltro] = useState<Filtro>('todos')
  const [busca, setBusca] = useState('')

  const habilitado = rolEfectivo === 'admin' || rolEfectivo === 'administracion'

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

  const totales = useMemo(() => {
    const t = { opticas: filas.length, envios: 0, abrio: 0, propuesta: 0, respondio: 0, carrito: 0, compro: 0, enCarrito: 0, vendido: 0 }
    for (const f of filas) {
      t.envios += f.envios
      if (f.visitas_catalogo > 0) t.abrio++
      if (f.visitas_landing > 0) t.propuesta++
      if (f.respuestas > 0) t.respondio++
      if (f.carrito_unidades) { t.carrito++; t.enCarrito += num(f.carrito_importe) }
      if (f.pedidos > 0) { t.compro++; t.vendido += num(f.comprado) }
    }
    return t
  }, [filas])

  // Carritos que quedaron a mitad de camino: armó el pedido en el catálogo y no cerró.
  const abandonados = useMemo(
    () => filas.filter((f) => f.carrito_unidades && !f.carrito_pedido && f.pedidos === 0),
    [filas],
  )

  const porVendedor = useMemo(() => {
    const m = new Map<string, { envios: number; opticas: number; abrio: number; respondio: number; carrito: number; compro: number; vendido: number }>()
    for (const f of filas) {
      const k = f.vendedor || 'sin asignar'
      const v = m.get(k) ?? { envios: 0, opticas: 0, abrio: 0, respondio: 0, carrito: 0, compro: 0, vendido: 0 }
      v.envios += f.envios
      v.opticas++
      if (f.visitas_catalogo > 0 || f.visitas_landing > 0) v.abrio++
      if (f.respuestas > 0) v.respondio++
      if (f.carrito_unidades) v.carrito++
      if (f.pedidos > 0) { v.compro++; v.vendido += num(f.comprado) }
      m.set(k, v)
    }
    return [...m.entries()].sort((a, b) => b[1].vendido - a[1].vendido || b[1].envios - a[1].envios)
  }, [filas])

  const visibles = useMemo(() => {
    const q = busca.trim().toLowerCase()
    return filas.filter((f) => {
      const e = escalon(f)
      if (filtro === 'abandonaron' && !(f.carrito_unidades && !f.carrito_pedido && f.pedidos === 0)) return false
      if (filtro === 'reaccionaron' && e === 'contactado') return false
      if (filtro === 'sin_reaccion' && e !== 'contactado') return false
      if (!q) return true
      return (f.nombre ?? '').toLowerCase().includes(q) || f.cod.toLowerCase().includes(q)
    })
  }, [filas, filtro, busca])

  if (!habilitado)
    return (
      <div className="max-w-[1000px] mx-auto px-4 py-16 text-center">
        <p className="text-lg font-medium tracking-tight">Este panel es de dirección</p>
        <p className="text-sm text-muted mt-2">Si trabajás una cartera, lo tuyo está en Seguimiento.</p>
      </div>
    )

  // El escalón "abrió" cuenta ópticas, no aperturas: la que abrió las dos cosas es una sola.
  const abrioAlgo = filas.filter((f) => f.visitas_catalogo > 0 || f.visitas_landing > 0).length
  const embudo: [string, number][] = [
    ['Ópticas con alguna interacción', totales.opticas],
    ['Abrieron el catálogo o una propuesta', abrioAlgo],
    ['Contestaron', totales.respondio],
    ['Armaron un carrito', totales.carrito],
    ['Terminaron comprando', totales.compro],
  ]
  const tope = Math.max(1, embudo[0][1])

  return (
    <div className="max-w-[1200px] mx-auto px-4 py-8">
      <div className="flex flex-wrap items-end justify-between gap-4 mb-5">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Panel de resultados</h1>
          <p className="text-sm text-muted mt-1">
            Toda la interacción de cada óptica: lo que le mandamos y lo que hizo con eso.
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

      {/* Los números de arriba. El que manda es lo vendido, no lo enviado. */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
        {[
          { n: String(totales.envios), l: 'mensajes enviados' },
          { n: String(totales.abrio), l: 'abrieron el catálogo' },
          { n: String(totales.propuesta), l: 'abrieron una propuesta' },
          { n: String(totales.respondio), l: 'contestaron' },
          { n: String(totales.carrito), l: 'armaron carrito', sub: plata(totales.enCarrito) },
          { n: String(totales.compro), l: 'compraron', sub: plata(totales.vendido), destacar: true },
        ].map((t) => (
          <div key={t.l} className={`rounded-lg border p-3 ${t.destacar ? 'border-brandDark/30 bg-goldSoft/40' : 'border-black/10 bg-white'}`}>
            <p className="text-2xl font-semibold tabular-nums tracking-tight">{t.n}</p>
            <p className="text-[11px] text-muted mt-0.5">{t.l}</p>
            {t.sub && <p className="text-[11px] font-medium tabular-nums mt-0.5">{t.sub}</p>}
          </div>
        ))}
      </div>

      {/* Embudo: dónde se cae la venta. */}
      <div className="rounded-lg border border-black/10 bg-white p-4 mb-6">
        <p className="text-[11px] font-semibold tracking-[0.2em] uppercase text-faint mb-3">Embudo</p>
        <div className="space-y-2">
          {embudo.map(([l, n]) => (
            <div key={l} className="flex items-center gap-3">
              <div className="w-56 shrink-0 text-[12px] text-muted">{l}</div>
              <div className="flex-1 h-5 rounded bg-black/[0.04] overflow-hidden">
                <div className="h-full bg-brand/70" style={{ width: `${Math.round((n / tope) * 100)}%` }} />
              </div>
              <div className="w-24 shrink-0 text-right text-[12px] tabular-nums">
                <span className="font-semibold">{n}</span>
                <span className="text-faint ml-1.5">{Math.round((n / tope) * 100)}%</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Por vendedor: cuántos contactos mueve cada uno y en qué terminan. */}
      {porVendedor.length > 0 && (
        <div className="rounded-lg border border-black/10 bg-white overflow-x-auto mb-6">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="text-faint text-left border-b border-black/[0.07]">
                <th className="px-3 py-2 font-medium">Vendedor</th>
                <th className="px-3 py-2 font-medium text-right">Enviados</th>
                <th className="px-3 py-2 font-medium text-right">Ópticas</th>
                <th className="px-3 py-2 font-medium text-right">Abrieron</th>
                <th className="px-3 py-2 font-medium text-right">Contestaron</th>
                <th className="px-3 py-2 font-medium text-right">Carrito</th>
                <th className="px-3 py-2 font-medium text-right">Compraron</th>
                <th className="px-3 py-2 font-medium text-right">Vendido</th>
              </tr>
            </thead>
            <tbody>
              {porVendedor.map(([k, v]) => (
                <tr key={k} className="border-b border-black/[0.04] last:border-0">
                  <td className="px-3 py-2 font-medium">{k}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{v.envios || '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{v.opticas}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{v.abrio || '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{v.respondio || '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{v.carrito || '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{v.compro || '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-medium">{v.vendido ? plata(v.vendido) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Carritos a medio armar: es la plata que está más cerca de entrar. */}
      {abandonados.length > 0 && (
        <div className="rounded-lg border border-brandDark/30 bg-goldSoft/30 p-4 mb-6">
          <div className="flex items-center gap-2 mb-2">
            <ShoppingCart size={14} />
            <p className="text-sm font-semibold">
              {abandonados.length} {abandonados.length === 1 ? 'óptica dejó' : 'ópticas dejaron'} el carrito sin cerrar
            </p>
          </div>
          <p className="text-[12px] text-muted mb-3">
            Armaron el pedido en el catálogo y no lo terminaron. Es lo primero para llamar hoy.
          </p>
          <div className="flex flex-wrap gap-2">
            {abandonados.slice(0, 12).map((f) => (
              <span key={f.cod} className="rounded-full bg-white border border-black/10 px-3 py-1 text-[11px]">
                {f.nombre} · <span className="tabular-nums">{f.carrito_unidades}u {plata(num(f.carrito_importe))}</span>
                <span className="text-faint ml-1">{haceCuanto(f.carrito_at)}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 mb-4">
        {([['todos', 'Todas'], ['reaccionaron', 'Reaccionaron'], ['abandonaron', 'Carrito sin cerrar'], ['sin_reaccion', 'Sin reacción']] as [Filtro, string][]).map(([k, l]) => (
          <button key={k} onClick={() => setFiltro(k)}
            className={`rounded-full px-3 py-1 text-xs transition-colors ${
              filtro === k ? 'bg-brand text-white' : 'border border-black/10 text-muted hover:bg-black/[0.03]'}`}>
            {l}
          </button>
        ))}
        <div className="relative ml-auto">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar óptica"
            className="rounded-md border border-black/10 bg-white pl-8 pr-3 py-1.5 text-xs w-48 focus:outline-none focus:ring-2 focus:ring-brand/20" />
        </div>
      </div>

      {loading && <p className="text-sm text-faint text-center py-16">Cargando…</p>}

      {!loading && visibles.length === 0 && (
        <div className="text-center py-16">
          <p className="text-lg font-medium tracking-tight">Todavía no hay interacciones en el período</p>
          <p className="text-sm text-muted mt-2">
            Acá aparece toda óptica que reciba un mensaje, abra el catálogo o conteste.
          </p>
        </div>
      )}

      {!loading && visibles.length > 0 && (
        <div className="rounded-lg border border-black/10 bg-white overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="text-faint text-left border-b border-black/[0.07]">
                <th className="px-3 py-2 font-medium">Óptica</th>
                <th className="px-3 py-2 font-medium">Vendedor</th>
                <th className="px-3 py-2 font-medium">Estado</th>
                <th className="px-3 py-2 font-medium">Le mandamos</th>
                <th className="px-3 py-2 font-medium">Catálogo</th>
                <th className="px-3 py-2 font-medium">Propuesta</th>
                <th className="px-3 py-2 font-medium">Contestó</th>
                <th className="px-3 py-2 font-medium">Carrito</th>
                <th className="px-3 py-2 font-medium text-right">Compró</th>
              </tr>
            </thead>
            <tbody>
              {visibles.map((f) => (
                <tr key={f.cod} className="border-b border-black/[0.04] last:border-0 align-top">
                  <td className="px-3 py-2">
                    <p className="font-medium">{f.nombre}</p>
                    <p className="text-faint text-[11px]">{f.zona || f.provincia || f.cod}</p>
                  </td>
                  <td className="px-3 py-2 text-muted">{f.vendedor || '—'}</td>
                  <td className="px-3 py-2 text-muted">{f.posta ? POSTA[f.posta] ?? f.posta : '—'}</td>
                  <td className="px-3 py-2">
                    {f.envios > 0 ? (
                      <>
                        <p className="tabular-nums">{f.envios} {f.envios === 1 ? 'mensaje' : 'mensajes'}</p>
                        <p className="text-faint text-[11px]">{haceCuanto(f.ultimo_envio)} · {f.ultima_pieza ?? f.ultimo_canal ?? ''}</p>
                      </>
                    ) : <span className="text-faint">—</span>}
                  </td>
                  <td className="px-3 py-2">
                    {f.visitas_catalogo > 0 ? (
                      <span className="inline-flex items-center gap-1">
                        <Eye size={11} /><span className="tabular-nums">{f.visitas_catalogo}</span>
                        <span className="text-faint">{haceCuanto(f.abrio_catalogo)}</span>
                      </span>
                    ) : <span className="text-faint">—</span>}
                  </td>
                  <td className="px-3 py-2">
                    {f.visitas_landing > 0 ? (
                      <span className="inline-flex items-center gap-1">
                        <FileText size={11} />
                        <span>{f.propuesta ? PROPUESTA[f.propuesta] ?? f.propuesta : ''}</span>
                        <span className="text-faint">{haceCuanto(f.abrio_propuesta)}</span>
                      </span>
                    ) : <span className="text-faint">—</span>}
                  </td>
                  <td className="px-3 py-2">
                    {f.respuestas > 0 ? (
                      <span className="inline-flex items-center gap-1">
                        <MessageCircle size={11} /><span className="tabular-nums">{f.respuestas}</span>
                        <span className="text-faint">{haceCuanto(f.respondio)}</span>
                      </span>
                    ) : <span className="text-faint">—</span>}
                  </td>
                  <td className="px-3 py-2">
                    {f.carrito_unidades ? (
                      <>
                        <p className="tabular-nums">{f.carrito_unidades}u · {plata(num(f.carrito_importe))}</p>
                        <p className={`text-[11px] ${f.carrito_pedido || f.pedidos > 0 ? 'text-faint' : 'font-medium'}`}>
                          {f.carrito_pedido || f.pedidos > 0 ? 'cerrado' : 'sin cerrar'}
                        </p>
                      </>
                    ) : <span className="text-faint">—</span>}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {f.pedidos > 0 ? (
                      <>
                        <p className="font-medium tabular-nums">{plata(num(f.comprado))}</p>
                        <p className="text-faint text-[11px] tabular-nums">{f.pedidos} {f.pedidos === 1 ? 'pedido' : 'pedidos'}</p>
                      </>
                    ) : <span className="text-faint">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
            Los que ya tienen ficha de cliente aparecen también en la tabla de arriba, con toda su interacción.
          </p>
        </div>
      )}
    </div>
  )
}
