import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { fetchPaged } from '../../lib/fetchAll'

// ── Estado de resultado de la liquidación de prospectores (Damián / Luna) ───
// Informe de solo lectura: detalla el resultado de cada ítem del mes,
// calculado directamente desde los datos reales de la app.
//
// Esquema (config en tabla comisiones_config):
//   • Básico: básico × factor (Damián arrancó a mitad de mes → factor 0,5)
//   • Propuestas válidas: solo Bienvenida / Plan Canje / Preventa, por cliente
//     único. Cliente compartido con el otro prospector cuenta 0,5 (50/50).
//   • Reuniones: derivaciones a un vendedor de campo con reunión asignada.
//   • Cierres telefónicos: 3% de la facturación de ventas directas cerradas.

interface Prospector {
  codigo: string
  nombre: string
  codigos: string[]
}

const PROSPECTORES: Prospector[] = [
  { codigo: 'Damian', nombre: 'Damián', codigos: ['ProspeccionVenta', 'Damian'] },
  { codigo: 'Marketing', nombre: 'Luna', codigos: ['Marketing'] },
]

interface ConfigCom {
  codigo: string
  basico: number
  factor_basico: number
  tarifa_propuesta: number
  tarifa_reunion: number
  pct_cierre: number
}

interface Resultado {
  codigo: string
  nombre: string
  diasTexto: string
  // actividad
  porPropuesta: { nombre: string; clientes: number }[]
  clientesUnicos: number
  compartidos: number
  unidadesProp: number
  reuniones: number
  cantCierres: number
  facturacionCierres: number
  detalle: { cod: string; nombre: string; propuestas: string[]; compartido: boolean }[]
  // resultado ($)
  montoBasico: number
  montoPropuestas: number
  montoReuniones: number
  montoCierres: number
  total: number
  // tarifas usadas
  basico: number
  factor: number
  tarifaProp: number
  tarifaReunion: number
  pctCierre: number
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

function mesLiquidacion(): string {
  const d = new Date()
  if (d.getDate() <= 12) d.setMonth(d.getMonth() - 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function etiquetaMes(mes: string): string {
  const [y, m] = mes.split('-').map(Number)
  const nombres = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
  return `${nombres[(m || 1) - 1]} ${y}`
}

function nombreCliente(c: CliRow | undefined, cod: string): string {
  if (!c) return cod
  return c.nomcomerc || c.razon || cod
}

export default function Liquidacion() {
  const [mes, setMes] = useState(mesLiquidacion())
  const [loading, setLoading] = useState(true)
  const [resultados, setResultados] = useState<Resultado[]>([])
  const [abierto, setAbierto] = useState<string | null>(null)

  useEffect(() => {
    let cancelado = false
    async function cargar() {
      setLoading(true)
      const desde = `${mes}-01`
      const [y, m] = mes.split('-').map(Number)
      const hasta = `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}-01`
      const todosCodigos = PROSPECTORES.flatMap((p) => p.codigos)

      const [{ data: cfg }, { data: props }] = await Promise.all([
        supabase.from('comisiones_config').select('*'),
        supabase.from('propuestas_julio').select('id, nombre'),
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

      const propNombre = new Map<number, string>()
      for (const p of ((props as { id: number; nombre: string }[]) ?? [])) propNombre.set(p.id, p.nombre)
      const validaIds = new Set(
        [...propNombre.entries()].filter(([, n]) => /bienvenida|canje|preventa/i.test(n)).map(([id]) => id)
      )

      // Nombres de clientes de las propuestas
      const codsProp = new Set<string>()
      for (const a of acts) if (a.cod_cliente && a.propuesta_enviada_id && validaIds.has(a.propuesta_enviada_id)) codsProp.add(a.cod_cliente)
      const nombres = new Map<string, CliRow>()
      for (const c of (cliDeriv as CliRow[]) ?? []) nombres.set(c.cod, c)
      const faltan = [...codsProp].filter((c) => !nombres.has(c))
      for (let i = 0; i < faltan.length; i += 300) {
        const { data } = await supabase
          .from('clientes')
          .select('cod, razon, nomcomerc, derivado_por, proxima_agenda_fecha')
          .in('cod', faltan.slice(i, i + 300))
        for (const c of (data as CliRow[]) ?? []) nombres.set(c.cod, c)
      }

      const cfgMap: Record<string, ConfigCom> = {}
      for (const c of (cfg as ConfigCom[]) ?? []) cfgMap[c.codigo] = c

      // cliente -> propuestas válidas recibidas, por prospector
      const propsPorCliente: Record<string, Map<string, Set<string>>> = {}
      for (const p of PROSPECTORES) propsPorCliente[p.codigo] = new Map()
      for (const a of acts) {
        if (!a.vendedor || !a.cod_cliente || !a.propuesta_enviada_id || !validaIds.has(a.propuesta_enviada_id)) continue
        const p = PROSPECTORES.find((pp) => pp.codigos.includes(a.vendedor!))
        if (!p) continue
        const mapa = propsPorCliente[p.codigo]
        if (!mapa.has(a.cod_cliente)) mapa.set(a.cod_cliente, new Set())
        mapa.get(a.cod_cliente)!.add(propNombre.get(a.propuesta_enviada_id) ?? '—')
      }

      const out: Resultado[] = []
      for (const p of PROSPECTORES) {
        const mios = propsPorCliente[p.codigo]
        const otros = new Set<string>()
        for (const q of PROSPECTORES) if (q.codigo !== p.codigo) for (const cod of propsPorCliente[q.codigo].keys()) otros.add(cod)

        let compartidos = 0
        const detalle: Resultado['detalle'] = []
        const conteoPropuesta = new Map<string, number>()
        for (const [cod, set] of mios.entries()) {
          const comp = otros.has(cod)
          if (comp) compartidos++
          for (const nom of set) conteoPropuesta.set(nom, (conteoPropuesta.get(nom) ?? 0) + 1)
          detalle.push({ cod, nombre: nombreCliente(nombres.get(cod), cod), propuestas: [...set], compartido: comp })
        }
        detalle.sort((a, b) => a.nombre.localeCompare(b.nombre))
        const clientesUnicos = mios.size
        const unidadesProp = clientesUnicos - compartidos + compartidos * 0.5

        const reuniones = ((cliDeriv as CliRow[]) ?? []).filter(
          (c) => c.derivado_por && p.codigos.includes(c.derivado_por) && c.proxima_agenda_fecha
        ).length

        const cierresRows = acts.filter(
          (a) => a.vendedor && p.codigos.includes(a.vendedor) && (a.actividad_desarrollo ?? '').toLowerCase().startsWith('venta directa cerrada')
        )
        const facturacionCierres = cierresRows.reduce((s, a) => s + (a.monto_vendido ?? 0), 0)

        const c = cfgMap[p.codigo]
        const basico = c?.basico ?? 0
        const factor = c?.factor_basico ?? 1
        const tarifaProp = c?.tarifa_propuesta ?? 0
        const tarifaReunion = c?.tarifa_reunion ?? 0
        const pctCierre = c?.pct_cierre ?? 0

        const montoBasico = basico * factor
        const montoPropuestas = unidadesProp * tarifaProp
        const montoReuniones = reuniones * tarifaReunion
        const montoCierres = facturacionCierres * pctCierre

        out.push({
          codigo: p.codigo,
          nombre: p.nombre,
          diasTexto: factor < 1 ? `Medio mes trabajado (factor ${num.format(factor)})` : 'Mes completo',
          porPropuesta: [...conteoPropuesta.entries()].map(([nombre, clientes]) => ({ nombre, clientes })).sort((a, b) => b.clientes - a.clientes),
          clientesUnicos,
          compartidos,
          unidadesProp,
          reuniones,
          cantCierres: cierresRows.length,
          facturacionCierres,
          detalle,
          montoBasico,
          montoPropuestas,
          montoReuniones,
          montoCierres,
          total: montoBasico + montoPropuestas + montoReuniones + montoCierres,
          basico,
          factor,
          tarifaProp,
          tarifaReunion,
          pctCierre,
        })
      }

      if (cancelado) return
      setResultados(out)
      setLoading(false)
    }
    cargar()
    return () => {
      cancelado = true
    }
  }, [mes])

  const totalGeneral = useMemo(() => resultados.reduce((s, r) => s + r.total, 0), [resultados])

  if (loading) return <p className="text-sm text-muted p-4">Calculando estado de resultado…</p>

  return (
    <div className="space-y-4 text-ink">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h2 className="text-base font-semibold">💵 Liquidación de prospectores</h2>
          <p className="text-[11px] text-faint">Estado de resultado de {etiquetaMes(mes)} · calculado desde los datos reales</p>
        </div>
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

      {resultados.map((r) => (
        <div key={r.codigo} className="bg-white rounded-xl border border-black/10 overflow-hidden">
          {/* Encabezado */}
          <div className="p-4 flex items-center justify-between gap-2 flex-wrap border-b border-black/5">
            <div>
              <p className="text-sm font-semibold flex items-center gap-2">📞 {r.nombre}</p>
              <p className="text-[11px] text-faint">{r.diasTexto}</p>
            </div>
            <div className="text-right">
              <p className="text-[10px] text-faint uppercase tracking-wide">Total a pagar</p>
              <p className="text-2xl font-bold text-brandDark">{money.format(r.total)}</p>
            </div>
          </div>

          {/* Contactos por propuesta */}
          <div className="p-4 border-b border-black/5">
            <p className="text-[10px] uppercase text-faint font-semibold mb-2">Contactos por propuesta (válidas)</p>
            {r.porPropuesta.length === 0 ? (
              <p className="text-sm text-faint">Sin propuestas válidas este mes.</p>
            ) : (
              <table className="w-full text-sm">
                <tbody>
                  {r.porPropuesta.map((pp) => (
                    <tr key={pp.nombre} className="border-b border-black/5 last:border-0">
                      <td className="py-1.5 text-ink">{pp.nombre}</td>
                      <td className="py-1.5 text-right font-semibold text-ink w-24">{pp.clientes} clientes</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-black/10">
                    <td className="py-1.5 text-muted text-xs">Clientes únicos (base de cálculo)</td>
                    <td className="py-1.5 text-right font-semibold text-xs">{r.clientesUnicos}</td>
                  </tr>
                  {r.compartidos > 0 && (
                    <tr>
                      <td className="py-0.5 text-muted text-xs">— compartidos con el otro prospector (cuentan ½)</td>
                      <td className="py-0.5 text-right text-amber-600 text-xs">{r.compartidos}</td>
                    </tr>
                  )}
                  <tr>
                    <td className="py-0.5 text-brandDark text-xs font-semibold">= Unidades computadas</td>
                    <td className="py-0.5 text-right text-brandDark text-xs font-semibold">{num.format(r.unidadesProp)}</td>
                  </tr>
                </tfoot>
              </table>
            )}
          </div>

          {/* Estado de resultado */}
          <div className="p-4">
            <p className="text-[10px] uppercase text-faint font-semibold mb-2">Estado de resultado</p>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[10px] text-faint uppercase">
                  <th className="text-left font-medium pb-1">Concepto</th>
                  <th className="text-left font-medium pb-1">Cálculo</th>
                  <th className="text-right font-medium pb-1">Resultado</th>
                </tr>
              </thead>
              <tbody>
                <Linea concepto="Básico" calculo={`${money.format(r.basico)} × ${num.format(r.factor)}`} monto={r.montoBasico} />
                <Linea
                  concepto="Propuestas válidas"
                  calculo={`${num.format(r.unidadesProp)} u. × ${money.format(r.tarifaProp)}`}
                  monto={r.montoPropuestas}
                />
                <Linea
                  concepto="Reuniones"
                  calculo={`${r.reuniones} × ${money.format(r.tarifaReunion)}`}
                  monto={r.montoReuniones}
                  nota="derivaciones a un vendedor con reunión asignada"
                />
                <Linea
                  concepto="Cierres telefónicos"
                  calculo={`${num.format(r.pctCierre * 100)}% de ${money.format(r.facturacionCierres)}`}
                  monto={r.montoCierres}
                  nota={`${r.cantCierres} ventas directas cerradas`}
                />
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-black/15">
                  <td className="pt-2 font-bold text-ink" colSpan={2}>
                    Total a pagar
                  </td>
                  <td className="pt-2 text-right font-bold text-brandDark text-base">{money.format(r.total)}</td>
                </tr>
              </tfoot>
            </table>

            {/* Detalle de clientes */}
            <button
              onClick={() => setAbierto(abierto === r.codigo ? null : r.codigo)}
              className="text-xs text-brandDark font-medium mt-3"
            >
              {abierto === r.codigo ? '▾ Ocultar' : '▸ Ver'} listado de {r.detalle.length} clientes contactados
            </button>
            {abierto === r.codigo && (
              <div className="mt-2 max-h-72 overflow-auto border border-black/5 rounded-lg">
                <table className="w-full text-[11px]">
                  <thead className="sticky top-0 bg-[#F7F5F0] text-faint">
                    <tr>
                      <th className="text-left px-2 py-1 font-medium">#</th>
                      <th className="text-left px-2 py-1 font-medium">Cliente</th>
                      <th className="text-left px-2 py-1 font-medium">Propuesta</th>
                      <th className="text-right px-2 py-1 font-medium">Cuenta</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.detalle.map((d, i) => (
                      <tr key={d.cod} className="border-t border-black/5">
                        <td className="px-2 py-1 text-faint">{i + 1}</td>
                        <td className="px-2 py-1">
                          {d.nombre}
                          <span className="text-faint"> · {d.cod}</span>
                        </td>
                        <td className="px-2 py-1 text-muted">{d.propuestas.join(' + ')}</td>
                        <td className="px-2 py-1 text-right">
                          {d.compartido ? <span className="text-amber-600">½ compartido</span> : '1'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      ))}

      <div className="bg-white rounded-xl p-4 border border-black/10 flex items-center justify-between">
        <p className="text-sm font-semibold">Total del mes ({etiquetaMes(mes)})</p>
        <p className="text-xl font-bold text-brandDark">{money.format(totalGeneral)}</p>
      </div>
    </div>
  )
}

function Linea({ concepto, calculo, monto, nota }: { concepto: string; calculo: string; monto: number; nota?: string }) {
  return (
    <tr className="border-b border-black/5">
      <td className="py-2 align-top">
        <span className="text-ink">{concepto}</span>
        {nota && <span className="block text-[10px] text-faint">{nota}</span>}
      </td>
      <td className="py-2 text-muted text-xs align-top">{calculo}</td>
      <td className="py-2 text-right font-semibold text-ink align-top">{money.format(monto)}</td>
    </tr>
  )
}
