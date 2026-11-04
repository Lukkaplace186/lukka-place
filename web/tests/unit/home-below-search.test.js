import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { guideSearchHref, marketCommunes } from '@/lib/homeMarket';
import fr from '@/lib/i18n/fr.json' with { type: 'json' };
import en from '@/lib/i18n/en.json' with { type: 'json' };

// The homepage below the search (2026-11-04, approved mockup): one section
// style, a slim recently-viewed strip, one royal alert band, one Explorer
// section, the market figures, an unboxed approach.

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const guide = (commune, beds, median, listings) => ({ commune, beds, median, listings, slug: `${beds}-${commune}` });

test('the market section shows every commune with a guide, busiest first', () => {
  const guides = [
    guide('Limete', 1, 320, 71), guide('Limete', 2, 550, 135), guide('Limete', 3, 1000, 44),
    guide('Gombe', 2, 2500, 36), guide('Gombe', 3, 2500, 35),
    guide('Lemba', 2, 425, 16), // one bedroom count: one real bar, still shown
    guide('Ngaliema', 3, 1500, 40), guide('Ngaliema', 5, 4250, 6), guide('Ngaliema', 2, 700, 34),
    guide('Kintambo', 2, 800, 14), guide('Kintambo', 3, 1300, 16),
    guide('Lingwala', 2, 800, 39), guide('Lingwala', 3, 1100, 15),
    guide('Kalamu', 5, 900, 7), // only a 5-bedroom guide: nothing in the 1–4 chart
  ];
  const communes = marketCommunes(guides);
  assert.deepEqual(communes.map((c) => c.commune), ['Limete', 'Ngaliema', 'Gombe', 'Lingwala', 'Kintambo', 'Lemba']);
  // 5 bedrooms is left out, the rest is ordered and passed through unchanged.
  assert.deepEqual(communes[1].rows.map((r) => [r.beds, r.median]), [[2, 700], [3, 1500]]);
  assert.equal(communes[0].rows[1].slug, '2-Limete');
  assert.equal(marketCommunes(guides, { max: 2 }).length, 2);
});

test('each bar carries the guide page\'s own range and Lukka Place count, never a made-up one', () => {
  const [limete] = marketCommunes([{ ...guide('Limete', 2, 550, 135), p25: 400, p75: 700, lukkaListings: 40 }]);
  assert.deepEqual(limete.rows[0], { beds: 2, median: 550, p25: 400, p75: 700, listings: 135, lukkaListings: 40, slug: '2-Limete' });
  const [bare] = marketCommunes([guide('Lemba', 2, 425, 16)]);
  assert.equal(bare.rows[0].p25, null);
  assert.equal(bare.rows[0].lukkaListings, 0);
});

test('the listings button opens the same search as the guide page', () => {
  assert.equal(guideSearchHref('Kasa-Vubu', 2), '/listings?transaction_type=location&commune=Kasa-Vubu&beds_min=2&lease_term=long');
  assert.match(read('../../app/(site)/combien-coute/[slug]/page.js'), /guideSearchHref\(guide\.commune, guide\.beds\)/);
  const explorer = read('../../components/HomeMarketExplorer.js');
  assert.match(explorer, /selected\.lukkaListings > 0 \?/, 'no button when Lukka Place has nothing to show');
  assert.match(explorer, /selected\.p25 < selected\.p75/, 'no "entre X et X" range');
});

test('the market section shows nothing it was not given', () => {
  assert.deepEqual(marketCommunes([]), []);
  assert.deepEqual(marketCommunes(null), []);
  assert.deepEqual(marketCommunes([guide('Kalamu', 5, 900, 7)]), []);
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
    for (const key of ['title', 'note', 'communes', 'detail', 'seeListings']) assert.ok(dict.home.market[key], `market.${key}`);
    for (const key of ['statLabel', 'statCount', 'barLabel', 'bedsShort', 'onLukka']) {
      assert.ok(dict.home.market[key].one && dict.home.market[key].other, `market.${key}`);
    }
    assert.ok(dict.home.value.aboutLink);
  }
});
