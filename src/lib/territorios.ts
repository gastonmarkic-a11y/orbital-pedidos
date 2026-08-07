// Estructura territorial comercial de Argentina (regiones → provincias).
// Data-driven: el resto de los KPIs (facturación, clientes, etc.) se cruzan por provincia.
// Los nombres de provincia son los CANÓNICOS que devuelve la RPC prov_canonica().

export interface Territorio {
  region: string
  provincias: string[]
  unico?: boolean // territorio de una sola unidad (abre directo a clientes)
}

export const TERRITORIOS: Territorio[] = [
  { region: 'CENTRO', provincias: ['Córdoba', 'Santa Fe', 'Entre Ríos'] },
  { region: 'CUYO', provincias: ['Mendoza', 'San Juan', 'San Luis'] },
  { region: 'NOA', provincias: ['Jujuy', 'Salta', 'Tucumán', 'Catamarca', 'Santiago del Estero'] },
  { region: 'NEA', provincias: ['Formosa', 'Chaco', 'Corrientes', 'Misiones'] },
  { region: 'PATAGONIA', provincias: ['La Pampa', 'Neuquén', 'Río Negro', 'Chubut', 'Santa Cruz', 'Tierra del Fuego'] },
  { region: 'CABA', provincias: ['CABA'], unico: true },
  { region: 'BUENOS AIRES', provincias: ['Buenos Aires'], unico: true },
]

// Provincias que están dentro de alguna región definida (para detectar "otros").
export const PROVINCIAS_MAPEADAS = new Set(TERRITORIOS.flatMap((t) => t.provincias))

// Provincia (canónica) → región. Para agrupar carteras/clientes por región en el front.
export const PROV_REGION: Record<string, string> = {}
for (const t of TERRITORIOS) for (const p of t.provincias) PROV_REGION[p] = t.region

export function regionDeProvincia(prov: string | null | undefined): string {
  const p = (prov ?? '').trim()
  if (!p) return 'Sin zona'
  if (PROV_REGION[p]) return PROV_REGION[p]
  const norm = p.toLowerCase()
  for (const k in PROV_REGION) if (k.toLowerCase() === norm) return PROV_REGION[k]
  if (/ciudad aut|capital federal|c\.?a\.?b\.?a/.test(norm)) return 'CABA'
  if (/buenos aires|bs\.? ?as/.test(norm)) return 'BUENOS AIRES'
  return 'Otros'
}
