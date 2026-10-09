// Orbital Vision Lab · Estudio de rostro (2026-10-02, pedido de Gastón): qué forma de armazón le va a tu cara.
// En vez de un cuestionario, la cámara frontal mide la cara con MediaPipe Face Landmarker (478 puntos, todo dentro
// del celular) y de ahí salen:
//  · Proporciones: largo / ancho de pómulos, ancho de frente, de mandíbula y de mentón, y el ángulo de la mandíbula.
//  · Forma del rostro: parecido a 7 prototipos (ovalado, redondo, cuadrado, alargado, corazón, diamante,
//    triangular) en unidades de desvío respecto del promedio → porcentaje por forma.
//  · Escala en mm con el iris (≈ 11,7 mm en todos los adultos): ancho de la cara → ancho de frente ideal del
//    armazón (≈ el mismo ancho de sien a sien, como en el probador) y talle S / M / L. Error ±5 %.
// Reglas de armazón por forma: principio de contraste que usan las guías de Zeiss, Essilor, Warby Parker y Vision
// Council (formas opuestas a la cara, ancho del armazón ≈ ancho de la cara, línea superior acompañando la ceja).
import type { Marco } from '../marcos'

export type P3 = { x: number; y: number; z?: number }

// ── Landmarks de MediaPipe Face Mesh ─────────────────────────────────────────────────────────
export const L = {
  frenteArriba: 10, menton: 152,
  pomuloD: 234, pomuloI: 454,
  frenteD: 54, frenteI: 284,
  mandD: 172, mandI: 397,
  mentonD: 176, mentonI: 400,
  sobreMandD: 132, sobreMandI: 361,
  bajoMandD: 149, bajoMandI: 378,
  nariz: 1, puente: 168,
  irisD: 468, irisI: 473,
  irisD_d: 469, irisD_i: 471, irisI_d: 474, irisI_i: 476,
}
/** Contorno de la cara en orden (para dibujarlo). */
export const OVALO = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109]

// ── Contorno real (2026-10-05, pedido de Gastón: "no toma el total de la cara") ─────────────────────────────
// La malla de MediaPipe sigue la piel y queda unos mm adentro de la silueta visible (en una foto frontal, ≈ 7 % del
// ancho entre pómulos y mandíbula), y su punto más alto (10) está a media frente, no en el nacimiento del pelo.
// Para dibujar y medir el total de la cara:
//  · anchos: cada punto del contorno se abre MALLA desde el eje vertical de la cara.
//  · arriba: nacimiento del pelo por la regla de los tercios (glabela→subnasal ≈ subnasal→mentón, Farkas) y la
//    parte alta del contorno se estira hasta ahí.
// Las proporciones de la forma (MEDIA / DESVIO) siguen con la malla cruda, que es con lo que se calibraron.
export const MALLA = 1.07
const GLABELA = 9, SUBNASAL = 2
export interface Contorno { puntos: P3[]; arriba: P3; abajo: P3; ejeX: number }
/** Apertura horizontal a la altura `y` (normalizada): interpola entre las alturas donde se midió la silueta. */
export function aperturaEnY(lm: P3[], y: number, sil?: Silueta | null): number {
  if (!sil) return MALLA
  const tramos = ([
    [lm[L.frenteD].y, sil.k.frente], [lm[SIENES.d].y, sil.k.sienes], [lm[L.pomuloD].y, sil.k.pomulos], [lm[L.mandD].y, sil.k.mandibula],
  ] as [number, number | null][]).map(([yy, k]) => [yy, k ?? MALLA] as [number, number]).sort((a, b) => a[0] - b[0])
  if (y <= tramos[0][0]) return tramos[0][1]
  for (let j = 1; j < tramos.length; j++) {
    const [y0, k0] = tramos[j - 1], [y1, k1] = tramos[j]
    if (y <= y1) return y1 - y0 < 1e-6 ? k1 : k0 + ((y - y0) / (y1 - y0)) * (k1 - k0)
  }
  return tramos[tramos.length - 1][1]
}

export function contorno(lm: P3[], sil?: Silueta | null): Contorno {
  const ejeX = (lm[10].x + lm[152].x + lm[GLABELA].x + lm[1].x) / 4
  const yG = lm[GLABELA].y, yTop = lm[10].y
  // tercio superior = tercio inferior (subnasal → mentón); nunca menos que lo que ya da la malla
  const yPelo = Math.min(yTop, yG - (lm[152].y - lm[SUBNASAL].y))
  const s = yG - yTop > 1e-4 ? (yG - yPelo) / (yG - yTop) : 1
  const puntos = OVALO.map((i) => {
    const p = lm[i]
    const x = ejeX + (p.x - ejeX) * aperturaEnY(lm, p.y, sil)
    const y = p.y < yG ? yG - (yG - p.y) * s : p.y
    return { x, y, z: p.z }
  })
  return { puntos, arriba: { x: ejeX + (lm[10].x - ejeX) * MALLA, y: yPelo }, abajo: { x: ejeX + (lm[152].x - ejeX) * MALLA, y: lm[152].y }, ejeX }
}

// ── Silueta medida en la foto (2026-10-08, pedido de Gastón: "no me adapta toda la cara y me mide mal") ──────────
// El 7 % fijo de MALLA es un promedio: con barba, pelo corto o cara ancha queda corto o largo. En el mejor cuadro del
// escaneo se busca el borde real de la cara sobre rayos horizontales que salen de la malla hacia afuera: se toma el
// color de la piel en las mejillas y la frente, y el borde es el primer punto donde el color deja de ser piel (pelo,
// fondo, sombra) por 3 px seguidos. Cada ancho usa su altura:
//  · sienes (127 / 356, a la altura de los ojos): el ancho que tiene que cubrir el frente del armazón; afuera hay pelo
//    o fondo, casi nunca la oreja.
//  · pómulos (234 / 454) y mandíbula (172 / 397): para el contorno y la forma.
// Si la piel no se distingue del fondo (pared beige, contraluz) el rayo no encuentra borde y ese lado sigue con MALLA.
export const SIENES = { d: 127, i: 356 } as const
export type LadoSilueta = 'sienes' | 'pomulos' | 'mandibula' | 'frente'
export interface Silueta {
  /** Apertura medida de cada ancho (borde real / malla, desde el eje). null = no se encontró borde, va MALLA. */
  k: Record<LadoSilueta, number | null>
  /** Bordes detectados (normalizados 0–1, sin espejar) para dibujarlos. */
  bordes: { lado: LadoSilueta; x: number; y: number }[]
  /** Qué pasó en cada rayo (para ?debug). */
  diag: string[]
}
const RAYOS: Record<LadoSilueta, [number, number]> = {
  sienes: [SIENES.d, SIENES.i], pomulos: [L.pomuloD, L.pomuloI], mandibula: [L.mandD, L.mandI], frente: [L.frenteD, L.frenteI],
}
/** Apertura máxima creíble por altura: más allá del pómulo empieza la oreja (que es piel), por eso es la más corta. */
const K_MAX: Record<LadoSilueta, number> = { sienes: 1.16, pomulos: 1.1, mandibula: 1.16, frente: 1.14 }

export function medirSilueta(img: ImageData, lm: P3[]): Silueta {
  const { width: W, height: H, data } = img
  const px = (x: number, y: number): [number, number, number] => {
    const i = (Math.min(H - 1, Math.max(0, Math.round(y))) * W + Math.min(W - 1, Math.max(0, Math.round(x)))) * 4
    return [data[i], data[i + 1], data[i + 2]]
  }
  // Color de piel: frente y parte alta de las mejillas (debajo de los ojos), donde no llega la barba, POR LADO: con
  // luz de costado una mitad de la cara tiene otro tono. Mediana por canal para que un mechón o un reflejo no muevan
  // la referencia. Índices de MediaPipe: los "D" (108, 116, 50) caen a la izquierda de la imagen (x menor).
  const r0 = Math.max(2, Math.round(W / 160))
  const piel = (ref: number[]) => {
    const ms: [number, number, number][] = []
    for (const i of ref) for (let dy = -r0; dy <= r0; dy += r0) for (let dx = -r0; dx <= r0; dx += r0) ms.push(px(lm[i].x * W + dx, lm[i].y * H + dy))
    return { ms, c: [0, 1, 2].map((c) => mediana(ms.map((m) => m[c]))) }
  }
  const lados = { [-1]: piel([151, 108, 116, 50]), [1]: piel([151, 337, 345, 280]) } as Record<number, { ms: [number, number, number][]; c: number[] }>
  const dist = (a: number[], b: number[]) => {
    // La crominancia (r, g relativos) manda: el costado de la cara en sombra sigue siendo piel. La luz pesa poco,
    // salvo un salto muy grande (pelo oscuro, fondo blanco), que es borde aunque el tono se parezca.
    const sa = a[0] + a[1] + a[2] + 1, sb = b[0] + b[1] + b[2] + 1
    const dc = Math.hypot((a[0] / sa - b[0] / sb) * 600, (a[1] / sa - b[1] / sb) * 600)
    const dl = Math.abs(sa - sb) / 3
    return dl > 75 ? 999 : Math.hypot(dc, dl * 0.3)
  }
  const umbralDe = (l: { ms: number[][]; c: number[] }) => Math.min(60, Math.max(30, mediana(l.ms.map((m) => dist(m, l.c))) * 4.5))
  const ejeX = ((lm[10].x + lm[152].x + lm[9].x + lm[1].x) / 4) * W
  const banda = (x: number, y: number) => {
    // promedio vertical de 5 px para no frenar en un pelo suelto o un poro
    const s = [0, 0, 0]
    for (let dy = -2; dy <= 2; dy++) { const c = px(x, y + dy * Math.max(1, r0 / 2)); s[0] += c[0]; s[1] += c[1]; s[2] += c[2] }
    return s.map((v) => v / 5)
  }
  const k = {} as Record<LadoSilueta, number | null>
  const bordes: Silueta['bordes'] = []
  const diag: string[] = [`umbral − ${umbralDe(lados[-1]).toFixed(0)} · + ${umbralDe(lados[1]).toFixed(0)}`]
  for (const lado of Object.keys(RAYOS) as LadoSilueta[]) {
    const ks: number[] = []
    for (const i of RAYOS[lado]) {
      const x0 = lm[i].x * W, y = lm[i].y * H
      const mitad = Math.abs(x0 - ejeX)
      if (mitad < 10) continue
      const sg = Math.sign(x0 - ejeX)
      const media = lados[sg].c, umbral = umbralDe(lados[sg])
      // arranca adentro de la malla: el último punto de piel entre 80 y 94 % es el inicio; si no hay piel, el rayo no sirve
      let t0: number | null = null
      for (let t = 0.8; t <= 0.94; t += 1 / mitad) if (dist(banda(ejeX + sg * mitad * t, y), media) <= umbral) t0 = t
      if (t0 === null) { diag.push(`${lado}${sg > 0 ? '+' : '-'} sin piel adentro de la malla`); continue }
      let fuera = 0, borde: number | null = null
      for (let t = t0; t <= K_MAX[lado] + 0.02; t += 1 / mitad) {
        const x = ejeX + sg * mitad * t
        if (x < 1 || x > W - 2) break
        if (dist(banda(x, y), media) > umbral) { if (++fuera >= 3) { borde = t - 2 / mitad; break } } else fuera = 0
      }
      if (borde === null || borde > K_MAX[lado]) { diag.push(`${lado}${sg > 0 ? "+" : "-"} sin borde hasta ${K_MAX[lado]}`); continue }
      diag.push(`${lado}${sg > 0 ? "+" : "-"} borde ${borde.toFixed(3)}`)
      const kk = Math.max(0.98, borde)
      ks.push(kk)
      bordes.push({ lado, x: (ejeX + sg * mitad * kk) / W, y: y / H })
    }
    // los dos lados tienen que coincidir más o menos (una sombra de un solo lado no puede ensanchar la cara)
    k[lado] = !ks.length ? null : ks.length === 1 ? Math.min(ks[0], MALLA + 0.03) : Math.abs(ks[0] - ks[1]) > 0.08 ? Math.min(...ks) : (ks[0] + ks[1]) / 2
  }
  return { k, bordes, diag }
}

// ── Escala ──────────────────────────────────────────────────────────────────────────────────
// De qué sale el paso de px a mm, de más a menos precisa:
//  · tarjeta: DP medida con la tarjeta en la frente (85,6 mm de referencia). La distancia entre los centros de los
//    iris mide ~5 veces más px que el diámetro de un iris, así que el error de un px pesa 5 veces menos (±2 %).
//  · iris: el diámetro del iris (≈ 11,7 mm en todos los adultos); a 40 cm son ~30 px y un px es un 3–4 % (±6 %).
// La DP "de cerca" de la tarjeta es la misma situación del escaneo (mirando la cámara a ~40 cm, ojos convergiendo).
export type FuenteEscala = 'tarjeta' | 'iris'
export const ERROR_ESCALA: Record<FuenteEscala, number> = { tarjeta: 0.02, iris: 0.06 }

// El iris mide ≈ 11,7 mm, pero el anillo de MediaPipe sale un poco más grande que el iris real: con 34 retratos
// frontales (Wikimedia Commons, 2026-10-02) la DP mediana daba 59,3 mm contra ~62,5 mm de promedio adulto.
// Se corrige la escala +5 % (equivale a un iris "efectivo" de 12,3 mm).
export const IRIS_MM = 11.7 * 1.05
/** Para quien mide en vivo (calce): factor de perspectiva del ancho de pómulos. */
export const perspectivaPomulos = (lm: P3[], W = 1, H = 1) => profundidad(lm, L.pomuloD, L.pomuloI, W, H)

const d2 = (a: P3, b: P3) => Math.hypot(a.x - b.x, a.y - b.y)
const angulo = (a: P3, v: P3, b: P3) => {
  const ax = a.x - v.x, ay = a.y - v.y, bx = b.x - v.x, by = b.y - v.y
  return (Math.acos((ax * bx + ay * by) / (Math.hypot(ax, ay) * Math.hypot(bx, by))) * 180) / Math.PI
}

/** Medidas de un cuadro, en px de la imagen. */
export interface Medidas {
  largo: number; pomulos: number; frente: number; mandibula: number; menton: number
  /** Largo total del rostro: nacimiento del pelo (estimado) → mentón. Solo para los mm; la forma usa `largo`. */
  largoTotal: number
  anguloMand: number; iris: number; dp: number
  /** Corrección de perspectiva de cada ancho (≥ 1): ver profundidad(). */
  kPom: number; kFrente: number; kMand: number
}

// ── Perspectiva (2026-10-05) ────────────────────────────────────────────────────────────────
// La escala en mm sale del iris, que está adelante de la cara; los pómulos, la frente y la mandíbula están varios cm
// más atrás y por perspectiva se ven más chicos (a 40 cm del celular, ≈ 10–15 % menos: un adulto de 140 mm daba
// 127 mm y talle S). MediaPipe da la profundidad z de cada punto en la misma escala que x (fracción del ancho de la
// imagen); con la distancia focal de una cámara frontal (≈ 0,75 × ancho, ~67° horizontales) la corrección del par
// a–b es 1 + Δz / f. Sin z (o valores raros) se usa el promedio medido, 1,12.
// 2026-10-08: la focal se toma del lado LARGO del cuadro (f ≈ 0,7 × lado largo, la misma que usa la DP con tarjeta).
// Antes era 0,75 × ancho, que vale para una cámara apaisada; con el celular vertical (ancho = lado corto) la focal real
// en unidades de ancho es ~1,0 y la corrección salía inflada (llegaba al tope de ×1,25 y los anchos daban de más).
const FOCAL_LARGO = 0.7
const K_DEFECTO = 1.12
function profundidad(lm: P3[], a: number, b: number, W = 1, H = 1): number {
  const z = (i: number) => lm[i]?.z
  const ojos = [33, 263, 133, 362].map(z)
  if ([z(a), z(b), ...ojos].some((v) => typeof v !== 'number' || !Number.isFinite(v))) return K_DEFECTO
  const zOjo = (ojos as number[]).reduce((x, y) => x + y, 0) / 4
  const dz = ((z(a) as number) + (z(b) as number)) / 2 - zOjo
  // z viene en fracción del ancho de la imagen: pasado a px es dz·W, y la focal en px es 0,7 × lado largo
  const k = 1 + (dz * W) / (FOCAL_LARGO * Math.max(W, H))
  // Un cuadro raro (cara muy cerca o z ruidosa) no puede agrandar más de 25 % ni achicar
  return Math.min(1.25, Math.max(1, k))
}

export function medir(lm: P3[], W: number, H: number): Medidas {
  const p = (i: number) => ({ x: lm[i].x * W, y: lm[i].y * H })
  const c = contorno(lm)
  return {
    largo: d2(p(L.frenteArriba), p(L.menton)),
    largoTotal: d2({ x: c.arriba.x * W, y: c.arriba.y * H }, { x: c.abajo.x * W, y: c.abajo.y * H }),
    pomulos: d2(p(L.pomuloD), p(L.pomuloI)),
    frente: d2(p(L.frenteD), p(L.frenteI)),
    mandibula: d2(p(L.mandD), p(L.mandI)),
    menton: d2(p(L.mentonD), p(L.mentonI)),
    anguloMand: (angulo(p(L.sobreMandD), p(L.mandD), p(L.bajoMandD)) + angulo(p(L.sobreMandI), p(L.mandI), p(L.bajoMandI))) / 2,
    iris: (d2(p(L.irisD_d), p(L.irisD_i)) + d2(p(L.irisI_d), p(L.irisI_i))) / 2,
    dp: d2(p(L.irisD), p(L.irisI)),
    kPom: profundidad(lm, L.pomuloD, L.pomuloI, W, H),
    kFrente: profundidad(lm, L.frenteD, L.frenteI, W, H),
    kMand: profundidad(lm, L.mandD, L.mandI, W, H),
  }
}

export const mediana = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : NaN }
export function medianaMedidas(ms: Medidas[]): Medidas {
  const k = Object.keys(ms[0]) as (keyof Medidas)[]
  return Object.fromEntries(k.map((x) => [x, mediana(ms.map((m) => m[x]))])) as unknown as Medidas
}

// ── Postura: giro de la cabeza a partir de la matriz de MediaPipe (o de los puntos si no hay matriz) ────────
export interface Postura { yaw: number; pitch: number; roll: number }
export function postura(lm: P3[], W: number, H: number, matriz?: number[]): Postura {
  const p = (i: number) => ({ x: lm[i].x * W, y: lm[i].y * H })
  const ojoD = p(33), ojoI = p(263)
  const roll = (Math.atan2(ojoI.y - ojoD.y, ojoI.x - ojoD.x) * 180) / Math.PI
  if (matriz && matriz.length === 16) {
    // column-major: R[f][c] = m[c*4+f]
    const R = (f: number, c: number) => matriz[c * 4 + f]
    const yaw = (Math.atan2(R(0, 2), R(2, 2)) * 180) / Math.PI
    const pitch = (Math.asin(Math.max(-1, Math.min(1, -R(1, 2)))) * 180) / Math.PI
    return { yaw, pitch, roll }
  }
  const pd = p(L.pomuloD), pi = p(L.pomuloI), n = p(L.nariz)
  const yaw = (((n.x - (pd.x + pi.x) / 2) / d2(pd, pi)) * 180) / Math.PI * 2.4
  return { yaw, pitch: 0, roll }
}

// ── Forma del rostro ────────────────────────────────────────────────────────────────────────
export type Forma = 'ovalado' | 'redondo' | 'cuadrado' | 'alargado' | 'corazon' | 'diamante' | 'triangular'

/** Proporciones adimensionales (no dependen de la distancia a la cámara). */
export interface Proporciones { largo: number; frente: number; mandibula: number; menton: number; angulo: number }
export const proporciones = (m: Medidas): Proporciones => ({
  largo: m.largo / m.pomulos, frente: m.frente / m.pomulos, mandibula: m.mandibula / m.pomulos,
  menton: m.menton / m.mandibula, angulo: m.anguloMand,
})

// Promedio y desvío de cada proporción en la malla de MediaPipe: 34 retratos frontales de Wikimedia Commons
// (|giro| < 8°, 2026-10-02). Si con caras reales la mayoría cae en una misma forma, se corrigen acá
// (en /lab/rostro?debug se ven las proporciones y los desvíos de cada escaneo).
export const MEDIA: Proporciones = { largo: 1.18, frente: 0.86, mandibula: 0.803, menton: 0.416, angulo: 154.7 }
export const DESVIO: Proporciones = { largo: 0.09, frente: 0.025, mandibula: 0.028, menton: 0.017, angulo: 4.7 }

// Prototipo de cada forma en desvíos (z) respecto del promedio. 0 = como el promedio.
const PROTO: Record<Forma, Partial<Proporciones>> = {
  ovalado: { largo: 0.6, frente: 0, mandibula: -0.4, menton: -0.3, angulo: 0.5 },
  redondo: { largo: -1.3, frente: 0, mandibula: 0.4, menton: 0.4, angulo: 1.2 },
  cuadrado: { largo: -0.9, frente: 0.4, mandibula: 1.3, menton: 0.6, angulo: -1.4 },
  alargado: { largo: 1.8, frente: 0, mandibula: 0, menton: 0, angulo: 0 },
  corazon: { largo: 0.2, frente: 1.2, mandibula: -1.1, menton: -1.0, angulo: 0.6 },
  diamante: { largo: 0.5, frente: -1.3, mandibula: -1.0, menton: -0.6, angulo: 0.4 },
  triangular: { largo: -0.2, frente: -1.2, mandibula: 1.2, menton: 0.4, angulo: -0.4 },
}
// Cuánto pesa cada proporción (el largo y la mandíbula son las más confiables con la malla).
const PESO: Proporciones = { largo: 1.2, frente: 0.9, mandibula: 1.1, menton: 0.6, angulo: 0.6 }

export const z = (p: Proporciones) => (Object.keys(MEDIA) as (keyof Proporciones)[]).reduce(
  (o, k) => ({ ...o, [k]: (p[k] - MEDIA[k]) / DESVIO[k] }), {} as Proporciones)

export function clasificar(p: Proporciones): { forma: Forma; pct: Record<Forma, number> } {
  const zz = z(p)
  const sim = {} as Record<Forma, number>
  for (const f of Object.keys(PROTO) as Forma[]) {
    let s = 0
    for (const k of Object.keys(PESO) as (keyof Proporciones)[]) {
      const dz = Math.max(-3, Math.min(3, zz[k])) - (PROTO[f][k] ?? 0)
      s += PESO[k] * dz * dz
    }
    // el ovalado es la forma "equilibrada": gana los empates
    sim[f] = Math.exp(-s / 3.2) * (f === 'ovalado' ? 1.15 : 1)
  }
  const tot = Object.values(sim).reduce((a, b) => a + b, 0) || 1
  const pct = Object.fromEntries(Object.entries(sim).map(([k, v]) => [k, Math.round((v / tot) * 100)])) as Record<Forma, number>
  const forma = (Object.keys(pct) as Forma[]).reduce((a, b) => (pct[b] > pct[a] ? b : a))
  return { forma, pct }
}

// ── Estilos de armazón ───────────────────────────────────────────────────────────────────────
export type Estilo = 'rectangular' | 'cuadrado' | 'redondo' | 'ovalado' | 'ojo de gato' | 'aviador' | 'browline'
export const ESTILOS: { id: Estilo; nombre: string; d: string }[] = [
  { id: 'rectangular', nombre: 'Rectangular', d: 'Más ancho que alto, líneas rectas.' },
  { id: 'cuadrado', nombre: 'Cuadrado', d: 'Alto y con esquinas marcadas.' },
  { id: 'redondo', nombre: 'Redondo', d: 'Lente circular, estilo clásico.' },
  { id: 'ovalado', nombre: 'Ovalado', d: 'Curvo y suave, más ancho que alto.' },
  { id: 'ojo de gato', nombre: 'Ojo de gato', d: 'Esquinas externas elevadas.' },
  { id: 'aviador', nombre: 'Aviador', d: 'Gota, más ancho abajo hacia la nariz.' },
  { id: 'browline', nombre: 'Browline', d: 'Marcado arriba, fino abajo.' },
]
export const nombreEstilo = (e: Estilo) => ESTILOS.find((x) => x.id === e)!.nombre

/** Formato del catálogo (producto_medidas.formato) → estilos que cubre. */
export function estilosDelFormato(formato: string | null): Estilo[] {
  const f = (formato ?? '').toLowerCase()
  if (f.includes('gato')) return ['ojo de gato']
  if (f.includes('redond')) return ['redondo', 'ovalado']
  if (f.includes('cuadr')) return ['cuadrado']
  if (f.includes('rect')) return ['rectangular']
  if (f.includes('aviador')) return ['aviador']
  return []
}

export interface InfoForma {
  nombre: string
  rasgos: string
  idea: string
  si: { e: Estilo; por: string }[]
  no: { e: Estilo; por: string }[]
  tips: string[]
}

export const FORMAS: Record<Forma, InfoForma> = {
  ovalado: {
    nombre: 'Ovalado',
    rasgos: 'Un poco más largo que ancho, pómulos apenas más anchos que la frente y mandíbula suave.',
    idea: 'Es la forma más equilibrada: te quedan casi todos los armazones. Lo que más importa es el tamaño.',
    si: [
      { e: 'rectangular', por: 'Suma estructura sin cortar la armonía.' },
      { e: 'cuadrado', por: 'Las líneas rectas contrastan con tus curvas suaves.' },
      { e: 'aviador', por: 'Sigue la línea de los pómulos.' },
      { e: 'ojo de gato', por: 'Levanta la mirada y estiliza.' },
    ],
    no: [{ e: 'redondo', por: 'Muy grande o muy chico rompe la proporción: buscá el ancho de tu cara.' }],
    tips: ['El ancho del armazón tiene que acompañar el de tu cara: ni más angosto, ni sobresaliendo de las sienes.', 'La línea superior idealmente sigue la de tus cejas.'],
  },
  redondo: {
    nombre: 'Redondo',
    rasgos: 'Largo y ancho parecidos, pómulos llenos y mandíbula redondeada sin ángulos marcados.',
    idea: 'Buscá armazones angulosos y más anchos que altos: estiran visualmente la cara y le dan definición.',
    si: [
      { e: 'rectangular', por: 'Alarga la cara y suma líneas que la definen.' },
      { e: 'cuadrado', por: 'Los ángulos contrastan con las curvas.' },
      { e: 'ojo de gato', por: 'Las puntas elevadas llevan la mirada hacia arriba.' },
      { e: 'browline', por: 'El peso arriba estiliza el centro de la cara.' },
    ],
    no: [
      { e: 'redondo', por: 'Repite la forma y la redondea más.' },
      { e: 'ovalado', por: 'Las curvas suman volumen a los pómulos.' },
    ],
    tips: ['Puente alto o transparente: alarga la nariz y la cara.', 'Evitá armazones chicos: achican los ojos y agrandan la cara.'],
  },
  cuadrado: {
    nombre: 'Cuadrado',
    rasgos: 'Mandíbula ancha y angulosa, frente ancha y largo parecido al ancho.',
    idea: 'Las formas curvas suavizan los ángulos de la mandíbula y equilibran la frente ancha.',
    si: [
      { e: 'redondo', por: 'El contraste curvo suaviza la mandíbula.' },
      { e: 'ovalado', por: 'Equilibra los rasgos marcados.' },
      { e: 'aviador', por: 'La parte de abajo curva desvía la atención de la mandíbula.' },
      { e: 'ojo de gato', por: 'Sube la mirada y alarga.' },
    ],
    no: [
      { e: 'cuadrado', por: 'Repite los ángulos y endurece la expresión.' },
      { e: 'rectangular', por: 'Con esquinas muy marcadas suma dureza (si lo elegís, con bordes redondeados).' },
    ],
    tips: ['Elegí un armazón un poco más ancho que la mandíbula.', 'Acetatos finos o metal liviano suavizan más que un acetato grueso.'],
  },
  alargado: {
    nombre: 'Alargado',
    rasgos: 'Bastante más largo que ancho, con frente, pómulos y mandíbula de anchos parecidos.',
    idea: 'Buscá armazones con altura y anchos: acortan visualmente la cara y la equilibran.',
    si: [
      { e: 'cuadrado', por: 'La altura del lente acorta el largo de la cara.' },
      { e: 'redondo', por: 'Grande y alto, suma ancho.' },
      { e: 'aviador', por: 'Cubre más superficie vertical.' },
      { e: 'browline', por: 'La barra superior corta la línea vertical.' },
    ],
    no: [
      { e: 'rectangular', por: 'Angosto y bajo marca todavía más el largo.' },
      { e: 'ojo de gato', por: 'Las puntas elevadas estiran más.' },
    ],
    tips: ['Patillas con detalle o color suman ancho a los costados.', 'Puente bajo y oscuro: acorta la nariz.'],
  },
  corazon: {
    nombre: 'Corazón',
    rasgos: 'Frente ancha, pómulos marcados y mandíbula angosta que termina en un mentón fino.',
    idea: 'Buscá armazones más anchos abajo o livianos: equilibran la frente ancha con el mentón fino.',
    si: [
      { e: 'aviador', por: 'Más ancho abajo: equilibra el mentón fino.' },
      { e: 'redondo', por: 'Suaviza la frente ancha.' },
      { e: 'ovalado', por: 'Liviano, no suma peso arriba.' },
      { e: 'rectangular', por: 'Fino y con bordes suaves, equilibra la parte de abajo.' },
    ],
    no: [
      { e: 'browline', por: 'El peso arriba agranda la frente.' },
      { e: 'ojo de gato', por: 'Las puntas marcadas ensanchan la parte de arriba.' },
    ],
    tips: ['Al aire o semi al aire, y colores claros o transparentes.', 'Evitá adornos en la parte superior del armazón.'],
  },
  diamante: {
    nombre: 'Diamante',
    rasgos: 'Pómulos anchos y marcados, frente y mandíbula angostas, mentón definido.',
    idea: 'Buscá armazones con la parte de arriba marcada: suman ancho a la frente y suavizan los pómulos.',
    si: [
      { e: 'ojo de gato', por: 'Ensancha la frente y resalta los ojos.' },
      { e: 'browline', por: 'La línea superior marcada equilibra los pómulos.' },
      { e: 'ovalado', por: 'Las curvas suavizan los ángulos de los pómulos.' },
      { e: 'redondo', por: 'Suaviza el rostro.' },
    ],
    no: [{ e: 'rectangular', por: 'Angosto, deja los pómulos como la parte más ancha.' }],
    tips: ['Que el armazón no sea más angosto que los pómulos.', 'Al aire abajo o sin aro inferior funciona muy bien.'],
  },
  triangular: {
    nombre: 'Triangular',
    rasgos: 'Mandíbula más ancha que la frente, pómulos intermedios.',
    idea: 'Buscá armazones marcados arriba: suman ancho a la frente y equilibran la mandíbula.',
    si: [
      { e: 'browline', por: 'El peso arriba ensancha la frente.' },
      { e: 'ojo de gato', por: 'Lleva la atención a los ojos y la frente.' },
      { e: 'aviador', por: 'La barra superior suma ancho arriba.' },
      { e: 'ovalado', por: 'Suaviza la mandíbula.' },
    ],
    no: [
      { e: 'rectangular', por: 'Angosto y bajo marca más la mandíbula.' },
      { e: 'cuadrado', por: 'Si es pesado abajo, ensancha la mandíbula.' },
    ],
    tips: ['Colores intensos o detalles en la parte de arriba.', 'Evitá armazones más angostos que la mandíbula.'],
  },
}

// ── Medidas en mm y talle ─────────────────────────────────────────────────────────────────────
export interface Resultado {
  forma: Forma
  pct: Record<Forma, number>
  prop: Proporciones
  mm: { pomulos: number; largo: number; frente: number; mandibula: number; dp: number }
  /** Ancho de frente del armazón ideal (mm) y rango aceptable. */
  ideal: number; rango: [number, number]
  talle: 'S' | 'M' | 'L'
}

/** Cómo salió cada número: lo muestra "Cómo te medimos" y va en el debug. */
export interface Metodo {
  escala: FuenteEscala
  /** Error relativo esperado de los mm (escala + silueta). */
  error: number
  /** Apertura usada en cada ancho y si salió de la foto (true) o del promedio MALLA (false). */
  apertura: Record<'pomulos' | 'frente' | 'mandibula', { k: number; foto: boolean }>
  /** Corrección de perspectiva promedio de los anchos. */
  perspectiva: number
}

export interface OpcionesResultado {
  /** Silueta medida en la foto del escaneo. */
  silueta?: Silueta | null
  /** DP de cerca medida con la tarjeta (mm): pasa a ser la escala. */
  dpCerca?: number | null
}

export function resultado(m: Medidas, op: OpcionesResultado = {}): Resultado & { metodo: Metodo } {
  const escala: FuenteEscala = op.dpCerca && m.dp > 0 ? 'tarjeta' : 'iris'
  const k = escala === 'tarjeta' ? (op.dpCerca as number) / m.dp : IRIS_MM / m.iris
  const prop = proporciones(m)
  const { forma, pct } = clasificar(prop)
  // Medidas en el plano del armazón (corregidas por perspectiva y abiertas de la malla a la silueta real: la medida en
  // la foto si se encontró el borde, si no el promedio MALLA); las proporciones de la forma siguen con los px crudos.
  const kP = m.kPom ?? K_DEFECTO, kF = m.kFrente ?? K_DEFECTO, kM = m.kMand ?? K_DEFECTO
  const sk = op.silueta?.k
  const ap = (v: number | null | undefined) => ({ k: v ?? MALLA, foto: v != null })
  // el ancho de la cara para el armazón: pómulos; si ahí no hubo borde (oreja, fondo), el de las sienes
  const apertura = { pomulos: ap(sk?.pomulos ?? sk?.sienes), frente: ap(sk?.frente), mandibula: ap(sk?.mandibula) }
  const pom = m.pomulos * k * kP * apertura.pomulos.k
  // El ancho de sien a sien es ≈ el ancho del frente del armazón que queda bien (igual que en el probador).
  const ideal = Math.round(pom)
  const dpMm = escala === 'tarjeta' ? (op.dpCerca as number) : m.dp * k * 1.03
  const errSil = apertura.pomulos.foto ? 0.015 : 0.04
  return {
    forma, pct, prop,
    mm: { pomulos: Math.round(pom), largo: Math.round((m.largoTotal ?? m.largo) * k), frente: Math.round(m.frente * k * kF * apertura.frente.k), mandibula: Math.round(m.mandibula * k * kM * apertura.mandibula.k), dp: Math.round(dpMm) },
    ideal, rango: [ideal - 4, ideal + 4],
    talle: talleRostro(ideal),
    metodo: { escala, error: Math.hypot(ERROR_ESCALA[escala], errSil), apertura, perspectiva: (kP + kF + kM) / 3 },
  }
}

// ── Armazones del catálogo que cumplen la forma y la medida ──────────────────────────────────
/** Cuánto le va un armazón a este rostro (forma + ancho). null = envolvente/deportivo o sin formato. También lo usa el
 *  recomendador del chequeo visual cuando la persona hizo el estudio de rostro (perfil visual). */
export type Talle = 'S' | 'M' | 'L'
export type TalleArmazon = Talle | 'XL'
export const talleRostro = (ideal: number): Talle => (ideal < 136 ? 'S' : ideal <= 144 ? 'M' : 'L')
// Colecciones de talle de la tienda (las mismas de la guía /pages/tu-calce).
export const COLECCION_TALLE: Record<TalleArmazon, { nombre: string; url: string }> = {
  S: { nombre: 'Talle chico (S)', url: 'https://www.orbitaleyewear.com.ar/collections/anteojos-de-sol-talle-chico' },
  M: { nombre: 'Talle M', url: 'https://www.orbitaleyewear.com.ar/collections/anteojos-de-sol-talle-m' },
  L: { nombre: 'Talle grande (L)', url: 'https://www.orbitaleyewear.com.ar/collections/anteojos-de-sol-talle-grande' },
  XL: { nombre: 'Oversize (XL)', url: 'https://www.orbitaleyewear.com.ar/collections/anteojos-de-sol-oversize' },
}
// Qué talles de armazón le van a cada talle de rostro (en orden).
export const TALLES_PARA: Record<Talle, TalleArmazon[]> = { S: ['S', 'M'], M: ['M', 'L'], L: ['L', 'XL'] }

export function afinidadRostro(m: Marco, ideal: number, forma: Forma): { score: number; motivos: string[] } | null {
  const info = FORMAS[forma]
  const es = estilosDelFormato(m.formato)
  if (!es.length) return null
  let score = 0
  const motivos: string[] = []
  const ok = es.find((e) => info.si.some((x) => x.e === e))
  if (ok) { score += 3; motivos.push(`${nombreEstilo(ok)} · ideal para rostro ${info.nombre.toLowerCase()}`) }
  else if (es.some((e) => info.no.some((x) => x.e === e))) score -= 4
  // Talle del armazón (el de la tienda: S · M · L · XL oversize) contra el talle del rostro.
  //   rostro S → S y M · rostro M → M, y L "con presencia" · rostro L → L y XL. El XL solo para rostros L.
  const tr = talleRostro(ideal)
  const ta = m.talle ?? (/oversize/i.test(m.formato ?? '') ? 'XL' : null)
  if (ta) {
    const tabla: Record<Talle, Partial<Record<TalleArmazon, [number, string?]>>> = {
      S: { S: [1, 'Talle S · tu talle'], M: [0], L: [-10], XL: [-10] },
      M: { S: [0], M: [1, 'Talle M · tu talle'], L: [0.5, 'Talle L · con presencia'], XL: [-10] },
      L: { S: [-10], M: [0], L: [1, 'Talle L · tu talle'], XL: [1, 'Oversize (XL) · para rostros grandes'] },
    }
    const [pts, txt] = tabla[tr][ta] ?? [0]
    score += pts
    if (txt) motivos.push(txt)
  }
  if (m.ancho_mm !== null) {
    const d = Math.abs(m.ancho_mm - ideal)
    if (d <= 4) { score += 2; motivos.push(`${m.ancho_mm} mm · a tu medida`) }
    else if (d <= 8) { score += 0.5; motivos.push(`${m.ancho_mm} mm · ${m.ancho_mm > ideal ? 'un poco grande' : 'un poco chico'}`) }
    else score -= 2
  } else motivos.push('Medidas a confirmar en la óptica')
  return { score, motivos }
}

export function marcosParaVos<T extends Marco>(marcos: T[], r: Pick<Resultado, 'ideal'>, forma: Forma, max = 6) {
  return marcos
    .map((m) => { const a = afinidadRostro(m, r.ideal, forma); return a ? { ...m, ...a } : null })
    .filter((m): m is T & { score: number; motivos: string[] } => !!m && m.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
}

// Selección de un influencer / colección (link ?r=): todos sus modelos, primero los que cumplen forma y medida.
export function ordenarSeleccion<T extends Marco>(marcos: T[], r: Pick<Resultado, 'ideal'>, forma: Forma) {
  const van = marcosParaVos(marcos, r, forma, Infinity)
  const ids = new Set(van.map((m) => m.modelo))
  return { van, resto: marcos.filter((m) => !ids.has(m.modelo)) }
}
