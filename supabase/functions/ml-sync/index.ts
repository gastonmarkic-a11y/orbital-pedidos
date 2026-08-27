// Sincroniza stock y precio hacia Mercado Libre.
//
// Reglas que no se negocian:
//
//  1. Se sincroniza POR SKU, nunca por modelo. Hay ~3 publicaciones por modelo (una
//     por color): empujar el stock del modelo entero a cada una es sobreventa
//     garantizada. Publicacion sin codigo = no se toca.
//  2. Sin foto, sin precio valido o sin stock minimo, el SKU no se publica. La regla
//     vive en la vista ml_publicables (motivo_bloqueo), asi la Suite y esta funcion
//     dicen siempre lo mismo.
//  3. Full es PULL, nunca push: el stock esta en deposito de ML y no es stock.cantidad.
//  4. Reactiva lo que se pauso por falta de stock cuando el stock vuelve. Sin esto las
//     publicaciones se apagan solas al agotarse y no vuelven nunca — que es
//     exactamente lo que paso con LONG BEACH, ROMA, SHAKUR y ZETA 11.
//  5. Goteo de stock: no se expone el stock real. Se publica
//     min(disponible, stock_publicado_max) y se repone cuando ML baja a
//     stock_reponer_en o menos. Limita la exposicion ante un desfasaje de inventario
//     y evita reescribir la publicacion en cada corrida.
//  6. Con ml_config.modo_lectura en true informa que haria y no escribe.

import { db, getConfig, getToken, ml, json, esFull } from '../_shared/ml.ts'

interface Accion {
  item_id: string
  codigo: string | null
  modelo: string | null
  cambios: Record<string, unknown>
  resultado: string
}

Deno.serve(async (req) => {
  try {
    const sb = db()
    const cfg = await getConfig(sb)
    const { token } = await getToken(sb)

    const forzar = new URL(req.url).searchParams.get('escribir') === '1'
    const escribe = forzar || !cfg.modo_lectura

    const { data: items, error } = await sb
      .from('mapeo_producto_ml')
      .select('item_id, codigo, modelo, logistic_type, estado, available_quantity, precio_actual, decision')
    if (error) return json({ error: error.message }, 500)
    if (!items?.length) return json({ ok: true, aviso: 'No hay publicaciones mapeadas. Correr ml-match.' })

    const { data: publicables } = await sb
      .from('ml_publicables')
      .select('codigo, modelo, precio, cantidad, cantidad_publicable, motivo_bloqueo')
    const porCodigo = new Map((publicables ?? []).map((p) => [p.codigo, p]))

    const acciones: Accion[] = []
    let escritos = 0, pausados = 0, reactivados = 0, sinCambio = 0, saltados = 0, errores = 0

    for (const item of items) {
      // Sin codigo no sabemos que color es: no se toca.
      if (!item.codigo) {
        saltados++
        acciones.push({
          item_id: item.item_id, codigo: null, modelo: item.modelo, cambios: {},
          resultado: 'saltada — sin SKU atado',
        })
        continue
      }

      // ML no acepta cambios mientras revisa.
      // Pausada a proposito por ser duplicada: no se toca nunca. Sin este corte, la
      // reactivacion por stock las vuelve a prender y el saneamiento de duplicados se
      // deshace solo en la primera corrida.
      // 'revisar' es lo mismo pero para las recien creadas: nacen pausadas a proposito
      // para que Gaston mire la foto y el titulo antes de que salgan a la venta. Sin este
      // corte el cron las prendia a los 30 minutos y la revision no llegaba a existir.
      // Cualquier decision tomada a mano manda sobre la automatica. La reactivacion por
      // stock es ciega: si no se corta aca, en la corrida siguiente vuelve a prender todo
      // lo que se pauso a proposito y el trabajo se deshace solo.
      const MOTIVO: Record<string, string> = {
        pausar: 'duplicada, pausada a proposito',
        revisar: 'recien creada, esperando revision',
        sin_foto_del_color: 'la foto es del modelo y no del color: no se publica',
      }
      if (item.decision && MOTIVO[item.decision]) {
        saltados++
        acciones.push({
          item_id: item.item_id, codigo: item.codigo, modelo: item.modelo, cambios: {},
          resultado: `saltada — ${MOTIVO[item.decision]}`,
        })
        continue
      }

      if (item.estado === 'under_review' || item.estado === 'closed') {
        saltados++
        acciones.push({
          item_id: item.item_id, codigo: item.codigo, modelo: item.modelo, cambios: {},
          resultado: `saltada — estado ${item.estado}`,
        })
        continue
      }

      const p = porCodigo.get(item.codigo)
      const full = esFull(item.logistic_type)
      const cambios: Record<string, unknown> = {}

      if (full) {
        // PULL: leemos lo que ML dice tener, no le empujamos stock.
        const r = await ml(`/items/${item.item_id}?attributes=available_quantity`, token)
        if (r.ok) {
          const info = await r.json()
          await sb.from('mapeo_producto_ml')
            .update({ stock_full: info.available_quantity ?? null })
            .eq('item_id', item.item_id)
        }
      }

      // Si el SKU esta bloqueado y la publicacion esta activa, hay que apagarla.
      if (!p || p.motivo_bloqueo) {
        if (item.estado === 'active' && cfg.pausar_si_stock_cero) {
          cambios.status = 'paused'
          pausados++
        } else {
          sinCambio++
          acciones.push({
            item_id: item.item_id, codigo: item.codigo, modelo: item.modelo, cambios: {},
            resultado: `sin cambio — ${p?.motivo_bloqueo ?? 'SKU sin stock'}, ya ${item.estado}`,
          })
          continue
        }
      } else {
        // Publicable: precio siempre, stock solo si no es Full.
        // El precio solo se toca si hay una politica definida. Ver el comentario de
        // ml_config.sincronizar_precio: los precios de ML estan cargados a mano sin
        // regla, asi que sincronizar sin markup definido los destroza.
        if (cfg.sincronizar_precio) {
          const markup = 1 + (full ? cfg.markup_pct_full : cfg.markup_pct_propio) / 100
          const precio = Math.round((Number(p.precio) * markup) / 100) * 100
          if (Number(item.precio_actual ?? 0) !== precio) cambios.price = precio
        }

        if (!full) {
          // Goteo de stock: no se expone el stock real, se publica un tope y se repone
          // cuando ML baja al umbral. Asi la publicacion no se reescribe en cada corrida
          // y un numero bajo de disponibles le juega a favor a la conversion.
          const disponible = Number(p.cantidad_publicable ?? 0)
          const objetivo = Math.min(disponible, cfg.stock_publicado_max)
          const enML = Number(item.available_quantity ?? -1)

          // Se toca si hay que reponer, si lo publicado excede el tope (bajo el stock
          // real o alguien lo cargo a mano de mas), o si la publicacion se esta
          // reactivando: relanzarla con el resto viejo la deja pidiendo reposicion a
          // los pocos dias, asi que vuelve al tope.
          if (enML <= cfg.stock_reponer_en || enML > objetivo || item.estado === 'paused') {
            cambios.available_quantity = objetivo
          }
        }

        // Reactivacion: tiene stock y esta pausada -> vuelve.
        if (item.estado === 'paused') {
          cambios.status = 'active'
          reactivados++
        }
      }

      if (!Object.keys(cambios).length) {
        sinCambio++
        acciones.push({
          item_id: item.item_id, codigo: item.codigo, modelo: item.modelo, cambios: {},
          resultado: 'sin cambio — ya estaba al dia',
        })
        continue
      }

      if (!escribe) {
        acciones.push({
          item_id: item.item_id, codigo: item.codigo, modelo: item.modelo, cambios,
          resultado: 'modo lectura — no se escribio',
        })
        continue
      }

      const res = await ml(`/items/${item.item_id}`, token, {
        method: 'PUT',
        body: JSON.stringify(cambios),
      })

      if (res.ok) {
        escritos++
        const info = await res.json().catch(() => ({}))
        await sb.from('mapeo_producto_ml').update({
          estado: info.status ?? (cambios.status as string) ?? item.estado,
          available_quantity: info.available_quantity ?? item.available_quantity,
          precio_actual: info.price ?? item.precio_actual,
          ultimo_sync: new Date().toISOString(),
          ultimo_error: null,
        }).eq('item_id', item.item_id)
        acciones.push({ item_id: item.item_id, codigo: item.codigo, modelo: item.modelo, cambios, resultado: 'ok' })
      } else {
        errores++
        const detalle = (await res.text()).slice(0, 300)
        await sb.from('mapeo_producto_ml').update({ ultimo_error: `${res.status}: ${detalle}` }).eq('item_id', item.item_id)
        acciones.push({
          item_id: item.item_id, codigo: item.codigo, modelo: item.modelo, cambios,
          resultado: `error ${res.status}: ${detalle}`,
        })
      }
    }

    return json({
      ok: true,
      modo: escribe ? 'escritura' : 'lectura',
      resumen: {
        publicaciones: items.length,
        con_cambios: acciones.filter((a) => Object.keys(a.cambios).length).length,
        reactivadas: reactivados, pausadas: pausados,
        sin_cambio: sinCambio, saltadas_sin_sku: saltados,
        escritas: escritos, errores,
      },
      acciones: acciones.filter((a) => Object.keys(a.cambios).length || a.resultado.startsWith('saltada')),
    })
  } catch (e) {
    return json({ error: String(e) }, 500)
  }
})
