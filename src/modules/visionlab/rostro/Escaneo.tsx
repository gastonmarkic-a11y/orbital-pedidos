// Escaneo del rostro: cámara frontal con la malla de MediaPipe encima, chequeos en vivo (de frente, derecho,
// distancia, luz) y captura automática cuando todo está bien durante ~1,5 s (mediana de 36 cuadros).
import { useRef, useState } from 'react'
import { Check, Loader2, Sun } from 'lucide-react'
import { Medidas, P3, Silueta, contorno, medianaMedidas, medir, medirSilueta, postura } from './medidas'
import { altoDe, anchoDe, luz, useCaraEnVivo } from './camara'

export interface Captura {
  medidas: Medidas
  /** Foto del mejor cuadro (sin espejar) y sus landmarks normalizados. */
  foto: string
  lm: P3[]
  W: number; H: number
  /** Borde real de la cara medido en esa foto (null si no se pudo leer). */
  silueta: Silueta | null
}

const N_CAM = 36
// ?cara=<foto>: modo prueba sin cámara; la foto no tiene por qué estar centrada ni de frente
const PRUEBA = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('cara')
const N = PRUEBA ? 6 : N_CAM
type Chequeo = 'cara' | 'centro' | 'distancia' | 'frente' | 'derecho' | 'luz'
const TEXTOS: Record<Chequeo, string> = {
  cara: 'Rostro detectado', centro: 'Centrado', distancia: 'Distancia', frente: 'De frente', derecho: 'Cabeza derecha', luz: 'Buena luz',
}

export default function Escaneo({ onListo }: { onListo: (c: Captura) => void }) {
  const video = useRef<HTMLVideoElement>(null)
  const foto = useRef<HTMLImageElement>(null)
  const lienzo = useRef<HTMLCanvasElement>(null)
  const muestras = useRef<Medidas[]>([])
  const mejor = useRef<{ pen: number; foto: string; lm: P3[]; W: number; H: number; lienzo: HTMLCanvasElement } | null>(null)
  const listo = useRef(false)
  const t0 = useRef(performance.now())
  const nLuz = useRef(0)
  const [ok, setOkEstado] = useState<Record<Chequeo, boolean>>({ cara: false, centro: false, distancia: false, frente: false, derecho: false, luz: true })
  const okRef = useRef(ok)
  // solo re-renderiza cuando cambia algún chequeo (no en cada cuadro)
  const setOk = (f: (o: Record<Chequeo, boolean>) => Record<Chequeo, boolean>) => {
    const n = f(okRef.current)
    if ((Object.keys(n) as Chequeo[]).some((k) => n[k] !== okRef.current[k])) { okRef.current = n; setOkEstado(n) }
  }
  const [aviso, setAviso] = useState('Ubicá tu cara dentro del óvalo')
  const [prog, setProg] = useState(0)

  const estado = useCaraEnVivo(video, foto, (r, fuente) => {
    if (listo.current) return
    const cv = lienzo.current
    if (!cv) return
    const W = anchoDe(fuente), H = altoDe(fuente)
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H }
    const ctx = cv.getContext('2d')!
    ctx.clearRect(0, 0, W, H)
    const lm = r.faceLandmarks?.[0] as P3[] | undefined
    const t = performance.now() - t0.current
    if (!lm) {
      setOk((o) => ({ ...o, cara: false }))
      setAviso('Ubicá tu cara dentro del óvalo')
      return
    }
    // ── chequeos
    const m = medir(lm, W, H)
    const pos = postura(lm, W, H, r.facialTransformationMatrixes?.[0]?.data as number[] | undefined)
    const tam = m.pomulos / Math.min(W, H)
    const n = lm[1]
    if ((nLuz.current++ & 15) === 0) setOk((o) => ({ ...o, luz: luz(fuente) > 55 }))
    const c: Record<Chequeo, boolean> = {
      cara: true,
      centro: PRUEBA || Math.abs(n.x - 0.5) < 0.14 && Math.abs(n.y - 0.5) < 0.18,
      distancia: PRUEBA || (tam > 0.3 && tam < 0.74),
      frente: PRUEBA || Math.abs(pos.yaw) < 7,
      derecho: PRUEBA || Math.abs(pos.roll) < 4.5 && Math.abs(pos.pitch) < 14,
      luz: okRef.current.luz,
    }
    setOk((o) => ({ ...c, luz: o.luz }))
    const todo = c.centro && c.distancia && c.frente && c.derecho
    setAviso(
      !c.centro ? 'Centrá tu cara en el óvalo'
        : !c.distancia && tam <= 0.3 ? 'Acercate un poco' : !c.distancia ? 'Alejate un poco'
        : !c.frente ? 'Mirá de frente a la cámara'
        : !c.derecho ? (Math.abs(pos.roll) >= 4.5 ? 'Enderezá la cabeza' : 'Mantené la cabeza derecha, sin bajar ni subir el mentón')
        : 'Quedate quieto, estamos midiendo…')

    // ── dibujo: puntos de la malla, contorno y barrido
    const col = todo ? '214,178,110' : '255,255,255'
    ctx.fillStyle = `rgba(${col},0.55)`
    const rad = Math.max(1.5, W / 420)
    for (let i = 0; i < 468; i += 2) { const p = lm[i]; ctx.fillRect(p.x * W - rad * 0.7, p.y * H - rad * 0.7, rad * 1.4, rad * 1.4) }
    const con = contorno(lm)
    ctx.beginPath()
    con.puntos.forEach((p, k) => { if (k) ctx.lineTo(p.x * W, p.y * H); else ctx.moveTo(p.x * W, p.y * H) })
    ctx.closePath()
    ctx.strokeStyle = `rgba(${col},0.9)`; ctx.lineWidth = 2 * rad; ctx.stroke()
    // barrido de arriba abajo dentro del contorno
    const top = con.arriba.y * H, bot = con.abajo.y * H
    const y = top + ((t / 1600) % 1) * (bot - top)
    ctx.save(); ctx.clip()
    const g = ctx.createLinearGradient(0, y - 40 * rad, 0, y)
    g.addColorStop(0, `rgba(${col},0)`); g.addColorStop(1, `rgba(${col},0.35)`)
    ctx.fillStyle = g; ctx.fillRect(0, y - 40 * rad, W, 40 * rad)
    ctx.fillStyle = `rgba(${col},0.9)`; ctx.fillRect(0, y - rad, W, 2 * rad)
    ctx.restore()
    // iris
    for (const i of [468, 473]) { ctx.beginPath(); ctx.arc(lm[i].x * W, lm[i].y * H, m.iris / 2, 0, Math.PI * 2); ctx.strokeStyle = `rgba(${col},0.8)`; ctx.lineWidth = rad; ctx.stroke() }

    // ── muestras
    if (!todo) return
    muestras.current.push(m)
    const pen = Math.abs(pos.yaw) + Math.abs(pos.roll) + Math.abs(pos.pitch) * 0.3
    if (!mejor.current || pen < mejor.current.pen) {
      const c2 = document.createElement('canvas'); c2.width = W; c2.height = H
      c2.getContext('2d')!.drawImage(fuente, 0, 0, W, H)
      mejor.current = { pen, foto: c2.toDataURL('image/jpeg', 0.88), lm: lm.map((p) => ({ x: p.x, y: p.y, z: p.z })), W, H, lienzo: c2 }
    }
    setProg(muestras.current.length / N)
    if (muestras.current.length >= N && mejor.current) {
      listo.current = true
      navigator.vibrate?.(30)
      const b = mejor.current
      let silueta: Silueta | null = null
      try { silueta = medirSilueta(b.lienzo.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, b.W, b.H), b.lm) } catch { /* sin silueta: va MALLA */ }
      onListo({ medidas: medianaMedidas(muestras.current), foto: b.foto, lm: b.lm, W: b.W, H: b.H, silueta })
    }
  })

  const R = 46, C = 2 * Math.PI * R
  return (
    <div className="rs-scan">
      <div className="rs-stage">
        <div className="rs-mirror">
          <video ref={video} playsInline muted />
          <img ref={foto} alt="" />
          <canvas ref={lienzo} />
        </div>
        <svg className="rs-guia" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice" aria-hidden>
          <defs><mask id="rs-m"><rect width="100" height="100" fill="#fff" /><ellipse cx="50" cy="48" rx="27" ry="35" fill="#000" /></mask></defs>
          <rect width="100" height="100" fill="rgba(10,10,12,.45)" mask="url(#rs-m)" />
          <ellipse cx="50" cy="48" rx="27" ry="35" fill="none" stroke="rgba(255,255,255,.55)" strokeWidth=".4" strokeDasharray="1.2 1.2" />
        </svg>
        {estado === 'listo' && prog > 0 && (
          <div className="rs-ring" aria-label={`Midiendo ${Math.round(prog * 100)} %`}>
            <svg viewBox="0 0 100 100"><circle cx="50" cy="50" r={R} /><circle cx="50" cy="50" r={R} className="v" style={{ strokeDasharray: C, strokeDashoffset: C * (1 - prog) }} /></svg>
            <b className="num">{Math.round(prog * 100)}%</b>
          </div>
        )}
        <div className="rs-aviso" role="status" aria-live="polite">
          {estado === 'cargando' && <><Loader2 size={16} className="spin" />Preparando la cámara y el detector…</>}
          {estado === 'denegada' && 'No tenemos permiso para usar la cámara. Habilitalo en el candado de la barra del navegador y recargá.'}
          {estado === 'error' && 'No pudimos abrir la cámara en este dispositivo.'}
          {estado === 'listo' && aviso}
        </div>
      </div>
      <div className="rs-checks">
        {(Object.keys(TEXTOS) as Chequeo[]).map((k) => (
          <span key={k} className={ok[k] ? 'on' : ''}>{k === 'luz' && !ok.luz ? <Sun size={13} /> : <Check size={13} />}{k === 'luz' && !ok.luz ? 'Falta luz' : TEXTOS[k]}</span>
        ))}
      </div>
    </div>
  )
}
