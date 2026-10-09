// Vision Lab con dos marcas (2026-10-09): el mismo Lab, con piel Orbital en /lab y piel beRabbit en /berabbit/lab.
// beRabbit es una marca aparte (pregraduados de lectura 7×7×7): usa el Lab de Orbital pero sin nombrar a Orbital,
// con su paleta, sus 7 modelos BR1–BR7 y sus ópticas con exhibidor.
import { supabase } from '../../lib/supabase'
import type { Marco } from './marcos'

export const ES_BR = typeof window !== 'undefined' && /^\/berabbit\/lab(\/|$)/.test(window.location.pathname)

// Piel beRabbit: clase en <html> (también tiñe el calce, que se abre encima) y sus tipografías.
if (ES_BR && typeof document !== 'undefined') {
  document.documentElement.classList.add('vl-br')
  document.title = 'beRabbit Vision Lab'
  const l = document.createElement('link')
  l.rel = 'stylesheet'
  l.href = 'https://fonts.googleapis.com/css2?family=DM+Serif+Display&family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600;9..40,700&display=swap'
  document.head.appendChild(l)
}

/** Ruta del Lab sin el prefijo de la marca: /berabbit/lab/rostro → /lab/rostro. */
export const rutaLab = (p: string) => p.replace(/^\/berabbit(?=\/lab(\/|$))/, '')

export const MARCA = ES_BR
  ? {
      id: 'berabbit' as const,
      nombre: 'beRabbit',
      lab: 'beRabbit Vision Lab',
      empresa: 'beRabbit',
      opticas: 'ópticas beRabbit',
      red: 'red beRabbit',
      base: '/berabbit/lab',
      tienda: '/berabbit#/tienda',
      /** Las ópticas con exhibidor beRabbit todavía no están en la base: el buscador muestra la tienda. */
      conOpticas: false,
    }
  : {
      id: 'orbital' as const,
      nombre: 'Orbital',
      lab: 'Orbital Vision Lab',
      empresa: 'Orbital Eyewear',
      opticas: 'ópticas Orbital',
      red: 'red Orbital',
      base: '/lab',
      tienda: 'https://ver.orbitaleyewear.com.ar',
      conOpticas: true,
    }

/** Link a la ficha de un modelo: la landing de Orbital o la tienda beRabbit. */
export const linkModelo = (m: string, qs: string) =>
  ES_BR ? MARCA.tienda : `https://ver.orbitaleyewear.com.ar/modelo/${encodeURIComponent(m)}?${qs}`

// Los 7 modelos beRabbit (fotos de marca blanca BR1–BR7, recortadas justo al frente del armazón: el ancho de la foto
// es el frente). Formato según la foto. ANCHO ESTIMADO: 140 mm de frente y 46 mm de lente, típico de un pregraduado
// de lectura; reemplazar por las medidas reales de cada modelo (frente total y altura del lente, en mm).
const MEDIDAS_BR: Record<number, { ancho: number; alto: number; formato: string }> = {
  1: { ancho: 140, alto: 46, formato: 'cuadrado' }, 2: { ancho: 140, alto: 46, formato: 'redondo' },
  3: { ancho: 140, alto: 46, formato: 'ojo de gato' }, 4: { ancho: 140, alto: 46, formato: 'aviador' },
  5: { ancho: 140, alto: 46, formato: 'redondo' }, 6: { ancho: 140, alto: 46, formato: 'cuadrado' },
  7: { ancho: 140, alto: 46, formato: 'rectangular' },
}
export const MARCOS_BR: Marco[] = [1, 2, 3, 4, 5, 6, 7].map((n) => ({
  modelo: `Modelo ${n}`, ancho_mm: MEDIDAS_BR[n].ancho, alto_mm: MEDIDAS_BR[n].alto, formato: MEDIDAS_BR[n].formato,
  talle: null, frente: null, para: 'Lectura', foto: `/p/mb/BR${n}_frente.webp`, precio_desde: 79000,
}))
/** "Modelo 4" → 4 (null si no es un modelo beRabbit). */
export const nroBR = (modelo: string) => { const n = Number(/^Modelo ([1-7])$/.exec(modelo)?.[1]); return n || null }

// Los 7 colores beRabbit (los mismos del panel /berabbit): [nombre, color del acetato, opacidad si es translúcido].
export const COLORES_BR: { k: string; n: string; hex: string; a?: number }[] = [
  { k: 'cherry', n: 'Cherry', hex: '#6b1e2c' }, { k: 'musgo', n: 'Musgo', hex: '#5d6b3b' },
  { k: 'hielo', n: 'Hielo', hex: '#dfe4e8', a: 0.4 }, { k: 'petroleo', n: 'Petróleo', hex: '#1d5a68' },
  { k: 'gris', n: 'Gris', hex: '#7b7068' }, { k: 'marron', n: 'Marrón', hex: '#5b3a25' }, { k: 'negro', n: 'Negro', hex: '' },
]

const tenidos = new Map<string, Promise<HTMLCanvasElement | null>>()
/** El anteojo beRabbit real (foto BRn de frente) teñido en uno de sus 7 colores, con el fondo y los cristales
 *  transparentes, listo para ponerlo sobre la cara. Misma técnica que el panel /berabbit y la marca blanca. */
export function anteojoBR(n: number, ci: number): Promise<HTMLCanvasElement | null> {
  const k = n + '|' + ci
  if (!tenidos.has(k)) tenidos.set(k, (async () => {
    const im = new Image()
    im.src = `/p/mb/BR${n}_frente.webp`
    try { await im.decode() } catch { return null }
    const w = Math.min(900, im.naturalWidth), h = Math.round((im.naturalHeight * w) / im.naturalWidth)
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h
    const x = cv.getContext('2d', { willReadFrequently: true })!
    x.drawImage(im, 0, 0, w, h)
    const d = x.getImageData(0, 0, w, h), p = d.data
    const lum = (i: number) => (p[i] * 0.3 + p[i + 1] * 0.59 + p[i + 2] * 0.11) / 255
    let s = 0, m = 0
    for (let i = 0; i < p.length; i += 16) { const L = lum(i); if (L < 0.55) { s += L; m++ } }
    const base = m ? s / m : 0.25
    const col = COLORES_BR[ci] ?? COLORES_BR[6]
    const c = col.hex ? [1, 3, 5].map((j) => parseInt(col.hex.slice(j, j + 2), 16)) : null
    const a = col.a ?? 1
    for (let i = 0; i < p.length; i += 4) {
      const L = lum(i), al = Math.min(1, Math.max(0, (0.93 - L) / 0.5))
      p[i + 3] = Math.round(255 * al * (a < 1 ? 0.75 : 1))
      if (!al || !c) continue
      const q = L / base
      for (let j = 0; j < 3; j++) p[i + j] = q <= 1 ? c[j] * (0.35 + 0.65 * q) : c[j] + (255 - c[j]) * Math.min(1, (q - 1) * 0.6)
    }
    x.putImageData(d, 0, 0)
    return cv
  })())
  return tenidos.get(k)!
}

/** Armazones del Lab: el catálogo con stock de Orbital (RPC pretest_marcos) o los 7 modelos beRabbit. */
export async function cargarMarcos(): Promise<Marco[]> {
  if (ES_BR) return MARCOS_BR
  const { data } = await supabase.rpc('pretest_marcos')
  return (data as Marco[] | null) ?? []
}

export function Logo({ sub = 'Vision Lab' }: { sub?: string }) {
  return ES_BR
    ? <div className="logo br"><img src="/br/palabra.svg" alt="beRabbit" /><span>{sub}</span></div>
    : <div className="logo"><b>ORBITAL</b><span>{sub}</span></div>
}
