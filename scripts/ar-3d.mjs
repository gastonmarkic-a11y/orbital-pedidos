// Genera los anteojos en 3D (GLB) de los modelos DESTACADOS (stock.es_caliente) a partir de las fotos de la tienda:
// frente = foto de frente recortada del fondo y curvada; patillas = la patilla cercana recortada de la foto LATERAL
// (forma, color y logo reales), a escala del frente. Sin foto lateral: barras finas del color del armazón.
// Salida: public/ar/3d/<codigo>.glb + public/ar/3d/index.json { MODELO: { codigo: archivo } }
// Lo usan el visor 3D / AR (Visor3D.tsx), el probador 3D (Probador3D.tsx) y los QR de exhibidor.
// Correr cuando cambian los destacados o las fotos: node scripts/ar-3d.mjs  (solo un modelo: node scripts/ar-3d.mjs PALERMO)
import fs from 'fs'
import sharp from 'sharp'

const SB = 'https://towcgvphxeqilpdnboki.supabase.co'
const KEY = 'sb_publishable_YhNbcs63Zx6na8pfEsQgCw_C3iKSk-A'
const OUT = 'public/ar/3d'
const rpc = async (fn, body) => (await fetch(`${SB}/rest/v1/rpc/${fn}`, { method: 'POST', headers: { apikey: KEY, 'content-type': 'application/json' }, body: JSON.stringify(body) })).json()
const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }

// Mismo recorte que Probador.tsx: saca el fondo liso desde los bordes (y la sombra gris suave).
// cristal=true: además el fondo encerrado por el aro (cristal claro) queda casi transparente.
async function sinFondo(url, cristal) {
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
  if (cristal) {
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
  }
  let x0 = W, y0 = H, x1 = 0, y1 = 0
  for (let Y = 0; Y < H; Y++) for (let X = 0; X < W; X++) {
    if (p[(Y * W + X) * 4 + 3] === 0) continue
    if (x0 > X) x0 = X; if (x1 < X) x1 = X; if (y0 > Y) y0 = Y; if (y1 < Y) y1 = Y
  }
  if (x1 <= x0 || y1 <= y0) return null
  return { p, W, H, x0, y0, x1, y1 }
}
const png = (p, W, H, box, ancho) => sharp(Buffer.from(p.buffer, p.byteOffset, p.length), { raw: { width: W, height: H, channels: 4 } })
  .extract(box).resize({ width: Math.min(box.width, ancho) }).png({ compressionLevel: 9, palette: true, quality: 90 }).toBuffer()

// Foto de frente → textura del frente + color del armazón en las bisagras
async function frente(url) {
  const f = await sinFondo(url, true); if (!f) return null
  const { p, W, H, x0, y0, x1, y1 } = f
  const w = x1 - x0 + 1, h = y1 - y0 + 1
  if (w < h * 1.6) return null // no es la foto de frente
  let cr = 0, cg = 0, cb = 0, cn = 0
  const banda = Math.max(4, Math.round(w * 0.04))
  for (let Y = y0; Y <= y1; Y++) for (const X0 of [x0, x1 - banda]) for (let X = X0; X < X0 + banda; X++) {
    const i = (Y * W + X) * 4; if (p[i + 3] < 200) continue
    cr += p[i]; cg += p[i + 1]; cb += p[i + 2]; cn++
  }
  let mejor = y0, max = -1
  for (let Y = y0; Y <= y1; Y++) { let c = 0; for (let X = x0; X < x0 + banda; X++) if (p[(Y * W + X) * 4 + 3]) c++; if (c > max) { max = c; mejor = Y } }
  return {
    png: await png(p, W, H, { left: x0, top: y0, width: w, height: h }, 900),
    aspecto: h / w, bisagra: (mejor - y0) / h, color: [lin(cr / cn), lin(cg / cn), lin(cb / cn)],
  }
}

// Foto lateral → la patilla CERCANA (en cada columna, el tramo opaco de más abajo), a partir de donde termina el frente.
// Devuelve la textura y la geometría en unidades de "alto del frente" para ubicarla a escala.
async function lateral(url) {
  const f = await sinFondo(url, false); if (!f) return null
  let { p, W, H, x0, y0, x1, y1 } = f
  const op = (X, Y) => p[(Y * W + X) * 4 + 3] > 0
  const alto = []
  for (let X = x0; X <= x1; X++) { let c = 0; for (let Y = y0; Y <= y1; Y++) if (op(X, Y)) c++; alto.push(c) }
  const maxA = Math.max(...alto)
  const altas = alto.map((a, i) => (a > maxA * 0.6 ? i : -1)).filter((i) => i >= 0)
  if (!altas.length) return null
  // El frente es la zona alta: tiene que estar en una punta
  const izq = altas[0] < (x1 - x0) * 0.35, der = altas[altas.length - 1] > (x1 - x0) * 0.65
  if (izq === der) return null
  // Filas del frente (para la escala y la altura)
  const colsFrente = izq ? altas.filter((i) => i < (x1 - x0) * 0.35) : altas.filter((i) => i > (x1 - x0) * 0.65)
  let fy0 = H, fy1 = 0
  for (const i of colsFrente) for (let Y = y0; Y <= y1; Y++) if (op(x0 + i, Y)) { if (Y < fy0) fy0 = Y; if (Y > fy1) fy1 = Y }
  const fh = fy1 - fy0 + 1
  const cara = izq ? x0 + colsFrente[0] : x0 + colsFrente[colsFrente.length - 1] // columna del frente del anteojo
  // Máscara: desde donde termina el frente hacia la punta se sigue la patilla cercana:
  // en cada columna, de los tramos opacos, el que más se superpone con el de la columna anterior
  // (al salir del frente arranca por el más bajo). Los restos chicos de sombra no cuentan.
  const out = new Uint8Array(W * H * 4)
  let ty0 = H, ty1 = 0, tx0 = W, tx1 = 0
  const paso = izq ? 1 : -1, minTramo = Math.max(3, Math.round(fh * 0.05))
  let prev = null
  const desde = izq ? x0 + colsFrente[colsFrente.length - 1] + 1 : x0 + colsFrente[0] - 1 // la patilla, sin el frente
  for (let X = desde; izq ? X <= x1 : X >= x0; X += paso) {
    const tramos = []
    for (let Y = y0; Y <= y1; Y++) {
      if (!op(X, Y)) continue
      const a = Y; while (Y <= y1 && op(X, Y)) Y++
      if (Y - a >= minTramo) tramos.push([a, Y - 1])
    }
    if (!tramos.length) { if (prev) break; continue }
    let t = tramos[tramos.length - 1]
    if (prev) {
      let mejor = -1
      for (const q of tramos) { const ov = Math.min(q[1], prev[1]) - Math.max(q[0], prev[0]); if (ov > mejor) { mejor = ov; t = q } }
      if (mejor <= 0) break // se cortó la patilla
    }
    prev = t
    for (let yy = t[0]; yy <= t[1]; yy++) { const i = (yy * W + X) * 4; out.set(p.subarray(i, i + 4), i) }
    if (t[0] < ty0) ty0 = t[0]; if (t[1] > ty1) ty1 = t[1]; if (X < tx0) tx0 = X; if (X > tx1) tx1 = X
  }
  if (tx1 <= tx0 || ty1 <= ty0) return null
  const tw = tx1 - tx0 + 1, th = ty1 - ty0 + 1
  if (tw < fh * 1.5) return null // no parece una patilla
  let img = sharp(Buffer.from(out.buffer), { raw: { width: W, height: H, channels: 4 } }).extract({ left: tx0, top: ty0, width: tw, height: th })
  if (!izq) img = img.flop() // siempre frente a la izquierda
  const buf = await img.resize({ width: Math.min(tw, 1000) }).png({ compressionLevel: 9, palette: true, quality: 90 }).toBuffer()
  // En unidades del alto del frente: inicio (distancia desde la cara del frente), largo, alto y techo respecto del frente
  const inicio = (izq ? tx0 - cara : cara - tx1) / fh
  return { png: buf, inicio, largo: tw / fh, alto: th / fh, techo: (ty0 - fy0) / fh }
}

// ---- GLB a mano (sin three en Node) ----
function glb(f, lat) {
  const ANCHO = 0.142, ALTO = ANCHO * f.aspecto, CURVA = 0.016
  const prims = [] // { pos, nor, uv?, idx, material }
  // Frente: grilla curvada hacia atrás en las puntas
  {
    const pos = [], nor = [], uv = [], idx = [], NX = 32
    for (let j = 0; j <= 1; j++) for (let i = 0; i <= NX; i++) {
      const t = i / NX, x = (t - 0.5) * ANCHO, z = -CURVA * (2 * t - 1) ** 2
      pos.push(x, (0.5 - j) * ALTO, z)
      const dz = -CURVA * 2 * (2 * t - 1) * 2 / ANCHO, l = Math.hypot(dz, 1)
      nor.push(dz / l, 0, 1 / l); uv.push(t, j)
    }
    for (let i = 0; i < NX; i++) { const a = i, b = i + 1, c = NX + 1 + i, d = c + 1; idx.push(a, c, b, b, c, d) }
    prims.push({ pos, nor, uv, idx, material: 0 })
  }
  // Escala real del frente en la foto lateral: si da un largo absurdo, se normaliza a 14,5 cm
  let s = ALTO
  if (lat && (lat.largo * s < 0.11 || lat.largo * s > 0.175)) s = 0.145 / lat.largo
  if (lat) {
    // Patilla con la foto: plano vertical en cada costado, abierto apenas hacia afuera
    const pos = [], nor = [], uv = [], idx = [], N = 8
    for (const lado of [-1, 1]) {
      const base = pos.length / 3
      for (let i = 0; i <= N; i++) for (let j = 0; j <= 1; j++) {
        const t = i / N
        const z = -CURVA * 0.9 - lat.largo * t * s
        const x = lado * (ANCHO / 2 - 0.004 + 0.006 * t)
        const y = ALTO / 2 - (lat.techo + lat.alto * j) * s
        pos.push(x, y, z); nor.push(lado, 0, 0); uv.push(t, j)
      }
      for (let i = 0; i < N; i++) { const a = base + i * 2, b = a + 1, c = a + 2, d = a + 3; idx.push(a, b, c, c, b, d) }
    }
    prims.push({ pos, nor, uv, idx, material: 2 })
  } else {
    // Sin foto lateral: barras finas (3 × 5 mm) del color del armazón, recta + caída a la oreja
    const pos = [], nor = [], idx = []
    const yB = (0.5 - f.bisagra) * ALTO, L = 0.145
    const caja = (a, b, gx = 0.0015, gy = 0.0025) => {
      const [ax, ay, az] = a, [bx, by, bz] = b
      const dl = Math.hypot(by - ay, bz - az), uy = -(bz - az) / dl, uz = (by - ay) / dl
      const esq = [[-gx, -gy], [gx, -gy], [gx, gy], [-gx, gy]], v = []
      for (const [cx, cy, cz] of [[ax, ay, az], [bx, by, bz]]) for (const [ex, ey] of esq) v.push([cx + ex, cy + ey * uy, cz + ey * uz])
      const dy = (by - ay) / dl, dz = (bz - az) / dl
      for (const [a1, b1, c1, d1, nn] of [[0, 1, 5, 4, [0, -uy, -uz]], [1, 2, 6, 5, [1, 0, 0]], [2, 3, 7, 6, [0, uy, uz]], [3, 0, 4, 7, [-1, 0, 0]], [3, 2, 1, 0, [0, -dy, -dz]], [4, 5, 6, 7, [0, dy, dz]]]) {
        const base = pos.length / 3
        for (const k of [a1, b1, c1, d1]) { pos.push(...v[k]); nor.push(...nn) }
        idx.push(base, base + 1, base + 2, base, base + 2, base + 3)
      }
    }
    for (const lado of [-1, 1]) {
      const x = lado * (ANCHO / 2 - 0.003), z0 = -CURVA - 0.002, codo = [x, yB, z0 - L * 0.78]
      caja([x, yB, z0], codo); caja(codo, [x, yB - 0.022, z0 - L])
    }
    prims.push({ pos, nor, idx, material: 1 })
  }

  const f32 = (a) => Buffer.from(new Float32Array(a).buffer), u16 = (a) => Buffer.from(new Uint16Array(a).buffer)
  const pad = (b, c = 0) => (b.length % 4 ? Buffer.concat([b, Buffer.alloc(4 - (b.length % 4), c)]) : b)
  const mm = (a) => { const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9]; for (let i = 0; i < a.length; i += 3) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], a[i + k]); mx[k] = Math.max(mx[k], a[i + k]) } return { min: mn, max: mx } }
  const partes = [], vistas = [], accessors = []
  let o = 0
  const vista = (buf, target) => { const b = pad(buf); vistas.push({ buffer: 0, byteOffset: o, byteLength: buf.length, ...(target ? { target } : {}) }); partes.push(b); o += b.length; return vistas.length - 1 }
  const acc = (a) => { accessors.push(a); return accessors.length - 1 }
  const primitives = prims.map((q) => {
    const attributes = {
      POSITION: acc({ bufferView: vista(f32(q.pos), 34962), componentType: 5126, count: q.pos.length / 3, type: 'VEC3', ...mm(q.pos) }),
      NORMAL: acc({ bufferView: vista(f32(q.nor), 34962), componentType: 5126, count: q.nor.length / 3, type: 'VEC3' }),
    }
    if (q.uv) attributes.TEXCOORD_0 = acc({ bufferView: vista(f32(q.uv), 34962), componentType: 5126, count: q.uv.length / 2, type: 'VEC2' })
    const indices = acc({ bufferView: vista(u16(q.idx), 34963), componentType: 5123, count: q.idx.length, type: 'SCALAR' })
    return { attributes, indices, material: q.material }
  })
  const images = [{ bufferView: vista(f.png), mimeType: 'image/png' }]
  if (lat) images.push({ bufferView: vista(lat.png), mimeType: 'image/png' })
  const json = {
    asset: { version: '2.0', generator: 'Orbital ar-3d' },
    scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0, name: 'anteojo' }],
    meshes: [{ primitives }],
    materials: [
      { name: 'frente', pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0, roughnessFactor: 0.35 }, alphaMode: 'BLEND', doubleSided: true },
      { name: 'patillas', pbrMetallicRoughness: { baseColorFactor: [...f.color, 1], metallicFactor: 0, roughnessFactor: 0.4 } },
      { name: 'patilla-foto', pbrMetallicRoughness: { baseColorTexture: { index: lat ? 1 : 0 }, metallicFactor: 0, roughnessFactor: 0.4 }, alphaMode: 'MASK', alphaCutoff: 0.5, doubleSided: true },
    ],
    textures: images.map((_, i) => ({ source: i, sampler: 0 })), samplers: [{ magFilter: 9729, minFilter: 9987 }],
    images, accessors, bufferViews: vistas, buffers: [{ byteLength: o }],
  }
  const js = pad(Buffer.from(JSON.stringify(json)), 0x20), bin = Buffer.concat(partes)
  const head = Buffer.alloc(12); head.writeUInt32LE(0x46546c67, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(12 + 8 + js.length + 8 + bin.length, 8)
  const ch = (len, tipo) => { const b = Buffer.alloc(8); b.writeUInt32LE(len, 0); b.writeUInt32LE(tipo, 4); return b }
  return Buffer.concat([head, ch(js.length, 0x4e4f534a), js, ch(bin.length, 0x004e4942), bin])
}

const solo = process.argv[2]
const destacados = await rpc('ar_destacados', {})
fs.mkdirSync(OUT, { recursive: true })
const previo = fs.existsSync(`${OUT}/index.json`) ? JSON.parse(fs.readFileSync(`${OUT}/index.json`, 'utf8')).modelos : {}
const index = solo ? previo : {}
for (const { modelo } of destacados) {
  if (solo && modelo !== solo) continue
  const d = await rpc('modelo_landing', { p_modelo: modelo, p_sku: null })
  if (!d) { console.log(modelo, 'sin landing'); continue }
  index[modelo] = {}
  let conLateral = 0
  for (const c of d.colores) {
    let f = null
    for (const u of c.fotos) { try { f = await frente(u) } catch { f = null } if (f) break }
    if (!f) continue
    let lat = null
    const u = c.fotos.find((x) => /lateral/i.test(x))
    if (u) { try { lat = await lateral(u) } catch { lat = null } }
    if (lat) conLateral++
    fs.writeFileSync(`${OUT}/${c.codigo}.glb`, glb(f, lat))
    index[modelo][c.codigo] = `${c.codigo}.glb`
  }
  console.log(modelo, Object.keys(index[modelo]).length, '/', d.colores.length, '· patilla con foto:', conLateral)
}
fs.writeFileSync(`${OUT}/index.json`, JSON.stringify({ generado: new Date().toISOString(), modelos: index }))
