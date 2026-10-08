// Orbital Vision Lab · Medición de calce (/lab/calce, también desde el estudio de rostro y el informe del chequeo).
// La versión para celular de la tablet de JINS: te ponés un armazón del catálogo en vivo, a escala real, y la cámara
// mide en cada cuadro el ancho del marco contra el ancho de tu cara (calce %, 100 % = justo) y dónde cae tu pupila
// dentro del lente (% desde el borde de la nariz). HUD con malla facial, cotas y marcas de pupila, como en la tienda.
// Se retroalimenta con las otras dos herramientas del perfil visual:
//  · del estudio de rostro toma la forma (ordena los modelos) y el ancho ideal;
//  · del chequeo visual toma la DP medida con tarjeta (la posición de la pupila sale más precisa);
//  · lo que medís acá se guarda en el perfil, va en el QR para la óptica y marca los armazones del informe.
// Todo en el celular: la imagen no se guarda ni se envía.
import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Crosshair, Glasses, Loader2, MapPin, Ruler, ScanFace, X } from 'lucide-react'
import { supabase } from '../../../lib/supabase'
import type { Marco } from '../marcos'
import { Perfil, PerfilCalce, dpTarjetaDe, guardarCalce, leerPerfil } from '../perfil'
import { BISAGRA_MM, COLORES, Color, PUENTE_MM, dibujar } from './armazon'
import { altoDe, anchoDe, useCaraEnVivo } from './camara'
import { Estilo, IRIS_MM, L, MALLA, P3, afinidadRostro, contorno, estilosDelFormato, perspectivaPomulos, postura } from './medidas'

interface Opcion { modelo: string; ancho: number; estilo: Estilo; foto: string | null; motivo?: string }
interface Lectura { cara: number; dp: number; yaw: number; ok: boolean }

/** Calce = ancho del marco / ancho del rostro. ±3,5 % es "justo" (el mismo ±4 mm del estudio de rostro). */
export const veredicto = (calce: number): PerfilCalce['veredicto'] => (calce > 103.5 ? 'grande' : calce < 96.5 ? 'chico' : 'justo')
/** Dónde cae la pupila en el lente, % desde el borde nasal: con DP/2 desde el centro del puente. */
export function pupilaEnLente(marco: number, dp: number) {
  const a = (marco - PUENTE_MM - 2 * BISAGRA_MM) / 2
  return Math.round(((dp / 2 - PUENTE_MM / 2) / a) * 100)
}
const TXT_VER = { justo: 'Te queda justo', grande: 'Te queda grande', chico: 'Te queda chico' }
const cm = (mm: number) => (mm / 10).toFixed(1).replace('.', ',')

export default function Calce({ onCerrar, inicial }: { onCerrar: () => void; inicial?: string | null }) {
  const video = useRef<HTMLVideoElement>(null)
  const foto = useRef<HTMLImageElement>(null)
  const lienzo = useRef<HTMLCanvasElement>(null)
  const suave = useRef<{ x: number; y: number; giro: number; px: number; yaw: number; cara: number; dp: number } | null>(null)
  const [perfil, setPerfil] = useState<Perfil>(leerPerfil)
  const [marcos, setMarcos] = useState<Marco[] | null>(null)
  const [color, setColor] = useState<Color>(COLORES[0])
  const [lec, setLec] = useState<Lectura | null>(null)
  const [elegido, setElegido] = useState<string | null>(inicial ?? null)
  const [guardado, setGuardado] = useState<string | null>(null)
  const tarjeta = dpTarjetaDe(perfil)
  const dpTarjeta = tarjeta?.lejos ?? null
  const dpCerca = tarjeta?.cerca ?? null

  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    supabase.rpc('pretest_marcos').then(({ data }) => setMarcos((data as Marco[] | null) ?? []))
    return () => { document.body.style.overflow = prev }
  }, [])

  // Modelos: primero "tu talle ideal"; después los del catálogo con medidas, ordenados por el estudio de rostro
  // (forma + ancho) o, sin rostro, por cercanía al ancho de cara que se está midiendo.
  const caraRef = lec?.cara ?? perfil.rostro?.ideal ?? 140
  const opciones = useMemo<Opcion[]>(() => {
    const ideal = perfil.rostro?.ideal ?? Math.round(caraRef)
    const base: Opcion = { modelo: 'Tu talle ideal', ancho: ideal, estilo: 'rectangular', foto: null, motivo: perfil.rostro ? 'Del estudio de rostro' : 'Según tu cara' }
    const cat = (marcos ?? [])
      .filter((m) => m.ancho_mm && estilosDelFormato(m.formato).length)
      .map((m) => {
        const af = perfil.rostro ? afinidadRostro(m, perfil.rostro.ideal, perfil.rostro.forma) : null
        return { m, score: af ? af.score : -Math.abs(m.ancho_mm! - caraRef) / 4, motivo: af?.motivos[0] }
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 14)
      .map(({ m, motivo }) => ({ modelo: m.modelo, ancho: m.ancho_mm!, estilo: estilosDelFormato(m.formato)[0], foto: m.foto || null, motivo }))
    return [base, ...cat]
    // caraRef cambia en cada lectura: el orden se fija con el primer ancho medido
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marcos, perfil.rostro, Math.round(caraRef / 4)])
  const sel = opciones.find((o) => o.modelo === elegido) ?? opciones[0]
  const actual = useRef({ sel, color, dpTarjeta, dpCerca })
  actual.current = { sel, color, dpTarjeta, dpCerca }

  const ultimo = useRef(0)
  const estado = useCaraEnVivo(video, foto, (r, fuente) => {
    const cv = lienzo.current
    if (!cv) return
    const W = anchoDe(fuente), H = altoDe(fuente)
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H }
    const ctx = cv.getContext('2d')!
    ctx.clearRect(0, 0, W, H)
    const lm = r.faceLandmarks?.[0] as P3[] | undefined
    if (!lm) { suave.current = null; if (performance.now() - ultimo.current > 200) { ultimo.current = performance.now(); setLec(null) } return }
    const p = (i: number) => ({ x: lm[i].x * W, y: lm[i].y * H })
    const iD = p(L.irisD), iI = p(L.irisI)
    const iris = (Math.hypot(p(469).x - p(471).x, p(469).y - p(471).y) + Math.hypot(p(474).x - p(476).x, p(474).y - p(476).y)) / 2
    const pos = postura(lm, W, H, r.facialTransformationMatrixes?.[0]?.data as number[] | undefined)
    // Escala: con la DP de la tarjeta, la distancia entre pupilas (≈5× más px que un iris, ±2 %); si no, el iris (±6 %).
    const dpCm = actual.current.dpCerca
    const pxMm = dpCm ? Math.hypot(iD.x - iI.x, iD.y - iI.y) / dpCm : iris / IRIS_MM
    const pD = p(L.pomuloD), pI = p(L.pomuloI)
    const obj = {
      x: (iD.x + iI.x) / 2, y: (iD.y + iI.y) / 2, giro: Math.atan2(iI.y - iD.y, iI.x - iD.x), px: pxMm, yaw: (pos.yaw * Math.PI) / 180,
      cara: (Math.hypot(pD.x - pI.x, pD.y - pI.y) / pxMm) * perspectivaPomulos(lm, W, H) * MALLA, dp: (Math.hypot(iD.x - iI.x, iD.y - iI.y) / pxMm) * 1.03,
    }
    const s = suave.current, k = 0.55
    suave.current = s ? {
      x: s.x + (obj.x - s.x) * k, y: s.y + (obj.y - s.y) * k, giro: s.giro + (obj.giro - s.giro) * k,
      px: s.px + (obj.px - s.px) * 0.15, yaw: s.yaw + (obj.yaw - s.yaw) * k,
      cara: s.cara + (obj.cara - s.cara) * 0.08, dp: s.dp + (obj.dp - s.dp) * 0.08,
    } : obj
    const S = suave.current
    const { sel: o, color: c, dpTarjeta: dpT } = actual.current
    const u = W / 400 // unidad de trazo, independiente de la resolución
    const oro = '#d6b26e'

    // Malla facial tenue (como el escaneo en la tienda)
    ctx.fillStyle = 'rgba(214,178,110,.55)'
    for (let i = 0; i < 468; i += 6) { const q = p(i); ctx.beginPath(); ctx.arc(q.x, q.y, 1.1 * u, 0, 7); ctx.fill() }
    ctx.strokeStyle = 'rgba(214,178,110,.35)'; ctx.lineWidth = 0.8 * u
    ctx.beginPath(); contorno(lm).puntos.forEach((q, j) => { if (j) ctx.lineTo(q.x * W, q.y * H); else ctx.moveTo(q.x * W, q.y * H) }); ctx.closePath(); ctx.stroke()

    // Armazón a escala real
    ctx.save()
    ctx.translate(S.x, S.y); ctx.rotate(S.giro); ctx.scale(Math.max(0.6, Math.cos(S.yaw)), 1); ctx.translate(0, 2.5 * S.px)
    dibujar(ctx, o.estilo, o.ancho, c, S.px)
    // Zona recomendada (como la grilla de JINS): 40–60 % del lente desde la nariz, a la altura de la pupila
    {
      const a = (o.ancho - PUENTE_MM - 2 * BISAGRA_MM) / 2, h = a * 0.36
      ctx.scale(S.px, S.px)
      ctx.lineWidth = 0.35; ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.fillStyle = 'rgba(60,207,142,.14)'
      for (const sg of [-1, 1]) {
        const x0 = sg * (PUENTE_MM / 2 + a * 0.4), x1 = sg * (PUENTE_MM / 2 + a * 0.6)
        const xl = Math.min(x0, x1), w = Math.abs(x1 - x0), y0 = -2.5 - h / 2
        ctx.fillRect(xl, y0, w, h); ctx.strokeRect(xl, y0, w, h)
        ctx.beginPath(); ctx.moveTo(xl + w / 2, y0); ctx.lineTo(xl + w / 2, y0 + h); ctx.moveTo(xl, y0 + h / 2); ctx.lineTo(xl + w, y0 + h / 2); ctx.stroke()
      }
    }
    ctx.restore()

    // Texto: el lienzo está espejado por CSS, así que cada rótulo se des-espeja en su lugar
    const rotulo = (x: number, y: number, t: string, sub?: string) => {
      ctx.save(); ctx.translate(x, y); ctx.scale(-1, 1)
      ctx.font = `800 ${11 * u}px Manrope, system-ui`; ctx.textAlign = 'center'
      const w = Math.max(ctx.measureText(t).width, sub ? ctx.measureText(sub).width * 0.8 : 0) + 12 * u
      const h = sub ? 30 * u : 18 * u
      ctx.fillStyle = 'rgba(11,11,14,.72)'; ctx.beginPath(); ctx.roundRect(-w / 2, -h / 2, w, h, 6 * u); ctx.fill()
      ctx.fillStyle = '#fff'; ctx.fillText(t, 0, sub ? -1 * u : 4 * u)
      if (sub) { ctx.font = `700 ${8 * u}px Manrope, system-ui`; ctx.fillStyle = oro; ctx.fillText(sub, 0, 10 * u) }
      ctx.restore()
    }
    const cota = (a: { x: number; y: number }, b: { x: number; y: number }, col: string) => {
      ctx.strokeStyle = col; ctx.lineWidth = 1.6 * u
      const ang = Math.atan2(b.y - a.y, b.x - a.x), nx = -Math.sin(ang) * 6 * u, ny = Math.cos(ang) * 6 * u
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y)
      ctx.moveTo(a.x - nx, a.y - ny); ctx.lineTo(a.x + nx, a.y + ny); ctx.moveTo(b.x - nx, b.y - ny); ctx.lineTo(b.x + nx, b.y + ny); ctx.stroke()
    }
    // Cota del rostro (pómulo a pómulo)
    cota(pD, pI, 'rgba(255,255,255,.9)')
    rotulo((pD.x + pI.x) / 2, (pD.y + pI.y) / 2 + iris * 3.4, `ROSTRO ${cm(S.cara)} cm`)
    // Cota del marco, arriba del armazón
    const cosG = Math.cos(S.giro), sinG = Math.sin(S.giro), half = (o.ancho / 2) * S.px * Math.max(0.6, Math.cos(S.yaw))
    const yM = -(o.ancho * 0.22) * S.px
    const en = (dx: number, dy: number) => ({ x: S.x + dx * cosG - dy * sinG, y: S.y + dx * sinG + dy * cosG })
    const mA = en(-half, yM), mB = en(half, yM)
    cota(mA, mB, oro)
    const calce = (o.ancho / S.cara) * 100
    rotulo((mA.x + mB.x) / 2, (mA.y + mB.y) / 2 - 20 * u, `MARCO ${cm(o.ancho)} cm`, `${Math.round(calce)} %`)
    // Marcas de pupila: corchetes + cruz, y dónde cae en el lente
    const dp = dpT ?? S.dp
    const pup = pupilaEnLente(o.ancho, dp)
    for (const q of [iD, iI]) {
      const r2 = iris * 1.5
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.6 * u
      for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        ctx.beginPath(); ctx.moveTo(q.x + sx * r2, q.y + sy * r2 * 0.55); ctx.lineTo(q.x + sx * r2, q.y + sy * r2); ctx.lineTo(q.x + sx * r2 * 0.55, q.y + sy * r2); ctx.stroke()
      }
      ctx.strokeStyle = oro; ctx.beginPath(); ctx.moveTo(q.x - 5 * u, q.y); ctx.lineTo(q.x + 5 * u, q.y); ctx.moveTo(q.x, q.y - 5 * u); ctx.lineTo(q.x, q.y + 5 * u); ctx.stroke()
    }
    rotulo(iI.x + iris * 0.2, iI.y - iris * 2.3, `PUPILA ${pup} %`)

    if (performance.now() - ultimo.current > 160) {
      ultimo.current = performance.now()
      setLec({ cara: S.cara, dp: S.dp, yaw: pos.yaw, ok: Math.abs(pos.yaw) < 12 && Math.abs(pos.pitch) < 15 })
    }
  })

  const dp = dpTarjeta ?? lec?.dp ?? null
  const calce = lec ? (sel.ancho / lec.cara) * 100 : null
  const ver = calce !== null ? veredicto(calce) : null
  const pup = dp ? pupilaEnLente(sel.ancho, dp) : null
  const medidos = new Map((perfil.calces ?? []).map((c) => [c.modelo, c]))

  function guardar() {
    if (!lec || calce === null || pup === null || !dp) return
    setPerfil(guardarCalce({
      modelo: sel.modelo, marco: sel.ancho, cara: Math.round(lec.cara), calce: Math.round(calce), pupila: pup,
      dp: Math.round(dp * 10) / 10, veredicto: veredicto(calce),
    }))
    setGuardado(sel.modelo); setTimeout(() => setGuardado(null), 1800)
  }

  return (
    <div className="rs-try ca" role="dialog" aria-label="Medición de calce">
      <div className="rs-try-top">
        <div><b>Medición de calce</b><span>{sel.modelo} · <span className="num">{sel.ancho} mm</span>{dpTarjeta ? ' · DP con tarjeta' : ''}</span></div>
        <button onClick={onCerrar} aria-label="Cerrar"><X size={20} /></button>
      </div>
      <div className="rs-try-stage">
        <div className="rs-mirror">
          <video ref={video} playsInline muted />
          <img ref={foto} alt="" />
          <canvas ref={lienzo} />
        </div>
        <i className="ca-sweep" aria-hidden />
        {lec && calce !== null && ver && (
          <div className={'ca-hud ' + ver}>
            <div className="ca-gauge">
              <svg viewBox="0 0 120 70" aria-hidden>
                <path d="M10 64A50 50 0 0 1 110 64" fill="none" stroke="rgba(255,255,255,.18)" strokeWidth="9" strokeLinecap="round" />
                <path d="M42.9 17A50 50 0 0 1 77.1 17" fill="none" stroke="#3ccf8e" strokeWidth="9" />
                {(() => { const t = Math.max(-1, Math.min(1, (calce - 100) / 15)), a = Math.PI / 2 - t * (Math.PI / 2) * 0.95
                  return <line x1="60" y1="64" x2={60 + Math.cos(a) * 44} y2={64 - Math.sin(a) * 44} stroke="#fff" strokeWidth="3" strokeLinecap="round" /> })()}
                <circle cx="60" cy="64" r="4" fill="#fff" />
              </svg>
              <b className="num">{Math.round(calce)}<small>%</small></b>
              <span>{TXT_VER[ver]}</span>
            </div>
          </div>
        )}
        {(estado !== 'listo' || !lec || !lec.ok) && (
          <p className="rs-try-msg">
            {estado === 'cargando' ? <><Loader2 size={16} className="spin" />Preparando la medición…</>
              : estado === 'denegada' ? 'Necesitamos permiso para usar la cámara.'
              : estado === 'error' ? 'No pudimos abrir la cámara.'
              : !lec ? 'Mirá a la cámara, de frente'
              : 'Mirá derecho a la cámara para medir'}
          </p>
        )}
      </div>
      <div className="rs-try-panel">
        <div className="ca-metricas">
          <div><small><Glasses size={12} />Marco</small><b className="num">{cm(sel.ancho)}<i>cm</i></b></div>
          <div><small><ScanFace size={12} />Rostro</small><b className="num">{lec ? cm(lec.cara) : '—'}<i>cm</i></b></div>
          <div className={pup !== null && (pup < 38 || pup > 62) ? 'alerta' : ''}><small><Crosshair size={12} />Pupila</small><b className="num">{pup ?? '—'}<i>%</i></b></div>
          <div><small><Ruler size={12} />DP</small><b className="num">{dp ? dp.toFixed(1).replace('.', ',') : '—'}<i>mm</i></b></div>
        </div>
        <div className="ca-modelos" role="radiogroup" aria-label="Armazón">
          {opciones.map((o) => {
            const m = medidos.get(o.modelo)
            return (
              <button key={o.modelo} role="radio" aria-checked={sel.modelo === o.modelo} className={sel.modelo === o.modelo ? 'sel' : ''} onClick={() => setElegido(o.modelo)}>
                <span className="ph">{o.foto ? <img src={o.foto} alt="" loading="lazy" /> : <Glasses size={22} />}</span>
                <b>{o.modelo}</b>
                <small className="num">{o.ancho} mm{m ? ` · ${m.calce} %` : ''}</small>
                {m && <i title="Medido"><Check size={10} /></i>}
              </button>
            )
          })}
        </div>
        <div className="rs-try-fila">
          <div className="rs-try-colores" role="radiogroup" aria-label="Color">
            {COLORES.map((c) => (
              <button key={c.id} role="radio" aria-checked={color.id === c.id} aria-label={c.nombre} title={c.nombre}
                className={(color.id === c.id ? 'sel ' : '') + c.id} onClick={() => setColor(c)} style={{ background: c.aro }} />
            ))}
          </div>
          <button className="ca-guardar" onClick={guardar} disabled={!lec?.ok || estado !== 'listo'}>
            {guardado === sel.modelo ? <><Check size={16} />Guardado</> : <><Ruler size={16} />Guardar medición</>}
          </button>
        </div>
        {medidos.has(sel.modelo) && sel.modelo !== 'Tu talle ideal' && (
          <a className="ca-donde" href={`/lab/buscar?m=${encodeURIComponent(sel.modelo)}`}><MapPin size={15} />¿Dónde encuentro el {sel.modelo}? Ópticas que lo tienen</a>
        )}
        <p className="ca-nota">{perfil.calces?.length ? `${perfil.calces.length} medido${perfil.calces.length > 1 ? 's' : ''} en tu perfil visual · ` : ''}Calce ideal 97–103 %. Pupila ideal 40–60 % del lente. Medida aproximada (±5 mm): la confirma la óptica.</p>
      </div>
    </div>
  )
}
