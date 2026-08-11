import { useState } from 'react'
import { Phone, ChevronDown } from 'lucide-react'
import { parseTelefonos } from './telefono'

// Botón "Llamar" que respeta múltiples teléfonos: si el cliente tiene más de un número,
// abre un selector para elegir a cuál llamar (en vez de marcar los números pegados).
export default function LlamarBtn({ telefono, className = '' }: { telefono: string | null | undefined; className?: string }) {
  const tels = parseTelefonos(telefono)
  const [open, setOpen] = useState(false)
  if (tels.length === 0) return null
  const base = 'text-center text-[11px] font-medium rounded-lg border border-black/10 py-1.5 text-ink flex items-center justify-center gap-1'
  if (tels.length === 1) {
    return <a href={tels[0].telHref} className={`${base} ${className}`}><Phone size={12} />Llamar</a>
  }
  return (
    <div className={`relative ${className}`}>
      <button onClick={() => setOpen((o) => !o)} className={`w-full ${base}`}><Phone size={12} />Llamar ({tels.length}) <ChevronDown size={11} /></button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-white border border-black/10 rounded-lg shadow-lg p-1 space-y-0.5 min-w-[150px]">
            <p className="text-[9px] text-faint px-2 pt-0.5 uppercase tracking-wide">Elegí a cuál llamar</p>
            {tels.map((t, i) => (
              <a key={i} href={t.telHref} onClick={() => setOpen(false)} className="flex items-center gap-1.5 text-[12px] px-2 py-1.5 rounded-md hover:bg-black/5 text-ink tabular-nums">
                <span>{t.tipo === 'celular' ? '📱' : '☎️'}</span>{t.nacional}
              </a>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
