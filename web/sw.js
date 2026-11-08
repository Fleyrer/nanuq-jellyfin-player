// SPDX-FileCopyrightText: 2026 Fleyrer y colaboradores de Nanuq
// SPDX-License-Identifier: GPL-3.0-or-later
// Nanuq service worker: guarda la app para abrirla sin conexión.
// La música y la API de Jellyfin siempre van directo a la red.
const CACHE = 'nanuq-v1.44.6';
const SHELL = ['./', 'index.html', 'i18n.js', 'app.js', 'app.css', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png', 'icons/logo.webp'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const fonts = url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
  // Solo los archivos de la app (dentro de la carpeta del service worker y con extensión de archivo estático), nunca la
  // API ni la música: si Jellyfin está en el mismo dominio (p. ej. casa.ejemplo/nanuq y casa.ejemplo/jellyfin), sus
  // respuestas —que llevan tus datos y a veces el token en la URL— no se guardan ni se sirven viejas.
  const scope = new URL(self.registration.scope);
  const appFile = url.origin === scope.origin && url.pathname.startsWith(scope.pathname) && !url.search
    && !req.headers.has('Authorization') && (req.mode === 'navigate' || /\.(html|js|css|png|svg|webp|webmanifest|woff2?)$/i.test(url.pathname));
  if (!appFile && !fonts) return; // Jellyfin, SomeDL y todo lo demás: directo a la red
  const sameOrigin = !fonts;
  if (req.mode === 'navigate') {
    // Red primero para recibir actualizaciones; caché si no hay conexión.
    e.respondWith(fetch(req).then(r => { if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put('index.html', copy)); } return r; }).catch(() => caches.match('index.html')));
    return;
  }
  // El código de la app (app.js, app.css, i18n.js) también va red primero: así nunca se junta un index.html nuevo con un
  // app.js viejo de la caché. Sin conexión, la copia guardada.
  if (sameOrigin && /\/(app\.(js|css)|i18n\.js)$/.test(url.pathname)) {
    e.respondWith(fetch(req).then(r => { if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(req, copy)); } return r; }).catch(() => caches.match(req, { ignoreSearch: true })));
    return;
  }
  e.respondWith(caches.match(req).then(hit => {
    const net = fetch(req).then(r => { if (r.ok || r.type === 'opaque') { const copy = r.clone(); caches.open(CACHE).then(c => c.put(req, copy)); } return r; }).catch(() => hit);
    return hit || net;
  }));
});
