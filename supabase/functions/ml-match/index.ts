// Barrido: trae las publicaciones de la cuenta y las ata al catalogo.
//
// Lo que importa acá es el SKU, no el modelo. Hay ~3 publicaciones por modelo (una
// por color), asi que atar solo el modelo no alcanza: ml-sync necesita saber QUE
// color es cada publicacion o empuja el stock del modelo entero a cada una.
//
// Tres pasadas, de mas confiable a menos:
//   1. SELLER_SKU / seller_custom_field contra stock.codigo  -> codigo + modelo
//   2. modelo del titulo contra stock.modelo                 -> solo modelo
//   3. sin match                                             -> a resolver a mano
//
// No escribe nada en ML: solo lee.

import { db, getToken, ml, json } from '../_shared/ml.ts'

Deno.serve(async () => {
  try {
    const sb = db()
    const { token, userId } = await getToken(sb)

    const { data: cuenta } = await sb.from('ml_cuentas')
      .select('official_store_id').eq('user_id', userId).single()

    // Mapeos atados a mano: ML no tiene el SKU cargado, asi que el barrido no lo puede
    // deducir. Si los pisaramos con null, la publicacion se cae de la sincronizacion en
    // cada corrida y el trabajo manual se pierde.
    const { data: manuales } = await sb.from('mapeo_producto_ml')
      .select('item_id, codigo, modelo')
      .eq('match_origen', 'manual')
    const protegidos = new Map(
      (manuales ?? []).map((m) => [m.item_id, { codigo: m.codigo, modelo: m.modelo }]),
    )

    const { data: stock } = await sb.from('stock').select('codigo, modelo')
    const porCodigo = new Map((stock ?? []).map((s) => [s.codigo, s.modelo]))
    const modelos = [...new Set((stock ?? []).map((s) => (s.modelo ?? '').toUpperCase().trim()))]
      .filter(Boolean)
      .sort((a, b) => b.length - a.length) // largos primero: BUENOS AIRES I antes que BUENOS AIRES

    // Paginado del listado de items.
    const ids: string[] = []
    let offset = 0
    while (true) {
      const q = new URLSearchParams({ limit: '100', offset: String(offset) })
      if (cuenta?.official_store_id) q.set('official_store_id', cuenta.official_store_id)
      const res = await ml(`/users/${userId}/items/search?${q}`, token)
      if (!res.ok) return json({ error: `Listado ${res.status}`, detalle: await res.text() }, 500)
      const page = await res.json()
      ids.push(...(page.results ?? []))
      offset += 100
      if (offset >= (page.paging?.total ?? 0) || !page.results?.length) break
    }

    let porSku = 0, porModelo = 0, sinMatch = 0, protegidosRespetados = 0
    const huerfanos: unknown[] = []

    for (let i = 0; i < ids.length; i += 20) {
      const lote = ids.slice(i, i + 20)
      const res = await ml(`/items?ids=${lote.join(',')}`, token)
      if (!res.ok) continue

      for (const envuelto of await res.json()) {
        const item = envuelto.body
        if (!item?.id) continue

        const sku = item.seller_custom_field
          ?? item.attributes?.find((a: { id: string }) => a.id === 'SELLER_SKU')?.value_name
          ?? null

        let codigo: string | null = null
        let modelo: string | null = null
        let origen: string | null = null

        const manual = protegidos.get(String(item.id))
        if (manual) {
          // Atada a mano: se respeta y no se recalcula.
          codigo = manual.codigo
          modelo = manual.modelo
          origen = 'manual'
          protegidosRespetados++
        } else if (sku && porCodigo.has(sku)) {
          codigo = sku
          modelo = porCodigo.get(sku) ?? null
          origen = 'sku'
          porSku++
        } else {
          // Sin SKU util: al menos atamos el modelo por el titulo, pero queda sin
          // codigo y por lo tanto FUERA de la sincronizacion de stock.
          const titulo = (item.title ?? '').toUpperCase()
          const hit = modelos.find((m) => titulo.includes(m))
          if (hit) {
            modelo = hit
            origen = 'modelo'
            porModelo++
            huerfanos.push({ item_id: String(item.id), titulo: item.title, modelo: hit, motivo: 'sin SKU' })
          } else {
            sinMatch++
            huerfanos.push({ item_id: String(item.id), titulo: item.title, modelo: null, motivo: 'sin SKU ni modelo' })
          }
        }

        await sb.from('mapeo_producto_ml').upsert({
          item_id: String(item.id),
          codigo,
          modelo,
          titulo: item.title ?? null,
          estado: item.status ?? null,
          logistic_type: item.shipping?.logistic_type ?? null,
          available_quantity: item.available_quantity ?? null,
          precio_actual: item.price ?? null,
          sold_quantity: item.sold_quantity ?? null,
          permalink: item.permalink ?? null,
          match_origen: origen,
        }, { onConflict: 'item_id' })
      }
    }

    return json({
      ok: true,
      publicaciones: ids.length,
      match: { por_sku: porSku, solo_modelo: porModelo, sin_match: sinMatch, manuales_respetados: protegidosRespetados },
      sincronizables: porSku + protegidosRespetados,
      aviso: porModelo + sinMatch > 0
        ? `${porModelo + sinMatch} publicaciones quedaron SIN SKU: no se van a sincronizar hasta atarlas. ` +
          `Cargarles el codigo de catalogo en el campo SKU de ML es la forma mas rapida de resolverlo.`
        : 'Todas las publicaciones tienen SKU. Listas para sincronizar.',
      huerfanos,
    })
  } catch (e) {
    return json({ error: String(e) }, 500)
  }
})
