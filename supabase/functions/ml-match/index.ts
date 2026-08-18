// Barrido inicial: trae las publicaciones que ya existen en la cuenta y las ata
// al catalogo. Se corre una vez al principio y despues cada tanto para levantar
// publicaciones nuevas.
//
// El match va en tres pasadas, de mas confiable a menos:
//   1. SELLER_SKU / seller_custom_field contra stock.codigo
//   2. modelo del titulo contra stock.modelo
//   3. lo que no matchee queda con match_origen null, para resolver a mano en la Suite
//
// Nada de esto escribe en ML: solo lee y llena mapeo_producto_ml.

import { db, getToken, ml, json } from '../_shared/ml.ts'

Deno.serve(async () => {
  try {
    const sb = db()
    const { token, userId } = await getToken(sb)

    const { data: cuenta } = await sb.from('ml_cuentas')
      .select('official_store_id').eq('user_id', userId).single()

    // Catalogo en memoria: son ~950 filas, entra sobrado.
    const { data: stock } = await sb.from('stock').select('codigo, modelo')
    const porCodigo = new Map((stock ?? []).map((s) => [s.codigo, s.modelo]))
    const modelos = [...new Set((stock ?? []).map((s) => (s.modelo ?? '').toUpperCase().trim()))]
      .filter(Boolean)
      .sort((a, b) => b.length - a.length) // primero los largos: "BUENOS AIRES I" antes que "BUENOS AIRES"

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

    let porSku = 0, porModelo = 0, sinMatch = 0

    // Detalle en lotes de 20 (tope de /items?ids=).
    for (let i = 0; i < ids.length; i += 20) {
      const lote = ids.slice(i, i + 20)
      const res = await ml(`/items?ids=${lote.join(',')}`, token)
      if (!res.ok) continue
      const detalle = await res.json()

      for (const envuelto of detalle) {
        const item = envuelto.body
        if (!item?.id) continue

        const sku = item.seller_custom_field
          ?? item.attributes?.find((a: { id: string }) => a.id === 'SELLER_SKU')?.value_name
          ?? null

        let modelo: string | null = null
        let origen: string | null = null

        if (sku && porCodigo.has(sku)) {
          modelo = porCodigo.get(sku) ?? null
          origen = 'sku'
          porSku++
        } else {
          const titulo = (item.title ?? '').toUpperCase()
          const hit = modelos.find((m) => titulo.includes(m))
          if (hit) { modelo = hit; origen = 'modelo'; porModelo++ }
          else sinMatch++
        }

        await sb.from('mapeo_producto_ml').upsert({
          item_id: String(item.id),
          modelo,
          titulo: item.title ?? null,
          estado: item.status ?? null,
          logistic_type: item.shipping?.logistic_type ?? null,
          match_origen: origen,
        }, { onConflict: 'item_id' })
      }
    }

    return json({
      ok: true,
      publicaciones: ids.length,
      match: { por_sku: porSku, por_modelo: porModelo, sin_match: sinMatch },
      aviso: sinMatch
        ? `${sinMatch} publicaciones quedaron sin atar: resolver a mano antes de apagar modo_lectura.`
        : 'Todas las publicaciones quedaron atadas. Revisar igual antes de apagar modo_lectura.',
    })
  } catch (e) {
    return json({ error: String(e) }, 500)
  }
})
