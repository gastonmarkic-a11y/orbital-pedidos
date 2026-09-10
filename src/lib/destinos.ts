import { useEffect, useState } from 'react'
import { supabase } from './supabase'

export type Destino = { codigo: string; label: string; rol: 'vendedor' | 'revendedor' }

// A quién se le puede derivar / reasignar un cliente: los vendedores y revendedores
// ACTIVOS de la tabla `vendedores`. Antes era una lista fija en cada pantalla y quedaba
// gente que ya no está (Luna, Damián, Martín) y faltaban los nuevos (Bruno, Ulises,
// revendedores). Para sumar o sacar a alguien alcanza con activarlo/desactivarlo.
export function useDestinos() {
  const [destinos, setDestinos] = useState<Destino[]>([])
  useEffect(() => {
    supabase
      .from('vendedores')
      .select('codigo,nombre,rol')
      .eq('activo', true)
      .in('rol', ['vendedor', 'revendedor'])
      .then(({ data }) => {
        const filas = (data as { codigo: string; nombre: string | null; rol: Destino['rol'] }[]) ?? []
        const lista = filas.map((v) => ({
          codigo: v.codigo,
          rol: v.rol,
          label: (v.rol === 'revendedor' ? '🔁 ' : '') + (v.nombre || v.codigo).replace(/\s*\((Vendedor|Revendedor)\)\s*$/i, ''),
        }))
        // Vendedores primero, revendedores al final; alfabético dentro de cada grupo.
        lista.sort((a, b) => (a.rol === b.rol ? a.label.localeCompare(b.label, 'es') : a.rol === 'vendedor' ? -1 : 1))
        setDestinos(lista)
      })
  }, [])
  return destinos
}
