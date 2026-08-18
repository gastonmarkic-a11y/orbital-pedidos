// Detecta publicaciones duplicadas y recomienda cual conservar.
//
// Por que importa: dos publicaciones con el mismo titulo se parten visitas, ventas
// y preguntas, asi que ninguna acumula reputacion — y ML considera el duplicado una
// infraccion.
//
// Criterio de conservacion, en orden:
//   1. la que mas vendio (sold_quantity)
//   2. ante empate, la mas antigua (date_created) — tiene mas historial y posicionamiento
//   3. ante empate, la que esta activa antes que una pausada
//
// Esta funcion NO pausa nada: sólo lee, guarda las metricas y devuelve la recomendacion.
// El pausado lo hace ml-duplicados-aplicar, ya con la decision revisada.

import { db, getToken, ml, json } from '../_shared/ml.ts'

interface Item {
  item_id: string
  modelo: string | null
  titulo: string | null
  estado: string | null
  sold_quantity: number
  date_created: string | null
  permalink: string | null
  precio_actual: number | null
  available_quantity: number | null
  health: number | null
}

/** Normaliza el titulo para comparar: sin espacios de mas, sin acentos, minuscula. */
function clave(t: string | null): string {
  return (t ?? '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

Deno.serve(async () => {
  try {
    const sb = db()
    const { token } = await getToken(sb)

    const { data: filas, error } = await sb
      .from('mapeo_producto_ml')
      .select('item_id, modelo, titulo, estado')
    if (error) return json({ error: error.message }, 500)
    if (!filas?.length) return json({ error: 'No hay publicaciones mapeadas. Correr ml-match.' }, 400)

    // Traigo metricas en lotes de 20 (tope de /items?ids=).
    const detalle = new Map<string, Item>()
    for (let i = 0; i < filas.length; i += 20) {
      const lote = filas.slice(i, i + 20)
      const campos = 'id,title,status,sold_quantity,date_created,permalink,price,available_quantity,health'
      const res = await ml(`/items?ids=${lote.map((f) => f.item_id).join(',')}&attributes=${campos}`, token)
      if (!res.ok) continue

      for (const envuelto of await res.json()) {
        const it = envuelto.body
        if (!it?.id) continue
        const base = lote.find((f) => f.item_id === String(it.id))
        const item: Item = {
          item_id: String(it.id),
          modelo: base?.modelo ?? null,
          titulo: it.title ?? base?.titulo ?? null,
          estado: it.status ?? base?.estado ?? null,
          sold_quantity: it.sold_quantity ?? 0,
          date_created: it.date_created ?? null,
          permalink: it.permalink ?? null,
          precio_actual: it.price ?? null,
          available_quantity: it.available_quantity ?? null,
          health: it.health ?? null,
        }
        detalle.set(item.item_id, item)

        await sb.from('mapeo_producto_ml').update({
          titulo: item.titulo,
          estado: item.estado,
          sold_quantity: item.sold_quantity,
          available_quantity: item.available_quantity,
          precio_actual: item.precio_actual,
          date_created: item.date_created,
          permalink: item.permalink,
          health: item.health,
        }).eq('item_id', item.item_id)
      }
    }

    // Agrupo por titulo normalizado.
    const grupos = new Map<string, Item[]>()
    for (const it of detalle.values()) {
      const k = clave(it.titulo)
      if (!k) continue
      if (!grupos.has(k)) grupos.set(k, [])
      grupos.get(k)!.push(it)
    }

    const duplicados: unknown[] = []
    let aPausar = 0, ventasEnJuego = 0

    for (const [, items] of grupos) {
      if (items.length < 2) continue

      const orden = [...items].sort((a, b) => {
        if (b.sold_quantity !== a.sold_quantity) return b.sold_quantity - a.sold_quantity
        const fa = a.date_created ? Date.parse(a.date_created) : Infinity
        const fb = b.date_created ? Date.parse(b.date_created) : Infinity
        if (fa !== fb) return fa - fb                       // mas antigua primero
        return (a.estado === 'active' ? 0 : 1) - (b.estado === 'active' ? 0 : 1)
      })

      const conservar = orden[0]
      const pausar = orden.slice(1)
      aPausar += pausar.length
      ventasEnJuego += pausar.reduce((a, p) => a + p.sold_quantity, 0)

      await sb.from('mapeo_producto_ml').update({ decision: 'conservar' }).eq('item_id', conservar.item_id)
      for (const p of pausar) {
        await sb.from('mapeo_producto_ml').update({ decision: 'pausar' }).eq('item_id', p.item_id)
      }

      duplicados.push({
        modelo: conservar.modelo,
        titulo: conservar.titulo,
        conservar: {
          item_id: conservar.item_id, vendidas: conservar.sold_quantity,
          estado: conservar.estado, creada: conservar.date_created?.slice(0, 10),
          permalink: conservar.permalink,
        },
        pausar: pausar.map((p) => ({
          item_id: p.item_id, vendidas: p.sold_quantity,
          estado: p.estado, creada: p.date_created?.slice(0, 10),
        })),
      })
    }

    return json({
      ok: true,
      revisadas: detalle.size,
      grupos_duplicados: duplicados.length,
      publicaciones_a_pausar: aPausar,
      ventas_en_las_que_se_pausan: ventasEnJuego,
      aviso: ventasEnJuego > 0
        ? `Cuidado: ${ventasEnJuego} ventas viven en publicaciones marcadas para pausar. Revisar esos casos a mano.`
        : 'Ninguna de las publicaciones a pausar tiene ventas propias.',
      duplicados,
    })
  } catch (e) {
    return json({ error: String(e) }, 500)
  }
})
