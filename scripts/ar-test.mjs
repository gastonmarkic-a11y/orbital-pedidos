// Prueba del reconocimiento de punta a punta usando las fotos lifestyle como si fueran la cámara.
// node scripts/ar-test.mjs [cantidad]      (K=6 candidatos, GUARDAR=1 deja collage-test.jpg)
import fs from 'fs'
import sharp from 'sharp'
import { AutoProcessor, AutoModel, RawImage } from '@huggingface/transformers'

const SB = 'https://towcgvphxeqilpdnboki.supabase.co'
const E = JSON.parse(fs.readFileSync('public/ar/embeddings.json', 'utf8'))
const Q = new Int8Array(Buffer.from(E.data, 'base64'))
const proc = await AutoProcessor.from_pretrained(E.model)
proc.image_processor.do_center_crop = false
proc.image_processor.size = { height: 224, width: 224 }
const model = await AutoModel.from_pretrained(E.model, { dtype: 'q8' })
function prep(im) {
  const w = im.width, h = im.height, S = Math.max(w, h), src = im.channels === 4 ? im : im.rgba()
  const o = new Uint8ClampedArray(S * S * 3).fill(255), ox = (S - w) >> 1, oy = (S - h) >> 1, d = src.data
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4, a = d[i + 3] / 255
    const g = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) * a + 255 * (1 - a), j = ((y + oy) * S + x + ox) * 3
    o[j] = o[j + 1] = o[j + 2] = g
  }
  return new RawImage(o, S, S, 3)
}

// Collage igual al del navegador: cámara 600x600 a la izquierda, hasta 6 referencias 300x200 numeradas a la derecha
async function collage(camBuf, refUrls) {
  const tiles = [{ input: await sharp(camBuf).flatten({ background: '#fff' }).resize(600, 600, { fit: 'contain', background: '#fff' }).toBuffer(), left: 0, top: 0 }]
  let svg = '<svg width="1200" height="600" xmlns="http://www.w3.org/2000/svg"><rect x="0" y="0" width="150" height="44" fill="#000"/>' +
    '<text x="10" y="32" font-size="28" font-family="Arial" font-weight="bold" fill="#fff">CÁMARA</text><line x1="600" y1="0" x2="600" y2="600" stroke="#000" stroke-width="4"/>'
  for (let k = 0; k < refUrls.length; k++) {
    const x = 602 + (k % 2) * 300, y = 2 + Math.floor(k / 2) * 200
    const rb = Buffer.from(await (await fetch(refUrls[k])).arrayBuffer())
    tiles.push({ input: await sharp(rb).flatten({ background: '#fff' }).resize(296, 196, { fit: 'contain', background: '#fff' }).toBuffer(), left: x, top: y })
    svg += `<rect x="${x}" y="${y}" width="298" height="198" fill="none" stroke="#999"/><rect x="${x}" y="${y}" width="44" height="44" fill="#d00"/>` +
      `<text x="${x + 12}" y="${y + 34}" font-size="32" font-family="Arial" font-weight="bold" fill="#fff">${k + 1}</text>`
  }
  tiles.push({ input: Buffer.from(svg + '</svg>'), left: 0, top: 0 })
  return sharp({ create: { width: 1200, height: 600, channels: 3, background: '#fff' } }).composite(tiles).jpeg({ quality: 82 }).toBuffer()
}

const N = Number(process.argv[2] || 15), K = Number(process.env.K || 6)
const life = E.items.filter((x) => x.l).slice(0, N)
let ok = 0, enTop = 0, n = 0
for (const q of life) {
  const buf = Buffer.from(await (await fetch(q.u)).arrayBuffer())
  const out = await model(await proc(prep(await RawImage.fromBlob(new Blob([buf])))))
  const v = Array.from(out.last_hidden_state.data.slice(0, E.dim))
  const best = {}, bestU = {}
  E.items.forEach((it, k) => {
    if (it.l) return
    let s = 0; for (let j = 0; j < E.dim; j++) s += Q[k * E.dim + j] * v[j]
    if (!(it.m in best) || s > best[it.m]) { best[it.m] = s; bestU[it.m] = it.u }
  })
  const rank = Object.keys(best).sort((a, b) => best[b] - best[a]).slice(0, K)
  n++
  if (!rank.includes(q.m)) { console.log('fuera del top', q.m); continue }
  enTop++
  const img = await collage(buf, rank.map((m) => bestU[m]))
  if (process.env.GUARDAR) fs.writeFileSync('collage-test.jpg', img)
  const t = Date.now()
  let res
  try {
    const r = await fetch(`${SB}/functions/v1/reconocer-anteojo`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ collage: img.toString('base64'), modelos: rank }) })
    res = await r.json()
  } catch { res = { error: 'red' } }
  if (res.modelo === q.m) ok++
  console.log(q.m.padEnd(22), '→', String(res.modelo ?? res.error ?? 'null').padEnd(22), res.modelo === q.m ? 'OK' : '--', Date.now() - t, 'ms')
}
console.log(`acierto ${ok}/${n}  (en top${K}: ${enTop})`)
