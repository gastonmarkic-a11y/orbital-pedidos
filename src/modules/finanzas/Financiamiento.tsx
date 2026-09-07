/* Costo de financiamiento y matriz de decisión.

   Dos preguntas, dos paneles:
   1) ¿Cuánto nos cuesta financiarnos hoy? → CPPF: la TEA de cada cheque (tomando su canal
      más barato) ponderada por monto. Un solo número, comparable mes contra mes.
   2) ¿Qué hago con ESTE cheque? → las tres opciones con su TEA, su score ponderado y por
      qué gana la que gana, escrito en castellano. */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useToast } from '../../lib/toast'
import { ChequeCartera, ParametrosFin } from '../../lib/types'
import {
  CANAL_LABEL,
  cppf,
  decidir,
  diasHasta,
  num,
  OpcionEvaluada,
  opcionesPara,
  pct,
  pctTea,
  pesosValidos,
  plata,
} from '../../lib/finanzas'
import { Btn, Campo, Chip, FIN, Kpi, Nota, Panel, Rotulo, Selector, Tabla, Td, Th, Vacio } from './ui'
import { cargarCheques, chequesVivos, ventasUltimos12 } from './datos'

const COLOR_CANAL: Record<string, string> = {
  banco: '#93C5FD',
  financiera: '#A5B4FC',
  efectivo: FIN.oro,
}

export default function Financiamiento({
  params,
  onGuardado,
  cuentasPorCobrar,
}: {
  params: ParametrosFin | null
  onGuardado: () => void
  cuentasPorCobrar: number
}) {
  const toast = useToast()
  const [cheques, setCheques] = useState<ChequeCartera[]>([])
  const [ventasAnuales, setVentasAnuales] = useState(0)
  const [loading, setLoading] = useState(true)
  const [simMonto, setSimMonto] = useState('1000000')
  const [simDias, setSimDias] = useState('60')
  const [chequeSel, setChequeSel] = useState('')
  const [pesos, setPesos] = useState({ costo: 60, velocidad: 25, relacion: 15 })
  const [guardando, setGuardando] = useState(false)

  useEffect(() => {
    Promise.all([cargarCheques(), ventasUltimos12()]).then(([chs, v]) => {
      setCheques(chs)
      setVentasAnuales(v)
      setLoading(false)
    })
  }, [])

  useEffect(() => {
    if (params) setPesos({ costo: params.peso_costo, velocidad: params.peso_velocidad, relacion: params.peso_relacion })
  }, [params])

  /** Los pesos que se están mirando ahora (sin guardar todavía). */
  const paramsVivos: ParametrosFin | null = useMemo(
    () =>
      params
        ? { ...params, peso_costo: pesos.costo, peso_velocidad: pesos.velocidad, peso_relacion: pesos.relacion }
        : null,
    [params, pesos]
  )

  const dso = ventasAnuales > 0 ? (cuentasPorCobrar / ventasAnuales) * 365 : 0
  const vivos = useMemo(() => chequesVivos(cheques), [cheques])

  /** Por cada cheque, el canal más barato disponible. Eso es lo que entra al CPPF. */
  const porCheque = useMemo(() => {
    if (!paramsVivos) return []
    return vivos.map((c) => {
      const dias = diasHasta(c.fecha_vencimiento)
      const ops = opcionesPara(Number(c.monto), dias, paramsVivos).filter((o) => o.configurada)
      const barata = [...ops].sort((a, b) => a.tea - b.tea)[0]
      const decision = decidir(ops, paramsVivos)
      return { cheque: c, dias, barata, decision }
    })
  }, [vivos, paramsVivos])

  const cppfCartera = useMemo(
    () => cppf(porCheque.filter((x) => x.barata).map((x) => ({ monto: Number(x.cheque.monto), tea: x.barata!.tea }))),
    [porCheque]
  )

  const totalCartera = vivos.reduce((a, c) => a + Number(c.monto || 0), 0)

  const simulacion = useMemo(() => {
    if (!paramsVivos) return null
    const monto = Number(simMonto) || 0
    const dias = Number(simDias) || 1
    if (monto <= 0) return null
    const ops = opcionesPara(monto, dias, paramsVivos)
    return decidir(ops, paramsVivos)
  }, [paramsVivos, simMonto, simDias])

  const elegirCheque = useCallback(
    (id: string) => {
      setChequeSel(id)
      const c = vivos.find((x) => String(x.id) === id)
      if (c) {
        setSimMonto(String(Math.round(Number(c.monto))))
        setSimDias(String(diasHasta(c.fecha_vencimiento)))
      }
    },
    [vivos]
  )

  const sumaPesos = pesos.costo + pesos.velocidad + pesos.relacion

  async function guardarPesos() {
    if (!params) return
    if (sumaPesos !== 100) {
      toast(`Los pesos suman ${sumaPesos}% — tienen que sumar 100%`, 'error')
      return
    }
    setGuardando(true)
    const { error } = await supabase
      .from('parametros_financieros')
      .update({ peso_costo: pesos.costo, peso_velocidad: pesos.velocidad, peso_relacion: pesos.relacion })
      .eq('id', params.id)
    setGuardando(false)
    if (error) {
      toast('No se pudieron guardar: ' + error.message, 'error')
      return
    }
    toast('✅ Pesos guardados', 'success')
    onGuardado()
  }

  if (loading) return <p className="text-[12px] p-4" style={{ color: FIN.tenue }}>Calculando costos…</p>
  if (!params)
    return <Vacio>Faltan cargar los parámetros financieros. Andá a la solapa Parámetros.</Vacio>

  const algunaConfigurada =
    params.tasa_banco > 0 || params.tasa_financiera > 0 || params.descuento_efectivo > 0 || params.comision_fija_banco > 0

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Kpi
          label="CPPF"
          valor={algunaConfigurada ? pct(cppfCartera) : '—'}
          nota="TEA ponderada por monto, canal más barato por cheque"
        />
        <Kpi label="Cartera evaluada" valor={plata(totalCartera)} nota={`${vivos.length} cheque(s) a cobrar`} />
        <Kpi
          label="Plazo promedio"
          valor={`${vivos.length ? Math.round(porCheque.reduce((a, x) => a + x.dias, 0) / porCheque.length) : 0} d`}
          nota="hasta el vencimiento"
        />
        <Kpi
          label="Horizonte del efectivo"
          valor={params.horizonte_efectivo_dias ? `${params.horizonte_efectivo_dias} d` : 'por cheque'}
          nota={
            params.horizonte_efectivo_dias
              ? 'fijo, cargado a mano'
              : `el plazo de cada cheque${dso > 0 ? ` · DSO ${Math.round(dso)} d` : ''}`
          }
        />
      </div>

      {!algunaConfigurada && (
        <div className="rounded-md border px-3 py-2" style={{ borderColor: FIN.ambar + '66', background: FIN.ambar + '12' }}>
          <p className="text-[12px]" style={{ color: FIN.ambar }}>
            Todavía no hay tasas cargadas. Sin eso no hay TEA ni CPPF: cargá banco, financiera y descuento en efectivo
            en la solapa Parámetros.
          </p>
        </div>
      )}

      <Panel
        titulo="Matriz de decisión"
        nota="Score ponderado, menor es mejor. Los pesos los define quien decide, no el sistema."
        derecha={
          <>
            <Selector
              value={chequeSel}
              onChange={elegirCheque}
              opciones={[
                { id: '', label: 'Simulación libre' },
                ...vivos.map((c) => ({
                  id: String(c.id),
                  label: `${c.numero} · ${plata(c.monto)} · ${c.fecha_vencimiento}`,
                })),
              ]}
            />
            <Btn variante="oro" onClick={guardarPesos} disabled={guardando || sumaPesos !== 100}>
              Guardar pesos
            </Btn>
          </>
        }
      >
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 items-end">
          <Campo label="Monto del cheque" value={simMonto} onChange={setSimMonto} tipo="number" />
          <Campo label="Días al vencimiento" value={simDias} onChange={setSimDias} tipo="number" />
          <Campo
            label="Peso costo"
            value={pesos.costo}
            onChange={(v) => setPesos({ ...pesos, costo: Number(v) || 0 })}
            tipo="number"
            sufijo="%"
          />
          <Campo
            label="Peso urgencia"
            value={pesos.velocidad}
            onChange={(v) => setPesos({ ...pesos, velocidad: Number(v) || 0 })}
            tipo="number"
            sufijo="%"
          />
          <Campo
            label="Peso relación"
            value={pesos.relacion}
            onChange={(v) => setPesos({ ...pesos, relacion: Number(v) || 0 })}
            tipo="number"
            sufijo="%"
          />
        </div>
        {sumaPesos !== 100 && (
          <Nota tono="alerta">Los pesos suman {sumaPesos}%. Tienen que sumar 100% para que el score signifique algo.</Nota>
        )}

        {simulacion && simulacion.ranking.length > 0 ? (
          <>
            <div className="mt-3">
              <Tabla>
                <thead>
                  <tr>
                    <Th>Canal</Th>
                    <Th num>Costo</Th>
                    <Th num>Neto</Th>
                    <Th num>TEA</Th>
                    <Th num>Disp.</Th>
                    <Th num>Costo</Th>
                    <Th num>Urgencia</Th>
                    <Th num>Relación</Th>
                    <Th num>Score</Th>
                  </tr>
                </thead>
                <tbody>
                  {simulacion.ranking.map((o: OpcionEvaluada, i) => (
                    <tr key={o.canal} style={i === 0 ? { background: FIN.oro + '0F' } : undefined}>
                      <Td>
                        <Chip color={COLOR_CANAL[o.canal]}>{CANAL_LABEL[o.canal]}</Chip>
                        {i === 0 && (
                          <span className="ml-1.5 text-[10px]" style={{ color: FIN.oro }}>
                            elegida
                          </span>
                        )}
                      </Td>
                      <Td num color={FIN.rojo}>{plata(o.costo)}</Td>
                      <Td num>{plata(o.neto)}</Td>
                      <Td num color={FIN.oro}>{pctTea(o.tea)}</Td>
                      <Td num color={FIN.tenue}>{o.diasDisponibilidad} d</Td>
                      <Td num color={FIN.tenue}>{num(o.nCosto)}</Td>
                      <Td num color={FIN.tenue}>{num(o.nVelocidad)}</Td>
                      <Td num color={FIN.tenue}>{num(o.nRelacion)}</Td>
                      <Td num color={i === 0 ? FIN.oro : undefined}>{num(o.score, 3)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Tabla>
            </div>

            <div
              className="mt-3 rounded border px-3 py-2"
              style={{ borderColor: FIN.oro + '55', background: FIN.oro + '0F' }}
            >
              <Rotulo>Por qué gana</Rotulo>
              <p className="text-[12.5px] leading-relaxed mt-1">{simulacion.justificacion}</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-3">
              {simulacion.ranking.map((o) => (
                <div key={o.canal} className="rounded border p-2" style={{ borderColor: FIN.borde }}>
                  <Rotulo>{CANAL_LABEL[o.canal]} · desglose</Rotulo>
                  {o.detalle.map((d) => (
                    <div key={d.concepto} className="flex justify-between gap-2 text-[11.5px] mt-1">
                      <span style={{ color: FIN.tenue }}>{d.concepto}</span>
                      <span className="font-jet tabular-nums">{plata(d.monto)}</span>
                    </div>
                  ))}
                  <div
                    className="flex justify-between gap-2 text-[11.5px] mt-1.5 pt-1.5 border-t"
                    style={{ borderColor: FIN.bordeSuave }}
                  >
                    <span>Costo total sobre {o.dias} días</span>
                    <span className="font-jet tabular-nums" style={{ color: FIN.rojo }}>
                      {plata(o.costo)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : (
          <Vacio>Cargá las tasas en Parámetros para poder comparar.</Vacio>
        )}
      </Panel>

      <Panel titulo="Cartera evaluada" nota="Canal más barato y TEA de cada cheque a cobrar.">
        {porCheque.length === 0 ? (
          <Vacio>Sin cheques en cartera.</Vacio>
        ) : (
          <Tabla>
            <thead>
              <tr>
                <Th>Nº / banco</Th>
                <Th ancho="w-24">Vence</Th>
                <Th num>Días</Th>
                <Th num>Monto</Th>
                <Th>Más barato</Th>
                <Th num>TEA</Th>
                <Th num>Costo</Th>
                <Th>Recomendado</Th>
              </tr>
            </thead>
            <tbody>
              {porCheque.map(({ cheque, dias, barata, decision }) => (
                <tr key={cheque.id}>
                  <Td>
                    <span className="font-jet">{cheque.numero}</span>
                    <span style={{ color: FIN.tenue }}> · {cheque.banco}</span>
                  </Td>
                  <Td className="font-jet" color={FIN.tenue}>
                    {cheque.fecha_vencimiento}
                  </Td>
                  <Td num color={FIN.tenue}>{dias}</Td>
                  <Td num>{plata(cheque.monto)}</Td>
                  <Td>{barata ? <Chip color={COLOR_CANAL[barata.canal]}>{CANAL_LABEL[barata.canal]}</Chip> : '—'}</Td>
                  <Td num color={FIN.oro}>{barata ? pctTea(barata.tea) : '—'}</Td>
                  <Td num color={FIN.rojo}>{barata ? plata(barata.costo) : '—'}</Td>
                  <Td>
                    {decision.ganadora ? (
                      <Chip color={COLOR_CANAL[decision.ganadora.canal]}>{CANAL_LABEL[decision.ganadora.canal]}</Chip>
                    ) : (
                      '—'
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Tabla>
        )}
        <Nota>
          "Más barato" mira solo la TEA. "Recomendado" aplica la matriz con los pesos de arriba: por eso a veces no
          coinciden, y esa diferencia es justamente la decisión.
        </Nota>
      </Panel>
    </div>
  )
}
