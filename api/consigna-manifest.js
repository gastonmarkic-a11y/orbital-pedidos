// Manifest de la central de consigna, uno por token: el ícono que instala la central
// (o cada sucursal) abre directo SU pantalla, sin pedir la clave.
// Lo usa index.html solo en /consigna; el resto de la Suite sigue con manifest.webmanifest.
const limpio = (v) => (typeof v === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(v) ? v : '')

export default function handler(req, res) {
  const k = limpio(req.query.k)
  const start = '/consigna' + (k ? '?k=' + k : '')

  res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.status(200).send(
    JSON.stringify({
      id: start,
      name: 'Orbital Consigna',
      short_name: 'Orbital',
      description: 'Stock por sucursal, devoluciones, pedidos y postventa de tu consigna Orbital',
      start_url: start,
      scope: '/consigna',
      display: 'standalone',
      background_color: '#F6F4EF',
      theme_color: '#15151A',
      icons: [
        { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      ],
    })
  )
}
