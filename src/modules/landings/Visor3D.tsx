// Visor 3D del anteojo (modelos destacados): se gira con el dedo y, desde el celular, "Ver en tu mesa"
// lo apoya sobre una superficie real (Android: Scene Viewer / WebXR · iPhone: Quick Look, model-viewer arma el USDZ solo).
// Lo usan la landing del modelo (/modelo/<MODELO>), el QR del exhibidor (?v=3d) y el catálogo B2B.
import { createElement, useEffect, useState } from 'react'
import { url3D } from './ar3d'

interface Color3D { codigo: string; color: string; foto?: string; archivo: string }

export default function Visor3D({ modelo, colores, inicial = 0, onCerrar, onProbar }: {
  modelo: string; colores: Color3D[]; inicial?: number; onCerrar: () => void; onProbar?: (codigo: string) => void
}) {
  const [listo, setListo] = useState(false)
  const [sel, setSel] = useState(Math.min(Math.max(inicial, 0), colores.length - 1))
  useEffect(() => { import('@google/model-viewer').then(() => setListo(true)) }, [])
  const c = colores[sel]

  return (
    <div className="fixed inset-0 z-50 bg-neutral-100 flex flex-col">
      <div className="flex items-center justify-between px-4 h-14 bg-white border-b border-neutral-200">
        <span className="font-bold truncate">{modelo} · <span className="font-normal text-neutral-500">{c?.color}</span></span>
        <button onClick={onCerrar} className="shrink-0 rounded-full bg-neutral-900 text-white px-3 py-1.5 text-sm font-semibold">Cerrar</button>
      </div>
      <div className="relative flex-1">
        {listo && c ? createElement('model-viewer', {
          key: c.codigo,
          src: url3D(c.archivo),
          alt: `${modelo} ${c.color}`,
          ar: '', 'ar-modes': 'webxr scene-viewer quick-look', 'ar-scale': 'auto', // en la mesa se agranda/achica con los dedos
          'camera-controls': '', 'auto-rotate': '', 'auto-rotate-delay': '0', 'rotation-per-second': '20deg',
          'camera-orbit': '25deg 80deg auto', 'shadow-intensity': '1', exposure: '1.1', 'environment-image': 'neutral',
          'interaction-prompt': 'none',
          style: { width: '100%', height: '100%', background: 'transparent' },
        }, createElement('button', {
          slot: 'ar-button',
          className: 'absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-neutral-900 text-white font-bold px-5 py-3 shadow-lg',
        }, '📦 Verlo en tu mesa')) : <p className="absolute inset-0 grid place-items-center text-sm text-neutral-400">Cargando 3D…</p>}
        <p className="absolute top-3 inset-x-0 text-center text-xs text-neutral-500 pointer-events-none">Giralo con el dedo · pellizcá para acercar</p>
      </div>
      <div className="bg-white border-t border-neutral-200">
        {onProbar && c && (
          <button onClick={() => onProbar(c.codigo)} className="block w-[calc(100%-24px)] mx-3 mt-3 rounded-2xl border-2 border-neutral-900 font-bold py-3">
            🪞 Probármelo en la cara
          </button>
        )}
        {colores.length > 1 && (
          <div className="flex gap-2 overflow-x-auto p-3">
            {colores.map((x, i) => (
              <button key={x.codigo} onClick={() => setSel(i)} title={x.color}
                className={`shrink-0 w-20 aspect-[4/3] rounded-xl bg-neutral-50 border-2 overflow-hidden ${i === sel ? 'border-neutral-900' : 'border-neutral-100'}`}>
                {x.foto ? <img src={x.foto} alt={x.color} className="w-full h-full object-contain" /> : <span className="text-[10px] px-1">{x.color}</span>}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
