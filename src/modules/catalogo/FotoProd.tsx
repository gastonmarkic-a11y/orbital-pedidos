import { useEffect, useState } from 'react'

// Fondo del recuadro = color del borde de la propia foto, así las fotos con
// fondo gris no quedan con bandas blancas a los costados (cada referencia
// trae su fondo). Se mide una vez por URL y queda en memoria.
const FALLBACK = '#F2F2F2' // mismo gris de las tarjetas de orbitaleyewear.com.ar
const cache = new Map<string, string>()
const pendientes = new Map<string, Promise<string>>()

function medir(url: string): Promise<string> {
  if (cache.has(url)) return Promise.resolve(cache.get(url)!)
  if (pendientes.has(url)) return pendientes.get(url)!
  const p = new Promise<string>((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      try {
        const S = 24
        const cv = document.createElement('canvas')
        cv.width = S; cv.height = S
        const g = cv.getContext('2d', { willReadFrequently: true })!
        g.drawImage(img, 0, 0, S, S)
        const d = g.getImageData(0, 0, S, S).data
        // Promedio de los 4 bordes (esquinas + lados), que es fondo casi siempre
        let r = 0, gg = 0, b = 0, n = 0
        for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
          if (x > 1 && x < S - 2 && y > 1 && y < S - 2) continue
          const k = (y * S + x) * 4
          if (d[k + 3] < 200) continue // transparente: no cuenta
          r += d[k]; gg += d[k + 1]; b += d[k + 2]; n++
        }
        const c = n ? `rgb(${Math.round(r / n)},${Math.round(gg / n)},${Math.round(b / n)})` : '#FFFFFF'
        cache.set(url, c); resolve(c)
      } catch { cache.set(url, FALLBACK); resolve(FALLBACK) }
    }
    img.onerror = () => { cache.set(url, FALLBACK); resolve(FALLBACK) }
    img.src = url
  })
  pendientes.set(url, p)
  return p
}

export function useFondoFoto(url?: string | null) {
  const [c, setC] = useState<string>(() => (url && cache.get(url)) || FALLBACK)
  useEffect(() => {
    if (!url) { setC(FALLBACK); return }
    let vivo = true
    medir(url).then((v) => { if (vivo) setC(v) })
    return () => { vivo = false }
  }, [url])
  return c
}

// Recuadro de producto: foto entera (contain) sobre su propio color de fondo
export function FotoProd({ src, alt = '', className = '', imgClassName = '', children, lazy = true }: {
  src?: string | null; alt?: string; className?: string; imgClassName?: string; children?: React.ReactNode; lazy?: boolean
}) {
  const bg = useFondoFoto(src)
  return (
    <div className={`relative overflow-hidden ${className}`} style={{ background: bg, transition: 'background-color .2s' }}>
      {src && <img src={src} alt={alt} crossOrigin="anonymous" loading={lazy ? 'lazy' : undefined} className={`w-full h-full object-contain ${imgClassName}`} />}
      {children}
    </div>
  )
}
