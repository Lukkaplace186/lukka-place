import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

import {
  shrinkTargetSize,
  shouldShrink,
  shrunkFileName,
  SHRINK_MAX_EDGE,
  SHRINK_SKIP_BELOW_BYTES,
} from '@/lib/photoShrink';
import { isNetworkError } from '@/lib/networkError';
import { sanitizeVital } from '@/app/api/telemetry/vitals/route';
import nextConfig from '../../next.config.mjs';
import manifest from '@/app/manifest';

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => fs.readFileSync(path.join(WEB, rel), 'utf8');

function sourceFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(path.join(WEB, dir), { withFileTypes: true })) {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(rel));
    else if (/\.(m?js|jsx)$/.test(entry.name)) out.push(rel);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Photos are shrunk on the phone before upload
// ---------------------------------------------------------------------------

test('a camera photo is scaled to the long-edge budget, keeping its ratio', () => {
  assert.deepEqual(shrinkTargetSize(4000, 3000), { width: SHRINK_MAX_EDGE, height: 1200 });
  assert.deepEqual(shrinkTargetSize(3000, 4000), { width: 1200, height: SHRINK_MAX_EDGE });
});

test('a photo already inside the budget is never upscaled', () => {
  assert.deepEqual(shrinkTargetSize(1280, 720), { width: 1280, height: 720 });
  assert.deepEqual(shrinkTargetSize(1, 5000).width, 1);
});

test('only real, large enough images are decoded', () => {
  assert.equal(shouldShrink({ type: 'image/jpeg', size: 4_000_000 }), true);
  assert.equal(shouldShrink({ type: 'image/jpeg', size: SHRINK_SKIP_BELOW_BYTES }), false);
  assert.equal(shouldShrink({ type: 'image/heic', size: 4_000_000 }), false);
  assert.equal(shouldShrink(null), false);
});

test('a shrunk photo is named as the JPEG it now is', () => {
  assert.equal(shrunkFileName('IMG_2024.PNG'), 'IMG_2024.jpg');
  assert.equal(shrunkFileName('salon.final.jpeg'), 'salon.final.jpg');
  assert.equal(shrunkFileName(''), 'photo.jpg');
});

test('both photo pickers shrink before anything else sees the files', () => {
  for (const file of ['components/CreateListingDialog.js', 'components/AgentListingEditor.js']) {
    assert.match(read(file), /await shrinkPhotos\(picked\)/, file);
  }
});

// ---------------------------------------------------------------------------
// Network failures are told apart from server verdicts
// ---------------------------------------------------------------------------

test('a dropped fetch is a network error; a server verdict is not', () => {
  assert.equal(isNetworkError(new TypeError('Failed to fetch')), true);
  assert.equal(isNetworkError(new TypeError('Load failed')), true);
  assert.equal(isNetworkError(new Error('Forbidden')), false);
  assert.equal(isNetworkError(new TypeError('x is not a function')), false);
});

// ---------------------------------------------------------------------------
// Data budget
// ---------------------------------------------------------------------------

test('framer-motion is gone from the bundle and the dependency list', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.dependencies['framer-motion'], undefined);
  const offenders = [...sourceFiles('app'), ...sourceFiles('components'), ...sourceFiles('lib')]
    .filter((file) => /from ['"]framer-motion['"]/.test(read(file)));
  assert.deepEqual(offenders, []);
});

test('images: one quality, and a cache long enough for content-addressed photos', () => {
  assert.deepEqual(nextConfig.images.qualities, [75]);
  assert.ok(nextConfig.images.minimumCacheTTL >= 60 * 60 * 24 * 30);
  assert.doesNotMatch(read('components/CardImageCarousel.js'), /quality=\{/);
});

test('compression can only be turned off explicitly', () => {
  assert.equal(nextConfig.compress, process.env.WEB_COMPRESS !== 'off');
  assert.notEqual(process.env.WEB_COMPRESS, 'off', 'the unit env must not disable compression');
});

test('the map modules are loaded on demand, not bundled with the list view', () => {
  const pane = read('components/ResponsiveMapPane.js');
  assert.doesNotMatch(pane, /^import (PropertyMap|ListingsMap|MapListingPreview|BuildingUnitsDrawer) from/m);
  assert.match(pane, /dynamic\(\(\) => import\('\.\/ListingsMap'\)/);
  const detail = read('components/ListingLocationMap.js');
  assert.match(detail, /show \? \(\s*<ResponsiveMapPane/);
});

test('no serif italic font file is requested', () => {
  assert.doesNotMatch(read('app/layout.js'), /'italic'/);
});

// ---------------------------------------------------------------------------
// Touch
// ---------------------------------------------------------------------------

test('card photo arrows cannot be tapped while invisible', () => {
  const source = read('components/CardImageCarousel.js');
  const arrow = source.match(/const arrowClass =\s*'([^']+)'/)?.[1] || '';
  for (const token of ['hidden', 'sm:flex', 'opacity-0', 'pointer-events-none', 'sm:group-hover/carousel:pointer-events-auto']) {
    assert.ok(arrow.split(/\s+/).includes(token), `arrow class is missing ${token}`);
  }
});

test('hand-written hover styles only apply where hover exists', () => {
  const css = read('app/globals.css');
  for (const selector of ['.u-btn-primary:hover', '.u-card-interactive:hover', '.u-btn-secondary:hover']) {
    const index = css.indexOf(`${selector} {`);
    assert.ok(index > 0, `${selector} not found`);
    const before = css.slice(0, index);
    assert.ok(before.lastIndexOf('@media (hover: hover)') > before.lastIndexOf('}\n  }'), `${selector} is not inside @media (hover: hover)`);
  }
});

test('customer visit answers are 44px tall', () => {
  assert.match(read('app/(site)/compte/client/messages/ViewingPanel.js'), /const CHOICE_CLASS =\s*'u-press inline-flex min-h-11/);
});

// ---------------------------------------------------------------------------
// Resilience: loading and error boundaries
// ---------------------------------------------------------------------------

test('slow routes show a skeleton and fail inside their own shell', () => {
  for (const file of [
    'app/(site)/loading.js',
    'app/(site)/listings/[id]/loading.js',
    'app/compte/agent/loading.js',
    'app/(portfolio)/loading.js',
    'app/(site)/error.js',
    'app/compte/agent/error.js',
    'app/(portfolio)/error.js',
    'app/global-error.js',
  ]) {
    assert.ok(fs.existsSync(path.join(WEB, file)), `${file} is missing`);
  }
  // Next 16 passes `retry`, not `reset`.
  assert.match(read('components/RouteError.js'), /retry\?\.\(\)/);
});

// ---------------------------------------------------------------------------
// PWA
// ---------------------------------------------------------------------------

function pngSize(file) {
  const buffer = fs.readFileSync(path.join(WEB, 'public', file));
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

test('the manifest points at real icons of the sizes it claims', () => {
  const data = manifest();
  assert.equal(data.start_url, '/');
  assert.equal(data.display, 'standalone');
  for (const icon of data.icons) {
    const [w, h] = icon.sizes.split('x').map(Number);
    assert.deepEqual(pngSize(icon.src), { width: w, height: h }, icon.src);
  }
});

function loadServiceWorker() {
  const handlers = {};
  const store = new Map();
  const caches = {
    async open(name) {
      if (!store.has(name)) store.set(name, new Map());
      const bucket = store.get(name);
      return {
        match: async (req) => bucket.get(typeof req === 'string' ? req : req.url),
        put: async (req, res) => { bucket.set(req.url, res); },
        add: async () => {},
        keys: async () => [...bucket.keys()].map((url) => ({ url })),
        delete: async (req) => bucket.delete(req.url),
      };
    },
    async match(url) {
      for (const bucket of store.values()) {
        for (const [key, value] of bucket) if (key.endsWith(url)) return value;
      }
      return undefined;
    },
    keys: async () => [...store.keys()],
    delete: async (name) => store.delete(name),
  };
  const context = {
    self: { addEventListener: (type, fn) => { handlers[type] = fn; }, location: { origin: 'https://lukkaplace.com' }, registration: {}, clients: {} },
    caches,
    fetch: null,
    URL,
    Request,
    Response,
  };
  vm.runInNewContext(read('public/sw.js'), context);
  return { handlers, store, context };
}

function fetchEvent(url, { method = 'GET', mode = 'cors' } = {}) {
  const event = {
    request: { url, method, mode },
    preloadResponse: Promise.resolve(undefined),
    responded: null,
    respondWith(promise) { this.responded = promise; },
    waitUntil() {},
  };
  return event;
}

test('service worker: API calls, Server Actions, admin pages and other origins are never intercepted', () => {
  const { handlers } = loadServiceWorker();
  for (const [url, opts] of [
    ['https://lukkaplace.com/api/track', {}],
    ['https://lukkaplace.com/listings/1', { method: 'POST' }],
    ['https://lukkaplace.com/admin/dashboard', { mode: 'navigate' }],
    ['https://maps.googleapis.com/maps/api/js', {}],
    ['https://lukkaplace.com/listings?_rsc=abc', {}],
  ]) {
    const event = fetchEvent(url, opts);
    handlers.fetch(event);
    assert.equal(event.responded, null, url);
  }
});

test('service worker: a page is fetched from the network, and never stored', async () => {
  const { handlers, store, context } = loadServiceWorker();
  const page = new Response('<html>live</html>', { status: 200 });
  context.fetch = async () => page;
  const event = fetchEvent('https://lukkaplace.com/compte/client', { mode: 'navigate' });
  handlers.fetch(event);
  assert.equal(await event.responded, page);
  for (const bucket of store.values()) assert.equal(bucket.has('https://lukkaplace.com/compte/client'), false);
});

test('service worker: offline, a page falls back to the offline screen', async () => {
  const { handlers, store, context } = loadServiceWorker();
  const offline = new Response('offline', { status: 200 });
  store.set('lp-static-v1', new Map([['https://lukkaplace.com/offline.html', offline]]));
  context.fetch = async () => { throw new TypeError('Failed to fetch'); };
  const event = fetchEvent('https://lukkaplace.com/listings/12', { mode: 'navigate' });
  handlers.fetch(event);
  assert.equal(await event.responded, offline);
});

test('service worker: a hashed chunk is cached only when it really exists', async () => {
  const { handlers, store, context } = loadServiceWorker();
  context.fetch = async () => new Response('gone', { status: 404 });
  const missing = fetchEvent('https://lukkaplace.com/_next/static/chunks/old.js');
  handlers.fetch(missing);
  assert.equal((await missing.responded).status, 404);
  assert.equal(store.get('lp-static-v1')?.size ?? 0, 0);

  context.fetch = async () => new Response('js', { status: 200 });
  const present = fetchEvent('https://lukkaplace.com/_next/static/chunks/new.js');
  handlers.fetch(present);
  await present.responded;
  assert.equal(store.get('lp-static-v1').has('https://lukkaplace.com/_next/static/chunks/new.js'), true);
});

// ---------------------------------------------------------------------------
// Web Vitals ingest: a public endpoint writing to a log
// ---------------------------------------------------------------------------

test('vitals: only known metrics with sane values are logged', () => {
  assert.equal(sanitizeVital({ name: 'FOO', value: 1 }), null);
  assert.equal(sanitizeVital({ name: 'LCP', value: -1 }), null);
  assert.equal(sanitizeVital({ name: 'LCP', value: 'abc' }), null);
  assert.deepEqual(sanitizeVital({ name: 'CLS', value: 0.123456, rating: 'good', route: '/listings/:id', nav: 'navigate', net: '3g', saveData: true }, 'mobile'), {
    name: 'CLS', value: 0.123, rating: 'good', route: '/listings/:id', nav: 'navigate', net: '3g', saveData: true, device: 'mobile',
  });
});

test('vitals: free text cannot reach the log through route, rating or connection', () => {
  const clean = sanitizeVital({ name: 'INP', value: 180.7, rating: '<script>', route: '/x?token=abc', nav: 'evil', net: '5g-lol' }, 'desktop');
  assert.deepEqual(clean, { name: 'INP', value: 181, rating: null, route: null, nav: null, net: null, saveData: false, device: 'desktop' });
});

// ---------------------------------------------------------------------------
// Hydration: listing dates are Kinshasa dates on server and phone alike
// ---------------------------------------------------------------------------

test('a listing date is printed on the Kinshasa calendar, whatever zone the process runs in', async () => {
  const { formatAddedOn, LISTING_TIME_ZONE } = await import('@/lib/listingView');
  assert.equal(LISTING_TIME_ZONE, 'Africa/Kinshasa');
  // 23:30 UTC on the 10th is 00:30 on the 11th in Kinshasa (UTC+1). The VPS
  // runs in UTC and printed "10 septembre" while a phone printed the 11th —
  // React error #418 on every page.
  assert.equal(formatAddedOn('2026-09-10T23:30:00Z'), '11 septembre 2026');
  assert.equal(formatAddedOn('2026-09-10T22:30:00Z', 'en'), '10 September 2026');
});

test('no client-rendered listing date is formatted in the runtime zone', () => {
  for (const file of ['components/ListingBadges.js', 'components/AgentListingsTable.js']) {
    const source = read(file);
    for (const call of source.match(/toLocaleDateString\([^)]*\)|new Intl\.DateTimeFormat\([^;]*\)/g) || []) {
      assert.match(call, /timeZone/, `${file}: ${call}`);
    }
  }
});

// ---------------------------------------------------------------------------
// iOS Safari input zoom
// ---------------------------------------------------------------------------

test('text fields are at least 16px on touch and phone-width screens, outside any layer', () => {
  const css = read('app/globals.css');
  const start = css.indexOf('@media (pointer: coarse), (max-width: 767px) {');
  assert.ok(start > 0, 'the 16px field rule is missing');
  // Unlayered: it must not sit inside an @layer block, or a text-sm utility wins.
  const before = css.slice(0, start);
  const opened = (before.match(/@layer [\w-]+ \{/g) || []).length;
  const layerBlocks = [...before.matchAll(/@layer [\w-]+ \{/g)].map((m) => m.index);
  for (const index of layerBlocks) {
    let depth = 0;
    let end = index;
    for (let i = css.indexOf('{', index); i < css.length; i += 1) {
      if (css[i] === '{') depth += 1;
      else if (css[i] === '}') { depth -= 1; if (depth === 0) { end = i; break; } }
    }
    assert.ok(end < start, 'the 16px field rule is nested inside an @layer');
  }
  assert.ok(opened >= 1);
  const block = css.slice(start, css.indexOf('\n}\n', start));
  assert.match(block, /select,\s*textarea\s*\{\s*font-size: max\(16px, 1em\);/);
  assert.match(block, /input:not\(\[type='checkbox'\]\)/);
});

test('the viewport is device-width, initial scale 1, covers notches, and never blocks pinch zoom', () => {
  // Read as source: importing app/layout.js in Node would pull in next/font and globals.css.
  const block = read('app/layout.js').match(/export const viewport = \{[\s\S]*?\n\};/)?.[0] || '';
  assert.ok(block, 'viewport export not found');
  assert.match(block, /width: 'device-width'/);
  assert.match(block, /initialScale: 1/);
  assert.match(block, /viewportFit: 'cover'/);
  // As properties, not words: the export's own comment explains why there is no maximumScale.
  assert.doesNotMatch(block, /^\s*(maximumScale|userScalable)\s*:/m);
});
