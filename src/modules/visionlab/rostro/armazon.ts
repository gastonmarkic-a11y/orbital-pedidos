// Armazones dibujados (no fotos): la misma geometría en mm sirve para los íconos SVG del informe y para el probador
// de formas en vivo (canvas). Un armazón = dos lentes + puente + bisagras, con el ancho total del frente que se pida.
import type { Estilo } from './medidas'

export const PUENTE_MM = 18
export const BISAGRA_MM = 7

export interface Color { id: string; nombre: string; aro: string; metal?: boolean; carey?: boolean; alfa?: number }
export const COLORES: Color[] = [
  { id: 'negro', nombre: 'Negro', aro: '#141416' },
  { id: 'carey', nombre: 'Carey', aro: '#6b4423', carey: true },
  { id: 'cristal', nombre: 'Cristal', aro: '#e9e6e1', alfa: 0.55 },
  { id: 'azul', nombre: 'Azul noche', aro: '#1d2b4a' },
  { id: 'dorado', nombre: 'Dorado', aro: '#c4a25a', metal: true },
  { id: 'plateado', nombre: 'Plateado', aro: '#b9bcc2', metal: true },
]

/** Proporción alto / ancho del lente de cada estilo. */
const ALTO: Record<Estilo, number> = {
  rectangular: 0.6, cuadrado: 0.86, redondo: 0.96, ovalado: 0.72, 'ojo de gato': 0.74, aviador: 0.9, browline: 0.72,
}

const f = (n: number) => Math.round(n * 100) / 100

function rect(a: number, b: number, r: number, cx: number) {
  const x0 = cx - a / 2, x1 = cx + a / 2, y0 = -b / 2, y1 = b / 2
  return `M${f(x0 + r)},${f(y0)}H${f(x1 - r)}Q${f(x1)},${f(y0)} ${f(x1)},${f(y0 + r)}V${f(y1 - r)}Q${f(x1)},${f(y1)} ${f(x1 - r)},${f(y1)}H${f(x0 + r)}Q${f(x0)},${f(y1)} ${f(x0)},${f(y1 - r)}V${f(y0 + r)}Q${f(x0)},${f(y0)} ${f(x0 + r)},${f(y0)}Z`
}
function elipse(a: number, b: number, cx: number) {
  const rx = a / 2, ry = b / 2
  return `M${f(cx - rx)},0A${f(rx)},${f(ry)} 0 1 0 ${f(cx + rx)},0A${f(rx)},${f(ry)} 0 1 0 ${f(cx - rx)},0Z`
}

/** Contorno de un lente centrado en (cx, 0); `s` = +1 si el lado de afuera (la sien) está hacia +x. */
export function lente(e: Estilo, a: number, cx: number, s: 1 | -1): string {
  const b = a * ALTO[e]
  const X = (x: number) => f(cx + x * s)
  const Y = (y: number) => f(y)
  switch (e) {
    case 'rectangular': return rect(a, b, b * 0.24, cx)
    case 'cuadrado': return rect(a, b, b * 0.17, cx)
    case 'browline': return rect(a, b, b * 0.3, cx)
    case 'redondo': return elipse(a, b, cx)
    case 'ovalado': return elipse(a, b, cx)
    case 'ojo de gato': {
      const h = b / 2, w = a / 2
      return `M${X(-w * 0.92)},${Y(-h * 0.62)}` +
        `C${X(-w * 0.4)},${Y(-h * 0.98)} ${X(w * 0.45)},${Y(-h * 1.0)} ${X(w * 1.06)},${Y(-h * 1.18)}` +
        `C${X(w * 1.08)},${Y(-h * 0.3)} ${X(w * 0.9)},${Y(h * 0.9)} ${X(w * 0.15)},${Y(h * 0.98)}` +
        `C${X(-w * 0.55)},${Y(h * 1.04)} ${X(-w * 1.0)},${Y(h * 0.55)} ${X(-w * 1.0)},${Y(-h * 0.05)}` +
        `C${X(-w * 1.0)},${Y(-h * 0.35)} ${X(-w * 0.97)},${Y(-h * 0.52)} ${X(-w * 0.92)},${Y(-h * 0.62)}Z`
    }
    case 'aviador': {
      const h = b / 2, w = a / 2
      return `M${X(-w * 0.92)},${Y(-h * 0.86)}` +
        `C${X(-w * 0.3)},${Y(-h * 1.02)} ${X(w * 0.5)},${Y(-h * 1.02)} ${X(w * 0.96)},${Y(-h * 0.9)}` +
        `C${X(w * 1.1)},${Y(-h * 0.2)} ${X(w * 0.85)},${Y(h * 0.75)} ${X(w * 0.1)},${Y(h * 1.0)}` +
        `C${X(-w * 0.55)},${Y(h * 1.12)} ${X(-w * 0.95)},${Y(h * 0.6)} ${X(-w * 1.0)},${Y(-h * 0.1)}` +
        `C${X(-w * 1.02)},${Y(-h * 0.5)} ${X(-w * 1.0)},${Y(-h * 0.75)} ${X(-w * 0.92)},${Y(-h * 0.86)}Z`
    }
  }
}

export interface Geometria {
  a: number; b: number
  lentes: [string, string]
  puente: string
  /** Bisagras (rectángulos) en los extremos. */
  bisagras: [string, string]
  /** Solo browline: barra superior gruesa. */
  barra?: [string, string]
  /** Aviador: segunda barra del puente. */
  puente2?: string
}

/** Geometría completa en mm, centrada en el puente, para un ancho total del frente `T` (mm). +x = lado izquierdo de la persona en la imagen sin espejar. */
export function geometria(e: Estilo, T: number): Geometria {
  const a = (T - PUENTE_MM - 2 * BISAGRA_MM) / 2
  const b = a * ALTO[e]
  const c = PUENTE_MM / 2 + a / 2
  const yP = -b * (e === 'aviador' ? 0.32 : 0.2)
  const puente = `M${f(-PUENTE_MM / 2 - 1)},${f(yP + 1)}Q0,${f(yP - b * 0.14)} ${f(PUENTE_MM / 2 + 1)},${f(yP + 1)}`
  const yB = e === 'ojo de gato' ? -b * 0.48 : e === 'aviador' ? -b * 0.4 : -b * 0.3
  const bis = (s: 1 | -1) => {
    const x = s * (c + a / 2) - (s > 0 ? 1 : BISAGRA_MM - 1)
    return `M${f(x)},${f(yB - 2)}h${BISAGRA_MM}v4h${-BISAGRA_MM}Z`
  }
  const g: Geometria = {
    a, b,
    lentes: [lente(e, a, -c, -1), lente(e, a, c, 1)],
    puente,
    bisagras: [bis(-1), bis(1)],
  }
  if (e === 'aviador') g.puente2 = `M${f(-PUENTE_MM / 2 - a * 0.1)},${f(-b * 0.47)}L${f(PUENTE_MM / 2 + a * 0.1)},${f(-b * 0.47)}`
  if (e === 'browline') {
    const barra = (cx: number) => `M${f(cx - a / 2 - 0.5)},${f(-b * 0.12)}V${f(-b / 2 + b * 0.3)}Q${f(cx - a / 2 - 0.5)},${f(-b / 2 - 0.5)} ${f(cx - a / 2 + b * 0.3)},${f(-b / 2 - 0.5)}H${f(cx + a / 2 - b * 0.3)}Q${f(cx + a / 2 + 0.5)},${f(-b / 2 - 0.5)} ${f(cx + a / 2 + 0.5)},${f(-b / 2 + b * 0.3)}V${f(-b * 0.12)}`
    g.barra = [barra(-c), barra(c)]
  }
  return g
}

/** Grosor del aro en mm según material / estilo. */
export const grosor = (e: Estilo, c: Color) => (c.metal || e === 'aviador' ? 1.3 : e === 'browline' ? 1.0 : 3.6)

// ── Carey: textura generada una vez ───────────────────────────────────────────────────────────
let careyCache: HTMLCanvasElement | null = null
function texturaCarey(): HTMLCanvasElement {
  if (careyCache) return careyCache
  const c = document.createElement('canvas'); c.width = c.height = 128
  const x = c.getContext('2d')!
  x.fillStyle = '#7a4a22'; x.fillRect(0, 0, 128, 128)
  let s = 7
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647)
  for (let i = 0; i < 70; i++) {
    const r = 4 + rnd() * 14
    const g = x.createRadialGradient(0, 0, 0, 0, 0, r)
    const oscuro = rnd() < 0.55
    g.addColorStop(0, oscuro ? 'rgba(35,18,8,.85)' : 'rgba(196,128,58,.7)')
    g.addColorStop(1, 'rgba(0,0,0,0)')
    x.save(); x.translate(rnd() * 128, rnd() * 128); x.scale(1.6, 1); x.fillStyle = g
    x.beginPath(); x.arc(0, 0, r, 0, Math.PI * 2); x.fill(); x.restore()
  }
  return (careyCache = c)
}

/** Dibuja el armazón en un canvas: ya trasladado y rotado al puente, con `pxMm` píxeles por mm. */
export function dibujar(ctx: CanvasRenderingContext2D, e: Estilo, T: number, color: Color, pxMm: number) {
  const g = geometria(e, T)
  ctx.save()
  ctx.scale(pxMm, pxMm)
  const lentes = g.lentes.map((d) => new Path2D(d))
  // cristal: leve tinte y un reflejo
  for (const p of lentes) {
    ctx.fillStyle = 'rgba(210,225,245,0.10)'
    ctx.fill(p)
    ctx.save(); ctx.clip(p)
    const gr = ctx.createLinearGradient(-T / 2, -g.b / 2, -T / 4, g.b / 2)
    gr.addColorStop(0, 'rgba(255,255,255,0.22)'); gr.addColorStop(0.35, 'rgba(255,255,255,0.0)')
    ctx.fillStyle = gr; ctx.fillRect(-T, -g.b, 2 * T, 2 * g.b)
    ctx.restore()
  }
  const w = grosor(e, color)
  const estilo: string | CanvasPattern = color.carey ? ctx.createPattern(texturaCarey(), 'repeat')! : color.aro
  if (color.carey) (estilo as CanvasPattern).setTransform(new DOMMatrix().scale(0.12))
  ctx.globalAlpha = color.alfa ?? 1
  ctx.lineJoin = 'round'; ctx.lineCap = 'round'
  ctx.shadowColor = 'rgba(0,0,0,0.35)'; ctx.shadowBlur = 3 * pxMm; ctx.shadowOffsetY = 0.8 * pxMm
  ctx.strokeStyle = e === 'browline' ? '#b59a62' : estilo
  ctx.lineWidth = w
  for (const p of lentes) ctx.stroke(p)
  ctx.strokeStyle = estilo
  if (g.barra) { ctx.lineWidth = 4.2; for (const d of g.barra) ctx.stroke(new Path2D(d)) }
  ctx.lineWidth = Math.max(w * 0.8, 1.6)
  ctx.stroke(new Path2D(g.puente))
  if (g.puente2) ctx.stroke(new Path2D(g.puente2))
  ctx.fillStyle = estilo
  for (const d of g.bisagras) ctx.fill(new Path2D(d))
  // brillo del aro (acetato / metal)
  ctx.shadowColor = 'transparent'
  ctx.globalAlpha = (color.alfa ?? 1) * 0.35
  ctx.strokeStyle = '#ffffff'; ctx.lineWidth = Math.max(w * 0.18, 0.35)
  ctx.save(); ctx.translate(0, -w * 0.25)
  for (const p of lentes) { ctx.save(); ctx.clip(new Path2D(`M${-T},${-g.b}H${T}V${-g.b * 0.15}H${-T}Z`)); ctx.stroke(p); ctx.restore() }
  ctx.restore()
  ctx.restore()
}
