// Genera public/ar/embeddings.json: la "huella" (DINOv2) de cada foto del catálogo para reconocer
// el modelo con la cámara (/reconocer). Correr cuando cambian las fotos: node scripts/ar-embeddings.mjs
// El preprocesado (fondo blanco + gris + cuadrado) tiene que ser IGUAL al de src/modules/landings/Reconocer.tsx.
import fs from 'fs'
import { AutoProcessor, AutoModel, RawImage } from '@huggingface/transformers'

const SB = 'https://towcgvphxeqilpdnboki.supabase.co'
const KEY = 'sb_publishable_YhNbcs63Zx6na8pfEsQgCw_C3iKSk-A'
export const AR_MODEL = 'Xenova/dinov2-small'

const r = await fetch(`${SB}/rest/v1/rpc/ar_imagenes`, { method: 'POST', headers: { apikey: KEY, 'content-type': 'application/json' }, body: '{}' })
const imgs = await r.json()
console.log('fotos', imgs.length)

const proc = await AutoProcessor.from_pretrained(AR_MODEL)
proc.image_processor.do_center_crop = false
proc.image_processor.size = { height: 224, width: 224 }
const model = await AutoModel.from_pretrained(AR_MODEL, { dtype: 'q8' })

// RGBA → fondo blanco, escala de grises, centrado en un cuadrado blanco
function prep(im) {
  const w = im.width, h = im.height, S = Math.max(w, h)
  const src = im.channels === 4 ? im : im.rgba()
  const o = new Uint8ClampedArray(S * S * 3).fill(255)
  const ox = (S - w) >> 1, oy = (S - h) >> 1, d = src.data
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4, a = d[i + 3] / 255
    const g = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) * a + 255 * (1 - a)
    const j = ((y + oy) * S + x + ox) * 3
    o[j] = o[j + 1] = o[j + 2] = g
  }
  return new RawImage(o, S, S, 3)
}

const items = [], vecs = []
for (let i = 0; i < imgs.length; i += 8) {
  const part = imgs.slice(i, i + 8)
  const raws = await Promise.all(part.map(async (x) => {
    try { const b = await fetch(x.url); if (!b.ok) return null; return await RawImage.fromBlob(await b.blob()) } catch { return null }
  }))
  for (let k = 0; k < part.length; k++) {
    if (!raws[k]) continue
    try {
      const out = await model(await proc(prep(raws[k])))
      const dim = out.last_hidden_state.dims[2]
      const v = Array.from(out.last_hidden_state.data.slice(0, dim)); const n = Math.hypot(...v)
      vecs.push(v.map((a) => a / n))
      items.push({ m: part[k].modelo, u: part[k].url, l: part[k].lifestyle ? 1 : 0 })
    } catch { }
  }
  process.stdout.write(`\r${Math.min(i + 8, imgs.length)}/${imgs.length}`)
}
const dim = vecs[0].length
const esc = 127 / Math.max(...vecs.map((v) => Math.max(...v.map(Math.abs))))
const buf = Buffer.alloc(vecs.length * dim)
vecs.forEach((v, i) => v.forEach((a, j) => buf.writeInt8(Math.round(a * esc), i * dim + j)))
fs.writeFileSync('public/ar/embeddings.json', JSON.stringify({ model: AR_MODEL, dim, generado: new Date().toISOString(), items, data: buf.toString('base64') }))
console.log('\nlisto', items.length, 'fotos,', new Set(items.map((x) => x.m)).size, 'modelos')
