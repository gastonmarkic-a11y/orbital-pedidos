// Foto del anteojo para la consigna: la imagen del producto o, si no hay o no carga, un dibujo
// de anteojo en el color del marco. `Miniatura` es la versión chica para filas y listas.
import { useState } from 'react'
import { colorSwatch } from '../catalogo/colorLegible'

export function FotoAnteojo({ src, alt, color }: { src: string | null | undefined; alt: string; color?: string | null }) {
  const [rota, setRota] = useState(false)
  if (src && !rota) return <img src={src} alt={alt} loading="lazy" onError={() => setRota(true)} className="w-full h-full object-contain" />
  return (
    <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-[#F0EEE8] to-[#E4E1D8]">
      <svg width="64" height="30" viewBox="0 0 64 30" fill="none" stroke={color ? colorSwatch(color) : '#B5AF9F'} strokeWidth="3" className="max-w-[70%]">
        <circle cx="15" cy="16" r="11" /><circle cx="49" cy="16" r="11" /><path d="M26 14h12M4 12l4-3M60 12l-4-3" />
      </svg>
    </div>
  )
}

// Las fotos de Shopify vienen en tamaño completo: para la miniatura se pide una versión chica al CDN.
function chica(src: string | null | undefined, w: number) {
  if (!src || !/cdn\.shopify\.com/.test(src)) return src
  return src + (src.includes('?') ? '&' : '?') + `width=${w}`
}

export function Miniatura({ src, alt, color, size = 'md' }: { src: string | null | undefined; alt: string; color?: string | null; size?: 'sm' | 'md' | 'lg' }) {
  const dim = size === 'sm' ? 'w-10 h-8' : size === 'lg' ? 'w-24 h-16' : 'w-16 h-11'
  return (
    <div className={`${dim} shrink-0 rounded-md bg-white border border-black/5 overflow-hidden p-0.5`}>
      <FotoAnteojo src={chica(src, size === 'lg' ? 240 : 160)} alt={alt} color={color} />
    </div>
  )
}
