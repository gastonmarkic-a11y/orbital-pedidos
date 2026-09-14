// Edge Function: colab-click  (pública, verify_jwt=false)
// La llama la landing ver.orbitaleyewear.com.ar/r/<codigo> (el link que un promotor pegó
// en su historia o publicación). Dos pasos:
//   accion 'ver'     → datos de la landing (modelo, colores con stock, precios, % y promotor)
//                      y registra el toque (1 por visitante cada 30 min).
//   accion 'comprar' → consigue la regla del modelo en Shopify (1 price rule por modelo + %),
//                      crea un código ÚNICO de un solo uso (ORB + 6) y devuelve adónde ir:
//                        · SOL    → checkout directo /cart/<variant_id>:1?discount=<code>
//                        · RECETA → la ficha con el código aplicado (ahí se eligen las lentes)
//   sin accion       → como 'comprar' con el color del link (compatibilidad con la versión vieja).
// El pedido que use ese código se atribuye al link (lo hace colab-ventas-sync).
// El código se genera recién al tocar Comprar: mirar la landing no gasta códigos.
// Si el mismo navegador ya tenía código para ese link y no se usó en un pedido, lo reusa.
// Promotor con pct_descuento 0 (cobranding ZN): no hay código; va a la ficha con UTM y
// colab-ventas-sync atribuye por utm_content = codigo del link.

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

const TIENDA = 'https://www.orbitaleyewear.com.ar'
const ALFA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const FRENO_POR_MINUTO = 60
const VENTANA_TOQUE_MS = 30 * 60_000

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...cors } })
}

function codigoNuevo() {
  const a = crypto.getRandomValues(new Uint8Array(6))
  return 'ORB' + Array.from(a, (b) => ALFA[b % ALFA.length]).join('')
}

async function crearCodigo(db: SupabaseClient, modelo: string, pct: number, intento = 0): Promise<string> {
  const { data: store } = await db.from('shopify_stores').select('shop_domain, access_token').eq('id', 'linea').maybeSingle()
  if (!store) throw new Error('tienda_no_conectada')
  const ver = Deno.env.get('SHOPIFY_API_VERSION') ?? '2025-01'
  const api = (p: string) => `https://${store.shop_domain}/admin/api/${ver}/${p}`
  const H = { 'X-Shopify-Access-Token': store.access_token, 'Content-Type': 'application/json' }

  // El descuento aplica a TODOS los colores disponibles del modelo promocionado.
  const { data: prods } = await db.from('colab_producto').select('product_id').eq('modelo', modelo).eq('disponible', true)
  const ids = (prods ?? []).map((p: { product_id: number }) => Number(p.product_id)).sort((a, b) => a - b)
  if (!ids.length) throw new Error('modelo_sin_stock')

  const { data: regla } = await db.from('colab_regla').select('price_rule_id, product_ids').eq('modelo', modelo).eq('pct', pct).maybeSingle()
  let ruleId: number | null = regla?.price_rule_id ?? null

  if (!ruleId) {
    const r = await fetch(api('price_rules.json'), {
      method: 'POST', headers: H,
      body: JSON.stringify({
        price_rule: {
          title: `COLAB ${pct}% · ${modelo}`,
          target_type: 'line_item',
          target_selection: 'entitled',
          allocation_method: 'across',
          value_type: 'percentage',
          value: `-${pct}`,
          customer_selection: 'all',
          entitled_product_ids: ids,
          usage_limit: 1,              // por código: cada código se usa una sola vez
          once_per_customer: false,
          starts_at: new Date(Date.now() - 60_000).toISOString(),
        },
      }),
    })
    const t = await r.text()
    if (!r.ok) throw new Error(`price_rule ${r.status}: ${t.slice(0, 300)}`)
    ruleId = JSON.parse(t).price_rule.id as number
    await db.from('colab_regla').upsert({ modelo, pct, price_rule_id: ruleId, product_ids: ids, updated_at: new Date().toISOString() })
  } else {
    const antes = [...(regla?.product_ids ?? [])].map(Number).sort((a, b) => a - b)
    if (JSON.stringify(antes) !== JSON.stringify(ids)) {
      const r = await fetch(api(`price_rules/${ruleId}.json`), {
        method: 'PUT', headers: H, body: JSON.stringify({ price_rule: { id: ruleId, entitled_product_ids: ids } }),
      })
      if (r.ok) await db.from('colab_regla').update({ product_ids: ids, updated_at: new Date().toISOString() }).eq('modelo', modelo).eq('pct', pct)
    }
  }

  for (let i = 0; i < 4; i++) {
    const code = codigoNuevo()
    const r = await fetch(api(`price_rules/${ruleId}/discount_codes.json`), {
      method: 'POST', headers: H, body: JSON.stringify({ discount_code: { code } }),
    })
    if (r.ok) return code
    const t = await r.text()
    if (r.status === 404 && intento === 0) {
      // La regla se borró en Shopify: se recrea una vez.
      await db.from('colab_regla').delete().eq('modelo', modelo).eq('pct', pct)
      return crearCodigo(db, modelo, pct, 1)
    }
    if (r.status !== 422) throw new Error(`discount_code ${r.status}: ${t.slice(0, 300)}`)
  }
  throw new Error('no_se_pudo_generar_codigo')
}

type Prod = {
  handle: string; color: string | null; imagen: string | null; imagenes: string[] | null
  price: number | null; compare_at: number | null; variant_id: number | null; tipo: string | null
  linea: string | null; descripcion: string | null
}
const COLS = 'handle, color, imagen, imagenes, price, compare_at, variant_id, tipo, linea, descripcion'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const body = await req.json().catch(() => ({})) as { codigo?: string; visitante?: string; accion?: string; handle?: string }
  const codigo = String(body.codigo ?? '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12)
  const visitante = String(body.visitante ?? '').replace(/[^a-zA-Z0-9-]/g, '').slice(0, 40) || null
  const accion = body.accion === 'ver' ? 'ver' : 'comprar'
  const legacy = !body.accion
  if (!codigo) return json({ ok: false, error: 'falta_codigo', redirect: TIENDA }, 400)

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  const { data: link } = await db.from('colab_link')
    .select('id, codigo, modelo, handle, red, activo, influencer:colab_influencer(id, nombre, ref, pct_descuento, activo, admin:colab_admin(activo))')
    .eq('codigo', codigo).maybeSingle()
  // deno-lint-ignore no-explicit-any
  const inf = (link as any)?.influencer
  if (!link) return json({ ok: false, error: 'link_inexistente', redirect: TIENDA })
  if (!link.activo || !inf?.activo || !inf?.admin?.activo) {
    return json({ ok: false, error: 'link_inactivo', redirect: `${TIENDA}/products/${link.handle}` })
  }

  // 0 es un valor válido (promotor sin cupón); solo sin dato se usa el 30 por defecto.
  const pct = inf.pct_descuento == null ? 30 : Number(inf.pct_descuento) || 0
  const utm = new URLSearchParams({ utm_source: 'colab', utm_medium: link.red, utm_campaign: `colab_${inf.ref}`, utm_content: link.codigo })
  const { data: disp } = await db.from('colab_producto').select(COLS).eq('modelo', link.modelo).eq('disponible', true).order('handle')
  const colores = (disp ?? []) as Prod[]

  // ── ver: datos de la landing + toque ──
  if (accion === 'ver') {
    if (visitante) {
      const { count } = await db.from('colab_click').select('id', { count: 'exact', head: true })
        .eq('link_id', link.id).eq('visitante', visitante).gte('ts', new Date(Date.now() - VENTANA_TOQUE_MS).toISOString())
      if (!count) await db.from('colab_click').insert({ link_id: link.id, visitante })
    } else {
      await db.from('colab_click').insert({ link_id: link.id, visitante: null })
    }
    const { data: store } = await db.from('shopify_stores').select('scope').eq('id', 'linea').maybeSingle()
    const descuentoActivo = pct > 0 && /write_price_rules|write_discounts/.test(String(store?.scope ?? ''))
    return json({
      ok: true, modelo: link.modelo, influencer: inf.nombre, pct, descuento_activo: descuentoActivo,
      seleccionado: colores.some((c) => c.handle === link.handle) ? link.handle : colores[0]?.handle ?? null,
      colores, tienda: `${TIENDA}/products/${link.handle}?${utm}`, utm: utm.toString(),
    })
  }

  // ── comprar ──
  const handlePedido = legacy ? link.handle : String(body.handle ?? '')
  const prod = colores.find((c) => c.handle === handlePedido) ?? colores[0]
  if (!prod) return json({ ok: false, error: 'sin_stock', redirect: `${TIENDA}/products/${link.handle}?${utm}` })

  const productoPath = `/products/${prod.handle}?${utm}`
  if (pct <= 0) {
    if (legacy) await db.from('colab_click').insert({ link_id: link.id, codigo_descuento: null, visitante })
    return json({ ok: true, sin_codigo: true, redirect: TIENDA + productoPath })
  }
  const directo = prod.tipo === 'SOL' && !!prod.variant_id && !legacy
  const destino = (code: string) => directo
    ? `${TIENDA}/cart/${prod.variant_id}:1?${new URLSearchParams({ discount: code, ...Object.fromEntries(utm) })}`
    : `${TIENDA}/discount/${encodeURIComponent(code)}?redirect=${encodeURIComponent(productoPath)}`
  const info = { modelo: link.modelo, color: prod.color, imagen: prod.imagen, price: prod.price, compare_at: prod.compare_at, pct, influencer: inf.nombre, directo }

  // El código queda en el toque de este visitante (así el toque no se cuenta dos veces).
  const anotar = async (code: string) => {
    if (visitante) {
      const { data: t } = await db.from('colab_click').select('id').eq('link_id', link.id).eq('visitante', visitante)
        .is('codigo_descuento', null).order('ts', { ascending: false }).limit(1).maybeSingle()
      if (t) { await db.from('colab_click').update({ codigo_descuento: code }).eq('id', t.id); return }
    }
    await db.from('colab_click').insert({ link_id: link.id, codigo_descuento: code, visitante })
  }

  if (visitante) {
    const { data: prev } = await db.from('colab_click').select('codigo_descuento')
      .eq('link_id', link.id).eq('visitante', visitante).not('codigo_descuento', 'is', null)
      .order('ts', { ascending: false }).limit(1).maybeSingle()
    if (prev?.codigo_descuento) {
      const { count: usado } = await db.from('colab_venta').select('order_id', { count: 'exact', head: true }).eq('codigo_descuento', prev.codigo_descuento)
      if (!usado) return json({ ok: true, reuso: true, code: prev.codigo_descuento, redirect: destino(prev.codigo_descuento), ...info })
    }
  }

  const { count } = await db.from('colab_click').select('id', { count: 'exact', head: true })
    .eq('link_id', link.id).not('codigo_descuento', 'is', null).gte('ts', new Date(Date.now() - 60_000).toISOString())
  if ((count ?? 0) > FRENO_POR_MINUTO) {
    return json({ ok: false, error: 'freno', redirect: TIENDA + productoPath, ...info })
  }

  try {
    const code = await crearCodigo(db, link.modelo, pct)
    await anotar(code)
    return json({ ok: true, code, redirect: destino(code), ...info })
  } catch (e) {
    if (legacy) await db.from('colab_click').insert({ link_id: link.id, codigo_descuento: null, visitante })
    return json({ ok: false, error: 'sin_descuento', detalle: String((e as Error)?.message ?? e), redirect: TIENDA + productoPath, ...info })
  }
})
