export function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function mondayOfWeek(): Date {
  const d = new Date()
  const day = d.getDay() === 0 ? 7 : d.getDay()
  d.setDate(d.getDate() - (day - 1))
  return d
}

export function sundayOfWeek(): Date {
  const d = mondayOfWeek()
  d.setDate(d.getDate() + 6)
  return d
}

export function monthKey(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export function firstOfMonth(): string {
  return `${monthKey()}-01`
}

export function daysSince(fecha: string | null): number | null {
  if (!fecha) return null
  const d = new Date(fecha + 'T00:00:00')
  const hoy = new Date()
  hoy.setHours(0, 0, 0, 0)
  return Math.round((hoy.getTime() - d.getTime()) / 86400000)
}

/** Días hábiles transcurridos del mes (lun-vie) */
export function habilesTranscurridos(): number {
  const hoy = new Date()
  let c = 0
  for (let n = 1; n <= hoy.getDate(); n++) {
    const d = new Date(hoy.getFullYear(), hoy.getMonth(), n)
    if (d.getDay() !== 0 && d.getDay() !== 6) c++
  }
  return c
}

/** Días hábiles totales del mes */
export function habilesDelMes(): number {
  const hoy = new Date()
  const ult = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0).getDate()
  let c = 0
  for (let n = 1; n <= ult; n++) {
    const d = new Date(hoy.getFullYear(), hoy.getMonth(), n)
    if (d.getDay() !== 0 && d.getDay() !== 6) c++
  }
  return c
}

/** Parsea fechas de pedido tipo "2/7/2026, 01:34:16" o ISO */
export function parsePedidoFecha(fechaStr: string | null): Date | null {
  if (!fechaStr) return null
  try {
    if (fechaStr.includes(',')) {
      const [datePart] = fechaStr.split(',')
      const [dia, mes, anio] = datePart.split('/')
      const d = new Date(parseInt(anio), parseInt(mes) - 1, parseInt(dia))
      return isNaN(d.getTime()) ? null : d
    }
    const d = new Date(fechaStr)
    return isNaN(d.getTime()) ? null : d
  } catch {
    return null
  }
}

export function diasDesde(fechaStr: string | null): number {
  const d = parsePedidoFecha(fechaStr)
  if (!d) return 0
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86400000))
}

export function addDias(fechaStr: string | null, dias: number): Date | null {
  if (!fechaStr) return null
  let d = parsePedidoFecha(fechaStr)
  if (!d) {
    const parts = fechaStr.split(/[\/\-\.]/)
    if (parts.length === 3) {
      d = new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]))
    }
  }
  if (!d || isNaN(d.getTime())) return null
  const r = new Date(d)
  r.setDate(r.getDate() + dias)
  return r
}

export function formatFecha(d: Date | null): string {
  if (!d) return '—'
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}
