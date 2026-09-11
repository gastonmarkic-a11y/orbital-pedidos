// Manifest del catálogo, uno por token: el ícono que la óptica instala en el teléfono
// o la compu abre directo SU catálogo (con su token), sin pedir clave.
// Lo usa index.html solo en /catalogo; el resto de la Suite sigue con manifest.webmanifest.
//
// `d` es el id de dispositivo del navegador donde se instaló. En iPhone la app instalada
// tiene su propio almacenamiento, así que sin esto el candado la contaría como otro equipo.
const limpio = (v) => (typeof v === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(v) ? v : '')

export default function handler(req, res) {
  const k = limpio(req.query.k)
  const d = limpio(req.query.d)
  const qs = new URLSearchParams()
  if (k) qs.set('k', k)
  if (d) qs.set('d', d)
  const start = '/catalogo' + (qs.toString() ? '?' + qs.toString() : '')

  res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.status(200).send(
    JSON.stringify({
      id: '/catalogo' + (k ? '?k=' + k : ''),
      name: 'Catálogo Orbital',
      short_name: 'Orbital',
      description: 'Catálogo mayorista Orbital Eyewear — pedido online sobre stock real',
      start_url: start,
      scope: '/catalogo',
      display: 'standalone',
      background_color: '#ffffff',
      theme_color: '#0a0a0a',
      icons: [
        { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      ],
    })
  )
}
