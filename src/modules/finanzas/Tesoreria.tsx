/* Caja y bancos: saldo por cuenta, movimientos y conciliación contra el extracto.

   Regla de oro: el saldo no se edita a mano. Se mueve solo por movimientos.
   Si el extracto no coincide, se registra un ajuste (que es un movimiento más y queda
   en el historial). Así el saldo siempre tiene de dónde salió. */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'
import { useToast } from '../../lib/toast'
import { CuentaFinanciera, MovimientoFinanciero, RAZONES_SOCIALES } from '../../lib/types'
import { plata } from '../../lib/finanzas'
import { ymd } from '../../lib/dates'
import { Btn, Campo, Chip, FIN, Kpi, Nota, Panel, Rotulo, Selector, Tabla, Td, Th, Vacio } from './ui'
import { cargarCuentas, cargarMovimientos, RAZON_OPCIONES } from './datos'
import ImportExtracto from './ImportExtracto'

const TIPOS = [
  { id: 'banco', label: 'Banco' },
  { id: 'mp', label: 'Mercado Pago' },
  { id: 'efectivo', label: 'Efectivo' },
]

const TIPO_LABEL: Record<string, string> = { banco: 'Banco', mp: 'MP', efectivo: 'Efectivo' }

function haceDias(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return ymd(d)
}

export default function Tesoreria() {
  const { vendedor } = useAuth()
  const toast = useToast()
  const [cuentas, setCuentas] = useState<CuentaFinanciera[]>([])
  const [movs, setMovs] = useState<MovimientoFinanciero[]>([])
  const [loading, setLoading] = useState(true)
  const [razon, setRazon] = useState('')
  const [cuentaFiltro, setCuentaFiltro] = useState('')
  const [importando, setImportando] = useState(false)
  const [altaAbierta, setAltaAbierta] = useState(false)
  const [conciliando, setConciliando] = useState<CuentaFinanciera | null>(null)
  const [saldoExtracto, setSaldoExtracto] = useState('')

  // Alta de cuenta
  const [nNombre, setNNombre] = useState('')
  const [nTipo, setNTipo] = useState('banco')
  const [nRazon, setNRazon] = useState<string>(RAZONES_SOCIALES[0])
  const [nSaldo, setNSaldo] = useState('0')

  // Alta de movimiento
  const [mCuenta, setMCuenta] = useState('')
  const [mFecha, setMFecha] = useState(ymd(new Date()))
  const [mMonto, setMMonto] = useState('')
  const [mTipo, setMTipo] = useState('cobranza')
  const [mContraparte, setMContraparte] = useState('')

  const cargar = useCallback(async () => {
    const [cs, ms] = await Promise.all([cargarCuentas(), cargarMovimientos(haceDias(60))])
    setCuentas(cs)
    setMovs(ms)
    setLoading(false)
    // Snapshot del día para la serie histórica de caja. Idempotente: se pisa el del día.
    if (cs.length) {
      const hoy = ymd(new Date())
      await supabase
        .from('saldos_diarios')
        .upsert(
          cs.filter((c) => c.activo).map((c) => ({ cuenta_id: c.id, fecha: hoy, saldo: c.saldo_actual })),
          { onConflict: 'cuenta_id,fecha' }
        )
    }
  }, [])

  useEffect(() => {
    cargar()
  }, [cargar])

  const visibles = useMemo(
    () => cuentas.filter((c) => (!razon || c.razon_social === razon) && c.activo),
    [cuentas, razon]
  )

  const totalPorTipo = (t: string) =>
    visibles.filter((c) => c.tipo === t).reduce((a, c) => a + Number(c.saldo_actual || 0), 0)
  const total = visibles.reduce((a, c) => a + Number(c.saldo_actual || 0), 0)

  const movsVisibles = useMemo(() => {
    const ids = new Set(visibles.map((c) => c.id))
    return movs
      .filter((m) => ids.has(m.cuenta_id))
      .filter((m) => !cuentaFiltro || m.cuenta_id === Number(cuentaFiltro))
      .slice(0, 200)
  }, [movs, visibles, cuentaFiltro])

  const nombreCuenta = (id: number) => cuentas.find((c) => c.id === id)?.nombre ?? '—'

  async function crearCuenta() {
    if (!nNombre.trim()) {
      toast('Poné un nombre de cuenta', 'error')
      return
    }
    const { error } = await supabase.from('cuentas_financieras').insert({
      nombre: nNombre.trim(),
      tipo: nTipo,
      razon_social: nRazon,
      saldo_actual: Number(nSaldo) || 0,
      orden: cuentas.length,
    })
    if (error) {
      toast('No se pudo crear: ' + error.message, 'error')
      return
    }
    setNNombre('')
    setNSaldo('0')
    setAltaAbierta(false)
    toast('✅ Cuenta creada', 'success')
    cargar()
  }

  async function bajaCuenta(c: CuentaFinanciera) {
    const { error } = await supabase.from('cuentas_financieras').update({ activo: false }).eq('id', c.id)
    if (error) {
      toast('No se pudo archivar', 'error')
      return
    }
    toast('Cuenta archivada', 'success')
    cargar()
  }

  async function crearMovimiento() {
    const monto = Number(mMonto)
    if (!mCuenta || !monto) {
      toast('Elegí la cuenta y poné un importe distinto de cero', 'error')
      return
    }
    const cuenta = cuentas.find((c) => c.id === Number(mCuenta))
    const { error } = await supabase.from('movimientos_financieros').insert({
      cuenta_id: Number(mCuenta),
      fecha: mFecha,
      monto,
      tipo: mTipo,
      contraparte: mContraparte.trim() || null,
      origen: 'manual',
      creado_por: vendedor?.codigo ?? null,
    })
    if (error) {
      toast('No se pudo guardar: ' + error.message, 'error')
      return
    }
    await supabase
      .from('cuentas_financieras')
      .update({ saldo_actual: Number(cuenta?.saldo_actual || 0) + monto })
      .eq('id', Number(mCuenta))
    setMMonto('')
    setMContraparte('')
    toast('✅ Movimiento cargado', 'success')
    cargar()
  }

  async function toggleConciliado(m: MovimientoFinanciero) {
    const { error } = await supabase
      .from('movimientos_financieros')
      .update({ conciliado: !m.conciliado })
      .eq('id', m.id)
    if (error) {
      toast('No se pudo actualizar', 'error')
      return
    }
    setMovs((prev) => prev.map((x) => (x.id === m.id ? { ...x, conciliado: !m.conciliado } : x)))
  }

  const difConciliacion = conciliando ? Number(saldoExtracto || 0) - Number(conciliando.saldo_actual || 0) : 0

  async function registrarAjuste() {
    if (!conciliando || !saldoExtracto) return
    if (Math.abs(difConciliacion) < 0.5) {
      toast('No hay diferencia para ajustar', 'success')
      setConciliando(null)
      return
    }
    const { error } = await supabase.from('movimientos_financieros').insert({
      cuenta_id: conciliando.id,
      fecha: ymd(new Date()),
      monto: difConciliacion,
      tipo: 'ajuste de conciliación',
      detalle: `Saldo del extracto ${plata(Number(saldoExtracto))} vs sistema ${plata(conciliando.saldo_actual)}`,
      origen: 'manual',
      conciliado: true,
      creado_por: vendedor?.codigo ?? null,
    })
    if (error) {
      toast('No se pudo registrar el ajuste: ' + error.message, 'error')
      return
    }
    await supabase
      .from('cuentas_financieras')
      .update({ saldo_actual: Number(saldoExtracto) })
      .eq('id', conciliando.id)
    toast('✅ Ajuste registrado', 'success')
    setConciliando(null)
    setSaldoExtracto('')
    cargar()
  }

  if (loading) return <p className="text-[12px] p-4" style={{ color: FIN.tenue }}>Cargando tesorería…</p>

  const sinConciliar = movsVisibles.filter((m) => !m.conciliado).length

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Kpi label="Caja total" valor={plata(total)} nota={`${visibles.length} cuenta(s) activas`} />
        <Kpi label="Bancos" valor={plata(totalPorTipo('banco'))} />
        <Kpi label="Mercado Pago" valor={plata(totalPorTipo('mp'))} />
        <Kpi label="Efectivo" valor={plata(totalPorTipo('efectivo'))} />
      </div>

      <Panel
        titulo="Cuentas"
        nota="El saldo lo mueven los movimientos. Para alinearlo con el banco se registra un ajuste."
        derecha={
          <>
            <Selector value={razon} onChange={setRazon} opciones={RAZON_OPCIONES} />
            <Btn onClick={() => setImportando(true)} disabled={cuentas.length === 0}>
              Importar extracto
            </Btn>
            <Btn variante="oro" onClick={() => setAltaAbierta((v) => !v)}>
              + Cuenta
            </Btn>
          </>
        }
      >
        {altaAbierta && (
          <div
            className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-3 p-2 rounded border items-end"
            style={{ borderColor: FIN.borde, background: FIN.panelAlto }}
          >
            <Campo label="Nombre" value={nNombre} onChange={setNNombre} placeholder="Banco Galicia" />
            <Selector label="Tipo" value={nTipo} onChange={setNTipo} opciones={TIPOS} />
            <Selector
              label="Razón social"
              value={nRazon}
              onChange={setNRazon}
              opciones={RAZONES_SOCIALES.map((r) => ({ id: r, label: r }))}
            />
            <Campo label="Saldo inicial" value={nSaldo} onChange={setNSaldo} tipo="number" />
            <Btn variante="oro" onClick={crearCuenta}>
              Crear
            </Btn>
          </div>
        )}

        {visibles.length === 0 ? (
          <Vacio>Todavía no hay cuentas cargadas. Empezá por Galicia, Santander, Mercado Pago y los puntos de efectivo.</Vacio>
        ) : (
          <Tabla>
            <thead>
              <tr>
                <Th>Cuenta</Th>
                <Th>Tipo</Th>
                <Th>Razón social</Th>
                <Th num>Saldo</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {visibles.map((c) => (
                <tr key={c.id}>
                  <Td>{c.nombre}</Td>
                  <Td>
                    <Chip color={c.tipo === 'efectivo' ? FIN.oro : undefined}>{TIPO_LABEL[c.tipo]}</Chip>
                  </Td>
                  <Td color={FIN.tenue}>{c.razon_social}</Td>
                  <Td num color={Number(c.saldo_actual) < 0 ? FIN.rojo : FIN.texto}>
                    {plata(c.saldo_actual)}
                  </Td>
                  <Td className="text-right whitespace-nowrap">
                    <Btn
                      onClick={() => {
                        setConciliando(c)
                        setSaldoExtracto(String(Math.round(Number(c.saldo_actual || 0))))
                      }}
                      className="mr-1"
                    >
                      Conciliar
                    </Btn>
                    <Btn variante="peligro" onClick={() => bajaCuenta(c)} title="Archivar la cuenta">
                      Archivar
                    </Btn>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Tabla>
        )}

        {conciliando && (
          <div className="mt-3 p-2.5 rounded border" style={{ borderColor: FIN.oro + '55', background: FIN.oro + '10' }}>
            <Rotulo>Conciliación · {conciliando.nombre}</Rotulo>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 items-end mt-2">
              <Campo label="Saldo según extracto" value={saldoExtracto} onChange={setSaldoExtracto} tipo="number" />
              <div>
                <Rotulo>Saldo del sistema</Rotulo>
                <p className="font-jet text-[15px] mt-1">{plata(conciliando.saldo_actual)}</p>
              </div>
              <div>
                <Rotulo>Diferencia</Rotulo>
                <p
                  className="font-jet text-[15px] mt-1"
                  style={{ color: difConciliacion === 0 ? FIN.verde : FIN.ambar }}
                >
                  {plata(difConciliacion)}
                </p>
              </div>
              <div className="flex gap-2">
                <Btn variante="oro" onClick={registrarAjuste}>
                  Registrar ajuste
                </Btn>
                <Btn onClick={() => setConciliando(null)}>Cancelar</Btn>
              </div>
            </div>
            <Nota>
              El ajuste queda como un movimiento propio, con fecha y autor. Nunca se pisa el saldo sin dejar rastro.
            </Nota>
          </div>
        )}
      </Panel>

      <Panel
        titulo="Movimientos"
        nota={`Últimos 60 días · ${sinConciliar} sin conciliar`}
        derecha={
          <Selector
            value={cuentaFiltro}
            onChange={setCuentaFiltro}
            opciones={[{ id: '', label: 'Todas las cuentas' }, ...visibles.map((c) => ({ id: String(c.id), label: c.nombre }))]}
          />
        }
      >
        <div
          className="grid grid-cols-2 sm:grid-cols-6 gap-2 mb-3 p-2 rounded border items-end"
          style={{ borderColor: FIN.borde, background: FIN.panelAlto }}
        >
          <Selector
            label="Cuenta"
            value={mCuenta}
            onChange={setMCuenta}
            opciones={[{ id: '', label: '—' }, ...visibles.map((c) => ({ id: String(c.id), label: c.nombre }))]}
          />
          <Campo label="Fecha" value={mFecha} onChange={setMFecha} tipo="date" />
          <Campo label="Importe" value={mMonto} onChange={setMMonto} tipo="number" nota="Negativo = egreso" />
          <Campo label="Tipo" value={mTipo} onChange={setMTipo} />
          <Campo label="Contraparte" value={mContraparte} onChange={setMContraparte} placeholder="Óptica / proveedor" />
          <Btn variante="oro" onClick={crearMovimiento}>
            Cargar
          </Btn>
        </div>

        {movsVisibles.length === 0 ? (
          <Vacio>Sin movimientos en el período.</Vacio>
        ) : (
          <Tabla>
            <thead>
              <tr>
                <Th ancho="w-24">Fecha</Th>
                <Th>Cuenta</Th>
                <Th>Tipo</Th>
                <Th>Contraparte / detalle</Th>
                <Th num>Importe</Th>
                <Th>Conc.</Th>
              </tr>
            </thead>
            <tbody>
              {movsVisibles.map((m) => (
                <tr key={m.id}>
                  <Td className="font-jet">{m.fecha}</Td>
                  <Td color={FIN.tenue}>{nombreCuenta(m.cuenta_id)}</Td>
                  <Td>
                    {m.tipo}
                    {m.origen !== 'manual' && (
                      <span className="ml-1 text-[10px]" style={{ color: FIN.tenue }}>
                        ({m.origen})
                      </span>
                    )}
                  </Td>
                  <Td color={FIN.tenue} title={m.detalle ?? ''}>
                    {(m.contraparte || m.detalle || '—').slice(0, 60)}
                  </Td>
                  <Td num color={Number(m.monto) < 0 ? FIN.rojo : FIN.verde}>
                    {plata(m.monto)}
                  </Td>
                  <Td>
                    <input
                      type="checkbox"
                      checked={m.conciliado}
                      onChange={() => toggleConciliado(m)}
                      className="accent-[#C9A667]"
                      title="Conciliado contra el extracto"
                    />
                  </Td>
                </tr>
              ))}
            </tbody>
          </Tabla>
        )}
      </Panel>

      {importando && (
        <ImportExtracto
          cuentas={visibles}
          onCerrar={() => setImportando(false)}
          onListo={() => {
            setImportando(false)
            cargar()
          }}
        />
      )}
    </div>
  )
}
