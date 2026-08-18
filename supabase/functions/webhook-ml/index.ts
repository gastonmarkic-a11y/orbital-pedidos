// Recibe las notificaciones de Mercado Libre.
//
// ML reintenta cada notificacion hasta recibir un 200 y manda duplicados, asi que
// lo primero es la cola idempotente: si la notificacion ya entro, se contesta 200
// y se corta. Sin eso se duplican pedidos.
//
// Topics configurados en el panel: orders_v2, questions, messages, items, shipments.
//
// URL a cargar como "URL de notificaciones":
//   https://<proyecto>.supabase.co/functions/v1/webhook-ml

import { db, getToken, ml, json } from '../_shared/ml.ts'

interface Notificacion {
  resource: string
  user_id: number
  topic: string
  application_id?: number
  sent?: string
  attempts?: number
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ ok: true, aviso: 'webhook-ml activo' })

  let n: Notificacion
  try {
    n = await req.json()
  } catch {
    return json({ ok: true }) // payload ilegible: 200 igual, para que ML no reintente eternamente
  }

  const sb = db()
  // La clave de idempotencia es topic+resource+sent: ML puede mandar la misma
  // combinacion varias veces y cada envio trae su timestamp.
  const clave = `${n.topic}:${n.resource}:${n.sent ?? ''}`

  const { error: errCola } = await sb.from('ml_procesados')
    .insert({ notificacion: clave, topic: n.topic, resource: n.resource })

  // Violacion de unique = ya la procesamos. 200 y afuera.
  if (errCola?.code === '23505') return json({ ok: true, duplicada: true })
  if (errCola) return json({ ok: true, aviso: errCola.message })

  // A ML se le contesta rapido; el trabajo pesado va detras del 200.
  const procesar = async () => {
    try {
      const { token } = await getToken(sb)

      if (n.topic === 'orders_v2') {
        await importarOrden(sb, token, n.resource)
      } else if (n.topic === 'questions') {
        await guardarPregunta(sb, token, n.resource)
      } else if (n.topic === 'items') {
        await refrescarItem(sb, token, n.resource)
      }
      // messages y shipments: se registran en la cola, todavia sin handler.

      await sb.from('ml_procesados')
        .update({ estado: 'procesado', procesado_en: new Date().toISOString() })
        .eq('notificacion', clave)
    } catch (e) {
      await sb.from('ml_procesados')
        .update({ estado: 'error', error_detalle: String(e).slice(0, 500) })
        .eq('notificacion', clave)
    }
  }

  procesar()
  return json({ ok: true })
})

async function importarOrden(sb: ReturnType<typeof db>, token: string, resource: string) {
  const orden = await ml(resource, token).then((r) => r.json())
  const unidades = (orden.order_items ?? []).reduce(
    (a: number, i: { quantity: number }) => a + i.quantity, 0)

  await sb.from('ventas_ml').upsert({
    order_id: String(orden.id),
    pack_id: orden.pack_id ? String(orden.pack_id) : null,
    fecha: orden.date_created,
    comprador: orden.buyer?.nickname ?? null,
    total: orden.total_amount ?? null,
    unidades,
    shipping_id: orden.shipping?.id ? String(orden.shipping.id) : null,
    estado: orden.status ?? null,
    raw: orden,
  }, { onConflict: 'order_id' })

  // El alta del pedido en el circuito de deposito va en el paso siguiente:
  // las ventas Full no pasan por picking (las despacha ML) y las de stock propio si,
  // asi que conviene decidir eso con logistic_type ya resuelto.
}

async function guardarPregunta(sb: ReturnType<typeof db>, token: string, resource: string) {
  const q = await ml(resource, token).then((r) => r.json())
  await sb.from('ml_preguntas').upsert({
    question_id: String(q.id),
    item_id: q.item_id ?? null,
    texto: q.text ?? null,
    estado: q.status ?? 'pendiente',
  }, { onConflict: 'question_id' })

  // OJO al conectar bot-central: ML prohibe sacar al comprador de la plataforma.
  // No se puede responder con WhatsApp, telefono, mail ni links externos — ML lo
  // modera y penaliza la reputacion de la cuenta.
}

async function refrescarItem(sb: ReturnType<typeof db>, token: string, resource: string) {
  const item = await ml(resource, token).then((r) => r.json())
  await sb.from('mapeo_producto_ml').upsert({
    item_id: String(item.id),
    titulo: item.title ?? null,
    estado: item.status ?? null,
    logistic_type: item.shipping?.logistic_type ?? null,
  }, { onConflict: 'item_id' })
}
