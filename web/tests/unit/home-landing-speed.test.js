import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { sanitizeTtfbParts, sanitizeVital } from '@/app/api/telemetry/vitals/route';

/*
 * The 2026-11-19 audit. The ad campaign lands every visitor on the phone
 * home page: 3,706 of 3,792 visitors that day, 90 % of whom saw one page.
 * Field LCP there was 4.9 s at p75 with a 2.8 s first byte, on a server that
 * renders the page in 50 ms.
 */
const read = (path) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');

test('home: the weekly selection does not preload photos below the first screen', () => {
  const rail = read('../../components/FeaturedListingsCarousel.js');
  // `priority` on a card is a <link rel="preload"> in the head: four of them
  // (~280 KB) raced the hero photo and the scripts on a cold connection.
  assert.ok(!/<PropertyCard[^>]*\bpriority\b/.test(rail), 'no card of the rail is preloaded');
  // The card is 82vw capped at 310px on a phone: never the default 100vw.
  assert.match(rail, /RAIL_SIZES = '\(min-width: 1024px\) 25vw, \(min-width: 768px\) 33vw, \(min-width: 640px\) 50vw, 310px'/);
  assert.match(rail, /<PropertyCard listing=\{listing\} sizes=\{RAIL_SIZES\} \/>/);
});

test('home: the hero stays the one photo fetched at high priority', () => {
  const hero = read('../../components/Hero.js');
  assert.ok(hero.includes('fetchPriority="high"'));
});

test('vitals: a TTFB line carries where the wait went', () => {
  const clean = sanitizeVital({
    name: 'TTFB', value: 2144.4, rating: 'poor', route: '/', nav: 'navigate', net: '4g',
    parts: { wait: 812.6, dns: 140, conn: 610.2, req: 540, proto: 'h3' },
  }, 'mobile');
  assert.deepEqual(clean.parts, { wait: 813, dns: 140, conn: 610, req: 540, proto: 'h3' });
});

test('vitals: the breakdown is numbers and a known protocol, nothing else', () => {
  assert.equal(sanitizeTtfbParts(null), null);
  assert.equal(sanitizeTtfbParts('wait=1'), null);
  assert.equal(sanitizeTtfbParts({ wait: 1, dns: 2, conn: 3 }), null, 'a missing duration drops the breakdown');
  assert.equal(sanitizeTtfbParts({ wait: -5, dns: 2, conn: 3, req: 4 }), null);
  assert.equal(sanitizeTtfbParts({ wait: 1, dns: 2, conn: 3, req: 9e9 }), null);
  assert.equal(sanitizeTtfbParts({ wait: 1, dns: 2, conn: 3, req: '<script>' }), null);
  assert.deepEqual(sanitizeTtfbParts({ wait: 1, dns: 2, conn: 3, req: 4, proto: '<script>', extra: 'x' }), { wait: 1, dns: 2, conn: 3, req: 4, proto: null });
});

test('vitals: a bad breakdown never costs the metric, and other metrics keep their shape', () => {
  const ttfb = sanitizeVital({ name: 'TTFB', value: 900, rating: 'good', route: '/', parts: { wait: 'abc' } }, 'mobile');
  assert.equal(ttfb.value, 900);
  assert.ok(!('parts' in ttfb));
  const lcp = sanitizeVital({ name: 'LCP', value: 2000, rating: 'good', route: '/', parts: { wait: 1, dns: 2, conn: 3, req: 4 } }, 'mobile');
  assert.ok(!('parts' in lcp), 'only TTFB carries a breakdown');
});

test('vitals: the browser side computes the breakdown from the navigation entry', async () => {
  const source = read('../../components/WebVitals.js');
  assert.match(source, /metric\.name === 'TTFB' \? \{ parts: ttfbParts\(metric\.entries\?\.\[0\]\) \} : \{\}/);
  // The function is pure: evaluate it without React or next/web-vitals.
  const body = source.slice(source.indexOf('export function ttfbParts'), source.indexOf('function flush()'));
  const ttfbParts = new Function(`${body.replace('export function', 'function')}; return ttfbParts;`)();
  assert.equal(ttfbParts(null), null);
  assert.deepEqual(
    ttfbParts({ fetchStart: 800.4, workerStart: 0, domainLookupStart: 800.4, domainLookupEnd: 950, connectStart: 950, connectEnd: 1500, requestStart: 1501, responseStart: 2100, nextHopProtocol: 'h2' }),
    { wait: 800, dns: 150, conn: 550, req: 599, proto: 'h2' },
  );
  // A reused connection reports equal start and end: zero, never negative.
  assert.deepEqual(
    ttfbParts({ fetchStart: 5, domainLookupStart: 5, domainLookupEnd: 5, connectStart: 5, connectEnd: 5, requestStart: 8, responseStart: 400, nextHopProtocol: '' }),
    { wait: 5, dns: 0, conn: 0, req: 392, proto: '' },
  );
});

test('home: the saved-listings rail in the same slot follows the same rule', () => {
  const rail = read('../../components/SavedListingsRail.js');
  assert.ok(!/<PropertyCard[^>]*\bpriority\b/.test(rail));
  assert.ok(rail.includes('<PropertyCard listing={listing} sizes="304px" />'));
});
