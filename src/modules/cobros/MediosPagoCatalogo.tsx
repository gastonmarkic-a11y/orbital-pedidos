import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { CuentaCobro, copiar, mensajeMediosPago } from './cobros'

// Catálogo B2B: "Cómo pagar" — cuentas propias para transferir sin recargo + cheque/e-cheq.
export function MediosPagoCatalogo({ onClose }: { onClose: () => void }) {
  const [cuentas, setCuentas] = useState<CuentaCobro[] | null>(null)
  const [copiado, setCopiado] = useState('')
  useEffect(() => {
    supabase.rpc('cobro_cuentas').then(({ data }) => setCuentas((data as CuentaCobro[]) ?? []))
  }, [])
  const cp = (k: string, v: string) => copiar(v).then((ok) => { if (ok) { setCopiado(k); setTimeout(() => setCopiado(''), 1500) } })

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl p-4 space-y-3 max-h-[90vh] overflow-y-auto font-sans" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold">Cómo pagar</h2>
          <button onClick={onClose} className="text-sm text-neutral-500">✕</button>
        </div>
        <p className="text-[12px] text-neutral-600">
          Transferencia <b>sin recargo</b>. Poné el número de pedido (<span className="font-mono">ORB-xxxx</span>) en el concepto. Tu pedido está en <b>Mis compras</b> → Pagar.
        </p>
        {cuentas === null ? (
          <p className="text-sm text-neutral-500">Cargando…</p>
        ) : cuentas.length === 0 ? (
          <p className="text-sm text-neutral-500">Pedile los datos de pago a tu vendedor.</p>
        ) : (
          cuentas.map((c) => (
            <div key={c.id} className="rounded-xl border border-black/10 p-3 space-y-1.5">
              <p className="text-[13px] font-semibold">{c.razon_social || c.nombre}</p>
              {[
                ['Alias', c.alias],
                ['CBU / CVU', c.cbu_cvu],
                ['Titular', c.titular ? `${c.titular}${c.cuit ? ' · CUIT ' + c.cuit : ''}` : null],
              ]
                .filter(([, v]) => v)
                .map(([l, v]) => (
                  <button key={l} onClick={() => cp(c.id + (l as string), v as string)}
                    className="w-full flex items-center justify-between gap-2 rounded-lg bg-[#F5F5F7] px-3 py-2 text-left">
                    <span className="min-w-0">
                      <span className="block text-[10px] uppercase tracking-wider text-neutral-500">{l}</span>
                      <span className="block font-mono text-[13px] break-all">{v}</span>
                    </span>
                    <span className="text-[11px] font-semibold text-[#0004FF] shrink-0">{copiado === c.id + (l as string) ? 'Copiado ✓' : 'Copiar'}</span>
                  </button>
                ))}
            </div>
          ))
        )}
        <p className="text-[12px] text-neutral-600">También cheque o e-cheq, según la condición que acordaste con tu vendedor.</p>
        {cuentas && cuentas.length > 0 && (
          <a href={`https://wa.me/?text=${encodeURIComponent(mensajeMediosPago(cuentas))}`} target="_blank" rel="noreferrer"
            className="block text-center rounded-full bg-[#25D366] text-white py-2.5 text-sm font-semibold">
            Guardar / compartir por WhatsApp
          </a>
        )}
      </div>
    </div>
  )
}

// "Pagar" en Mis compras: crea (si falta) el cobro ORB-<id> y abre su página.
export function BotonPagarPedido({ clave, pedido }: { clave: string; pedido: number }) {
  const [msg, setMsg] = useState('')
  const [cargando, setCargando] = useState(false)
  async function pagar() {
    setCargando(true)
    const { data } = await supabase.rpc('catalogo_pagar', { p_clave: clave, p_pedido: pedido })
    setCargando(false)
    const r = (data ?? {}) as { referencia?: string; pagado?: boolean; error?: string }
    if (r.referencia) window.open(`/cobro/${r.referencia}`, '_blank', 'noopener')
    else setMsg(r.pagado ? 'Este pedido ya está pagado ✓' : r.error || 'No se pudo abrir el pago.')
  }
  return (
    <div className="pt-1.5">
      <button onClick={pagar} disabled={cargando}
        className="w-full rounded-full bg-[#0a0a0a] text-white py-2 text-[12px] font-semibold disabled:opacity-50">
        {cargando ? 'Abriendo…' : 'Pagar por transferencia (sin recargo)'}
      </button>
      {msg && <p className="text-[11px] text-neutral-600 mt-1 text-center">{msg}</p>}
    </div>
  )
}
