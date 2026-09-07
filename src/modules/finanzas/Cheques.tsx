/* Cartera de cheques: alta, estados y proyección de flujo a 6 meses.

   Los estados no se saltan: cada cheque avanza por las transiciones válidas y cada paso
   queda en el historial (quién y cuándo). Cuando un cheque se cobra y tiene cuenta de
   depósito asignada, la plata entra a esa cuenta como movimiento: no hay que cargarla dos veces. */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'
import { useToast } from '../../lib/toast'
import { fetchPaged } from '../../lib/fetchAll'
import { ChequeCartera, CuentaFinanciera, RAZONES_SOCIALES } from '../../lib/types'
import {
  diasEntre,
  estadoChequeLabel,
  ESTADOS_CHEQUE,
  ESTADOS_VIVOS,
  plata,
  plataCorta,
  proyeccionFlujo,
  textoVencimiento,
  TRANSICIONES,
} from '../../lib/finanzas'
import { ymd } from '../../lib/dates'
import { Btn, Campo, Chip, FIN, Kpi, Nota, Panel, Rotulo, Selector, Tabla, Td, Th, Vacio } from './ui'
import { cargarCheques, cargarCuentas, RAZON_OPCIONES } from './datos'

const COLOR_ESTADO: Record<string, string> = {
  en_cartera: FIN.oro,
  pendiente_deposito: '#93C5FD',
  depositado: '#A5B4FC',
  cobrado: FIN.verde,
  rechazado: FIN.rojo,
  cambiado: FIN.tenue,
}

interface ClienteMini {
  cod: string
  razon: string | null
}

export default function Cheques() {
  const { vendedor } = useAuth()
  const toast = useToast()
  const [cheques, setCheques] = useState<ChequeCartera[]>([])
  const [cuentas, setCuentas] = useState<CuentaFinanciera[]>([])
  const [clientes, setClientes] = useState<ClienteMini[]>([])
  const [loading, setLoading] = useState(true)
  const [filtro, setFiltro] = useState('vivos')
  const [razon, setRazon] = useState('')
  const [busqueda, setBusqueda] = useState('')
  const [altaAbierta, setAltaAbierta] = useState(false)

  const [f, setF] = useState({
    numero: '',
    banco: '',
    monto: '',
    tipo: 'fisico',
    fecha_recepcion: ymd(new Date()),
    fecha_vencimiento: '',
    cliente: '',
    razon_social: RAZONES_SOCIALES[0] as string,
    cuenta_deposito_id: '',
    nota: '',
  })

  const cargar = useCallback(async () => {
    const [chs, cs, cls] = await Promise.all([
      cargarCheques(),
      cargarCuentas(),
      fetchPaged<ClienteMini>(() => supabase.from('clientes').select('cod, razon')),
    ])
    setCheques(chs)
    setCuentas(cs)
    setClientes(cls)
    setLoading(false)
  }, [])

  useEffect(() => {
    cargar()
  }, [cargar])

  const vivos = useMemo(() => cheques.filter((c) => ESTADOS_VIVOS.includes(c.estado)), [cheques])

  const filas = useMemo(() => {
    let l = [...cheques]
    if (filtro === 'vivos') l = l.filter((c) => ESTADOS_VIVOS.includes(c.estado))
    else if (filtro !== 'todos') l = l.filter((c) => c.estado === filtro)
    if (razon) l = l.filter((c) => c.razon_social === razon)
    const q = busqueda.toLowerCase().trim()
    if (q)
      l = l.filter(
        (c) =>
          c.numero.toLowerCase().includes(q) ||
          c.banco.toLowerCase().includes(q) ||
          (c.cliente_nombre ?? '').toLowerCase().includes(q)
      )
    return l
  }, [cheques, filtro, razon, busqueda])

  const totalVivos = vivos.reduce((a, c) => a + Number(c.monto || 0), 0)
  const hoy = ymd(new Date())
  const vencidosSinCobrar = vivos.filter((c) => c.fecha_vencimiento < hoy)
  const proximo = [...vivos].sort((a, b) => a.fecha_vencimiento.localeCompare(b.fecha_vencimiento))[0]
  const rechazados = cheques.filter((c) => c.estado === 'rechazado')
  const flujo = useMemo(() => proyeccionFlujo(vivos, 6), [vivos])
  const maxMes = Math.max(1, ...flujo.map((m) => m.monto))

  async function crear() {
    const monto = Number(f.monto)
    if (!f.numero.trim() || !f.banco.trim() || !monto || !f.fecha_vencimiento) {
      toast('Faltan número, banco, monto o vencimiento', 'error')
      return
    }
    const cli = clientes.find((c) => (c.razon ?? '') === f.cliente || c.cod === f.cliente)
    const { error } = await supabase.from('cheques_cartera').insert({
      numero: f.numero.trim(),
      banco: f.banco.trim(),
      monto,
      tipo: f.tipo,
      fecha_recepcion: f.fecha_recepcion,
      fecha_vencimiento: f.fecha_vencimiento,
      cliente_id: cli?.cod ?? null,
      cliente_nombre: cli?.razon ?? f.cliente.trim() ?? null,
      razon_social: f.razon_social,
      cuenta_deposito_id: f.cuenta_deposito_id ? Number(f.cuenta_deposito_id) : null,
      nota: f.nota.trim() || null,
      creado_por: vendedor?.codigo ?? null,
    })
    if (error) {
      toast(
        error.message.includes('cheques_numero_banco')
          ? 'Ese número ya está cargado para ese banco'
          : 'No se pudo guardar: ' + error.message,
        'error'
      )
      return
    }
    setF({ ...f, numero: '', monto: '', fecha_vencimiento: '', cliente: '', nota: '' })
    setAltaAbierta(false)
    toast('✅ Cheque cargado', 'success')
    cargar()
  }

  async function mover(c: ChequeCartera, nuevo: string) {
    const ahora = new Date().toISOString()
    const parche: Record<string, unknown> = {
      estado: nuevo,
      updated_at: ahora,
      historial: [...(c.historial ?? []), { fecha: ahora, de: c.estado, a: nuevo, por: vendedor?.codigo ?? null }],
    }
    if (nuevo === 'depositado' && !c.fecha_deposito) parche.fecha_deposito = ymd(new Date())
    if (nuevo === 'cobrado' && !c.fecha_cobro_real) parche.fecha_cobro_real = ymd(new Date())

    const { error } = await supabase.from('cheques_cartera').update(parche).eq('id', c.id)
    if (error) {
      toast('No se pudo actualizar: ' + error.message, 'error')
      return
    }

    // Cobrado con cuenta asignada: la plata entra a esa cuenta acá mismo.
    if (nuevo === 'cobrado' && c.cuenta_deposito_id) {
      const cuenta = cuentas.find((x) => x.id === c.cuenta_deposito_id)
      await supabase.from('movimientos_financieros').insert({
        cuenta_id: c.cuenta_deposito_id,
        fecha: ymd(new Date()),
        monto: Number(c.monto),
        tipo: 'cobro de cheque',
        contraparte: c.cliente_nombre,
        detalle: `Cheque ${c.numero} · ${c.banco}`,
        origen: 'manual',
        ref_externa: `cheque_${c.id}`,
        creado_por: vendedor?.codigo ?? null,
      })
      if (cuenta)
        await supabase
          .from('cuentas_financieras')
          .update({ saldo_actual: Number(cuenta.saldo_actual || 0) + Number(c.monto) })
          .eq('id', cuenta.id)
      toast(`✅ Cobrado · ${plata(c.monto)} a ${cuenta?.nombre ?? 'la cuenta'}`, 'success')
    } else {
      toast(`Cheque ${c.numero} → ${estadoChequeLabel(nuevo)}`, 'success')
    }
    cargar()
  }

  if (loading) return <p className="text-[12px] p-4" style={{ color: FIN.tenue }}>Cargando cartera…</p>

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Kpi label="En cartera" valor={plata(totalVivos)} nota={`${vivos.length} cheque(s) a cobrar`} />
        <Kpi
          label="Próximo vencimiento"
          valor={proximo ? proximo.fecha_vencimiento : '—'}
          nota={proximo ? `${plata(proximo.monto)} · ${textoVencimiento(proximo.fecha_vencimiento)}` : 'sin cheques vivos'}
        />
        <Kpi
          label="Vencidos sin cobrar"
          valor={plata(vencidosSinCobrar.reduce((a, c) => a + Number(c.monto), 0))}
          nota={`${vencidosSinCobrar.length} cheque(s)`}
          estado={vencidosSinCobrar.length ? 'rojo' : 'verde'}
        />
        <Kpi
          label="Rechazados (histórico)"
          valor={plata(rechazados.reduce((a, c) => a + Number(c.monto), 0))}
          nota={`${rechazados.length} cheque(s)`}
        />
      </div>

      <Panel titulo="Proyección de flujo · 6 meses" nota="Por mes de vencimiento, solo cheques todavía a cobrar. Lo vencido y sin cobrar se suma al mes en curso.">
        {totalVivos === 0 ? (
          <Vacio>Sin cheques en cartera.</Vacio>
        ) : (
          <div className="grid grid-cols-6 gap-2">
            {flujo.map((m) => (
              <div key={m.mes} className="min-w-0">
                <div className="h-24 flex items-end rounded" style={{ background: FIN.panelAlto }}>
                  <div
                    className="w-full rounded-t"
                    style={{ height: `${Math.max(2, (m.monto / maxMes) * 100)}%`, background: FIN.oro }}
                    title={plata(m.monto)}
                  />
                </div>
                <p className="text-[10px] uppercase tracking-wider mt-1.5" style={{ color: FIN.tenue }}>
                  {m.label}
                </p>
                <p className="font-jet text-[12px] tabular-nums">{plataCorta(m.monto)}</p>
                <p className="font-jet text-[10px] tabular-nums" style={{ color: FIN.tenue }}>
                  acum {plataCorta(m.acumulado)} · {m.cantidad}
                </p>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Panel
        titulo="Cartera"
        derecha={
          <>
            <input
              placeholder="Buscar nº, banco, cliente…"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              className="rounded border px-2 py-1.5 text-[12px] outline-none w-40"
              style={{ background: FIN.panelAlto, borderColor: FIN.borde, color: FIN.texto }}
            />
            <Selector value={razon} onChange={setRazon} opciones={RAZON_OPCIONES} />
            <Selector
              value={filtro}
              onChange={setFiltro}
              opciones={[
                { id: 'vivos', label: 'A cobrar' },
                { id: 'todos', label: 'Todos' },
                ...ESTADOS_CHEQUE.map((e) => ({ id: e.id, label: e.label })),
              ]}
            />
            <Btn variante="oro" onClick={() => setAltaAbierta((v) => !v)}>
              + Cheque
            </Btn>
          </>
        }
      >
        {altaAbierta && (
          <div
            className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-3 p-2 rounded border items-end"
            style={{ borderColor: FIN.borde, background: FIN.panelAlto }}
          >
            <Campo label="Número" value={f.numero} onChange={(v) => setF({ ...f, numero: v })} />
            <Campo label="Banco" value={f.banco} onChange={(v) => setF({ ...f, banco: v })} placeholder="Galicia" />
            <Campo label="Monto" value={f.monto} onChange={(v) => setF({ ...f, monto: v })} tipo="number" />
            <Selector
              label="Tipo"
              value={f.tipo}
              onChange={(v) => setF({ ...f, tipo: v })}
              opciones={[
                { id: 'fisico', label: 'Físico' },
                { id: 'echeck', label: 'eCheck' },
              ]}
            />
            <Campo
              label="Recepción"
              value={f.fecha_recepcion}
              onChange={(v) => setF({ ...f, fecha_recepcion: v })}
              tipo="date"
            />
            <Campo
              label="Vencimiento"
              value={f.fecha_vencimiento}
              onChange={(v) => setF({ ...f, fecha_vencimiento: v })}
              tipo="date"
            />
            <label className="block">
              <Rotulo>Cliente</Rotulo>
              <input
                list="fin-clientes"
                value={f.cliente}
                onChange={(e) => setF({ ...f, cliente: e.target.value })}
                placeholder="Óptica…"
                className="w-full rounded border px-2 py-1.5 text-[12.5px] outline-none mt-1"
                style={{ background: FIN.panel, borderColor: FIN.borde, color: FIN.texto }}
              />
              <datalist id="fin-clientes">
                {clientes.slice(0, 3000).map((c) => (
                  <option key={c.cod} value={c.razon ?? c.cod} />
                ))}
              </datalist>
            </label>
            <Selector
              label="Razón social"
              value={f.razon_social}
              onChange={(v) => setF({ ...f, razon_social: v })}
              opciones={RAZONES_SOCIALES.map((r) => ({ id: r, label: r }))}
            />
            <Selector
              label="Cuenta de depósito"
              value={f.cuenta_deposito_id}
              onChange={(v) => setF({ ...f, cuenta_deposito_id: v })}
              opciones={[
                { id: '', label: 'Sin definir' },
                ...cuentas.filter((c) => c.activo && c.tipo !== 'efectivo').map((c) => ({ id: String(c.id), label: c.nombre })),
              ]}
            />
            <Btn variante="oro" onClick={crear}>
              Cargar cheque
            </Btn>
          </div>
        )}

        {filas.length === 0 ? (
          <Vacio>No hay cheques con ese filtro.</Vacio>
        ) : (
          <Tabla>
            <thead>
              <tr>
                <Th>Nº / banco</Th>
                <Th>Cliente</Th>
                <Th ancho="w-24">Vence</Th>
                <Th num>Días</Th>
                <Th num>Monto</Th>
                <Th>Estado</Th>
                <Th>Mover a</Th>
              </tr>
            </thead>
            <tbody>
              {filas.map((c) => {
                const vencido = ESTADOS_VIVOS.includes(c.estado) && c.fecha_vencimiento < hoy
                return (
                  <tr key={c.id}>
                    <Td>
                      <span className="font-jet">{c.numero}</span>
                      <span style={{ color: FIN.tenue }}> · {c.banco}</span>
                      {c.tipo === 'echeck' && <span style={{ color: FIN.tenue }}> · e</span>}
                    </Td>
                    <Td color={FIN.tenue}>{c.cliente_nombre ?? '—'}</Td>
                    <Td className="font-jet" color={vencido ? FIN.rojo : undefined}>
                      {c.fecha_vencimiento}
                    </Td>
                    <Td num color={vencido ? FIN.rojo : FIN.tenue} title={textoVencimiento(c.fecha_vencimiento)}>
                      {diasEntre(c.fecha_vencimiento)}
                    </Td>
                    <Td num>{plata(c.monto)}</Td>
                    <Td>
                      <Chip color={COLOR_ESTADO[c.estado]}>{estadoChequeLabel(c.estado)}</Chip>
                    </Td>
                    <Td className="whitespace-nowrap">
                      {(TRANSICIONES[c.estado] ?? []).map((n) => (
                        <Btn key={n} onClick={() => mover(c, n)} className="mr-1">
                          {estadoChequeLabel(n)}
                        </Btn>
                      ))}
                      {(TRANSICIONES[c.estado] ?? []).length === 0 && (
                        <span className="text-[11px]" style={{ color: FIN.tenue }}>
                          cerrado
                        </span>
                      )}
                    </Td>
                  </tr>
                )
              })}
            </tbody>
          </Tabla>
        )}
        <Nota>
          Un cheque cobrado con cuenta de depósito asignada genera solo el ingreso en Tesorería. Los avisos de
          vencimiento salen por Telegram, igual que los del bot Ojo, y nunca cambian el estado por su cuenta.
        </Nota>
      </Panel>
    </div>
  )
}
