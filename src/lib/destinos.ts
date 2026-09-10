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
      // Mauro es admin pero también recibe clientes.
      .or('rol.in.(vendedor,revendedor),codigo.eq.Mauro')
      .then(({ data }) => {
        const filas = (data as { codigo: string; nombre: string | null; rol: string }[]) ?? []
        const lista: Destino[] = filas.map((v) => ({
          codigo: v.codigo,
          rol: v.rol === 'revendedor' ? 'revendedor' : 'vendedor',
          label: (v.rol === 'revendedor' ? '🔁 ' : '') + (v.nombre || v.codigo).replace(/\s*\((Vendedor|Revendedor|Admin)\)\s*$/i, ''),
        }))
        // Vendedores primero, revendedores al final; alfabético dentro de cada grupo.
        lista.sort((a, b) => (a.rol === b.rol ? a.label.localeCompare(b.label, 'es') : a.rol === 'vendedor' ? -1 : 1))
        setDestinos(lista)
      })
  }, [])
  return destinos
}
