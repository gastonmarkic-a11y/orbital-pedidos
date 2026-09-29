// /ar-qr: tarjetas con QR para imprimir y poner en el exhibidor de la óptica, una por modelo destacado con 3D.
// El QR abre ver.orbitaleyewear.com.ar/modelo/<MODELO>?v=3d&desde=qr → visor 3D directo ("Verlo en tu mesa"),
// con colores en stock, "Probármelo en la cara", precio y ópticas cercanas. ?optica=<nombre> lo imprime en la tarjeta.
import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { indice3D } from './ar3d'

const BASE = 'https://ver.orbitaleyewear.com.ar'

export default function QrExhibidor() {
  const optica = new URLSearchParams(window.location.search).get('optica')
  const [tarjetas, setTarjetas] = useState<{ modelo: string; qr: string; colores: number }[] | null>(null)

  useEffect(() => {
    document.title = 'QR exhibidor · Orbital'
    indice3D().then(async (idx) => {
      const out = []
      for (const [modelo, cols] of Object.entries(idx)) {
        const url = `${BASE}/modelo/${encodeURIComponent(modelo)}?v=3d&desde=qr`
        out.push({ modelo, colores: Object.keys(cols).length, qr: await QRCode.toDataURL(url, { margin: 1, width: 480, errorCorrectionLevel: 'M' }) })
      }
      setTarjetas(out)
    })
  }, [])

  return (
    <div className="min-h-screen bg-neutral-100 print:bg-white text-neutral-900">
      <div className="max-w-5xl mx-auto px-4 py-6 print:p-0">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-5 print:hidden">
          <div>
            <h1 className="text-xl font-black">QR para exhibidor</h1>
            <p className="text-sm text-neutral-500">Modelos destacados con 3D. El cliente escanea y ve el anteojo en 3D, en su mesa y en su cara.</p>
          </div>
          <button onClick={() => window.print()} className="rounded-xl bg-neutral-900 text-white font-bold px-4 py-2.5">🖨️ Imprimir</button>
        </div>
        {!tarjetas ? <p className="text-sm text-neutral-400">Armando los QR…</p> : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 print:grid-cols-3 print:gap-3">
            {tarjetas.map((t) => (
              <div key={t.modelo} className="bg-white rounded-3xl border border-neutral-200 p-5 flex flex-col items-center text-center break-inside-avoid">
                <img src="/logo-orbital.png" alt="Orbital Eyewear" className="h-5" />
                <p className="mt-3 text-2xl font-black tracking-tight">{t.modelo}</p>
                <p className="text-xs font-bold uppercase tracking-wide text-neutral-500 mt-1">Escaneame</p>
                <img src={t.qr} alt={`QR ${t.modelo}`} className="w-44 h-44 mt-2" />
                <p className="text-sm font-semibold mt-2">📦 Miralo en 3D · 🪞 Probátelo con tu cámara</p>
                <p className="text-[11px] text-neutral-500 mt-1">{t.colores} colores · sin descargar nada</p>
                {optica && <p className="text-[11px] font-semibold mt-2 pt-2 border-t border-neutral-100 w-full">{optica}</p>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
