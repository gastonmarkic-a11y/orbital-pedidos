import { telefonosCliente } from './telefono'

/**
 * Muestra los teléfonos de un cliente como acciones: cada número con botón para
 * llamar (tel:) y abrir WhatsApp (wa.me). Detecta celular (📱) vs línea (☎️) y
 * separa varios números en filas independientes.
 */
export default function TelefonoAcciones({
  whatsapp,
  telefono,
  compact = false,
}: {
  whatsapp: string | null | undefined
  telefono: string | null | undefined
  compact?: boolean
}) {
  const nums = telefonosCliente(whatsapp, telefono)
  if (nums.length === 0) return <span className="text-faint">—</span>

  if (compact) {
    // Solo iconos: número + botón llamar + botón WhatsApp, sin etiquetas de texto
    return (
      <div className="flex flex-wrap gap-x-2 gap-y-1">
        {nums.map((n) => (
          <div key={n.nacional} className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
            <span className="text-[11px] tabular-nums text-ink whitespace-nowrap">
              {n.tipo === 'celular' ? '📱' : '☎️'} {n.nacional}
            </span>
            <a href={n.telHref} className="text-brandDark hover:opacity-70" title={`Llamar ${n.nacional}`}>
              📞
            </a>
            <a href={n.waHref} target="_blank" rel="noreferrer" className="text-emerald-700 hover:opacity-70" title={`WhatsApp ${n.nacional}`}>
              💬
            </a>
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-1.5">
      {nums.map((n) => (
        <div key={n.nacional} className="flex items-center gap-1.5">
          <span className="text-[11px] tabular-nums text-ink">
            {n.tipo === 'celular' ? '📱' : '☎️'} {n.nacional}
          </span>
          <a
            href={n.telHref}
            className="text-[10px] font-medium rounded-full border border-black/10 px-2 py-0.5 text-brandDark hover:bg-black/5"
            title="Llamar"
          >
            📞 Llamar
          </a>
          <a
            href={n.waHref}
            target="_blank"
            rel="noreferrer"
            className="text-[10px] font-medium rounded-full border border-emerald-500/30 px-2 py-0.5 text-emerald-700 hover:bg-emerald-50"
            title="Abrir WhatsApp"
          >
            💬 WhatsApp
          </a>
        </div>
      ))}
    </div>
  )
}
