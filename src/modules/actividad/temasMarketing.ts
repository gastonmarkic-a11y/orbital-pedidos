// Fuente única de las carpetas ("temas") de piezas de marketing.
// Las conocidas se enganchan con el motor de envíos (propuestas); el resto
// son carpetas libres del equipo.

export interface TemaMeta {
  key: string
  icono: string
  label: string
  desc: string
}

export const TEMAS: TemaMeta[] = [
  { key: 'bienvenida', icono: '🤝', label: 'Propuesta Bienvenida', desc: 'Todo para sumar ópticas nuevas: copy, guión, propuesta y video' },
  { key: 'canje', icono: '↩', label: 'Plan Canje', desc: 'Material para clientes activos con stock parado' },
  { key: 'preventa', icono: '🕶', label: 'Preventa Colección', desc: 'Copy, guión y catálogo de la preventa 2026' },
  { key: 'recuperar', icono: '📋', label: 'Clientes a Recuperar', desc: 'Guías de diagnóstico y propuesta segmentada' },
  { key: 'general', icono: '📚', label: 'Material general', desc: 'Listas de precios, catálogos, imágenes y videos' },
]

// Carpetas que se enganchan solas con los envíos de esa propuesta.
export const TEMAS_ENGANCHE = ['bienvenida', 'canje', 'preventa', 'recuperar']

// Metadata de una carpeta: conocida (con ícono/desc) o creada por el admin (📁 genérica)
export function metaTema(key: string): TemaMeta {
  const conocido = TEMAS.find((t) => t.key === key)
  if (conocido) return conocido
  return {
    key,
    icono: '📁',
    label: key.charAt(0).toUpperCase() + key.slice(1).replace(/[-_]/g, ' '),
    desc: 'Carpeta de material del equipo',
  }
}
