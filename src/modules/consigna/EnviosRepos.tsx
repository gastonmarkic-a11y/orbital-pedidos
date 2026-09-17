// ── En camino y Reposición automática por venta ──────────────────────────────
// "camino": cada envío de Orbital como pedido (consigna_suc_mov tipo envio + el pedido de la Suite),
// con lo que todavía no recibió la sucursal.
// "repo": lo que generó la liquidación de ventas — reposición 1:1 de lo vendido (pedido automático) y
// los reemplazos a aprobar (saldos o sin stock central). Central ve todas; sucursal, la suya.
import { useEffect, useState } from 'react'
import { Truck, RefreshCw, ChevronDown } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import type { Central } from './CentralConsigna'

type Item = { codigo?: string; modelo: string; descripcion: string | null; cantidad: number; en_camino?: number; saldo?: boolean; motivo?: string }
type Envio = {
  pedido_id: string | null; sucursal_id: number; fecha: string; nota: string | null; estado: string | null
  entrega: string | null; total: number; pendiente: number; items: Item[]
}
type Repo = { id: number; sucursal_id: number; items: Item[]; sin_cubrir: number; estado: string; pedido_id: number | null }
type LiqSuc = { sucursal_id: number; vendido: number; saldo: number; items: Item[] }
type Liq = {
  id: number; archivo: string | null; desde: string | null; hasta: string | null; creado: string
  unidades: number | null; sucursales: LiqSuc[] | null; repos: Repo[] | null
}
type Datos = { envios: Envio[]; liquidaciones: Liq[] }

const fmt = (n: number) => n.toLocaleString('es-AR')
const fecha = (s: string | null) => (s ? new Date(s).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '—')

export default function EnviosRepos({ clave, data, modo }: { clave: string; data: Central; modo: 'camino' | 'repo' }) {
  const [d, setD] = useState<Datos | null>(null)
  const [abierto, setAbierto] = useState<string | null>(null)
  const nombreSuc = (id: number) => data.sucursales.find((s) => s.id === id)?.nombre ?? `#${id}`

  useEffect(() => {
    supabase.rpc('consigna_envios', { p_k: clave }).then(({ data, error }) => {
      setD(error ? { envios: [], liquidaciones: [] } : (data as Datos))
    })
  }, [clave])

  if (!d) return <p className="bg-white border border-black/10 rounded-lg text-sm text-muted px-4 py-6">Cargando…</p>

  if (modo === 'camino') {
    const envios = d.envios
    const totPend = envios.reduce((s, e) => s + e.pendiente, 0)
    return (
      <section className="bg-white border border-black/10 rounded-lg">
        <div className="px-4 py-3 border-b border-black/10 flex flex-wrap items-center gap-3">
          <h2 className="font-semibold flex items-center gap-2 mr-auto"><Truck size={16} className="text-emerald-700" /> Envíos en camino</h2>
          <span className="text-xs text-muted tabular-nums">Sin recibir <b className="text-emerald-700">{fmt(totPend)}</b> u</span>
        </div>
        <p className="text-xs text-muted px-4 pt-3">
          Cada envío de Orbital, como pedido. Lo recibe cada sucursal desde su tablero; hasta entonces figura acá.
        </p>
        {envios.length === 0 ? (
          <p className="text-sm text-muted px-4 py-6">No hay envíos.</p>
        ) : (
          <ul className="divide-y divide-black/5 mt-2">
            {envios.map((e) => {
              const id = `e${e.pedido_id ?? e.fecha}${e.sucursal_id}`
              return (
                <li key={id} className="px-4 py-3">
                  <button onClick={() => setAbierto(abierto === id ? null : id)} className="w-full text-left flex flex-wrap items-center gap-x-4 gap-y-1">
                    <span className="text-xs text-muted w-20 shrink-0">{fecha(e.fecha)}</span>
                    <span className="text-sm font-medium min-w-[150px]">{nombreSuc(e.sucursal_id)}</span>
                    <span className="text-xs text-muted flex-1 min-w-[160px] truncate">
                      {e.pedido_id ? `Pedido #${e.pedido_id}` : 'Carga inicial'}{e.nota ? ` · ${e.nota}` : ''}
                    </span>
                    <span className="text-sm tabular-nums">{fmt(e.total)} u</span>
                    {e.pendiente > 0
                      ? <span className="text-xs bg-emerald-100 text-emerald-900 rounded-md px-2 py-0.5">{fmt(e.pendiente)} sin recibir</span>
                      : <span className="text-xs text-muted">recibido</span>}
                    <ChevronDown size={14} className={`text-muted transition-transform ${abierto === id ? 'rotate-180' : ''}`} />
                  </button>
                  {abierto === id && (
                    <ul className="mt-2 ml-20 grid sm:grid-cols-2 gap-x-6">
                      {e.items.map((i) => (
                        <li key={i.codigo} className="text-xs flex items-center gap-2 py-0.5">
                          <span className="font-semibold tracking-wide">{i.modelo}</span>
                          <span className="text-muted truncate">{i.descripcion}</span>
                          <span className="ml-auto tabular-nums">{i.cantidad}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </section>
    )
  }

  const liqs = d.liquidaciones
  return (
    <section className="bg-white border border-black/10 rounded-lg">
      <div className="px-4 py-3 border-b border-black/10">
        <h2 className="font-semibold flex items-center gap-2"><RefreshCw size={16} className="text-gold" /> Reposición automática por venta</h2>
      </div>
      <p className="text-xs text-muted px-4 pt-3 leading-relaxed">
        Con cada liquidación que nos pasan, el sistema repone solo: <b className="text-ink">1 a 1 lo vendido</b>, que sale
        como pedido automático y les llega a la sucursal. Lo que fue <b className="text-ink">venta por saldo</b> o no tiene
        stock en Orbital se cambia por <b className="text-ink">reemplazos</b> (lo más vendido de la cadena, después lo más
        vendido de Orbital, después productos nuevos) y esos los revisa Orbital antes de despacharlos.
      </p>
      {liqs.length === 0 ? (
        <p className="text-sm text-muted px-4 py-6">Todavía no hay liquidaciones cargadas.</p>
      ) : (
        <div className="px-4 py-3 flex flex-col gap-4">
          {liqs.map((l) => (
            <div key={l.id} className="border border-black/10 rounded-lg">
              <div className="px-3 py-2 border-b border-black/5 flex flex-wrap items-center gap-x-4 gap-y-1 bg-[#FBF9F4] rounded-t-lg">
                <span className="text-sm font-semibold">Liquidación #{l.id}</span>
                <span className="text-xs text-muted">{fecha(l.desde)} a {fecha(l.hasta)}</span>
                <span className="text-xs text-muted ml-auto tabular-nums">{fmt(l.unidades ?? 0)} u vendidas</span>
              </div>
              <ul className="divide-y divide-black/5">
                {(l.sucursales ?? []).map((s) => {
                  const repos = (l.repos ?? []).filter((r) => r.sucursal_id === s.sucursal_id)
                  const reemp = repos.reduce((n, r) => n + (r.items ?? []).reduce((m, i) => m + i.cantidad, 0), 0)
                  const sinCubrir = repos.reduce((n, r) => n + r.sin_cubrir, 0)
                  const aAprobar = repos.some((r) => r.estado === 'pendiente')
                  return (
                    <li key={s.sucursal_id} className="px-3 py-2 text-sm flex flex-wrap items-center gap-x-4 gap-y-1">
                      <span className="font-medium min-w-[150px]">{nombreSuc(s.sucursal_id)}</span>
                      <span className="text-xs text-muted tabular-nums">vendió {fmt(s.vendido)}{s.saldo > 0 ? ` · ${fmt(s.saldo)} por saldo` : ''}</span>
                      <span className="text-xs tabular-nums">repone <b>{fmt(s.vendido - s.saldo)}</b> igual</span>
                      {reemp > 0 && (
                        <span className={`text-xs rounded-md px-2 py-0.5 ${aAprobar ? 'bg-amber-100 text-amber-900' : 'bg-emerald-100 text-emerald-900'}`}>
                          {fmt(reemp)} de reemplazo{aAprobar ? ' · Orbital lo está revisando' : ' · aprobado'}
                        </span>
                      )}
                      {sinCubrir > 0 && <span className="text-xs text-muted">{fmt(sinCubrir)} sin cubrir</span>}
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
