// Orbital Vision Lab — lógica del pretest, portada tal cual de pretest-orbital.html v1.1.
// No cambiar umbrales ni textos sin revisarlo con Gastón: el pretest es orientativo (no dispositivo médico).

export type Eye = 'R' | 'L'
/** Hacia dónde está la abertura del anillo (C de Landolt de 8 posiciones, como Zeiss y Essilor). */
export type Dir = 'up' | 'down' | 'left' | 'right' | 'ur' | 'ul' | 'dr' | 'dl'
export type Usa = 'no' | 'si' | 'viejos'
export type Estado = 'ok' | 'warn' | 'bad'
export type NearId = 'J1' | 'J3' | 'J5' | 'J7' | 'J10' | 'J14'
/** Test rojo-verde (duocromo): de qué lado se ven más nítidos los anillos. */
export type Duo = 'rojo' | 'verde' | 'iguales'

export interface Resultados {
  pxPerMm: number
  /** Distancia de la prueba de lejos en mm: 3000 (3 m con ayudante o 1,5 m frente a un espejo) o 500 (brazo estirado). */
  distMm: number
  /** La prueba de lejos se hizo frente a un espejo (el reflejo duplica la distancia). */
  espejo: boolean
  acuity: { R: number | null; L: number | null }
  /** Agudeza de cerca a 40 cm, ojo por ojo (anillo de 8 posiciones). */
  acuityNear: { R: number | null; L: number | null }
  contrast: number | null
  astig: { R: boolean | null; L: boolean | null }
  colorHits: number
  amsler: { R: boolean | null; L: boolean | null }
  near: NearId | null
  /** Duocromo a 40 cm, ojo por ojo. */
  duo: { R: Duo | null; L: Duo | null }
  /** Distancia entre pupilas medida con la tarjeta en la frente (mm), si la midió. */
  dp: { lejos: number; cerca: number } | null
}

/** Cuestionario inicial de hábitos (como el "Vision Profile" de Zeiss): alimenta la recomendación de cristales. */
export interface Habitos {
  pantalla: 'poco' | 'medio' | 'mucho' | null
  noche: boolean | null
  sol: boolean | null
  control: 'reciente' | '1-2' | 'mas2' | 'nunca' | null
}
export const habitosVacios = (): Habitos => ({ pantalla: null, noche: null, sol: null, control: null })

export const LEVELS = [0.1, 0.2, 0.3, 0.5, 0.7, 1.0]
export const CLEVELS = [100, 50, 25, 12, 6, 3]
export const DIST_MM = 500
export const DIST_LEJOS_MM = 3000
export const DIST_CERCA_MM = 400
export const CARD_MM = 85.6
export const CARD_H_MM = 53.98
export const CAL_DEFAULT = 323

export const PLATES: { d: string; fg: [number, number]; bg: [number, number] }[] = [
  { d: '8', fg: [120, 60], bg: [15, 70] },
  { d: '3', fg: [95, 55], bg: [25, 65] },
  { d: '5', fg: [140, 50], bg: [10, 60] },
] // [hue, sat] verdoso sobre rojo/naranja

export const NEAR: { id: NearId; mm: number; t: string }[] = [
  { id: 'J1', mm: 1.0, t: 'Los anteojos bien graduados descansan la vista y evitan el dolor de cabeza al final del día.' },
  { id: 'J3', mm: 1.4, t: 'La lectura cómoda a 40 cm es la primera señal de una buena graduación de cerca.' },
  { id: 'J5', mm: 2.0, t: 'Cada dos años conviene revisar la vista aunque no notes cambios.' },
  { id: 'J7', mm: 2.8, t: 'La luz del sol daña la retina: usá protección UV todo el año.' },
  { id: 'J10', mm: 3.8, t: 'Después de los 40, el enfoque de cerca cambia.' },
  { id: 'J14', mm: 5.2, t: 'Ninguno de los anteriores.' },
]

/** Diámetro en mm del anillo de agudeza v a la distancia dada (5 minutos de arco para 1.0; abertura = 1/5). */
export const letterMm = (v: number, dist = DIST_MM) => dist * Math.tan(((5 / 60) * (Math.PI / 180)) / v)

export const DIRS: Dir[] = ['up', 'ur', 'right', 'dr', 'down', 'dl', 'left', 'ul']
/** Posición al azar, distinta de la anterior. Con 8 posiciones se acierta de casualidad 1 vez en 8 (con la E, 1 en 4). */
export const rndDir = (antes?: Dir): Dir => {
  const d = DIRS[Math.floor(Math.random() * DIRS.length)]
  return d === antes ? rndDir(antes) : d
}

/** Agudeza en las notaciones de las cartillas: decimal, pies (20/x) y metros (6/x), como Peek y Zeiss. */
export const acuityLabel = (v: number | null) =>
  v === null ? '—' : v === 0 ? '<0.1 (<20/200 · <6/60)' : `${v.toFixed(1)} (20/${Math.round(20 / v)} · 6/${Math.round(6 / v)})`
/** logMAR (0 = 10/10; cada 0,1 es un renglón de la cartilla ETDRS). */
export const logmar = (v: number | null) => (v === null ? '—' : v === 0 ? '>1.0' : (-Math.log10(v)).toFixed(1))

/** Pinta una lámina pseudoisocromática en el canvas (300×300). */
export function drawPlate(canvas: HTMLCanvasElement, p: (typeof PLATES)[number]) {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const W = 300
  ctx.clearRect(0, 0, W, W)
  const m = document.createElement('canvas')
  m.width = m.height = W
  const mc = m.getContext('2d')!
  mc.font = 'bold 210px "IBM Plex Sans", Arial'
  mc.textAlign = 'center'
  mc.textBaseline = 'middle'
  mc.fillStyle = '#000'
  mc.fillText(p.d, W / 2, W / 2 + 10)
  const mask = mc.getImageData(0, 0, W, W).data
  ctx.fillStyle = '#fff'
  ctx.beginPath()
  ctx.arc(W / 2, W / 2, W / 2, 0, Math.PI * 2)
  ctx.fill()
  const dots: { x: number; y: number; r: number; c: string }[] = []
  let tries = 0
  while (dots.length < 900 && tries < 40000) {
    tries++
    const r = 3 + Math.random() * 7
    const x = Math.random() * W
    const y = Math.random() * W
    if (Math.hypot(x - W / 2, y - W / 2) > W / 2 - r) continue
    if (dots.some((d) => Math.hypot(d.x - x, d.y - y) < d.r + r + 1)) continue
    const inside = mask[((y | 0) * W + (x | 0)) * 4 + 3] > 128
    const [h, s] = inside ? p.fg : p.bg
    const L = 48 + Math.random() * 22
    dots.push({ x, y, r, c: `hsl(${h + (Math.random() * 16 - 8)} ${s}% ${L}%)` })
  }
  dots.forEach((d) => {
    ctx.fillStyle = d.c
    ctx.beginPath()
    ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2)
    ctx.fill()
  })
}

export interface ItemInforme {
  s: Estado
  n: string
  v: string
  t: string
}

export interface Informe {
  items: ItemInforme[]
  score: number
  indice: number
  semaforo: 'verde' | 'amarillo' | 'rojo'
  titulo: string
  lead: string
}

export function evaluar(S: Resultados, edad: number | null, usa: Usa, nombre: string): Informe {
  const items: ItemInforme[] = []
  let score = 0
  const aR = S.acuity.R ?? 0
  const aL = S.acuity.L ?? 0
  const minA = Math.min(aR, aL)
  const diff = Math.abs(aR - aL)
  let aS: Estado = minA >= 0.7 ? 'ok' : minA >= 0.3 ? 'warn' : 'bad'
  if (diff >= 0.3 && aS === 'ok') aS = 'warn'
  score += aS === 'ok' ? 0 : aS === 'warn' ? 1 : 2
  items.push({
    s: aS, n: S.distMm >= 2000 ? 'Visión de lejos (3 m)' : 'Visión de lejos (a 50 cm, estimada)',
    v: `OD ${acuityLabel(S.acuity.R)} · OI ${acuityLabel(S.acuity.L)}`,
    t: aS === 'ok' ? (S.distMm >= 2000 ? 'Dentro de lo esperado.' : 'Dentro de lo esperado a 50 cm. Para medir bien la visión de lejos, repetila a 3 m con ayuda.')
      : aS === 'warn' ? 'Por debajo de lo esperado en al menos un ojo, o diferencia notable entre ojos.'
      : 'Baja agudeza: pedí turno pronto.',
  })

  // Agudeza de cerca a 40 cm, ojo por ojo (2026-09-30, pedido de Gastón: prueba de cerca y de lejos por separado).
  const minN = Math.min(S.acuityNear.R ?? 0, S.acuityNear.L ?? 0)
  const naS: Estado = minN >= 0.7 ? 'ok' : minN >= 0.4 ? 'warn' : 'bad'
  score += naS === 'ok' ? 0 : naS === 'warn' ? 1 : 2
  items.push({
    s: naS, n: 'Visión de cerca (40 cm)', v: `OD ${acuityLabel(S.acuityNear.R)} · OI ${acuityLabel(S.acuityNear.L)}`,
    t: naS === 'ok' ? 'Buen enfoque de cerca en ambos ojos.'
      : edad && edad >= 40 ? 'Cuesta enfocar de cerca: a tu edad suele ser presbicia (vista cansada), se corrige con anteojos de lectura o multifocales.'
      : 'Cuesta enfocar de cerca en al menos un ojo: vale la pena revisarlo.',
  })

  const c = S.contrast
  const cS: Estado = c !== null && c <= 6 ? 'ok' : c !== null && c <= 25 ? 'warn' : 'bad'
  score += cS === 'ok' ? 0 : cS === 'warn' ? 1 : 2
  items.push({
    s: cS, n: 'Sensibilidad al contraste', v: c === null ? 'no detectada' : 'umbral ' + c + '%',
    t: cS === 'ok' ? 'Distinguís contrastes bajos: normal.'
      : cS === 'warn' ? 'Umbral algo alto. Puede deberse al brillo de pantalla o a un principio de opacidad; conviene revisarlo.'
      : 'Umbral muy alto. Merece consulta.',
  })

  const asBad = S.astig.R === false || S.astig.L === false
  score += asBad ? 1 : 0
  items.push({
    s: asBad ? 'warn' : 'ok', n: 'Astigmatismo',
    v: `OD ${S.astig.R ? 'parejo' : 'desparejo'} · OI ${S.astig.L ? 'parejo' : 'desparejo'}`,
    t: asBad ? 'Compatible con astigmatismo; se corrige con anteojos.' : 'Todas las líneas parejas en ambos ojos.',
  })

  const ch = S.colorHits
  const cvS: Estado = ch === 3 ? 'ok' : ch === 2 ? 'warn' : 'bad'
  score += cvS === 'ok' ? 0 : 1
  items.push({
    s: cvS, n: 'Visión de color', v: `${ch}/3 láminas`,
    t: cvS === 'ok' ? 'Sin indicios de alteración rojo-verde.'
      : cvS === 'warn' ? 'Una lámina fallida: puede ser la pantalla. Si se repite, consultá.'
      : 'Posible dificultad rojo-verde. Es hereditaria y frecuente; un oftalmólogo lo confirma.',
  })

  const amBad = S.amsler.R === false || S.amsler.L === false
  score += amBad ? 3 : 0
  items.push({
    s: amBad ? 'bad' : 'ok', n: 'Visión central',
    v: `OD ${S.amsler.R ? 'normal' : 'alterada'} · OI ${S.amsler.L ? 'normal' : 'alterada'}`,
    t: amBad ? 'Líneas onduladas o faltantes. Consulta oftalmológica sin demora; no se resuelve con anteojos.'
      : 'Rejilla recta y completa en ambos ojos.',
  })

  const ni = NEAR.findIndex((n) => n.id === S.near)
  let nS: Estado = 'ok'
  let nT = ''
  if (ni <= 1) nT = 'Visión de cerca cómoda.'
  else if (ni <= 3) {
    nS = 'warn'
    nT = edad && edad >= 40
      ? 'A tu edad es habitual la presbicia: se resuelve con anteojos de lectura o multifocales.'
      : 'Cuesta la lectura fina; vale la pena revisarlo.'
    score += 1
  } else {
    nS = 'bad'
    nT = 'Necesitás una revisión de cerca.'
    score += 2
  }
  items.push({ s: nS, n: 'Lectura (texto chico)', v: 'hasta ' + (S.near === 'J14' ? 'ninguno' : S.near), t: nT })

  // Duocromo a 40 cm (2026-10-02, idea de Essilor): orientativo, no suma al puntaje para no mover el semáforo.
  if (S.duo.R || S.duo.L) {
    const lados = [S.duo.R, S.duo.L]
    const verde = lados.includes('verde')
    const rojo = lados.includes('rojo')
    const nom = (d: Duo | null) => (d === null ? '—' : d === 'iguales' ? 'parejo' : d)
    items.push({
      s: verde || rojo ? 'warn' : 'ok', n: 'Rojo y verde (40 cm)', v: `OD ${nom(S.duo.R)} · OI ${nom(S.duo.L)}`,
      t: !verde && !rojo ? 'Los dos lados se ven parejos: el enfoque de cerca está equilibrado.'
        : verde ? (usa === 'si'
          ? 'Más nítido sobre verde: tus anteojos podrían quedarse cortos de cerca. Que el óptico los revise.'
          : 'Más nítido sobre verde: de cerca te podría faltar ayuda (es frecuente después de los 40).')
        : 'Más nítido sobre rojo: podría sobrar graduación de cerca o haber miopía. Que lo revise el profesional.',
    })
  }

  const indice = Math.max(0, 100 - Math.round((score / 13) * 100))
  const pre = nombre ? nombre + ', ' : ''
  const cap = (t: string) => (nombre ? t : t.charAt(0).toUpperCase() + t.slice(1))
  let semaforo: Informe['semaforo']
  let titulo: string
  let lead: string
  if (amBad || score >= 4) {
    semaforo = 'rojo'
    titulo = cap(pre + 'pedí turno con un oftalmólogo esta semana')
    lead = 'Alguna prueba dio un resultado que conviene revisar pronto. El pretest es orientativo, pero no lo dejes pasar.'
  } else if (score >= 1) {
    semaforo = 'amarillo'
    titulo = cap(pre + 'te conviene una consulta')
    lead = usa === 'si'
      ? 'Es probable que tu graduación actual necesite un ajuste. Llevá tus anteojos a la consulta.'
      : 'Hay señales de que unos anteojos te ayudarían. Un oftalmólogo confirma la graduación exacta.'
  } else {
    semaforo = 'verde'
    titulo = cap(pre + 'tu visión se ve bien')
    lead = 'Sin señales de alarma. Un control cada dos años es la mejor forma de cuidarla.'
  }
  return { items, score, indice, semaforo, titulo, lead }
}

export function armarTicket(S: Resultados, inf: Informe, code: string, nombre: string, edad: number | null, usa: Usa) {
  const c = S.contrast
  return `ORBITAL VISION LAB · PRETEST  ${new Date().toLocaleDateString('es-AR')}
Código: ${code}   Índice: ${inf.indice}/100
${nombre ? 'Paciente: ' + nombre + '  ' : ''}${edad ? 'Edad: ' + edad : ''}
Usa corrección: ${usa === 'si' ? 'sí (test con ella)' : usa === 'viejos' ? 'tiene, no la usa' : 'no'}
Pantalla: ${(S.pxPerMm * 25.4).toFixed(0)} ppi calibrada con tarjeta

Agudeza lejos (${S.distMm >= 2000 ? (S.espejo ? '3 m espejo)' : '3 m, C8)   ') : '50 cm, C8) '} OD ${acuityLabel(S.acuity.R)}   OI ${acuityLabel(S.acuity.L)}
                           logMAR OD ${logmar(S.acuity.R)}   OI ${logmar(S.acuity.L)}
Agudeza cerca (40 cm, C8)  OD ${acuityLabel(S.acuityNear.R)}   OI ${acuityLabel(S.acuityNear.L)}
Contraste (binocular)      umbral ${c === null ? 'no detectado' : c + '%'}
Reloj astigmático          OD ${S.astig.R ? 'parejo' : 'DESPAREJO'}   OI ${S.astig.L ? 'parejo' : 'DESPAREJO'}
Color (rojo-verde)         ${S.colorHits}/3 láminas
Amsler                     OD ${S.amsler.R ? 'normal' : 'ALTERADA'}   OI ${S.amsler.L ? 'normal' : 'ALTERADA'}
Lectura (40 cm, binoc.)    ${S.near}
Duocromo (40 cm)           OD ${S.duo.R ?? '—'}   OI ${S.duo.L ?? '—'}${S.dp ? `
DP (tarjeta en la frente)  lejos ${S.dp.lejos} mm   cerca ${S.dp.cerca} mm` : ''}

C8 = anillo de Landolt, 8 posiciones, 2/2 aciertos por nivel, recuadro de apiñamiento.
Orientativo, no diagnóstico. Generado por el paciente.`
}

/** Consejos de cristales según los hábitos del cuestionario inicial (sugerencias comerciales, no indicación médica). */
export function sugerenciasHabitos(h: Habitos, edad: number | null): string[] {
  const s: string[] = []
  if (h.pantalla === 'mucho') s.push('Muchas horas de pantalla: cristales con filtro de luz azul y antirreflejo, y la regla 20-20-20 (cada 20 minutos, mirá 20 segundos algo a 6 metros).')
  else if (h.pantalla === 'medio') s.push('Uso diario de pantallas: el filtro de luz azul con antirreflejo descansa la vista al final del día.')
  if (h.pantalla !== 'poco' && h.pantalla !== null && edad && edad >= 40) s.push('Después de los 40, los cristales ocupacionales (para compu y escritorio) dan una zona de pantalla más ancha que los multifocales comunes.')
  if (h.noche) s.push('Manejás de noche: un antirreflejo de buena calidad reduce los destellos de los faros.')
  if (h.sol) s.push('Pasás tiempo al sol: fotocromáticos o anteojos de sol graduados con filtro UV400.')
  if (h.control === 'mas2' || h.control === 'nunca') s.push(h.control === 'nunca' ? 'Nunca te hiciste un control visual: es buen momento para el primero.' : 'Pasaron más de 2 años de tu último control: es buen momento para hacerlo.')
  return s
}

/** Código local de respaldo si el backend no responde (mismo formato que pretest_guardar). */
export const codigoLocal = () =>
  'ORB-' + Math.random().toString(36).slice(2, 6).toUpperCase() + '-' + new Date().toISOString().slice(5, 10).replace('-', '')
