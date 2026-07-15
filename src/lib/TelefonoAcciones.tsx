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

  return (
    <div className={compact ? 'flex flex-wrap gap-1.5' : 'flex flex-col gap-1.5'}>
      {nums.map((n) => (
        <div key={n.digits} className="flex items-center gap-1.5">
          <span className="text-[11px] tabular-nums text-ink">
            {n.tipo === 'celular' ? '📱' : '☎️'} {n.digits}
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
