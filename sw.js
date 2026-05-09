// Service Worker — Inexorable PWA
// Estrategia: Network-first con fallback a caché para el shell de la app

const CACHE_NAME = 'inexorable-v4';
const SHELL = ['/', '/index.html', '/manifest.json', '/apple-touch-icon.png'];

// ── Instalación: pre-cachear el shell ─────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL))
  );
  self.skipWaiting();
});

// ── Activación: limpiar cachés antiguas ───────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ── Push: mostrar notificación aunque el móvil esté bloqueado ──
self.addEventListener('push', event => {
  let data = { title: 'Inexorable', body: '' };
  try { data = event.data?.json() || data; } catch(e) {}
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body:    data.body,
      icon:    '/apple-touch-icon.png',
      badge:   '/apple-touch-icon.png',
      tag:     data.tag || 'inexorable-notif',
      silent:  false,
      requireInteraction: false,
    })
  );
});

// ── Clic en notificación: abrir/enfocar la app ────────────
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) {
        if (c.url.includes(self.location.origin)) return c.focus();
      }
      return clients.openWindow('/');
    })
  );
});

// ── Fetch: red primero, caché como fallback ───────────────
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Las llamadas a la API de Claude siempre van a la red (no se cachean)
  if (url.pathname.startsWith('/.netlify/functions/')) return;

  // Para el resto: intentar red, si falla usar caché
  event.respondWith(
    fetch(event.request)
      .then(res => {
        // Sólo cachear respuestas válidas de nuestro origen
        if (res.ok && url.origin === self.location.origin) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return res;
      })
      .catch(() => caches.match(event.request))
  );
});
