import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { BotonCopiar } from './ColabAnteojos'

// Lanzamiento ASCARI en el panel del promotor: video, texto para sus seguidores (sin precios ni ópticas)
// y atajo a Anteojos para sacar su link. Una vez por dispositivo, hasta el 15/11.
const HASTA = new Date('2026-11-15T00:00:00-03:00')
const KEY = 'pop_ascari_colab_2026'
const VIDEO = '/banners/ascari-teaser.mp4'
const VIDEO_DESCARGA = 'https://towcgvphxeqilpdnboki.supabase.co/storage/v1/object/public/catalogo/campanas/ascari/ascari-teaser.mp4?download=ascari.mp4'

const TEXTO = `👓 ASCARI llegó a Orbital

El aviador que hoy es ícono de la moda en el mundo: silueta protagonista, armazón Clear Mate translúcido y lentes naranjas de luz cálida.

☀️ UV400: 100% UVA y UVB
💻 Blue Cut: filtra el 98% de la luz azul de 420 nm
🪶 Ultra liviano: te olvidás de que lo tenés puesto
🛡️ También con cristales Triple Protección, que suman 🔥 filtrado infrarrojo

🌙 Del sol a la noche: el naranja es EL look de esta temporada.

Con mi link tenés descuento exclusivo 👇`

export default function AscariPopColab({ onVerAnteojos }: { onVerAnteojos: () => void }) {
  const [abierto, setAbierto] = useState(false)
  useEffect(() => {
    if (new Date() >= HASTA) return
    try { if (localStorage.getItem(KEY)) return } catch { /* sin storage: se muestra igual */ }
    const t = window.setTimeout(() => setAbierto(true), 1200)
    return () => window.clearTimeout(t)
  }, [])
  const cerrar = () => { setAbierto(false); try { localStorage.setItem(KEY, new Date().toISOString()) } catch { /* nada */ } }
  if (!abierto) return null
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={cerrar} />
      <div className="relative bg-white text-[#0a0a0a] w-full sm:max-w-md sm:rounded-2xl rounded-t-2xl max-h-[92vh] overflow-y-auto">
        <div className="relative h-[42vh] max-h-[360px] bg-black sm:rounded-t-2xl overflow-hidden">
          <video src={VIDEO} poster="/banners/ascari-poster.jpg" muted autoPlay loop playsInline className="w-full h-full object-cover object-[center_40%]" />
          <button onClick={cerrar} aria-label="Cerrar" className="absolute top-3 right-3 w-8 h-8 rounded-full bg-black/45 text-white flex items-center justify-center"><X size={18} /></button>
          <span className="absolute left-3.5 bottom-3.5 bg-[#ff5a00] text-white text-[10px] font-bold tracking-[0.14em] uppercase rounded-full px-2.5 py-1.5">Nuevo · Temporada 2026</span>
        </div>
        <div className="p-5">
          <h2 className="text-[30px] font-extrabold tracking-[0.18em] leading-none">ASCARI</h2>
          <p className="text-sm text-neutral-500 mt-1.5">Ya lo podés promocionar: sacá tu link en Anteojos.</p>
          <p className="text-[11px] font-bold tracking-[0.12em] uppercase mt-4 mb-1.5">Texto para tus seguidores</p>
          <p className="text-[12.5px] bg-neutral-50 border border-black/10 rounded-xl p-3 whitespace-pre-wrap leading-relaxed">{TEXTO}</p>
          <div className="flex flex-wrap gap-2 mt-2.5">
            <BotonCopiar texto={TEXTO} label="Copiar texto" grande />
            <a href={VIDEO_DESCARGA} className="inline-flex items-center rounded-lg border border-black/15 px-3 py-2 text-[12px] font-semibold">⬇️ Bajar el video</a>
          </div>
          <button onClick={() => { cerrar(); onVerAnteojos() }} className="mt-5 w-full bg-[#0a0a0a] text-white rounded-xl py-3.5 text-sm font-bold">Ver ASCARI y sacar mi link</button>
        </div>
      </div>
    </div>
  )
}
