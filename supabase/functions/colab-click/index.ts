// Edge Function: colab-click  (pública, verify_jwt=false)
// La llama la página ver.orbitaleyewear.com.ar/r/<codigo> cuando alguien toca el link
// que un influencer pegó en su historia o publicación:
//   1) valida el link (y que el influencer y su admin estén activos)
//   2) consigue la regla de descuento del modelo en Shopify (1 price rule por modelo + %)
//   3) crea un código ÚNICO de un solo uso para este visitante (ORB + 6)
//   4) registra el click y devuelve la URL /discount/<code>?redirect=/products/<handle>
// El pedido que use ese código se atribuye al link (lo hace colab-ventas-sync).
// Si el mismo navegador vuelve a tocar el mismo link, reusa su código.
// Si Shopify falla (p.ej. falta el permiso write_discounts) lo manda igual al anteojo, sin descuento.
// Se genera desde el navegador (JS), así los bots que solo leen la vista previa no gastan códigos.

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

const TIENDA = 'https://www.orbitaleyewear.com.ar'
const ALFA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const FRENO_POR_MINUTO = 60

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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const body = await req.json().catch(() => ({})) as { codigo?: string; visitante?: string }
  const codigo = String(body.codigo ?? '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12)
  const visitante = String(body.visitante ?? '').replace(/[^a-zA-Z0-9-]/g, '').slice(0, 40) || null
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

  // Destino: el color del link si sigue disponible; si no, otro color disponible del mismo modelo.
  const cols = 'handle, modelo, color, imagen, price, compare_at, disponible'
  const { data: prod } = await db.from('colab_producto').select(cols).eq('handle', link.handle).limit(1).maybeSingle()
  let destino = prod
  if (!prod?.disponible) {
    const { data: alt } = await db.from('colab_producto').select(cols).eq('modelo', link.modelo).eq('disponible', true).limit(1).maybeSingle()
    if (alt) destino = alt
  }
  const handle = destino?.handle ?? link.handle
  const utm = new URLSearchParams({ utm_source: 'colab', utm_medium: link.red, utm_campaign: `colab_${inf.ref}`, utm_content: link.codigo })
  const productoPath = `/products/${handle}?${utm}`
  const pct = Number(inf.pct_descuento) || 30
  const info = {
    modelo: link.modelo, color: destino?.color ?? null, imagen: destino?.imagen ?? null,
    price: destino?.price ?? null, compare_at: destino?.compare_at ?? null, pct, influencer: inf.nombre,
  }
  const conDescuento = (code: string) => `${TIENDA}/discount/${encodeURIComponent(code)}?redirect=${encodeURIComponent(productoPath)}`
  const registrar = (code: string | null) => db.from('colab_click').insert({ link_id: link.id, codigo_descuento: code, visitante })

  if (visitante) {
    const { data: prev } = await db.from('colab_click').select('codigo_descuento')
      .eq('link_id', link.id).eq('visitante', visitante).not('codigo_descuento', 'is', null)
      .order('ts', { ascending: false }).limit(1).maybeSingle()
    if (prev?.codigo_descuento) {
      return json({ ok: true, reuso: true, code: prev.codigo_descuento, redirect: conDescuento(prev.codigo_descuento), ...info })
    }
  }

  const { count } = await db.from('colab_click').select('id', { count: 'exact', head: true })
    .eq('link_id', link.id).gte('ts', new Date(Date.now() - 60_000).toISOString())
  if ((count ?? 0) > FRENO_POR_MINUTO) {
    await registrar(null)
    return json({ ok: false, error: 'freno', redirect: TIENDA + productoPath, ...info })
  }

  try {
    const code = await crearCodigo(db, link.modelo, pct)
    await registrar(code)
    return json({ ok: true, code, redirect: conDescuento(code), ...info })
  } catch (e) {
    await registrar(null)
    return json({ ok: false, error: 'sin_descuento', detalle: String((e as Error)?.message ?? e), redirect: TIENDA + productoPath, ...info })
  }
})
