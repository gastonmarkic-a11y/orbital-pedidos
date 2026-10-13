// Edge Function: colab-catalogo-sync
// Copia el catálogo PÚBLICO de la tienda (www.orbitaleyewear.com.ar/products.json) a
// colab_producto. En la tienda cada producto es un color; `disponible` = alguna variante
// publicada con stock. Es lo único que ven los influencers (solo lo disponible).
// Solo anteojos: productos con tag SOL o RECETA (deja afuera servicios como Cuidado ORBITAL).
// Además marca colab_producto.colecciones con lo publicado en /collections/<c> de cada
// promotor de colección (corre cada hora por cron).
//
// Auth (verify_jwt=false): header x-cron-key == app_config.cron_key, o body.clave de un
// admin de colaboradores activo (botón "Actualizar catálogo" del panel).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const TIENDA = 'https://www.orbitaleyewear.com.ar'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-key',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body, null, 2), { status, headers: { 'Content-Type': 'application/json', ...cors } })
}

function texto(html: string | null | undefined): string | null {
  if (!html) return null
  const t = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|li|h\d|div)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim()
  return t || null
}

type Variante = { id: number; title: string; sku: string | null; price: string; compare_at_price: string | null; available: boolean }
type Producto = {
  id: number; title: string; handle: string; product_type: string; tags: string[] | string
  body_html: string | null; images: { src: string }[]; variants: Variante[]
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

  // La tienda corta con 429 si la consultan seguido (otras funciones también leen products.json):
  // se reintenta respetando Retry-After, si no 3s, 6s, 12s, 20s.
  async function traer(url: string): Promise<Response> {
    let r = await fetch(url)
    for (const espera of [3, 6, 12, 20]) {
      if (r.status !== 429 && r.status < 500) break
      const ra = Number(r.headers.get('retry-after'))
      await new Promise((ok) => setTimeout(ok, (ra > 0 && ra <= 30 ? ra : espera) * 1000))
      r = await fetch(url)
    }
    return r
  }

  const productos: Producto[] = []
  for (let page = 1; page <= 20; page++) {
    const r = await traer(`${TIENDA}/products.json?limit=250&page=${page}`)
    if (!r.ok) return json({ error: 'tienda_error', status: r.status }, 502)
    const ps: Producto[] = (await r.json()).products ?? []
    productos.push(...ps)
    if (ps.length < 250) break
  }

  const ahora = new Date().toISOString()
  const filas = []
  for (const p of productos) {
    const tags = (Array.isArray(p.tags) ? p.tags : String(p.tags ?? '').split(',')).map((t) => t.trim()).filter(Boolean)
    const up = tags.map((t) => t.toUpperCase())
    const tipo = up.includes('SOL') ? 'SOL' : up.includes('RECETA') ? 'RECETA' : null
    if (!tipo) continue
    const vs = p.variants ?? []
    const v = vs.find((x) => x.available) ?? vs[0]
    if (!v) continue
    filas.push({
      product_id: p.id,
      variant_id: v.id ?? null,
      handle: p.handle,
      modelo: String(p.title).replace(/\s+/g, ' ').trim().toUpperCase(),
      color: v.title && v.title !== 'Default Title' ? v.title.replace(/\s+/g, ' ').trim() : null,
      sku: v.sku || null,
      price: Number(v.price) || null,
      compare_at: v.compare_at_price ? Number(v.compare_at_price) || null : null,
      imagen: p.images?.[0]?.src ?? null,
      imagenes: (p.images ?? []).slice(0, 6).map((i) => i.src),
      tipo,
      linea: p.product_type || null,
      tags,
      descripcion: texto(p.body_html),
      disponible: vs.some((x) => x.available),
      updated_at: ahora,
    })
  }

  for (let i = 0; i < filas.length; i += 200) {
    const { error } = await db.from('colab_producto').upsert(filas.slice(i, i + 200), { onConflict: 'product_id' })
    if (error) return json({ error: 'db_error', detalle: error.message }, 500)
  }
  // Lo que ya no está en la tienda deja de estar disponible.
  const ids = filas.map((f) => f.product_id)
  if (ids.length) {
    await db.from('colab_producto').update({ disponible: false, updated_at: ahora })
      .eq('disponible', true).not('product_id', 'in', `(${ids.join(',')})`)
  }

  // Colecciones de promotores (ej. orbital-x-zaira): su panel muestra lo que está en esa
  // página de la tienda. Si la página no responde, queda la marca del sync anterior.
  // Primero por la Admin API (la página pública corta con 429 a los pedidos de Supabase).
  const { data: infs } = await db.from('colab_influencer').select('coleccion').not('coleccion', 'is', null)
  const { data: store } = await db.from('shopify_stores').select('shop_domain, access_token').eq('id', 'linea').maybeSingle()
  const ver = Deno.env.get('SHOPIFY_API_VERSION') ?? '2025-01'
  async function porAdmin(c: string): Promise<string[] | null> {
    if (!store) return null
    const handles: string[] = []
    let cursor: string | null = null
    for (let i = 0; i < 10; i++) {
      const r = await fetch(`https://${store.shop_domain}/admin/api/${ver}/graphql.json`, {
        method: 'POST',
        headers: { 'X-Shopify-Access-Token': store.access_token, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: `query($h:String!,$c:String){collectionByHandle(handle:$h){products(first:250,after:$c){nodes{handle} pageInfo{hasNextPage endCursor}}}}`,
          variables: { h: c, c: cursor },
        }),
      })
      if (!r.ok) return null
      const d = (await r.json()).data?.collectionByHandle?.products
      if (!d) return null
      handles.push(...d.nodes.map((n: { handle: string }) => n.handle))
      if (!d.pageInfo.hasNextPage) break
      cursor = d.pageInfo.endCursor
    }
    return handles
  }
  const colecciones: Record<string, number | string> = {}
  for (const c of new Set((infs ?? []).map((i) => i.coleccion as string))) {
    const admin = await porAdmin(c).catch(() => null)
    const handles: string[] = admin ?? []
    let fallo: string | null = null
    for (let page = 1; page <= 10 && !admin; page++) {
      const r = await traer(`${TIENDA}/collections/${encodeURIComponent(c)}/products.json?limit=250&page=${page}`)
      if (!r.ok) { fallo = `tienda_${r.status}`; break }
      const ps: Producto[] = (await r.json()).products ?? []
      handles.push(...ps.map((p) => p.handle))
      if (ps.length < 250) break
    }
    if (fallo || !handles.length) { colecciones[c] = fallo ?? 'vacia'; continue }
    const { data: n, error } = await db.rpc('colab_set_coleccion', { p_coleccion: c, p_handles: handles })
    colecciones[c] = error ? `db_error: ${error.message}` : (n as number)
  }

  const disp = filas.filter((f) => f.disponible)
  return json({
    colecciones,
    ok: true,
    productos_tienda: productos.length,
    anteojos: filas.length,
    disponibles: disp.length,
    modelos_disponibles: new Set(disp.map((f) => f.modelo)).size,
  })
})
