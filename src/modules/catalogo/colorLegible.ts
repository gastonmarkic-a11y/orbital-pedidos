// Convierte las descripciones internas de color a nombres legibles para la óptica.
// Corrige espaciado alrededor de la barra, expande abreviaturas (ngb=negro brillo, etc.)
// y aplica Title Case. El nombre interno del pedido queda intacto: esto es solo display.

// Abreviaturas "pegadas" o de varias letras que hay que expandir como token completo.
const TOKENS: [RegExp, string][] = [
  [/\bazosccl\b/g, 'azul oscuro clear'],
  [/\bhad\b/g, 'habano degrade'],
  [/\bvem\b/g, 'verde mate'],
  [/\bngb\b/g, 'negro brillo'],
  [/\bngm\b/g, 'negro mate'],
  [/\binco\b/g, 'incoloro'],
  // abreviaturas simples de color (armazón)
  [/\bam\b/g, 'amarillo'],
  [/\baz\b/g, 'azul'],
  [/\bbl\b/g, 'blanco'],
  [/\bce\b/g, 'celeste'],
  [/\bcel\b/g, 'celeste'],
  [/\bgr\b/g, 'gris'],
  [/\bna\b/g, 'naranja'],
  [/\bro\b/g, 'rojo'],
  [/\bha\b/g, 'habano'],
  [/\bma\b/g, 'marfil'],
  [/\bcl\b/g, 'clear'],
  [/\bosc\b/g, 'oscuro'],
  [/\bdeg\b/g, 'degrade'],
  [/\bpol\b/g, 'polarizado'],
  [/\bar\b/g, 'antirreflex'],
  [/\bbrill\b/g, 'brillo'],
  // correcciones de tipeo frecuentes
  [/\bantireflex\b/g, 'antirreflex'],
  [/\bespejp\b/g, 'espejo'],
]

export function colorLegible(desc: string | null | undefined): string {
  if (!desc) return ''
  let s = desc.trim().toLowerCase()
  // "sin cristal" ANTES de tocar las barras (s/c usa barra)
  s = s.replace(/\bs\s*\/\s*c\b/g, 'sin cristal')
  // normalizar barra separadora y espacios
  s = s.replace(/\s*\/\s*/g, ' / ').replace(/\s+/g, ' ').trim()
  for (const [re, rep] of TOKENS) s = s.replace(re, rep)
  s = s.replace(/\s+/g, ' ').trim()
  // Title Case (la barra y símbolos quedan intactos)
  s = s.replace(/[a-záéíóúñü]+/g, (w) => w.charAt(0).toUpperCase() + w.slice(1))
  return s
}
