import { ESCALERA, MATERIAL, CONTADO_PCT, materialDe, premioPaquete } from '../catalogo/escalera'

// Condiciones comerciales por paquete (cuadro aprobado 13/10/2026).
// Lee la misma tabla que usa el carrito y la carga de pedidos: si cambia ESCALERA, cambia acá.
export default function CondicionesComerciales() {
  const filas = ESCALERA.map((e, i) => {
    const hasta = ESCALERA[i + 1] ? ESCALERA[i + 1].desde - 1 : null
    const netoCheques = 100 - e.pct
    return {
      ...e, rango: hasta ? `${e.desde}–${hasta}` : `${e.desde}+`,
      netoCheques, netoContado: Math.round(netoCheques * (100 - CONTADO_PCT)) / 100,
      material: materialDe(e.desde),
      premio: i > 0 ? premioPaquete(ESCALERA[i - 1], e) : [],
    }
  })
  const ej = ESCALERA[2]
  return (
    <div className="max-w-3xl mx-auto p-4 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-lg font-bold text-brandDark">Condiciones comerciales por paquete</h1>
      </div>

      <div className="rounded-xl border border-black/10 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-black/5 text-xs text-left">
            <tr>
              <th className="px-3 py-2">Paquete</th><th className="px-3 py-2">Unidades</th><th className="px-3 py-2">Bonif. comercial</th>
              <th className="px-3 py-2">Pago con cheques</th><th className="px-3 py-2">Neto cheques</th><th className="px-3 py-2">Neto contado (−{CONTADO_PCT}%)</th>
              <th className="px-3 py-2">Material</th>
            </tr>
          </thead>
          <tbody>
            {filas.map((f) => (
              <tr key={f.desde} className="border-t border-black/5 align-top">
                <td className="px-3 py-2 font-semibold">{f.paquete}</td>
                <td className="px-3 py-2">{f.rango}</td>
                <td className="px-3 py-2 font-semibold">{f.pct ? `${f.pct}%` : '—'}</td>
                <td className="px-3 py-2 whitespace-nowrap">{f.plazo}</td>
                <td className="px-3 py-2">{f.netoCheques}%</td>
                <td className="px-3 py-2 text-emerald-700">{f.netoContado.toLocaleString('es-AR')}%</td>
                <td className="px-3 py-2 text-xs">{f.material?.detalle ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div>
        <h2 className="text-sm font-bold text-brandDark mb-2">📦 Material de exhibición incluido (PDV)</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          {MATERIAL.map((m, i) => {
            const hasta = MATERIAL[i + 1] ? MATERIAL[i + 1].desde - 1 : null
            return (
              <div key={m.desde} className="rounded-xl border border-black/10 overflow-hidden bg-white">
                {m.img
                  ? <img src={m.img} alt={m.nombre} className="w-full h-36 object-cover object-top" />
                  : <div className="w-full h-36 bg-black/5 flex items-center justify-center text-center text-xs text-black/50 px-3">Gráficas a medida para el espacio de la óptica</div>}
                <div className="p-2.5">
                  <p className="text-[10px] uppercase tracking-wider text-black/45">{hasta ? `${m.desde}–${hasta}` : `${m.desde}+`} piezas</p>
                  <p className="text-[13px] font-semibold leading-snug mt-0.5">{m.detalle}</p>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <ul className="text-sm space-y-2">
        <li>📊 <b>La bonificación es por cantidad</b> y va siempre, pague con cheques o contado. No depende de la forma de pago.</li>
        <li>💵 <b>Contado / transferencia:</b> {CONTADO_PCT}% adicional sobre el neto ya bonificado (NC al cobrar), sin plazo.</li>
        <li>
          🎁 <b>Premio por llegar al siguiente paquete:</b> el carrito le muestra a la óptica cuántas unidades le faltan y qué gana
          (más descuento, más plazo, material). Si llega ahí mismo, se lo festeja y el pedido llega con la nota «subió al paquete en el carrito».
          <div className="mt-1 ml-6 rounded-lg bg-black/5 px-3 py-2 text-xs space-y-0.5">
            {filas.slice(1).map((f) => <div key={f.desde}>Llegar a <b>{f.desde} u.</b> (paquete {f.paquete}): {f.premio.join(', ')}.</div>)}
          </div>
        </li>
        <li>
          🧮 <b>Ejemplo:</b> {ej.desde + 3} u. → paquete {ej.paquete}: {ej.pct}% de bonificación y cheques a {ej.plazo}; o contado con {ej.pct}% + {CONTADO_PCT}%.
        </li>
        <li>📦 Las piezas sin cargo son del Pack de Bienvenida.</li>
        <li>🚫 No aplica a distribuidores ni corporativos, ni junto con pack o revendedor.</li>
      </ul>
    </div>
  )
}
