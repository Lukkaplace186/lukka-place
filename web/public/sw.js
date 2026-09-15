/*
 * Lukka Place service worker — deliberately small.
 *
 * What it does, and nothing else:
 *   1. /_next/static/*  cache-first. Every file there has a content hash in
 *      its name and is immutable, so a repeat visit on a paid-for 3G link
 *      reuses the ~250 KB of JS/CSS instead of revalidating it. Only a 200
 *      is ever cached, so a chunk that 404s after a deploy is never pinned.
 *   2. /_next/image     stale-while-revalidate, capped at IMAGE_CACHE_MAX
 *      entries. Listing photos are content-addressed in Storage.
 *   3. Page navigations network-first; if the network is gone, the static
 *      /offline.html page instead of Chrome's dinosaur. HTML is NEVER
 *      cached: pages carry sessions, prices and availability, and a stale
 *      one is worse than an honest "you are offline".
 *
 * Everything else — /api, Server Actions, RSC fetches, POSTs, /admin, other
 * origins (Google Maps, Supabase, Plausible) — is not touched at all.
 *
 * KILL SWITCH: if this ever misbehaves in production, replace this file with
 * one whose `activate` handler calls `self.registration.unregister()` and
 * deletes every `lp-` cache. Browsers re-check /sw.js on navigation (it is
 * served no-cache, see next.config.mjs), so that reaches every visitor on
 * their next page load.
 */

const VERSION = 'v1';
const STATIC_CACHE = `lp-static-${VERSION}`;
const IMAGE_CACHE = `lp-images-${VERSION}`;
const OFFLINE_URL = '/offline.html';
const IMAGE_CACHE_MAX = 80;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.add(new Request(OFFLINE_URL, { cache: 'reload' })))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([STATIC_CACHE, IMAGE_CACHE]);
      for (const key of await caches.keys()) {
        if (key.startsWith('lp-') && !keep.has(key)) await caches.delete(key);
      }
      if (self.registration.navigationPreload) {
        await self.registration.navigationPreload.enable();
      }
      await self.clients.claim();
    })(),
  );
});

async function cacheFirst(request) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.status === 200) cache.put(request, response.clone());
  return response;
}

async function trimCache(cache, max) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - max; i += 1) {
    await cache.delete(keys[i]);
  }
}

async function staleWhileRevalidate(event) {
  const { request } = event;
  const cache = await caches.open(IMAGE_CACHE);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then(async (response) => {
      if (response.status === 200) {
        await cache.put(request, response.clone());
        await trimCache(cache, IMAGE_CACHE_MAX);
      }
      return response;
    })
    .catch(() => null);
  if (cached) {
    event.waitUntil(network);
    return cached;
  }
  const response = await network;
  return response || Response.error();
}

async function navigate(event) {
  try {
    const preloaded = await event.preloadResponse;
    if (preloaded) return preloaded;
    return await fetch(event.request);
  } catch {
    const offline = await caches.match(OFFLINE_URL);
    return offline || Response.error();
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    if (url.pathname.startsWith('/admin') || url.pathname.startsWith('/api')) return;
    event.respondWith(navigate(event));
    return;
  }

  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(cacheFirst(request));
    return;
  }

  if (url.pathname === '/_next/image') {
    event.respondWith(staleWhileRevalidate(event));
  }
});
