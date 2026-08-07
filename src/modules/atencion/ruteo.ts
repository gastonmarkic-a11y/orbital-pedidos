// Ruteo de derivaciones por tema (criterio acordado con Gastón):
//  - envíos / posventa / stock  → Mauro
//  - comercial (precio mayorista / óptica) → Prospección (Luna/Damián/venta directa)
//  - redes / general / no codificable → Gastón
// Se usa para mostrar el responsable y para las alertas "las mías" (app) y por mail.

export function responsableLabel(motivo: string, tipo: string | null): string {
  if (['pagos_cobranza'].includes(motivo)) return 'Administración (pagos/cobranza)'
  if (['envio_incidencia', 'confirmar_stock'].includes(motivo)) return 'Mauro (envíos)'
  if (motivo === 'reclamo_excepcion') return 'Mauro (posventa)'
  if (motivo === 'precio_mayorista' || (motivo === 'iris_deriva' && tipo === 'mayorista')) return 'Prospección (Luna/Damián)'
  return 'Gastón (general/redes)'
}

// Códigos de usuario responsables del tema (para filtrar "las mías").
export function responsableCodes(motivo: string, tipo: string | null): string[] {
  if (motivo === 'pagos_cobranza') return ['Administracion']
  if (['envio_incidencia', 'confirmar_stock', 'reclamo_excepcion'].includes(motivo)) return ['Mauro']
  if (motivo === 'precio_mayorista' || (motivo === 'iris_deriva' && tipo === 'mayorista')) return ['Marketing', 'Damian', 'ProspeccionVenta']
  return ['Gaston']
}

// ¿Esta derivación le corresponde a este usuario? Administración ve todo.
export function esMia(motivo: string, tipo: string | null, codigo: string | null, rol: string | null): boolean {
  if (rol === 'administracion') return true
  if (!codigo) return false
  return responsableCodes(motivo, tipo).includes(codigo)
}
