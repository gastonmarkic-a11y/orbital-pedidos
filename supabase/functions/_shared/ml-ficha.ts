// Ficha de producto para Mercado Libre: plantillas, atributos, descripcion y fotos.
// Compartido por ml-publicar y ml-tienda-espejo para que las dos armen la publicacion igual.
// La explicacion de cada regla esta en el encabezado de ml-publicar.

import { db, ml } from './ml.ts'

export const PLANTILLA = { sol: 'MLA3311888850', receta: 'MLA3332066566' }

const CLONAR = [
  'category_id', 'listing_type_id', 'buying_mode', 'condition', 'currency_id',
  'shipping', 'sale_terms', 'warranty', 'official_store_id',
] as const

// Atributos FISCALES: son de la cuenta/producto, no del modelo, asi que estos SI se
// clonan. La categoria los exige (VALUE_ADDED_TAX = IVA, IMPORT_DUTY = impuesto interno)
// y clonarlos evita que elijamos nosotros un valor impositivo.
const FISCALES = ['VALUE_ADDED_TAX', 'IMPORT_DUTY']

export interface Plantilla {
  item_id: string
  config: Record<string, unknown>
  fiscales: { id: string; value_name: string }[]
}

export async function leerPlantilla(id: string, token: string): Promise<Plantilla | { error: string }> {
  const res = await ml(`/items/${id}`, token)
  if (!res.ok) return { error: `plantilla ${id}: ${res.status} ${await res.text()}` }
  const it = await res.json()

  const config: Record<string, unknown> = {}
  for (const k of CLONAR) if (it[k] !== undefined && it[k] !== null) config[k] = it[k]

  // La campaña de cuotas la administra ML a nivel cuenta y no se puede setear al crear
  // ("Not allowed to modify sale term INSTALLMENTS_CAMPAIGN"). Se saca: el acuerdo de
  // cuotas se aplica solo a las publicaciones nuevas.
  if (Array.isArray(config.sale_terms)) {
    config.sale_terms = (config.sale_terms as { id: string }[])
      .filter((t) => t.id !== 'INSTALLMENTS_CAMPAIGN')
  }
  const fiscales = (it.attributes ?? [])
    .filter((a: { id: string; value_name: unknown }) => FISCALES.includes(a.id) && a.value_name != null)
    .map((a: { id: string; value_name: string }) => ({ id: a.id, value_name: a.value_name }))

  return { item_id: id, config, fiscales }
}

export function initcap(s: string): string {
  return s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())
}

/**
 * "Negro Brillo / Gris Degradé" -> { armazon: 'Negro Brillo', cristal: 'Gris Degradé' }
 *
 * El separador se toma con tolerancia porque el catalogo escribe la barra de tres formas
 * distintas ("Carey / Habano", "Carey/ Habano", "Marron Brillo  / Habano"): 145 de 525
 * SKUs publicables no usan el " / " canonico. Partiendo solo por " / " esos 145 quedaban
 * enteros como armazon y el titulo salia con la barra adentro ("Wynwood Ii Carey/ Habano").
 */
export function partirColor(color: string | null): { armazon: string; cristal: string } {
  const partes = (color ?? '').split(/\s*\/\s*/)
  const armazon = partes[0]?.trim() ?? ''
  let cristal = partes[1]?.trim() ?? ''
  // "Habano / Habano Degradé Flash" -> no repetir el armazon dentro del cristal
  if (armazon && cristal.toLowerCase().startsWith(armazon.toLowerCase())) {
    cristal = cristal.slice(armazon.length).trim()
  }
  return { armazon, cristal }
}

export interface Fila {
  codigo: string
  modelo: string
  color: string | null
  tipo: string | null
  tratamiento: string | null
  precio: number
  cantidad_publicable: number
  seccion: string | null
}

/** Ficha tecnica del producto, armada desde el catalogo. De aca sale el titulo que genera ML. */
const BORRAR = ['FRAME_SHAPE', 'TEMPLE_COLOR', 'DETAILED_MODEL', 'ALPHANUMERIC_MODEL']

export function armarAtributos(row: Fila): { id: string; value_name: string | null }[] {
  const { armazon, cristal } = partirColor(row.color)
  const attrs: { id: string; value_name: string | null }[] = [
    { id: 'BRAND', value_name: 'Orbital' },
    { id: 'MODEL', value_name: initcap(row.modelo) },
    // GENDER es lista cerrada: Mujer | Hombre | Niñas | Niños | Bebés | Sin género
    // infantil | Sin género. "Unisex" NO existe; el equivalente es "Sin género", que es
    // ademas el que no recorta busquedas.
    { id: 'GENDER', value_name: 'Sin género' },
  ]
  // El armazon va en COLOR y no en FRAME_COLOR. ML arma el titulo recorriendo la ficha de
  // la categoria en SU orden, y en MLA417128 ese orden es COLOR(5) -> LENS_COLOR(6) ->
  // FRAME_COLOR(10). Con el armazon en FRAME_COLOR el titulo salia con el cristal adelante
  // ("Le Mans Ocre Negro Brillo"); en COLOR sale "Le Mans Negro Brillo Ocre".
  // El cristal no se puede omitir para evitarlo: LE MANS tiene 5 variantes con el mismo
  // armazon y sin el cristal las 5 publicaciones quedarian con el titulo identico.
  if (armazon) attrs.push({ id: 'COLOR', value_name: armazon })
  // En receta FRAME_COLOR ademas alimenta el filtro de color de armazon y no ensucia el
  // titulo (MLA417127 no lo usa para armarlo), asi que ahi se manda tambien.
  if (armazon && row.tipo === 'receta') attrs.push({ id: 'FRAME_COLOR', value_name: armazon })
  if (cristal) attrs.push({ id: 'LENS_COLOR', value_name: cristal })
  if (row.tratamiento !== 'lentilla') attrs.push({ id: 'WITH_UV_PROTECTION', value_name: 'Sí' })
  // Un PUT de attributes agrega y pisa, pero NO elimina: sin borrarlos, los heredados de
  // la plantilla sobreviven y ensucian el titulo. FRAME_SHAPE se borra porque el catalogo
  // no tiene la forma del armazon y no se inventa.
  const borrar = [...BORRAR]
  if (row.tipo !== 'receta') borrar.push('FRAME_COLOR')
  if (!armazon) borrar.push('COLOR')
  for (const id of borrar) attrs.push({ id, value_name: null })
  return attrs
}

/** family_name agrupa las variantes: el modelo sin color ni diferencial. */

/** Linea de proteccion segun el tratamiento del cristal. Solo lo verificable. */
function lineaProteccion(t: string | null): string {
  switch (t) {
    case 'Infrarrojo + Blue cut': return 'Triple Proteccion — UV400 + infrarrojo + luz azul en el mismo cristal'
    case 'Blue cut':              return 'Filtro de luz azul — pensado para pantallas y jornadas largas'
    case 'polarizado':            return 'Cristal polarizado — corta el reflejo del agua, la nieve y el asfalto · UV400'
    case 'revo':                  return 'Cristal espejado con proteccion UV400'
    case 'lentilla':              return 'Armazon para receta — se coloca tu cristal recetado'
    default:                      return 'Proteccion UV400'
  }
}

/**
 * Descripcion de la publicacion. A diferencia del titulo, ML SI deja escribirla.
 * Solo entra lo verificable contra el catalogo: color y tratamiento salen de stock;
 * el resto son las claims de marca que confirmo Gaston como universales.
 */
export function armarDescripcion(row: Fila): string {
  const { armazon, cristal } = partirColor(row.color)
  const color = cristal
    ? 'Armazon ' + armazon + ' · cristal ' + cristal
    : 'Armazon ' + armazon
  return [
    'Tecnologia XYLON® — armazon liviano, flexible y pensado para todo el dia',
    '',
    '◼ ' + lineaProteccion(row.tratamiento),
    '◼ ' + color,
    '◼ Con tecnologia ORBITAL VSL™ — mayor contraste y reduccion de reflejos',
    '◼ Herrajes metalicos de alta calidad — detalle de precision en cada patilla',
    '◼ Incluye caja, funda acolchada y paño de microfibra',
    '◼ Hecho en Argentina — diseñado y fabricado con conviccion premium',
    '◼ Unisex — proporcionado para una amplia variedad de rostros',
  ].join('\n')
}

export function armarFamilia(row: Fila): string {
  const base = row.tipo === 'receta' ? 'Anteojos Orbital' : 'Anteojos De Sol Orbital'
  return `${base} ${initcap(row.modelo)}`
}

/** El estuche no es foto de producto: nunca puede ir de portada. */
export const ES_ESTUCHE = /packaging|estuche|funda|caja/i

/**
 * Fotos de la publicacion, de la mas representativa a la menos.
 *
 * El orden importa porque ML toma la PRIMERA como portada, y es la unica que se ve en un
 * carrusel o en los resultados de busqueda. Antes solo se priorizaba "la del color exacto",
 * y en 164 SKUs esa foto es el packaging que vino de Shopify: la portada terminaba siendo
 * una caja en vez del anteojo.
 *
 * Prioridad: color exacto -> foto del modelo -> estuche al final.
 */
export async function fotosDe(sb: ReturnType<typeof db>, row: Fila) {
  const { data } = await sb.from('producto_imagenes')
    .select('url, codigo, orden')
    .or(`codigo.eq.${row.codigo},modelo.eq.${row.modelo}`)
    .order('orden', { nullsFirst: false })

  const rango = (f: { url: string; codigo: string | null }) =>
    ES_ESTUCHE.test(f.url) ? 2 : f.codigo === row.codigo ? 0 : 1

  const ord = (data ?? []).slice().sort((a, b) => rango(a) - rango(b))
  return ord.slice(0, 10).map((f) => ({ source: f.url }))
}

