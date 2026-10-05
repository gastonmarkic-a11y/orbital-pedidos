// Orbital Vision Lab · Grosor de los cristales (2026-10-05): cuánto se va a ver el borde (miopía) o el centro
// (hipermetropía) según la receta, el material (índice) y —lo que conecta con el rostro y el calce— el tamaño del
// armazón y dónde cae la pupila en el lente. Cuanto más lejos queda el borde del centro óptico, más grueso.
// Modelo de óptica geométrica (sagita de una superficie con la potencia total, R = (n − 1) / P):
//  · Negativo: centro = espesor mínimo del material; borde = centro + sagita a la distancia del punto más lejano.
//  · Positivo: borde mínimo 1 mm; centro = 1 mm + sagita a esa misma distancia.
// La distancia más lejana sale del lente (ancho A y alto B del armazón) con el centro óptico en la pupila (DP).
// Es una estimación (±0,5 mm): la curva base, el bisel y el calibre real los define el laboratorio.
import { BISAGRA_MM, PUENTE_MM } from './rostro/armazon'
import type { Receta } from './marcos'

export interface Indice { n: number; nombre: string; corto: string; centro: number; nota: string }
export const INDICES: Indice[] = [
  { n: 1.5, nombre: 'Orgánico 1.50', corto: '1.50', centro: 2.0, nota: 'Estándar' },
  { n: 1.56, nombre: 'Medio índice 1.56', corto: '1.56', centro: 1.8, nota: 'Un poco más fino' },
  { n: 1.6, nombre: 'Alto índice 1.60', corto: '1.60', centro: 1.5, nota: 'Fino y resistente' },
  { n: 1.67, nombre: 'Alto índice 1.67', corto: '1.67', centro: 1.4, nota: 'Muy fino' },
  { n: 1.74, nombre: 'Ultra fino 1.74', corto: '1.74', centro: 1.3, nota: 'El más fino' },
]
const BORDE_MIN = 1.0

const num = (s: string) => { const v = parseFloat((s ?? '').replace(',', '.')); return Number.isFinite(v) ? v : null }

/** Potencias de los dos meridianos más extremos de la receta (el ojo con más aumento). */
export function potencias(rec: Receta): { neg: number; pos: number } | null {
  const esf = [num(rec.esfOD), num(rec.esfOI)].filter((v): v is number => v !== null)
  const cil = num(rec.cil) ?? 0
  if (!esf.length && !cil) return null
  const e = esf.length ? esf : [0]
  // El cilindro suma su potencia solo en su eje: en el borde se toma la mitad (promedio entre meridianos).
  return { neg: Math.min(...e) + Math.min(0, cil) / 2, pos: Math.max(...e) + Math.max(0, cil) / 2 }
}

/** Sagita (mm) de una superficie de potencia |P| en un material n, a `y` mm del centro. */
export function sagita(P: number, n: number, y: number) {
  if (!P) return 0
  const R = ((n - 1) * 1000) / Math.abs(P)
  return y >= R ? R : R - Math.sqrt(R * R - y * y)
}

export interface Lente {
  /** Ancho (A) y alto (B) del lente, en mm. */
  a: number; b: number
  /** Distancia del centro óptico (la pupila) al borde de la sien, al de la nariz, y al punto más lejano. */
  sien: number; nariz: number; lejos: number
}
/** El lente de un armazón de frente `marco` mm con la pupila a `dp/2` del centro del puente. */
export function lenteDe(marco: number, dp: number, alto?: number | null): Lente {
  const a = (marco - PUENTE_MM - 2 * BISAGRA_MM) / 2
  const b = alto && alto > 15 ? alto : a * 0.72
  const nariz = Math.max(4, dp / 2 - PUENTE_MM / 2)
  const sien = Math.max(4, a - nariz)
  // esquina del lado de la sien, con las esquinas redondeadas (≈ 0,93 de la diagonal)
  const lejos = Math.hypot(sien, b / 2) * 0.93
  return { a, b, sien, nariz, lejos: Math.max(lejos, sien) }
}

export interface Grosor { indice: Indice; borde: number; centro: number; max: number }
export function grosores(p: { neg: number; pos: number }, l: Lente): Grosor[] {
  return INDICES.map((ix) => {
    // negativo: borde grueso en el punto más lejano; positivo: centro grueso para no dejar el borde en cero
    const bordeNeg = p.neg < 0 ? ix.centro + sagita(p.neg, ix.n, l.lejos) : null
    const centroPos = p.pos > 0 ? BORDE_MIN + sagita(p.pos, ix.n, l.lejos) : null
    const borde = bordeNeg ?? BORDE_MIN + (p.pos > 0 ? 0 : ix.centro - BORDE_MIN)
    const centro = centroPos ?? ix.centro
    return { indice: ix, borde, centro, max: Math.max(borde, centro) }
  })
}

/** Índice sugerido por potencia (criterio habitual de óptica): < 2 D 1.50 · < 4 D 1.60 · < 6 D 1.67 · más, 1.74. */
export function sugerido(gs: Grosor[], p: { neg: number; pos: number }) {
  const fuerte = Math.max(Math.abs(p.neg), Math.abs(p.pos))
  const n = fuerte < 2 ? 1.5 : fuerte < 4 ? 1.6 : fuerte < 6 ? 1.67 : 1.74
  return gs.find((g) => g.indice.n === n) ?? gs[0]
}

/** Perfil del corte horizontal del lente (de la nariz a la sien), para dibujarlo: [x mm, espesor mm][]. */
export function perfil(p: { neg: number; pos: number }, l: Lente, ix: Indice, pasos = 24): [number, number][] {
  const out: [number, number][] = []
  for (let i = 0; i <= pasos; i++) {
    const x = -l.nariz + ((l.nariz + l.sien) * i) / pasos
    const y = Math.abs(x)
    const t = p.neg < 0
      ? ix.centro + sagita(p.neg, ix.n, y)
      : p.pos > 0 ? BORDE_MIN + sagita(p.pos, ix.n, l.lejos) - sagita(p.pos, ix.n, y) : ix.centro
    out.push([x, t])
  }
  return out
}
