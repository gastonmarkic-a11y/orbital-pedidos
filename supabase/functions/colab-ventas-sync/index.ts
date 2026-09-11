// Edge Function: colab-ventas-sync
// Atribuye pedidos de la tienda (línea) a los links de colaboradores por el CÓDIGO de
// descuento: cada toque del link genera un código único, así que el pedido que lo usa
// vino de ese link. Recorre los pedidos ACTUALIZADOS en los últimos N días (default 40)
// para capturar pagos, cancelaciones y devoluciones, y recalcula cada venta atribuida.
//
// Base de comisión = productos después de descuentos y devoluciones (current_subtotal_price),
// SIN IVA y SIN envío. Solo comisiona si está pagado (paid / partially_refunded).
// Comisión influencer = base × pct del influencer · comisión admin = base × pct del admin.
//
// Auth (verify_jwt=false): x-cron-key == app_config.cron_key, o body.clave de un admin de colaboradores.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const IVA = 1.21

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-key',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body, null, 2), { status, headers: { 'Content-Type': 'application/json', ...cors } })
}

const r2 = (n: number) => Math.round(n * 100) / 100

type Orden = {
  id: number; name: string; created_at: string; cancelled_at: string | null
  financial_status: string | null; taxes_included: boolean | null
  discount_codes: { code: string }[] | null
  current_subtotal_price?: string; subtotal_price?: string; current_total_price?: string; total_price?: string
  line_items: { quantity: number; current_quantity?: number }[]
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  let ok = false
  const cronKey = req.headers.get('x-cron-key')
  if (cronKey) {
    const { data: cfg } = await db.from('app_config').select('valor').eq('clave', 'cron_key').maybeSingle()
    ok = !!cfg && cfg.valor === cronKey
  }
  if (!ok) {
    const body = await req.json().catch(() => ({})) as { clave?: string }
    if (body.clave) {
      const [{ data: a }, { data: o }] = await Promise.all([
        db.from('colab_admin').select('id').eq('clave', body.clave).eq('activo', true).maybeSingle(),
        db.from('colab_orbital').select('id').eq('clave', body.clave).eq('activo', true).maybeSingle(),
      ])
      ok = !!a || !!o
    }
  }
  if (!ok) return json({ error: 'no_autorizado' }, 401)

  // Códigos emitidos → link
  const porCodigo = new Map<string, number>()
  for (let d = 0; ; d += 1000) {
    const { data } = await db.from('colab_click').select('codigo_descuento, link_id').not('codigo_descuento', 'is', null).range(d, d + 999)
    for (const c of data ?? []) porCodigo.set(String(c.codigo_descuento).toUpperCase(), c.link_id)
    if (!data || data.length < 1000) break
  }
  if (!porCodigo.size) return json({ ok: true, codigos: 0, pedidos_revisados: 0, atribuidos: 0 })

  const { data: links } = await db.from('colab_link')
    .select('id, modelo, influencer_id, influencer:colab_influencer(pct_comision, admin_id, admin:colab_admin(pct_comision))')
  // deno-lint-ignore no-explicit-any
  const linkPor = new Map((links ?? []).map((l: any) => [l.id, l]))

  const { data: store } = await db.from('shopify_stores').select('shop_domain, access_token').eq('id', 'linea').maybeSingle()
  if (!store) return json({ error: 'tienda_no_conectada' }, 400)
  const ver = Deno.env.get('SHOPIFY_API_VERSION') ?? '2025-01'
  const H = { 'X-Shopify-Access-Token': store.access_token, 'Content-Type': 'application/json' }

  const url = new URL(req.url)
  const dias = Math.min(Number(url.searchParams.get('dias') ?? 40), 120)
  const desde = new Date(Date.now() - dias * 86_400_000).toISOString()
  const campos = 'id,name,created_at,cancelled_at,financial_status,taxes_included,discount_codes,' +
    'current_subtotal_price,subtotal_price,current_total_price,total_price,line_items'
  let next: string | null =
    `https://${store.shop_domain}/admin/api/${ver}/orders.json?status=any&limit=250&updated_at_min=${desde}&fields=${campos}`

  let revisados = 0
  const filas = []
  while (next) {
    const res: Response = await fetch(next, { headers: H })
    if (!res.ok) return json({ error: 'shopify_error', status: res.status, detalle: (await res.text()).slice(0, 300) }, 502)
    const ordenes: Orden[] = (await res.json()).orders ?? []
    revisados += ordenes.length
    for (const o of ordenes) {
      const dc = (o.discount_codes ?? []).find((d) => porCodigo.has(String(d.code).toUpperCase()))
      if (!dc) continue
      const code = String(dc.code).toUpperCase()
      // deno-lint-ignore no-explicit-any
      const l: any = linkPor.get(porCodigo.get(code)!)
      if (!l) continue
      const fs = o.financial_status ?? ''
      const estado = o.cancelled_at ? 'cancelado'
        : fs === 'paid' || fs === 'partially_refunded' ? 'pagado'
        : fs === 'refunded' ? 'reembolsado'
        : 'pendiente'
      const subtotal = Number(o.current_subtotal_price ?? o.subtotal_price ?? 0) || 0
      const neto = o.taxes_included === false ? subtotal : subtotal / IVA
      const base = estado === 'pagado' ? neto : 0
      const pctInf = Number(l.influencer?.pct_comision ?? 15)
      const pctAdm = Number(l.influencer?.admin?.pct_comision ?? 5)
      filas.push({
        order_id: String(o.id),
        order_name: o.name,
        fecha: o.created_at,
        codigo_descuento: code,
        link_id: l.id,
        influencer_id: l.influencer_id,
        admin_id: l.influencer?.admin_id ?? null,
        modelo: l.modelo,
        estado,
        unidades: (o.line_items ?? []).reduce((a, li) => a + (li.current_quantity ?? li.quantity ?? 0), 0),
        total_cliente: Number(o.current_total_price ?? o.total_price ?? 0) || 0,
        neto_sin_iva: r2(neto),
        pct_influencer: pctInf,
        pct_admin: pctAdm,
        com_influencer: r2(base * pctInf / 100),
        com_admin: r2(base * pctAdm / 100),
        raw: {
          name: o.name, financial_status: o.financial_status, cancelled_at: o.cancelled_at,
          discount_codes: o.discount_codes, current_subtotal_price: o.current_subtotal_price,
          taxes_included: o.taxes_included,
        },
        updated_at: new Date().toISOString(),
      })
    }
    const m = (res.headers.get('link') ?? '').match(/<([^>]+)>;\s*rel="next"/)
    next = m ? m[1] : null
  }

  if (filas.length) {
    const { error } = await db.from('colab_venta').upsert(filas, { onConflict: 'order_id' })
    if (error) return json({ error: 'db_error', detalle: error.message }, 500)
  }
  return json({ ok: true, codigos: porCodigo.size, pedidos_revisados: revisados, atribuidos: filas.length })
})
