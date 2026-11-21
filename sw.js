const CACHE = 'toolbox-shell-v4';
const SHELL = ['./', './index.html', './style.css', './app.js', './audio.js', './vendor/qrcode.js', './script-import.js', './teleprompter-camera.js', './vendor/fflate.js',
  './picture-scan/pdf-viewer.js', './picture-scan/vendor/pdfjs/pdf.min.mjs', './picture-scan/vendor/pdfjs/pdf.worker.min.mjs',
  './picture-scan/vendor/pdfjs/resource-index.js', './picture-scan/vendor/pdfjs/resources.bin', './icon.svg', './manifest.webmanifest'];
const urls = new Set(SHELL.map(path => new URL(path, self.registration.scope).href));

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)));
  self.skipWaiting();
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys
    .filter(key => key.startsWith('toolbox-shell-') && key !== CACHE)
    .map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  url.hash = '';
  if (event.request.method !== 'GET' || !urls.has(url.href)) return;
  event.respondWith(caches.open(CACHE).then(async cache => {
    try {
      const response = await fetch(event.request);
      if (response.ok) await cache.put(url.href, response.clone());
      return response;
    } catch {
      return cache.match(url.href);
    }
  }));
});
