// Alta de publicaciones nuevas en Mercado Libre.
//
// Que se clona y que no:
//   - SE CLONA de una publicacion activa que ya vende: categoria, tipo de publicacion
//     (gold_pro), envio y garantia. Asi las nuevas nacen con la config real de la cuenta.
//   - NO SE CLONAN los atributos: hacerlo le pegaba la forma y el color de la plantilla a
//     todos los productos ("5th Avenue Envolvente Negro", que es LONG BEACH). Los
//     atributos salen del catalogo.
//
// Sobre el titulo: en esta categoria ML lo GENERA desde la ficha tecnica y rechaza
// cualquier intento de escribirlo (PUT title -> 400). Las publicaciones viejas tienen
// titulo libre porque son anteriores a esa regla. Entonces la unica forma de controlar el
// titulo es controlar los atributos.
//
// La categoria MLA417128 (anteojos de sol) exige solo BRAND, MODEL y GENDER.
// FRAME_SHAPE es opcional y NO se manda: el catalogo no tiene la forma del armazon.
//
// Plantillas (activas y con ventas):
//   sol    -> MLA3311888850  (LONG BEACH, categoria MLA417128)
//   receta -> MLA3332066566  (BUENOS AIRES I pantallas, categoria MLA417127)
//
// Modos:
//   (sin parametros)   -> muestra la config de las plantillas. No escribe nada.
//   ?codigo=XXX        -> crea UNA publicacion para ese SKU, pausada.
//   ?modelos=A,B       -> crea todas las pendientes de esos modelos, pausadas.
//   ?arreglar=1        -> corrige los atributos de las YA creadas por esta funcion.
//
// Nacen PAUSADAS: la foto disponible es del modelo, no del color exacto.

import { db, getToken, ml, json } from '../_shared/ml.ts'

const PLANTILLA = { sol: 'MLA3311888850', receta: 'MLA3332066566' }

const CLONAR = [
  'category_id', 'listing_type_id', 'buying_mode', 'condition', 'currency_id',
  'shipping', 'sale_terms', 'warranty', 'official_store_id',
] as const

// Atributos FISCALES: son de la cuenta/producto, no del modelo, asi que estos SI se
// clonan. La categoria los exige (VALUE_ADDED_TAX = IVA, IMPORT_DUTY = impuesto interno)
// y clonarlos evita que elijamos nosotros un valor impositivo.
const FISCALES = ['VALUE_ADDED_TAX', 'IMPORT_DUTY']

interface Plantilla {
  item_id: string
  config: Record<string, unknown>
  fiscales: { id: string; value_name: string }[]
}

async function leerPlantilla(id: string, token: string): Promise<Plantilla | { error: string }> {
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

function initcap(s: string): string {
  return s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())
}

/** "Negro Brillo / Gris Degradé" -> { armazon: 'Negro Brillo', cristal: 'Gris Degradé' } */
function partirColor(color: string | null): { armazon: string; cristal: string } {
  const partes = (color ?? '').split(' / ')
  const armazon = partes[0]?.trim() ?? ''
  let cristal = partes[1]?.trim() ?? ''
  // "Habano / Habano Degradé Flash" -> no repetir el armazon dentro del cristal
  if (armazon && cristal.toLowerCase().startsWith(armazon.toLowerCase())) {
    cristal = cristal.slice(armazon.length).trim()
  }
  return { armazon, cristal }
}

interface Fila {
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
const BORRAR = ['FRAME_SHAPE', 'COLOR', 'TEMPLE_COLOR', 'DETAILED_MODEL', 'ALPHANUMERIC_MODEL']

function armarAtributos(row: Fila): { id: string; value_name: string | null }[] {
  const { armazon, cristal } = partirColor(row.color)
  const attrs: { id: string; value_name: string | null }[] = [
    { id: 'BRAND', value_name: 'Orbital' },
    { id: 'MODEL', value_name: initcap(row.modelo) },
    // GENDER es lista cerrada: Mujer | Hombre | Niñas | Niños | Bebés | Sin género
    // infantil | Sin género. "Unisex" NO existe; el equivalente es "Sin género", que es
    // ademas el que no recorta busquedas.
    { id: 'GENDER', value_name: 'Sin género' },
  ]
  if (armazon) attrs.push({ id: 'FRAME_COLOR', value_name: armazon })
  if (cristal) attrs.push({ id: 'LENS_COLOR', value_name: cristal })
  if (row.tratamiento !== 'lentilla') attrs.push({ id: 'WITH_UV_PROTECTION', value_name: 'Sí' })
  // Un PUT de attributes agrega y pisa, pero NO elimina: sin borrarlos, los heredados de
  // la plantilla sobreviven y ensucian el titulo. FRAME_SHAPE se borra porque el catalogo
  // no tiene la forma del armazon y no se inventa.
  for (const id of BORRAR) attrs.push({ id, value_name: null })
  return attrs
}

/** family_name agrupa las variantes: el modelo sin color ni diferencial. */
function armarFamilia(row: Fila): string {
  const base = row.tipo === 'receta' ? 'Anteojos Orbital' : 'Anteojos De Sol Orbital'
  return `${base} ${initcap(row.modelo)}`
}

async function fotosDe(sb: ReturnType<typeof db>, row: Fila) {
  const { data } = await sb.from('producto_imagenes')
    .select('url, codigo, orden')
    .or(`codigo.eq.${row.codigo},modelo.eq.${row.modelo}`)
    .order('orden', { nullsFirst: false })
  // La del color exacto primero, si existe.
  const ord = (data ?? []).sort((a, b) =>
    (a.codigo === row.codigo ? -1 : 0) - (b.codigo === row.codigo ? -1 : 0))
  return ord.slice(0, 10).map((f) => ({ source: f.url }))
}

Deno.serve(async (req) => {
  try {
    const sb = db()
    const { token } = await getToken(sb)
    const url = new URL(req.url)
    const codigo = url.searchParams.get('codigo')
    const modelos = url.searchParams.get('modelos')
    const arreglar = url.searchParams.get('arreglar') === '1'

    const plantillas = {
      sol: await leerPlantilla(PLANTILLA.sol, token),
      receta: await leerPlantilla(PLANTILLA.receta, token),
    }

    if (!codigo && !modelos && !arreglar) {
      return json({ ok: true, modo: 'inspeccion — no se creo nada', plantillas })
    }

    let q = sb.from('ml_publicables')
      .select('codigo, modelo, color, tipo, tratamiento, precio, cantidad_publicable, seccion')
      .is('motivo_bloqueo', null)
    if (codigo) q = q.eq('codigo', codigo)
    else if (modelos) q = q.in('modelo', modelos.split(',').map((m) => m.trim().toUpperCase()))

    const { data: candidatos, error } = await q
    if (error) return json({ error: error.message }, 500)
    if (!candidatos?.length) return json({ error: 'Ningun SKU publicable con ese filtro' }, 400)

    const { data: yaPub } = await sb.from('mapeo_producto_ml')
      .select('item_id, codigo').not('codigo', 'is', null)
    const publicados = new Map((yaPub ?? []).map((r) => [r.codigo, r.item_id]))

    const hechas: unknown[] = []
    let creadas = 0, corregidas = 0, errores = 0

    for (const p of candidatos as Fila[]) {
      const atributos = armarAtributos(p)
      const yaExiste = publicados.get(p.codigo)

      // --- Modo correccion: la publicacion ya existe, se le arreglan los atributos ---
      if (yaExiste) {
        if (!arreglar) continue
        const res = await ml(`/items/${yaExiste}`, token, {
          method: 'PUT', body: JSON.stringify({ attributes: atributos }),
        })
        if (res.ok) {
          const it = await res.json()
          corregidas++
          await sb.from('mapeo_producto_ml').update({ titulo: it.title }).eq('item_id', yaExiste)
          hechas.push({ codigo: p.codigo, item_id: yaExiste, accion: 'atributos corregidos', titulo: it.title })
        } else {
          errores++
          hechas.push({ codigo: p.codigo, item_id: yaExiste, error: `${res.status}: ${(await res.text()).slice(0, 400)}` })
        }
        continue
      }

      if (arreglar) continue // en modo correccion no se crea nada nuevo

      // --- Alta ---
      const pl = plantillas[p.tipo === 'receta' ? 'receta' : 'sol']
      if ('error' in pl) { errores++; hechas.push({ codigo: p.codigo, error: pl.error }); continue }

      const pictures = await fotosDe(sb, p)
      if (!pictures.length) { errores++; hechas.push({ codigo: p.codigo, error: 'sin fotos' }); continue }

      const payload = {
        ...pl.config,
        family_name: armarFamilia(p),
        price: Number(p.precio),
        available_quantity: Math.min(Number(p.cantidad_publicable ?? 0), 20),
        seller_custom_field: p.codigo,
        pictures,
        attributes: atributos,
      }

      const res = await ml('/items', token, { method: 'POST', body: JSON.stringify(payload) })
      if (!res.ok) {
        errores++
        hechas.push({ codigo: p.codigo, error: `${res.status}: ${(await res.text()).slice(0, 500)}` })
        continue
      }

      const nuevo = await res.json()
      await ml(`/items/${nuevo.id}`, token, { method: 'PUT', body: JSON.stringify({ status: 'paused' }) })

      await sb.from('mapeo_producto_ml').upsert({
        item_id: String(nuevo.id),
        codigo: p.codigo,
        modelo: p.modelo,
        titulo: nuevo.title,
        estado: 'paused',
        logistic_type: nuevo.shipping?.logistic_type ?? null,
        available_quantity: nuevo.available_quantity ?? null,
        precio_actual: nuevo.price ?? null,
        permalink: nuevo.permalink ?? null,
        match_origen: 'sku',
        seccion: p.seccion,
      }, { onConflict: 'item_id' })

      creadas++
      hechas.push({
        codigo: p.codigo, item_id: nuevo.id,
        titulo: nuevo.title,   // lo genera ML desde la ficha tecnica
        precio: nuevo.price, cantidad: nuevo.available_quantity,
        fotos: pictures.length, permalink: nuevo.permalink, estado: 'paused',
      })
    }

    return json({
      ok: true,
      modo: arreglar ? 'correccion de atributos' : 'alta',
      resumen: { creadas, corregidas, errores },
      nota: 'El titulo lo genera ML desde la ficha tecnica; no se puede escribir en esta categoria.',
      detalle: hechas,
    })
  } catch (e) {
    return json({ error: String(e) }, 500)
  }
})
