// Service Worker de Mesgot Web (PWA ligera).
//
// Cachea SOLO los assets propios del origen (app shell + chunks con hash de
// Vite + iconos + manifest). NUNCA toca la red de Supabase (REST/RPC/realtime/
// storage) ni las signed URLs de media-chat: todo eso va siempre a red.
//
// Estrategia:
//   - navegaciones (documento): network-first con fallback al shell cacheado
//     (permite abrir la app offline).
//   - assets propios con hash (/assets/*, iconos, manifest): stale-while-
//     revalidate (rápido y se refresca en segundo plano).
//   - cualquier cosa hacia *.supabase.co o de otro origen: se ignora (network).

const CACHE = 'mesgot-web-v1';

// Se resuelve en install a partir del scope: '/chat/' en prod, '/' en dev.
function shellUrl() {
  return new URL('./index.html', self.registration.scope).toString();
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      try {
        await cache.add(new Request(shellUrl(), { cache: 'reload' }));
      } catch {
        /* si falla el precache del shell no bloqueamos la instalación */
      }
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

/** true si la petición es a nuestro propio origen (no Supabase ni terceros). */
function isSameOrigin(url) {
  return url.origin === self.location.origin;
}

/** true si la ruta es un asset cacheable (assets con hash, iconos, manifest). */
function isCacheableAsset(url) {
  const p = url.pathname;
  return (
    p.includes('/assets/') ||
    p.endsWith('.webmanifest') ||
    p.endsWith('.png') ||
    p.endsWith('.svg') ||
    p.endsWith('.ico') ||
    p.endsWith('.woff2')
  );
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Todo lo que no sea de nuestro origen (Supabase, tiles OSM, etc.) → red directa.
  if (!isSameOrigin(url)) return;

  // Navegaciones: network-first, fallback al shell cacheado (offline).
  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          return await fetch(req);
        } catch {
          const cache = await caches.open(CACHE);
          const cached = await cache.match(shellUrl());
          return cached || Response.error();
        }
      })(),
    );
    return;
  }

  // Assets propios con hash: stale-while-revalidate.
  if (isCacheableAsset(url)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE);
        const cached = await cache.match(req);
        const network = fetch(req)
          .then((res) => {
            if (res && res.ok) cache.put(req, res.clone());
            return res;
          })
          .catch(() => null);
        return cached || (await network) || Response.error();
      })(),
    );
  }
  // El resto (mismo origen, no asset): red normal, sin interceptar.
});
