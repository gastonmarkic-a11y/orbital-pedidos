import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { fetchPaged } from '../../lib/fetchAll'
import { useAuth } from '../../lib/auth'
import { useToast } from '../../lib/toast'

// ── Liquidación de prospectores (Damián / Luna) ────────────────────────────
// Calcula la comisión del mes desde los datos reales de la app y deja que
// administración ajuste cualquier concepto antes de cerrar y pagar.
//
// Esquema (config en tabla comisiones_config, editable acá):
//   • Básico: básico × factor (Damián arrancó a mitad de mes → factor 0.5)
//   • Propuestas válidas: solo Bienvenida / Plan Canje / Preventa, por cliente
//     único. Cliente compartido con el otro prospector cuenta 0,5 (50/50).
//   • Reuniones: derivaciones a un vendedor de campo con reunión asignada.
//   • Cierres telefónicos: 3% de la facturación de ventas directas cerradas.

interface Prospector {
  codigo: string // clave en comisiones_config / liquidaciones
  nombre: string
  codigos: string[] // códigos de vendedor que agrupa
}

const PROSPECTORES: Prospector[] = [
  { codigo: 'Damian', nombre: 'Damián', codigos: ['ProspeccionVenta', 'Damian'] },
  { codigo: 'Marketing', nombre: 'Luna', codigos: ['Marketing'] },
]

interface ConfigCom {
  codigo: string
  nombre: string
  basico: number
  factor_basico: number
  tarifa_propuesta: number
  tarifa_reunion: number
  pct_cierre: number
}

// Valores calculados desde los datos reales (base para la liquidación)
interface Auto {
  clientesProp: number
  compartidos: number
  unidadesProp: number
  reuniones: number
  cantCierres: number
  facturacionCierres: number
  detalle: { cod: string; nombre: string; compartido: boolean }[]
}

// Estado editable de la liquidación de un prospector
interface Form {
  basico: number
  factor_basico: number
  cant_propuestas: number
  tarifa_propuesta: number
  cant_reuniones: number
  tarifa_reunion: number
  facturacion_cierres: number
  pct_cierre: number
  cant_cierres: number
  ajuste: number
  ajuste_motivo: string
  notas: string
  dias_texto: string
  estado: string
  guardado: boolean
}

interface ActRow {
  vendedor: string | null
  cod_cliente: string | null
  propuesta_enviada_id: number | null
  actividad_desarrollo: string | null
  monto_vendido: number | null
}
interface CliRow {
  cod: string
  razon: string | null
  nomcomerc: string | null
  derivado_por: string | null
  proxima_agenda_fecha: string | null
}

const money = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 })
const num = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 })

// Mes por defecto: si estamos en los primeros 12 días, se liquida el mes anterior.
function mesLiquidacion(): string {
  const d = new Date()
  if (d.getDate() <= 12) d.setMonth(d.getMonth() - 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function nombreCliente(c: CliRow | undefined, cod: string): string {
  if (!c) return cod
  return c.nomcomerc || c.razon || cod
}

export default function Liquidacion() {
  const { vendedor, rolEfectivo } = useAuth()
  const toast = useToast()
  const [mes, setMes] = useState(mesLiquidacion())
  const [loading, setLoading] = useState(true)
  const [config, setConfig] = useState<Record<string, ConfigCom>>({})
  const [autos, setAutos] = useState<Record<string, Auto>>({})
  const [forms, setForms] = useState<Record<string, Form>>({})
  const [abierto, setAbierto] = useState<string | null>(null)
  const [guardando, setGuardando] = useState<string | null>(null)

  const puedeEditar = rolEfectivo === 'admin' || rolEfectivo === 'administracion'

  useEffect(() => {
    let cancelado = false
    async function cargar() {
      setLoading(true)
      const desde = `${mes}-01`
      const [y, m] = mes.split('-').map(Number)
      const hasta = `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}-01`

      const todosCodigos = PROSPECTORES.flatMap((p) => p.codigos)

      const [{ data: cfg }, { data: props }, { data: liqs }] = await Promise.all([
        supabase.from('comisiones_config').select('*'),
        supabase.from('propuestas_julio').select('id, nombre'),
        supabase.from('liquidaciones').select('*').eq('mes_anio', mes),
      ])

      const acts = await fetchPaged<ActRow>(() =>
        supabase
          .from('actividad_diaria')
          .select('vendedor, cod_cliente, propuesta_enviada_id, actividad_desarrollo, monto_vendido')
          .gte('fecha', desde)
          .lt('fecha', hasta)
          .in('vendedor', todosCodigos)
          .order('id')
      )

      const { data: cliDeriv } = await supabase
        .from('clientes')
        .select('cod, razon, nomcomerc, derivado_por, proxima_agenda_fecha')
        .in('derivado_por', todosCodigos)

      const validaIds = new Set(
        ((props as { id: number; nombre: string }[]) ?? [])
          .filter((p) => /bienvenida|canje|preventa/i.test(p.nombre))
          .map((p) => p.id)
      )

      // Nombres de los clientes de las propuestas (para el detalle)
      const codsProp = new Set<string>()
      for (const a of acts) {
        if (a.cod_cliente && a.propuesta_enviada_id && validaIds.has(a.propuesta_enviada_id)) codsProp.add(a.cod_cliente)
      }
      const nombres = new Map<string, CliRow>()
      for (const c of (cliDeriv as CliRow[]) ?? []) nombres.set(c.cod, c)
      const faltan = [...codsProp].filter((c) => !nombres.has(c))
      for (let i = 0; i < faltan.length; i += 300) {
        const lote = faltan.slice(i, i + 300)
        const { data } = await supabase.from('clientes').select('cod, razon, nomcomerc, derivado_por, proxima_agenda_fecha').in('cod', lote)
        for (const c of (data as CliRow[]) ?? []) nombres.set(c.cod, c)
      }

      const cfgMap: Record<string, ConfigCom> = {}
      for (const c of (cfg as ConfigCom[]) ?? []) cfgMap[c.codigo] = c

      // Set de clientes con propuesta válida por prospector
      const clientesPorProsp: Record<string, Set<string>> = {}
      for (const p of PROSPECTORES) {
        const s = new Set<string>()
        for (const a of acts) {
          if (a.vendedor && p.codigos.includes(a.vendedor) && a.propuesta_enviada_id && validaIds.has(a.propuesta_enviada_id) && a.cod_cliente)
            s.add(a.cod_cliente)
        }
        clientesPorProsp[p.codigo] = s
      }

      const autoMap: Record<string, Auto> = {}
      const formMap: Record<string, Form> = {}
      const liqRows = (liqs as any[]) ?? []

      for (const p of PROSPECTORES) {
        const mios = clientesPorProsp[p.codigo]
        const otros = new Set<string>()
        for (const q of PROSPECTORES) if (q.codigo !== p.codigo) for (const c of clientesPorProsp[q.codigo]) otros.add(c)

        let compartidos = 0
        const detalle: Auto['detalle'] = []
        for (const cod of mios) {
          const comp = otros.has(cod)
          if (comp) compartidos++
          detalle.push({ cod, nombre: nombreCliente(nombres.get(cod), cod), compartido: comp })
        }
        detalle.sort((a, b) => a.nombre.localeCompare(b.nombre))
        const unidadesProp = mios.size - compartidos + compartidos * 0.5

        // Reuniones: derivaciones a campo con reunión (agenda) asignada
        const reuniones = ((cliDeriv as CliRow[]) ?? []).filter(
          (c) => c.derivado_por && p.codigos.includes(c.derivado_por) && c.proxima_agenda_fecha
        ).length

        // Cierres telefónicos (venta directa) y su facturación
        const cierresRows = acts.filter(
          (a) => a.vendedor && p.codigos.includes(a.vendedor) && (a.actividad_desarrollo ?? '').toLowerCase().startsWith('venta directa cerrada')
        )
        const facturacionCierres = cierresRows.reduce((s, a) => s + (a.monto_vendido ?? 0), 0)

        autoMap[p.codigo] = {
          clientesProp: mios.size,
          compartidos,
          unidadesProp,
          reuniones,
          cantCierres: cierresRows.length,
          facturacionCierres,
          detalle,
        }

        const cfgP = cfgMap[p.codigo]
        const saved = liqRows.find((l) => l.codigo === p.codigo)
        if (saved) {
          formMap[p.codigo] = {
            basico: Number(saved.basico),
            factor_basico: Number(saved.factor_basico),
            cant_propuestas: Number(saved.cant_propuestas),
            tarifa_propuesta: Number(saved.tarifa_propuesta),
            cant_reuniones: Number(saved.cant_reuniones),
            tarifa_reunion: Number(saved.tarifa_reunion),
            facturacion_cierres: Number(saved.facturacion_cierres),
            pct_cierre: Number(saved.pct_cierre),
            cant_cierres: Number(saved.cant_cierres),
            ajuste: Number(saved.ajuste),
            ajuste_motivo: saved.ajuste_motivo ?? '',
            notas: saved.notas ?? '',
            dias_texto: saved.dias_texto ?? '',
            estado: saved.estado ?? 'borrador',
            guardado: true,
          }
        } else {
          formMap[p.codigo] = {
            basico: cfgP?.basico ?? 0,
            factor_basico: cfgP?.factor_basico ?? 1,
            cant_propuestas: unidadesProp,
            tarifa_propuesta: cfgP?.tarifa_propuesta ?? 0,
            cant_reuniones: reuniones,
            tarifa_reunion: cfgP?.tarifa_reunion ?? 0,
            facturacion_cierres: facturacionCierres,
            pct_cierre: cfgP?.pct_cierre ?? 0,
            cant_cierres: cierresRows.length,
            ajuste: 0,
            ajuste_motivo: '',
            notas: '',
            dias_texto: p.codigo === 'Damian' ? 'Medio mes (factor 0,5)' : 'Mes completo',
            estado: 'borrador',
            guardado: false,
          }
        }
      }

      if (cancelado) return
      setConfig(cfgMap)
      setAutos(autoMap)
      setForms(formMap)
      setLoading(false)
    }
    cargar()
    return () => {
      cancelado = true
    }
  }, [mes])

  function upd(codigo: string, campo: keyof Form, valor: number | string) {
    setForms((f) => ({ ...f, [codigo]: { ...f[codigo], [campo]: valor } }))
  }

  function totalDe(f: Form) {
    const basico = f.basico * f.factor_basico
    const propuestas = f.cant_propuestas * f.tarifa_propuesta
    const reuniones = f.cant_reuniones * f.tarifa_reunion
    const cierres = f.facturacion_cierres * f.pct_cierre
    return { basico, propuestas, reuniones, cierres, total: basico + propuestas + reuniones + cierres + f.ajuste }
  }

  async function guardar(p: Prospector, cerrar: boolean) {
    const f = forms[p.codigo]
    if (!f) return
    setGuardando(p.codigo)
    const t = totalDe(f)
    const { error } = await supabase.from('liquidaciones').upsert(
      {
        mes_anio: mes,
        codigo: p.codigo,
        nombre: p.nombre,
        dias_texto: f.dias_texto,
        basico: f.basico,
        factor_basico: f.factor_basico,
        cant_propuestas: f.cant_propuestas,
        tarifa_propuesta: f.tarifa_propuesta,
        cant_reuniones: f.cant_reuniones,
        tarifa_reunion: f.tarifa_reunion,
        facturacion_cierres: f.facturacion_cierres,
        pct_cierre: f.pct_cierre,
        cant_cierres: f.cant_cierres,
        ajuste: f.ajuste,
        ajuste_motivo: f.ajuste_motivo,
        total: t.total,
        estado: cerrar ? 'cerrada' : 'borrador',
        notas: f.notas,
        actualizado_por: vendedor?.nombre ?? null,
        actualizado_at: new Date().toISOString(),
      },
      { onConflict: 'mes_anio,codigo' }
    )
    setGuardando(null)
    if (error) {
      toast('No se pudo guardar: ' + error.message, 'error')
      return
    }
    setForms((prev) => ({ ...prev, [p.codigo]: { ...prev[p.codigo], guardado: true, estado: cerrar ? 'cerrada' : 'borrador' } }))
    toast(cerrar ? `Liquidación de ${p.nombre} cerrada` : `Liquidación de ${p.nombre} guardada`, 'success')
  }

  function recalcular(p: Prospector) {
    const a = autos[p.codigo]
    const cfgP = config[p.codigo]
    if (!a) return
    setForms((prev) => ({
      ...prev,
      [p.codigo]: {
        ...prev[p.codigo],
        basico: cfgP?.basico ?? prev[p.codigo].basico,
        factor_basico: cfgP?.factor_basico ?? prev[p.codigo].factor_basico,
        cant_propuestas: a.unidadesProp,
        tarifa_propuesta: cfgP?.tarifa_propuesta ?? prev[p.codigo].tarifa_propuesta,
        cant_reuniones: a.reuniones,
        tarifa_reunion: cfgP?.tarifa_reunion ?? prev[p.codigo].tarifa_reunion,
        facturacion_cierres: a.facturacionCierres,
        pct_cierre: cfgP?.pct_cierre ?? prev[p.codigo].pct_cierre,
        cant_cierres: a.cantCierres,
      },
    }))
    toast(`Recalculado con los datos reales de ${p.nombre}`, 'success')
  }

  const totalGeneral = useMemo(
    () => PROSPECTORES.reduce((s, p) => s + (forms[p.codigo] ? totalDe(forms[p.codigo]).total : 0), 0),
    [forms]
  )

  if (loading) return <p className="text-sm text-muted p-4">Calculando liquidación…</p>

  return (
    <div className="space-y-4 text-ink">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="text-base font-semibold">💵 Liquidación de prospectores</h2>
        <div className="flex items-center gap-2">
          <label className="text-xs text-muted">Mes</label>
          <input
            type="month"
            value={mes}
            onChange={(e) => setMes(e.target.value)}
            className="text-sm bg-white border border-black/10 rounded-lg px-2 py-1.5 text-ink"
          />
        </div>
      </div>

      <div className="bg-[#F7F5F0] rounded-xl p-3 text-[11px] text-muted leading-relaxed">
        Se calcula solo desde los datos reales del mes. <b>Propuestas válidas</b>: Bienvenida, Plan Canje y Preventa, por
        cliente único; un cliente compartido con el otro prospector cuenta <b>0,5</b> (50/50). <b>Reuniones</b>:
        derivaciones a un vendedor con reunión asignada. <b>Cierres</b>: 3% de la facturación de ventas directas. Podés
        ajustar cualquier número antes de cerrar el mes.
      </div>

      {PROSPECTORES.map((p) => {
        const f = forms[p.codigo]
        const a = autos[p.codigo]
        if (!f || !a) return null
        const t = totalDe(f)
        const cerrada = f.estado === 'cerrada'
        return (
          <div key={p.codigo} className={`bg-white rounded-xl border ${cerrada ? 'border-emerald-300' : 'border-black/10'}`}>
            <div className="p-4 flex items-center justify-between gap-2 flex-wrap">
              <div>
                <p className="text-sm font-semibold flex items-center gap-2">
                  📞 {p.nombre}
                  {cerrada && <span className="text-[10px] bg-emerald-50 text-emerald-700 rounded-full px-2 py-0.5">✓ cerrada</span>}
                  {f.guardado && !cerrada && <span className="text-[10px] bg-amber-50 text-amber-700 rounded-full px-2 py-0.5">guardada</span>}
                </p>
                <p className="text-[11px] text-faint">{f.dias_texto}</p>
              </div>
              <div className="text-right">
                <p className="text-[10px] text-faint uppercase tracking-wide">Total a pagar</p>
                <p className="text-xl font-bold text-brandDark">{money.format(t.total)}</p>
              </div>
            </div>

            <div className="px-4 pb-3 grid sm:grid-cols-2 gap-x-6 gap-y-3">
              {/* Básico */}
              <Concepto titulo="Básico" detalle={`${money.format(f.basico)} × ${num.format(f.factor_basico)}`} monto={money.format(t.basico)}>
                <Campo label="Básico" val={f.basico} onCh={(v) => upd(p.codigo, 'basico', v)} readOnly={!puedeEditar || cerrada} money />
                <Campo label="Factor (½ mes = 0,5)" val={f.factor_basico} step={0.1} onCh={(v) => upd(p.codigo, 'factor_basico', v)} readOnly={!puedeEditar || cerrada} />
              </Concepto>

              {/* Propuestas */}
              <Concepto
                titulo="Propuestas válidas"
                detalle={`${num.format(f.cant_propuestas)} u. × ${money.format(f.tarifa_propuesta)}`}
                monto={money.format(t.propuestas)}
                nota={`${a.clientesProp} clientes únicos · ${a.compartidos} compartidos con el otro (½ c/u)`}
              >
                <Campo label="Unidades" val={f.cant_propuestas} step={0.5} onCh={(v) => upd(p.codigo, 'cant_propuestas', v)} readOnly={!puedeEditar || cerrada} />
                <Campo label="Tarifa" val={f.tarifa_propuesta} onCh={(v) => upd(p.codigo, 'tarifa_propuesta', v)} readOnly={!puedeEditar || cerrada} money />
              </Concepto>

              {/* Reuniones */}
              <Concepto titulo="Reuniones" detalle={`${num.format(f.cant_reuniones)} × ${money.format(f.tarifa_reunion)}`} monto={money.format(t.reuniones)} nota={`${a.reuniones} derivaciones con reunión detectadas`}>
                <Campo label="Reuniones" val={f.cant_reuniones} onCh={(v) => upd(p.codigo, 'cant_reuniones', v)} readOnly={!puedeEditar || cerrada} />
                <Campo label="Tarifa" val={f.tarifa_reunion} onCh={(v) => upd(p.codigo, 'tarifa_reunion', v)} readOnly={!puedeEditar || cerrada} money />
              </Concepto>

              {/* Cierres */}
              <Concepto
                titulo="Cierres telefónicos"
                detalle={`${money.format(f.facturacion_cierres)} × ${num.format(f.pct_cierre * 100)}%`}
                monto={money.format(t.cierres)}
                nota={`${a.cantCierres} ventas directas cerradas`}
              >
                <Campo label="Facturación" val={f.facturacion_cierres} onCh={(v) => upd(p.codigo, 'facturacion_cierres', v)} readOnly={!puedeEditar || cerrada} money />
                <Campo label="% (0,03 = 3%)" val={f.pct_cierre} step={0.01} onCh={(v) => upd(p.codigo, 'pct_cierre', v)} readOnly={!puedeEditar || cerrada} />
              </Concepto>

              {/* Ajuste manual */}
              <Concepto titulo="Ajuste manual" detalle={f.ajuste_motivo || 'Sumar/restar'} monto={money.format(f.ajuste)}>
                <Campo label="Ajuste ± " val={f.ajuste} onCh={(v) => upd(p.codigo, 'ajuste', v)} readOnly={!puedeEditar || cerrada} money />
                <input
                  placeholder="Motivo del ajuste"
                  value={f.ajuste_motivo}
                  disabled={!puedeEditar || cerrada}
                  onChange={(e) => upd(p.codigo, 'ajuste_motivo', e.target.value)}
                  className="w-full rounded-lg bg-white border border-black/10 px-2 py-1.5 text-sm mt-1 disabled:opacity-60"
                />
              </Concepto>
            </div>

            {/* Detalle de propuestas */}
            <div className="px-4 pb-2">
              <button
                onClick={() => setAbierto(abierto === p.codigo ? null : p.codigo)}
                className="text-xs text-brandDark font-medium"
              >
                {abierto === p.codigo ? '▾ Ocultar' : '▸ Ver'} listado de {a.detalle.length} clientes con propuesta
              </button>
              {abierto === p.codigo && (
                <div className="mt-2 max-h-64 overflow-auto border border-black/5 rounded-lg">
                  <table className="w-full text-[11px]">
                    <thead className="sticky top-0 bg-[#F7F5F0] text-faint">
                      <tr>
                        <th className="text-left px-2 py-1 font-medium">#</th>
                        <th className="text-left px-2 py-1 font-medium">Cliente</th>
                        <th className="text-left px-2 py-1 font-medium">Código</th>
                        <th className="text-right px-2 py-1 font-medium">Cuenta</th>
                      </tr>
                    </thead>
                    <tbody>
                      {a.detalle.map((d, i) => (
                        <tr key={d.cod} className="border-t border-black/5">
                          <td className="px-2 py-1 text-faint">{i + 1}</td>
                          <td className="px-2 py-1">{d.nombre}</td>
                          <td className="px-2 py-1 text-faint">{d.cod}</td>
                          <td className="px-2 py-1 text-right">
                            {d.compartido ? <span className="text-amber-600">½ (compartido)</span> : '1'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Notas + acciones */}
            <div className="px-4 pb-4 pt-1 border-t border-black/5">
              <textarea
                placeholder="Notas de la liquidación (opcional)"
                value={f.notas}
                disabled={!puedeEditar || cerrada}
                onChange={(e) => upd(p.codigo, 'notas', e.target.value)}
                rows={2}
                className="w-full rounded-lg bg-white border border-black/10 px-2 py-1.5 text-sm mb-2 disabled:opacity-60"
              />
              {puedeEditar && (
                <div className="flex items-center gap-2 flex-wrap">
                  <button onClick={() => recalcular(p)} disabled={cerrada} className="text-xs px-3 py-1.5 rounded-lg border border-black/10 text-muted disabled:opacity-40">
                    ↻ Recalcular con datos reales
                  </button>
                  <button
                    onClick={() => guardar(p, false)}
                    disabled={cerrada || guardando === p.codigo}
                    className="text-xs px-3 py-1.5 rounded-lg bg-brand/10 text-brandDark font-medium disabled:opacity-40"
                  >
                    {guardando === p.codigo ? 'Guardando…' : 'Guardar borrador'}
                  </button>
                  {cerrada ? (
                    <button onClick={() => upd(p.codigo, 'estado', 'borrador')} className="text-xs px-3 py-1.5 rounded-lg border border-emerald-300 text-emerald-700 font-medium">
                      Reabrir
                    </button>
                  ) : (
                    <button
                      onClick={() => guardar(p, true)}
                      disabled={guardando === p.codigo}
                      className="text-xs px-3 py-1.5 rounded-lg bg-emerald-600 text-white font-medium disabled:opacity-40"
                    >
                      Cerrar y liquidar
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        )
      })}

      <div className="bg-white rounded-xl p-4 border border-black/10 flex items-center justify-between">
        <p className="text-sm font-semibold">Total del mes ({mes})</p>
        <p className="text-xl font-bold text-brandDark">{money.format(totalGeneral)}</p>
      </div>
    </div>
  )
}

function Concepto({
  titulo,
  detalle,
  monto,
  nota,
  children,
}: {
  titulo: string
  detalle: string
  monto: string
  nota?: string
  children: React.ReactNode
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <p className="text-xs font-semibold text-ink">{titulo}</p>
        <p className="text-sm font-semibold text-ink">{monto}</p>
      </div>
      <p className="text-[10px] text-faint mb-1">{detalle}</p>
      {nota && <p className="text-[10px] text-brandDark/70 mb-1">{nota}</p>}
      <div className="grid grid-cols-2 gap-2">{children}</div>
    </div>
  )
}

function Campo({
  label,
  val,
  onCh,
  readOnly,
  money: esMoney,
  step,
}: {
  label: string
  val: number
  onCh: (v: number) => void
  readOnly?: boolean
  money?: boolean
  step?: number
}) {
  return (
    <label className="block">
      <span className="text-[9px] text-faint block mb-0.5">{label}</span>
      <input
        type="number"
        step={step ?? (esMoney ? 100 : 1)}
        value={val}
        readOnly={readOnly}
        onChange={(e) => onCh(parseFloat(e.target.value) || 0)}
        className={`w-full rounded-lg border border-black/10 px-2 py-1 text-sm ${readOnly ? 'bg-black/5 text-muted' : 'bg-white text-ink'}`}
      />
    </label>
  )
}
