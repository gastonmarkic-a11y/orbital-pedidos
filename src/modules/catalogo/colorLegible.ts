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

// Color aproximado del armazón (primer color mencionado) para un swatch visual,
// así se distinguen los colores aunque compartan la foto del modelo.
const SWATCH: [RegExp, string][] = [
  [/negro|ngb|ngm|matt black/i, '#1b1b1b'],
  [/carey/i, '#6b3f1d'],
  [/habano|ha\b/i, '#9c6b3a'],
  [/marr[oó]n|marron|ma\b/i, '#5b3a1a'],
  [/bordo|bord[oó]|cherry/i, '#6b1f2b'],
  [/rojo|ro\b|red/i, '#c0392b'],
  [/naranja|na\b|orange/i, '#e67e22'],
  [/amarillo|am\b/i, '#f1c40f'],
  [/verde|vem?\b|green/i, '#2e7d32'],
  [/celeste|ce\b/i, '#5bc0eb'],
  [/azul|az\b|blue/i, '#2456b5'],
  [/violeta|lila/i, '#7d3cad'],
  [/rosa|pink/i, '#e78fb3'],
  [/dorado|oro|gold|champ/i, '#c9a227'],
  [/plata|plateado|niquel|silver/i, '#c0c0c0'],
  [/gris|gr\b|gray|peltre|cobre/i, '#8a8a8a'],
  [/beige|arena|hueso|marfil|nude|pastel/i, '#d9c6a5'],
  [/blanco|white/i, '#f0f0f0'],
  [/clear|cristal|incoloro|transp/i, '#dfe7ee'],
]
export function colorSwatch(desc: string | null | undefined): string {
  if (!desc) return '#cccccc'
  for (const [re, hex] of SWATCH) if (re.test(desc)) return hex
  return '#cccccc'
}

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
