// Manifest del panel de colaboradores, uno por clave: el ícono que instala Orbital,
// un administrador o un promotor abre directo SU panel (con su clave), sin pedirla.
// Lo usa index.html solo en /colab; el resto de la Suite sigue con manifest.webmanifest.
const limpio = (v) => (typeof v === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(v) ? v : '')

// Nombre propio del ícono instalado para algunos paneles (el logo sigue siendo el de Orbital).
// Mismo nombre que pone Colab.tsx en apple-mobile-web-app-title para iPhone.
const NOMBRE_APP = { 'in-p7khtza3tz': 'ZAIRA' }

export default function handler(req, res) {
  const k = limpio(req.query.k)
  const start = '/colab' + (k ? '?k=' + k : '')
  const propio = NOMBRE_APP[k]

  res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.status(200).send(
    JSON.stringify({
      id: start,
      name: propio ?? 'Orbital Colaboradores',
      short_name: propio ?? 'Orbital Colab',
      description: 'Panel de colaboradores Orbital Eyewear — anteojos, links y comisiones',
      start_url: start,
      scope: '/colab',
      display: 'standalone',
      background_color: '#ffffff',
      theme_color: '#0004FF',
      icons: [
        { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      ],
    })
  )
}
