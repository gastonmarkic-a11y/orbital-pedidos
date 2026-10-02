// Orbital Vision Lab: distancia entre pupilas (DP) con una tarjeta apoyada en la frente.
// La tarjeta mide 85,6 mm: en la foto da la escala (mm por píxel) a la altura de la cara, y con eso las pupilas
// detectadas por MediaPipe pasan a milímetros. Sirve para pedir anteojos recetados online y para que la medición de
// distancia de las pruebas sea más precisa (en vez de estimar con el iris).
// - Los bordes de la tarjeta se buscan solos (los cortes verticales más fuertes arriba de las cejas) y la persona
//   los ajusta tocando o arrastrando.
// - Correcciones: la tarjeta está ~12 mm más cerca de la cámara que las pupilas, y al mirar la cámara de cerca los
//   ojos convergen (centro de rotación a 13 mm): la DP de lejos sale un poco más grande que la medida.
// Todo pasa dentro del celular: la foto no se guarda ni se envía.
import { PointerEvent as RPointerEvent, useEffect, useRef, useState } from 'react'
import { Camera, Check, CreditCard, RotateCcw, ScanFace } from 'lucide-react'
import { CARD_MM } from './logic'
import { abrirCamara, cargarDetector, dist, FOCAL_K, IRIS_D, IRIS_I } from './distancia'

export interface DP { lejos: number; cerca: number }

const CEJA_D = 105, CEJA_I = 334
const TARJETA_DELANTE_MM = 12
const ROTACION_MM = 13

interface Captura {
  img: HTMLCanvasElement
  W: number; H: number
  pD: { x: number; y: number }; pI: { x: number; y: number }
  cejaY: number
  ipdPx: number
}

/** Busca los dos bordes verticales de la tarjeta en la franja de la frente (posiciones en px de la foto). */
function bordes(c: Captura): [number, number] {
  const cx = (c.pD.x + c.pI.x) / 2
  const mitad = ((CARD_MM / 63) * c.ipdPx) / 2
  const y0 = Math.max(1, Math.round(c.cejaY - 0.7 * c.ipdPx))
  const y1 = Math.max(y0 + 2, Math.round(c.cejaY - 0.2 * c.ipdPx))
  const x0 = Math.max(1, Math.round(cx - 1.4 * mitad))
  const x1 = Math.min(c.W - 2, Math.round(cx + 1.4 * mitad))
  const ctx = c.img.getContext('2d', { willReadFrequently: true })!
  const d = ctx.getImageData(x0 - 1, y0, x1 - x0 + 2, y1 - y0).data
  const ancho = x1 - x0 + 2
  const lum = (x: number, y: number) => { const i = (y * ancho + x) * 4; return 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2] }
  const fuerza = (x: number) => {
    let s = 0
    for (let y = 0; y < y1 - y0; y++) s += Math.abs(lum(x - x0 + 2, y) - lum(x - x0, y))
    return s
  }
  const mejor = (a: number, b: number, def: number) => {
    let m = def, mv = -1
    for (let x = Math.max(x0 + 1, Math.round(a)); x <= Math.min(x1 - 1, Math.round(b)); x++) { const f = fuerza(x); if (f > mv) { mv = f; m = x } }
    return m
  }
  return [mejor(cx - 1.4 * mitad, cx - 0.65 * mitad, cx - mitad), mejor(cx + 0.65 * mitad, cx + 1.4 * mitad, cx + mitad)]
}

function calcular(c: Captura, xIzq: number, xDer: number): DP {
  const tarjetaPx = Math.abs(xDer - xIzq)
  const f = FOCAL_K * Math.max(c.W, c.H)
  const dTarjeta = (f * CARD_MM) / tarjetaPx
  const dOjos = dTarjeta + TARJETA_DELANTE_MM
  const cerca = ((c.ipdPx * CARD_MM) / tarjetaPx) * (dOjos / dTarjeta)
  const lejos = (cerca * (dOjos + ROTACION_MM)) / dOjos
  return { cerca: Math.round(cerca * 2) / 2, lejos: Math.round(lejos * 2) / 2 }
}

/** Dibujo de cómo apoyar la tarjeta. */
function Ilustracion() {
  return (
    <svg viewBox="0 0 200 130" className="dp-ilus" aria-hidden="true">
      <ellipse cx="100" cy="72" rx="46" ry="54" fill="#f3e6d8" stroke="#17171c" strokeWidth="2" />
      <rect x="62" y="24" width="76" height="34" rx="4" fill="#fff" stroke="#a37a2c" strokeWidth="2.2" />
      <rect x="70" y="32" width="12" height="9" rx="2" fill="#e2c37a" />
      <line x1="62" y1="18" x2="138" y2="18" stroke="#a37a2c" strokeWidth="1.4" />
      <text x="100" y="14" textAnchor="middle" fontSize="9" fontWeight="700" fill="#a37a2c" fontFamily="Manrope,system-ui,sans-serif">85,6 mm</text>
      <path d="M72 64 q10 -5 20 0 M108 64 q10 -5 20 0" fill="none" stroke="#17171c" strokeWidth="2" strokeLinecap="round" />
      <circle cx="82" cy="74" r="4" fill="#17171c" /><circle cx="118" cy="74" r="4" fill="#17171c" />
      <line x1="82" y1="86" x2="118" y2="86" stroke="#a37a2c" strokeWidth="1.4" strokeDasharray="3 2" />
      <text x="100" y="98" textAnchor="middle" fontSize="9" fontWeight="700" fill="#a37a2c" fontFamily="Manrope,system-ui,sans-serif">DP</text>
      <path d="M88 108 q12 7 24 0" fill="none" stroke="#17171c" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

export function MedirDP({ onListo, onSaltear, compacto = false }: { onListo: (dp: DP) => void; onSaltear?: () => void; compacto?: boolean }) {
  const [fase, setFase] = useState<'instr' | 'camara' | 'ajuste' | 'error'>('instr')
  const [error, setError] = useState('')
  const [aviso, setAviso] = useState('Preparando la cámara…')
  const [cap, setCap] = useState<Captura | null>(null)
  const [bx, setBx] = useState<[number, number]>([0, 0])
  const [activo, setActivo] = useState<0 | 1>(0)
  const [manual, setManual] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)
  const sacarYa = useRef(false)
  const lienzo = useRef<HTMLCanvasElement>(null)
  const caja = useRef<HTMLDivElement>(null)

  // Cámara + detector: cuando la cara está quieta y cerca, saca la foto sola.
  useEffect(() => {
    if (fase !== 'camara') return
    let vivo = true, raf = 0, st: MediaStream | null = null
    setManual(false)
    sacarYa.current = false
    const tManual = setTimeout(() => setManual(true), 6000)
    ;(async () => {
      try {
        const cam = await abrirCamara()
        st = cam.st
        if (!vivo) { st.getTracks().forEach((t) => t.stop()); return }
        if (videoRef.current) { videoRef.current.srcObject = st; videoRef.current.play().catch(() => {}) }
        const det = await cargarDetector()
        if (!vivo) { det.close(); return }
        const v = cam.v
        const hist: number[] = []
        let ultimoTs = 0
        const loop = () => {
          if (!vivo) return
          raf = requestAnimationFrame(loop)
          if (v.readyState < 2) return
          let ts = performance.now()
          if (ts <= ultimoTs) ts = ultimoTs + 1
          ultimoTs = ts
          const lm = det.detectForVideo(v, ts).faceLandmarks?.[0]
          const W = v.videoWidth, H = v.videoHeight
          if (!lm || lm.length < 478) { hist.length = 0; setAviso('Mirá a la cámara con la tarjeta en la frente'); return }
          const p = (i: number) => ({ x: lm[i].x * W, y: lm[i].y * H })
          const ipdPx = dist(p(IRIS_D), p(IRIS_I))
          // de cerca (~30-60 cm): las pupilas ocupan al menos el 7,5 % del lado largo del cuadro
          if (ipdPx < Math.max(W, H) * 0.075) { hist.length = 0; setAviso('Acercá un poco el celular'); return }
          hist.push(ipdPx)
          if (hist.length > 12) hist.shift()
          const quieto = hist.length === 12 && Math.max(...hist) / Math.min(...hist) < 1.025
          setAviso(quieto ? 'Sacando la foto…' : 'Quedate quieto, mirando la cámara')
          if (!quieto && !sacarYa.current) return
          const img = document.createElement('canvas')
          img.width = W; img.height = H
          img.getContext('2d', { willReadFrequently: true })!.drawImage(v, 0, 0, W, H)
          const c: Captura = { img, W, H, pD: p(IRIS_D), pI: p(IRIS_I), cejaY: (p(CEJA_D).y + p(CEJA_I).y) / 2, ipdPx }
          vivo = false
          cancelAnimationFrame(raf)
          det.close()
          st?.getTracks().forEach((t) => t.stop())
          const b = bordes(c)
          setCap(c)
          setBx(b)
          setActivo(0)
          setFase('ajuste')
        }
        loop()
      } catch (e) {
        if (!vivo) return
        setError(e instanceof DOMException && e.name === 'NotAllowedError'
          ? 'No diste permiso para usar la cámara.'
          : 'No pudimos usar la cámara en este celular.')
        setFase('error')
      }
    })()
    return () => {
      vivo = false
      clearTimeout(tManual)
      cancelAnimationFrame(raf)
      st?.getTracks().forEach((t) => t.stop())
    }
  }, [fase])

  // Recorte de la foto: frente y ojos, con margen a los costados de la tarjeta.
  const recorte = cap && (() => {
    const cx = (cap.pD.x + cap.pI.x) / 2
    const w = Math.min(cap.W, cap.ipdPx * 3.2)
    const x = Math.min(Math.max(0, cx - w / 2), cap.W - w)
    const y = Math.max(0, cap.cejaY - cap.ipdPx * 1.15)
    const h = Math.min(cap.H - y, cap.ipdPx * 1.75)
    return { x, y, w, h }
  })()

  useEffect(() => {
    if (fase !== 'ajuste' || !cap || !recorte || !lienzo.current) return
    const cv = lienzo.current
    cv.width = Math.round(recorte.w)
    cv.height = Math.round(recorte.h)
    cv.getContext('2d')!.drawImage(cap.img, recorte.x, recorte.y, recorte.w, recorte.h, 0, 0, cv.width, cv.height)
  }, [fase, cap]) // eslint-disable-line react-hooks/exhaustive-deps

  const aPx = (clientX: number) => {
    const r = caja.current!.getBoundingClientRect()
    return recorte!.x + ((clientX - r.left) / r.width) * recorte!.w
  }
  const mover = (e: RPointerEvent, inicio = false) => {
    if (!recorte || (!inicio && e.buttons === 0)) return
    const x = aPx(e.clientX)
    const lado: 0 | 1 = inicio ? (Math.abs(x - bx[0]) <= Math.abs(x - bx[1]) ? 0 : 1) : activo
    if (inicio) { setActivo(lado); (e.target as Element).setPointerCapture?.(e.pointerId) }
    setBx((b) => (lado === 0 ? [Math.min(x, b[1] - 20), b[1]] : [b[0], Math.max(x, b[0] + 20)]))
  }
  const ajustar = (delta: number) => setBx((b) => (activo === 0 ? [b[0] + delta, b[1]] : [b[0], b[1] + delta]))

  const res = cap ? calcular(cap, bx[0], bx[1]) : null
  const raro = !!res && (res.lejos < 52 || res.lejos > 76)
  const pct = (x: number) => (recorte ? `${((x - recorte.x) / recorte.w) * 100}%` : '0')

  return (
    <div className={'dp' + (compacto ? ' compacto' : '')}>
      {fase === 'instr' && (
        <>
          <div className="dp-pasos">
            <Ilustracion />
            <ol>
              <li>Apoyá la tarjeta <b>acostada</b> en la frente, justo arriba de las cejas y centrada.</li>
              <li>Sostené el celular derecho, a unos <b>40 cm</b>, y mirá la cámara (el puntito de arriba).</li>
              <li>Quedate quieto: la foto se saca sola. Después ajustás los bordes de la tarjeta.</li>
            </ol>
          </div>
          <button className="btn block" onClick={() => setFase('camara')}><Camera size={17} />Medir con la cámara</button>
          {onSaltear && <div style={{ textAlign: 'center' }}><button className="link" onClick={onSaltear}>Ahora no</button></div>}
        </>
      )}

      {fase === 'camara' && (
        <>
          <div className="dp-cam">
            <video ref={videoRef} muted playsInline aria-hidden="true" />
            <div className="dp-guia" aria-hidden="true"><span className="t" /><span className="o" /><span className="o d" /></div>
            <div className="dp-aviso" role="status"><ScanFace size={18} />{aviso}</div>
          </div>
          <div className="row" style={{ justifyContent: 'center' }}>
            {manual && <button className="btn sm" onClick={() => { sacarYa.current = true }}><Camera size={15} />Sacar la foto</button>}
            <button className="btn sm ghost" onClick={() => setFase('instr')}>Cancelar</button>
          </div>
        </>
      )}

      {fase === 'ajuste' && cap && recorte && res && (
        <>
          <p className="small" style={{ margin: 0 }}>Mové las dos líneas doradas hasta los <b>bordes de la tarjeta</b> (tocá cerca de una y arrastrala).</p>
          <div className="dp-foto" ref={caja} onPointerDown={(e) => mover(e, true)} onPointerMove={(e) => mover(e)}>
            <canvas ref={lienzo} />
            <i className={'borde' + (activo === 0 ? ' on' : '')} style={{ left: pct(bx[0]) }} />
            <i className={'borde' + (activo === 1 ? ' on' : '')} style={{ left: pct(bx[1]) }} />
            <b className="pupila" style={{ left: pct(cap.pD.x), top: `${((cap.pD.y - recorte.y) / recorte.h) * 100}%` }} />
            <b className="pupila" style={{ left: pct(cap.pI.x), top: `${((cap.pI.y - recorte.y) / recorte.h) * 100}%` }} />
          </div>
          <div className="ajuste">
            <button className="btn ghost sm" onClick={() => ajustar(-1)} aria-label="Mover a la izquierda">−</button>
            <span className="small muted" style={{ flex: 1, textAlign: 'center' }}>Ajuste fino del borde {activo === 0 ? 'izquierdo' : 'derecho'}</span>
            <button className="btn ghost sm" onClick={() => ajustar(1)} aria-label="Mover a la derecha">+</button>
          </div>
          <div className="dp-res">
            <span className="muted small">Tu distancia entre pupilas</span>
            <span className="num big">{res.lejos.toFixed(1).replace('.', ',')} mm</span>
            <span className="muted small">de lejos · {res.cerca.toFixed(1).replace('.', ',')} mm de cerca</span>
          </div>
          {raro && <div className="note">El valor es poco habitual (en adultos suele estar entre 54 y 74 mm). Revisá que las líneas estén en los bordes de la tarjeta o sacá otra foto.</div>}
          <div className="answers2">
            <button className="btn ghost" onClick={() => setFase('camara')}><RotateCcw size={16} />Otra foto</button>
            <button className="btn" onClick={() => onListo(res)}><Check size={16} />Listo</button>
          </div>
        </>
      )}

      {fase === 'error' && (
        <>
          <div className="card flat"><p style={{ margin: 0 }}><CreditCard size={16} style={{ verticalAlign: -3, marginRight: 6 }} />{error} Podés seguir sin esta medición: tu óptica la toma en el local.</p></div>
          <div className="answers2">
            <button className="btn ghost" onClick={() => setFase('instr')}>Probar de nuevo</button>
            {onSaltear && <button className="btn" onClick={onSaltear}>Seguir</button>}
          </div>
        </>
      )}
      <div className="note">La cámara se usa solo dentro de tu celular: la foto no se guarda ni se envía.</div>
    </div>
  )
}
