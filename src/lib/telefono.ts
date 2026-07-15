// Parseo y normalización de teléfonos argentinos de la cartera.
// Divide un campo en números individuales, limpia símbolos/espacios, lleva cada número
// a su forma nacional (característica + abonado, 10 dígitos), detecta celular vs línea,
// y arma los links para llamar (tel:) y WhatsApp (wa.me con formato 54 9 …).

export type TipoTel = 'celular' | 'linea'

export interface NumeroTel {
  original: string // como venía escrito
  nacional: string // 10 dígitos (característica + abonado), sin 0 ni 15
  tipo: TipoTel
  telHref: string // tel:+54…
  waHref: string // https://wa.me/549…
  wa: string // 549… (E.164 sin +), listo para WhatsApp
}

/**
 * Lleva un string de dígitos a la forma nacional argentina de 10 dígitos
 * (característica + abonado), quitando prefijo internacional, código de país 54,
 * el 0 de troncal, el 9 de móvil y el 15 de celular.
 */
export function aNacional(soloDigitos: string): string {
  let d = soloDigitos.replace(/\D/g, '')
  d = d.replace(/^00/, '') // prefijo de salida internacional
  if (d.length > 10 && d.startsWith('54')) d = d.slice(2) // código de país
  d = d.replace(/^0+/, '') // 0 de troncal
  if (d.length === 11 && d.startsWith('9')) d = d.slice(1) // 9 de móvil internacional
  // 15 de celular: queda pegado después de la característica (2 a 4 dígitos)
  if (d.length === 12) {
    for (const al of [4, 3, 2]) {
      if (d.slice(al, al + 2) === '15') {
        d = d.slice(0, al) + d.slice(al + 2)
        break
      }
    }
  }
  // Número local de CABA/GBA sin característica (8 dígitos) → anteponer 11
  if (d.length === 8) d = '11' + d
  return d
}

function aWhatsApp(soloDigitos: string): string {
  const nac = aNacional(soloDigitos)
  if (nac.length < 10) return '' // incompleto (no se puede armar E.164 confiable)
  return '549' + nac
}

// Señal fiable de celular: prefijo 15 en el texto original.
function esCelular(parteOriginal: string, asumirCelular: boolean): boolean {
  if (/(^|\D)15\d{6,}/.test(parteOriginal) || /\(\s*15\s*\)/.test(parteOriginal)) return true
  return asumirCelular
}

/**
 * Parsea un campo de teléfono en uno o más números limpios y accionables.
 * Ignora fragmentos de menos de 6 dígitos (ej: "/97", "/4").
 * asumirCelular: para el campo WhatsApp, donde se asume que el número es celular.
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
    const nacional = aNacional(digits)
    const clave = nacional || digits
    if (vistos.has(clave)) continue
    vistos.add(clave)
    const wa = aWhatsApp(digits)
    out.push({
      original: parte,
      nacional,
      tipo: esCelular(parte, asumirCelular) ? 'celular' : 'linea',
      telHref: 'tel:+54' + nacional,
      waHref: wa ? 'https://wa.me/' + wa : '',
      wa,
    })
  }
  return out
}

/** Todos los números de un cliente (WhatsApp primero, luego teléfono), sin duplicar. */
export function telefonosCliente(whatsapp: string | null | undefined, telefono: string | null | undefined): NumeroTel[] {
  const nums = [...parseTelefonos(whatsapp, true), ...parseTelefonos(telefono, false)]
  const vistos = new Set<string>()
  return nums.filter((n) => (vistos.has(n.nacional) ? false : vistos.add(n.nacional)))
}
