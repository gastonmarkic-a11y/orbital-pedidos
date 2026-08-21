// Busca en Shopify las imagenes por VARIANTE (color), que es lo que falta para publicar
// bien en Mercado Libre.
//
// El problema que resuelve: producto_imagenes tiene una sola foto por modelo (se cargo asi
// el 2026-08-09), pero en Shopify cada variante suele tener su propia imagen asociada por
// image_id. Si estan, se traen y no hace falta fotografiar nada.
//
// Modos:
//   (sin parametros)  -> informe: cuantas variantes tienen imagen propia. NO escribe.
//   ?modelos=A,B      -> acota el informe a esos modelos.
//   ?guardar=1        -> ademas escribe en producto_imagenes lo que encuentre (por codigo).

import { db, json } from '../_shared/ml.ts'

const API = '2024-01'

interface Variante { id: number; sku: string | null; title: string; image_id: number | null }
interface Imagen { id: number; src: string; position: number }
interface Producto { id: number; title: string; images: Imagen[]; variants: Variante[] }

Deno.serve(async (req) => {
  try {
    const sb = db()
    const url = new URL(req.url)
    const guardar = url.searchParams.get('guardar') === '1'
    const filtro = url.searchParams.get('modelos')?.split(',').map((m) => m.trim().toUpperCase())

    const { data: tienda, error } = await sb.from('shopify_stores')
      .select('shop_domain, access_token').limit(1).single()
    if (error || !tienda) return json({ error: 'No hay tienda de Shopify conectada' }, 400)

    // Catalogo local para poder atar sku -> modelo.
    const { data: stock } = await sb.from('stock').select('codigo, modelo')
    const modeloDe = new Map((stock ?? []).map((s) => [s.codigo, (s.modelo ?? '').toUpperCase().trim()]))

    // Paginado por cursor (Shopify usa Link headers).
    const productos: Producto[] = []
    let next: string | null =
      `https://${tienda.shop_domain}/admin/api/${API}/products.json?limit=250&fields=id,title,images,variants`

    while (next) {
      const res: Response = await fetch(next, {
        headers: { 'X-Shopify-Access-Token': tienda.access_token, accept: 'application/json' },
      })
      if (!res.ok) return json({ error: `Shopify ${res.status}`, detalle: (await res.text()).slice(0, 300) }, 500)
      const body = await res.json()
      productos.push(...(body.products ?? []))

      const link = res.headers.get('link') ?? ''
      const m = link.match(/<([^>]+)>;\s*rel="next"/)
      next = m ? m[1] : null
    }

    let variantesTotal = 0, conImagenPropia = 0, skuEnCatalogo = 0, guardadas = 0
    const detalle: unknown[] = []

    for (const p of productos) {
      const porId = new Map(p.images.map((i) => [i.id, i.src]))

      for (const v of p.variants) {
        variantesTotal++
        const modelo = v.sku ? modeloDe.get(v.sku) : undefined
        if (filtro && (!modelo || !filtro.includes(modelo))) continue
        if (modelo) skuEnCatalogo++

        const src = v.image_id ? porId.get(v.image_id) : undefined
        if (src) conImagenPropia++

        if (filtro || detalle.length < 40) {
          detalle.push({
            producto: p.title,
            variante: v.title,
            sku: v.sku,
            modelo: modelo ?? '(sku no esta en el catalogo)',
            imagen_propia: src ?? null,
            imagenes_del_producto: p.images.length,
          })
        }

        // Solo se guarda si el SKU existe en el catalogo y la variante tiene imagen propia:
        // guardar la foto del producto para todas las variantes es lo que ya teniamos.
        if (guardar && src && modelo && v.sku) {
          const { error: err } = await sb.from('producto_imagenes')
            .upsert({ codigo: v.sku, modelo, url: src, orden: 0 }, { onConflict: 'codigo,url' })
          if (!err) guardadas++
        }
      }
    }

    return json({
      ok: true,
      modo: guardar ? 'informe + guardado' : 'informe — no se escribio nada',
      tienda: tienda.shop_domain,
      productos: productos.length,
      variantes: variantesTotal,
      variantes_con_imagen_propia: conImagenPropia,
      variantes_cuyo_sku_esta_en_el_catalogo: skuEnCatalogo,
      guardadas,
      detalle: detalle.slice(0, 40),
    })
  } catch (e) {
    return json({ error: String(e) }, 500)
  }
})
