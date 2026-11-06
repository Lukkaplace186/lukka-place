import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  circlePoints, listingStaticMapSrc, staticMapUrl, styleParam, STATIC_LISTING_MAP_ZOOM,
} from '../../lib/staticMap.js';
import { MAP_STYLES } from '../../lib/mapStyle.js';
import { PRIVACY_RADIUS_M } from '../../lib/listingPin.js';
import { DETAIL_HERO_SIZES, DETAIL_SIDE_SIZES } from '../../lib/detailGallerySizes.js';

// Speed pass, 2026-11-06 (web/CLAUDE.md, "Navigation speed pass").
const read = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');

test('static map: a style entry becomes one style= value, and an empty one none', () => {
  assert.equal(
    styleParam({ featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#FFE7A0' }] }),
    'feature:road.highway|element:geometry|color:0xffe7a0',
  );
  assert.equal(styleParam({ featureType: 'transit', stylers: [{ visibility: 'off' }] }), 'feature:transit|visibility:off');
  assert.equal(styleParam({ featureType: 'poi', stylers: [] }), null);
  // Every entry of the interactive map's style carries over.
  assert.ok(MAP_STYLES.every((entry) => styleParam(entry)));
});

test('static map: the circle is closed and PRIVACY_RADIUS_M from its centre', () => {
  const center = { lat: -4.33, lng: 15.27 };
  const pts = circlePoints(center, 500);
  assert.equal(pts.length, 33);
  assert.deepEqual(pts[0], pts[pts.length - 1]);
  for (const p of pts) {
    const dy = (p.lat - center.lat) * 111320;
    const dx = (p.lng - center.lng) * 111320 * Math.cos((center.lat * Math.PI) / 180);
    assert.ok(Math.abs(Math.hypot(dx, dy) - 500) < 3, `radius ${Math.hypot(dx, dy)}`);
  }
});

test('static map: same zoom as the interactive map, sides capped at 640, scale 2, key last', () => {
  const pinZoom = Number(read('components/ListingPinMap.js').match(/LISTING_MAP_ZOOM = (\d+);/)[1]);
  assert.equal(STATIC_LISTING_MAP_ZOOM, pinZoom);
  const url = staticMapUrl({ center: { lat: -4.33, lng: 15.27 }, zoom: 14, radiusM: 500, width: 800, height: 416, apiKey: 'K' });
  assert.match(url, /^https:\/\/maps\.googleapis\.com\/maps\/api\/staticmap\?center=-4\.33000,15\.27000&zoom=14&size=640x333&scale=2&/);
  assert.match(url, /&path=color%3A0x1e3a8a59%7Cweight%3A1%7Cfillcolor%3A0x1e3a8a1a%7C/);
  assert.match(url, /&key=K$/);
  assert.ok(url.length < 8192, 'well under the Static Maps URL limit');
  assert.equal(staticMapUrl({ center: { lat: -4.33, lng: 15.27 }, zoom: 14, width: 1, height: 1, apiKey: '' }), null);
});

test('static map: off unless switched on, and only for stored coordinates', async () => {
  const listing = { id: 310, latitude: '-4.3301', longitude: '15.2702' };
  assert.equal(await listingStaticMapSrc(listing, 'fr', { NEXT_PUBLIC_GOOGLE_MAPS_API_KEY: 'K' }), null);
  const env = { NEXT_PUBLIC_STATIC_LISTING_MAP: 'on', NEXT_PUBLIC_GOOGLE_MAPS_API_KEY: 'K' };
  const url = await listingStaticMapSrc(listing, 'en', env);
  assert.match(url, /language=en/);
  assert.match(url, /zoom=14/);
  // The jittered point, never the stored one.
  assert.doesNotMatch(url, /center=-4\.33010,15\.27020/);
  assert.equal(await listingStaticMapSrc({ id: 1, latitude: null, longitude: null }, 'fr', env), null);
  assert.equal(PRIVACY_RADIUS_M, 500);
});

test('static map: an image that fails falls back to the interactive map; the URL is built on the server', () => {
  const map = read('components/ListingLocationMap.js');
  assert.match(map, /onError=\{\(\) => setInteractive\(true\)\}/);
  assert.doesNotMatch(map, /from '@\/lib\/(geocoding|staticMap)'/, 'the quartier data must not ship to the browser');
  assert.match(read('app/(site)/listings/[id]/page.js'), /staticMapSrc=\{staticMapSrc\}/);
});

test('the similar-listings rail streams after the rest of the listing page', () => {
  const page = read('app/(site)/listings/[id]/page.js');
  const main = page.slice(page.indexOf('export default async function ListingDetailPage'), page.indexOf('async function RelatedSection'));
  assert.doesNotMatch(main, /getSimilarListings|getListings\(/);
  assert.match(main, /<Suspense fallback=\{null\}>\s*<RelatedSection /);
});

test('a card fetches its whole page on hover or touch, and warms the desktop gallery photos', () => {
  const card = read('components/PropertyCard.js');
  assert.match(card, /unstable_dynamicOnHover=\{!lightData\}/);
  assert.match(card, /warmListingPhotos\(images\)/);
  const gallery = read('components/PhotoGallery.js');
  assert.match(gallery, /sizes=\{DETAIL_HERO_SIZES\}/);
  assert.match(gallery, /sizes=\{DETAIL_SIDE_SIZES\}/);
  // The phone carousel's priority photo is the desktop hero's file, not a second copy.
  assert.match(gallery, /<CardImageCarousel images=\{shots\} alt=\{alt\} sizes=\{DETAIL_HERO_SIZES\} fullWidth priority/);
  assert.ok(DETAIL_HERO_SIZES && DETAIL_SIDE_SIZES);
});

test('the header and footer prefetch on intent, not as soon as they are on screen', () => {
  for (const file of ['components/Header.js', 'components/Footer.js']) {
    assert.match(read(file), /^import Link from '@\/components\/IntentLink';/m, file);
  }
  const link = read('components/IntentLink.js');
  assert.match(link, /prefetch=\{prefetch === false \? false : active \? \(prefetch \?\? null\) : false\}/);
});

test('photos are served as AVIF first, WebP otherwise', async () => {
  const { default: config } = await import('../../next.config.mjs');
  assert.deepEqual(config.images.formats, ['image/avif', 'image/webp']);
  assert.deepEqual(config.images.qualities, [75]);
});

test('the hover upgrade is switched on (Next ignores unstable_dynamicOnHover without it)', async () => {
  const { default: config } = await import('../../next.config.mjs');
  assert.equal(config.experimental.dynamicOnHover, true);
});
