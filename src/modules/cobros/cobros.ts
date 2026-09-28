import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { formatPrecio } from '../../lib/format'

// Cobro sin intermediarios: el cliente transfiere a un alias/CBU/CVU propio con la referencia ORB-<pedido>.
// El QR "propio" abre /cobro/ORB-xxx (no es un QR de pago de MP: no cobra comisión).

export type CuentaCobro = {
  id: number
  nombre: string
  razon_social: string | null
  alias: string | null
  cbu_cvu: string | null
  titular: string | null
  cuit: string | null
}

export type EstadoPago = 'pendiente' | 'comprobante' | 'detectado' | 'verificado' | 'rechazado'

export type Pago = {
  id: string
  pedido_id: number | null
  referencia: string
  cliente: string | null
  cuenta_id: number | null
  monto_esperado: number
  monto_recibido: number | null
  estado: EstadoPago
  origen: string | null
  comprobante_path: string | null
  fecha_pago: string | null
  verificado_por: string | null
  verificado_en: string | null
  notas: string | null
  created_at: string
}

export const ESTADO_PAGO: Record<EstadoPago, { label: string; cls: string }> = {
  pendiente: { label: 'Pendiente', cls: 'bg-black/5 text-muted' },
  comprobante: { label: 'Comprobante subido', cls: 'bg-amber-100 text-amber-800' },
  detectado: { label: 'Detectado', cls: 'bg-goldSoft text-brandDark' },
  verificado: { label: 'Pagado ✓', cls: 'bg-emerald-100 text-emerald-800' },
  rechazado: { label: 'Rechazado', cls: 'bg-red-100 text-red-700' },
}

export const linkCobro = (ref: string) => `${window.location.origin}/cobro/${ref}`

export function mensajeCobro(ref: string, monto: number, cuentas: CuentaCobro[], nombre?: string) {
  const c = cuentas[0]
  const lineas = [
    `Hola${nombre ? ' ' + nombre : ''}! Te paso los datos para pagar tu pedido Orbital ${ref}:`,
    `💲 ${formatPrecio(monto)}`,
    linkCobro(ref),
  ]
  if (c) {
    lineas.push('')
    if (c.alias) lineas.push(`Alias: ${c.alias}`)
    if (c.cbu_cvu) lineas.push(`CBU/CVU: ${c.cbu_cvu}`)
    if (c.titular) lineas.push(`Titular: ${c.titular}${c.cuit ? ' · CUIT ' + c.cuit : ''}`)
  }
  lineas.push('', `Poné *${ref}* en el concepto de la transferencia y listo. Si querés, subí el comprobante en el link.`)
  return lineas.join('\n')
}

export function mensajeMediosPago(cuentas: CuentaCobro[]) {
  const lineas = ['Medios de pago Orbital (sin recargo):', '']
  for (const c of cuentas) {
    lineas.push(`🏦 ${c.nombre}${c.razon_social ? ' · ' + c.razon_social : ''}`)
    if (c.alias) lineas.push(`Alias: ${c.alias}`)
    if (c.cbu_cvu) lineas.push(`CBU/CVU: ${c.cbu_cvu}`)
    if (c.titular) lineas.push(`Titular: ${c.titular}${c.cuit ? ' · CUIT ' + c.cuit : ''}`)
    lineas.push('')
  }
  lineas.push('También cheque o e-cheq según la condición acordada.', 'Poné el número de pedido (ORB-xxxx) en el concepto.')
  return lineas.join('\n')
}

export function useQR(texto: string | null) {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    if (!texto) return setSrc(null)
    QRCode.toDataURL(texto, { margin: 1, width: 320, color: { dark: '#15151A', light: '#FFFFFF' } })
      .then(setSrc)
      .catch(() => setSrc(null))
  }, [texto])
  return src
}

export async function copiar(texto: string) {
  try {
    await navigator.clipboard.writeText(texto)
    return true
  } catch {
    return false
  }
}
