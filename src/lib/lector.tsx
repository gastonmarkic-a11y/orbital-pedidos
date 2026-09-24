import { useEffect, useRef, useState } from 'react'

// Lector de códigos de barras con la cámara (etiqueta del anteojo = SKU). Lo usan el escaneo
// en la óptica, el pickeo de depósito y la confirmación de ingresos de producción.

type Detector = { detect: (src: HTMLVideoElement) => Promise<{ rawValue: string }[]> }

const FORMATOS = ['code_128', 'code_39', 'code_93', 'ean_13', 'ean_8', 'itf', 'qr_code', 'data_matrix']

// Chrome/Android trae BarcodeDetector nativo; en iPhone se usa el lector en wasm.
export async function crearDetector(): Promise<Detector> {
  const Nativo = (window as unknown as { BarcodeDetector?: { new (o: { formats: string[] }): Detector; getSupportedFormats(): Promise<string[]> } }).BarcodeDetector
  if (Nativo) {
    const sop = await Nativo.getSupportedFormats()
    const f = FORMATOS.filter((x) => sop.includes(x))
    if (f.includes('code_128')) return new Nativo({ formats: f })
  }
  const { BarcodeDetector } = await import('barcode-detector/ponyfill')
  return new BarcodeDetector({ formats: FORMATOS as never }) as unknown as Detector
}

// Un QR puede traer una URL: se queda con el último tramo.
export const limpiarCodigo = (raw: string) => raw.trim().split(/[/?#=]/).filter(Boolean).pop()?.toUpperCase() ?? ''

export function pitido(ok: boolean) {
  try {
    const ctx = new AudioContext()
    const o = ctx.createOscillator()
    o.frequency.value = ok ? 1200 : 300
    o.connect(ctx.destination)
    o.start()
    o.stop(ctx.currentTime + (ok ? 0.12 : 0.35))
    navigator.vibrate?.(ok ? 60 : [80, 60, 80])
  } catch { /* sin audio */ }
}

// Cámara con lectura continua. onCodigo recibe el código ya limpio; el mismo código pegado
// a la cámara se ignora 2,5 s para no sumar de más.
export function LectorCamara({ onCodigo, onCerrar }: { onCodigo: (cod: string) => void | Promise<void>; onCerrar: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const ultimo = useRef<{ cod: string; t: number }>({ cod: '', t: 0 })
  const cb = useRef(onCodigo)
  cb.current = onCodigo
  const [error, setError] = useState('')

  useEffect(() => {
    let stream: MediaStream | null = null
    let vivo = true
    let timer: number | undefined
    ;(async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 } }, audio: false })
        if (!vivo) return
        const v = videoRef.current!
        v.srcObject = stream
        await v.play()
        const det = await crearDetector()
        const leer = async () => {
          if (!vivo) return
          try {
            if (v.readyState >= 2) {
              const raw = (await det.detect(v))[0]?.rawValue
              if (raw) {
                const c = limpiarCodigo(raw)
                const ahora = Date.now()
                if (c && (c !== ultimo.current.cod || ahora - ultimo.current.t > 2500)) {
                  ultimo.current = { cod: c, t: ahora }
                  await cb.current(c)
                }
              }
            }
          } catch { /* cuadro sin lectura */ }
          timer = window.setTimeout(leer, 250)
        }
        leer()
      } catch {
        setError('No pude abrir la cámara. Dale permiso en el navegador o escribí el código abajo.')
      }
    })()
    return () => {
      vivo = false
      clearTimeout(timer)
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [])

  if (error) return <p className="text-xs text-red-700">{error}</p>
  return (
    <div className="relative rounded-xl overflow-hidden bg-black">
      <video ref={videoRef} playsInline muted className="w-full aspect-[4/3] object-cover" />
      <div className="absolute inset-x-8 top-1/2 -translate-y-1/2 h-20 border-2 border-white/80 rounded-lg pointer-events-none" />
      <button onClick={onCerrar} className="absolute top-2 right-2 text-xs bg-black/60 text-white rounded-full px-3 py-1">Pausar</button>
    </div>
  )
}
