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
  objetivoCodigos: string[] // dónde buscar el objetivo en objetivos_mes (orden de prioridad)
  prefijoCod?: string // prefijo de código de sus clientes, para atribuir reuniones derivadas
}

const PROSPECTORES: Prospector[] = [
  { codigo: 'Damian', nombre: 'Damián', codigos: ['ProspeccionVenta', 'Damian'], objetivoCodigos: ['ProspeccionVenta', 'Damian'], prefijoCod: 'AG-DAM' },
  { codigo: 'Marketing', nombre: 'Luna', codigos: ['Marketing'], objetivoCodigos: ['Marketing'] },
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
  // objetivos del mes
  objProp: number
  objReuniones: number
  objCierres: number
  resena: string[]
  // resultado ($)
  montoBasico: number
  montoPropuestas: number
  montoReuniones: number
  montoCierres: number
  total: number
  meta: number // total si completa los objetivos del mes
  pctMeta: number
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
  derivado_at: string | null
  proxima_agenda_fecha: string | null
}

const money = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 })
const num = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 })

function mesLiquidacion(): string {
  const d = new Date()
  if (d.getDate() <= 12) d.setMonth(d.getMonth() - 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function mesActualKey(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function mesPrevioKey(): string {
  const d = new Date()
  d.setDate(1)
  d.setMonth(d.getMonth() - 1)
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

function pctDe(logrado: number, objetivo: number): number {
  return objetivo > 0 ? Math.round((logrado / objetivo) * 100) : 0
}

// Escala suave, sin rojos: es primer mes y no se busca ser agresivo.
function colorObjetivo(pct: number): string {
  if (pct >= 80) return '#10b981' // verde
  if (pct >= 40) return '#C8A96E' // dorado
  return '#E0B04A' // ámbar suave
}

interface MetricaObj {
  key: 'propuestas' | 'reuniones' | 'cierres'
  label: string
  logrado: number
  objetivo: number
}

const CONSEJOS: Record<string, string> = {
  propuestas:
    'Mantener el ritmo de envíos y priorizar las ópticas con más potencial de recompra: mejor pocas bien elegidas que muchas al azar.',
  reuniones:
    'La clave es cerrar cada propuesta con una fecha concreta de reunión. Ofrecer dos horarios en el mismo mensaje ayuda a que digan que sí.',
  cierres:
    'Hacer un seguimiento a las 48 hs del envío y usar el llamado para cerrar con un beneficio puntual (envío sin cargo, un plazo o un combo).',
}

// Reseña de acompañamiento: reconoce lo bueno, marca 1-2 mejoras y da un consejo.
function generarResena(nombre: string, medioMes: boolean, metricas: MetricaObj[]): string[] {
  const conObjetivo = metricas.filter((m) => m.objetivo > 0)
  const bullets: string[] = []

  bullets.push(
    medioMes
      ? `${nombre} arrancó a mitad de mes, así que este primer período es de adaptación al rol — y aun así dejó una base concreta para construir.`
      : `Primer mes de ${nombre} en el rol: etapa de adaptación, con una base para seguir construyendo.`
  )

  if (conObjetivo.length) {
    const orden = [...conObjetivo].sort((a, b) => pctDe(b.logrado, b.objetivo) - pctDe(a.logrado, a.objetivo))
    const top = orden[0]
    bullets.push(
      `Lo más fuerte fue el volumen de ${top.label}: ${top.logrado} sobre un objetivo de ${top.objetivo} (${pctDe(top.logrado, top.objetivo)}%). Buen punto de apoyo para el resto.`
    )
    const aMejorar = orden.filter((m) => pctDe(m.logrado, m.objetivo) < 60 && m.key !== top.key).slice(0, 2)
    for (const m of aMejorar) {
      bullets.push(`A trabajar: ${m.label} (${m.logrado}/${m.objetivo}, ${pctDe(m.logrado, m.objetivo)}%). ${CONSEJOS[m.key]}`)
    }
  }

  bullets.push(
    'Sin apuro: el foco del próximo mes es ir convirtiendo ese volumen de propuestas en reuniones y en cierres. Paso a paso.'
  )
  return bullets
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

      const [{ data: cfg }, { data: props }, { data: objs }] = await Promise.all([
        supabase.from('comisiones_config').select('*'),
        supabase.from('propuestas_julio').select('id, nombre'),
        supabase.from('objetivos_mes').select('*').eq('mes_anio', mes),
      ])
      const objMap: Record<string, { objetivo_contactos: number | null; objetivo_propuestas: number | null; objetivo_ventas: number | null }> = {}
      for (const o of (objs as any[]) ?? []) objMap[o.vendedor] = o

      const acts = await fetchPaged<ActRow>(() =>
        supabase
          .from('actividad_diaria')
          .select('vendedor, cod_cliente, propuesta_enviada_id, actividad_desarrollo, monto_vendido')
          .gte('fecha', desde)
          .lt('fecha', hasta)
          .in('vendedor', todosCodigos)
          .order('id')
      )

      // Reuniones = clientes derivados con reunión asignada en el mes. Se usa derivado_at
      // (que NO se borra) en vez de derivado_por (que se limpia cuando el vendedor la toma).
      const { data: cliDeriv } = await supabase
        .from('clientes')
        .select('cod, razon, nomcomerc, derivado_at, proxima_agenda_fecha')
        .gte('derivado_at', desde)
        .lt('derivado_at', hasta)
        .not('proxima_agenda_fecha', 'is', null)

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
          .select('cod, razon, nomcomerc, derivado_at, proxima_agenda_fecha')
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

        // Reuniones del prospector: sus clientes (por prefijo de código) derivados con reunión en el mes.
        const reuniones = p.prefijoCod
          ? ((cliDeriv as CliRow[]) ?? []).filter((c) => (c.cod ?? '').startsWith(p.prefijoCod!)).length
          : 0

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
        const total = montoBasico + montoPropuestas + montoReuniones + montoCierres

        const obj = p.objetivoCodigos.map((k) => objMap[k]).find(Boolean)
        const objProp = obj?.objetivo_propuestas ?? 0
        const objReuniones = obj?.objetivo_contactos ?? 0
        const objCierres = obj?.objetivo_ventas ?? 0
        const meta = montoBasico + objProp * tarifaProp + objReuniones * tarifaReunion + montoCierres
        const pctMeta = meta > 0 ? Math.min(100, Math.round((total / meta) * 100)) : 0
        const resena = generarResena(p.nombre, factor < 1, [
          { key: 'propuestas', label: 'propuestas', logrado: clientesUnicos, objetivo: objProp },
          { key: 'reuniones', label: 'reuniones', logrado: reuniones, objetivo: objReuniones },
          { key: 'cierres', label: 'cierres telefónicos', logrado: cierresRows.length, objetivo: objCierres },
        ])

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
          objProp,
          objReuniones,
          objCierres,
          resena,
          montoBasico,
          montoPropuestas,
          montoReuniones,
          montoCierres,
          total,
          meta,
          pctMeta,
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

  const mesActual = mesActualKey()
  const mesPrevio = mesPrevioKey()
  const esMesActual = mes === mesActual

  if (loading) return <p className="text-sm text-muted p-4">Calculando estado de resultado…</p>

  return (
    <div className="space-y-4 text-ink">
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div>
            <h2 className="text-base font-semibold">💵 Liquidación de prospectores</h2>
            <p className="text-[11px] text-faint">
              {esMesActual
                ? `${etiquetaMes(mes)} · mes en curso (avance)`
                : `${etiquetaMes(mes)} · mes cerrado (a liquidar)`}{' '}
              · calculado desde los datos reales
            </p>
          </div>
          <input
            type="month"
            value={mes}
            onChange={(e) => setMes(e.target.value)}
            className="text-sm bg-white border border-black/10 rounded-lg px-2 py-1.5 text-ink"
          />
        </div>
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => setMes(mesPrevio)}
            className={`text-xs px-3 py-1.5 rounded-lg border font-medium ${
              mes === mesPrevio ? 'bg-brand text-white border-brand' : 'bg-white text-muted border-black/10'
            }`}
          >
            {etiquetaMes(mesPrevio)} · a liquidar
          </button>
          <button
            onClick={() => setMes(mesActual)}
            className={`text-xs px-3 py-1.5 rounded-lg border font-medium ${
              mes === mesActual ? 'bg-brand text-white border-brand' : 'bg-white text-muted border-black/10'
            }`}
          >
            {etiquetaMes(mesActual)} · en curso
          </button>
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
            <div className="flex items-center gap-3">
              <div className="text-right">
                <p className="text-[10px] text-faint uppercase tracking-wide">Total a pagar</p>
                <p className="text-2xl font-bold text-brandDark">{money.format(r.total)}</p>
              </div>
              <button
                onClick={() => exportarProspector(r, mes)}
                title={`Exportar la liquidación de ${r.nombre} a Excel`}
                className="text-xs px-3 py-2 rounded-lg border border-black/10 text-brandDark font-medium hover:bg-[#F1EDE4] whitespace-nowrap"
              >
                ⬇ Exportar
              </button>
            </div>
          </div>

          {/* 💰 Cómo va el sueldo este mes */}
          <div className="p-4 border-b border-black/5">
            <div className="rounded-xl p-4 border border-brand/20" style={{ background: 'linear-gradient(160deg,#FBF8F1,#F3ECDD)' }}>
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <p className="text-sm font-semibold text-ink">
                  {esMesActual ? '💰 Cómo va el sueldo este mes' : '💰 Sueldo a liquidar del mes'}
                </p>
                <div className="text-right">
                  <p className="text-[10px] text-faint uppercase tracking-wide">{esMesActual ? 'Acumulado' : 'Total'}</p>
                  <p className="text-2xl font-bold text-brandDark leading-none">{money.format(r.total)}</p>
                </div>
              </div>
              <div className="mt-3 space-y-1.5">
                {[
                  { label: 'Básico del mes', detalle: `${money.format(r.basico)} × ${num.format(r.factor)}`, monto: r.montoBasico },
                  { label: 'Propuestas válidas', detalle: `${num.format(r.unidadesProp)} u. × ${money.format(r.tarifaProp)}`, monto: r.montoPropuestas },
                  { label: 'Reuniones', detalle: `${r.reuniones} × ${money.format(r.tarifaReunion)}`, monto: r.montoReuniones },
                  { label: 'Cierres telefónicos', detalle: `${num.format(r.pctCierre * 100)}% de ${money.format(r.facturacionCierres)}`, monto: r.montoCierres },
                ].map((l) => (
                  <div key={l.label} className="flex items-center justify-between gap-2 text-sm">
                    <div className="min-w-0">
                      <span className="text-ink">{l.label}</span>
                      <span className="block text-[10px] text-faint">{l.detalle}</span>
                    </div>
                    <span className="font-semibold text-ink shrink-0">{money.format(l.monto)}</span>
                  </div>
                ))}
              </div>
              <div className="mt-3 pt-3 border-t border-black/10">
                <div className="flex items-center justify-between text-[11px] mb-1">
                  <span className="text-muted">{esMesActual ? 'Si completa los objetivos del mes' : 'Techo con objetivos completos'}</span>
                  <span className="font-semibold text-ink">≈ {money.format(r.meta)}</span>
                </div>
                <div className="h-2.5 bg-black/5 rounded-full overflow-hidden">
                  <div className="h-full rounded-full bg-brand" style={{ width: `${r.pctMeta}%` }} />
                </div>
                <p className="text-[10px] text-faint mt-1">
                  {esMesActual ? `Va por el ${r.pctMeta}% de esa meta.` : `Alcanzó el ${r.pctMeta}% de ese techo.`}
                </p>
              </div>
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

          {/* Objetivos del mes: buscado vs logrado */}
          <div className="p-4 border-b border-black/5">
            <p className="text-[10px] uppercase text-faint font-semibold mb-3">Objetivos del mes · buscado vs. logrado</p>
            <div className="space-y-3">
              {[
                { label: 'Propuestas', logrado: r.clientesUnicos, objetivo: r.objProp },
                { label: 'Reuniones', logrado: r.reuniones, objetivo: r.objReuniones },
                { label: 'Cierres telefónicos', logrado: r.cantCierres, objetivo: r.objCierres },
              ].map((m) => {
                const pct = pctDe(m.logrado, m.objetivo)
                return (
                  <div key={m.label}>
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="text-ink font-medium">{m.label}</span>
                      <span className="text-muted">
                        <b className="text-ink">{m.logrado}</b> / {m.objetivo || '—'}
                        {m.objetivo > 0 && <span className="text-faint"> · {pct}%</span>}
                      </span>
                    </div>
                    <div className="h-2.5 bg-black/5 rounded-full overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${Math.min(100, pct)}%`, background: colorObjetivo(pct) }} />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Reseña de acompañamiento */}
          <div className="p-4 border-b border-black/5 bg-[#FBFAF7]">
            <p className="text-[10px] uppercase text-faint font-semibold mb-2">📝 Reseña del mes</p>
            <div className="space-y-1.5">
              {r.resena.map((b, i) => (
                <p key={i} className="text-sm text-ink flex gap-2">
                  <span className="text-brand shrink-0">•</span>
                  <span>{b}</span>
                </p>
              ))}
            </div>
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

// Exporta la liquidación de un prospector a Excel (2 hojas: Liquidación + Clientes).
async function exportarProspector(r: Resultado, mes: string) {
  const XLSX = await import('xlsx')
  const wb = XLSX.utils.book_new()

  const resumen: (string | number)[][] = []
  resumen.push(['LIQUIDACIÓN DE PROSPECTOR'])
  resumen.push(['Prospector', r.nombre])
  resumen.push(['Mes', etiquetaMes(mes)])
  resumen.push(['Período', r.diasTexto])
  resumen.push([])
  resumen.push(['ESTADO DE RESULTADO'])
  resumen.push(['Concepto', 'Cálculo', 'Resultado ($)'])
  resumen.push(['Básico', `${r.basico} x ${r.factor}`, r.montoBasico])
  resumen.push(['Propuestas válidas', `${r.unidadesProp} u. x ${r.tarifaProp}`, r.montoPropuestas])
  resumen.push(['Reuniones', `${r.reuniones} x ${r.tarifaReunion}`, r.montoReuniones])
  resumen.push(['Cierres telefónicos', `${r.pctCierre * 100}% de ${r.facturacionCierres}`, r.montoCierres])
  resumen.push(['TOTAL A PAGAR', '', r.total])
  resumen.push([])
  resumen.push(['OBJETIVOS DEL MES', 'Logrado', 'Objetivo', '%'])
  resumen.push(['Propuestas', r.clientesUnicos, r.objProp, `${pctDe(r.clientesUnicos, r.objProp)}%`])
  resumen.push(['Reuniones', r.reuniones, r.objReuniones, `${pctDe(r.reuniones, r.objReuniones)}%`])
  resumen.push(['Cierres', r.cantCierres, r.objCierres, `${pctDe(r.cantCierres, r.objCierres)}%`])
  resumen.push([])
  resumen.push(['CONTACTOS POR PROPUESTA', 'Clientes'])
  for (const pp of r.porPropuesta) resumen.push([pp.nombre, pp.clientes])
  resumen.push(['Clientes únicos (base)', r.clientesUnicos])
  resumen.push(['Compartidos (cuentan 1/2)', r.compartidos])
  resumen.push(['Unidades computadas', r.unidadesProp])
  resumen.push([])
  resumen.push(['RESEÑA DEL MES'])
  for (const b of r.resena) resumen.push([b])

  const wsR = XLSX.utils.aoa_to_sheet(resumen)
  wsR['!cols'] = [{ wch: 30 }, { wch: 22 }, { wch: 14 }, { wch: 8 }]
  XLSX.utils.book_append_sheet(wb, wsR, 'Liquidación')

  const clientes: (string | number)[][] = [['#', 'Cliente', 'Código', 'Propuesta', 'Cuenta']]
  r.detalle.forEach((d, i) => clientes.push([i + 1, d.nombre, d.cod, d.propuestas.join(' + '), d.compartido ? '0,5 (compartido)' : '1']))
  const wsC = XLSX.utils.aoa_to_sheet(clientes)
  wsC['!cols'] = [{ wch: 5 }, { wch: 34 }, { wch: 14 }, { wch: 26 }, { wch: 16 }]
  XLSX.utils.book_append_sheet(wb, wsC, 'Clientes')

  XLSX.writeFile(wb, `Liquidacion_${r.nombre}_${mes}.xlsx`)
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
