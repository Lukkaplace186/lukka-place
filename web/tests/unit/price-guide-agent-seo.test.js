import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import {
  formatGuideDay, guideAlertQuery, guideForListing, guidesForCommune, guidesUpdatedOn,
  priceGuideDatasetJsonLd, priceGuideIndexJsonLd,
} from '@/lib/priceGuideSeo';
import { agentMetaDescription, agentOgImage, agentPlaceList, agentSitemapEntries } from '@/lib/agentProfileSeo';
import { BLENDED_GUIDES_SQL, LUKKA_ONLY_GUIDES_SQL, LUKKA_RENTS_SQL, MARKET_RENTS_SQL, UPDATED_ON_SQL } from '@/lib/marketGuide';
import { getPriceGuides } from '@/lib/browseFeatures';
import { SITEMAP_AGENTS_SQL } from '@/lib/agencies';
import { PROMPT_ENTRIES, SIGNUP_ENTRIES, entryForPromptTrigger } from '@/lib/signupFunnelRules';
import { createTranslator } from '@/lib/i18n/translate';
import { calls, enqueue, reset } from '../support/fakePool.js';

/**
 * 2026-11-21 marketing plan: the price guide gets a real "Mis à jour le",
 * Dataset structured data, a share image, links from the landing pages, the
 * listing page and the footer, and an alert with the `price_guide` sign-up
 * entry; agent profiles get a factual description, a share image and a place
 * in the sitemap. web/CLAUDE.md, "Price guide and agent profile SEO".
 */

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const exists = (path) => existsSync(new URL(`../../${path}`, import.meta.url));
const fr = JSON.parse(read('lib/i18n/fr.json'));
const en = JSON.parse(read('lib/i18n/en.json'));
const squash = (sql) => sql.replace(/\s+/g, ' ');
const tFr = createTranslator({ locale: 'fr', messages: fr });
const tEn = createTranslator({ locale: 'en', messages: en });
const noComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

beforeEach(() => reset());

const GUIDE = { commune: 'Gombe', beds: 2, listings: 12, lukkaListings: 4, median: 900, p25: 700, p75: 1200, slug: '2-chambres-gombe', updatedOn: '2026-11-20' };

// ---------------------------------------------------------------------------
// 1. A real date, from the data
// ---------------------------------------------------------------------------

test('the guide date is the newest seen_at behind the pair, on the Kinshasa calendar — never the request clock', () => {
  assert.match(UPDATED_ON_SQL, /MAX\(seen_at\) AT TIME ZONE 'Africa\/Kinshasa'/);
  assert.doesNotMatch(UPDATED_ON_SQL, /NOW\(\)|CURRENT_/);
  // Lukka rows: the day they went public; observations: last confirmed online.
  assert.match(squash(LUKKA_RENTS_SQL), /GREATEST\(p\.created_at, COALESCE\(\(to_jsonb\(p\) ->> 'moderated_at'\)::timestamptz, p\.created_at\)\)::timestamptz AS seen_at/);
  assert.match(squash(MARKET_RENTS_SQL), /o\.last_seen_at::timestamptz AS seen_at/);
  // Both the blended query and the pre-migration fallback return it.
  assert.ok(BLENDED_GUIDES_SQL.includes(`${UPDATED_ON_SQL} AS updated_on`));
  assert.match(squash(BLENDED_GUIDES_SQL), /LEFT JOIN fresh f ON f\.commune = s\.commune AND f\.beds = s\.beds/);
  assert.ok(LUKKA_ONLY_GUIDES_SQL.includes(`${UPDATED_ON_SQL} AS updated_on`));
  // The public gate is untouched.
  assert.match(squash(LUKKA_RENTS_SQL), /p\.status = 1 AND p\.approve_status = 1/);
});

test('getPriceGuides carries updated_on through as updatedOn, null when absent', async () => {
  enqueue([
    { commune: 'Gombe', beds: 2, listings: 12, median: 900.4, p25: 700, p75: 1200, lukka_listings: 4, sources: {}, updated_on: '2026-11-20' },
    { commune: 'Limete', beds: 1, listings: 6, median: 300, p25: 250, p75: 350, lukka_listings: 6, sources: {}, updated_on: null },
  ]);
  const guides = await getPriceGuides();
  assert.equal(calls.length, 1);
  assert.equal(guides[0].updatedOn, '2026-11-20');
  assert.equal(guides[0].slug, '2-chambres-gombe');
  assert.equal(guides[0].median, 900);
  assert.equal(guides[1].updatedOn, null);
});

test('the index date is the newest guide date; a day prints the same on every clock', () => {
  assert.equal(guidesUpdatedOn([{ updatedOn: '2026-11-18' }, { updatedOn: '2026-11-20' }, { updatedOn: null }, { updatedOn: 'nope' }]), '2026-11-20');
  assert.equal(guidesUpdatedOn([]), null);
  assert.equal(formatGuideDay('2026-11-20', 'fr'), '20 novembre 2026');
  assert.equal(formatGuideDay('2026-11-20', 'en'), '20 November 2026');
  assert.equal(formatGuideDay(null), null);
  assert.equal(formatGuideDay('2026-13-99'), null);
});

test('the guide pages print "Mis à jour le" from the guide row, never new Date()', () => {
  for (const file of ['app/(site)/combien-coute/[slug]/page.js', 'app/(site)/combien-coute/page.js']) {
    const src = noComments(read(file));
    assert.match(src, /home\.prices\.updated/, file);
    assert.match(src, /formatGuideDay\(/, file);
    assert.doesNotMatch(src, /new Date\(/, file);
    assert.match(src, /<JsonLd data=\{jsonLd\} \/>/, file);
  }
  assert.match(fr.home.prices.updated, /^Mis à jour le \{date\}$/);
  assert.match(en.home.prices.updated, /\{date\}/);
});

// ---------------------------------------------------------------------------
// 1b. Dataset structured data and the share image
// ---------------------------------------------------------------------------

test('a guide page Dataset says only what the page shows', () => {
  const data = priceGuideDatasetJsonLd({
    base: 'https://lukkaplace.com', path: '/combien-coute/2-chambres-gombe', name: 'Combien coûte un 2 chambres à Gombe ?',
    description: 'Loyer médian demandé : 900 $ par mois, sur 12 annonces.', method: 'Prix demandés…', guide: GUIDE,
    place: 'Gombe', city: 'Kinshasa', updatedOn: '2026-11-20',
  });
  assert.equal(data['@type'], 'Dataset');
  assert.equal(data.url, 'https://lukkaplace.com/combien-coute/2-chambres-gombe');
  assert.equal(data.creator['@id'], 'https://lukkaplace.com/#organization');
  assert.equal(data.dateModified, '2026-11-20');
  assert.equal(data.measurementTechnique, 'Prix demandés…');
  assert.equal(data.spatialCoverage.name, 'Gombe, Kinshasa');
  assert.equal(data.spatialCoverage.address.addressCountry, 'CD');
  const [median, count] = data.variableMeasured;
  assert.equal(median.value, 900);
  assert.equal(median.unitText, 'USD par mois');
  assert.equal(median.minValue, 700);
  assert.equal(median.maxValue, 1200);
  assert.equal(count.value, 12);
  // No file to download: no distribution claimed.
  assert.equal('distribution' in data, false);
  // No date in the data → no dateModified, never today.
  assert.equal('dateModified' in priceGuideDatasetJsonLd({ base: 'https://x', path: '/p', name: 'n', description: 'd', guide: GUIDE, place: 'Gombe', updatedOn: null }), false);
});

test('the index Dataset lists each guide page as a part, with its cities', () => {
  const data = priceGuideIndexJsonLd({
    base: 'https://lukkaplace.com', path: '/combien-coute', name: 'Combien coûte un logement ?', description: 'Loyers…',
    method: 'm', cities: ['Kinshasa'], updatedOn: '2026-11-20',
    guides: [{ slug: '2-chambres-gombe', name: 'Q', description: 'A' }],
  });
  assert.equal(data.hasPart[0].url, 'https://lukkaplace.com/combien-coute/2-chambres-gombe');
  assert.equal(data.hasPart[0].description, 'A');
  assert.equal(data.spatialCoverage[0].address.addressLocality, 'Kinshasa');
  assert.equal(data.dateModified, '2026-11-20');
});

test('guide pages have their own share image (og + twitter), 404 for an unknown guide', () => {
  assert.ok(exists('app/(site)/combien-coute/[slug]/opengraph-image.js'));
  assert.ok(exists('app/(site)/combien-coute/[slug]/twitter-image.js'));
  const og = read('app/(site)/combien-coute/[slug]/opengraph-image.js');
  assert.match(og, /getPriceGuide\(slug\)/);
  assert.match(og, /notFound\(\)/);
  assert.match(og, /await params/);
});

// ---------------------------------------------------------------------------
// 2. Links to the guide
// ---------------------------------------------------------------------------

test('a commune links only to its own published guides, fewest bedrooms first', () => {
  const guides = [{ ...GUIDE, beds: 3, slug: '3-chambres-gombe' }, GUIDE, { ...GUIDE, commune: 'Limete', slug: '2-chambres-limete' }];
  assert.deepEqual(guidesForCommune(guides, 'Gombe').map((g) => g.slug), ['2-chambres-gombe', '3-chambres-gombe']);
  assert.deepEqual(guidesForCommune(guides, 'Ngaliema'), []);
  assert.deepEqual(guidesForCommune(guides, null), []);
});

test('a listing links the guide of its commune × bedrooms, long-term rentals only', () => {
  const guides = [GUIDE];
  assert.equal(guideForListing(guides, { purpose: 'rent', commune: 'Gombe', beds: '2', price_period: 'mois' }), GUIDE);
  assert.equal(guideForListing(guides, { purpose: 'rent', commune: 'Gombe', beds: 2, price_period: 'an' }), GUIDE);
  assert.equal(guideForListing(guides, { purpose: 'sale', commune: 'Gombe', beds: 2 }), null);
  assert.equal(guideForListing(guides, { purpose: 'rent', commune: 'Gombe', beds: 2, price_period: 'jour' }), null);
  assert.equal(guideForListing(guides, { purpose: 'rent', commune: 'Gombe', beds: 3 }), null);
  assert.equal(guideForListing(guides, { purpose: 'rent', commune: null, beds: 2 }), null);
});

test('landing pages, the listing median line and the footer link the guide', () => {
  const landing = read('components/seo/SeoLandingPage.js');
  assert.match(landing, /cachedPriceGuides\(\)/);
  assert.match(landing, /guidesForCommune\(priceGuides, page\.commune\)/);
  assert.match(landing, /href=\{`\/combien-coute\/\$\{guide\.slug\}`\}/);
  assert.match(landing, /<PriceGuideLinks /);
  const line = read('components/listings/MarketMedianLine.js');
  assert.match(line, /guideForListing\(guides, listing\)/);
  assert.match(line, /href=\{`\/combien-coute\/\$\{guide\.slug\}`\}/);
  // The owner's hidden median stays hidden: the threshold still gates it.
  assert.match(line, /live >= MARKET_MEDIAN_MIN_LIVE_LISTINGS \? await getMarketPosition/);
  const footer = read('components/Footer.js');
  assert.match(footer, /\{ labelKey: 'footer.links.rentPrices', href: '\/combien-coute' \}/);
  assert.equal(fr.footer.links.rentPrices, 'Prix des loyers');
});

// ---------------------------------------------------------------------------
// 3. The alert, honest about what it sends
// ---------------------------------------------------------------------------

test('the guide alert saves the guide search (rentals, commune, bedrooms floor), with ville outside Kinshasa', () => {
  assert.equal(guideAlertQuery({ commune: 'Gombe', beds: 2, city: 'Kinshasa' }), 'transaction_type=location&commune=Gombe&beds_min=2&lease_term=long');
  assert.equal(guideAlertQuery({ commune: 'Annexe', beds: 1, city: 'Lubumbashi' }), 'transaction_type=location&ville=Lubumbashi&commune=Annexe&beds_min=1&lease_term=long');
  assert.equal(guideAlertQuery({ commune: '', beds: 2 }), null);
  assert.equal(guideAlertQuery({ commune: 'Gombe', beds: 0 }), null);
});

test('the guide alert goes through the existing alert button with the price_guide sign-up entry', () => {
  assert.ok(SIGNUP_ENTRIES.includes('price_guide'));
  assert.ok(PROMPT_ENTRIES.has('price_guide'));
  assert.equal(entryForPromptTrigger('price_guide'), 'price_guide');
  const page = read('app/(site)/combien-coute/[slug]/page.js');
  assert.match(page, /<QueryAlertButton query=\{alertQuery\}[^>]*trigger="price_guide"/);
  const button = read('components/QueryAlertButton.js');
  assert.match(button, /trigger = 'alert'/);
  assert.match(button, /trigger=\{trigger\}/);
  assert.match(read('components/AuthPromptModal.js'), /price_guide: 'listings\.authPrompt\.alert'/);
});

test('the alert copy promises new listings, not a price report', () => {
  for (const dict of [fr, en]) {
    const p = dict.home.prices;
    for (const text of [p.alertButton, p.alertLead.one, p.alertLead.other]) {
      assert.doesNotMatch(text, /prix|price|rapport|report|chaque mois|every month|monthly/i, text);
    }
  }
  assert.match(fr.home.prices.alertLead.other, /nouvelles locations d’au moins \{count\} chambres à \{commune\}/);
  assert.match(fr.home.prices.alertNote, /pas un rapport de prix/);
  assert.match(en.home.prices.alertNote, /not a price report/);
});

// ---------------------------------------------------------------------------
// 4. Agent profiles
// ---------------------------------------------------------------------------

// The communes are the ones the agent declared (coverage), not where each
// listing is: the sentence keeps the two facts apart.
test('the agent description is built from the name, communes and live count', () => {
  assert.equal(
    agentMetaDescription({ name: 'Joker Agency', liveCount: 12, communes: ['Gombe', 'Ngaliema'], t: tFr, locale: 'fr' }),
    'Joker Agency sur Lukka Place : 12 biens en ligne à louer ou à vendre. Intervient à Gombe et Ngaliema.',
  );
  assert.equal(
    agentMetaDescription({ name: 'Joker Agency', liveCount: 1, communes: ['Gombe', 'Limete', 'Lemba', 'Kintambo', 'Bandalungwa'], t: tFr, locale: 'fr' }),
    'Joker Agency sur Lukka Place : 1 bien en ligne à louer ou à vendre. Intervient à Gombe, Limete, Lemba et 2 autres communes.',
  );
  assert.equal(
    agentMetaDescription({ name: 'Joker Agency', liveCount: 3, communes: [], t: tEn, locale: 'en' }),
    'Joker Agency on Lukka Place: 3 properties listed for rent or sale.',
  );
  // A phone number is never printed as a name; no listing, no count claimed.
  const phone = agentMetaDescription({ name: '243812345678', liveCount: 0, communes: ['Gombe'], t: tFr, locale: 'fr' });
  assert.ok(phone.startsWith('Une agence sur Lukka Place'));
  assert.doesNotMatch(phone, /\d{6}/);
  assert.equal(agentPlaceList([], {}), null);
});

test('the agent share image: logo, else a listing photo, else none (the site default)', () => {
  assert.equal(agentOgImage({ logo: 'https://cdn.example/logo.png', listingPhoto: 'https://cdn.example/p.jpg' }), 'https://cdn.example/logo.png');
  assert.equal(agentOgImage({ logo: null, listingPhoto: 'https://cdn.example/p.jpg' }), 'https://cdn.example/p.jpg');
  assert.equal(agentOgImage({ logo: '/relative.png' }), null);
  assert.equal(agentOgImage({}), null);
  const page = read('app/(portfolio)/agents/[id]/page.js');
  assert.match(page, /generateMetadata\(\{ params \}, parent\)/);
  assert.match(page, /agentMetaDescription\(/);
  assert.match(page, /agentOgImage\(\{ logo: agent\.image \}\)/);
  assert.match(page, /inherited\?\.openGraph\?\.images/);
  assert.doesNotMatch(page, /description: agent\.bio/);
});

test('the sitemap lists agents with a public live listing, never a demo, test or deleted account', () => {
  const sql = squash(SITEMAP_AGENTS_SQL);
  assert.match(sql, /a\.status = 1 AND a\.deleted_at IS NULL/);
  assert.match(sql, /COALESCE\(a\.phone, ''\) NOT LIKE '2430000%'/);
  assert.match(sql, /'is_test'\)::boolean, false\) = false/);
  assert.match(sql, /p\.status = 1 AND p\.approve_status = 1/);
  assert.match(sql, /p\.listing_status IS DISTINCT FROM 'closed'/);
  const sitemap = read('app/sitemap.js');
  assert.match(sitemap, /getSitemapAgents\(\)/);
  assert.match(sitemap, /agentSitemapEntries\(agents, base\)/);
});

test('agent sitemap entries carry a real date or none, once per agent', () => {
  const entries = agentSitemapEntries([
    { id: 7, last_listing_at: '2026-11-19T10:00:00Z' },
    { id: 7, last_listing_at: '2026-11-20T10:00:00Z' },
    { id: 9, last_listing_at: null },
    { id: 'x' },
    { id: 11, last_listing_at: 'garbage' },
  ], 'https://lukkaplace.com');
  assert.deepEqual(entries.map((e) => e.url), ['https://lukkaplace.com/agents/7', 'https://lukkaplace.com/agents/9', 'https://lukkaplace.com/agents/11']);
  assert.equal(entries[0].lastModified.toISOString(), '2026-11-19T10:00:00.000Z');
  assert.equal('lastModified' in entries[1], false);
  assert.equal('lastModified' in entries[2], false);
});

test('every new key exists in both dictionaries', () => {
  const keys = [
    'home.prices.updated', 'home.prices.updatedNote', 'home.prices.alertTitle', 'home.prices.alertLead', 'home.prices.alertButton',
    'home.prices.alertNote', 'seo.priceGuidesLead', 'seo.priceGuideLink', 'seo.priceGuideIndex', 'listings.marketMedian.guide',
    'footer.links.rentPrices', 'agent.portfolio.metaDescription', 'agent.portfolio.metaDescriptionNoPlace',
    'agent.portfolio.metaDescriptionEmpty', 'agent.portfolio.metaMoreCommunes', 'agent.portfolio.metaUnnamed',
  ];
  const get = (dict, key) => key.split('.').reduce((node, part) => node?.[part], dict);
  for (const key of keys) {
    assert.ok(get(fr, key), `fr ${key}`);
    assert.ok(get(en, key), `en ${key}`);
  }
});
