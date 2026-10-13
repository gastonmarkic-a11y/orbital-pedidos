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
import {
  PLANTILLA, type Fila, leerPlantilla, armarAtributos, armarDescripcion, armarFamilia, fotosDe,
} from '../_shared/ml-ficha.ts'

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
        // Se corrigen atributos Y fotos: si el SKU ya tiene foto de su color exacto
        // (recien importada de Shopify), reemplaza a la generica del modelo.
        const cambios: Record<string, unknown> = { attributes: atributos }
        const pics = await fotosDe(sb, p)
        if (pics.length) cambios.pictures = pics
        const res = await ml(`/items/${yaExiste}`, token, {
          method: 'PUT', body: JSON.stringify(cambios),
        })
        // La descripcion va por su propio endpoint.
        await ml(`/items/${yaExiste}/description`, token, {
          method: 'PUT', body: JSON.stringify({ plain_text: armarDescripcion(p) }),
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
        // Al crear no van los null (esos solo sirven para borrar en el modo correccion)
        // y si van los fiscales, que la categoria exige.
        attributes: [...atributos.filter((a) => a.value_name !== null), ...pl.fiscales],
      }

      const res = await ml('/items', token, { method: 'POST', body: JSON.stringify(payload) })
      if (!res.ok) {
        errores++
        hechas.push({ codigo: p.codigo, error: `${res.status}: ${(await res.text()).slice(0, 500)}` })
        continue
      }

      const nuevo = await res.json()
      await ml(`/items/${nuevo.id}`, token, { method: 'PUT', body: JSON.stringify({ status: 'paused' }) })
      await ml(`/items/${nuevo.id}/description`, token, {
        method: 'PUT', body: JSON.stringify({ plain_text: armarDescripcion(p) }),
      })

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
        // Sin esto ml-sync la reactivaba en la corrida siguiente (30 min) y la revision
        // nunca pasaba. Se limpia a mano cuando Gaston aprueba la foto y el titulo.
        decision: 'revisar',
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
