// Genera las tres propuestas "Precio de octubre" (ópticas, distribuidores, revendedores) desde una plantilla.
// Datos: diff de precios (octubre vs Excel nov) + fotos en media/modelos. Uso: node generar.cjs <diff.json>
const fs = require('fs')
const path = require('path')
const crudo = require(path.resolve(process.argv[2]))
const diff = Array.isArray(crudo) ? crudo : (Object.values(crudo).find(Array.isArray) || [])
const imgs = JSON.parse(fs.readFileSync(path.join(__dirname, 'media/modelos-img.json'), 'utf8'))

const CAT = { Premium: 'Destacados', Core: 'Destacados', Sport: 'Sport', 'zaira nara': 'Zaira Nara', Urbano: 'Urbano' }
// Promo Día de la Madre (promo_precio, vence 20/10 00:00): $48.000 óptica. entero=false → solo algunos colores.
const PROMO = { 'ATLANTIC CITY': false, BRERA: false, BROOKLYN: false, CHARLOTTE: true, CRETA: true, 'LOS HAMPTON': false, PALERMO: false, PARIS: false, ROMA: false, SOPHIA: true, VENICE: false, WYNWOOD: false }
// Modelos que no van en la presentación (pedido de Gastón).
const FUERA = ['BUENOS AIRES', 'BUENOS AIRES I']
const ORDEN = ['Destacados', 'Sport', 'Zaira Nara', 'Urbano']
const nombre = (m) => m.replace(/\s*-\s*ZN$/, ' ZN').toLowerCase().replace(/\b([a-z])/g, (c) => c.toUpperCase()).replace(/\bZn\b/, 'ZN').replace(/\bIi?\b/g, (x) => x.toUpperCase())
const modelos = diff
  // Sin foto de producto (o con foto de cara) no entra en la presentación.
  .filter((x) => CAT[x.escala] && (x.stock || 0) > 0 && x.precio_optica_actual_num > 0 && imgs[x.modelo] && !FUERA.includes(x.modelo))
  // Los que bajan en noviembre ya tienen el precio nuevo desde el 13/10: octubre = noviembre.
  .map((x) => ({ n: nombre(x.modelo), c: CAT[x.escala], img: imgs[x.modelo] || null, // Zaira Nara: sus SKU ya están a $53.846 desde el 13/10.
    oct: x.escala === 'zaira nara' ? Math.round(x.precio_optica_nov) : Math.min(x.precio_optica_actual_num, Math.round(x.precio_optica_nov)), nov: Math.round(x.precio_optica_nov),
    ...(x.modelo in PROMO ? { promo: 48000, promoEntero: PROMO[x.modelo] } : {}) }))
  .sort((a, b) => ORDEN.indexOf(a.c) - ORDEN.indexOf(b.c) || b.nov / b.oct - a.nov / a.oct || a.n.localeCompare(b.n))

const AUD = {
  opticas: {
    titulo: 'Precio de octubre Ópticas',
    pill: 'Ópticas · precio de octubre hasta el 31/10',
    h1: 'El 1/11 sube la lista. <em>Comprá hoy a precio de octubre.</em>',
    sub: 'Todo lo que cargues hasta el 31 de octubre se factura con la lista actual. Y se suman tus beneficios por paquete.',
    factor: 1, ref: false,
    nota: 'Precio óptica por unidad, sin IVA, antes de la bonificación por paquete.',
    extras: [
      ['5% a 10%', 'Bonificación por paquete', 'Desde 24 u. 5% · desde 36 u. 7% · desde 100 u. 10%. Va siempre, pagues como pagues.'],
      ['+3%', 'Pagando contado o transferencia', 'Descuento extra sobre el neto ya bonificado.'],
      ['hasta 180 días', 'Pagando con cheques', '30/60/90 · desde 24 u. a 120 · desde 36 u. a 150 · desde 100 u. a 180.'],
      ['Gratis', 'Material de exhibición', 'POP desde 24 u. · exhibidor de vidriera desde 36 · exhibidor de pie desde 60 · gráficas a medida desde 100.'],
    ],
  },
  distribuidores: {
    titulo: 'Precio de octubre Distribuidores',
    pill: 'Distribuidores · precio de octubre hasta el 31/10',
    h1: 'Reponé antes del 1/11. <em>Tu precio de distribuidor, todavía con la lista de octubre.</em>',
    sub: 'Tu precio sube el 1/11 junto con la lista. Cargá ahora y te quedás con el de octubre. Al lado, el precio óptica de referencia para tu reventa.',
    factor: 1 / 1.41, ref: true,
    nota: 'Precio distribuidor por unidad, sin IVA (lista óptica ÷ 1,41): es el precio de tu pedido y tu factura. El precio óptica es solo referencia.',
    extras: [
      ['90 días sin interés', 'Plazo bonificado', 'Cheques a 30/60/90: pagás tu precio de lista, sin recargo.'],
      ['+3%', 'Pagando contado o transferencia', 'Descuento extra sobre tu precio de distribuidor.'],
      ['desde +1,42%', 'Más plazo, con recargo', 'Si necesitás 120, 150 o 180 días, se suma un recargo chico por el costo financiero. Mirá la tabla.'],
    ],
    planes: [
      ['30 / 60 / 90', 0], ['30 / 60 / 90 / 120', 1.42], ['30 / 60 / 90 / 120 / 150', 2.82], ['30 / 60 / 90 / 120 / 150 / 180', 4.22],
      ['0 / 30 / 60 / 90', 0], ['0 / 30 / 60 / 90 / 120', 0.25], ['0 / 30 / 60 / 90 / 120 / 150', 1.58], ['0 / 30 / 60 / 90 / 120 / 150 / 180', 2.93],
    ],
  },
  revendedores: {
    titulo: 'Precio de octubre Revendedores',
    pill: 'Revendedores · precio de octubre hasta el 31/10',
    h1: 'El 1/11 sube la lista. <em>Comprá hoy a precio de octubre.</em>',
    sub: 'Todo lo que cargues hasta el 31 de octubre se factura con la lista óptica actual.',
    factor: 1, ref: false,
    nota: 'Precio óptica por unidad, sin IVA.',
    extras: [
      ['+3%', 'Pagando contado o transferencia', 'Descuento extra sobre el precio de lista.'],
      ['30/60/90', 'Pagando con cheques', 'Tu plazo de revendedor.'],
    ],
  },
}

// Direcciones públicas: la de distribuidores no se adivina (precios de distribuidor).
const PUB = path.join(__dirname, '../../public/oferta')
const SLUG = { opticas: 'opticas', distribuidores: 'distribuidores-7q4m', revendedores: 'revendedores' }
fs.mkdirSync(PUB, { recursive: true })
const plantilla = fs.readFileSync(path.join(__dirname, 'plantilla.html'), 'utf8')
for (const [k, a] of Object.entries(AUD)) {
  const datos = { modelos, aud: { ...a, titulo: undefined } }
  const html = plantilla
    .replace('{{TITULO}}', a.titulo)
    .replace('{{PILL}}', a.pill)
    .replace('{{H1}}', a.h1)
    .replace('{{SUB}}', a.sub)
    .replace('{{DATOS}}', JSON.stringify(datos))
  fs.writeFileSync(path.join(__dirname, `${k}.html`), html)
  // Versión pública en el sitio (ver.orbitaleyewear.com.ar/oferta/...): documento completo, mismas fotos.
  const pub = [
    '<!doctype html>', '<html lang="es">', '<head>', '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">',
    '<meta name="robots" content="noindex">',
    '<style>body{margin:0}img{max-width:100%}[hidden]{display:none!important}</style>',
    html.replace('</style>', '</style>\n</head>\n<body>'),
    '</body>', '</html>', '',
  ].join('\n')
  fs.writeFileSync(path.join(PUB, SLUG[k] + '.html'), pub)
}
console.log('modelos', modelos.length, ORDEN.map((c) => c + ' ' + modelos.filter((m) => m.c === c).length).join(' · '))
