export function formatPrecio(p: number | null | undefined): string {
  if (!p || p === 0) return ''
  return '$ ' + Math.round(p).toLocaleString('es-AR')
}

export function clienteCorto(cliente: string | null | undefined): string {
  const c = (cliente || '').replace(/^\d+ - /, '')
  return c.slice(0, 20) + (c.length > 25 ? '…' : '')
}
