// Genera los anteojos en 3D (GLB) de los modelos DESTACADOS (stock.es_caliente) a partir de las fotos de la tienda:
// frente = foto de frente recortada del fondo y curvada, patillas = barras del color del armazón.
// Salida: public/ar/3d/<codigo>.glb + public/ar/3d/index.json { MODELO: { codigo: archivo } }
// Lo usan el visor 3D / AR (Visor3D.tsx), el probador 3D (Probador3D.tsx) y los QR de exhibidor.
// Correr cuando cambian los destacados o las fotos: node scripts/ar-3d.mjs
import fs from 'fs'
import sharp from 'sharp'

const SB = 'https://towcgvphxeqilpdnboki.supabase.co'
const KEY = 'sb_publishable_YhNbcs63Zx6na8pfEsQgCw_C3iKSk-A'
const OUT = 'public/ar/3d'
const rpc = async (fn, body) => (await fetch(`${SB}/rest/v1/rpc/${fn}`, { method: 'POST', headers: { apikey: KEY, 'content-type': 'application/json' }, body: JSON.stringify(body) })).json()

// Mismo recorte que Probador.tsx: saca el fondo liso desde los bordes (y la sombra gris suave) y recorta al anteojo
async function recortar(url) {
  const u = url.includes('cdn.shopify.com') ? url + (url.includes('?') ? '&' : '?') + 'width=1200' : url
  const r = await fetch(u); if (!r.ok) return null
  const { data: p, info } = await sharp(Buffer.from(await r.arrayBuffer())).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const W = info.width, H = info.height
  let fr = 0, fg = 0, fb = 0, n = 0
  const sumar = (X, Y) => { const i = (Y * W + X) * 4; fr += p[i]; fg += p[i + 1]; fb += p[i + 2]; n++ }
  for (let X = 0; X < W; X += 4) { sumar(X, 0); sumar(X, H - 1) }
  for (let Y = 0; Y < H; Y += 4) { sumar(0, Y); sumar(W - 1, Y) }
  fr /= n; fg /= n; fb /= n
  const esFondo = (i) => p[i + 3] < 20 || Math.abs(p[i] - fr) + Math.abs(p[i + 1] - fg) + Math.abs(p[i + 2] - fb) < 42
  const suave = (i, j) => {
    const R = p[i], G = p[i + 1], B = p[i + 2]
    return Math.max(R, G, B) - Math.min(R, G, B) < 10 && R + G + B > 450 &&
      Math.abs(R - fr) + Math.abs(G - fg) + Math.abs(B - fb) < 110 &&
      Math.abs(R - p[j]) + Math.abs(G - p[j + 1]) + Math.abs(B - p[j + 2]) < 10
  }
  const visto = new Uint8Array(W * H), pila = []
  for (let X = 0; X < W; X++) pila.push(X, -1, (H - 1) * W + X, -1)
  for (let Y = 0; Y < H; Y++) pila.push(Y * W, -1, Y * W + W - 1, -1)
  while (pila.length) {
    const de = pila.pop(), k = pila.pop()
    if (visto[k]) continue
    if (!esFondo(k * 4) && !(de >= 0 && suave(k * 4, de * 4))) continue
    visto[k] = 1; p[k * 4 + 3] = 0
    const X = k % W, Y = (k / W) | 0
    if (X > 0) pila.push(k - 1, k); if (X < W - 1) pila.push(k + 1, k)
    if (Y > 0) pila.push(k - W, k); if (Y < H - 1) pila.push(k + W, k)
  }
  // Cristal transparente (receta / clear): el fondo encerrado por el aro no se alcanza desde el borde.
  // Las manchas grandes del color del fondo que quedaron adentro = cristal → casi transparente (se ven los ojos).
  const MIN = W * H * 0.004
  for (let s = 0; s < W * H; s++) {
    if (visto[s] || !esFondo(s * 4)) continue
    const zona = [s], cola = [s]; visto[s] = 2
    while (cola.length) {
      const k = cola.pop(), X = k % W, Y = (k / W) | 0
      for (const q of [X > 0 && k - 1, X < W - 1 && k + 1, Y > 0 && k - W, Y < H - 1 && k + W]) {
        if (q === false || visto[q] || !esFondo(q * 4)) continue
        visto[q] = 2; zona.push(q); cola.push(q)
      }
    }
    if (zona.length > MIN) for (const k of zona) p[k * 4 + 3] = 38
  }
  let x0 = W, y0 = H, x1 = 0, y1 = 0
  for (let Y = 0; Y < H; Y++) for (let X = 0; X < W; X++) {
    if (p[(Y * W + X) * 4 + 3] === 0) continue
    if (x0 > X) x0 = X; if (x1 < X) x1 = X; if (y0 > Y) y0 = Y; if (y1 < Y) y1 = Y
  }
  if (x1 <= x0 || y1 <= y0) return null
  const w = x1 - x0 + 1, h = y1 - y0 + 1
  if (w < h * 1.6) return null // no es la foto de frente
  // Color de las patillas = promedio del armazón en las puntas (bisagras), franja externa de cada lado
  let cr = 0, cg = 0, cb = 0, cn = 0
  const banda = Math.max(4, Math.round(w * 0.04))
  for (let Y = y0; Y <= y1; Y++) for (const X0 of [x0, x1 - banda]) for (let X = X0; X < X0 + banda; X++) {
    const i = (Y * W + X) * 4; if (p[i + 3] === 0) continue
    cr += p[i]; cg += p[i + 1]; cb += p[i + 2]; cn++
  }
  // Altura de la bisagra: fila con más pixeles del armazón en la franja externa izquierda
  let mejor = y0, max = -1
  for (let Y = y0; Y <= y1; Y++) { let c = 0; for (let X = x0; X < x0 + banda; X++) if (p[(Y * W + X) * 4 + 3]) c++; if (c > max) { max = c; mejor = Y } }
  const png = await sharp(Buffer.from(p.buffer, p.byteOffset, p.length), { raw: { width: W, height: H, channels: 4 } })
    .extract({ left: x0, top: y0, width: w, height: h }).resize({ width: Math.min(w, 900) })
    .png({ compressionLevel: 9, palette: true, quality: 90 }).toBuffer()
  const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }
  return { png, aspecto: h / w, bisagra: (mejor - y0) / h, color: [lin(cr / cn), lin(cg / cn), lin(cb / cn)] }
}

// ---- GLB a mano (sin three en Node) ----
function glb(f) {
  const ANCHO = 0.142, ALTO = ANCHO * f.aspecto, CURVA = 0.016, LARGO = 0.145
  const pos = [], nor = [], uv = [], idx = []
  // Frente: grilla curvada hacia atrás en las puntas
  const NX = 32
  for (let j = 0; j <= 1; j++) for (let i = 0; i <= NX; i++) {
    const t = i / NX, x = (t - 0.5) * ANCHO, z = -CURVA * (2 * t - 1) ** 2
    pos.push(x, (0.5 - j) * ALTO, z)
    const dz = -CURVA * 2 * (2 * t - 1) * 2 / ANCHO, l = Math.hypot(dz, 1)
    nor.push(dz / l, 0, 1 / l); uv.push(t, j)
  }
  for (let i = 0; i < NX; i++) { const a = i, b = i + 1, c = NX + 1 + i, d = c + 1; idx.push(a, c, b, b, c, d) }
  const nFrente = idx.length
  // Patillas: dos tramos (recto y caída hacia la oreja), sección 4 × 7 mm
  const yB = (0.5 - f.bisagra) * ALTO
  const pat = { pos: [], nor: [], idx: [] }
  const caja = (a, b, gx = 0.002, gy = 0.0035) => {
    const [ax, ay, az] = a, [bx, by, bz] = b
    const dl = Math.hypot(by - ay, bz - az), uy = -(bz - az) / dl, uz = (by - ay) / dl // perpendicular en el plano YZ
    const esq = [[-gx, -gy], [gx, -gy], [gx, gy], [-gx, gy]]
    const v = []
    for (const [cx, cy, cz] of [[ax, ay, az], [bx, by, bz]]) for (const [ex, ey] of esq) v.push([cx + ex, cy + ey * uy, cz + ey * uz])
    const dy = (by - ay) / dl, dz = (bz - az) / dl // dirección de la barra (tapas)
    const caras = [[0, 1, 5, 4, [0, -uy, -uz]], [1, 2, 6, 5, [1, 0, 0]], [2, 3, 7, 6, [0, uy, uz]], [3, 0, 4, 7, [-1, 0, 0]], [3, 2, 1, 0, [0, -dy, -dz]], [4, 5, 6, 7, [0, dy, dz]]]
    for (const [a1, b1, c1, d1, nn] of caras) {
      const base = pat.pos.length / 3
      for (const k of [a1, b1, c1, d1]) { pat.pos.push(...v[k]); pat.nor.push(...nn) }
      pat.idx.push(base, base + 1, base + 2, base, base + 2, base + 3)
    }
  }
  for (const s of [-1, 1]) {
    const x = s * (ANCHO / 2 - 0.003), z0 = -CURVA - 0.002
    const codo = [x, yB, z0 - LARGO * 0.78]
    caja([x, yB, z0], codo)
    caja(codo, [x, yB - 0.022, z0 - LARGO])
  }
  const f32 = (a) => Buffer.from(new Float32Array(a).buffer), u16 = (a) => Buffer.from(new Uint16Array(a).buffer)
  const pad = (b, c = 0) => (b.length % 4 ? Buffer.concat([b, Buffer.alloc(4 - (b.length % 4), c)]) : b)
  const partes = [f32(pos), f32(nor), f32(uv), u16(idx), f32(pat.pos), f32(pat.nor), u16(pat.idx), f.png].map((b) => pad(b))
  const vistas = [], off = []; let o = 0
  for (const b of partes) { off.push(o); o += b.length }
  partes.forEach((b, i) => vistas.push({ buffer: 0, byteOffset: off[i], byteLength: i === 7 ? f.png.length : b.length, ...(i === 3 || i === 6 ? { target: 34963 } : i < 7 ? { target: 34962 } : {}) }))
  const mm = (a) => { const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9]; for (let i = 0; i < a.length; i += 3) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], a[i + k]); mx[k] = Math.max(mx[k], a[i + k]) } return { min: mn, max: mx } }
  const json = {
    asset: { version: '2.0', generator: 'Orbital ar-3d' },
    scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0, name: 'anteojo' }],
    meshes: [{ primitives: [
      { attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 }, indices: 3, material: 0 },
      { attributes: { POSITION: 4, NORMAL: 5 }, indices: 6, material: 1 },
    ] }],
    materials: [
      { name: 'frente', pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0, roughnessFactor: 0.35 }, alphaMode: 'BLEND', doubleSided: true },
      { name: 'patillas', pbrMetallicRoughness: { baseColorFactor: [...f.color, 1], metallicFactor: 0, roughnessFactor: 0.4 } },
    ],
    textures: [{ source: 0, sampler: 0 }], samplers: [{ magFilter: 9729, minFilter: 9987 }],
    images: [{ bufferView: 7, mimeType: 'image/png' }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: pos.length / 3, type: 'VEC3', ...mm(pos) },
      { bufferView: 1, componentType: 5126, count: nor.length / 3, type: 'VEC3' },
      { bufferView: 2, componentType: 5126, count: uv.length / 2, type: 'VEC2' },
      { bufferView: 3, componentType: 5123, count: nFrente, type: 'SCALAR' },
      { bufferView: 4, componentType: 5126, count: pat.pos.length / 3, type: 'VEC3', ...mm(pat.pos) },
      { bufferView: 5, componentType: 5126, count: pat.nor.length / 3, type: 'VEC3' },
      { bufferView: 6, componentType: 5123, count: pat.idx.length, type: 'SCALAR' },
    ],
    bufferViews: vistas, buffers: [{ byteLength: o }],
  }
  const js = pad(Buffer.from(JSON.stringify(json)), 0x20), bin = Buffer.concat(partes)
  const head = Buffer.alloc(12); head.writeUInt32LE(0x46546c67, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(12 + 8 + js.length + 8 + bin.length, 8)
  const ch = (len, tipo) => { const b = Buffer.alloc(8); b.writeUInt32LE(len, 0); b.writeUInt32LE(tipo, 4); return b }
  return Buffer.concat([head, ch(js.length, 0x4e4f534a), js, ch(bin.length, 0x004e4942), bin])
}

const destacados = await (await fetch(`${SB}/rest/v1/rpc/ar_destacados`, { method: 'POST', headers: { apikey: KEY, 'content-type': 'application/json' }, body: '{}' })).json()
fs.mkdirSync(OUT, { recursive: true })
const index = {}
for (const { modelo } of destacados) {
  const d = await rpc('modelo_landing', { p_modelo: modelo, p_sku: null })
  if (!d) { console.log(modelo, 'sin landing'); continue }
  for (const c of d.colores) {
    let f = null
    for (const u of c.fotos) { try { f = await recortar(u) } catch { f = null } if (f) break }
    if (!f) continue
    fs.writeFileSync(`${OUT}/${c.codigo}.glb`, glb(f))
    ;(index[modelo] ??= {})[c.codigo] = `${c.codigo}.glb`
  }
  console.log(modelo, Object.keys(index[modelo] ?? {}).length, '/', d.colores.length)
}
fs.writeFileSync(`${OUT}/index.json`, JSON.stringify({ generado: new Date().toISOString(), modelos: index }))
