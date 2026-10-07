// Orbital Vision Lab · Estudio de rostro — público en /lab/rostro (y en la Suite: /vision-lab/rostro).
// Escaneo facial con la cámara → forma del rostro, medidas en mm y talle de armazón → formas recomendadas con
// probador de formas en vivo → armazones del catálogo Orbital que cumplen forma y medida.
// Diseño en la línea del pretest (ref.: Warby Parker / Zeiss / Specsavers face-shape & frame-fit tools).
import { useEffect, useMemo, useState } from 'react'
import {
  ArrowRight, Check, Eye, Glasses, Info, Lock, MapPin, RotateCcw, ScanFace, ShieldCheck, Smartphone, Sparkles, Sun, X,
} from 'lucide-react'
import { supabase } from '../../../lib/supabase'
import type { Marco } from '../marcos'
import Escaneo, { Captura } from './Escaneo'
import ProbarFormas, { IconoArmazon } from './ProbarFormas'
import { Estilo, FORMAS, Forma, L, MALLA, OVALO, P3, Resultado, contorno, marcosParaVos, ordenarSeleccion, resultado, z, COLECCION_TALLE, TALLES_PARA } from './medidas'
import { VISITANTE_KEY } from '../../colab/colabUtil'
import { QRProfesional, urlPerfil } from '../extras'
import { Perfil, compactarCalces, compactarRostro, guardarRostro, leerPerfil, rostroDe } from '../perfil'
import Calce from './Calce'
import '../pretest.css'
import './rostro.css'

type Paso = 'inicio' | 'escaneo' | 'analisis' | 'resultado'
const ORDEN: Forma[] = ['ovalado', 'redondo', 'cuadrado', 'alargado', 'corazon', 'diamante', 'triangular']

// Silueta de cada forma de rostro (caja 40 × 50)
const SILUETA: Record<Forma, string> = {
  ovalado: 'M20 3C30 3 35 13 35 24C35 37 28 47 20 47C12 47 5 37 5 24C5 13 10 3 20 3Z',
  redondo: 'M20 5C31 5 37 14 37 25C37 37 30 45 20 45C10 45 3 37 3 25C3 14 9 5 20 5Z',
  cuadrado: 'M8 5H32Q36 5 36 9V36Q36 44 28 45H12Q4 44 4 36V9Q4 5 8 5Z',
  alargado: 'M11 2H29Q33 2 33 7V38Q33 48 20 48Q7 48 7 38V7Q7 2 11 2Z',
  corazon: 'M5 8Q5 3 12 3H28Q35 3 35 8Q35 22 30 31Q25 42 20 47Q15 42 10 31Q5 22 5 8Z',
  diamante: 'M20 3Q27 6 31 15L37 24Q33 35 26 43Q23 47 20 47Q17 47 14 43Q7 35 3 24L9 15Q13 6 20 3Z',
  triangular: 'M14 4H26Q31 5 32 13L36 34Q37 44 26 46H14Q3 44 4 34L8 13Q9 5 14 4Z',
}
export function Silueta({ f, size = 22 }: { f: Forma; size?: number }) {
  return <svg viewBox="0 0 40 50" width={size} height={(size * 50) / 40} aria-hidden><path d={SILUETA[f]} fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinejoin="round" /></svg>
}

const LINEAS = [
  { id: 'frente', t: 'Frente', a: L.frenteD, b: L.frenteI },
  { id: 'pomulos', t: 'Pómulos', a: L.pomuloD, b: L.pomuloI },
  { id: 'mandibula', t: 'Mandíbula', a: L.mandD, b: L.mandI },
  { id: 'largo', t: 'Largo', a: L.frenteArriba, b: L.menton },
] as const
type Linea = (typeof LINEAS)[number]['id']

/** Foto capturada con el contorno y las medidas dibujadas (espejada, como la persona se vio). */
function MapaRostro({ cap, r, sel, animar }: { cap: Captura; r: Resultado; sel: Linea | null; animar?: boolean }) {
  const { W, H, lm } = cap
  // Contorno real (malla abierta a la silueta + nacimiento del pelo), espejado como la foto.
  const con = contorno(lm)
  const esp = (p: P3) => ({ x: (1 - p.x) * W, y: p.y * H })
  const pts = con.puntos.map(esp)
  const arriba = esp(con.arriba), abajo = esp(con.abajo)
  // Extremos de cada ancho, abiertos igual que el contorno
  const P = (i: number) => esp({ x: con.ejeX + (lm[i].x - con.ejeX) * MALLA, y: lm[i].y })
  // recorte alrededor de la cara
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y)
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2
  const lado = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) * 1.45
  const vb = `${cx - lado / 2} ${cy - lado / 2 - lado * 0.02} ${lado} ${lado}`
  const u = lado / 100
  const ovalo = pts.map((p) => `${p.x},${p.y}`).join(' ')
  return (
    <div className={'rs-map' + (animar ? ' anim' : '')}>
      <svg viewBox={vb} preserveAspectRatio="xMidYMid slice">
        <defs>
          <filter id="rs-sh"><feDropShadow dx="0" dy={0.15 * u} stdDeviation={0.4 * u} floodOpacity=".55" /></filter>
        </defs>
        <image href={cap.foto} x={0} y={0} width={W} height={H} transform={`translate(${W},0) scale(-1,1)`} preserveAspectRatio="none" />
        <rect x={cx - lado} y={cy - lado} width={lado * 2} height={lado * 2} fill="rgba(12,12,16,.28)" />
        <polygon points={ovalo} className="ov" fill="none" stroke="#fff" strokeWidth={0.45 * u} strokeLinejoin="round" pathLength={100} filter="url(#rs-sh)" />
        {pts.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={0.45 * u} fill="#d6b26e" className="pt" />)}
        {LINEAS.map((l) => {
          const a = l.id === 'largo' ? arriba : P(l.a), b = l.id === 'largo' ? abajo : P(l.b)
          const on = sel === null || sel === l.id
          const mm = r.mm[l.id]
          const vert = l.id === 'largo'
          const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2
          return (
            <g key={l.id} className={'ln' + (on ? '' : ' off')} filter="url(#rs-sh)">
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#d6b26e" strokeWidth={0.5 * u} strokeDasharray={vert ? `${1.2 * u} ${0.8 * u}` : undefined} />
              <circle cx={a.x} cy={a.y} r={0.9 * u} fill="#d6b26e" /><circle cx={b.x} cy={b.y} r={0.9 * u} fill="#d6b26e" />
              <g transform={`translate(${vert ? mx + 2.2 * u : mx},${vert ? my : my - 2 * u})`}>
                <rect x={vert ? 0 : -7 * u} y={-2.3 * u} width={14 * u} height={4.6 * u} rx={2.3 * u} fill="rgba(18,18,22,.82)" />
                <text x={vert ? 7 * u : 0} y={1.15 * u} textAnchor="middle" fontSize={3 * u} fontWeight={700} fill="#fff" fontFamily="Manrope,system-ui">{mm} mm</text>
              </g>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

function Analizando({ cap, r, onFin }: { cap: Captura; r: Resultado; onFin: () => void }) {
  const PASOS = ['Contorno del rostro', 'Ancho de frente, pómulos y mandíbula', 'Proporción largo / ancho', 'Escala en milímetros con el iris', 'Formas que te favorecen']
  const [i, setI] = useState(0)
  useEffect(() => {
    if (i >= PASOS.length) { const t = setTimeout(onFin, 450); return () => clearTimeout(t) }
    const t = setTimeout(() => setI(i + 1), 520)
    return () => clearTimeout(t)
  }, [i]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <section className="step">
      <div>
        <div className="kicker"><Sparkles size={15} />Analizando</div>
        <h2>Estamos leyendo tus proporciones</h2>
      </div>
      <MapaRostro cap={cap} r={r} sel={null} animar />
      <ul className="rs-pasos">
        {PASOS.map((t, k) => (
          <li key={t} className={k < i ? 'ok' : k === i ? 'now' : ''}>
            <span>{k < i ? <Check size={14} /> : k === i ? <i className="spin-dot" /> : null}</span>{t}
          </li>
        ))}
      </ul>
    </section>
  )
}

const precioAR = (n: number) => '$' + Math.round(n).toLocaleString('es-AR')

function Frame({ m, href, motivos, externo }: { m: Marco; href: string; motivos: string[]; externo?: boolean }) {
  return (
    <a className="frame" href={href} {...(externo ? { target: '_blank', rel: 'noopener' } : {})}>
      <div className="ph">{m.foto ? <img src={m.foto} alt={'Armazón ' + m.modelo} loading="lazy" /> : <Glasses size={28} />}</div>
      <div className="fb">
        <b>{m.modelo}</b>
        {motivos.length > 0 && <span className="why">{motivos.slice(0, 2).join(' · ')}</span>}
        {m.precio_desde ? <span className="price num">Desde {precioAR(m.precio_desde)}</span> : null}
      </div>
    </a>
  )
}

// ── Link de un influencer o de Zaira (?r=<codigo de uno de sus links>) ─────────────────────────────
// colab-click 'ver' da su nombre y sus anteojos (su catálogo, o la colección ZN) con el link que les atribuye la
// venta: /r/<codigo> (con su cupón) o la ficha de la tienda con sus UTM (promotor sin cupón). Con la forma y las
// medidas de cada modelo (rostro_medidas) se le muestran a la persona los de esa selección que le van a su cara.
// La visita cuenta como un toque de ese link, igual que la landing /r/.
type MarcoRef = Marco & { href: string }
type Seleccion = { nombre: string; marcos: MarcoRef[] }
type Ver = {
  ok: boolean; modelo?: string; influencer?: string; pct?: number; directo?: string | null; tienda?: string
  colores?: { imagen: string | null; price: number | null }[]
  coleccion?: { modelo: string; imagen: string | null; price: number | null; url: string }[]
  catalogo?: { codigo: string; modelo: string; imagen: string | null; price: number | null }[]
}
function visitante() {
  try {
    let v = localStorage.getItem(VISITANTE_KEY)
    if (!v) { v = crypto.randomUUID(); localStorage.setItem(VISITANTE_KEY, v) }
    return v
  } catch { return null }
}
async function cargarSeleccion(codigo: string): Promise<Seleccion | null> {
  const { data } = await supabase.functions.invoke('colab-click', { body: { codigo, visitante: visitante(), accion: 'ver' } })
  const d = data as Ver | null
  if (!d?.ok || !d.influencer || !d.modelo) return null
  const items: { modelo: string; foto: string | null; precio: number | null; href: string }[] = [
    { modelo: d.modelo, foto: d.colores?.find((c) => c.imagen)?.imagen ?? null, precio: d.colores?.[0]?.price ?? null,
      href: d.pct === 0 ? (d.directo ?? d.tienda ?? '') : `/r/${codigo}` },
    ...(d.coleccion ?? []).map((c) => ({ modelo: c.modelo, foto: c.imagen, precio: c.price, href: c.url })),
    ...(d.catalogo ?? []).map((c) => ({ modelo: c.modelo, foto: c.imagen, precio: c.price, href: `/r/${c.codigo}` })),
  ]
  const unicos = items.filter((x, i) => x.href && items.findIndex((y) => y.modelo.toUpperCase() === x.modelo.toUpperCase()) === i)
  const { data: med } = await supabase.rpc('rostro_medidas', { p_modelos: unicos.map((x) => x.modelo) })
  const porModelo = new Map(((med ?? []) as { modelo: string; formato: string | null; talle: Marco['talle']; ancho_mm: number | null; alto_mm: number | null }[]).map((m) => [m.modelo, m]))
  return {
    nombre: d.influencer,
    marcos: unicos.map((x) => {
      const m = porModelo.get(x.modelo.toUpperCase().trim())
      return { modelo: x.modelo, foto: x.foto ?? '', precio_desde: x.precio, href: x.href,
        formato: m?.formato ?? null, talle: m?.talle ?? null, ancho_mm: m?.ancho_mm ?? null, alto_mm: m?.alto_mm ?? null, frente: null, para: null }
    }),
  }
}

export default function Rostro({ enSuite = false }: { enSuite?: boolean }) {
  const params = useMemo(() => new URLSearchParams(window.location.search), [])
  const debug = params.has('debug')
  const [paso, setPaso] = useState<Paso>('inicio')
  const [cap, setCap] = useState<Captura | null>(null)
  const [forma, setForma] = useState<Forma | null>(null)
  const [linea, setLinea] = useState<Linea | null>(null)
  const [probar, setProbar] = useState<Estilo | null>(null)
  const [marcos, setMarcos] = useState<Marco[] | null>(null)
  const [scrolled, setScrolled] = useState(false)
  const [perfil, setPerfil] = useState<Perfil>(leerPerfil)
  const [calce, setCalce] = useState(false)

  const r = useMemo(() => (cap ? resultado(cap.medidas) : null), [cap])
  // Perfil visual: el resultado del escaneo (la forma detectada, no la que se esté mirando) queda en el celular y,
  // si ya hizo el chequeo visual, se suma a ese informe para la óptica.
  useEffect(() => { if (r) setPerfil(guardarRostro(rostroDe(r, r.forma))) }, [r])
  const dpTarjeta = perfil.vision?.dp ?? null
  const f: Forma | null = forma ?? r?.forma ?? null
  const info = f ? FORMAS[f] : null
  const recomendados = info ? info.si.map((x) => x.e) : []
  const sugeridos = useMemo(() => (marcos && r && f ? marcosParaVos(marcos, r, f) : null), [marcos, r, f])
  const ref = useMemo(() => (params.get('r') ?? '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12) || null, [params])
  const [sel, setSel] = useState<Seleccion | null>(null)
  useEffect(() => { if (ref) cargarSeleccion(ref).then(setSel).catch(() => setSel(null)) }, [ref])
  const deSel = useMemo(() => (sel && r && f ? ordenarSeleccion(sel.marcos, r, f) : null), [sel, r, f])

  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 4)
    window.addEventListener('scroll', on, { passive: true })
    return () => window.removeEventListener('scroll', on)
  }, [])
  useEffect(() => { window.scrollTo({ top: 0 }) }, [paso])
  useEffect(() => {
    if (paso !== 'resultado' || marcos) return
    supabase.rpc('pretest_marcos').then(({ data }) => setMarcos((data as Marco[] | null) ?? []))
  }, [paso, marcos])

  const link = (m: string) => `https://ver.orbitaleyewear.com.ar/modelo/${encodeURIComponent(m)}?desde=rostro${f ? '&rostro=' + f : ''}`
  const lado = { inicio: '', escaneo: 'Paso 1 de 2 · Escaneo', analisis: 'Paso 2 de 2 · Análisis', resultado: 'Tu resultado' }[paso]

  return (
    <div className={'ovl rs' + (enSuite ? ' en-suite' : '')}>
      <div className="wrap">
        <header className={'top' + (scrolled ? ' scrolled' : '')}>
          <div className="brand">
            <div className="logo"><b>ORBITAL</b><span>Estudio de rostro</span></div>
            <span className="side">{lado}</span>
          </div>
        </header>

        {paso === 'inicio' && (
          <section className="step">
            <div className="rs-hero">
              <div>
                <div className="kicker"><ScanFace size={15} />{sel ? <>Te lo comparte <b style={{ marginLeft: 3 }}>{sel.nombre}</b></> : 'Análisis facial con la cámara'}</div>
                <h1>Descubrí qué anteojos le quedan mejor a tu cara.</h1>
                <p>Escaneamos tu rostro con la cámara en 10 segundos: medimos sus proporciones, identificamos su forma y calculamos el ancho de armazón que te corresponde. Después te los probás en vivo.</p>
                <div className="trust"><span><Check size={14} />Gratis</span><span><Check size={14} />Sin registrarte</span><span><Lock size={14} />Tu imagen no sale del celular</span></div>
              </div>
              <div className="rs-demo" aria-hidden>
                <svg viewBox="0 0 200 220">
                  <defs><linearGradient id="rs-dg" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#d6b26e" stopOpacity="0" /><stop offset="1" stopColor="#d6b26e" stopOpacity=".5" /></linearGradient></defs>
                  <path d="M100 20C140 20 160 55 160 100C160 150 135 195 100 195C65 195 40 150 40 100C40 55 60 20 100 20Z" fill="none" stroke="#17171c" strokeWidth="2" strokeDasharray="3 4" />
                  {Array.from({ length: 70 }, (_, k) => {
                    const a = (k * 137.5 * Math.PI) / 180, rr = Math.sqrt(k / 70)
                    return <circle key={k} cx={100 + Math.cos(a) * rr * 52} cy={108 + Math.sin(a) * rr * 74} r="1.3" fill="#8f6a34" opacity=".55" />
                  })}
                  <line x1="42" x2="158" y1="102" y2="102" stroke="#8f6a34" strokeWidth="1.5" />
                  <line x1="60" x2="140" y1="58" y2="58" stroke="#8f6a34" strokeWidth="1.5" />
                  <line x1="62" x2="138" y1="152" y2="152" stroke="#8f6a34" strokeWidth="1.5" />
                  <rect className="sweep" x="30" y="0" width="140" height="26" fill="url(#rs-dg)" />
                  <g transform="translate(100,100)"><path d="M-56 -4h20q4 0 4 4v8q0 9-12 9h-6q-10 0-10-9zM56 -4h-20q-4 0-4 4v8q0 9 12 9h6q10 0 10-9zM-32 0q32-8 64 0" fill="none" stroke="#17171c" strokeWidth="3" strokeLinejoin="round" /></g>
                </svg>
              </div>
            </div>

            <div className="needs">
              <div><Sun size={22} /><b>Buena luz</b>De frente, sin contraluz ni sombras fuertes.</div>
              <div><Glasses size={22} /><b>Sin anteojos</b>Y con el pelo atrás, que se vea la frente.</div>
              <div><Smartphone size={22} /><b>A la altura de los ojos</b>Celular derecho, a unos 40 cm.</div>
            </div>

            <div className="card">
              <h3 style={{ marginBottom: 10 }}>Qué vas a obtener</h3>
              <ul className="tests">
                <li><span className="n">1</span><span>Forma de tu rostro</span><small>7 tipos</small></li>
                <li><span className="n">2</span><span>Medidas en milímetros y tu talle</span><small>S · M · L</small></li>
                <li><span className="n">3</span><span>Formas de armazón que te favorecen</span><small>y por qué</small></li>
                <li><span className="n">4</span><span>Probador de formas en vivo</span><small>7 estilos</small></li>
                <li><span className="n">5</span><span>Modelos Orbital a tu medida</span><small>con stock</small></li>
              </ul>
            </div>

            <button className="btn block" onClick={() => setPaso('escaneo')}><ScanFace size={18} />Escanear mi rostro</button>
            <div className="disclaimer"><ShieldCheck size={16} /><span>La imagen se procesa en tu dispositivo y no se guarda ni se envía; solo las medidas quedan en tu celular para sumarlas a tu chequeo visual. Es una guía de estilo y talle: las medidas son aproximadas (±5 mm) y conviene confirmarlas en la óptica.</span></div>
          </section>
        )}

        {paso === 'escaneo' && (
          <section className="step">
            <div>
              <h2>Mirá a la cámara, de frente</h2>
              <p className="muted small" style={{ margin: 0 }}>Expresión neutra, boca cerrada. La captura es automática cuando todo está en verde.</p>
            </div>
            <Escaneo onListo={(c) => { setCap(c); setForma(null); setPaso('analisis') }} />
            <button className="link" onClick={() => setPaso('inicio')}>Volver</button>
          </section>
        )}

        {paso === 'analisis' && cap && r && <Analizando cap={cap} r={r} onFin={() => setPaso('resultado')} />}

        {paso === 'resultado' && cap && r && f && info && (
          <section className="step">
            <div>
              <div className="kicker"><Sparkles size={15} />Tu análisis</div>
              <h1 className="rs-titulo">Tu rostro es <em>{info.nombre.toLowerCase()}</em></h1>
              <p>{info.rasgos}</p>
              {forma && forma !== r.forma && <p className="muted small" style={{ marginTop: -6 }}>Elegiste ver {info.nombre.toLowerCase()} · el escaneo dio {FORMAS[r.forma].nombre.toLowerCase()}. <button className="link" onClick={() => setForma(null)}>Volver al resultado</button></p>}
            </div>

            <div className="card rs-mapcard">
              <MapaRostro cap={cap} r={r} sel={linea} />
              <div className="rs-tabs" role="tablist" aria-label="Medidas">
                {LINEAS.map((l) => (
                  <button key={l.id} role="tab" aria-selected={linea === l.id} className={linea === l.id ? 'sel' : ''} onClick={() => setLinea(linea === l.id ? null : l.id)}>
                    <small>{l.t}</small><b className="num">{r.mm[l.id]} mm</b>
                  </button>
                ))}
              </div>
            </div>

            <div className="card">
              <div className="rs-h"><h3>Cómo se compone tu rostro</h3><small className="muted">Tocá una forma para ver sus recomendaciones</small></div>
              <div className="rs-bars">
                {[...ORDEN].sort((a, b) => r.pct[b] - r.pct[a]).map((k) => (
                  <button key={k} className={(k === f ? 'sel' : '') + (k === r.forma ? ' top' : '')} onClick={() => setForma(k === r.forma ? null : k)} aria-pressed={k === f}>
                    <Silueta f={k} />
                    <span className="nm">{FORMAS[k].nombre}</span>
                    <span className="bar"><i style={{ width: `${Math.max(2, r.pct[k])}%` }} /></span>
                    <span className="num pc">{r.pct[k]}%</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="card">
              <div className="rs-h"><h3>Tu talle de armazón</h3><span className="rs-talle">{r.talle}</span></div>
              <p className="small" style={{ margin: '0 0 14px' }}>Buscá un frente de <b className="num">{r.rango[0]}–{r.rango[1]} mm</b> de ancho (lo dice la ficha del modelo o el óptico). Ideal: <b className="num">{r.ideal} mm</b>, el ancho de tu cara de sien a sien.</p>
              <div className="rs-regla" aria-hidden>
                {(() => {
                  const a = 126, b = 162, pos = (v: number) => `${((Math.min(b, Math.max(a, v)) - a) / (b - a)) * 100}%`
                  return (
                    <>
                      <div className="track">
                        <i className="z s" style={{ left: 0, width: pos(135.5) }} />
                        <i className="z m" style={{ left: pos(135.5), width: `calc(${pos(144.5)} - ${pos(135.5)})` }} />
                        <i className="z l" style={{ left: pos(144.5), right: 0 }} />
                        <i className="band" style={{ left: pos(r.rango[0]), width: `calc(${pos(r.rango[1])} - ${pos(r.rango[0])})` }} />
                        <i className="pin" style={{ left: pos(r.ideal) }}><b className="num">{r.ideal}</b></i>
                      </div>
                      <div className="lbl"><span>S · hasta 135</span><span>M · 136–144</span><span>L · 145 +</span></div>
                    </>
                  )
                })()}
              </div>
              <div className="rs-talles">
                <small className="muted">En la tienda, para tu talle {r.talle}:</small>
                <div>
                  {TALLES_PARA[r.talle].map((t, i) => (
                    <a key={t} className={'btn' + (i ? ' ghost' : '')} href={COLECCION_TALLE[t].url} target="_blank" rel="noopener">
                      {COLECCION_TALLE[t].nombre}{i ? (t === 'XL' ? ' · más presencia' : ' · con presencia') : ''}<ArrowRight size={14} />
                    </a>
                  ))}
                </div>
              </div>
              <div className="rs-mini">
                <div><small>Ancho de rostro</small><b className="num">{r.mm.pomulos} mm</b></div>
                <div><small>Distancia pupilar</small><b className="num">{dpTarjeta ? dpTarjeta.lejos.toFixed(1).replace('.', ',') : '≈ ' + r.mm.dp} mm</b></div>
                <div><small>Proporción</small><b className="num">{(r.prop.largo).toFixed(2).replace('.', ',')}</b></div>
              </div>
              <p className="muted small" style={{ margin: '10px 0 0' }}>{dpTarjeta
                ? <>DP medida con la tarjeta en tu chequeo visual <b className="num">{perfil.vision!.code}</b>: es la que sirve para pedir anteojos con receta.</>
                : <>La DP es aproximada. Para pedir anteojos con receta medila con la tarjeta en el <a href="/lab/pretest?desde=rostro">chequeo visual</a> o en la óptica.</>}</p>
            </div>

            <div className="rs-idea"><Info size={18} /><span>{info.idea}</span></div>

            <div>
              <div className="rs-h"><h3>Formas que te favorecen</h3></div>
              <div className="rs-estilos">
                {info.si.map((x) => (
                  <button key={x.e} className="rs-estilo" onClick={() => setProbar(x.e)}>
                    <span className="ic"><IconoArmazon e={x.e} w={92} /></span>
                    <b>{x.e.charAt(0).toUpperCase() + x.e.slice(1)}</b>
                    <small>{x.por}</small>
                    <span className="go">Probármelo <ArrowRight size={14} /></span>
                  </button>
                ))}
              </div>
            </div>

            <div className="card flat rs-evitar">
              <h3><X size={16} />Mejor evitar</h3>
              {info.no.map((x) => (
                <div key={x.e} className="row" style={{ alignItems: 'center', flexWrap: 'nowrap' }}>
                  <span className="ic"><IconoArmazon e={x.e} w={54} /></span>
                  <span className="small"><b>{x.e.charAt(0).toUpperCase() + x.e.slice(1)}.</b> {x.por}</span>
                </div>
              ))}
              <div className="divider" />
              {info.tips.map((t) => <div key={t} className="small rs-tip"><Check size={14} />{t}</div>)}
            </div>

            <button className="rs-cta" onClick={() => setProbar(recomendados[0])}>
              <span className="ic"><ScanFace size={26} /></span>
              <span><b>Probátelos en vivo</b><small>7 formas, 6 colores y 3 tamaños sobre tu cara. Sacá fotos y comparalas.</small></span>
              <ArrowRight size={20} />
            </button>

            {sel && deSel && (
              <div>
                <div className="rs-h"><h3>La selección de {sel.nombre} para vos</h3><small className="muted">{deSel.van.length ? 'Los que le van a tu cara' : 'Sus anteojos'}</small></div>
                {deSel.van.length === 0 && <p className="muted small" style={{ margin: '0 0 8px' }}>Ninguno cumple justo forma y medida para tu rostro: probátelos en vivo o consultá en tu óptica Orbital.</p>}
                <div className="fgrid">
                  {(deSel.van.length ? deSel.van : deSel.resto).map((m) => <Frame key={m.modelo} m={m} href={m.href} motivos={'motivos' in m ? (m.motivos as string[]) : []} externo={!m.href.startsWith('/')} />)}
                </div>
                {deSel.van.length > 0 && deSel.resto.length > 0 && (
                  <>
                    <div className="rs-h" style={{ marginTop: 14 }}><h3>Más de su selección</h3></div>
                    <div className="fgrid">{deSel.resto.map((m) => <Frame key={m.modelo} m={m} href={m.href} motivos={[]} externo={!m.href.startsWith('/')} />)}</div>
                  </>
                )}
              </div>
            )}

            {!sel && <div>
              <div className="rs-h"><h3>Modelos Orbital para vos</h3><small className="muted">Forma ideal y a tu medida, con stock</small></div>
              {!sugeridos && <div className="empty">Buscando armazones…</div>}
              {sugeridos && sugeridos.length === 0 && <div className="empty">Por ahora no hay modelos con stock que cumplan forma y medida. Consultá en tu óptica Orbital.</div>}
              {sugeridos && sugeridos.length > 0 && (
                <div className="fgrid">
                  {sugeridos.map((m) => <Frame key={m.modelo} m={m} href={link(m.modelo)} motivos={m.motivos} externo />)}
                </div>
              )}
              <p className="muted small" style={{ margin: '8px 0 0' }}>En la página de cada modelo podés probártelo con la cámara en todos sus colores.</p>
            </div>}

            <div className="card rs-perfil">
              <div className="rs-h"><h3>Tu perfil visual</h3><small className="muted">{1 + Number(!!perfil.calces?.length) + Number(!!perfil.vision)} de 3 listos</small></div>
              <ol className="rs-pv">
                <li className="ok"><span><Check size={14} /></span><div><b>Estudio de rostro</b><small>{info.nombre} · talle {r.talle} · {r.ideal} mm</small></div></li>
                {perfil.calces?.length ? (
                  <li className="ok"><span><Check size={14} /></span><div><b>Medición de calce</b><small>{perfil.calces.length} armazón{perfil.calces.length > 1 ? 'es' : ''} medido{perfil.calces.length > 1 ? 's' : ''} · {perfil.calces.map((c) => `${c.modelo} ${c.calce} %`).slice(0, 3).join(' · ')}</small></div></li>
                ) : (
                  <li><span>2</span><div><b>Medición de calce</b><small>1 minuto. Te ponés el armazón y medimos marco vs. rostro y dónde cae tu pupila.</small></div></li>
                )}
                {perfil.vision ? (
                  <li className="ok"><span><Check size={14} /></span><div><b>Chequeo visual <span className="num">{perfil.vision.code}</span></b><small>Le sumamos tu rostro: la óptica ve los dos con ese código.</small></div></li>
                ) : (
                  <li><span>3</span><div><b>Chequeo visual</b><small>10 minutos. Mide tu DP con tarjeta y tu informe sale con estos armazones.</small></div></li>
                )}
              </ol>
              <div className="rs-next">
                <button className={'btn' + (perfil.calces?.length ? ' ghost' : '')} onClick={() => setCalce(true)}><Glasses size={16} />{perfil.calces?.length ? 'Medir otro armazón' : 'Medir el calce'}</button>
                {!perfil.vision && <a className="btn ghost" href="/lab/pretest?desde=rostro"><Eye size={16} />Chequeo visual</a>}
              </div>
              <QRProfesional url={urlPerfil({ c: perfil.vision?.code, ro: compactarRostro(rostroDe(r, r.forma)), ca: compactarCalces(perfil.calces) })} titulo="Para tu óptica"
                texto="Mostrale este código: ve tu forma, tu talle, tus medidas y los armazones que te mediste. Sin foto ni nombre." />
            </div>
            <div className="rs-next">
              <a className="btn" href="/lab/buscar"><MapPin size={16} />Encontrá tu óptica Orbital</a>
              {perfil.vision && <a className="btn ghost" href="/lab/pretest"><Eye size={16} />Repetir el chequeo visual</a>}
            </div>
            <button className="link" onClick={() => { setCap(null); setForma(null); setPaso('escaneo') }}><RotateCcw size={14} />Escanear de nuevo</button>

            {debug && (
              <pre className="ticket">{JSON.stringify({ prop: r.prop, z: z(r.prop), pct: r.pct, mm: r.mm, iris: cap.medidas.iris, k: [cap.medidas.kPom, cap.medidas.kFrente, cap.medidas.kMand] }, (_, v) => (typeof v === 'number' ? Math.round(v * 1000) / 1000 : v), 2)}</pre>
            )}
            <div className="disclaimer"><ShieldCheck size={16} /><span>Guía de estilo y talle basada en proporciones del rostro; no es una indicación médica. Las medidas son aproximadas (±5 mm). Con receta alta, el óptico puede sugerirte un lente más chico para que el cristal quede fino.</span></div>
          </section>
        )}
      </div>
      {calce && <Calce onCerrar={() => { setCalce(false); setPerfil(leerPerfil()) }} />}
      {probar && r && (
        <ProbarFormas ideal={r.ideal} recomendados={recomendados} inicial={probar} onCerrar={() => setProbar(null)} />
      )}
    </div>
  )
}
