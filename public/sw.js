// Service worker mínimo: habilita instalar Orbital como app (PWA) en el teléfono.
// NO cachea contenido, así siempre se sirve la última versión desplegada (sin quedar pegado a versiones viejas).
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) =>
  event.waitUntil(
    (async () => {
      // Al activarse, borra cualquier caché de versiones anteriores (por las dudas).
      try {
        const keys = await caches.keys()
        await Promise.all(keys.map((k) => caches.delete(k)))
      } catch (_e) {
        /* ignore */
      }
      await self.clients.claim()
    })()
  )
)
// Passthrough a la red: presencia de un handler de fetch para que el navegador ofrezca "Instalar app".
self.addEventListener('fetch', () => {})
