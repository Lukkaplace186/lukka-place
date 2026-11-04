import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { marketCommunes } from '@/lib/homeMarket';
import fr from '@/lib/i18n/fr.json' with { type: 'json' };
import en from '@/lib/i18n/en.json' with { type: 'json' };

// The homepage below the search (2026-11-04, approved mockup): one section
// style, a slim recently-viewed strip, one royal alert band, one Explorer
// section, the market figures, an unboxed approach.

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const guide = (commune, beds, median, listings) => ({ commune, beds, median, listings, slug: `${beds}-${commune}` });

test('the market section keeps communes with two bedroom counts, busiest first, at most four', () => {
  const guides = [
    guide('Limete', 1, 320, 71), guide('Limete', 2, 550, 135), guide('Limete', 3, 1000, 44),
    guide('Gombe', 2, 2500, 36), guide('Gombe', 3, 2500, 35),
    guide('Lemba', 2, 425, 16), // one bedroom count only: no comparison
    guide('Ngaliema', 3, 1500, 40), guide('Ngaliema', 5, 4250, 6), guide('Ngaliema', 2, 700, 34),
    guide('Kintambo', 2, 800, 14), guide('Kintambo', 3, 1300, 16),
    guide('Lingwala', 2, 800, 39), guide('Lingwala', 3, 1100, 15),
  ];
  const communes = marketCommunes(guides);
  assert.deepEqual(communes.map((c) => c.commune), ['Limete', 'Ngaliema', 'Gombe', 'Lingwala']);
  // 5 bedrooms is left out, the rest is ordered and passed through unchanged.
  assert.deepEqual(communes[1].rows.map((r) => [r.beds, r.median]), [[2, 700], [3, 1500]]);
  assert.equal(communes[0].rows[1].slug, '2-Limete');
});

test('the market section shows nothing it was not given', () => {
  assert.deepEqual(marketCommunes([]), []);
  assert.deepEqual(marketCommunes(null), []);
  assert.deepEqual(marketCommunes([guide('Lemba', 2, 425, 16)]), []);
});

test('the homepage wires the decluttered sections in order', () => {
  const page = read('../../app/(site)/(home)/page.js');
  assert.match(page, /<RecentlyViewed variant="strip" minItems=\{2\} \/>/);
  assert.match(page, /<HomeDiscovery propertyTypes=\{propertyTypes\} \/>/);
  assert.doesNotMatch(page, /<PropertyTypeTiles|import PropertyTypeTiles/);
  const order = ['<RecentlyViewed', '<FeaturedListings', '<HomeAlertBand', '<HomeDiscovery', '<HomeMarketBand', '<ValueProposition'];
  const positions = order.map((tag) => page.indexOf(tag));
  assert.ok(positions.every((p) => p > 0), 'every section is rendered');
  assert.deepEqual([...positions].sort((a, b) => a - b), positions, 'in this order');
});

test('every homepage band below the search uses the one section header', () => {
  for (const file of ['FeaturedListings', 'SavedListings', 'HomeDiscovery', 'HomeMarketBand', 'ValueProposition', 'projects/NewProjectsStrip']) {
    const source = read(`../../components/${file}.js`);
    assert.match(source, /<HomeSectionHeader /, file);
    assert.match(source, /HOME_SECTION/, file);
    assert.doesNotMatch(source, /<SectionHeading /, file);
  }
});

test('the alert form stays folded until the button is tapped', () => {
  const reveal = read('../../components/HomeAlertReveal.js');
  assert.match(reveal, /aria-expanded=\{open\}/);
  assert.match(reveal, /hidden=\{!open\}/);
  assert.match(read('../../components/HomeAlertBand.js'), /bg-blue-deep/);
});

test('the Lukka Index is off the homepage (owner, 2026-11-04); the guides stay', () => {
  const band = read('../../components/HomeMarketBand.js');
  assert.doesNotMatch(band, /getLukkaIndex|href="\/indice-lukka"/);
  assert.match(band, /getPriceGuides\(\)/);
});

test('every new homepage string exists in French and English', () => {
  for (const dict of [fr, en]) {
    for (const key of ['lead', 'open', 'close']) assert.ok(dict.home.alertBand[key], `alertBand.${key}`);
    assert.ok(dict.home.explore.title);
    for (const key of ['title', 'note', 'communes', 'detail']) assert.ok(dict.home.market[key], `market.${key}`);
    for (const key of ['statLabel', 'statCount', 'barLabel', 'bedsShort']) {
      assert.ok(dict.home.market[key].one && dict.home.market[key].other, `market.${key}`);
    }
    assert.ok(dict.home.value.aboutLink);
  }
});
