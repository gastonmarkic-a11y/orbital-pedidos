// Cámara frontal + MediaPipe Face Landmarker para el Estudio de rostro (todo en el navegador, no se guarda ni se envía).
// ?cara=<url de una foto>: usa esa foto en vez de la cámara (para probar en la compu sin cámara).
import { useEffect, useRef, useState } from 'react'
import type { FaceLandmarker, FaceLandmarkerResult } from '@mediapipe/tasks-vision'

const MP_VERSION = '1.0.1'
const WASM = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}/wasm`
const MODELO = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'

let detector: Promise<FaceLandmarker> | null = null
export function cargarDetector() {
  detector ??= (async () => {
    const { FaceLandmarker, FilesetResolver } = await import('@mediapipe/tasks-vision')
    const fs = await FilesetResolver.forVisionTasks(WASM)
    return FaceLandmarker.createFromOptions(fs, {
      baseOptions: { modelAssetPath: MODELO, delegate: 'GPU' }, runningMode: 'VIDEO', numFaces: 1,
      outputFacialTransformationMatrixes: true,
    })
  })()
  detector.catch(() => { detector = null })
  return detector
}

export type EstadoCam = 'cargando' | 'listo' | 'denegada' | 'error'
export type Fuente = HTMLVideoElement | HTMLImageElement
export const anchoDe = (f: Fuente) => (f instanceof HTMLVideoElement ? f.videoWidth : f.naturalWidth)
export const altoDe = (f: Fuente) => (f instanceof HTMLVideoElement ? f.videoHeight : f.naturalHeight)

/** Abre la cámara (o la foto de prueba) y llama a `cuadro` en cada frame con el resultado del detector. */
export function useCaraEnVivo(
  video: React.RefObject<HTMLVideoElement>, foto: React.RefObject<HTMLImageElement>,
  cuadro: (r: FaceLandmarkerResult, fuente: Fuente) => void, activo = true,
) {
  const [estado, setEstado] = useState<EstadoCam>('cargando')
  const cb = useRef(cuadro)
  cb.current = cuadro
  useEffect(() => {
    if (!activo) return
    let vivo = true, stream: MediaStream | null = null, raf = 0, tmo = 0, alCambiar: (() => void) | null = null
    ;(async () => {
      try {
        const cara = new URLSearchParams(window.location.search).get('cara')
        let fuente: Fuente
        if (cara) {
          const im = foto.current!
          im.crossOrigin = 'anonymous'; im.src = cara; await im.decode()
          fuente = im
        } else {
          try {
            stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 960 } }, audio: false })
          } catch (e) {
            if (vivo) setEstado((e as Error)?.name === 'NotAllowedError' ? 'denegada' : 'error')
            return
          }
          if (!vivo) { stream.getTracks().forEach((t) => t.stop()); return }
          const v = video.current!
          v.srcObject = stream
          await v.play()
          fuente = v
        }
        const det = await cargarDetector()
        if (!vivo) return
        setEstado('listo')
        let ultimo = -1
        const paso = () => {
          if (!vivo) return
          const t = performance.now()
          if (t > ultimo) {
            ultimo = t
            if (anchoDe(fuente) > 0) cb.current(det.detectForVideo(fuente, t), fuente)
          }
          // con la pestaña oculta el navegador frena requestAnimationFrame: seguir con un timer
          cancelAnimationFrame(raf); clearTimeout(tmo)
          if (document.hidden) tmo = window.setTimeout(paso, 60); else raf = requestAnimationFrame(paso)
        }
        alCambiar = () => { cancelAnimationFrame(raf); clearTimeout(tmo); paso() }
        document.addEventListener('visibilitychange', alCambiar)
        paso()
      } catch (e) {
        console.error(e)
        if (vivo) setEstado('error')
      }
    })()
    return () => {
      vivo = false; cancelAnimationFrame(raf); clearTimeout(tmo)
      if (alCambiar) document.removeEventListener('visibilitychange', alCambiar)
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [activo, video, foto])
  return estado
}

/** Luminancia media (0-255) de la fuente, sobre una miniatura. */
export const luz = (() => {
  let cv: HTMLCanvasElement | null = null
  return (f: Fuente) => {
    cv ??= Object.assign(document.createElement('canvas'), { width: 32, height: 24 })
    const c = cv.getContext('2d', { willReadFrequently: true })!
    c.drawImage(f, 0, 0, 32, 24)
    const d = c.getImageData(0, 0, 32, 24).data
    let s = 0
    for (let i = 0; i < d.length; i += 4) s += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
    return s / (d.length / 4)
  }
})()
