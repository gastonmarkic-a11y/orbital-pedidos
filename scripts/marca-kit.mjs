// Kit de marca para el catálogo mayorista (botón "Marca"): baja de orbitaleyewear.com.ar los videos,
// las fotos de producto, en cara (mujer / hombre), estuche-packaging y campaña, y deja el índice en
// public/marca/kit.json. La tienda no habilita CORS en products.json, por eso se arma acá y no en el
// navegador; los archivos se siguen sirviendo del CDN de Shopify (ese sí con CORS, se descargan directo).
//
//   node scripts/marca-kit.mjs
import { writeFileSync, mkdirSync } from 'node:fs'

const TIENDA = 'https://www.orbitaleyewear.com.ar'
const abs = (u) => (u.startsWith('//') ? 'https:' + u : u)
const archivo = (u) => u.split('/').pop().split('?')[0]

// 1) Productos (de a 250, hasta que venga vacío). "Servicio" no es anteojo.
const productos = []
for (let page = 1; page < 20; page++) {
  const r = await fetch(`${TIENDA}/products.json?limit=250&page=${page}`)
  const { products } = await r.json()
  if (!products?.length) break
  productos.push(...products.filter((p) => p.product_type !== 'Servicio'))
}

const modelos = new Map()
const enProductos = new Set()
const packaging = { standard: new Map(), zaira: new Map() }
for (const p of productos) {
  const nombre = p.title.trim().toUpperCase()
  const m = modelos.get(nombre) ?? { modelo: nombre, handle: p.handle, producto: [], cara: [], estuche: [], lifestyle: [] }
  for (const img of p.images) {
    const src = abs(img.src), f = archivo(src)
    enProductos.add(f)
    if (/packag|estuche|funda/i.test(f)) {
      m.estuche.push(src)
      ;(/zaira/i.test(f) ? packaging.zaira : packaging.standard).set(f, src)
    } else if (/en_cara/i.test(f)) m.cara.push({ src, quien: /hombre/i.test(f) ? 'hombre' : 'mujer' })
    else if (/chatgpt|editorial|lifestyle|^orbital_\d/i.test(f)) m.lifestyle.push(src)
    else m.producto.push(src)
  }
  modelos.set(nombre, m)
}
const dedup = (a) => [...new Set(a)]
const lista = [...modelos.values()].map((m) => ({
  ...m, producto: dedup(m.producto), estuche: dedup(m.estuche), lifestyle: dedup(m.lifestyle),
  cara: m.cara.filter((c, i, a) => a.findIndex((x) => x.src === c.src) === i),
})).filter((m) => m.producto.length || m.cara.length).sort((a, b) => a.modelo.localeCompare(b.modelo))

// 2) Home: videos del hero y fotos de campaña (lo que no es foto de un producto ni el logo)
const home = await (await fetch(TIENDA + '/')).text()
const videos = dedup([...home.matchAll(/\/\/[^"' ]+\/cdn\/shop\/videos\/[^"' ]+\.mp4[^"' ]*/g)].map((x) => abs(x[0])))
const posters = dedup([...home.matchAll(/\/\/[^"' ]+\/cdn\/shop\/files\/preview_images\/[^"' ?]+/g)].map((x) => abs(x[0])))
const campana = dedup([...home.matchAll(/\/\/www\.orbitaleyewear\.com\.ar\/cdn\/shop\/files\/[^"' ?]+\.(?:jpg|jpeg|png|webp)/gi)].map((x) => abs(x[0])))
  .filter((u) => !enProductos.has(archivo(u)) && !/logo|icon|favicon|preview_images/i.test(u))
const logo = abs(home.match(/\/\/www\.orbitaleyewear\.com\.ar\/cdn\/shop\/files\/logo_ORBITAL[^"' ]+/)?.[0] ?? '')

const kit = {
  actualizado: new Date().toISOString().slice(0, 10),
  logo,
  videos: videos.map((src) => ({ src, poster: posters.find((p) => src.includes(p.split('/').pop().split('.')[0])) ?? null })),
  campana,
  packaging: { standard: [...packaging.standard.values()], zaira: [...packaging.zaira.values()] },
  modelos: lista,
}
mkdirSync('public/marca', { recursive: true })
writeFileSync('public/marca/kit.json', JSON.stringify(kit))
const n = (k) => lista.reduce((a, m) => a + m[k].length, 0)
console.log(`kit.json · ${lista.length} modelos · ${n('producto')} producto · ${n('cara')} en cara · ${n('estuche')} estuche · ${n('lifestyle')} lifestyle · ${campana.length} campaña · ${videos.length} videos`)
