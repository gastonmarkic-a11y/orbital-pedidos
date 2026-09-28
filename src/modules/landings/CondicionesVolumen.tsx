// Bloque de condiciones por volumen para las landings (misma tabla que el carrito del catálogo).
import { ESCALERA, CONTADO_PCT, PREMIO_DIAS } from '../catalogo/escalera'

const AZUL = '#0004FF'

export default function CondicionesVolumen({ kicker, titulo, bajada }: { kicker: string; titulo: string; bajada: string }) {
  const escalones = ESCALERA.filter((e) => e.pct > 0)
  return (
    <div className="mt-14 rounded-2xl border border-black/10 p-6 sm:p-8">
      <p className="text-[11px] font-semibold tracking-[0.3em] uppercase mb-1" style={{ color: AZUL }}>{kicker}</p>
      <h2 className="text-2xl sm:text-3xl font-black">{titulo}</h2>
      <p className="text-black/60 text-sm mt-2 max-w-2xl">{bajada}</p>
      <div className="grid grid-cols-3 sm:grid-cols-5 gap-2.5 mt-5">
        {escalones.map((e) => (
          <div key={e.desde} className="rounded-xl bg-white border border-black/10 p-3 text-center">
            <p className="text-[10px] text-black/45 uppercase tracking-wider">desde {e.desde} u.</p>
            <p className="text-2xl font-black mt-0.5" style={{ color: AZUL }}>{e.pct}%</p>
            <p className="text-[10px] text-black/45">bonificación</p>
          </div>
        ))}
      </div>
      <ul className="mt-5 space-y-2 text-[13px] text-black/75">
        <li className="flex gap-2"><span style={{ color: AZUL }}>✓</span>Pago a 30, 60 y 90 días.</li>
        <li className="flex gap-2"><span style={{ color: AZUL }}>✓</span>🎁 Si en el carrito del catálogo completás el siguiente escalón, te regalamos {PREMIO_DIAS} días más (30/60/90/120).</li>
        <li className="flex gap-2"><span style={{ color: AZUL }}>✓</span>{CONTADO_PCT}% extra pagando por transferencia o contado.</li>
      </ul>
    </div>
  )
}
