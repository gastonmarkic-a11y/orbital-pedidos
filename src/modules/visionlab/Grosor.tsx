// Orbital Vision Lab · Grosor de los cristales: simulador visual (corte del lente a escala, grosor por material y
// efecto del tamaño del armazón). Lo usan el informe del chequeo (con la receta cargada) y el perfil visual.
// Se alimenta del perfil: ancho del marco que mejor le calzó (o su talle ideal) y DP (tarjeta o escaneo).
import { useEffect, useMemo, useState } from 'react'
import { Glasses, Layers } from 'lucide-react'
import { MARCA, cargarMarcos } from './marca'
import type { Marco, Receta } from './marcos'
import { ARO_ACETATO, ARO_FINO, DISENOS, Diseno, Grosor as G, grosores, lenteDe, masFinos, perfil, potencias, profundidadDe, sugerido } from './grosorCalc'

const mm = (v: number) => v.toFixed(1).replace('.', ',')

export default function Grosor({ rec, marco, dp, alto, modelo, ideal }: {
  rec: Receta; marco: number | null; dp: number | null; alto?: number | null; modelo?: string | null
  /** Ancho ideal del estudio de rostro: limita la lista de armazones a los que calzan. */
  ideal?: number | null
}) {
  const [marcos, setMarcos] = useState<Marco[] | null>(null)
  useEffect(() => { cargarMarcos().then(setMarcos) }, [])
  const ancho = marco ?? 140
  const dpU = dp ?? 63
  const lente = useMemo(() => lenteDe(ancho, dpU, alto), [ancho, dpU, alto])
  // con la lente: si la receta trae eje, el astigmatismo se calcula en la dirección real de cada borde
  const p = useMemo(() => potencias(rec, lente), [rec, lente])
  const [dis, setDis] = useState<Diseno['id']>('esferico')
  const d = DISENOS.find((x) => x.id === dis) ?? DISENOS[0]
  const gs = useMemo(() => (p ? grosores(p, lente, d.f) : []), [p, lente, d.f])
  // Referencia fija para comparar: 1.50 esférico (el cristal más común y el más grueso).
  const base = useMemo(() => (p ? grosores(p, lente)[0] : null), [p, lente])
  const sug = p ? sugerido(gs, p) : null
  const [elegido, setElegido] = useState<number | null>(null)
  const sel: G | null = gs.find((g) => g.indice.n === elegido) ?? sug

  // Un talle menos de armazón (−6 mm de frente): cuánto baja el grosor con el índice elegido.
  const chico = useMemo(() => {
    if (!p || !sel) return null
    const l2 = lenteDe(ancho - 6, dpU, alto)
    return grosores(p, l2, d.f).find((g) => g.indice.n === sel.indice.n) ?? null
  }, [p, sel, ancho, dpU, alto, d.f])

  // Con graduación de 2 D o más, qué armazones del catálogo dejan el cristal más fino (con el material elegido).
  const finos = useMemo(() => {
    if (!p || !sel || !marcos?.length || Math.max(Math.abs(p.neg), Math.abs(p.pos)) < 2) return []
    return masFinos(marcos, p, dpU, sel.indice.n, ideal ?? null, 4, d.f)
  }, [p, sel, marcos, dpU, ideal, d.f])

  if (!p || !base) return null
  const neg = p.neg < 0 && Math.abs(p.neg) >= Math.abs(p.pos)
  const fuerte = Math.max(Math.abs(p.neg), Math.abs(p.pos))

  // Corte horizontal a escala: x en mm (nariz → sien), espesor ×3 para que se lea
  const W = 300, H = 80, ex = 5
  const sx = (W - 20) / (lente.nariz + lente.sien)
  const corte = (ix: G) => {
    const pts = perfil(p, lente, ix.indice, ix === base ? 1 : d.f)
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
          <text x={W - 10} y={24} textAnchor="end" fontSize="9" fill="#9a958c">punteado: 1.50 esférico</text>
        </svg>
      )}

      <div className="gr-dis" role="radiogroup" aria-label="Diseño del cristal">
        {DISENOS.map((x) => (
          <button key={x.id} role="radio" aria-checked={dis === x.id} className={dis === x.id ? 'sel' : ''} onClick={() => setDis(x.id)}>{x.nombre}</button>
        ))}
      </div>
      <small className="gr-dis-nota">{d.nota}{fuerte < 2 && d.f < 1 ? ' Con tu graduación la diferencia de grosor es mínima.' : ''}</small>

      <div className="gr-lista" role="radiogroup" aria-label="Material del cristal">
        {gs.map((g) => {
          const v = neg ? g.borde : g.centro
          const menos = Math.round((1 - v / (neg ? base.borde : base.centro)) * 100)
          return (
            <button key={g.indice.n} role="radio" aria-checked={sel?.indice.n === g.indice.n} className={sel?.indice.n === g.indice.n ? 'sel' : ''} onClick={() => setElegido(g.indice.n)}>
              <span className="nm" title={g.indice.nota}>{g.indice.corto}{sug?.indice.n === g.indice.n && <i>sugerido</i>}</span>
              <span className="bar"><em style={{ width: `${Math.min(100, (v / Math.max(base.max, 1)) * 100)}%` }} /></span>
              <span className="v num">{mm(v)} mm</span>
              <span className="pc num">{menos > 0 ? `−${menos} %` : '—'}</span>
            </button>
          )
        })}
      </div>

      {neg && sel && <VistaAro borde={sel.borde} modelo={modelo ?? null} />}

      {chico && sel && (neg ? sel.borde : sel.centro) - (neg ? chico.borde : chico.centro) >= 0.3 && (
        <p className="gr-tip">Con un armazón un talle más chico ({ancho - 6} mm) el {neg ? 'borde' : 'centro'} baja a <b className="num">{mm(neg ? chico.borde : chico.centro)} mm</b> en {sel.indice.corto}. Probalo en la medición de calce.</p>
      )}
      {lente.sien - lente.nariz > 10 && neg && (
        <p className="gr-tip">Tu pupila queda cerca de la nariz dentro del lente: el lado de la sien es el que más se engrosa. Un armazón más angosto centra la pupila y lo afina.</p>
      )}
      {finos.length > 0 && sel && (
        <div className="gr-finos">
          <b>Armazones que dejan tu cristal más fino{ideal ? ' y te calzan' : ''}</b>
          <small className="muted">Con {sel.indice.corto} y tu DP: cuanto más cerca de la pupila queda el borde, más fino.</small>
          <ul>
            {finos.map((m) => (
              <li key={m.modelo}>
                <span className="ph">{m.foto ? <img src={m.foto} alt="" loading="lazy" /> : <Glasses size={18} />}</span>
                <span className="nm"><b>{m.modelo}</b><small className="num">{m.ancho_mm} mm de frente</small></span>
                <span className="v num">{neg ? 'borde' : 'centro'} {mm(m.grosor)} mm</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {fuerte >= 2 && (
        <ul className="gr-reglas">
          {neg ? <>
            <li><b>Armazón:</b> acetato de aro completo y no muy ancho: el aro tapa el borde. {fuerte >= 4 ? 'Con esta graduación, evitá los al aire o semi al aire: el borde queda a la vista.' : ''}</li>
            <li><b>Forma:</b> redonda u ovalada con lente chico; las esquinas lejos de la pupila son las que más se engrosan.</li>
          </> : <>
            <li><b>Armazón:</b> chico y de lente redondo u ovalado: con positivo lo grueso es el centro y crece con el tamaño del lente.</li>
            <li><b>Forma:</b> que la pupila caiga en el centro del lente (DP del armazón parecida a la tuya) para que el laboratorio pueda tallarlo más fino.</li>
          </>}
          <li><b>Material:</b> {fuerte < 2 ? '1.50' : fuerte < 4 ? '1.60' : fuerte < 6 ? '1.67' : '1.74'} para tu graduación; con antirreflejo, que en alto índice se nota más sin él.</li>
        </ul>
      )}
      <p className="muted small" style={{ margin: 0 }}>Estimación con tu receta (±0,5 mm). El grosor final lo define el laboratorio según la curva y el tallado; tu óptica te confirma el material.</p>
    </div>
  )
}

/** Vista de costado (2026-10-08): el borde del cristal dentro del aro, a escala. El aro tapa su profundidad; lo que
 *  sobra queda a la vista (el "culo de botella"). El laboratorio apoya el cristal contra el frente del aro, así que
 *  lo que sobresale va hacia el ojo. Compara el modelo (o un acetato común si no tiene la medida) con un aro fino. */
function VistaAro({ borde, modelo }: { borde: number; modelo: string | null }) {
  const prof = profundidadDe(modelo)
  const aros = [
    { nombre: prof && modelo ? modelo : 'Acetato común', p: prof ?? ARO_ACETATO, tuyo: !!prof },
    { nombre: 'Aro fino', p: ARO_FINO, tuyo: false },
  ]
  const W = 300, H = 112, col = W / 2
  const k = Math.min(12, (col - 44) / Math.max(borde, ...aros.map((a) => a.p)))
  const sobra = (p: number) => Math.max(0, borde - p)
  const s0 = sobra(aros[0].p)
  return (
    <div className="gr-aro">
      <b>Cómo queda el borde en el aro</b>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={aros.map((a) => `${a.nombre}: ${sobra(a.p) > 0.2 ? `se ven ${mm(sobra(a.p))} mm` : 'queda tapado'}`).join(' · ')}>
        {aros.map((a, i) => {
          const x0 = i * col + 22, y = 18, h = 52, s = sobra(a.p)
          return (
            <g key={a.nombre}>
              <rect x={x0} y={y + 9} width={borde * k} height={h - 18} rx="2" fill="rgba(63,120,201,.22)" stroke="#3f78c9" />
              <rect x={x0 - 3} y={y} width={a.p * k + 3} height={h} rx="5" fill="#26262c" />
              {s > 0.2 && <>
                <rect x={x0 + a.p * k} y={y + 9} width={s * k} height={h - 18} fill="rgba(214,138,40,.35)" stroke="#d68a28" />
                <text x={x0 + a.p * k + (s * k) / 2} y={y + h + 12} textAnchor="middle" fontSize="11" fontWeight="800" fill="#b06a12">{mm(s)} mm a la vista</text>
              </>}
              {s <= 0.2 && <text x={x0 + (a.p * k) / 2} y={y + h + 12} textAnchor="middle" fontSize="11" fontWeight="800" fill="#1f8a5b">tapado</text>}
              <text x={x0 - 3} y={12} fontSize="12" fontWeight="800" fill="#17171c">{a.nombre}</text>
              <text x={x0 - 3} y={H - 6} fontSize="10" fill="#76767f">aro {mm(a.p)} mm{a.tuyo ? '' : ' (típico)'}</text>
            </g>
          )
        })}
        <text x={W - 6} y={12} textAnchor="end" fontSize="8.5" fill="#9a958c">frente → ojo</text>
      </svg>
      <small className="muted">
        {prof && modelo
          ? s0 <= 0.2 ? <>El aro del <b>{modelo}</b> tapa todo el borde de tu cristal ({mm(borde)} mm).</> : <>El aro del <b>{modelo}</b> tapa {mm(prof)} de los {mm(borde)} mm del borde; en un aro fino se verían {mm(sobra(ARO_FINO))} mm.</>
          : <>Borde de {mm(borde)} mm. Un aro profundo esconde el borde: buscá acetatos de aro grueso{MARCA.id === 'orbital' ? ' o los modelos de Orbital con aro profundo' : ''}.</>}
      </small>
    </div>
  )
}
