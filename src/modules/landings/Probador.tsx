// Probador virtual de la landing del modelo (/modelo/<MODELO>): cámara frontal + MediaPipe Face Landmarker
// en el navegador (nada sale del celular). La foto de frente del color elegido se recorta del fondo blanco
// y se dibuja sobre la cara: ancho según la distancia entre los ojos, centro en el puente, girada con la cabeza.
import { useEffect, useRef, useState } from 'react'

const MP_VERSION = '1.0.1'
const WASM = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}/wasm`
const MODELO = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'

// Landmarks de MediaPipe Face Mesh: extremos externos de los ojos y puente de la nariz
const OJO_IZQ = 33, OJO_DER = 263, PUENTE = 168
// Ancho del anteojo respecto de la distancia entre los extremos de los ojos
const ANCHO_X_OJOS = 2.05

interface ColorProbador { codigo: string; color: string; fotos: string[] }

// Saca el fondo liso de la foto (relleno desde los bordes, para no agujerear armazones del mismo color) y recorta al anteojo
async function recortarAnteojo(url: string): Promise<HTMLCanvasElement | null> {
  const img = new Image()
  img.crossOrigin = 'anonymous'
  img.src = url.includes('cdn.shopify.com') ? url + (url.includes('?') ? '&' : '?') + 'width=900' : url
  try { await img.decode() } catch { return null }
  const W = img.naturalWidth, H = img.naturalHeight
  const c = document.createElement('canvas'); c.width = W; c.height = H
  const x = c.getContext('2d', { willReadFrequently: true })!
  x.drawImage(img, 0, 0)
  const d = x.getImageData(0, 0, W, H), p = d.data
  // Color del fondo = promedio del borde de la foto (blanco, gris claro…)
  let fr = 0, fg = 0, fb = 0, n = 0
  const sumar = (X: number, Y: number) => { const i = (Y * W + X) * 4; fr += p[i]; fg += p[i + 1]; fb += p[i + 2]; n++ }
  for (let X = 0; X < W; X += 4) { sumar(X, 0); sumar(X, H - 1) }
  for (let Y = 0; Y < H; Y += 4) { sumar(0, Y); sumar(W - 1, Y) }
  fr /= n; fg /= n; fb /= n
  const esFondo = (i: number) =>
    p[i + 3] < 20 || Math.abs(p[i] - fr) + Math.abs(p[i + 1] - fg) + Math.abs(p[i + 2] - fb) < 42
  // La sombra del producto es gris y cambia de a poco: se sigue mientras el paso entre vecinos sea suave;
  // el borde del armazón es un salto brusco y ahí corta.
  const suave = (i: number, j: number) => {
    const r = p[i], g = p[i + 1], b = p[i + 2]
    // gris neutro (no beige/hueso pastel) y no tan lejos del fondo
    return Math.max(r, g, b) - Math.min(r, g, b) < 10 && r + g + b > 450 &&
      Math.abs(r - fr) + Math.abs(g - fg) + Math.abs(b - fb) < 110 &&
      Math.abs(r - p[j]) + Math.abs(g - p[j + 1]) + Math.abs(b - p[j + 2]) < 10
  }
  const visto = new Uint8Array(W * H)
  const pila: number[] = [] // pares [pixel, pixel desde el que se llegó]
  for (let X = 0; X < W; X++) pila.push(X, -1, (H - 1) * W + X, -1)
  for (let Y = 0; Y < H; Y++) pila.push(Y * W, -1, Y * W + W - 1, -1)
  while (pila.length) {
    const de = pila.pop()!, k = pila.pop()!
    if (visto[k]) continue
    if (!esFondo(k * 4) && !(de >= 0 && suave(k * 4, de * 4))) continue
    visto[k] = 1
    p[k * 4 + 3] = 0
    const X = k % W, Y = (k / W) | 0
    if (X > 0) pila.push(k - 1, k)
    if (X < W - 1) pila.push(k + 1, k)
    if (Y > 0) pila.push(k - W, k)
    if (Y < H - 1) pila.push(k + W, k)
  }
  let x0 = W, y0 = H, x1 = 0, y1 = 0
  for (let Y = 0; Y < H; Y++) for (let X = 0; X < W; X++) {
    const i = (Y * W + X) * 4
    if (p[i + 3] === 0) continue
    if (x0 > X) x0 = X; if (x1 < X) x1 = X; if (y0 > Y) y0 = Y; if (y1 < Y) y1 = Y
  }
  if (x1 <= x0 || y1 <= y0) return null
  x.putImageData(d, 0, 0)
  const out = document.createElement('canvas')
  out.width = x1 - x0 + 1; out.height = y1 - y0 + 1
  out.getContext('2d')!.drawImage(c, x0, y0, out.width, out.height, 0, 0, out.width, out.height)
  return out
}

export default function Probador({ modelo, colores, inicial, onCerrar }: {
  modelo: string; colores: ColorProbador[]; inicial: number; onCerrar: () => void
}) {
  const video = useRef<HTMLVideoElement>(null)
  const lienzo = useRef<HTMLCanvasElement>(null)
  const anteojo = useRef<HTMLCanvasElement | null>(null)
  const foto = useRef<HTMLImageElement>(null)
  const conFoto = colores.map((c, i) => ({ c, i })).filter((x) => x.c.fotos.length)
  const [sel, setSel] = useState(conFoto.some((x) => x.i === inicial) ? inicial : conFoto[0]?.i ?? 0)
  const [estado, setEstado] = useState<'cargando' | 'listo' | 'sin-cara' | 'error'>('cargando')

  // Foto del color elegido, ya recortada
  useEffect(() => {
    let vivo = true
    anteojo.current = null
    ;(async () => {
      for (const u of colores[sel]?.fotos ?? []) {
        const a = await recortarAnteojo(u)
        // la foto de frente es más ancha que alta; si no, probar la siguiente
        if (a && a.width > a.height * 1.6) { if (vivo) anteojo.current = a; return }
      }
    })()
    return () => { vivo = false }
  }, [sel, colores])

  // Cámara + detector de cara
  useEffect(() => {
    let vivo = true, stream: MediaStream | null = null, raf = 0
    ;(async () => {
      try {
        const { FaceLandmarker, FilesetResolver } = await import('@mediapipe/tasks-vision')
        const fs = await FilesetResolver.forVisionTasks(WASM)
        const det = await FaceLandmarker.createFromOptions(fs, {
          baseOptions: { modelAssetPath: MODELO, delegate: 'GPU' }, runningMode: 'VIDEO', numFaces: 1,
        })
        // ?cara=<url de una foto>: prueba sin cámara (desarrollo)
        const cara = new URLSearchParams(window.location.search).get('cara')
        const v = video.current!
        let fuente: HTMLVideoElement | HTMLImageElement = v
        if (cara) {
          const im = foto.current!
          im.crossOrigin = 'anonymous'; im.src = cara; await im.decode()
          fuente = im
        } else {
          stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false })
          if (!vivo) return
          v.srcObject = stream
          await v.play()
        }
        setEstado('listo')
        const ancho0 = () => (fuente instanceof HTMLVideoElement ? fuente.videoWidth : fuente.naturalWidth)
        const alto0 = () => (fuente instanceof HTMLVideoElement ? fuente.videoHeight : fuente.naturalHeight)
        const cuadro = () => {
          if (!vivo) return
          const cv = lienzo.current!, ctx = cv.getContext('2d')!
          if (cv.width !== ancho0()) { cv.width = ancho0(); cv.height = alto0() }
          ctx.clearRect(0, 0, cv.width, cv.height)
          const r = det.detectForVideo(fuente, performance.now())
          const lm = r.faceLandmarks?.[0]
          const a = anteojo.current
          if (lm && a) {
            const W = cv.width, H = cv.height
            const iz = lm[OJO_IZQ], de = lm[OJO_DER], pu = lm[PUENTE]
            const dx = (de.x - iz.x) * W, dy = (de.y - iz.y) * H
            const ancho = Math.hypot(dx, dy) * ANCHO_X_OJOS
            const alto = ancho * (a.height / a.width)
            ctx.save()
            ctx.translate(pu.x * W, pu.y * H + alto * 0.08)
            ctx.rotate(Math.atan2(dy, dx))
            ctx.drawImage(a, -ancho / 2, -alto / 2, ancho, alto)
            ctx.restore()
          }
          setEstado((e) => (e === 'error' ? e : lm ? 'listo' : 'sin-cara'))
          raf = requestAnimationFrame(cuadro)
        }
        cuadro()
      } catch (e) {
        console.error(e)
        if (vivo) setEstado('error')
      }
    })()
    return () => { vivo = false; cancelAnimationFrame(raf); stream?.getTracks().forEach((t) => t.stop()) }
  }, [])

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col">
      <div className="flex items-center justify-between px-4 h-14 text-white">
        <span className="font-bold">{modelo} · {colores[sel]?.color}</span>
        <button onClick={onCerrar} className="rounded-full bg-white/15 px-3 py-1.5 text-sm font-semibold">Cerrar</button>
      </div>
      <div className="relative flex-1 overflow-hidden">
        {/* espejo: el video y el dibujo se invierten juntos */}
        <div className="absolute inset-0 -scale-x-100">
          <video ref={video} playsInline muted className="absolute inset-0 w-full h-full object-cover" />
          <img ref={foto} alt="" className="absolute inset-0 w-full h-full object-cover" />
          <canvas ref={lienzo} className="absolute inset-0 w-full h-full object-cover" />
        </div>
        {estado !== 'listo' && (
          <p className="absolute bottom-4 inset-x-4 text-center text-sm text-white bg-black/60 rounded-xl py-2">
            {estado === 'cargando' ? 'Preparando el probador…'
              : estado === 'sin-cara' ? 'Mirá a la cámara, de frente'
              : 'No pude abrir la cámara. Revisá el permiso del navegador.'}
          </p>
        )}
      </div>
      {conFoto.length > 1 && (
        <div className="flex gap-2 overflow-x-auto p-3 bg-black">
          {conFoto.map(({ c, i }) => (
            <button key={c.codigo} onClick={() => setSel(i)} title={c.color}
              className={`shrink-0 w-20 aspect-[4/3] rounded-xl bg-white border-2 overflow-hidden ${i === sel ? 'border-white' : 'border-transparent opacity-70'}`}>
              <img src={c.fotos[0]} alt={c.color} className="w-full h-full object-contain" />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
