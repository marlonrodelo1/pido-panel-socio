// Service worker para Panel Socio — Web Push API nativo (sin Firebase)

self.addEventListener('install', (event) => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('push', (event) => {
  let data = { title: 'Pidoo Socios', body: 'Tienes una notificación' }
  try {
    data = event.data.json()
  } catch (e) {
    try { data.body = event.data?.text() || data.body } catch (_) {}
  }
  const title = data.title || 'Pidoo Socios'
  const options = {
    body: data.body || '',
    icon: '/favicon.svg',
    badge: '/favicon.svg',
    vibrate: [200, 80, 200],
    data: { url: data.url || '/', ...(data.data || {}) },
    requireInteraction: true,
    tag: data.tag || ('socio-' + Date.now()),
  }
  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = (event.notification.data && event.notification.data.url) || '/'
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ('focus' in c) {
          c.postMessage({ type: 'navigate', target })
          return c.focus()
        }
      }
      return clients.openWindow(target)
    })
  )
})
