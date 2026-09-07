/* Cuentas corrientes por óptica, con aging automático.

   No se carga nada a mano: cada factura impaga se abre en sus cuotas según la forma de
   pago pactada (cond_pago / cuotas_detalle) y cada cuota se ubica en su tramo de mora.
   Los tramos son días de MORA desde el vencimiento pactado, no días desde la factura:
   una factura a 90 días recién nacida no es deuda vieja, y así se ve. */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Pedido, StockItem, ParametrosFin } from '../../lib/types'
import {
  agruparPorCliente,
  plata,
  pct,
  totalesPorTramo,
  TRAMOS,
  TramoId,
  VencimientoCC,
} from '../../lib/finanzas'
import { importeDe } from '../pedidos/calc'
import { Btn, Chip, FIN, Kpi, Nota, Panel, Selector, Tabla, Td, Th, Vacio } from './ui'
import { cargarPedidosCC, vencimientosDe, ventasUltimos12 } from './datos'

const COLOR_TRAMO: Record<TramoId, string> = {
  por_vencer: FIN.tenue,
  t0_30: FIN.verde,
  t31_60: FIN.ambar,
  t61_90: '#FB923C',
  t90: FIN.rojo,
}

export default function CuentasCorrientes({ params }: { params: ParametrosFin | null }) {
  const [pedidos, setPedidos] = useState<Pedido[]>([])
  const [stock, setStock] = useState<StockItem[]>([])
  const [ventasAnuales, setVentasAnuales] = useState(0)
  const [loading, setLoading] = useState(true)
  const [vendedor, setVendedor] = useState('')
  const [soloMora, setSoloMora] = useState(false)
  const [abierto, setAbierto] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    const [{ pedidos: ps, stock: st }, ventas] = await Promise.all([cargarPedidosCC(), ventasUltimos12()])
    setPedidos(ps)
    setStock(st)
    setVentasAnuales(ventas)
    setLoading(false)
  }, [])

  useEffect(() => {
    cargar()
  }, [cargar])

  const vencimientos: VencimientoCC[] = useMemo(() => vencimientosDe(pedidos, stock), [pedidos, stock])

  const filtrados = useMemo(
    () => (vendedor ? vencimientos.filter((v) => v.vendedor === vendedor) : vencimientos),
    [vencimientos, vendedor]
  )

  const tramos = useMemo(() => totalesPorTramo(filtrados), [filtrados])
  const clientes = useMemo(() => {
    const l = agruparPorCliente(filtrados)
    return soloMora ? l.filter((c) => c.total - c.porTramo.por_vencer > 0) : l
  }, [filtrados, soloMora])

  const total = Object.values(tramos).reduce((a, n) => a + n, 0)
  const enMora = total - tramos.por_vencer
  const pct90 = total > 0 ? tramos.t90 / total : 0
  const limite = (params?.alerta_mora_pct ?? 15) / 100
  const dso = ventasAnuales > 0 ? (total / ventasAnuales) * 365 : 0

  const vendedores = useMemo(
    () => [...new Set(vencimientos.map((v) => v.vendedor).filter(Boolean))].sort(),
    [vencimientos]
  )

  const detalleCliente = useMemo(() => {
    if (!abierto) return null
    const vencs = filtrados.filter((v) => (v.cod || v.cliente) === abierto)
    const cod = vencs[0]?.cod
    const delCliente = pedidos.filter((p) => (cod ? p.cod_cliente === cod : (p.cliente ?? '').includes(abierto)))
    const facturado12 = delCliente
      .filter((p) => (p.fecha_factura ?? '') >= hace12Meses())
      .reduce((a, p) => a + importeDe(p, stock), 0)
    const cobrado12 = delCliente
      .filter((p) => p.cobrado && (p.fecha_factura ?? '') >= hace12Meses())
      .reduce((a, p) => a + importeDe(p, stock), 0)
    return { vencs, facturas: delCliente.filter((p) => !p.cobrado), facturado12, cobrado12 }
  }, [abierto, filtrados, pedidos, stock])

  if (loading) return <p className="text-[12px] p-4" style={{ color: FIN.tenue }}>Calculando cuentas corrientes…</p>

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Kpi label="Cartera a cobrar" valor={plata(total)} nota={`${clientes.length} cliente(s)`} />
        <Kpi label="En mora" valor={plata(enMora)} nota={total > 0 ? pct(enMora / total) + ' de la cartera' : '—'} />
        <Kpi
          label="+90 días"
          valor={plata(tramos.t90)}
          nota={`${pct(pct90)} · alerta sobre ${params?.alerta_mora_pct ?? 15}%`}
          estado={pct90 > limite ? 'rojo' : pct90 > limite * 0.7 ? 'ambar' : 'verde'}
        />
        <Kpi
          label="DSO"
          valor={`${Math.round(dso)} d`}
          nota={ventasAnuales > 0 ? 'sobre ventas de 12 meses' : 'faltan ventas históricas'}
        />
      </div>

      {pct90 > limite && (
        <div className="rounded-md border px-3 py-2" style={{ borderColor: FIN.rojo + '66', background: FIN.rojo + '12' }}>
          <p className="text-[12px]" style={{ color: FIN.rojo }}>
            El tramo +90 días es el <b>{pct(pct90)}</b> de la cartera y supera el límite configurado de{' '}
            {params?.alerta_mora_pct ?? 15}%. Son {plata(tramos.t90)} con más de tres meses de mora.
          </p>
        </div>
      )}

      <Panel
        titulo="Aging por cliente"
        nota="Tramos en días de mora desde el vencimiento pactado."
        derecha={
          <>
            <Selector
              value={vendedor}
              onChange={setVendedor}
              opciones={[{ id: '', label: 'Todos los vendedores' }, ...vendedores.map((v) => ({ id: v, label: v }))]}
            />
            <Btn onClick={() => setSoloMora((v) => !v)}>{soloMora ? 'Ver todos' : 'Solo con mora'}</Btn>
          </>
        }
      >
        <div className="grid grid-cols-5 gap-2 mb-3">
          {TRAMOS.map((t) => (
            <div key={t.id} className="rounded border px-2 py-1.5" style={{ borderColor: FIN.borde }}>
              <p className="text-[10px] uppercase tracking-[0.14em]" style={{ color: COLOR_TRAMO[t.id] }}>
                {t.label}
              </p>
              <p className="font-jet text-[13px] tabular-nums mt-0.5">{plata(tramos[t.id])}</p>
              <p className="font-jet text-[10px]" style={{ color: FIN.tenue }}>
                {total > 0 ? pct(tramos[t.id] / total, 0) : '—'}
              </p>
            </div>
          ))}
        </div>

        {clientes.length === 0 ? (
          <Vacio>No hay facturas impagas. (Solo entran pedidos facturados y sin cobrar, mayoristas.)</Vacio>
        ) : (
          <Tabla>
            <thead>
              <tr>
                <Th>Cliente</Th>
                <Th>Vend.</Th>
                {TRAMOS.map((t) => (
                  <Th key={t.id} num>
                    {t.label}
                  </Th>
                ))}
                <Th num>Total</Th>
                <Th num>Mora máx</Th>
              </tr>
            </thead>
            <tbody>
              {clientes.map((c) => (
                <tr
                  key={c.cod || c.cliente}
                  onClick={() => setAbierto(abierto === (c.cod || c.cliente) ? null : c.cod || c.cliente)}
                  className="cursor-pointer"
                >
                  <Td>{c.cliente || c.cod}</Td>
                  <Td color={FIN.tenue}>{c.vendedor}</Td>
                  {TRAMOS.map((t) => (
                    <Td key={t.id} num color={c.porTramo[t.id] > 0 ? COLOR_TRAMO[t.id] : FIN.tenue}>
                      {c.porTramo[t.id] > 0 ? plata(c.porTramo[t.id]) : '·'}
                    </Td>
                  ))}
                  <Td num>{plata(c.total)}</Td>
                  <Td num color={c.masViejo > 90 ? FIN.rojo : FIN.tenue}>
                    {c.masViejo > 0 ? `${c.masViejo} d` : '—'}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Tabla>
        )}
        <Nota>
          Cuando un pedido no tiene forma de pago cargada se toma 30 días desde la factura. Los pedidos de la Tienda
          (consumidor final) no entran: se cobran al contado.
        </Nota>
      </Panel>

      {abierto && detalleCliente && (
        <Panel
          titulo={`Detalle · ${clientes.find((c) => (c.cod || c.cliente) === abierto)?.cliente ?? abierto}`}
          nota="Facturación y cobro de los últimos 12 meses"
          derecha={<Btn onClick={() => setAbierto(null)}>Cerrar</Btn>}
        >
          <div className="grid grid-cols-3 gap-2 mb-3">
            <Kpi label="Facturado 12m" valor={plata(detalleCliente.facturado12)} />
            <Kpi label="Cobrado 12m" valor={plata(detalleCliente.cobrado12)} />
            <Kpi
              label="Pendiente"
              valor={plata(detalleCliente.facturado12 - detalleCliente.cobrado12)}
              estado={detalleCliente.facturado12 - detalleCliente.cobrado12 > 0 ? 'ambar' : 'verde'}
            />
          </div>
          <Tabla>
            <thead>
              <tr>
                <Th>Factura</Th>
                <Th ancho="w-24">Emitida</Th>
                <Th ancho="w-24">Vence</Th>
                <Th num>Importe</Th>
                <Th>Tramo</Th>
              </tr>
            </thead>
            <tbody>
              {detalleCliente.vencs.map((v, i) => (
                <tr key={`${v.pedidoId}-${i}`}>
                  <Td className="font-jet">
                    {pedidos.find((p) => p.id === v.pedidoId)?.nro_factura ?? `#${v.pedidoId}`}
                  </Td>
                  <Td className="font-jet" color={FIN.tenue}>
                    {v.fechaFactura}
                  </Td>
                  <Td className="font-jet">{v.fechaVenc}</Td>
                  <Td num>{plata(v.monto)}</Td>
                  <Td>
                    <Chip color={COLOR_TRAMO[v.tramo]}>
                      {TRAMOS.find((t) => t.id === v.tramo)?.label}
                      {v.diasMora > 0 ? ` · ${v.diasMora} d` : ''}
                    </Chip>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Tabla>
          <Nota>
            El cobro se toma de la marca de cobrado del pedido: todavía no hay fecha de pago por factura, así que no
            se puede medir el retraso real de pago, solo la mora contra el vencimiento pactado.
          </Nota>
        </Panel>
      )}
    </div>
  )
}

function hace12Meses(): string {
  const d = new Date()
  d.setMonth(d.getMonth() - 12)
  return d.toISOString().slice(0, 10)
}
