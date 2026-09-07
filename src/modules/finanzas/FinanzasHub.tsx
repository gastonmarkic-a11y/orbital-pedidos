/* Tablero financiero. Arriba, los indicadores de liquidez (siempre visibles, con semáforo);
   abajo, las cuatro pantallas de trabajo más los parámetros.

   Los indicadores se calculan una sola vez acá y bajan a las pantallas que los necesitan,
   así el DSO que se ve en el strip es el mismo que usa el costo del descuento en efectivo. */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../lib/auth'
import { ParametrosFin } from '../../lib/types'
import { calcularKpis, num, plata, plataCorta, semaforo } from '../../lib/finanzas'
import { FIN, Kpi, Marco, Nota, Rotulo, Vacio } from './ui'
import {
  cajaTotal,
  cargarCheques,
  cargarCuentas,
  cargarParametros,
  cargarPedidosCC,
  chequesVivos,
  vencimientosDe,
  ventasUltimos12,
} from './datos'
import Tesoreria from './Tesoreria'
import CuentasCorrientes from './CuentasCorrientes'
import Cheques from './Cheques'
import Financiamiento from './Financiamiento'
import Parametros from './Parametros'

const SOLAPAS = [
  { id: 'tesoreria', label: 'Tesorería' },
  { id: 'cc', label: 'Cuentas corrientes' },
  { id: 'cheques', label: 'Cheques' },
  { id: 'financiamiento', label: 'Financiamiento' },
  { id: 'parametros', label: 'Parámetros' },
]

export default function FinanzasHub() {
  const { rolEfectivo } = useAuth()
  const [solapa, setSolapa] = useState('tesoreria')
  const [params, setParams] = useState<ParametrosFin | null>(null)
  const [caja, setCaja] = useState(0)
  const [cheques, setCheques] = useState(0)
  const [cxc, setCxc] = useState(0)
  const [ventasAnuales, setVentasAnuales] = useState(0)
  const [loading, setLoading] = useState(true)
  const [version, setVersion] = useState(0)

  const habilitado = rolEfectivo === 'admin' || rolEfectivo === 'administracion' || rolEfectivo === 'financiero'

  const cargar = useCallback(async () => {
    const [p, cuentas, chs, { pedidos, stock }, ventas] = await Promise.all([
      cargarParametros(),
      cargarCuentas(),
      cargarCheques(),
      cargarPedidosCC(),
      ventasUltimos12(),
    ])
    setParams(p)
    setCaja(cajaTotal(cuentas))
    setCheques(chequesVivos(chs).reduce((a, c) => a + Number(c.monto || 0), 0))
    setCxc(vencimientosDe(pedidos, stock).reduce((a, v) => a + v.monto, 0))
    setVentasAnuales(ventas)
    setLoading(false)
  }, [])

  useEffect(() => {
    if (habilitado) cargar()
  }, [cargar, habilitado, version])

  const refrescar = useCallback(() => setVersion((v) => v + 1), [])

  const kpis = useMemo(
    () => (params ? calcularKpis(caja, cheques, cxc, ventasAnuales, params) : null),
    [caja, cheques, cxc, ventasAnuales, params]
  )

  if (!habilitado)
    return (
      <Marco>
        <Vacio>Este módulo es solo para dirección y administración financiera.</Vacio>
      </Marco>
    )

  return (
    <Marco>
      <header className="flex items-end justify-between gap-3 mb-3">
        <div>
          <h2 className="font-fraunces text-[20px] leading-none" style={{ color: FIN.texto }}>
            Tesorería
          </h2>
          <p className="text-[11px] mt-1" style={{ color: FIN.tenue }}>
            Ejemplar · Plenorius · Plastic
          </p>
        </div>
        <nav className="flex flex-wrap gap-1 justify-end">
          {SOLAPAS.map((s) => (
            <button
              key={s.id}
              onClick={() => setSolapa(s.id)}
              className="rounded border px-2.5 py-1.5 text-[11.5px] font-medium"
              style={
                solapa === s.id
                  ? { background: FIN.oro, color: '#12100B', borderColor: FIN.oro }
                  : { background: 'transparent', color: FIN.texto, borderColor: FIN.borde }
              }
            >
              {s.label}
            </button>
          ))}
        </nav>
      </header>

      {loading ? (
        <p className="text-[12px] p-4" style={{ color: FIN.tenue }}>
          Cargando tablero…
        </p>
      ) : (
        <>
          {kpis && (
            <section className="mb-3">
              <Rotulo>Liquidez</Rotulo>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 mt-1.5">
                <Kpi
                  label="Liquidez corriente"
                  valor={kpis.pasivoCorriente > 0 ? `${num(kpis.liquidez)}x` : '—'}
                  estado={kpis.pasivoCorriente > 0 ? semaforo(kpis.liquidez, params!.ref_liquidez) : undefined}
                  ref_={`${num(params!.ref_liquidez, 1)}x`}
                />
                <Kpi
                  label="Prueba ácida"
                  valor={kpis.pasivoCorriente > 0 ? `${num(kpis.acida)}x` : '—'}
                  estado={kpis.pasivoCorriente > 0 ? semaforo(kpis.acida, params!.ref_acida) : undefined}
                  ref_={`${num(params!.ref_acida, 1)}x`}
                />
                <Kpi
                  label="Capital de trabajo"
                  valor={plataCorta(kpis.capitalTrabajo)}
                  nota={kpis.capitalTrabajo < 0 ? 'negativo' : 'activo − pasivo cte.'}
                  estado={kpis.pasivoCorriente > 0 ? (kpis.capitalTrabajo > 0 ? 'verde' : 'rojo') : undefined}
                />
                <Kpi
                  label="DSO"
                  valor={ventasAnuales > 0 ? `${Math.round(kpis.dso)} d` : '—'}
                  nota="días de venta a cobrar"
                />
                <Kpi
                  label="Runway de caja"
                  valor={params!.gasto_mensual > 0 ? `${Math.round(kpis.runwayDias)} d` : '—'}
                  estado={params!.gasto_mensual > 0 ? semaforo(kpis.runwayDias, params!.ref_runway_dias) : undefined}
                  ref_={`${params!.ref_runway_dias} d`}
                />
                <Kpi
                  label="Activo corriente"
                  valor={plataCorta(kpis.activoCorriente)}
                  nota={`caja ${plataCorta(kpis.caja)} · cheques ${plataCorta(kpis.chequesACobrar)}`}
                />
              </div>
              {(params!.pasivo_corriente === 0 || params!.gasto_mensual === 0) && (
                <Nota tono="alerta">
                  Falta cargar {params!.pasivo_corriente === 0 ? 'el pasivo corriente' : ''}
                  {params!.pasivo_corriente === 0 && params!.gasto_mensual === 0 ? ' y ' : ''}
                  {params!.gasto_mensual === 0 ? 'el gasto mensual' : ''} en Parámetros: sin eso los ratios quedan en
                  cero. Cartera a cobrar hoy: {plata(kpis.cuentasPorCobrar)}.
                </Nota>
              )}
            </section>
          )}

          {solapa === 'tesoreria' && <Tesoreria />}
          {solapa === 'cc' && <CuentasCorrientes params={params} />}
          {solapa === 'cheques' && <Cheques />}
          {solapa === 'financiamiento' && (
            <Financiamiento params={params} onGuardado={refrescar} cuentasPorCobrar={cxc} />
          )}
          {solapa === 'parametros' && <Parametros params={params} onGuardado={refrescar} />}
        </>
      )}
    </Marco>
  )
}
