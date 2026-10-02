import { ESCALERA, CONTADO_PCT, PREMIO_DIAS, PLAZO_TOPE, estirar } from '../catalogo/escalera'

// Condiciones comerciales 2026 (escalera por volumen del catálogo).
// Lee la misma tabla que usa el carrito: si cambia ESCALERA, cambia acá.
export default function CondicionesComerciales() {
  const filas = ESCALERA.map((e, i) => {
    const hasta = ESCALERA[i + 1] ? ESCALERA[i + 1].desde - 1 : null
    return { ...e, rango: hasta ? `${e.desde}–${hasta}` : `${e.desde}+` }
  })
  const ej = ESCALERA[1]
  return (
    <div className="max-w-2xl mx-auto p-4 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-lg font-bold text-brandDark">Condiciones comerciales 2026</h1>
      </div>

      <div className="rounded-xl border border-black/10 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-black/5 text-xs text-left">
            <tr><th className="px-3 py-2">Unidades</th><th className="px-3 py-2">Descuento</th><th className="px-3 py-2">Plazo</th><th className="px-3 py-2">Premio</th></tr>
          </thead>
          <tbody>
            {filas.map((f) => (
              <tr key={f.desde} className="border-t border-black/5">
                <td className="px-3 py-2">{f.rango}</td>
                <td className="px-3 py-2 font-semibold">{f.pct ? `${f.pct}%` : '—'}</td>
                <td className="px-3 py-2">{f.plazo}</td>
                <td className="px-3 py-2">{f.pct && estirar(f.plazo) !== f.plazo ? `+${PREMIO_DIAS} días` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="text-sm space-y-2">
        <li>
          🎁 <b>Premio del checkout:</b> es para que la óptica suba al siguiente escalón. Lo maneja el sistema solo: con el carrito abierto le muestra cuántas unidades le faltan, y si completa el escalón ahí mismo le suma +{PREMIO_DIAS} días extra al plazo (tope {PLAZO_TOPE}), una vez. Si ya llega con el escalón, sin premio.
          <div className="mt-1 ml-6 rounded-lg bg-black/5 px-3 py-2 text-xs space-y-0.5">
            <div><b>Ejemplo:</b> abre el carrito con {ej.desde - 4} u. → sin descuento, {ESCALERA[0].plazo}.</div>
            <div>El sistema le avisa: «Te faltan 4 u. para {ej.pct}% y +{PREMIO_DIAS} días».</div>
            <div>Agrega 4 y llega a {ej.desde} u. → {ej.pct}% y {estirar(ej.plazo)}.</div>
            <div>Si hubiera abierto ya con {ej.desde} u. → {ej.pct}% y {ej.plazo}, sin premio.</div>
          </div>
        </li>
        <li>💵 <b>Contado / transferencia:</b> {CONTADO_PCT}% adicional sobre el neto (NC al cobrar).</li>
        <li>📦 El volumen da solo descuento. Las piezas sin cargo son del Pack de Bienvenida.</li>
        <li>🚫 No aplica a distribuidores ni corporativos, ni junto con pack, bono o revendedor.</li>
      </ul>
    </div>
  )
}
