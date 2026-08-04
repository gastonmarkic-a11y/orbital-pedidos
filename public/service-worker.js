// KILL-SWITCH del service worker viejo (cache-first, de la época GitHub Pages).
// Ese SW dejaba a algunos dispositivos pegados a una versión antigua de la app.
// Este reemplazo se autodestruye: limpia TODOS los caches, se desregistra y recarga
// las pestañas para que carguen la última versión desde la red. Después de esto, la
// app vuelve a registrar /sw.js (passthrough, sin cache) y no vuelve a quedar pegada.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      try {
        const keys = await caches.keys()
        await Promise.all(keys.map((k) => caches.delete(k)))
      } catch (_e) {
        /* ignore */
      }
      try {
        await self.registration.unregister()
      } catch (_e) {
        /* ignore */
      }
      const clients = await self.clients.matchAll({ type: 'window' })
      for (const client of clients) {
        try {
          client.navigate(client.url)
        } catch (_e) {
          /* ignore */
        }
      }
    })()
  )
})
// Passthrough por las dudas mientras vive: nunca sirve desde cache.
self.addEventListener('fetch', () => {})
