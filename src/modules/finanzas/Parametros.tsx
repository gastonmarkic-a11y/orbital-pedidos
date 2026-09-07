/* Parámetros del módulo: tasas, pesos de la matriz, referencias del semáforo y las cifras
   de balance que ningún otro módulo conoce todavía (pasivo corriente, inventario, gasto).

   Se versiona por vigente_desde: guardar un día distinto no pisa lo anterior, crea una
   versión nueva. Así un CPPF viejo se puede volver a explicar con las tasas de ese momento. */

import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'
import { useToast } from '../../lib/toast'
import { ParametrosFin } from '../../lib/types'
import { plata } from '../../lib/finanzas'
import { ymd } from '../../lib/dates'
import { Btn, Campo, FIN, Nota, Panel, Tabla, Td, Th } from './ui'

type Borrador = Record<string, string>

const CAMPOS_TASAS: { k: keyof ParametrosFin; label: string; sufijo?: string; nota?: string }[] = [
  { k: 'tasa_banco', label: 'Tasa banco', sufijo: '% TNA', nota: 'Tasa nominal anual de descuento del banco' },
  { k: 'comision_fija_banco', label: 'Comisión fija banco', sufijo: '$', nota: 'Por operación, no por cheque descontado' },
  { k: 'tasa_financiera', label: 'Tasa financiera', sufijo: '% TNA' },
  { k: 'gasto_fijo_financiera', label: 'Gasto fijo financiera', sufijo: '%', nota: 'Sobre el valor bruto del cheque' },
  { k: 'iva_pct', label: 'IVA', sufijo: '%', nota: 'Sobre interés + gasto de la financiera' },
  { k: 'descuento_efectivo', label: 'Descuento en efectivo', sufijo: '%', nota: 'El que se le ofrece al cliente' },
  {
    k: 'horizonte_efectivo_dias',
    label: 'Horizonte del efectivo',
    sufijo: 'días',
    nota: 'Vacío = el plazo de cada cheque',
  },
]

const CAMPOS_DISP: { k: keyof ParametrosFin; label: string }[] = [
  { k: 'dias_disp_banco', label: 'Días banco' },
  { k: 'dias_disp_financiera', label: 'Días financiera' },
  { k: 'dias_disp_efectivo', label: 'Días efectivo' },
]

const CAMPOS_PESOS: { k: keyof ParametrosFin; label: string }[] = [
  { k: 'peso_costo', label: 'Peso costo' },
  { k: 'peso_velocidad', label: 'Peso urgencia' },
  { k: 'peso_relacion', label: 'Peso relación' },
]

const CAMPOS_BALANCE: { k: keyof ParametrosFin; label: string; sufijo?: string; nota?: string }[] = [
  { k: 'pasivo_corriente', label: 'Pasivo corriente', sufijo: '$', nota: 'Proveedores + fiscal + sueldos a pagar' },
  { k: 'inventario_valorizado', label: 'Inventario a costo', sufijo: '$' },
  { k: 'gasto_mensual', label: 'Gasto mensual', sufijo: '$', nota: 'Denominador del runway de caja' },
]

const CAMPOS_REF: { k: keyof ParametrosFin; label: string; nota?: string }[] = [
  { k: 'ref_liquidez', label: 'Ref. liquidez corriente', nota: 'Sana ≥ 1,5x' },
  { k: 'ref_acida', label: 'Ref. prueba ácida', nota: 'Sana ≥ 1,0x' },
  { k: 'ref_runway_dias', label: 'Ref. runway (días)' },
  { k: 'alerta_mora_pct', label: 'Alerta +90 días (%)', nota: '% de cartera que dispara la alerta' },
]

export default function Parametros({ params, onGuardado }: { params: ParametrosFin | null; onGuardado: () => void }) {
  const { vendedor } = useAuth()
  const toast = useToast()
  const [b, setB] = useState<Borrador>({})
  const [historial, setHistorial] = useState<ParametrosFin[]>([])
  const [guardando, setGuardando] = useState(false)

  useEffect(() => {
    if (!params) return
    const init: Borrador = {}
    for (const k of Object.keys(params)) {
      const v = params[k as keyof ParametrosFin]
      init[k] = v == null ? '' : String(v)
    }
    setB(init)
  }, [params])

  useEffect(() => {
    supabase
      .from('parametros_financieros')
      .select('*')
      .order('vigente_desde', { ascending: false })
      .order('id', { ascending: false })
      .limit(12)
      .then(({ data }) => setHistorial((data as ParametrosFin[]) ?? []))
  }, [params])

  const set = (k: string) => (v: string) => setB((prev) => ({ ...prev, [k]: v }))
  const n = (k: string) => (b[k] === '' || b[k] == null ? null : Number(b[k]))

  const sumaPesos = (n('peso_costo') ?? 0) + (n('peso_velocidad') ?? 0) + (n('peso_relacion') ?? 0)

  async function guardar() {
    if (sumaPesos !== 100) {
      toast(`Los pesos suman ${sumaPesos}% — tienen que sumar 100%`, 'error')
      return
    }
    setGuardando(true)
    const fila = {
      tasa_financiera: n('tasa_financiera') ?? 0,
      gasto_fijo_financiera: n('gasto_fijo_financiera') ?? 0,
      tasa_banco: n('tasa_banco') ?? 0,
      comision_fija_banco: n('comision_fija_banco') ?? 0,
      descuento_efectivo: n('descuento_efectivo') ?? 0,
      iva_pct: n('iva_pct') ?? 21,
      horizonte_efectivo_dias: n('horizonte_efectivo_dias'),
      dias_disp_banco: n('dias_disp_banco') ?? 2,
      dias_disp_financiera: n('dias_disp_financiera') ?? 1,
      dias_disp_efectivo: n('dias_disp_efectivo') ?? 0,
      peso_costo: n('peso_costo') ?? 60,
      peso_velocidad: n('peso_velocidad') ?? 25,
      peso_relacion: n('peso_relacion') ?? 15,
      alerta_mora_pct: n('alerta_mora_pct') ?? 15,
      pasivo_corriente: n('pasivo_corriente') ?? 0,
      inventario_valorizado: n('inventario_valorizado') ?? 0,
      gasto_mensual: n('gasto_mensual') ?? 0,
      ref_liquidez: n('ref_liquidez') ?? 1.5,
      ref_acida: n('ref_acida') ?? 1,
      ref_runway_dias: n('ref_runway_dias') ?? 90,
      creado_por: vendedor?.codigo ?? null,
    }
    const hoy = ymd(new Date())
    // Mismo día: se corrige la versión de hoy. Día distinto: nace una versión nueva.
    const { error } =
      params && params.vigente_desde === hoy
        ? await supabase.from('parametros_financieros').update(fila).eq('id', params.id)
        : await supabase.from('parametros_financieros').insert({ ...fila, vigente_desde: hoy })
    setGuardando(false)
    if (error) {
      toast('No se pudo guardar: ' + error.message, 'error')
      return
    }
    toast('✅ Parámetros guardados', 'success')
    onGuardado()
  }

  if (!params) return <p className="text-[12px] p-4" style={{ color: FIN.tenue }}>Cargando parámetros…</p>

  return (
    <div className="space-y-3">
      <Panel
        titulo="Costo de financiamiento"
        nota={`Versión vigente desde ${params.vigente_desde}`}
        derecha={
          <Btn variante="oro" onClick={guardar} disabled={guardando}>
            {guardando ? 'Guardando…' : 'Guardar'}
          </Btn>
        }
      >
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {CAMPOS_TASAS.map((c) => (
            <Campo
              key={c.k}
              label={c.label}
              value={b[c.k] ?? ''}
              onChange={set(c.k)}
              tipo="number"
              sufijo={c.sufijo}
              nota={c.nota}
            />
          ))}
        </div>
        <Nota>
          Las tasas van como TNA. La TEA la calcula el sistema componiendo sobre el plazo real de cada cheque: por eso
          el mismo % de banco cuesta muy distinto a 30 que a 120 días.
        </Nota>
      </Panel>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Panel titulo="Disponibilidad" nota="Días hasta tener la plata, por canal.">
          <div className="grid grid-cols-3 gap-3">
            {CAMPOS_DISP.map((c) => (
              <Campo key={c.k} label={c.label} value={b[c.k] ?? ''} onChange={set(c.k)} tipo="number" sufijo="d" />
            ))}
          </div>
        </Panel>

        <Panel titulo="Pesos de la matriz" nota={`Suman ${sumaPesos}% · tienen que dar 100%`}>
          <div className="grid grid-cols-3 gap-3">
            {CAMPOS_PESOS.map((c) => (
              <Campo key={c.k} label={c.label} value={b[c.k] ?? ''} onChange={set(c.k)} tipo="number" sufijo="%" />
            ))}
          </div>
          {sumaPesos !== 100 && <Nota tono="alerta">Ajustá los pesos hasta llegar a 100%.</Nota>}
        </Panel>
      </div>

      <Panel
        titulo="Cifras de balance"
        nota="Lo que ningún módulo deriva todavía. Sin esto no hay liquidez corriente ni runway."
      >
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {CAMPOS_BALANCE.map((c) => (
            <Campo
              key={c.k}
              label={c.label}
              value={b[c.k] ?? ''}
              onChange={set(c.k)}
              tipo="number"
              sufijo={c.sufijo}
              nota={c.nota}
            />
          ))}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
          {CAMPOS_REF.map((c) => (
            <Campo key={c.k} label={c.label} value={b[c.k] ?? ''} onChange={set(c.k)} tipo="number" nota={c.nota} />
          ))}
        </div>
        <Nota>
          Estas tres cifras se cargan a mano porque la Suite todavía no tiene proveedores ni costos de estructura. Van
          acá y no en la configuración general para que las vea solo quien tiene acceso financiero.
        </Nota>
      </Panel>

      <Panel titulo="Versiones" nota="Cada cambio con fecha distinta queda como versión propia.">
        <Tabla>
          <thead>
            <tr>
              <Th ancho="w-28">Vigente desde</Th>
              <Th num>Banco</Th>
              <Th num>Financiera</Th>
              <Th num>Gasto fijo</Th>
              <Th num>Efectivo</Th>
              <Th num>Pesos</Th>
              <Th num>Pasivo cte.</Th>
              <Th>Por</Th>
            </tr>
          </thead>
          <tbody>
            {historial.map((h) => (
              <tr key={h.id} style={h.id === params.id ? { background: FIN.oro + '0F' } : undefined}>
                <Td className="font-jet">{h.vigente_desde}</Td>
                <Td num>{h.tasa_banco}%</Td>
                <Td num>{h.tasa_financiera}%</Td>
                <Td num>{h.gasto_fijo_financiera}%</Td>
                <Td num>{h.descuento_efectivo}%</Td>
                <Td num color={FIN.tenue}>
                  {h.peso_costo}/{h.peso_velocidad}/{h.peso_relacion}
                </Td>
                <Td num color={FIN.tenue}>{plata(h.pasivo_corriente)}</Td>
                <Td color={FIN.tenue}>{h.creado_por ?? '—'}</Td>
              </tr>
            ))}
          </tbody>
        </Tabla>
      </Panel>
    </div>
  )
}
