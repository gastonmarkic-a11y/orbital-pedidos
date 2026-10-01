// Orbital Vision Lab: medición de distancia con la cámara frontal (MediaPipe Face Landmarker, todo dentro del
// celular: las imágenes no se guardan ni se envían). Distancia = foco × distancia entre pupilas / pupilas en px.
// - La distancia entre pupilas de cada persona se mide de cerca contra el iris (≈ 11,7 mm en todos los adultos),
//   así no depende de un promedio. El foco de la cámara frontal se estima (≈ 24 mm equivalentes): error ±10-15 %.
// - A 3 m la cara ocupa pocos píxeles: se sigue la cara y se recorta alrededor para que el detector la encuentre.
// - Guía por voz (speechSynthesis): "un paso más para atrás", "listo, quedate ahí".
import { useEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Check, HelpCircle, Ruler, ScanFace } from 'lucide-react'
import { ComoSeHace } from './ayuda'
import { hablar } from './voz'

const MP_VERSION = '1.0.1'
const WASM = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}/wasm`
const MODELO = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'

// Landmarks: centro de cada iris, anillo del iris (4 puntos por ojo), sienes y puente de la nariz
const IRIS_D = 468, IRIS_I = 473, ANILLO_D = [469, 470, 471, 472], ANILLO_I = [474, 475, 476, 477]
const SIEN_D = 234, SIEN_I = 454, PUENTE = 168
const IRIS_MM = 11.7
const IPD_PROMEDIO = 63
// Foco en px = K × lado largo del video (cámara frontal ≈ 24 mm equivalentes ≈ 72° sobre el lado largo).
const FOCAL_K = 0.7
const CROP = 384

export type EstadoCam = 'apagada' | 'cargando' | 'sin-cara' | 'midiendo' | 'denegada' | 'error'
export interface Distancia { estado: EstadoCam; mm: number | null; stream: MediaStream | null }

type P = { x: number; y: number }
const dist = (a: P, b: P) => Math.hypot(a.x - b.x, a.y - b.y)
const mediana = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)] }

/** Prende la cámara frontal mientras `activo` y devuelve la distancia ojos-pantalla suavizada (mm). */
export function useDistancia(activo: boolean): Distancia {
  const [estado, setEstado] = useState<EstadoCam>('apagada')
  const [mm, setMm] = useState<number | null>(null)
  const [stream, setStream] = useState<MediaStream | null>(null)

  useEffect(() => {
    if (!activo) { setEstado('apagada'); setMm(null); return }
    let vivo = true, raf = 0, st: MediaStream | null = null
    setEstado('cargando')
    ;(async () => {
      try {
        st = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false })
        if (!vivo) { st.getTracks().forEach((t) => t.stop()); return }
        setStream(st)
        const v = document.createElement('video')
        v.muted = true; v.playsInline = true; v.srcObject = st
        await v.play()
        const { FaceLandmarker, FilesetResolver } = await import('@mediapipe/tasks-vision')
        const fs = await FilesetResolver.forVisionTasks(WASM)
        const det = await FaceLandmarker.createFromOptions(fs, {
          baseOptions: { modelAssetPath: MODELO, delegate: 'GPU' }, runningMode: 'VIDEO', numFaces: 1,
        })
        if (!vivo) { det.close(); return }
        const cv = document.createElement('canvas')
        cv.width = cv.height = CROP
        const ctx = cv.getContext('2d')!

        // seguimiento: centro y ancho de la cara en px del video (null = buscar en todo el cuadro)
        let track: { cx: number; cy: number; ancho: number } | null = null
        let fallas = 0, barrido = 0, cuadroN = 0, ultimoTs = 0
        const ratios: number[] = []
        let ipdMm: number | null = null
        const lecturas: number[] = []

        const loop = () => {
          if (!vivo) return
          raf = requestAnimationFrame(loop)
          if (++cuadroN % 2 || v.readyState < 2) return // ~15 cuadros por segundo alcanzan
          const W = v.videoWidth, H = v.videoHeight, corto = Math.min(W, H)
          let ts = performance.now()
          if (ts <= ultimoTs) ts = ultimoTs + 1
          ultimoTs = ts

          // ¿Recorte (cara chica: lejos) o cuadro completo?
          let x0 = 0, y0 = 0, lado = 0
          if (track && track.ancho * 3.5 < corto * 0.9) lado = Math.max(160, track.ancho * 3.5)
          else if (!track && barrido++ % 2) {
            // sin cara: alternar cuadro completo con recortes de una grilla 3×3 (por si está lejos)
            const k = Math.floor(barrido / 2) % 9
            lado = corto * 0.5
            track = null
            x0 = ((k % 3) / 2) * (W - lado)
            y0 = (Math.floor(k / 3) / 2) * (H - lado)
          }
          if (lado && track) {
            x0 = Math.min(Math.max(0, track.cx - lado / 2), W - lado)
            y0 = Math.min(Math.max(0, track.cy - lado / 2), H - lado)
          }

          let r
          if (lado) {
            ctx.drawImage(v, x0, y0, lado, lado, 0, 0, CROP, CROP)
            r = det.detectForVideo(cv, ts)
          } else r = det.detectForVideo(v, ts)
          const lm = r.faceLandmarks?.[0]
          if (!lm || lm.length < 478) {
            if (++fallas > 8) { track = null; lecturas.length = 0; setEstado('sin-cara'); setMm(null) }
            return
          }
          fallas = 0
          const px = (i: number): P => lado ? { x: x0 + lm[i].x * lado, y: y0 + lm[i].y * lado } : { x: lm[i].x * W, y: lm[i].y * H }
          track = { cx: px(PUENTE).x, cy: px(PUENTE).y, ancho: dist(px(SIEN_D), px(SIEN_I)) }

          const ipdPx = dist(px(IRIS_D), px(IRIS_I))
          // Distancia entre pupilas propia: de cerca (iris ≥ 14 px), contra el diámetro del iris.
          if (ipdMm === null) {
            const iris = (a: number[]) => (dist(px(a[0]), px(a[2])) + dist(px(a[1]), px(a[3]))) / 2
            const irisPx = (iris(ANILLO_D) + iris(ANILLO_I)) / 2
            if (irisPx >= 14) ratios.push(ipdPx / irisPx)
            if (ratios.length >= 20) ipdMm = Math.min(72, Math.max(54, mediana(ratios) * IRIS_MM))
          }
          const d = (FOCAL_K * Math.max(W, H) * (ipdMm ?? IPD_PROMEDIO)) / ipdPx
          lecturas.push(d)
          if (lecturas.length > 7) lecturas.shift()
          setMm(Math.round(mediana(lecturas)))
          setEstado('midiendo')
        }
        loop()
      } catch (e) {
        console.error(e)
        if (vivo) setEstado(e instanceof DOMException && e.name === 'NotAllowedError' ? 'denegada' : 'error')
      }
    })()
    return () => {
      vivo = false
      cancelAnimationFrame(raf)
      st?.getTracks().forEach((t) => t.stop())
      setStream(null)
    }
  }, [activo])

  return { estado, mm, stream }
}

type Posicion = 'cerca' | 'lejos' | 'ok' | 'nadie'
const posicion = (mm: number | null, objetivo: number, tol: number): Posicion =>
  mm === null ? 'nadie' : mm < objetivo * (1 - tol) ? 'cerca' : mm > objetivo * (1 + tol) ? 'lejos' : 'ok'

const fmt = (mm: number) => (mm >= 1000 ? `${(mm / 1000).toFixed(1).replace('.', ',')} m` : `${Math.round(mm / 10)} cm`)

/** Qué decir: a 3 m se mueve la persona; de cerca se mueve el celular. */
function frase(p: Posicion, mm: number | null, objetivo: number): string {
  const lejos = objetivo >= 2000
  const dif = mm === null ? 0 : Math.abs(objetivo - mm)
  if (p === 'nadie') return lejos ? 'No te veo. Mirá hacia el celular.' : 'No veo tu cara. Mirá la pantalla.'
  if (p === 'cerca') return lejos ? (dif > 800 ? 'Seguí alejándote.' : dif > 300 ? 'Un paso más para atrás.' : 'Un poquito más atrás.') : 'Alejá un poco el celular.'
  if (p === 'lejos') return lejos ? (dif > 600 ? 'Acercate un paso.' : 'Un poquito más adelante.') : 'Acercá un poco el celular.'
  return 'Listo, quedate ahí.'
}

/** Cámara en espejo (para encuadrarse antes de alejarse). */
function Espejo({ stream }: { stream: MediaStream | null }) {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    if (ref.current && stream) { ref.current.srcObject = stream; ref.current.play().catch(() => {}) }
  }, [stream])
  return <video ref={ref} className="espejo" muted playsInline aria-hidden="true" />
}

/**
 * Pantalla de ubicación: guía (voz + flechas) hasta quedar a la distancia pedida y la confirma cuando se sostiene
 * 1,2 s dentro de la tolerancia. Devuelve la distancia medida para dibujar las letras a la medida exacta.
 */
export function Ubicarse({ d, objetivo, tol, onListo, onManual }: {
  d: Distancia; objetivo: number; tol: number; onListo: (mm: number) => void; onManual: () => void
}) {
  const p = posicion(d.mm, objetivo, tol)
  const desde = useRef<number | null>(null)
  const dicho = useRef<{ t: string; at: number }>({ t: '', at: 0 })
  const sinCara = useRef<number>(performance.now())
  const mmRef = useRef(d.mm)
  mmRef.current = d.mm

  useEffect(() => {
    if (d.estado !== 'midiendo' && d.estado !== 'sin-cara') return
    const ahora = performance.now()
    if (p === 'nadie') { if (ahora - sinCara.current < 2500) return } else sinCara.current = ahora
    if (p === 'ok') {
      desde.current ??= ahora
      if (ahora - desde.current >= 1200 && mmRef.current) { hablar(frase('ok', null, objetivo)); onListo(mmRef.current) }
      return
    }
    desde.current = null
    const t = frase(p, d.mm, objetivo)
    const ult = dicho.current
    if ((t !== ult.t && ahora - ult.at > 1800) || ahora - ult.at > 4000) { hablar(t); dicho.current = { t, at: ahora } }
  })

  // Re-evaluar aunque el número no cambie (para cumplir los 1,2 s quieto)
  const [, tic] = useState(0)
  useEffect(() => { const i = setInterval(() => tic((n) => n + 1), 300); return () => clearInterval(i) }, [])

  const [verAyuda, setVerAyuda] = useState(false)
  const lejos = objetivo >= 2000
  const fallo = d.estado === 'denegada' || d.estado === 'error'
  return (
    <section className="step">
      <div>
        <h2>{lejos ? 'Alejate hasta que te diga “listo”' : `Ubicá el celular a ${fmt(objetivo)}`}</h2>
        <p>{lejos
          ? 'Apoyá el celular a la altura de tus ojos (contra un libro o una taza), con la pantalla hacia vos. Mirándolo, caminá despacio para atrás: el celular mide la distancia y te avisa en voz alta cuándo frenar.'
          : 'Sostené el celular frente a tu cara con el brazo estirado. Te avisamos si tenés que acercarlo o alejarlo.'}</p>
      </div>
      {fallo ? (
        <div className="card">
          <p style={{ margin: 0 }}>{d.estado === 'denegada'
            ? 'No diste permiso para usar la cámara. Podés medir la distancia vos (con un metro o contando pasos).'
            : 'No pudimos usar la cámara en este celular. Podés medir la distancia vos (con un metro o contando pasos).'}</p>
        </div>
      ) : (
        <div className={'medir ' + p}>
          <Espejo stream={d.stream} />
          <div className="lectura">
            <span className="num big">{d.mm ? fmt(d.mm) : '—'}</span>
            <span className="obj"><Ruler size={14} />Objetivo {fmt(objetivo)}</span>
          </div>
          <div className="aviso">
            {d.estado === 'cargando' ? <><ScanFace size={22} />Preparando la cámara…</>
              : p === 'ok' ? <><Check size={22} />Listo, quedate ahí</>
              : p === 'nadie' ? <><ScanFace size={22} />{lejos ? 'Mirá hacia el celular' : 'Mirá la pantalla'}</>
              : p === 'cerca' ? <><ArrowDown size={22} />{lejos ? 'Más para atrás' : 'Alejá el celular'}</>
              : <><ArrowUp size={22} />{lejos ? 'Más para adelante' : 'Acercá el celular'}</>}
          </div>
        </div>
      )}
      {lejos && (verAyuda
        ? <ComoSeHace />
        : <div style={{ textAlign: 'center' }}><button className="link" onClick={() => setVerAyuda(true)}><HelpCircle size={15} />Ver cómo se hace</button></div>)}
      <div className="note">La cámara se usa solo dentro de tu celular para medir la distancia: las imágenes no se guardan ni se envían.</div>
      <div style={{ textAlign: 'center' }}>
        <button className="link" onClick={onManual}>{fallo ? 'Seguir midiendo yo la distancia' : 'Prefiero medir yo la distancia'}</button>
      </div>
    </section>
  )
}

/**
 * Indicador durante la prueba: muestra la distancia y avisa (y, a 3 m, lo dice en voz alta) si se corrió.
 * Si no ve la cara (por ejemplo, con un ojo tapado) no molesta.
 */
export function Indicador({ d, objetivo, tol }: { d: Distancia; objetivo: number; tol: number }) {
  const p = posicion(d.mm, objetivo, tol)
  const lejos = objetivo >= 2000
  const fuera = useRef<number | null>(null)
  const dicho = useRef(0)
  useEffect(() => {
    if (!lejos) return
    // Si volvió al celular (a menos de la mitad) es para tocar: no insistir con "volvé a tu lugar".
    if (d.mm !== null && d.mm < objetivo * 0.5) { fuera.current = null; return }
    const ahora = performance.now()
    if (p === 'cerca' || p === 'lejos') {
      fuera.current ??= ahora
      if (ahora - fuera.current > 2000 && ahora - dicho.current > 5000) {
        hablar(p === 'cerca' ? 'Volvé a tu lugar: un poco más atrás.' : 'Volvé a tu lugar: un poco más adelante.')
        dicho.current = ahora
      }
    } else fuera.current = null
  })
  if (d.estado === 'apagada' || d.estado === 'denegada' || d.estado === 'error') return null
  const txt = d.estado === 'cargando' ? 'Midiendo distancia…'
    : p === 'nadie' ? `Objetivo ${fmt(objetivo)}`
    : p === 'ok' ? `${fmt(d.mm!)} · bien`
    : p === 'cerca' ? `${fmt(d.mm!)} · ${lejos ? 'alejate un poco' : 'alejá el celular'}`
    : `${fmt(d.mm!)} · ${lejos ? 'acercate un poco' : 'acercá el celular'}`
  return (
    <div className={'distpill ' + (p === 'ok' ? 'ok' : p === 'nadie' ? '' : 'mal')} role="status">
      {p === 'ok' ? <Check size={14} /> : p === 'cerca' ? <ArrowDown size={14} /> : p === 'lejos' ? <ArrowUp size={14} /> : <Ruler size={14} />}
      <span className="num">{txt}</span>
    </div>
  )
}
