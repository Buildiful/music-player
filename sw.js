/* App shell only: audio imports and opt-in offline audio live outside the service worker cache. */
const CACHE = 'music-player-shell-v1-3-0';
const PREFIX = 'music-player-shell-';
const APP_FILES = [
  './', './index.html', './styles.css', './app.js',
  './buildiful-analytics-consent.js', './privacy.html', './manifest.webmanifest',
  './assets/favicon.ico', './assets/favicon-16x16.png',
  './assets/favicon-32x32.png', './assets/apple-touch-icon.png',
  './assets/icon-192.png', './assets/icon-512.png',
  './assets/buildiful-logo-white.png',
  './downloads/Music-Player-Offline.zip'
];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(APP_FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith(PREFIX) && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Keep the app's shell available offline; do not intercept analytics, media blobs, or other sites.
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).then(response => response.ok ? response : Promise.reject(new Error('network'))).catch(() => caches.match('./index.html')));
    return;
  }
  event.respondWith(caches.match(request).then(cached => cached || fetch(request)));
});
