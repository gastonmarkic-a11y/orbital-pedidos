import { useState } from 'react'
import { EstadoPedido, Pedido, StockItem } from '../../lib/types'
import { formatPrecio } from '../../lib/format'
import { calcImporte, esPedidoShopify, estadoLabel, importeDe } from './calc'

// Qué tiene que pasar para que el pedido llegue a cobrarse, y quién lo mueve.
export const ETAPAS_COBRO: { id: EstadoPedido; accion: string }[] = [
  { id: 'pendiente', accion: 'Depósito: arrancar a armar' },
  { id: 'en_preparacion', accion: 'Depósito: terminar de armar' },
  { id: 'observado', accion: 'Resolver la observación de depósito' },
  { id: 'listo', accion: 'Administración: facturar' },
  { id: 'facturado', accion: 'Depósito: preparar el despacho' },
  { id: 'listo_despachar', accion: 'Despachar' },
  { id: 'despachado', accion: 'Entregado: cobrar' },
]

export function accionDe(p: Pedido): string {
  if (p.estado === 'en_preparacion' && p.esperando_stock) return 'Espera stock de producción'
  if (p.estado !== 'despachado' && p.nro_factura) return 'Facturado pero sin despachar: revisar'
  return ETAPAS_COBRO.find((e) => e.id === (p.estado ?? 'pendiente'))?.accion ?? ''
}

/** Unidades y plata que todavía no salieron (ítems con `pendiente`). Despachado completo = 0. */
export function faltanteDe(p: Pedido, stock: StockItem[]) {
  const items = p.items ?? []
  if (p.estado === 'despachado' && !p.entrega_parcial) return { uds: 0, importe: 0, items: [] }
  const falt = items.filter((i) => (i.pendiente ?? 0) > 0)
  const uds = falt.reduce((a, i) => a + (i.pendiente ?? 0), 0)
  let importe = calcImporte(
    falt.map((i) => ({ ...i, cantidad: i.pendiente ?? 0 })),
    stock,
    p.dto_comercial,
    p.dto_financiero,
    p.nro_lista,
    esPedidoShopify(p)
  ).neto
  // Sin precio por ítem: proporcional a las unidades.
  const total = importeDe(p, stock)
  const udsTot = p.total_units || items.reduce((a, i) => a + i.cantidad, 0)
  if (!importe && uds && udsTot) importe = Math.round((total * uds) / udsTot)
  return { uds, importe, items: falt }
}

function entregaTexto(p: Pedido, faltan: number, uds: number) {
  if (p.estado === 'despachado' && !faltan) return 'Entregado completo'
  if (p.entrega_parcial || p.estado === 'despachado') return `Salieron ${uds - faltan}, faltan ${faltan}`
  if (faltan) return `No salió · ${faltan} sin stock`
  return 'No salió todavía'
}

export default function FichaCobranza({
  pedidos,
  stock,
  onCerrar,
}: {
  pedidos: Pedido[]
  stock: StockItem[]
  onCerrar: () => void
}) {
  const [abierto, setAbierto] = useState<number | null>(null)
  const nombre = (pedidos[0]?.cliente || '').replace(/^\d+ - /, '')
  const cod = pedidos[0]?.cod_cliente
  const filas = [...pedidos]
    .sort((a, b) => a.id - b.id)
    .map((p) => {
      const imp = importeDe(p, stock)
      const uds = p.total_units || (p.items ?? []).reduce((a, i) => a + i.cantidad, 0)
      return { p, imp, uds, falt: faltanteDe(p, stock) }
    })
  const udsTot = filas.reduce((a, f) => a + f.uds, 0)
  const porCobrar = filas.filter((f) => !f.p.cobrado)
  const deudaTot = porCobrar.reduce((a, f) => a + f.imp, 0)
  const cobrableYa = porCobrar
    .filter((f) => f.p.estado === 'despachado')
    .reduce((a, f) => a + f.imp - f.falt.importe, 0)
  const trabado = deudaTot - cobrableYa
  const porEtapa = ETAPAS_COBRO.map((e) => {
    const fs = porCobrar.filter((f) => (f.p.estado ?? 'pendiente') === e.id)
    return { ...e, n: fs.length, monto: fs.reduce((a, f) => a + f.imp, 0) }
  }).filter((e) => e.n)

  return (
    <div className="bg-white border border-black/10 rounded-xl p-3 space-y-3">
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold">
            {nombre} {cod ? <span className="text-faint font-normal">({cod})</span> : null}
          </p>
          <p className="text-xs text-muted">
            {filas.length} pedido{filas.length === 1 ? '' : 's'} · <b>{udsTot.toLocaleString('es-AR')} unidades</b>
          </p>
        </div>
        <button onClick={onCerrar} className="text-xs text-muted underline shrink-0">
          Cerrar
        </button>
      </div>

      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-lg border border-orange-200 bg-orange-50 p-2">
          <p className="text-sm font-bold text-orange-600">{formatPrecio(deudaTot) || '$ 0'}</p>
          <p className="text-[10px] uppercase tracking-wide text-orange-700 font-semibold">Por cobrar</p>
        </div>
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-2">
          <p className="text-sm font-bold text-emerald-600">{formatPrecio(cobrableYa) || '$ 0'}</p>
          <p className="text-[10px] uppercase tracking-wide text-emerald-700 font-semibold">Entregado, cobrable ya</p>
        </div>
        <div className="rounded-lg border border-red-200 bg-red-50 p-2">
          <p className="text-sm font-bold text-red-600">{formatPrecio(trabado) || '$ 0'}</p>
          <p className="text-[10px] uppercase tracking-wide text-red-700 font-semibold">Trabado sin entregar</p>
        </div>
      </div>

      {porEtapa.length > 0 && (
        <div className="space-y-1">
          <p className="text-[11px] uppercase tracking-wide text-faint font-semibold">Por cobrar según etapa</p>
          {porEtapa.map((e) => (
            <div key={e.id} className="flex items-center gap-2 text-xs">
              <span className="w-36 shrink-0">{estadoLabel(e.id)}</span>
              <span className="flex-1 text-muted truncate">→ {e.accion}</span>
              <span className="font-semibold shrink-0">{formatPrecio(e.monto) || '$ 0'}</span>
            </div>
          ))}
        </div>
      )}

      <div className="overflow-x-auto -mx-3 px-3">
        <table className="w-full text-xs min-w-[640px]">
          <thead>
            <tr className="text-left text-faint border-b border-black/10">
              <th className="py-1.5 pr-2">#</th>
              <th className="py-1.5 pr-2">Fecha</th>
              <th className="py-1.5 pr-2 text-right">Uds</th>
              <th className="py-1.5 pr-2 text-right">Importe neto</th>
              <th className="py-1.5 pr-2">Estado / quién lo mueve</th>
              <th className="py-1.5">Entregado / pendiente</th>
            </tr>
          </thead>
          <tbody>
            {filas.map(({ p, imp, uds, falt }) => (
              <tr key={p.id} className="border-b border-black/5 align-top">
                <td className="py-2 pr-2 font-semibold">{p.id}</td>
                <td className="py-2 pr-2 whitespace-nowrap">{(p.fecha || '').split(',')[0]}</td>
                <td className="py-2 pr-2 text-right">{uds}</td>
                <td className="py-2 pr-2 text-right whitespace-nowrap">
                  {formatPrecio(imp) || '$ 0'}
                  {p.cobrado ? <p className="text-emerald-600">✅ cobrado</p> : null}
                  {!imp && p.obs ? <p className="text-faint">{p.obs}</p> : null}
                </td>
                <td className="py-2 pr-2">
                  <p>{estadoLabel(p.estado)}</p>
                  {!p.cobrado && <p className="text-orange-700">→ {accionDe(p)}</p>}
                </td>
                <td className="py-2">
                  <p className={falt.uds ? 'font-semibold' : ''}>{entregaTexto(p, falt.uds, uds)}</p>
                  {falt.importe > 0 && <p className="text-red-600">{formatPrecio(falt.importe)} sin entregar</p>}
                  <p className="text-faint">
                    {[p.nro_remito && `Rem. ${p.nro_remito}`, p.nro_factura && `Fact. ${p.nro_factura}`, p.nro_guia && `Guía ${p.nro_guia}`]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                  {(falt.items.length > 0 || p.obs_deposito) && (
                    <button onClick={() => setAbierto(abierto === p.id ? null : p.id)} className="text-blue-600 underline">
                      {abierto === p.id ? 'Ocultar' : 'Qué falta'}
                    </button>
                  )}
                  {abierto === p.id && (
                    <div className="mt-1 space-y-0.5">
                      {falt.items.map((i) => (
                        <p key={i.codigo}>
                          {i.modelo} {i.descripcion}: <b>{i.pendiente}</b>
                        </p>
                      ))}
                      {p.obs_deposito && <p className="text-muted italic">Depósito: {p.obs_deposito}</p>}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
