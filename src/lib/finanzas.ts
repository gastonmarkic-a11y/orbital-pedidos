/* Núcleo de cálculo del módulo financiero. Todo acá es puro (sin Supabase, sin React):
   las pantallas solo traen filas y muestran lo que estas funciones devuelven.

   Criterio central: el costo de financiarse NO se mide con el % bruto del cheque
   (eso es costo lineal y miente: no distingue 30 días de 120). Se mide con la TEA,
   que anualiza componiendo y hace comparables plazos distintos. */

import type { ParametrosFin } from './types'

export type CanalFin = 'banco' | 'financiera' | 'efectivo'

export const CANAL_LABEL: Record<CanalFin, string> = {
  banco: 'Banco',
  financiera: 'Financiera',
  efectivo: 'Descuento en efectivo',
}

/* Impacto en la relación comercial, 0 = ninguno, 1 = alto.
   Banco y financiera son puertas afuera: el cliente ni se entera de qué hicimos con su cheque.
   El descuento en efectivo, en cambio, obliga a volver sobre la forma de pago ya pactada. */
export const IMPACTO_RELACION: Record<CanalFin, number> = { banco: 0, financiera: 0, efectivo: 1 }

/** Tasa efectiva anual. costo y neto en $, dias del período. Devuelve decimal (0.85 = 85%). */
export function teaDe(costo: number, neto: number, dias: number): number {
  if (neto <= 0 || dias <= 0) return 0
  const tasaPeriodo = costo / neto
  if (tasaPeriodo <= -1) return 0
  return Math.pow(1 + tasaPeriodo, 365 / dias) - 1
}

/** Días entre hoy (o la fecha de corte) y el vencimiento. Negativo si ya venció. Para mostrar. */
export function diasEntre(fechaVenc: string, desde = new Date()): number {
  const v = new Date(fechaVenc + 'T00:00:00').getTime()
  const d = new Date(desde.getFullYear(), desde.getMonth(), desde.getDate()).getTime()
  return Math.round((v - d) / 86400000)
}

/** Igual que diasEntre pero con piso en 1: es el que se usa para anualizar (nunca dividir por 0). */
export function diasHasta(fechaVenc: string, desde = new Date()): number {
  return Math.max(1, diasEntre(fechaVenc, desde))
}

/** "en 9 días" / "vence hoy" / "vencido hace 4 días". */
export function textoVencimiento(fechaVenc: string, desde = new Date()): string {
  const d = diasEntre(fechaVenc, desde)
  if (d === 0) return 'vence hoy'
  if (d > 0) return `en ${d} día${d === 1 ? '' : 's'}`
  const n = Math.abs(d)
  return `vencido hace ${n} día${n === 1 ? '' : 's'}`
}

export interface OpcionFin {
  canal: CanalFin
  bruto: number
  costo: number
  neto: number
  /** Días sobre los que se anualiza el costo. */
  dias: number
  tea: number
  /** Días hasta tener la plata disponible. */
  diasDisponibilidad: number
  impactoRelacion: number
  /** Desglose del costo, línea por línea, para mostrarlo sin que haya que creerle al número. */
  detalle: { concepto: string; monto: number }[]
  /** Una opción sin parámetros cargados no compite: no es que sea gratis, es que falta el dato. */
  configurada: boolean
}

export function costoBanco(bruto: number, dias: number, p: ParametrosFin) {
  const interes = bruto * (p.tasa_banco / 100 / 365) * dias
  const comision = p.comision_fija_banco
  return { interes, comision, total: interes + comision }
}

export function costoFinanciera(bruto: number, dias: number, p: ParametrosFin) {
  const interes = bruto * (p.tasa_financiera / 100 / 365) * dias
  const gastoFijo = bruto * (p.gasto_fijo_financiera / 100)
  const iva = (interes + gastoFijo) * (p.iva_pct / 100)
  return { interes, gastoFijo, iva, total: interes + gastoFijo + iva }
}

/** Horizonte para anualizar el descuento en efectivo.
 *
 *  Por defecto son los días de ESE cheque: ofrecer 8% para no esperar 93 días no es lo mismo
 *  que ofrecerlo para no esperar 9, y anualizar todo contra el DSO daba siempre la misma TEA
 *  —y dejaba al efectivo como el más caro incluso cuando en pesos costaba la mitad.
 *
 *  El DSO sirve para la otra pregunta: si conviene ofrecer el descuento a TODA la cartera.
 *  Para eso está horizonte_efectivo_dias, que cuando se carga a mano pisa este default. */
export function horizonteEfectivo(p: ParametrosFin, diasCheque: number): number {
  if (p.horizonte_efectivo_dias && p.horizonte_efectivo_dias > 0) return p.horizonte_efectivo_dias
  return Math.max(1, diasCheque)
}

/** Las tres opciones para un cheque de `bruto` que vence en `diasCheque` días. */
export function opcionesPara(bruto: number, diasCheque: number, p: ParametrosFin): OpcionFin[] {
  const b = costoBanco(bruto, diasCheque, p)
  const f = costoFinanciera(bruto, diasCheque, p)
  const diasEf = horizonteEfectivo(p, diasCheque)
  const costoEf = bruto * (p.descuento_efectivo / 100)

  return [
    {
      canal: 'banco',
      bruto,
      costo: b.total,
      neto: bruto - b.total,
      dias: diasCheque,
      tea: teaDe(b.total, bruto - b.total, diasCheque),
      diasDisponibilidad: p.dias_disp_banco,
      impactoRelacion: IMPACTO_RELACION.banco,
      detalle: [
        { concepto: `Interés ${p.tasa_banco}% TNA × ${diasCheque} d`, monto: b.interes },
        { concepto: 'Comisión fija', monto: b.comision },
      ],
      configurada: p.tasa_banco > 0 || p.comision_fija_banco > 0,
    },
    {
      canal: 'financiera',
      bruto,
      costo: f.total,
      neto: bruto - f.total,
      dias: diasCheque,
      tea: teaDe(f.total, bruto - f.total, diasCheque),
      diasDisponibilidad: p.dias_disp_financiera,
      impactoRelacion: IMPACTO_RELACION.financiera,
      detalle: [
        { concepto: `Interés ${p.tasa_financiera}% TNA × ${diasCheque} d`, monto: f.interes },
        { concepto: `Gasto fijo ${p.gasto_fijo_financiera}% s/ bruto`, monto: f.gastoFijo },
        { concepto: `IVA ${p.iva_pct}% s/ interés + gasto`, monto: f.iva },
      ],
      configurada: p.tasa_financiera > 0 || p.gasto_fijo_financiera > 0,
    },
    {
      canal: 'efectivo',
      bruto,
      costo: costoEf,
      neto: bruto - costoEf,
      dias: diasEf,
      tea: teaDe(costoEf, bruto - costoEf, diasEf),
      diasDisponibilidad: p.dias_disp_efectivo,
      impactoRelacion: IMPACTO_RELACION.efectivo,
      detalle: [{ concepto: `Descuento ${p.descuento_efectivo}% ofrecido al cliente`, monto: costoEf }],
      configurada: p.descuento_efectivo > 0,
    },
  ]
}

export interface OpcionEvaluada extends OpcionFin {
  nCosto: number
  nVelocidad: number
  nRelacion: number
  score: number
}

export interface Decision {
  ranking: OpcionEvaluada[]
  ganadora: OpcionEvaluada | null
  /** Por qué gana, en castellano. El número solo no alcanza para decidir. */
  justificacion: string
}

function normalizar(valores: number[]): number[] {
  const min = Math.min(...valores)
  const max = Math.max(...valores)
  if (max === min) return valores.map(() => 0)
  return valores.map((v) => (v - min) / (max - min))
}

export function pesosValidos(p: ParametrosFin): boolean {
  return p.peso_costo + p.peso_velocidad + p.peso_relacion === 100
}

/** Matriz de decisión ponderada. Score menor = mejor. Solo compiten las opciones configuradas. */
export function decidir(opciones: OpcionFin[], p: ParametrosFin): Decision {
  const compiten = opciones.filter((o) => o.configurada)
  if (compiten.length === 0)
    return { ranking: [], ganadora: null, justificacion: 'Faltan cargar los parámetros de financiamiento.' }

  // La TEA se normaliza en escala logarítmica porque es una tasa compuesta: en escala lineal,
  // una opción carísima (una TEA de cuatro dígitos) aplasta contra cero la diferencia entre las
  // dos razonables, y la decisión terminaba definiéndose sola por la urgencia.
  const nc = normalizar(compiten.map((o) => Math.log1p(Math.max(o.tea, 0))))
  const nv = normalizar(compiten.map((o) => o.diasDisponibilidad))
  const nr = normalizar(compiten.map((o) => o.impactoRelacion))
  const pc = p.peso_costo / 100
  const pv = p.peso_velocidad / 100
  const pr = p.peso_relacion / 100

  const ranking: OpcionEvaluada[] = compiten
    .map((o, i) => ({
      ...o,
      nCosto: nc[i],
      nVelocidad: nv[i],
      nRelacion: nr[i],
      score: nc[i] * pc + nv[i] * pv + nr[i] * pr,
    }))
    .sort((a, b) => a.score - b.score)

  return { ranking, ganadora: ranking[0], justificacion: justificar(ranking, p) }
}

function puntos(x: number): string {
  if (!isFinite(x) || x > 10) return 'más de 1.000'
  return (x * 100).toFixed(1).replace('.', ',')
}

function justificar(ranking: OpcionEvaluada[], p: ParametrosFin): string {
  const g = ranking[0]
  if (!g) return ''
  const segunda = ranking[1]
  if (!segunda) {
    return `${CANAL_LABEL[g.canal]} es la única opción con parámetros cargados: TEA ${puntos(g.tea)}%, disponible en ${g.diasDisponibilidad} día(s).`
  }

  const masBarata = [...ranking].sort((a, b) => a.tea - b.tea)[0]
  const masRapida = [...ranking].sort((a, b) => a.diasDisponibilidad - b.diasDisponibilidad)[0]
  const frases: string[] = []

  if (g.canal === masBarata.canal) {
    const dif = segunda.tea - g.tea
    frases.push(
      `${CANAL_LABEL[g.canal]} es la más barata: TEA ${puntos(g.tea)}% contra ${puntos(segunda.tea)}% de ${CANAL_LABEL[segunda.canal]}` +
        (dif > 0 ? `, ${puntos(dif)} puntos de diferencia` : '')
    )
  } else {
    // Cuando gana algo que no es lo más barato hay que poner el precio de esa decisión en pesos:
    // "más caro pero más rápido" no se puede juzgar sin saber cuánto más caro y cuántos días antes.
    const sobrecosto = g.costo - masBarata.costo
    const diasGanados = masBarata.diasDisponibilidad - g.diasDisponibilidad
    frases.push(
      `${CANAL_LABEL[g.canal]} no es la más barata (TEA ${puntos(g.tea)}% contra ${puntos(masBarata.tea)}% de ${CANAL_LABEL[masBarata.canal]}): elegirla cuesta ${plata(sobrecosto)} más` +
        (diasGanados > 0
          ? ` y adelanta la plata ${diasGanados} día${diasGanados === 1 ? '' : 's'} — con los pesos de hoy, esa urgencia lo justifica`
          : ', y gana igual con los pesos de hoy')
    )
  }

  if (masRapida.canal === g.canal && ranking.some((o) => o.diasDisponibilidad > g.diasDisponibilidad)) {
    frases.push(`y es la que deja la plata disponible antes (${g.diasDisponibilidad} día(s))`)
  } else if (masRapida.canal !== g.canal) {
    frases.push(
      `${CANAL_LABEL[masRapida.canal]} libera la plata antes (${masRapida.diasDisponibilidad} contra ${g.diasDisponibilidad} día(s)), pero la urgencia pesa solo ${p.peso_velocidad}%`
    )
  }

  if (g.canal !== 'efectivo' && ranking.some((o) => o.canal === 'efectivo')) {
    frases.push(
      `El descuento en efectivo queda afuera porque obliga a renegociar la forma de pago con el cliente, y el impacto comercial pesa ${p.peso_relacion}%`
    )
  } else if (g.canal === 'efectivo') {
    frases.push(
      `Gana pese al costo comercial de renegociar: con el costo financiero pesando ${p.peso_costo}%, la diferencia de TEA alcanza para justificarlo`
    )
  }

  // Las frases que arrancan con "y" continúan la anterior con coma, no con punto.
  return (
    frases.reduce((txt, f, i) => (i === 0 ? f : txt + (f.startsWith('y ') ? ', ' : '. ') + f), '') + '.'
  )
}

/** Costo Promedio Ponderado de Financiamiento: TEA ponderada por monto. El costo real de financiarnos hoy. */
export function cppf(items: { monto: number; tea: number }[]): number {
  const total = items.reduce((a, i) => a + i.monto, 0)
  if (total <= 0) return 0
  return items.reduce((a, i) => a + i.monto * i.tea, 0) / total
}

/* ── Cartera de cheques ─────────────────────────────────────────────── */

export const ESTADOS_CHEQUE = [
  { id: 'en_cartera', label: 'En cartera' },
  { id: 'pendiente_deposito', label: 'Pendiente de depósito' },
  { id: 'depositado', label: 'Depositado' },
  { id: 'cobrado', label: 'Cobrado' },
  { id: 'rechazado', label: 'Rechazado' },
  { id: 'cambiado', label: 'Cambiado' },
] as const

export type EstadoCheque = (typeof ESTADOS_CHEQUE)[number]['id']

/** Estados en los que el cheque todavía es plata a cobrar (entra al activo corriente y al CPPF). */
export const ESTADOS_VIVOS: string[] = ['en_cartera', 'pendiente_deposito', 'depositado']

export function estadoChequeLabel(e: string): string {
  return ESTADOS_CHEQUE.find((x) => x.id === e)?.label ?? e
}

/** Transiciones válidas. El cheque nunca salta de estado solo: esto es lo que habilita la pantalla. */
export const TRANSICIONES: Record<string, EstadoCheque[]> = {
  en_cartera: ['pendiente_deposito', 'cambiado', 'cobrado'],
  pendiente_deposito: ['depositado', 'en_cartera', 'cambiado'],
  depositado: ['cobrado', 'rechazado'],
  cobrado: [],
  rechazado: ['en_cartera', 'cambiado'],
  cambiado: [],
}

export interface MesFlujo {
  mes: string // YYYY-MM
  label: string
  monto: number
  acumulado: number
  cantidad: number
}

/** Proyección de flujo por mes de vencimiento. `meses` = horizonte (6 por defecto). */
export function proyeccionFlujo(
  cheques: { fecha_vencimiento: string; monto: number; estado: string }[],
  meses = 6,
  desde = new Date()
): MesFlujo[] {
  const base = new Date(desde.getFullYear(), desde.getMonth(), 1)
  const mesBase = `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, '0')}`
  const out: MesFlujo[] = []
  const vivos = cheques.filter((c) => ESTADOS_VIVOS.includes(c.estado))
  let acum = 0
  for (let i = 0; i < meses; i++) {
    const d = new Date(base.getFullYear(), base.getMonth() + i, 1)
    const mes = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    // Lo que venció en meses anteriores y sigue sin cobrarse es plata de HOY, no de un mes
    // que ya pasó: entra al primer mes del horizonte para no desaparecer del flujo.
    const delMes = vivos.filter((c) => {
      const m = (c.fecha_vencimiento || '').slice(0, 7)
      return m === mes || (i === 0 && m < mesBase)
    })
    const monto = delMes.reduce((a, c) => a + Number(c.monto || 0), 0)
    acum += monto
    out.push({
      mes,
      label: d.toLocaleDateString('es-AR', { month: 'short', year: '2-digit' }).replace('.', ''),
      monto,
      acumulado: acum,
      cantidad: delMes.length,
    })
  }
  return out
}

/* ── Cuentas corrientes: aging ──────────────────────────────────────── */

export const TRAMOS = [
  { id: 'por_vencer', label: 'A vencer' },
  { id: 't0_30', label: '0–30' },
  { id: 't31_60', label: '31–60' },
  { id: 't61_90', label: '61–90' },
  { id: 't90', label: '+90' },
] as const

export type TramoId = (typeof TRAMOS)[number]['id']

/** Los tramos son días de MORA (contados desde el vencimiento pactado), no días desde la factura. */
export function tramoDe(diasMora: number): TramoId {
  if (diasMora <= 0) return 'por_vencer'
  if (diasMora <= 30) return 't0_30'
  if (diasMora <= 60) return 't31_60'
  if (diasMora <= 90) return 't61_90'
  return 't90'
}

export interface VencimientoCC {
  pedidoId: number
  cod: string
  cliente: string
  vendedor: string
  fechaFactura: string
  fechaVenc: string
  monto: number
  diasMora: number
  tramo: TramoId
}

export function sumarDias(fecha: string, dias: number): string {
  const d = new Date(fecha + 'T00:00:00')
  d.setDate(d.getDate() + dias)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export interface AgingCliente {
  cod: string
  cliente: string
  vendedor: string
  total: number
  porTramo: Record<TramoId, number>
  masViejo: number
}

const TRAMOS_CERO = (): Record<TramoId, number> => ({ por_vencer: 0, t0_30: 0, t31_60: 0, t61_90: 0, t90: 0 })

export function agruparPorCliente(vencs: VencimientoCC[]): AgingCliente[] {
  const map = new Map<string, AgingCliente>()
  for (const v of vencs) {
    const key = v.cod || v.cliente
    let c = map.get(key)
    if (!c) {
      c = { cod: v.cod, cliente: v.cliente, vendedor: v.vendedor, total: 0, porTramo: TRAMOS_CERO(), masViejo: 0 }
      map.set(key, c)
    }
    c.total += v.monto
    c.porTramo[v.tramo] += v.monto
    if (v.diasMora > c.masViejo) c.masViejo = v.diasMora
  }
  return [...map.values()].sort((a, b) => b.total - a.total)
}

export function totalesPorTramo(vencs: VencimientoCC[]): Record<TramoId, number> {
  const t = TRAMOS_CERO()
  for (const v of vencs) t[v.tramo] += v.monto
  return t
}

/* ── Indicadores de liquidez ────────────────────────────────────────── */

export interface KpisLiquidez {
  caja: number
  chequesACobrar: number
  cuentasPorCobrar: number
  inventario: number
  activoCorriente: number
  pasivoCorriente: number
  liquidez: number
  acida: number
  capitalTrabajo: number
  dso: number
  runwayDias: number
}

export function calcularKpis(
  caja: number,
  chequesACobrar: number,
  cuentasPorCobrar: number,
  ventasAnuales: number,
  p: ParametrosFin
): KpisLiquidez {
  const inventario = Number(p.inventario_valorizado || 0)
  const pasivo = Number(p.pasivo_corriente || 0)
  const activo = caja + chequesACobrar + cuentasPorCobrar + inventario
  const gasto = Number(p.gasto_mensual || 0)
  return {
    caja,
    chequesACobrar,
    cuentasPorCobrar,
    inventario,
    activoCorriente: activo,
    pasivoCorriente: pasivo,
    liquidez: pasivo > 0 ? activo / pasivo : 0,
    acida: pasivo > 0 ? (activo - inventario) / pasivo : 0,
    capitalTrabajo: activo - pasivo,
    dso: ventasAnuales > 0 ? (cuentasPorCobrar / ventasAnuales) * 365 : 0,
    runwayDias: gasto > 0 ? (caja / gasto) * 30 : 0,
  }
}

export type Semaforo = 'verde' | 'ambar' | 'rojo'

/** Verde: llega a la referencia. Ámbar: entre el 80% y la referencia. Rojo: abajo del 80%. */
export function semaforo(valor: number, referencia: number): Semaforo {
  if (referencia <= 0) return 'ambar'
  // Con tolerancia: 1,2 / 1,5 da 0,79999… en binario, y sin el epsilon un valor
  // exactamente en el borde del ámbar se pintaba rojo.
  const razon = valor / referencia
  const EPS = 1e-9
  if (razon >= 1 - EPS) return 'verde'
  if (razon >= 0.8 - EPS) return 'ambar'
  return 'rojo'
}

/* ── Formato ────────────────────────────────────────────────────────── */

/** Plata en tablas financieras: el cero se muestra, no se esconde (a diferencia de formatPrecio). */
export function plata(n: number | null | undefined): string {
  const v = Math.round(Number(n || 0))
  return '$ ' + v.toLocaleString('es-AR')
}

export function plataCorta(n: number | null | undefined): string {
  const v = Math.round(Number(n || 0))
  const abs = Math.abs(v)
  if (abs >= 1_000_000) return `$ ${(v / 1_000_000).toFixed(1).replace('.', ',')}M`
  if (abs >= 1_000) return `$ ${Math.round(v / 1_000)}k`
  return `$ ${v}`
}

export function pct(n: number, dec = 1): string {
  return (n * 100).toFixed(dec).replace('.', ',') + '%'
}

/** TEA para mostrar. Arriba de 1.000% el número exacto no informa nada: alcanza con "es impagable". */
export function pctTea(n: number): string {
  if (!isFinite(n)) return '> 1.000%'
  if (n > 10) return '> 1.000%'
  return pct(n)
}

export function num(n: number, dec = 2): string {
  return n.toFixed(dec).replace('.', ',')
}
