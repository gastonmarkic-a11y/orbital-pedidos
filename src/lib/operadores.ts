// Nombre de pila real de cada operador según su código de vendedor.
//
// Hace falta porque algunas cuentas son compartidas o tienen nombre de área en la base:
// `Marketing` figura como "Prospección" en vendedores.nombre, pero quien la usa es Luna,
// y firmar un WhatsApp como "Soy Prospección de Orbital" queda impersonal.

export const NOMBRE_OPERADOR: Record<string, string> = {
  Marketing: 'Luna',
  Damian: 'Damián',
  ProspeccionVenta: 'Damián', // histórico: contactos viejos de Damián antes de mudar su código
  Adrian: 'Adrián',
  Martin: 'Martín',
  Corporativo: 'Corporativo',
}

/**
 * Nombre visible del operador. Si el código no está mapeado, usa el nombre cargado en
 * la base (o el propio código como último recurso).
 */
export function nombreOperador(codigo: string | null | undefined, fallback?: string | null): string {
  if (codigo && NOMBRE_OPERADOR[codigo]) return NOMBRE_OPERADOR[codigo]
  return fallback || codigo || ''
}

/** Solo el nombre de pila, para firmar mensajes ("Hola! Soy Luna de Orbital Eyewear."). */
export function nombreDePila(codigo: string | null | undefined, fallback?: string | null): string {
  return (nombreOperador(codigo, fallback) || 'el equipo').split(' ')[0]
}
