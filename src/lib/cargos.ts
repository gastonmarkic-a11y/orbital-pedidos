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
