import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * Fixes from the 2026-11-15 audit of lukkaplace.com at phone size (the
 * modern-web-guidance skill's checks plus live measurements). Each one was a
 * silent regression: nothing failed, the page just got heavier or emptier.
 */

const read = (rel) => readFileSync(path.join(process.cwd(), rel), 'utf8');
const size = (rel) => statSync(path.join(process.cwd(), rel)).size;

test('the "Recherches associées" links render their label, not an empty <a>', () => {
  const src = read('components/SidebarInsights.js');
  assert.match(src, /RELATED_SEARCHES\.map\(\(\{ labelKey, href \}\)/);
  assert.match(src, /\{t\(labelKey\)\}/);
  for (const locale of ['fr', 'en']) {
    const dict = JSON.parse(read(`lib/i18n/${locale}.json`));
    for (const key of ['apartmentsKinshasa', 'plotsForSale', 'propertiesToRent', 'typeLocataireHouses']) {
      assert.ok(dict.listings.sidebar[key], `${locale} listings.sidebar.${key}`);
    }
  }
});

test('on-screen logos use the small copies, ~4 KB instead of 205 KB', () => {
  for (const name of ['logo-light-sm.png', 'logo-dark-sm.png']) {
    assert.ok(size(`public/brand/${name}`) < 12 * 1024, `${name} stays small`);
  }
  for (const file of ['components/Brand.js', 'components/app/AppTopBar.js', 'components/AgencyLogo.js', 'app/admin/AdminSidebar.js']) {
    const src = read(file);
    assert.doesNotMatch(src, /src="\/brand\/logo-(light|dark)\.png|'\/brand\/logo-(light|dark)\.png/, `${file} draws the full-size logo`);
    assert.match(src, /logo-(light|dark)-sm\.png/, file);
  }
});

test('app mode loads Motion\'s features after hydration, not in the shared bundle', () => {
  const src = read('components/app/AppMotion.js');
  assert.doesNotMatch(src, /import\s*\{[^}]*\bdomMax\b[^}]*\}\s*from/, 'no static domMax import');
  assert.match(src, /import\('\.\/appMotionFeatures'\)/);
  assert.match(src, /<LazyMotion features=\{loadFeatures\} strict>/);
  assert.match(read('components/app/appMotionFeatures.js'), /export default domMax/);
});

test('the LCP photo asks for high fetch priority, one image per page', () => {
  const split = read('components/ListingsSplitView.js');
  // The endless feed (2026-11-14): only page 1's first card leads.
  assert.equal((split.match(/fetchPriority=\{page === 1 && i === 0 \? 'high' : undefined\}/g) || []).length, 2, 'website and app list');
  assert.match(read('components/CardImageCarousel.js'), /fetchPriority=\{i === 0 \? fetchPriority : undefined\}/);
  const gallery = read('components/PhotoGallery.js');
  // The phone carousel and the desktop mosaic share one URL and size: one request.
  assert.equal((gallery.match(/fetchPriority="high"/g) || []).length, 2);
  assert.match(read('components/blog/GuideCards.js'), /fetchPriority=\{priority \? 'high' : undefined\}/);
});
