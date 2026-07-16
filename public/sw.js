// Service worker mínimo: habilita instalar Orbital como app (PWA) en el teléfono.
// NO cachea contenido, así siempre se sirve la última versión desplegada (sin quedar pegado a versiones viejas).
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))
// Passthrough a la red: presencia de un handler de fetch para que el navegador ofrezca "Instalar app".
self.addEventListener('fetch', () => {})
