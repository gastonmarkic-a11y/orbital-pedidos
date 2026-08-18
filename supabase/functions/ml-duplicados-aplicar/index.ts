// Aplica el pausado de las publicaciones duplicadas que ml-duplicados marco como
// decision = 'pausar'.
//
// Pausa, no elimina: la publicacion conserva historial, ventas y reputacion, y se
// puede reactivar. Eliminar seria irreversible y no lo hacemos nunca desde acá.
//
// Sólo toca las que estan 'active'. Las 'under_review' las deja quietas: ML no
// acepta cambios de estado mientras revisa, y forzarlo devuelve error.

import { db, getToken, ml, json } from '../_shared/ml.ts'

Deno.serve(async (req) => {
  try {
    const sb = db()
    const { token } = await getToken(sb)

    // ?revertir=1 reactiva lo que se pauso, por si hay que dar marcha atras.
    const revertir = new URL(req.url).searchParams.get('revertir') === '1'
    const nuevoEstado = revertir ? 'active' : 'paused'
    const estadoBuscado = revertir ? 'paused' : 'active'

    const { data: objetivo, error } = await sb
      .from('mapeo_producto_ml')
      .select('item_id, modelo, titulo, estado, sold_quantity')
      .eq('decision', 'pausar')
    if (error) return json({ error: error.message }, 500)
    if (!objetivo?.length) return json({ ok: true, aviso: 'No hay publicaciones marcadas para pausar.' })

    const hechas: unknown[] = []
    let ok = 0, saltadas = 0, errores = 0

    for (const p of objetivo) {
      if (p.estado !== estadoBuscado) {
        saltadas++
        hechas.push({ item_id: p.item_id, modelo: p.modelo, resultado: `saltada (estaba ${p.estado})` })
        continue
      }

      const res = await ml(`/items/${p.item_id}`, token, {
        method: 'PUT',
        body: JSON.stringify({ status: nuevoEstado }),
      })

      if (res.ok) {
        ok++
        await sb.from('mapeo_producto_ml')
          .update({ estado: nuevoEstado, ultimo_sync: new Date().toISOString(), ultimo_error: null })
          .eq('item_id', p.item_id)
        hechas.push({ item_id: p.item_id, modelo: p.modelo, vendidas: p.sold_quantity, resultado: nuevoEstado })
      } else {
        errores++
        const detalle = (await res.text()).slice(0, 300)
        await sb.from('mapeo_producto_ml').update({ ultimo_error: `${res.status}: ${detalle}` }).eq('item_id', p.item_id)
        hechas.push({ item_id: p.item_id, modelo: p.modelo, resultado: `error ${res.status}`, detalle })
      }
    }

    return json({
      ok: true,
      accion: revertir ? 'reactivadas' : 'pausadas',
      resumen: { objetivo: objetivo.length, aplicadas: ok, saltadas, errores },
      nota: 'Reversible: correr esta misma funcion con ?revertir=1 para volver atras.',
      detalle: hechas,
    })
  } catch (e) {
    return json({ error: String(e) }, 500)
  }
})
