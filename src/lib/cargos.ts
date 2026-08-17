// Taxonomía de cargos (decisores/influenciadores comerciales) + generador de búsquedas.
// Motor de Prospección — Fase 1: genera links de LinkedIn/Google/Web por cargo, SIN scraping (legal, gratis).

export interface CargoCat {
  id: string
  label: string
  emoji: string
  prioridad: number // relevance_score base (0-100)
  terminos: string[] // sinónimos ES/EN para armar la búsqueda
}

// Basado en la taxonomía del Motor PECA (decisores 100 → digital 75).
export const CARGOS: CargoCat[] = [
  { id: 'dueno', label: 'Dueño / Decisor', emoji: '👑', prioridad: 100, terminos: ['dueño', 'propietario', 'CEO', 'fundador', 'socio', 'director general', 'gerente general', 'owner', 'founder'] },
  { id: 'compras', label: 'Compras', emoji: '🛒', prioridad: 100, terminos: ['compras', 'gerente de compras', 'purchasing', 'abastecimiento', 'comprador', 'category manager', 'procurement'] },
  { id: 'comercial', label: 'Comercial', emoji: '💼', prioridad: 95, terminos: ['gerente comercial', 'director comercial', 'business development', 'desarrollo de negocios', 'commercial manager'] },
  { id: 'marketing', label: 'Marketing', emoji: '📣', prioridad: 90, terminos: ['gerente de marketing', 'director de marketing', 'marketing manager', 'CMO', 'brand manager', 'head of marketing'] },
  { id: 'ecommerce', label: 'E-commerce / Producto', emoji: '🛍️', prioridad: 88, terminos: ['e-commerce manager', 'ecommerce', 'product manager', 'marketplace manager', 'responsable de producto'] },
  { id: 'community', label: 'Community / Digital', emoji: '📱', prioridad: 80, terminos: ['community manager', 'social media manager', 'responsable de redes', 'content manager', 'comunicación'] },
]

const limpio = (s: string) => (s ?? '').replace(/\s+/g, ' ').trim()

/** Búsqueda de personas en LinkedIn (sesión propia del usuario — legal, manual). */
export function linkedinSearchUrl(empresa: string, cat: CargoCat, ciudad?: string): string {
  const kw = limpio(`${empresa} ${cat.terminos[0]} ${ciudad ?? ''}`)
  return `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(kw)}`
}

/** Google acotado a perfiles públicos de LinkedIn (site:linkedin.com/in) + empresa + cargo. */
export function googleLinkedinUrl(empresa: string, cat: CargoCat, ciudad?: string): string {
  const terms = cat.terminos.slice(0, 3).map((t) => `"${t}"`).join(' OR ')
  const q = limpio(`site:linkedin.com/in "${empresa}" (${terms}) ${ciudad ?? ''}`)
  return `https://www.google.com/search?q=${encodeURIComponent(q)}`
}

/** Google abierto: empresa + cargo + ciudad (encuentra web, notas, redes, etc.). */
export function googleWebUrl(empresa: string, cat: CargoCat, ciudad?: string): string {
  const q = limpio(`"${empresa}" "${cat.terminos[0]}" ${ciudad ?? ''}`)
  return `https://www.google.com/search?q=${encodeURIComponent(q)}`
}

/** Búsqueda GENERAL: toda la gente de la empresa en LinkedIn (sin filtrar por cargo). */
export function linkedinEmpresaUrl(empresa: string, ciudad?: string): string {
  const kw = limpio(`${empresa} ${ciudad ?? ''}`)
  return `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(kw)}`
}

/** Búsqueda GENERAL vía Google: todos los perfiles de LinkedIn ligados a la empresa. */
export function googleEmpresaUrl(empresa: string, ciudad?: string): string {
  const q = limpio(`site:linkedin.com/in "${empresa}" ${ciudad ?? ''}`)
  return `https://www.google.com/search?q=${encodeURIComponent(q)}`
}

/** Busca el equipo/contacto en la web del negocio (dato público). */
export function webTeamUrl(web: string | null): string | null {
  const host = dominioDe(web)
  if (!host) return null
  return `https://www.google.com/search?q=${encodeURIComponent(`site:${host} (equipo OR nosotros OR contacto OR staff OR "quiénes somos")`)}`
}

export interface LkContacto { nombre: string; cargo: string | null; empresa: string | null; ubicacion: string | null }

/**
 * Parsea el texto copiado de una búsqueda de personas de LinkedIn.
 * NO scrapea: solo ordena el texto que el usuario copió a mano (legal, sin riesgo de ban).
 * Se ancla en el grado de conexión (• 1º / • 2º / • 3er) para detectar cada persona.
 */
export function parseLinkedinContactos(texto: string): LkContacto[] {
  const lines = texto.split('\n').map((l) => l.trim()).filter(Boolean)
  const esGrado = (l: string) => /•\s*(1|2|3)/.test(l)
  const out: LkContacto[] = []
  for (let i = 0; i < lines.length; i++) {
    if (!esGrado(lines[i])) continue
    // Nombre: lo previo al •, sin el badge de verificado ni símbolos finales.
    let nombre = lines[i].split('•')[0].replace(/[|].*$/, '').trim()
    nombre = nombre.replace(/[^\p{L}\p{M}.\-'\s]+$/u, '').trim()
    if (nombre.length < 3 || /conectar|seguir/i.test(nombre)) continue
    let cargo: string | null = null, empresa: string | null = null, ubicacion: string | null = null
    for (let j = i + 1; j < Math.min(i + 7, lines.length); j++) {
      const l = lines[j]
      if (esGrado(l)) break
      if (/contactos.*en com[uú]n|seguidores|^conectar$/i.test(l)) continue
      const isActual = /^actual:/i.test(l)
      const cont = l.replace(/^actual:\s*/i, '')
      if (/ en /i.test(cont)) {
        // La línea "Actual: Cargo en Empresa" es la más confiable; si aparece, pisa.
        if (isActual || !cargo) {
          const idx = cont.toLowerCase().lastIndexOf(' en ')
          cargo = cont.slice(0, idx).trim()
          empresa = cont.slice(idx + 4).trim()
        }
        continue
      }
      // Ubicación: línea corta sin cargo-soup (sin pipes) ni "Actual:".
      if (!ubicacion && !isActual && !/\|/.test(l) && l.length < 60) ubicacion = l
    }
    out.push({ nombre, cargo, empresa, ubicacion })
  }
  // Dedup por nombre+empresa
  const vistos = new Set<string>()
  return out.filter((c) => { const k = `${c.nombre}|${c.empresa}`.toLowerCase(); if (vistos.has(k)) return false; vistos.add(k); return true })
}

/** Extrae el dominio de una URL o string. */
export function dominioDe(web: string | null): string | null {
  if (!web) return null
  try {
    const u = new URL(web.startsWith('http') ? web : `https://${web}`)
    return u.hostname.replace(/^www\./, '')
  } catch {
    return null
  }
}
