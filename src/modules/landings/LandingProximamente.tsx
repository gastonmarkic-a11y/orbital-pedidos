// Landing placeholder branded para campañas cuya página todavía no tiene contenido.
// Reserva la URL (ej. ver.orbitaleyewear.com.ar/hotsale) para que funcione desde ya.
export default function LandingProximamente({ titulo }: { titulo: string }) {
  return (
    <div className="min-h-screen bg-white text-[#0a0a0a] flex flex-col items-center justify-center px-6 font-mono">
      <div className="max-w-md w-full text-center">
        <div className="text-[11px] tracking-[0.3em] uppercase text-[#0004FF] font-semibold mb-6">
          Orbital Eyewear
        </div>
        <svg width="72" height="34" viewBox="0 0 64 30" fill="none" stroke="#0a0a0a" strokeWidth="2.5" className="mx-auto mb-8">
          <circle cx="15" cy="16" r="11" /><circle cx="49" cy="16" r="11" /><path d="M26 14h12M4 12l4-3M60 12l-4-3" />
        </svg>
        <h1 className="text-2xl font-bold tracking-tight mb-2">{titulo}</h1>
        <p className="text-sm text-neutral-500 leading-relaxed">
          Muy pronto. Estamos preparando esta campaña.
        </p>
        <a
          href="/catalogo"
          className="inline-block mt-8 rounded-lg bg-[#0004FF] text-white px-6 py-2.5 text-sm font-semibold no-underline"
        >
          Ver catálogo
        </a>
      </div>
    </div>
  )
}
