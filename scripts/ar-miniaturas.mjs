// Genera las miniaturas que usa el bot de promotores (colab-telegram) para reconocer un anteojo por foto:
// hasta 2 fotos por modelo, 320×320 JPG sobre fondo blanco + index.json { modelo: [archivos] }.
// Se suben al storage público: catalogo/ar-ref/. Correr cuando cambian las fotos del catálogo:
//   node scripts/ar-miniaturas.mjs
//   npx.cmd supabase storage cp -r --experimental tmp/ar-ref ss:///catalogo --project-ref towcgvphxeqilpdnboki
// (necesita ffmpeg en el PATH)
import fs from 'fs'
import path from 'path'
import { execFileSync } from 'child_process'

const SB = 'https://towcgvphxeqilpdnboki.supabase.co'
const KEY = 'sb_publishable_YhNbcs63Zx6na8pfEsQgCw_C3iKSk-A'
const OUT = 'tmp/ar-ref'
const POR_MODELO = 2

const r = await fetch(`${SB}/rest/v1/rpc/ar_imagenes`, { method: 'POST', headers: { apikey: KEY, 'content-type': 'application/json' }, body: '{}' })
const imgs = await r.json()

const porModelo = new Map()
for (const x of imgs) {
  if (x.lifestyle || !x.url) continue
  const l = porModelo.get(x.modelo) ?? []
  if (l.length < POR_MODELO) l.push(x.url)
  porModelo.set(x.modelo, l)
}

fs.rmSync(OUT, { recursive: true, force: true })
fs.mkdirSync(OUT, { recursive: true })
const slug = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

const index = {}
for (const [modelo, urls] of porModelo) {
  for (const [i, url] of urls.entries()) {
    try {
      const b = await fetch(url.includes('cdn.shopify.com') ? url + (url.includes('?') ? '&' : '?') + 'width=640' : url)
      if (!b.ok) continue
      const tmp = path.join(OUT, '_in')
      fs.writeFileSync(tmp, Buffer.from(await b.arrayBuffer()))
      const nombre = `${slug(modelo)}-${i + 1}.jpg`
      execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', tmp, '-filter_complex',
        'color=white:s=320x320[bg];[0:v]scale=320:320:force_original_aspect_ratio=decrease[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2:shortest=1',
        '-frames:v', '1', '-q:v', '4', path.join(OUT, nombre)])
      ;(index[modelo] ??= []).push(nombre)
    } catch (e) { console.error(modelo, url, String(e).slice(0, 120)) }
  }
}
fs.rmSync(path.join(OUT, '_in'), { force: true })
fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify(index))
console.log('modelos', Object.keys(index).length, 'fotos', Object.values(index).flat().length)
