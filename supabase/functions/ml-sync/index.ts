// Sincroniza stock y precio hacia Mercado Libre.
//
// Tres reglas que no se negocian:
//
//  1. Sin foto o sin precio valido, el SKU NO se publica. La regla vive en la
//     vista ml_publicables (motivo_bloqueo), no aca, para que la pantalla de la
//     Suite y esta funcion muestren siempre lo mismo.
//  2. Las publicaciones en Full son PULL, nunca push: el stock esta fisicamente
//     en deposito de ML y no es stock.cantidad. Empujarle nuestro stock rompe el
//     inventario de los dos lados. De Full solo leemos la cantidad y empujamos precio.
//  3. Mientras ml_config.modo_lectura este en true, informa que haria y no escribe.
//     Se apaga recien cuando el matcheo item_id <-> modelo esta revisado.

import { db, getConfig, getToken, ml, json, esFull } from '../_shared/ml.ts'

interface Accion {
  item_id: string
  modelo: string | null
  logistica: string | null
  cambios: Record<string, unknown>
  resultado: string
}

Deno.serve(async (req) => {
  try {
    const sb = db()
    const cfg = await getConfig(sb)
    const { token } = await getToken(sb)

    // ?escribir=1 fuerza escritura aunque modo_lectura este prendido (para probar
    // un item puntual sin apagar el candado global).
    const forzar = new URL(req.url).searchParams.get('escribir') === '1'
    const escribe = forzar || !cfg.modo_lectura

    const { data: items, error } = await sb
      .from('mapeo_producto_ml')
      .select('item_id, modelo, logistic_type, estado')
    if (error) return json({ error: error.message }, 500)
    if (!items?.length) {
      return json({ ok: true, aviso: 'No hay publicaciones mapeadas todavia. Correr el matcheo primero.' })
    }

    const { data: publicables } = await sb
      .from('ml_publicables')
      .select('codigo, modelo, precio, cantidad_publicable, motivo_bloqueo')

    // Indice por modelo: la publicacion es el modelo, los colores son variantes.
    const porModelo = new Map<string, typeof publicables>()
    for (const p of publicables ?? []) {
      const k = (p.modelo ?? '').toUpperCase().trim()
      if (!porModelo.has(k)) porModelo.set(k, [])
      porModelo.get(k)!.push(p)
    }

    const acciones: Accion[] = []
    let escritos = 0, pausados = 0, saltados = 0, errores = 0

    for (const item of items) {
      const clave = (item.modelo ?? '').toUpperCase().trim()
      const skus = porModelo.get(clave) ?? []
      const validos = skus.filter((s) => !s.motivo_bloqueo)

      if (!validos.length) {
        const motivos = [...new Set(skus.map((s) => s.motivo_bloqueo).filter(Boolean))]
        acciones.push({
          item_id: item.item_id, modelo: item.modelo, logistica: item.logistic_type,
          cambios: {}, resultado: `saltado (${motivos.join(', ') || 'sin SKU con stock'})`,
        })
        saltados++
        continue
      }

      const full = esFull(item.logistic_type)
      const markup = 1 + (full ? cfg.markup_pct_full : cfg.markup_pct_propio) / 100
      // Precio del item: el menor de las variantes validas, redondeado a $100.
      const base = Math.min(...validos.map((v) => Number(v.precio)))
      const precio = Math.round((base * markup) / 100) * 100

      const cambios: Record<string, unknown> = { price: precio }

      if (full) {
        // PULL: leemos lo que ML dice tener y lo dejamos anotado aparte.
        const r = await ml(`/items/${item.item_id}?attributes=available_quantity`, token)
        if (r.ok) {
          const info = await r.json()
          await sb.from('mapeo_producto_ml')
            .update({ stock_full: info.available_quantity ?? null })
            .eq('item_id', item.item_id)
        }
      } else {
        const cantidad = validos.reduce((a, v) => a + Number(v.cantidad_publicable ?? 0), 0)
        cambios.available_quantity = cantidad
        if (cantidad <= 0 && cfg.pausar_si_stock_cero) {
          cambios.status = 'paused'
          delete cambios.available_quantity
          pausados++
        }
      }

      if (!escribe) {
        acciones.push({
          item_id: item.item_id, modelo: item.modelo, logistica: item.logistic_type,
          cambios, resultado: 'modo lectura — no se escribio',
        })
        continue
      }

      const res = await ml(`/items/${item.item_id}`, token, {
        method: 'PUT',
        body: JSON.stringify(cambios),
      })

      if (res.ok) {
        escritos++
        await sb.from('mapeo_producto_ml')
          .update({ ultimo_sync: new Date().toISOString(), ultimo_error: null })
          .eq('item_id', item.item_id)
        acciones.push({ item_id: item.item_id, modelo: item.modelo, logistica: item.logistic_type, cambios, resultado: 'ok' })
      } else {
        errores++
        const detalle = (await res.text()).slice(0, 400)
        await sb.from('mapeo_producto_ml')
          .update({ ultimo_error: `${res.status}: ${detalle}` })
          .eq('item_id', item.item_id)
        acciones.push({ item_id: item.item_id, modelo: item.modelo, logistica: item.logistic_type, cambios, resultado: `error ${res.status}` })
      }
    }

    return json({
      ok: true,
      modo: escribe ? 'escritura' : 'lectura',
      resumen: { publicaciones: items.length, escritos, pausados, saltados, errores },
      acciones,
    })
  } catch (e) {
    return json({ error: String(e) }, 500)
  }
})
