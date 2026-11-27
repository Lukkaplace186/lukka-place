// Trust and search pass (2026-11-27): "Signaler cette annonce", the price
// history, public agent ratings on the profile, recently viewed and
// "Près de moi" in the app.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { REPORT_REASONS, REPORT_NOTE_MAX, readReport } from '@/lib/listingReportRules';
import { buildPriceHistory } from '@/lib/priceHistoryRules';
import fr from '@/lib/i18n/fr.json' with { type: 'json' };
import en from '@/lib/i18n/en.json' with { type: 'json' };

const read = (rel) => readFileSync(path.join(process.cwd(), rel), 'utf8');

test('a report needs a known reason; "autre" needs a few words; the note is capped', () => {
  assert.deepEqual(readReport({ reason: 'scam', note: '  il demande  une avance ' }), { reason: 'scam', note: 'il demande une avance' });
  assert.deepEqual(readReport({ reason: 'unavailable', note: '' }), { reason: 'unavailable', note: null });
  assert.equal(readReport({ reason: 'spam' }).error, 'listings.detail.report.errors.reason');
  assert.equal(readReport({ reason: 'other', note: 'non' }).error, 'listings.detail.report.errors.otherNeedsNote');
  assert.equal(readReport({ reason: 'wrong_price', note: 'x'.repeat(REPORT_NOTE_MAX + 1) }).error, 'listings.detail.report.errors.tooLong');
});

test('the report reasons are the migration CHECK list, the table is closed to the public API', () => {
  const sql = read('../migrations/20261127_listing_reports.sql');
  const check = sql.match(/reason IN \(([^)]+)\)/)[1].split(',').map((s) => s.trim().replace(/'/g, ''));
  assert.deepEqual(check, [...REPORT_REASONS]);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS listing_reports/);
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS listing_reports_one_open_per_visitor/);
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /REVOKE ALL ON listing_reports FROM anon, authenticated/);
  for (const reason of REPORT_REASONS) {
    assert.ok(fr.listings.detail.report.reasons[reason], `fr reason ${reason}`);
    assert.ok(en.listings.detail.report.reasons[reason], `en reason ${reason}`);
  }
});

test('reporting: public listings only, a hashed visitor, rate-limited, nothing sent to the agent', () => {
  const action = read('app/(site)/listings/[id]/reportActions.js');
  assert.match(action, /await getListingById\(id\)/);
  assert.match(action, /visitor: visitorHash\(visitor\)/);
  assert.match(action, /rateLimited\(`report:/);
  assert.doesNotMatch(action, /chakra|sendWhatsApp|engineFetch/i);
  const lib = read('lib/listingReports.js');
  assert.match(lib, /to_regclass\('public\.listing_reports'\)/);
  assert.match(lib, /ON CONFLICT \(property_id, visitor_hash\) WHERE status = 'open'/);
  // The form loads on tap, never in the listing's first load.
  assert.match(read('components/listings/ReportListingButton.js'), /dynamic\(\(\) => import\('\.\/ReportListingDialog'\)/);
  assert.match(read('app/(site)/listings/[id]/page.js'), /<ReportListingButton listingId=\{listing\.id\} \/>/);
  // The console page: behind listings.view, marking behind listings.moderate.
  assert.match(read('lib/adminRoles.js'), /'\/admin\/signalements': 'listings\.view'/);
  assert.match(read('app/admin/signalements/actions.js'), /requireAdmin\('listings\.moderate'\)/);
});

const row = (price, at, after, extra = {}) => ({ price, currency: 'USD', purpose: 'rent', price_period: 'mois', changed_at: at, after_publish: after, ...extra });

test('price history: the published price, then real changes; drafts and typo fixes are left out', () => {
  const history = buildPriceHistory([
    row(800, '2026-10-01', false),
    row(700, '2026-10-02', false), // corrected before publication: not shown
    row(650, '2026-10-20', true),
    row(6500, '2026-10-21', true), // an extra zero: a typo, not a change
    row(650, '2026-10-22', true),
    row(600, '2026-11-10', true),
  ], '2026-10-03');
  assert.equal(history.start.price, 700);
  assert.equal(history.start.at, '2026-10-03');
  assert.deepEqual(history.steps.map((s) => [s.price, s.percent, s.direction]), [[650, -7, 'down'], [600, -8, 'down']]);
});

test('price history: nothing without a change after publication; a corrected period is not a step', () => {
  assert.equal(buildPriceHistory([row(500, '2026-10-01', false)], '2026-10-02'), null);
  assert.equal(buildPriceHistory([], null), null);
  // Listing #340 on 2026-10-22: the period label went mois -> day -> mois -> day -> jour at one price.
  assert.equal(buildPriceHistory([
    row(150, '2026-10-22T09:11', false),
    row(150, '2026-10-22T09:12', false, { price_period: 'day' }),
    row(150, '2026-10-22T09:20', true),
    row(150, '2026-10-22T09:50', true, { price_period: 'day' }),
    row(150, '2026-10-22T19:07', true, { price_period: 'jour' }),
  ], '2026-10-22T09:13'), null);
  // Only prices on the current terms are compared: 130 -> 150 a day is +15 % (#912).
  const day = buildPriceHistory([
    row(130, '2026-11-13', false, { price_period: 'jour' }),
    row(150, '2026-11-26', true, { price_period: 'jour' }),
  ], '2026-11-13');
  assert.deepEqual(day.steps.map((s) => [s.price, s.percent, s.direction]), [[150, 15, 'up']]);
});

test('the price history reads the public gate and the badge\'s publication bound', () => {
  const lib = read('lib/priceHistory.js');
  assert.match(lib, /p\.status = 1 AND p\.approve_status = 1/);
  assert.match(lib, /GREATEST\(p\.created_at, COALESCE\(p\.moderated_at, p\.created_at\)\)/);
  assert.match(read('app/(site)/listings/[id]/page.js'), /<PriceHistory listingId=\{listing\.id\}/);
});

test('app home: recently viewed strip and "Biens près de moi", which never puts a position in the URL', () => {
  const home = read('components/AppHomeTop.js');
  assert.match(home, /<RecentlyViewed variant="app" minItems=\{2\}/);
  assert.match(home, /'\/listings\?view=map&pres=1'/);
  const map = read('components/ListingsMap.js');
  assert.match(map, /if \(!mapReady \|\| autoLocatedRef\.current \|\| pres !== '1'\) return;/);
  assert.match(map, /url\.searchParams\.delete\('pres'\)/);
  assert.equal(fr.appShell.home.nearMe, 'Biens près de moi');
});

test('a saved drawn zone is named and tagged as the zone, and is enough for an alert on its own', async () => {
  const { buildSearchLabel, searchCriteriaTags } = await import('@/lib/searchLabel');
  const { feedAlertReady } = await import('@/lib/feedAlertRules');
  const t = (key, vars) => {
    const value = key.split('.').reduce((o, k) => o?.[k], fr);
    return typeof value === 'string' ? value.replace(/\{(\w+)\}/g, (_, k) => vars?.[k] ?? '') : key;
  };
  const zone = '-4.31,15.29;-4.31,15.31;-4.33,15.31;-4.33,15.29';
  const withZone = new URLSearchParams(`commune=Lingwala&transaction_type=location&zone=${zone}&sw_lat=-4.33&sw_lng=15.29&ne_lat=-4.31&ne_lng=15.31`);
  assert.equal(buildSearchLabel(withZone, t), 'Biens à louer dans la zone dessinée');
  assert.deepEqual(searchCriteriaTags(withZone, t).slice(0, 2), ['Location', 'Zone dessinée']);
  assert.ok(!searchCriteriaTags(withZone, t).includes('Lingwala'), 'the commune the search started from is not the place any more');
  // The map's box alone (no zone) names the map area; a plain search keeps its commune.
  assert.equal(buildSearchLabel(new URLSearchParams('commune=Gombe&sw_lat=-4.33&sw_lng=15.29&ne_lat=-4.31&ne_lng=15.31'), t), 'Biens disponibles dans la zone de la carte');
  assert.equal(buildSearchLabel(new URLSearchParams('commune=Gombe&transaction_type=location'), t), 'Biens à louer à Gombe');
  // No commune but a zone: the alert card does not ask for a commune first.
  assert.equal(feedAlertReady({ zone }), true);
  assert.equal(feedAlertReady({}), false);
});

test('the alert sweeps re-run a saved search with the same parser, so a zone narrows alerts too', () => {
  for (const file of ['lib/searchAlertSweep.js', 'lib/instantMatchSweep.js']) {
    const src = read(file);
    assert.match(src, /parseListingsSearchParams\(new URLSearchParams\(search\.query\)\)/, file);
    assert.match(src, /getListings\(\{ \.\.\.filters, ids: candidateIds/, file);
  }
  // A saved search keeps the zone and its box: neither is "not a criterion".
  const rules = read('lib/feedAlertRules.js');
  assert.doesNotMatch(rules.match(/const NOT_A_CRITERION = (.*);/)[1], /zone|sw_lat/);
});
