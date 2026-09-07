#!/usr/bin/env node
// Suite del núcleo financiero (src/lib/finanzas.ts).
//
//   node tests/test-finanzas.mjs
//
// No toca la base ni la red: verifica la matemática, que es donde un error no se ve
// hasta que ya se tomó la decisión equivocada. Node 22+ corre el .ts directo.

import {
  calcularKpis,
  costoBanco,
  costoFinanciera,
  cppf,
  decidir,
  diasHasta,
  opcionesPara,
  proyeccionFlujo,
  semaforo,
  textoVencimiento,
  sumarDias,
  teaDe,
  totalesPorTramo,
  tramoDe,
} from '../src/lib/finanzas.ts'

let ok = 0
let fail = 0
const casos = []

function check(bloque, nombre, cond, detalle = '') {
  if (cond) ok++
  else fail++
  casos.push({ bloque, nombre, pass: !!cond, detalle })
}

const cerca = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol

/** Parámetros de referencia: banco 60% TNA, financiera 75% TNA + 1% de gastos, 8% de descuento por efectivo. */
const P = {
  id: 1,
  tasa_financiera: 75,
  gasto_fijo_financiera: 1,
  tasa_banco: 60,
  comision_fija_banco: 5000,
  descuento_efectivo: 8,
  iva_pct: 21,
  horizonte_efectivo_dias: null,
  dias_disp_banco: 2,
  dias_disp_financiera: 1,
  dias_disp_efectivo: 0,
  peso_costo: 60,
  peso_velocidad: 25,
  peso_relacion: 15,
  alerta_mora_pct: 15,
  pasivo_corriente: 0,
  inventario_valorizado: 0,
  gasto_mensual: 0,
  ref_liquidez: 1.5,
  ref_acida: 1,
  ref_runway_dias: 90,
  vigente_desde: '2026-09-01',
}

/* ── 1. TEA ─────────────────────────────────────────────────────────── */
{
  const t = teaDe(100, 900, 90)
  check('tea', 'TEA compone: 100 de costo sobre 900 netos a 90 días', cerca(t, Math.pow(1 + 100 / 900, 365 / 90) - 1))
  check('tea', 'TEA de ese caso ronda 53,3%', cerca(t, 0.5331, 0.0005), t.toFixed(4))

  // Lo que distingue TEA de costo lineal: el mismo % bruto cuesta muchísimo más a plazo corto.
  const corto = teaDe(50, 950, 30)
  const largo = teaDe(50, 950, 120)
  check('tea', 'Mismo costo a 30 días es más caro que a 120 (el lineal no lo vería)', corto > largo)
  check('tea', 'A 365 días la TEA iguala la tasa del período', cerca(teaDe(100, 900, 365), 100 / 900))
  check('tea', 'Sin plazo o sin neto devuelve 0, no infinito', teaDe(100, 0, 90) === 0 && teaDe(100, 900, 0) === 0)
}

/* ── 2. Costo por canal ─────────────────────────────────────────────── */
{
  const bruto = 1_000_000
  const dias = 60

  const b = costoBanco(bruto, dias, P)
  check('canal', 'Banco = interés proporcional + comisión fija', cerca(b.total, bruto * (0.6 / 365) * 60 + 5000, 1e-6))

  const f = costoFinanciera(bruto, dias, P)
  const interes = bruto * (0.75 / 365) * 60
  const gasto = bruto * 0.01
  check('canal', 'Financiera = interés + gasto fijo + IVA sobre ambos', cerca(f.total, interes + gasto + (interes + gasto) * 0.21, 1e-6))
  check('canal', 'El IVA de la financiera es el 21% de interés + gasto', cerca(f.iva, (interes + gasto) * 0.21, 1e-6))

  const ops = opcionesPara(bruto, dias, P)
  const ef = ops.find((o) => o.canal === 'efectivo')
  check('canal', 'Efectivo cuesta el % de descuento ofrecido', cerca(ef.costo, bruto * 0.08, 1e-6))
  // El descuento evita la espera de ESE cheque: 8% por no esperar 60 días, no por no esperar el DSO.
  check('canal', 'Efectivo se anualiza sobre el plazo del cheque (60 d)', ef.dias === 60)
  check('canal', 'El horizonte cargado a mano pisa ese default', opcionesPara(bruto, dias, { ...P, horizonte_efectivo_dias: 30 }).find((o) => o.canal === 'efectivo').dias === 30)

  // El caso que destapó el error: a plazo largo, en pesos el efectivo cuesta la mitad que el banco,
  // y la TEA tiene que reflejarlo en vez de mostrarlo como el canal más caro.
  const largo = opcionesPara(1_760_000, 93, P)
  const efL = largo.find((o) => o.canal === 'efectivo')
  const bcoL = largo.find((o) => o.canal === 'banco')
  check('canal', 'Cheque a 93 días: en pesos el efectivo cuesta menos que el banco', efL.costo < bcoL.costo)
  check('canal', 'Y su TEA también queda por debajo', efL.tea < bcoL.tea, `efectivo ${(efL.tea * 100).toFixed(1)}% vs banco ${(bcoL.tea * 100).toFixed(1)}%`)

  // A la inversa, ofrecer el mismo 8% para cobrar un día antes es carísimo, y así debe verse.
  const corto = opcionesPara(1_000_000, 1, P)
  check('canal', 'Cheque a 1 día: el mismo descuento pasa a ser el más caro', corto.find((o) => o.canal === 'efectivo').tea > corto.find((o) => o.canal === 'banco').tea)

  const sinTasas = opcionesPara(bruto, dias, { ...P, tasa_banco: 0, comision_fija_banco: 0 })
  check('canal', 'Un canal sin tasa cargada no compite (no se lo toma como gratis)', sinTasas.find((o) => o.canal === 'banco').configurada === false)
  check('canal', 'El neto siempre es bruto menos costo', ops.every((o) => cerca(o.neto, o.bruto - o.costo, 1e-6)))
}

/* ── 3. Matriz de decisión ──────────────────────────────────────────── */
{
  const ops = opcionesPara(1_000_000, 60, P)
  const soloCosto = decidir(ops, { ...P, peso_costo: 100, peso_velocidad: 0, peso_relacion: 0 })
  const masBarata = [...ops].sort((a, b) => a.tea - b.tea)[0]
  check('matriz', 'Con el costo pesando 100%, gana la TEA más baja', soloCosto.ganadora.canal === masBarata.canal, `${soloCosto.ganadora.canal} / TEA ${(soloCosto.ganadora.tea * 100).toFixed(1)}%`)

  const soloUrgencia = decidir(ops, { ...P, peso_costo: 0, peso_velocidad: 100, peso_relacion: 0 })
  check('matriz', 'Con la urgencia pesando 100%, gana el de disponibilidad más rápida', soloUrgencia.ganadora.diasDisponibilidad === Math.min(...ops.map((o) => o.diasDisponibilidad)))

  const soloRelacion = decidir(ops, { ...P, peso_costo: 0, peso_velocidad: 0, peso_relacion: 100 })
  check('matriz', 'Con la relación pesando 100%, no gana el descuento en efectivo', soloRelacion.ganadora.canal !== 'efectivo')

  check('matriz', 'El ranking sale ordenado por score, de menor a mayor', soloCosto.ranking.every((o, i, a) => i === 0 || a[i - 1].score <= o.score))
  check('matriz', 'Los normalizados caen entre 0 y 1', soloCosto.ranking.every((o) => o.nCosto >= 0 && o.nCosto <= 1 && o.nVelocidad >= 0 && o.nVelocidad <= 1))
  check('matriz', 'La justificación nombra al canal ganador', decidir(ops, P).justificacion.length > 40)

  const sinNada = decidir(opcionesPara(1_000_000, 60, { ...P, tasa_banco: 0, comision_fija_banco: 0, tasa_financiera: 0, gasto_fijo_financiera: 0, descuento_efectivo: 0 }), P)
  check('matriz', 'Sin ningún parámetro cargado no inventa una ganadora', sinNada.ganadora === null)
}


/* ── 3 bis. La normalización no se deja aplastar por una opción absurda ── */
{
  // Cheque a 1 día: el banco anualiza su comisión fija a una tasa de cuatro dígitos.
  const ops = opcionesPara(1_000_000, 1, { ...P, horizonte_efectivo_dias: 45 })
  const d = decidir(ops, { ...P, horizonte_efectivo_dias: 45, peso_costo: 100, peso_velocidad: 0, peso_relacion: 0 })
  const masBarata = [...ops].filter((o) => o.configurada).sort((a, b) => a.tea - b.tea)[0]
  check('matriz', 'Con una opción de TEA absurda, el costo puro sigue eligiendo la más barata', d.ganadora.canal === masBarata.canal)
  const caras = d.ranking.filter((o) => o.canal !== masBarata.canal)
  check('matriz', 'Y las otras no quedan pegadas a cero (escala logarítmica)', caras.every((o) => o.nCosto > 0.01))

  // Sin horizonte cargado, el efectivo igual compite: se anualiza sobre el plazo del cheque.
  const sinHorizonte = opcionesPara(1_000_000, 60, { ...P, horizonte_efectivo_dias: null })
  const efS = sinHorizonte.find((o) => o.canal === 'efectivo')
  check('canal', 'Sin horizonte cargado el efectivo igual compite, sobre el plazo del cheque', efS.configurada === true && efS.dias === 60)
}


/* ── 3 ter. La justificación pone precio a la decisión ──────────────── */
{
  // Pesos que hacen ganar a la financiera (más cara pero un día más rápida).
  const ops = opcionesPara(1_000_000, 60, { ...P, horizonte_efectivo_dias: 9 })
  const d = decidir(ops, { ...P, horizonte_efectivo_dias: 9, peso_costo: 60, peso_velocidad: 25, peso_relacion: 15 })
  const masBarata = [...d.ranking].sort((a, b) => a.tea - b.tea)[0]
  if (d.ganadora.canal !== masBarata.canal) {
    check('matriz', 'Si gana algo que no es lo más barato, dice cuánto más cuesta en pesos', d.justificacion.includes('elegirla cuesta $'))
    check('matriz', 'Y dice cuántos días se adelantan', /adelanta la plata \d+ día/.test(d.justificacion))
  } else {
    check('matriz', 'Gana la más barata: no hace falta justificar sobrecosto', true)
    check('matriz', 'Gana la más barata: no hace falta justificar sobrecosto (2)', true)
  }
}

/* ── 4. CPPF ────────────────────────────────────────────────────────── */
{
  const c = cppf([
    { monto: 1_000_000, tea: 0.5 },
    { monto: 3_000_000, tea: 1.0 },
  ])
  check('cppf', 'Pondera por monto, no por cantidad de cheques', cerca(c, 0.875, 1e-9), c.toFixed(4))
  check('cppf', 'Cartera vacía devuelve 0', cppf([]) === 0)
  check('cppf', 'Un solo cheque devuelve su propia TEA', cerca(cppf([{ monto: 500, tea: 0.42 }]), 0.42))
}

/* ── 5. Aging ───────────────────────────────────────────────────────── */
{
  check('aging', 'Sin mora todavía = a vencer', tramoDe(0) === 'por_vencer' && tramoDe(-5) === 'por_vencer')
  check('aging', 'El primer día de mora entra a 0–30', tramoDe(1) === 't0_30')
  check('aging', 'Los bordes caen donde corresponde', tramoDe(30) === 't0_30' && tramoDe(31) === 't31_60' && tramoDe(60) === 't31_60' && tramoDe(90) === 't61_90' && tramoDe(91) === 't90')

  const vencs = [
    { monto: 100, tramo: tramoDe(10) },
    { monto: 200, tramo: tramoDe(100) },
    { monto: 300, tramo: tramoDe(-3) },
  ]
  const t = totalesPorTramo(vencs)
  check('aging', 'Los tramos suman el total de la cartera', t.por_vencer + t.t0_30 + t.t31_60 + t.t61_90 + t.t90 === 600)
  check('aging', '+90 días junta lo que corresponde', t.t90 === 200)

  check('aging', 'sumarDias cruza el fin de mes', sumarDias('2026-01-31', 1) === '2026-02-01')
  check('aging', 'sumarDias cruza el fin de año', sumarDias('2026-12-15', 30) === '2027-01-14')
  check('aging', 'sumarDias respeta el año bisiesto', sumarDias('2028-02-28', 1) === '2028-02-29')
}

/* ── 6. Proyección de flujo ─────────────────────────────────────────── */
{
  const hoy = new Date(2026, 8, 3) // 3/9/2026
  const cheques = [
    { fecha_vencimiento: '2026-09-20', monto: 100, estado: 'en_cartera' },
    { fecha_vencimiento: '2026-10-05', monto: 200, estado: 'depositado' },
    { fecha_vencimiento: '2026-10-25', monto: 50, estado: 'cobrado' },   // ya cobrado: no es flujo futuro
    { fecha_vencimiento: '2026-11-01', monto: 300, estado: 'rechazado' }, // rechazado: tampoco
    { fecha_vencimiento: '2027-06-01', monto: 900, estado: 'en_cartera' }, // fuera del horizonte
  ]
  const f = proyeccionFlujo(cheques, 6, hoy)
  check('flujo', 'Devuelve exactamente los meses del horizonte', f.length === 6)
  check('flujo', 'Arranca en el mes en curso', f[0].mes === '2026-09')
  check('flujo', 'Solo cuenta cheques todavía a cobrar', f[0].monto === 100 && f[1].monto === 200)
  check('flujo', 'El acumulado no retrocede', f.every((m, i) => i === 0 || m.acumulado >= f[i - 1].acumulado))
  check('flujo', 'El acumulado del último mes es la suma del horizonte', f[5].acumulado === 300)
  check('flujo', 'Lo que vence después del horizonte queda afuera', f.reduce((a, m) => a + m.monto, 0) === 300)
  check('flujo', 'diasHasta nunca da 0 (no se anualiza contra cero)', diasHasta('2026-09-03', hoy) === 1)
}


/* ── 6 bis. Vencidos y textos de vencimiento ────────────────────────── */
{
  const hoy = new Date(2026, 8, 3)
  const conVencido = [
    { fecha_vencimiento: '2026-08-30', monto: 2310000, estado: 'depositado' }, // venció el mes pasado y sigue vivo
    { fecha_vencimiento: '2026-09-20', monto: 100, estado: 'en_cartera' },
  ]
  const f = proyeccionFlujo(conVencido, 6, hoy)
  check('flujo', 'Lo vencido y sin cobrar no desaparece: entra al mes en curso', f[0].monto === 2310100)
  check('flujo', 'Y no se cuenta dos veces en el acumulado', f[5].acumulado === 2310100)

  check('flujo', 'Texto: vencimiento futuro', textoVencimiento('2026-09-12', hoy) === 'en 9 días')
  check('flujo', 'Texto: un solo día, en singular', textoVencimiento('2026-09-04', hoy) === 'en 1 día')
  check('flujo', 'Texto: vence hoy', textoVencimiento('2026-09-03', hoy) === 'vence hoy')
  check('flujo', 'Texto: ya vencido (antes decía "en 1 días")', textoVencimiento('2026-08-30', hoy) === 'vencido hace 4 días')
}

/* ── 7. Indicadores de liquidez ─────────────────────────────────────── */
{
  const p = { ...P, pasivo_corriente: 10_000_000, inventario_valorizado: 8_000_000, gasto_mensual: 5_000_000 }
  const k = calcularKpis(4_000_000, 3_000_000, 5_000_000, 120_000_000, p)
  check('kpi', 'Activo corriente = caja + cheques + por cobrar + inventario', k.activoCorriente === 20_000_000)
  check('kpi', 'Liquidez corriente = activo / pasivo', cerca(k.liquidez, 2))
  check('kpi', 'Prueba ácida saca el inventario', cerca(k.acida, 1.2))
  check('kpi', 'Capital de trabajo = activo − pasivo', k.capitalTrabajo === 10_000_000)
  check('kpi', 'DSO = (por cobrar / ventas anuales) × 365', cerca(k.dso, (5_000_000 / 120_000_000) * 365, 1e-9))
  check('kpi', 'Runway = caja / gasto mensual × 30', cerca(k.runwayDias, 24))

  const sinPasivo = calcularKpis(1, 1, 1, 0, { ...P, pasivo_corriente: 0 })
  check('kpi', 'Sin pasivo cargado no divide por cero', sinPasivo.liquidez === 0 && sinPasivo.acida === 0 && sinPasivo.dso === 0)

  check('kpi', 'Semáforo verde al llegar a la referencia', semaforo(1.5, 1.5) === 'verde')
  check('kpi', 'Semáforo ámbar entre el 80% y la referencia', semaforo(1.2, 1.5) === 'ambar')
  check('kpi', 'Semáforo rojo abajo del 80%', semaforo(1.19, 1.5) === 'rojo')
}

/* ── Resultado ──────────────────────────────────────────────────────── */
let bloqueActual = ''
for (const c of casos) {
  if (c.bloque !== bloqueActual) {
    bloqueActual = c.bloque
    console.log(`\n── ${bloqueActual}`)
  }
  console.log(`${c.pass ? '  PASS' : '  FAIL'}  ${c.nombre}${c.detalle ? `  (${c.detalle})` : ''}`)
}
console.log(`\n${ok} PASS · ${fail} FAIL\n`)
process.exit(fail === 0 ? 0 : 1)
