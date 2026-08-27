// Trae los nombres de color reales desde Shopify para pisar los del catalogo.
//
// Por que: stock.descripcion tiene abreviaturas internas ("AzOscCl Celeste", "Ma Ha deg")
// que interprete a mano y en varios casos mal — "AzOscCl" no era "Azul Oscuro Clear"
// sino "Azul Brillo". El titulo de las publicaciones de ML sale de ahi, y ese titulo se
// congela al crear, asi que un color mal escrito queda mal para siempre.
//
// Shopify es la fuente correcta: el titulo de cada variante es el nombre que ve el cliente.
//
// Modos:
//   (sin parametros) -> informe de diferencias. NO escribe.
//   ?guardar=1       -> pisa stock.descripcion con el nombre de Shopify.

import { db, json } from '../_shared/ml.ts'

const API = '2024-01'

interface Variante { sku: string | null; title: string }
interface Producto { title: string; variants: Variante[] }

const norm = (p: string) => p.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

/** Normaliza para comparar: sin acentos, sin espacios de mas, minuscula. */
function clave(s: string): string {
  return norm(s).replace(/\s*\/\s*/g, ' / ').replace(/\s+/g, ' ').trim()
}

const COLORES: Record<string, string> = {
  black: 'Negro', white: 'Blanco', gray: 'Gris', grey: 'Gris', brown: 'Marrón',
  green: 'Verde', blue: 'Azul', red: 'Rojo', pink: 'Rosa', orange: 'Naranja',
  yellow: 'Amarillo', purple: 'Violeta', violet: 'Violeta', silver: 'Plata',
  gold: 'Dorado', golden: 'Dorado', ivory: 'Marfil',
  turquoise: 'Turquesa', bordeaux: 'Bordo', burgundy: 'Bordo',
}

/**
 * Adjetivos: van DESPUES del color en español.
 *
 * TODAS las claves de esta tabla tienen que ser palabras que NO existan en castellano.
 * "flash", "clear" y "crystal" estuvieron aca y hubo que sacarlas: se escriben igual en
 * los dos idiomas, y como cualquier coincidencia habilita el reordenamiento, hacian que
 * nombres que ya estaban bien salieran dados vuelta — "Negro Mate / Flash Degrade Verde"
 * terminaba en "Degrade Verde Flash", y "Clear Mate / Naranja" en "Mate Clear / Naranja".
 * Antes de agregar una clave nueva: si la palabra se usa en castellano, no va.
 */
const ADJETIVOS: Record<string, string> = {
  matt: 'Mate', matte: 'Mate', shiny: 'Brillo', shinny: 'Brillo', glossy: 'Brillo',
  gradiant: 'Degradé', gradient: 'Degradé', mirror: 'Espejado', mirrored: 'Espejado',
  polarized: 'Polarizado', dark: 'Oscuro', light: 'Claro', transparent: 'Transparente',
}

/**
 * Traduce un lado del color (armazon o cristal) reordenando adjetivo y color.
 * En ingles el adjetivo va antes ("Matt Black") y en castellano despues ("Negro Mate").
 */
function traducirLado(txt: string): string {
  const palabras = txt.trim().split(/\s+/).filter(Boolean)
  if (!palabras.length) return txt.trim()
  // Sin ninguna palabra en ingles no se toca nada: el nombre ya esta en castellano.
  if (!palabras.some((p) => COLORES[norm(p)] || ADJETIVOS[norm(p)])) return txt.trim()

  const colores: string[] = [], adjetivos: string[] = []
  for (const p of palabras) {
    const k = norm(p)
    if (COLORES[k])        colores.push(COLORES[k])
    else if (ADJETIVOS[k]) adjetivos.push(ADJETIVOS[k])
    else                   colores.push(p)
  }
  return [...colores, ...adjetivos].join(' ')
}

/** Traduce "Matt Black / Gradiant Gray" -> "Negro Mate / Gris Degradé". */
function traducir(txt: string): string {
  return txt.split('/').map(traducirLado).join(' / ')
}

Deno.serve(async (req) => {
  try {
    const sb = db()
    const guardar = new URL(req.url).searchParams.get('guardar') === '1'

    const { data: tienda, error } = await sb.from('shopify_stores')
      .select('shop_domain, access_token').limit(1).single()
    if (error || !tienda) return json({ error: 'No hay tienda de Shopify conectada' }, 400)

    const { data: stock } = await sb.from('stock').select('codigo, modelo, descripcion')
    const enCatalogo = new Map((stock ?? []).map((s) => [s.codigo, s]))

    const productos: Producto[] = []
    let next: string | null =
      `https://${tienda.shop_domain}/admin/api/${API}/products.json?limit=250&fields=title,variants`
    while (next) {
      const res: Response = await fetch(next, {
        headers: { 'X-Shopify-Access-Token': tienda.access_token, accept: 'application/json' },
      })
      if (!res.ok) return json({ error: `Shopify ${res.status}` }, 500)
      const body = await res.json()
      productos.push(...(body.products ?? []))
      const m = (res.headers.get('link') ?? '').match(/<([^>]+)>;\s*rel="next"/)
      next = m ? m[1] : null
    }

    const diferencias: Record<string, unknown>[] = []
    let iguales = 0, cambiadas = 0, sinSku = 0

    for (const p of productos) {
      for (const v of p.variants) {
        if (!v.sku) { sinSku++; continue }
        const fila = enCatalogo.get(v.sku)
        if (!fila) continue

        const original = (v.title ?? '').trim()
        const nuevo = traducir(original)
        const viejo = (fila.descripcion ?? '').trim()
        if (!nuevo || nuevo === 'Default Title') continue
        if (clave(nuevo) === clave(viejo)) { iguales++; continue }

        // Shopify tiene su propia mugre: hubo un find/replace de "sc" por "Con Lentilla"
        // que dejo cosas como "Verde OCon Lentillauro" (era "Verde Oscuro"). Esas no se
        // pisan solas — se marcan para revisar a mano.
        const rota = /Con Lentilla[a-z]|[a-z]Con Lentilla/.test(nuevo)
        // Mojibake: Shopify tiene variantes donde la tilde llego rota ("Gris Degrad?©",
        // "Ã©", "�"). Copiarlas tal cual mando 8 titulos corruptos a ML el 2026-08-21, y
        // el titulo se congela al crear: no se pueden arreglar despues. Se marcan y no se
        // escriben. Cualquier caracter fuera del castellano normal es sospechoso.
        const mojibake = /[?�]©|Ã.|[^\x20-\x7EáéíóúüñÁÉÍÓÚÜÑ°ºª/·—–]/.test(nuevo)
        // Palabra en ingles que quedo sin traducir: falta una entrada en el diccionario.
        const sinTraducir = /\b(matt|matte|shiny|shinny|glossy|gradiant|gradient|mirror|mirrored|polarized|dark|light|transparent|black|white|gray|grey|brown|green|blue|red|pink|orange|yellow|purple|violet|silver|gold|golden|ivory|turquoise|bordeaux|burgundy)\b/i
          .test(nuevo)
        const alerta = rota ? 'shopify roto'
          : mojibake ? 'caracteres corruptos'
          : sinTraducir ? 'quedo ingles' : null

        diferencias.push({
          codigo: v.sku, modelo: fila.modelo,
          catalogo: viejo, shopify: original, propuesto: nuevo,
          ...(alerta ? { alerta } : {}),
        })

        if (guardar && !alerta) {
          const { error: err } = await sb.from('stock')
            .update({ descripcion: nuevo, updated_at: new Date().toISOString() })
            .eq('codigo', v.sku)
          if (!err) cambiadas++
        }
      }
    }

    return json({
      ok: true,
      modo: guardar ? 'guardado' : 'informe — no se escribio nada',
      coinciden: iguales,
      difieren: diferencias.length,
      con_alerta: diferencias.filter((d) => d.alerta).length,
      cambiadas,
      variantes_sin_sku: sinSku,
      diferencias,
    })
  } catch (e) {
    return json({ error: String(e) }, 500)
  }
})
