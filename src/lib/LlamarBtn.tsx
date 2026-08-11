import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { telefonosCliente } from './telefono'

// Botón "Llamar" que junta TODOS los números del cliente (WhatsApp + línea, sin duplicar):
// si hay más de uno, abre un selector para elegir a cuál llamar. Así se puede llamar también
// al celular de WhatsApp, no solo al teléfono de línea.
export default function LlamarBtn({ telefono, whatsapp, className = '' }: { telefono: string | null | undefined; whatsapp?: string | null; className?: string }) {
  const tels = telefonosCliente(whatsapp, telefono)
  const [open, setOpen] = useState(false)
  if (tels.length === 0) return null
  const base = 'text-center text-[11px] font-medium rounded-lg border border-black/10 py-1.5 text-ink flex items-center justify-center gap-1'
  const emoji = (tipo: string) => (tipo === 'celular' ? '📱' : '☎️') // 📱 celular/WhatsApp · ☎️ línea
  if (tels.length === 1) {
    const t = tels[0]
    return <a href={t.telHref} title={t.tipo === 'celular' ? 'Celular / WhatsApp' : 'Teléfono de línea'} className={`${base} ${className}`}><span className="text-[13px] leading-none">{emoji(t.tipo)}</span>Llamar</a>
  }
  // Si hay varios, el botón muestra los tipos que hay (📱/☎️) para que el operador sepa qué va a encontrar.
  const tipos = Array.from(new Set(tels.map((t) => emoji(t.tipo)))).join(' ')
  return (
    <div className={`relative ${className}`}>
      <button onClick={() => setOpen((o) => !o)} className={`w-full ${base}`}><span className="text-[13px] leading-none">{tipos}</span>Llamar ({tels.length}) <ChevronDown size={11} /></button>
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
