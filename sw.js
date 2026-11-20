/* =====================================================================
   sw.js · Service Worker de Marcianos de la Risa
   - Precachea la "app shell" para abrir sin conexión
   - Supabase (API/Realtime) SIEMPRE va a la red: nunca se cachea
   - CDN y fuentes: stale-while-revalidate
   Sube VERSION cada vez que publiques cambios.
   ===================================================================== */
const VERSION = 'marcianos-v1.0.0';
const SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './config.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon.png',
  './icons/logo.png',
  './icons/personajes.png'
];
const CDN = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    await cache.addAll(SHELL);
    try { await cache.add(new Request(CDN, { mode: 'cors' })); } catch (_) { /* se cacheará al primer uso */ }
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const claves = await caches.keys();
    await Promise.all(claves.filter((k) => k !== VERSION).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Nunca interceptar Supabase (datos en vivo, auth, realtime)
  if (url.hostname.endsWith('.supabase.co') || url.hostname.endsWith('.supabase.in')) return;

  // Navegación: red primero, si falla → index.html del caché
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      try {
        const res = await fetch(req);
        const cache = await caches.open(VERSION);
        cache.put('./index.html', res.clone());
        return res;
      } catch (_) {
        return (await caches.match('./index.html')) || Response.error();
      }
    })());
    return;
  }

  // Archivos propios: caché primero, actualiza en segundo plano
  // CDN y Google Fonts: stale-while-revalidate
  const propio = url.origin === self.location.origin;
  const externoPermitido = /(^|\.)jsdelivr\.net$|fonts\.(googleapis|gstatic)\.com$/.test(url.hostname);
  if (!propio && !externoPermitido) return;

  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const enCache = await cache.match(req);
    const red = fetch(req).then((res) => {
      if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
      return res;
    }).catch(() => null);
    return enCache || (await red) || new Response('', { status: 504, statusText: 'Sin conexión' });
  })());
});

// Permite forzar actualización desde la app
self.addEventListener('message', (e) => {
  if (e.data === 'actualizar') self.skipWaiting();
});
