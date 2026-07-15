// Parseo de teléfonos de la cartera (formatos argentinos, a menudo con varios números y símbolos).
// Divide un campo en números individuales, limpia símbolos/espacios, detecta celular vs línea
// y arma los links para llamar (tel:) y abrir WhatsApp (wa.me), siguiendo la convención 549... del resto de la app.

export type TipoTel = 'celular' | 'linea'

export interface NumeroTel {
  original: string // como venía escrito
  digits: string // solo dígitos (sin 0 inicial de característica)
  tipo: TipoTel
  telHref: string // tel:+54...
  waHref: string // https://wa.me/549...
}

// Normaliza a formato WhatsApp argentino (54 9 …).
function aWhatsApp(soloDigitos: string): string {
  const t = soloDigitos.replace(/^0+/, '')
  if (!t) return ''
  // Números nacionales (≤10 dígitos: área+local) → asumir Argentina móvil (54 9 …).
  // Solo se considera que ya trae código de país si es largo y arranca en 54.
  if (t.length >= 11 && t.startsWith('54')) return t.startsWith('549') ? t : '549' + t.slice(2)
  return '549' + t
}

function aTel(soloDigitos: string): string {
  const t = soloDigitos.replace(/^0+/, '')
  return '+' + (t.startsWith('54') ? t : '54' + t)
}

// ¿La porción de texto sugiere un celular? Señal fiable: prefijo 15 (notación móvil argentina).
// Los números de línea con característica de 10 dígitos (ej: 0221…) NO se marcan como celular.
function esCelular(parteOriginal: string, asumirCelular: boolean): boolean {
  if (/(^|\D)15\d{6,}/.test(parteOriginal) || /\(\s*15\s*\)/.test(parteOriginal)) return true
  return asumirCelular
}

/**
 * Parsea un campo de teléfono en uno o más números limpios y accionables.
 * Ignora fragmentos de menos de 6 dígitos (ej: "/97", "/4") para no generar números basura.
 */
export function parseTelefonos(raw: string | null | undefined, asumirCelular = false): NumeroTel[] {
  if (!raw) return []
  const partes = raw
    .split(/\s*[/,;|]+\s*|\s+[yYoO]\s+/)
    .map((s) => s.trim())
    .filter(Boolean)

  const out: NumeroTel[] = []
  const vistos = new Set<string>()
  for (const parte of partes) {
    const digits = parte.replace(/\D/g, '')
    if (digits.length < 6) continue // fragmento incompleto → se descarta
    if (vistos.has(digits)) continue
    vistos.add(digits)
    out.push({
      original: parte,
      digits,
      tipo: esCelular(parte, asumirCelular) ? 'celular' : 'linea',
      telHref: aTel(digits),
      waHref: 'https://wa.me/' + aWhatsApp(digits),
    })
  }
  return out
}

/** Todos los números de un cliente (WhatsApp primero, luego teléfono), sin duplicar. */
export function telefonosCliente(whatsapp: string | null | undefined, telefono: string | null | undefined): NumeroTel[] {
  // Lo cargado en el campo WhatsApp se asume celular; el campo teléfono solo es celular si trae el prefijo 15.
  const nums = [...parseTelefonos(whatsapp, true), ...parseTelefonos(telefono, false)]
  const vistos = new Set<string>()
  return nums.filter((n) => (vistos.has(n.digits) ? false : vistos.add(n.digits)))
}
