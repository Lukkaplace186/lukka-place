// Detail-page photos on a slow link (2026-11-17, owner's iPhone in Kinshasa:
// "2/8 photos" on a grey frame). From Kinshasa one photo takes ~1.5 s, mostly
// round trips to the Paris server, so a photo must be asked for BEFORE the
// visitor reaches it. Source-level checks, like mobile-performance.test.js:
// the carousel is a client component with no DOM in this tier.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (file) => readFileSync(path.join(root, file), 'utf8');
const carousel = read('components/CardImageCarousel.js');

test('the photo being swiped to is mounted on the first pixel of the swipe', () => {
  const handler = carousel.slice(carousel.indexOf('function handleScroll('), carousel.indexOf('function handleSlideLoad('));
  assert.match(handler, /markLoadedAround\([^\n]*Math\.floor\(position\)/);
  assert.match(handler, /markLoadedAround\([^\n]*Math\.ceil\(position\)/);
});

test('preloading ahead waits for the cover, and skips Data Saver and a hidden carousel', () => {
  const handler = carousel.slice(carousel.indexOf('function handleSlideLoad('), carousel.indexOf('const arrowClass'));
  assert.match(handler, /if \(i !== 0 \|\| !preloadAhead \|\| lightData\) return;/);
  assert.match(handler, /if \(!scrollerRef\.current\?\.clientWidth\) return;/);
  assert.match(carousel, /onLoad=\{\(\) => handleSlideLoad\(i\)\}/);
  assert.match(carousel, /preloadAhead = 0,/, 'off unless a caller asks');
});

test('only slides after the cover are eager; a feed card cover stays lazy', () => {
  assert.match(carousel, /loading=\{i === 0 \? undefined : 'eager'\}/);
});

test('the shimmer stops on a slide once its photo has painted', () => {
  assert.match(carousel, /loadingShimmer && !painted\.has\(i\) \? ' lkp-shimmer' : ''/);
});

test('the detail page phone gallery preloads two photos and shimmers', () => {
  const gallery = read('components/PhotoGallery.js');
  assert.match(gallery, /<CardImageCarousel [^>]*preloadAhead=\{2\} loadingShimmer /);
});

test('feed cards neither preload ahead nor shimmer', () => {
  for (const file of ['components/PropertyCard.js']) {
    const source = read(file);
    if (!source.includes('<CardImageCarousel')) continue;
    assert.doesNotMatch(source, /preloadAhead/);
  }
});
