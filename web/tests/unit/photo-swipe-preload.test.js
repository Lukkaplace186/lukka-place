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

// Phone gallery, thumbnails and visible arrows (2026-11-17, owner's reference
// site). Cards must keep their hidden arrows (see CardImageCarousel's TOUCH
// note): only the detail page opts in.
// Arrows on the phone photo were tried and removed the same day (owner): a
// swipe hint replaces them and the "1/N photos" counter.
test('no arrows or counter on the phone photo: a swipe hint until the first swipe', () => {
  assert.match(carousel, /arrows = 'hover',/);
  const gallery = read('components/PhotoGallery.js');
  assert.doesNotMatch(gallery, /arrows="always"/);
  assert.match(gallery, /<CardImageCarousel [^>]*showDots=\{false\} controlRef=\{carouselControl\}/);
  assert.match(gallery, /\{total > 1 && mobileIndex === 0 \? \(/);
  assert.match(gallery, /t\('listings\.gallery\.swipeHint'\)/);
  assert.doesNotMatch(gallery, /\{mobileIndex \+ 1\}\/\{total\}|1\/\{total\}/, 'a photo counter is back');
  for (const file of ['components/PropertyCard.js', 'components/MapCardCarousel.js']) {
    assert.doesNotMatch(read(file), /arrows="always"/, `${file} must not show phone arrows`);
  }
});

test('the visits pill and the agency band stay off a listing page', async () => {
  const { isListingPagePath } = await import('../../lib/listingPagePath.js');
  for (const p of ['/listings/1124-appartement', '/en/listings/1124-appartement', '/listings/7']) assert.equal(isListingPagePath(p), true, p);
  for (const p of ['/listings', '/en/listings', '/listings?commune=gombe', '/', '/agents/5', null]) assert.equal(isListingPagePath(p), false, String(p));
  assert.match(read('components/VisitCartSheet.js'), /cart\.length > 0 && !onListingPage \?/);
  const footer = read('components/Footer.js');
  assert.ok(footer.indexOf('<HideOnListingPage>') < footer.indexOf("footer.partnerBand.cta"));
});

test('the phone thumbnail strip is small, low priority, and jumps the carousel', () => {
  const gallery = read('components/PhotoGallery.js');
  const strip = gallery.slice(gallery.indexOf('ref={thumbStripRef}'), gallery.indexOf('<Dialog open={gridOpen}'));
  assert.match(strip, /sm:hidden/);
  // The first six load at once: lazy loading in the strip did not start
  // until it was scrolled (grey thumbnails on lukkaplace.com).
  assert.match(strip, /sizes="80px" fetchPriority="low" loading=\{index < 6 \? 'eager' : 'lazy'\}/);
  assert.match(strip, /onClick=\{\(\) => carouselControl\.current\?\.goTo\(index\)\}/);
  assert.match(strip, /aria-current=\{index === mobileIndex \? 'true' : undefined\}/);
});

test('a jump of more than one photo is instant, so the photos in between are not loaded', () => {
  const jump = carousel.slice(carousel.indexOf('function scrollToIndex('), carousel.indexOf('function go('));
  assert.match(jump, /behavior: far \? 'auto' : 'smooth'/);
  assert.match(carousel, /useImperativeHandle\(controlRef, \(\) => \(\{ goTo: \(i\) => scrollToIndex\(i\) \}\)\)/);
});
