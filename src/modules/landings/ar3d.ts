// Anteojos en 3D de los modelos destacados: public/ar/3d/index.json lo arma scripts/ar-3d.mjs
// ({ modelos: { MODELO: { codigo: archivo.glb } } }). Si un modelo no está, se usa el probador 2D.
export type Indice3D = Record<string, Record<string, string>>

let cache: Promise<Indice3D> | null = null
export function indice3D(): Promise<Indice3D> {
  cache ??= fetch('/ar/3d/index.json').then((r) => (r.ok ? r.json() : { modelos: {} })).then((d) => d.modelos ?? {}).catch(() => ({}))
  return cache
}

export const url3D = (archivo: string) => `/ar/3d/${archivo}`
