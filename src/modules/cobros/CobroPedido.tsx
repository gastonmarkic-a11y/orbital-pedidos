import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useToast } from '../../lib/toast'
import { formatPrecio } from '../../lib/format'
import { parseTelefonos, abrirWhatsApp } from '../../lib/telefono'
import { Pedido } from '../../lib/types'
import { CuentaCobro, ESTADO_PAGO, Pago, copiar, linkCobro, mensajeCobro, useQR } from './cobros'

// Cobrar un pedido: reemplaza al link de MP. Genera ORB-<id>, QR propio y WhatsApp con los datos.
export default function CobroPedido({ pedido, monto, onClose }: { pedido: Pedido; monto: number; onClose: () => void }) {
  const toast = useToast()
  const [cuentas, setCuentas] = useState<CuentaCobro[]>([])
  const [pago, setPago] = useState<Pago | null>(null)
  const [importe, setImporte] = useState(String(Math.round(monto)))
  const [cuentaId, setCuentaId] = useState<number | null>(null)
  const [error, setError] = useState('')
  const link = pago ? linkCobro(pago.referencia) : null
  const qr = useQR(link)
  const nombre = (pedido.cliente || '').replace(/^\d+ - /, '')

  async function generar(m: number, c: number | null) {
    const { data, error } = await supabase.rpc('cobro_de_pedido', { p_pedido: pedido.id, p_monto: m, p_cuenta: c })
    if (error) return setError(error.message)
    const p = data as Pago
    setPago(p)
    setImporte(String(Math.round(p.monto_esperado)))
    setCuentaId(p.cuenta_id)
  }

  useEffect(() => {
    supabase.rpc('cobro_cuentas').then(({ data }) => setCuentas((data as CuentaCobro[]) ?? []))
    generar(monto, null)
  }, [pedido.id])

  const cuentasMsg = cuentaId ? cuentas.filter((c) => c.id === cuentaId) : cuentas
  const editable = pago && (pago.estado === 'pendiente' || pago.estado === 'rechazado')
  const wa = parseTelefonos(pedido.wsp, true)[0]?.wa

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl p-4 space-y-3 max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-[10px] tracking-[0.25em] text-gold font-bold">[ COBRO ]</p>
            <p className="font-semibold">{nombre} <span className="text-faint font-normal">#{pedido.id}</span></p>
          </div>
          <button onClick={onClose} className="text-sm text-muted">✕</button>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        {!pago ? (
          <p className="text-sm text-muted">Preparando…</p>
        ) : (
          <>
            <div className="flex items-center justify-between gap-2">
              <span className="font-jet text-sm">{pago.referencia}</span>
              <span className={`text-[11px] font-semibold rounded-full px-2.5 py-1 ${ESTADO_PAGO[pago.estado].cls}`}>
                {ESTADO_PAGO[pago.estado].label}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <label className="text-xs text-muted">
                Importe a cobrar
                <input
                  value={importe}
                  disabled={!editable}
                  onChange={(e) => setImporte(e.target.value.replace(/[^\d]/g, ''))}
                  onBlur={() => Number(importe) > 0 && Number(importe) !== Math.round(pago.monto_esperado) && generar(Number(importe), cuentaId)}
                  className="mt-1 w-full rounded-md border border-black/10 px-2 py-1.5 text-sm text-ink font-semibold"
                />
              </label>
              <label className="text-xs text-muted">
                Cuenta
                <select
                  value={cuentaId ?? ''}
                  disabled={!editable}
                  onChange={(e) => {
                    const c = e.target.value ? Number(e.target.value) : null
                    setCuentaId(c)
                    generar(Number(importe), c)
                  }}
                  className="mt-1 w-full rounded-md border border-black/10 px-2 py-1.5 text-sm text-ink"
                >
                  <option value="">Todas las activas</option>
                  {cuentas.map((c) => (
                    <option key={c.id} value={c.id}>{c.razon_social || c.nombre}</option>
                  ))}
                </select>
              </label>
            </div>
            <p className="text-[11px] text-muted">Sugerido por el sistema: {formatPrecio(monto)} (con IVA de la parte facturada).</p>

            {cuentas.length === 0 && (
              <p className="text-xs bg-amber-50 border border-amber-200 text-amber-800 rounded-lg p-2">
                Todavía no hay cuentas de cobro cargadas. Administración las carga en <b>Cobros → Cuentas</b>.
              </p>
            )}

            {qr && (
              <div className="text-center">
                <img src={qr} alt="QR de cobro" className="w-44 h-44 mx-auto" />
                <p className="text-[11px] text-muted">QR propio: abre la página con los datos para transferir. Sin comisión.</p>
              </div>
            )}

            <div className="grid grid-cols-2 gap-2">
              <button
                disabled={!wa}
                onClick={() => wa && abrirWhatsApp(wa, mensajeCobro(pago.referencia, pago.monto_esperado, cuentasMsg, nombre.split(' ')[0]))}
                className="rounded-lg bg-[#25D366] text-white py-2 text-xs font-bold disabled:opacity-40"
                title={wa ? '' : 'El pedido no tiene WhatsApp cargado'}
              >
                WhatsApp al cliente
              </button>
              <button
                onClick={() => copiar(mensajeCobro(pago.referencia, pago.monto_esperado, cuentasMsg, nombre.split(' ')[0])).then((ok) => ok && toast('Mensaje copiado', 'success'))}
                className="rounded-lg border border-black/10 py-2 text-xs font-semibold"
              >
                Copiar mensaje
              </button>
              <button
                onClick={() => link && copiar(link).then((ok) => ok && toast('Link copiado', 'success'))}
                className="rounded-lg border border-black/10 py-2 text-xs font-semibold"
              >
                Copiar link
              </button>
              <a href={link ?? '#'} target="_blank" rel="noreferrer" className="rounded-lg border border-black/10 py-2 text-xs font-semibold text-center">
                Ver página
              </a>
            </div>
            <Link to="/cobros" className="block text-center text-xs text-brandDark underline">Ir a Cobros</Link>
          </>
        )}
      </div>
    </div>
  )
}
