// ── Lectura de las liquidaciones que mandan los clientes de consigna ─────────
// Cada cliente manda su propio formato; se reconocen solos:
//   · Prieto: "ORBITAL/MODELO/CODIGO" en la descripción + cantidad + precio + total.
//   · Expovision (Tecnióptica): una hoja por mes, MODELO/COLOR/VENTA/PRECIO UNITARIO/DESC/PRECIO TOTAL/CODIGO
//     (código propio ORS…), secciones ORBITAL SOL / LIQUIDETA (discontinuos → saldo) / RECETA / BE RABBIT
//     (otra marca: se liquida pero no mueve stock Orbital) y al pie SUBTOTAL/IVA/TOTAL/Publicidad/PAGO.
//   · Genérico: sucursal/local, código, modelo, color, cantidad, saldo.
// Las cantidades negativas son devoluciones del cliente final.

export type LineaLeida = {
  fila: number
  sucTexto: string
  codigoOrbital: string | null   // si el archivo trae el SKU de Orbital
  codigoCliente: string          // código propio del cliente (ORS…, 736…)
  modelo: string
  color: string
  texto: string
  cantidad: number
  saldo: boolean
  otraMarca: boolean
  seccion: string
  precioCliente: number | null
  importeCliente: number | null
}

export type DetalleCliente = {
  subtotal?: number
  iva?: number
  total?: number
  publicidad?: number
  pago?: number
  comision?: number
}

export type HojaLeida = { lineas: LineaLeida[]; detalle: DetalleCliente; desde: string | null; hasta: string | null; error?: string }

export const norm = (s: unknown) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

// SKU Orbital: 15 caracteres, empieza con 5 dígitos (002050A48900100, 00205096390010P, 000051958902199)
const RE_SKU = /\b(\d{5}[0-9A-Z]{10})\b/
export const skuEn = (s: unknown): string | null => {
  const m = String(s ?? '').toUpperCase().match(RE_SKU)
  return m ? m[1] : null
}

const num = (v: unknown): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  const s = String(v ?? '').trim()
  if (!s) return null
  // 1.234.567,89 · 1,234,567.89 · 1234,5
  let t = s.replace(/[$\s]/g, '')
  if (/,\d{1,2}$/.test(t)) t = t.replace(/\./g, '').replace(',', '.')
  else t = t.replace(/,/g, '')
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

function detectarColumnas(h: string[]) {
  const buscar = (...claves: string[]) => {
    for (const c of claves) { const i = h.findIndex((x) => x === c || x.includes(c)); if (i >= 0) return i }
    return -1
  }
  return {
    sucursal: buscar('sucursal', 'local', 'punto de venta', 'deposito', 'tienda'),
    codigo: buscar('codigo', 'ref prov', 'cod ', 'sku', 'articulo'),
    modelo: buscar('modelo'),
    color: buscar('color', 'descripcion', 'posicion', 'detalle'),
    cantidad: buscar('cantidad', 'cant', 'unidades', 'vendid', 'venta'),
    saldo: buscar('saldo', 'oferta', 'outlet'),
    precio: buscar('precio unitario', 'unitario', 'precio'),
    total: buscar('precio total', 'importe', 'total'),
  }
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
const MESES_EN = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']
const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`

// "MES DE: AGOSTO 2026 (25-07 A 24-08)" · "Período del 01 August 2026 al 31 August 2026"
function periodo(textos: string[]): { desde: string | null; hasta: string | null } {
  for (const t0 of textos) {
    const t = norm(t0)
    let m = t.match(/(\d{1,2}) (\d{1,2}) a (\d{1,2}) (\d{1,2})/)
    const y = t.match(/\b(20\d\d)\b/)
    if (m && y) {
      const [d1, m1, d2, m2] = m.slice(1).map(Number)
      const yh = Number(y[1])
      return { desde: iso(m1 > m2 ? yh - 1 : yh, m1, d1), hasta: iso(yh, m2, d2) }
    }
    m = t.match(/del (\d{1,2}) ([a-z]+) (20\d\d) al (\d{1,2}) ([a-z]+) (20\d\d)/)
    if (m) {
      const mes = (s: string) => Math.max(MESES.indexOf(s), MESES_EN.indexOf(s)) + 1
      if (mes(m[2]) && mes(m[5])) return { desde: iso(+m[3], mes(m[2]), +m[1]), hasta: iso(+m[6], mes(m[5]), +m[4]) }
    }
  }
  return { desde: null, hasta: null }
}

const PIE: [keyof DetalleCliente, RegExp][] = [
  ['subtotal', /^subtotal$/], ['iva', /^iva\b/], ['total', /^total$/], ['publicidad', /^publicidad/], ['pago', /^pago$/], ['comision', /^comision/],
]

export function leerHoja(filas: unknown[][]): HojaLeida {
  const textos = filas.slice(0, 15).flatMap((r) => r.map(String))
  const { desde, hasta } = periodo(textos)

  // encabezado: primera fila con cantidad + (código o modelo o descripción); si la fila siguiente
  // completa el encabezado (PRECIO / UNITARIO en dos renglones) se juntan.
  let hi = -1, col: ReturnType<typeof detectarColumnas> | null = null
  for (let i = 0; i < filas.length && hi < 0; i++) {
    const r = filas[i].map(norm)
    const c = detectarColumnas(r)
    if (c.cantidad >= 0 && (c.codigo >= 0 || c.modelo >= 0 || c.color >= 0)) {
      const sig = filas[i + 1] ?? []
      const sigEsTitulo = sig.some((x) => norm(x)) && !sig.some((x) => typeof x === 'number')
      if (sigEsTitulo) {
        const junto = r.map((x, j) => `${x} ${norm(sig[j])}`.trim())
        col = detectarColumnas(junto)
        hi = i + 1
      } else { col = c; hi = i }
    }
  }
  if (hi < 0 || !col) return { lineas: [], detalle: {}, desde, hasta, error: 'No encontré el encabezado (necesito una columna de cantidad y una de código, modelo o descripción)' }

  const detalle: DetalleCliente = {}
  const lineas: LineaLeida[] = []
  let seccion = ''
  filas.slice(hi + 1).forEach((row, k) => {
    const celdas = row.map(norm)
    // pie: SUBTOTAL / IVA / TOTAL / Publicidad / PAGO
    const pie = PIE.find(([, re]) => celdas.some((c) => re.test(c)))
    if (pie) {
      const nums = row.filter((x) => typeof x === 'number' || (num(x) != null && /\d/.test(String(x)))).map(num).filter((x): x is number => x != null)
      const valor = nums.length ? nums[nums.length - 1] : null
      if (valor == null) return
      // Prieto: TOTAL (sin IVA) · IVA · TOTAL → el primero es el subtotal
      if (pie[0] === 'total' && detalle.total != null && detalle.subtotal == null) detalle.subtotal = detalle.total
      if (pie[0] === 'total' || detalle[pie[0]] == null) detalle[pie[0]] = valor
      return
    }
    const cant = num(row[col!.cantidad])
    const modelo = col!.modelo >= 0 ? String(row[col!.modelo] ?? '').trim() : ''
    const color = col!.color >= 0 ? String(row[col!.color] ?? '').trim() : ''
    const codigoTxt = col!.codigo >= 0 ? String(row[col!.codigo] ?? '').trim() : ''
    // fila de sección: texto sin cantidad
    if (cant == null) {
      const t = [modelo, color, codigoTxt].filter(Boolean).join(' ')
      if (t && !celdas.some((c) => /^\d/.test(c))) seccion = t
      return
    }
    const q = Math.round(cant)
    if (!q) return
    const secN = norm(seccion)
    const otraMarca = /rabbit/.test(secN)
    const saldoCol = col!.saldo >= 0 ? norm(row[col!.saldo]) : ''
    const saldo = /liquid/.test(secN) || ['si', 's', 'x', 'saldo', 'yes', '1', 'true'].includes(saldoCol)
    const codigoOrbital = skuEn(codigoTxt) ?? skuEn(color) ?? skuEn(modelo)
      ?? (/^\d{9,14}$/.test(codigoTxt) ? codigoTxt.padStart(15, '0') : null)   // Ref.Prov sin ceros
    const esSkuOrbital = !!skuEn(codigoTxt) || /^\d{9,14}$/.test(codigoTxt)
    // Prieto: "ORBITAL/BRASILIA/000051958902199" → modelo BRASILIA
    const partes = color.split('/').map((x) => x.trim())
    const mod = modelo || (partes.length >= 3 ? partes[1] : '')
    const col2 = partes.length >= 3 ? '' : color
    const texto = otraMarca ? `BE RABBIT ${mod} ${col2}`.replace(/\s+/g, ' ').trim() : [mod, col2].filter(Boolean).join(' ')
    let precio = col!.precio >= 0 ? num(row[col!.precio]) : null
    let total = col!.total >= 0 && col!.total !== col!.precio ? num(row[col!.total]) : null
    if (precio == null && total == null) {
      // sin títulos de precio: los números que siguen a la cantidad son unitario y total
      const resto = row.slice(col!.cantidad + 1).map(num).filter((x): x is number => x != null)
      precio = resto[0] ?? null
      total = resto[1] ?? null
    }
    lineas.push({
      fila: hi + k + 2, sucTexto: col!.sucursal >= 0 ? String(row[col!.sucursal] ?? '').trim() : '',
      codigoOrbital: codigoOrbital && codigoOrbital.length === 15 ? codigoOrbital : null,
      codigoCliente: codigoTxt && !esSkuOrbital ? codigoTxt : '',
      modelo: mod, color: col2, texto: texto || codigoTxt, cantidad: q, saldo, otraMarca, seccion,
      precioCliente: precio, importeCliente: total ?? (precio != null ? precio * q : null),
    })
  })
  return { lineas, detalle, desde, hasta }
}

// Colores: el cliente abrevia (NGB NGM, HA HAD) y el catálogo a veces no (Negro Brillo / Gris).
// Se comparan como bolsa de tokens con sinónimos; en Orbital el cristal "ngm" es gris.
const FRASES: [RegExp, string][] = [
  [/\bnegro brillo\b/g, 'ngb'], [/\bnegro mate\b/g, 'ngm'], [/\bverde militar\b|\bverde mili\b/g, 've militar'],
  [/\bcon lentillas?\b|\blentillas?\b/g, 'lentilla'],
]
const SINONIMO: Record<string, string[]> = {
  gris: ['ngm'], gr: ['ngm'], grs: ['ngm'], negro: ['ngm'], habano: ['ha'], marron: ['ma'], celeste: ['ce'], cel: ['ce'],
  naranja: ['na'], verde: ['ve'], degrade: ['deg'], degr: ['deg'], had: ['ha', 'deg'], ngd: ['ngm', 'deg'], ved: ['ve', 'deg'],
  polarizado: ['pol'], polari: ['pol'], polar: ['pol'], espejado: ['flash'], espejo: ['flash'], rvo: ['flash'], revo: ['flash'], rev: ['flash'],
  caramelo: ['crmelo'], crmel: ['crmelo'], clear: ['cl'], incoloro: ['inco'], antirreflex: ['ar'], antireflex: ['ar'],
  bordo: ['bo'], rosa: ['rs'], rojo: ['ro'], past: ['pastel'], amarillo: ['am'], blanco: ['bl'], azul: ['az'],
}
const RUIDO = new Set(['mate', 'mat', 'brillo', 'compacto', 'con', 'y', 'a', 'de'])
export const tokens = (s: unknown): string[] =>
  FRASES.reduce((t, [re, r]) => t.replace(re, r), norm(s)).split(' ')
    .flatMap((w) => SINONIMO[w] ?? [w]).filter((w) => w && !RUIDO.has(w))
export const canon = (s: unknown) => tokens(s).join(' ')
const canonModelo = (s: unknown) => norm(s).replace(/\b(presc|pres|prescription|receta)\b/g, 'presc').replace(/\s+/g, ' ').trim()

export type Producto = { codigo: string; modelo: string | null; descripcion: string | null }

// cuántos tokens de más tiene el candidato si contiene todos los del texto (multiconjunto); -1 si no los contiene
function sobrantes(pedido: string[], cand: string[]): number {
  const bolsa = new Map<string, number>()
  for (const t of cand) bolsa.set(t, (bolsa.get(t) ?? 0) + 1)
  for (const t of pedido) { const n = bolsa.get(t) ?? 0; if (!n) return -1; bolsa.set(t, n - 1) }
  return cand.length - pedido.length
}

// Busca el SKU por modelo + color entre los candidatos (primero la consigna del cliente, después el catálogo).
export function matchTexto(modelo: string, color: string, ...listas: Producto[][]): string | null {
  const m = canonModelo(modelo)
  const pal = tokens(color)
  if (!m) return null
  for (const lista of listas) {
    const delModelo = lista.filter((p) => canonModelo(p.modelo) === m)
    if (!delModelo.length) continue
    if (!pal.length) { if (delModelo.length === 1) return delModelo[0].codigo; continue }
    const puntaje = delModelo.map((p) => ({ p, s: sobrantes(pal, tokens(p.descripcion)) })).filter((x) => x.s >= 0)
    if (!puntaje.length) continue
    const min = Math.min(...puntaje.map((x) => x.s))
    const mejores = puntaje.filter((x) => x.s === min)
    if (mejores.length === 1) return mejores[0].p.codigo
    // mismo color repetido con distinto código: si hay uno solo en esta lista con esa descripción exacta, no se adivina
  }
  return null
}
