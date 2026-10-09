// Espejo de la tienda web en la tienda oficial de Mercado Libre.
//
// El plan vive en ml_plan_tienda (una fila por SKU, con seccion y precio). Se arma por SQL
// desde ml_web_snapshot (lo publicado y disponible en la web) + las secciones extra
// (Oportunidad a $89.000: top 30 vendidos fuera de la web + Shakur recetados).
//
// Que hace con cada SKU del plan:
//   - Si ya tiene publicacion (activa o pausada): le pone el precio del plan, las fotos de la
//     web en el mismo orden (estuches incluidos, como en la web) y la prende.
//   - Si no tiene: la crea con la ficha de ml-ficha.ts y la deja activa.
// Y con lo que NO esta en el plan: lo pausa (nunca finaliza) y lo marca decision =
// 'fuera_tienda' para que ml-sync no lo vuelva a prender por stock.
//
// Las fotos son las de la ficha de la web, en el mismo orden, guardadas en ml_plan_tienda.fotos.
// Se bajan de afuera y no desde la funcion: Shopify (y a veces ML) le devuelve 429
// local_rate_limited a las salidas de Supabase. Los SKUs sin handle (Oportunidad) usan producto_imagenes.
//
// Va por tandas porque son ~230 publicaciones y ML corta por rate limit (un 429 en el
// refresh ya desconecto la cuenta una vez):
//   (sin parametros)        -> informe de lo que haria. No escribe.
//   ?ejecutar=1&limite=25   -> procesa las proximas 25 del plan sin resultado 'ok'.
//   ?pausar=1&limite=50     -> pausa las proximas 50 que no estan en el plan.
//   ?pausar_seccion=X[&dejar=receta] -> pausa la seccion X sin sacarla del plan (ver abajo).

import { db, getToken, ml, json } from '../_shared/ml.ts'
import {
  PLANTILLA, type Fila, leerPlantilla, armarAtributos, armarDescripcion, armarFamilia, fotosDe,
} from '../_shared/ml-ficha.ts'

const MAX_FOTOS = 10

interface Plan {
  codigo: string
  seccion: string
  precio: number
  handle: string | null
  fotos: string[] | null
  resultado: string | null
}

const pausa = (ms: number) => new Promise((r) => setTimeout(r, ms))

Deno.serve(async (req) => {
  try {
    const sb = db()
    const url = new URL(req.url)
    const ejecutar = url.searchParams.get('ejecutar') === '1'
    const pausar = url.searchParams.get('pausar') === '1'
    const limite = Math.min(Number(url.searchParams.get('limite') ?? 25), 60)

    const { data: plan, error } = await sb.from('ml_plan_tienda')
      .select('codigo, seccion, precio, handle, fotos, resultado, item_id').order('seccion').order('codigo')
    if (error) return json({ error: error.message }, 500)

    const { data: mapeo } = await sb.from('mapeo_producto_ml')
      .select('item_id, codigo, estado, decision').in('estado', ['active', 'paused'])
    const itemDe = new Map<string, string>()
    for (const m of mapeo ?? []) {
      // Si un SKU tiene varias publicaciones se queda la activa (la que tiene historial).
      if (m.codigo && (!itemDe.has(m.codigo) || m.estado === 'active')) itemDe.set(m.codigo, m.item_id)
    }
    // Una vez ejecutado, la publicacion del plan es LA del SKU. Sin esto, con dos activas del
    // mismo SKU se elegia cualquiera y el modo pausar apagaba la del plan.
    for (const p of plan ?? []) if (p.item_id) itemDe.set(p.codigo, p.item_id)
    const enPlan = new Set((plan ?? []).map((p) => p.codigo))
    const elegidas = new Set(itemDe.values())
    // 'tienda_duplicada': otra publicacion del mismo SKU que la del plan. ML las reactiva solo
    // al mover el stock de la del plan (comparten producto), asi que no se pausan: se les
    // iguala el precio (?igualar=1).
    const sobrantes = (mapeo ?? []).filter((m) =>
      m.estado === 'active' && m.decision !== 'tienda_duplicada' &&
      (!m.codigo || !enPlan.has(m.codigo) || !elegidas.has(m.item_id)))

    if (!ejecutar && !pausar && !url.searchParams.get('pausar_seccion')) {
      const porSeccion: Record<string, number> = {}
      for (const p of plan ?? []) porSeccion[p.seccion] = (porSeccion[p.seccion] ?? 0) + 1
      return json({
        ok: true, modo: 'informe — no se escribio nada',
        plan: porSeccion,
        actualizar: (plan ?? []).filter((p) => itemDe.has(p.codigo)).length,
        crear: (plan ?? []).filter((p) => !itemDe.has(p.codigo)).length,
        pendientes: (plan ?? []).filter((p) => p.resultado !== 'ok').length,
        a_pausar: sobrantes.length,
      })
    }

    // Los modos que escriben en ML piden una clave propia: la anon key es publica.
    const clave = Deno.env.get('ML_ESPEJO_CLAVE')
    if (!clave || req.headers.get('x-espejo-clave') !== clave) {
      return json({ error: 'Falta la clave x-espejo-clave para escribir en ML' }, 401)
    }

    const { token } = await getToken(sb)
    const hechas: unknown[] = []

    // ?diagnostico=1 -> por que ML tiene sin activar publicaciones del plan (solo lee).
    if (url.searchParams.get('diagnostico') === '1') {
      const ids = (plan ?? []).map((p) => (p as { item_id?: string }).item_id).filter(Boolean)
      const { data: noActivas } = await sb.from('mapeo_producto_ml')
        .select('item_id, codigo, seccion, estado').in('item_id', ids as string[]).neq('estado', 'active')
      for (const m of noActivas ?? []) {
        const r = await ml(`/items/${m.item_id}?attributes=status,sub_status,health,warnings,tags`, token)
        hechas.push({ ...m, ml: r.ok ? await r.json() : `${r.status}` })
        await pausa(200)
      }
      return json({ ok: true, modo: 'diagnostico', detalle: hechas })
    }

    if (url.searchParams.get('igualar') === '1') {
      const precioDe = new Map((plan ?? []).map((p) => [p.codigo, Number(p.precio)]))
      const duplicadas = (mapeo ?? []).filter((m) =>
        m.codigo && precioDe.has(m.codigo) && !elegidas.has(m.item_id))
      for (const m of duplicadas.slice(0, limite)) {
        const precio = precioDe.get(m.codigo!)!
        const res = await ml(`/items/${m.item_id}`, token, { method: 'PUT', body: JSON.stringify({ price: precio }) })
        const detalle = res.ok ? null : `${res.status}: ${(await res.text()).slice(0, 300)}`
        await sb.from('mapeo_producto_ml').update({
          decision: 'tienda_duplicada', precio_actual: res.ok ? precio : undefined, ultimo_error: detalle,
        }).eq('item_id', m.item_id)
        hechas.push({ item_id: m.item_id, codigo: m.codigo, precio, resultado: detalle ?? 'ok' })
        await pausa(250)
      }
      return json({ ok: true, modo: 'igualar', procesadas: hechas.length, total: duplicadas.length, detalle: hechas })
    }

    // ?pausar_seccion=Oportunidad -> pausa una seccion entera del plan sin sacarla del plan.
    // Queda resultado 'pausada' (ejecutar no la toma) y decision 'pausa_seccion' (ml-sync no
    // la prende por stock). Para volver: resultado = null en esa seccion y ?ejecutar=1.
    const seccionPausa = url.searchParams.get('pausar_seccion')
    // &dejar=receta -> deja activos los de ese tipo (Oportunidad: se pausa el sol, siguen los recetados).
    if (seccionPausa) {
      const dejar = url.searchParams.get('dejar')
      const enSeccion = (plan ?? []).filter((p) => p.seccion === seccionPausa && p.resultado !== 'pausada')
      const { data: tipos } = await sb.from('stock').select('codigo, tipo').in('codigo', enSeccion.map((p) => p.codigo))
      const tipoDe = new Map((tipos ?? []).map((t) => [t.codigo, t.tipo]))
      const filas = enSeccion.filter((p) => !dejar || tipoDe.get(p.codigo) !== dejar)
      for (const p of filas.slice(0, limite)) {
        const itemId = itemDe.get(p.codigo)
        let resultado = 'pausada'
        if (itemId) {
          const res = await ml(`/items/${itemId}`, token, { method: 'PUT', body: JSON.stringify({ status: 'paused' }) })
          if (res.ok) {
            await sb.from('mapeo_producto_ml').update({ estado: 'paused', decision: 'pausa_seccion', ultimo_error: null })
              .eq('item_id', itemId)
          } else {
            resultado = `error pausa ${res.status}: ${(await res.text()).slice(0, 300)}`
          }
          await pausa(250)
        }
        if (resultado === 'pausada') {
          await sb.from('ml_plan_tienda').update({ accion: 'pausar_seccion', resultado, ejecutado_at: new Date().toISOString() })
            .eq('codigo', p.codigo)
        }
        hechas.push({ codigo: p.codigo, item_id: itemId, resultado })
      }
      return json({ ok: true, modo: 'pausar_seccion', seccion: seccionPausa, procesadas: hechas.length, quedan: Math.max(filas.length - limite, 0), detalle: hechas })
    }

    if (pausar) {
      for (const m of sobrantes.slice(0, limite)) {
        const res = await ml(`/items/${m.item_id}`, token, { method: 'PUT', body: JSON.stringify({ status: 'paused' }) })
        const ok = res.ok
        await sb.from('mapeo_producto_ml').update({
          estado: ok ? 'paused' : undefined, decision: 'fuera_tienda',
          ultimo_error: ok ? null : `${res.status}: ${(await res.text()).slice(0, 300)}`,
        }).eq('item_id', m.item_id)
        hechas.push({ item_id: m.item_id, codigo: m.codigo, resultado: ok ? 'pausada' : `error ${res.status}` })
        await pausa(250)
      }
      return json({ ok: true, modo: 'pausar', procesadas: hechas.length, quedan: Math.max(sobrantes.length - limite, 0), detalle: hechas })
    }

    const plantillas = {
      sol: await leerPlantilla(PLANTILLA.sol, token),
      receta: await leerPlantilla(PLANTILLA.receta, token),
    }

    // Lo que fallo no se reintenta solo (se repetia en cada tanda): ?reintentar=1 lo vuelve a tomar.
    const reintentar = url.searchParams.get('reintentar') === '1'
    const tanda = (plan ?? []).filter((p) => !p.resultado || (reintentar && p.resultado !== 'ok' && p.resultado !== 'pausada'))
      .slice(0, limite) as Plan[]
    const { data: filas } = await sb.from('stock')
      .select('codigo, modelo, descripcion, tipo, tratamiento, cantidad')
      .in('codigo', tanda.map((p) => p.codigo))
    const filaDe = new Map((filas ?? []).map((f) => [f.codigo, f]))

    for (const p of tanda) {
      const s = filaDe.get(p.codigo)
      const marcar = (accion: string, resultado: string, item_id?: string) =>
        sb.from('ml_plan_tienda').update({ accion, resultado, item_id, ejecutado_at: new Date().toISOString() })
          .eq('codigo', p.codigo)

      if (!s) { await marcar('saltada', 'el SKU no esta en stock'); continue }
      const fila: Fila = {
        codigo: s.codigo, modelo: String(s.modelo ?? '').toUpperCase().trim(), color: s.descripcion,
        tipo: s.tipo, tratamiento: s.tratamiento, precio: Number(p.precio),
        cantidad_publicable: Math.max(Number(s.cantidad ?? 0) - 2, 0), seccion: p.seccion,
      }
      // Si esta en la web, las fotos son las de la web o nada: las del modelo mezclan colores.
      const pictures = p.handle
        ? (p.fotos ?? []).slice(0, MAX_FOTOS).map((source) => ({ source }))
        : await fotosDe(sb, fila)
      if (!pictures.length) { await marcar('saltada', 'sin fotos'); hechas.push({ codigo: p.codigo, error: 'sin fotos' }); continue }

      const cantidad = Math.min(fila.cantidad_publicable, 20)
      const existente = itemDe.get(p.codigo)
      let itemId = existente
      let res: Response

      if (existente) {
        res = await ml(`/items/${existente}`, token, {
          method: 'PUT',
          body: JSON.stringify({ price: fila.precio, pictures, available_quantity: cantidad, status: 'active' }),
        })
        // Publicacion de catalogo: las fotos son las del catalogo de ML y no se pueden pisar
        // (field_not_updatable). Se actualiza todo lo demas.
        if (res.status === 400) {
          const cuerpo = await res.clone().text()
          if (cuerpo.includes('field_not_updatable') && cuerpo.includes('pictures')) {
            res = await ml(`/items/${existente}`, token, {
              method: 'PUT',
              body: JSON.stringify({ price: fila.precio, available_quantity: cantidad, status: 'active' }),
            })
          }
        }
      } else {
        const pl = plantillas[fila.tipo === 'receta' ? 'receta' : 'sol']
        if ('error' in pl) { await marcar('error', pl.error); continue }
        res = await ml('/items', token, {
          method: 'POST',
          body: JSON.stringify({
            ...pl.config,
            family_name: armarFamilia(fila),
            price: fila.precio,
            available_quantity: cantidad,
            seller_custom_field: fila.codigo,
            pictures,
            attributes: [...armarAtributos(fila).filter((a) => a.value_name !== null), ...pl.fiscales],
          }),
        })
      }

      if (!res.ok) {
        const detalle = `${res.status}: ${(await res.text()).slice(0, 400)}`
        await marcar(existente ? 'actualizar' : 'crear', `error ${detalle}`, existente)
        hechas.push({ codigo: p.codigo, item_id: existente, error: detalle })
        await pausa(400)
        continue
      }

      const it = await res.json()
      itemId = String(it.id)
      await ml(`/items/${itemId}/description`, token, {
        method: 'PUT', body: JSON.stringify({ plain_text: armarDescripcion(fila) }),
      })
      await sb.from('mapeo_producto_ml').upsert({
        item_id: itemId, codigo: fila.codigo, modelo: fila.modelo, titulo: it.title,
        estado: it.status ?? 'active', logistic_type: it.shipping?.logistic_type ?? null,
        available_quantity: it.available_quantity ?? cantidad, precio_actual: it.price ?? fila.precio,
        permalink: it.permalink ?? null, seccion: p.seccion,
        match_origen: existente ? undefined : 'sku',
        // Decision manual explicita: ml-sync la respeta y solo le mueve el stock.
        decision: 'tienda',
      }, { onConflict: 'item_id' })
      await marcar(existente ? 'actualizar' : 'crear', 'ok', itemId)
      hechas.push({ codigo: p.codigo, item_id: itemId, seccion: p.seccion, precio: it.price, fotos: pictures.length, titulo: it.title })
      await pausa(400)
    }

    const pendientes = (plan ?? []).filter((p) => !p.resultado).length - tanda.filter((p) => !p.resultado).length
    return json({ ok: true, modo: 'ejecutar', procesadas: tanda.length, pendientes, detalle: hechas })
  } catch (e) {
    return json({ error: String(e) }, 500)
  }
})
