// Orbital Vision Lab · Grosor de los cristales: simulador visual (corte del lente a escala, grosor por material y
// efecto del tamaño del armazón). Lo usan el informe del chequeo (con la receta cargada) y el perfil visual.
// Se alimenta del perfil: ancho del marco que mejor le calzó (o su talle ideal) y DP (tarjeta o escaneo).
import { useMemo, useState } from 'react'
import { Layers } from 'lucide-react'
import type { Receta } from './marcos'
import { Grosor as G, grosores, lenteDe, perfil, potencias, sugerido } from './grosorCalc'

const mm = (v: number) => v.toFixed(1).replace('.', ',')

export default function Grosor({ rec, marco, dp, alto, modelo }: {
  rec: Receta; marco: number | null; dp: number | null; alto?: number | null; modelo?: string | null
}) {
  const p = useMemo(() => potencias(rec), [rec])
  const ancho = marco ?? 140
  const dpU = dp ?? 63
  const lente = useMemo(() => lenteDe(ancho, dpU, alto), [ancho, dpU, alto])
  const gs = useMemo(() => (p ? grosores(p, lente) : []), [p, lente])
  const sug = p ? sugerido(gs, p) : null
  const [elegido, setElegido] = useState<number | null>(null)
  const sel: G | null = gs.find((g) => g.indice.n === elegido) ?? sug

  // Un talle menos de armazón (−6 mm de frente): cuánto baja el grosor con el índice elegido.
  const chico = useMemo(() => {
    if (!p || !sel) return null
    const l2 = lenteDe(ancho - 6, dpU, alto)
    return grosores(p, l2).find((g) => g.indice.n === sel.indice.n) ?? null
  }, [p, sel, ancho, dpU, alto])

  if (!p) return null
  const neg = p.neg < 0 && Math.abs(p.neg) >= Math.abs(p.pos)
  const base = gs[0]

  // Corte horizontal a escala: x en mm (nariz → sien), espesor ×3 para que se lea
  const W = 300, H = 80, ex = 5
  const sx = (W - 20) / (lente.nariz + lente.sien)
  const corte = (ix: G) => {
    const pts = perfil(p, lente, ix.indice)
    const top = pts.map(([x, t]) => `${10 + (x + lente.nariz) * sx},${H / 2 - (t * ex) / 2}`)
    const bot = [...pts].reverse().map(([x, t]) => `${10 + (x + lente.nariz) * sx},${H / 2 + (t * ex) / 2}`)
    return [...top, ...bot].join(' ')
  }
  const xOc = 10 + lente.nariz * sx

  return (
    <div className="grosor">
      <div className="gr-h"><Layers size={18} /><div><b>Grosor de tus cristales</b><small>Con {modelo ? <>el <b>{modelo}</b> ({ancho} mm)</> : marco ? `tu armazón de ${ancho} mm` : 'un armazón mediano (140 mm)'} y DP {mm(dpU)} mm{dp ? '' : ' (estimada)'}</small></div></div>

      {sel && (
        <svg viewBox={`0 0 ${W} ${H + 22}`} className="gr-corte" role="img" aria-label={`Corte del cristal ${sel.indice.corto}: ${neg ? 'borde' : 'centro'} de ${mm(neg ? sel.borde : sel.centro)} mm`}>
          <polygon points={corte(base)} fill="none" stroke="#b9b4ab" strokeDasharray="3 3" />
          <polygon points={corte(sel)} fill="rgba(63,120,201,.16)" stroke="#3f78c9" strokeWidth="1.5" />
          <line x1={xOc} x2={xOc} y1={6} y2={H - 6} stroke="#8f6a34" strokeDasharray="2 3" />
          <text x={xOc} y={H + 8} textAnchor="middle" fontSize="9" fill="#8f6a34" fontWeight="700">pupila</text>
          <text x={10} y={H + 18} fontSize="9" fill="#76767f">nariz</text>
          <text x={W - 10} y={H + 18} textAnchor="end" fontSize="9" fill="#76767f">sien</text>
          <text x={W - 10} y={12} textAnchor="end" fontSize="10" fontWeight="800" fill="#17171c">{neg ? 'borde' : 'centro'} {mm(neg ? sel.borde : sel.centro)} mm</text>
          <text x={W - 10} y={24} textAnchor="end" fontSize="9" fill="#9a958c">punteado: 1.50</text>
        </svg>
      )}

      <div className="gr-lista" role="radiogroup" aria-label="Material del cristal">
        {gs.map((g) => {
          const v = neg ? g.borde : g.centro
          const menos = Math.round((1 - v / (neg ? base.borde : base.centro)) * 100)
          return (
            <button key={g.indice.n} role="radio" aria-checked={sel?.indice.n === g.indice.n} className={sel?.indice.n === g.indice.n ? 'sel' : ''} onClick={() => setElegido(g.indice.n)}>
              <span className="nm">{g.indice.corto}{sug?.indice.n === g.indice.n && <i>sugerido</i>}</span>
              <span className="bar"><em style={{ width: `${Math.min(100, (v / Math.max(base.max, 1)) * 100)}%` }} /></span>
              <span className="v num">{mm(v)} mm</span>
              <span className="pc num">{menos > 0 ? `−${menos} %` : '—'}</span>
            </button>
          )
        })}
      </div>

      {chico && sel && (neg ? sel.borde : sel.centro) - (neg ? chico.borde : chico.centro) >= 0.3 && (
        <p className="gr-tip">Con un armazón un talle más chico ({ancho - 6} mm) el {neg ? 'borde' : 'centro'} baja a <b className="num">{mm(neg ? chico.borde : chico.centro)} mm</b> en {sel.indice.corto}. Probalo en la medición de calce.</p>
      )}
      {lente.sien - lente.nariz > 10 && neg && (
        <p className="gr-tip">Tu pupila queda cerca de la nariz dentro del lente: el lado de la sien es el que más se engrosa. Un armazón más angosto centra la pupila y lo afina.</p>
      )}
      <p className="muted small" style={{ margin: 0 }}>Estimación con tu receta (±0,5 mm). El grosor final lo define el laboratorio según la curva y el tallado; tu óptica te confirma el material.</p>
    </div>
  )
}
