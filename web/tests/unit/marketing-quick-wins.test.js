import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { feedRequestHref, feedRequestIndex, guestRequestPrefill } from '@/lib/guestRequestRules';
import { agentTrustFacts } from '@/lib/agentTrustRules';
import { landingIndexable, MIN_NARROW_LANDING_LISTINGS, parseSeoSegments } from '@/lib/seoPages';
import { llmsTxt } from '@/lib/llmsTxt';
import { isAdLanding } from '@/lib/adLanding';
import { organizationSchema } from '@/lib/seoSchema';
import { listingJsonLd } from '@/lib/listingSeo';

/**
 * 2026-11-21 marketing plan, first fixes: the "Pas encore trouvé ?" card in
 * the /listings feed, the three-field sign-up as the default, trust facts
 * beside the agent, thin landing pages out of the index, honest sitemap
 * dates, landing preview photos, Organization schema, /llms.txt, and ad
 * landings no longer counted as searches.
 */

// Line endings normalised: a Windows checkout may hold CRLF.
const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const fr = JSON.parse(read('lib/i18n/fr.json'));
const en = JSON.parse(read('lib/i18n/en.json'));

test('the feed card links to /trouver-pour-moi with the parts of the search the form can hold', () => {
  assert.equal(feedRequestHref({}), '/trouver-pour-moi');
  const href = feedRequestHref({
    transaction_type: 'location', commune: 'Limete', property_type: 'Appartement', price_max: '600.4', beds_min: '2',
    ville: 'toutes', utm_source: 'fb', sort: 'price_asc',
  });
  assert.equal(href, '/trouver-pour-moi?transaction_type=location&commune=Limete&property_type=appartement&price_max=600&beds_min=2');
  // Values the form would refuse are left out, never guessed.
  assert.equal(feedRequestHref({ transaction_type: 'echange', property_type: 'villa', price_max: '-5', beds_min: '40' }), '/trouver-pour-moi');
  // The form re-checks what arrives (an unknown commune stays blank).
  const prefill = guestRequestPrefill(Object.fromEntries(new URL(`https://x${href}`).searchParams), ['Limete', 'Gombe']);
  assert.equal(prefill.commune, 'Limete');
  assert.equal(prefill.bedrooms, '2');
});

test('the feed card comes after the 6th card, or the last of a shorter first page, once', () => {
  assert.equal(feedRequestIndex(12), 5);
  assert.equal(feedRequestIndex(6), 5);
  assert.equal(feedRequestIndex(3), 2);
  assert.equal(feedRequestIndex(0), -1);
  const view = read('components/ListingsSplitView.js');
  assert.match(view, /page === 1 && i === requestIndex \? <FeedRequestCard/);
  for (const dict of [fr, en]) {
    for (const key of ['feedRequestTitle', 'feedRequestBody', 'feedRequestCta']) assert.ok(dict.listings.results[key], key);
  }
});

test('trust facts are only what the database proves, never a negative', () => {
  assert.deepEqual(agentTrustFacts({}), []);
  assert.deepEqual(agentTrustFacts({ agentPhone: '243900000001', liveCount: 23, closedCount: 0 }), [
    { key: 'phoneVerified' },
    { key: 'live', count: 23 },
  ]);
  assert.deepEqual(agentTrustFacts({ agentPhone: '  ', liveCount: '1', closedCount: 4 }), [
    { key: 'live', count: 1 },
    { key: 'closed', count: 4 },
  ]);
  for (const dict of [fr, en]) {
    const trust = dict.listings.detail.agentTrust;
    assert.ok(trust.phoneVerified && trust.live.one && trust.live.other && trust.closed.other);
  }
  assert.match(read('components/listings/ListingAgentRow.js'), /<AgentTrustLine listing=\{listing\}/);
  assert.match(read('app/(site)/listings/[id]/page.js'), /<AgentTrustLine listing=\{listing\}/);
});

test('sign-up opens on the three-field form; the questionnaire only with ?projet=1', () => {
  const page = read('app/(site)/compte/inscription/page.js');
  assert.match(page, /if \(params\.projet === '1' && params\.direct !== '1'\)/);
  assert.doesNotMatch(fr.auth.invite.free, /confirmé par WhatsApp/);
  assert.doesNotMatch(en.auth.invite.free, /confirmed on WhatsApp/);
});

test('a type in one place is indexed from 3 listings; communes and cities from 1', () => {
  assert.equal(MIN_NARROW_LANDING_LISTINGS, 3);
  const typeCommune = parseSeoSegments('vente', ['fermes', 'masina']);
  assert.equal(landingIndexable(typeCommune, 2), false);
  assert.equal(landingIndexable(typeCommune, 3), true);
  const typeCity = parseSeoSegments('location', ['immeubles', 'lubumbashi']);
  assert.equal(landingIndexable(typeCity, 1), false);
  assert.equal(landingIndexable(parseSeoSegments('location', ['gombe']), 1), true);
  assert.equal(landingIndexable(parseSeoSegments('location', ['lubumbashi']), 1), true);
  assert.equal(landingIndexable(parseSeoSegments('location', ['appartements']), 1), true);
  assert.equal(landingIndexable(parseSeoSegments('location', []), 0), false);
  const landing = read('components/seo/SeoLandingPage.js');
  assert.match(landing, /robots: landingIndexable\(page, total\)/);
  assert.match(landing, /images: \[\{ url: cover, alt: heading \}\]/);
});

test('the sitemap never stamps a page with the time of the request', () => {
  const sitemap = read('app/sitemap.js');
  assert.doesNotMatch(sitemap, /lastModified: now/);
  assert.doesNotMatch(sitemap, /const now = new Date\(\)/);
});

test('Lukka Place is an Organization; the listing names its agent as the offerer', () => {
  assert.equal(organizationSchema()['@type'], 'Organization');
  const t = Object.assign((key) => key, { locale: 'fr' });
  const ld = listingJsonLd({
    id: 293, title: 'Bel appartement', purpose: 'rent', price: 1100, price_period: 'mois', category_name: 'Appartement',
    commune: 'Gombe', agency_name: 'Jossy', agent_id: 113, created_at: '2026-11-01T00:00:00Z',
  }, t);
  const listing = ld['@graph'][0];
  assert.equal(listing.provider.name, 'Lukka Place');
  assert.equal(listing.offers.offeredBy.name, 'Jossy');
  assert.match(listing.offers.offeredBy.url, /\/agents\/113$/);
  const phoneName = listingJsonLd({ id: 2, title: 'x', purpose: 'rent', price: 300, agency_name: '243900000001', agent_id: 9 }, t);
  assert.equal(phoneName['@graph'][0].offers.offeredBy, undefined, 'a number is never a name');
});

test('/llms.txt lists the real pages and the price guides it is given', () => {
  const text = llmsTxt({
    base: 'https://lukkaplace.com/',
    priceGuides: [{ slug: '2-chambres-limete', commune: 'Limete', beds: 2 }, { slug: null, commune: 'X' }],
  });
  assert.match(text, /^# Lukka Place\n/);
  assert.match(text, /\(https:\/\/lukkaplace\.com\/combien-coute\/2-chambres-limete\)/);
  assert.match(text, /pas une agence/);
  assert.equal((text.match(/combien-coute\//g) || []).length, 1);
  assert.match(read('app/llms.txt/route.js'), /getPriceGuides\(\)/);
});

test('an ad landing is not a search', () => {
  assert.equal(isAdLanding({ transaction_type: 'location', utm_source: 'fb' }), true);
  assert.equal(isAdLanding({ fbclid: 'abc' }), true);
  assert.equal(isAdLanding({ utm_source: ['ig'] }), true);
  assert.equal(isAdLanding({ transaction_type: 'location', commune: 'Gombe' }), false);
  assert.equal(isAdLanding({ utm_source: '  ' }), false);
  const page = read('app/(site)/listings/(search)/(results)/page.js');
  assert.match(page, /page === 1 && !mapArea && !adLanding && SEARCH_LOG_KEYS/);
});

test('the WhatsApp sheet logs open and choose; lead-click logs every answered tap', async () => {
  const { sanitizeWaSheetEvent, userAgentKind } = await import('@/lib/waSheetRules');
  assert.deepEqual(sanitizeWaSheetEvent({ step: 'open', placement: 'listing_mobile_bar', listingId: '1272' }), {
    step: 'open', placement: 'listing_mobile_bar', listingId: 1272,
  });
  assert.deepEqual(sanitizeWaSheetEvent({ step: 'choose', placement: 'x<script>', listingId: 'abc' }), {
    step: 'choose', placement: null, listingId: null,
  });
  assert.equal(sanitizeWaSheetEvent({ step: 'hack' }), null);
  assert.equal(sanitizeWaSheetEvent(null), null);
  assert.equal(userAgentKind('Mozilla/5.0 (Linux; Android 12) [FBAN/EMA;FBAV/400.0]'), 'fb_inapp');
  assert.equal(userAgentKind('Mozilla/5.0 Instagram 300.0'), 'ig_inapp');
  assert.equal(userAgentKind('Mozilla/5.0 (Linux; Android 13; wv) Chrome/120'), 'webview');
  assert.equal(userAgentKind('Mozilla/5.0 (Linux; Android 13) Chrome/120 Mobile'), 'browser');
  const sheet = read('components/WhatsAppIntentSheet.js');
  assert.match(sheet, /show\(true\);\n\s+trackWhatsAppSheet\('open', listing, placement\);/);
  assert.match(sheet, /trackWhatsAppSheet\('choose', listing, placement\);\n\s+trackLeadClick\(/);
  assert.match(read('app/api/telemetry/lead-click/route.js'), /console\.log\(`\[lead-click\] /);
});

test('on the listing page the WhatsApp trigger is a real link before hydration', () => {
  const sheet = read('components/WhatsAppIntentSheet.js');
  assert.match(sheet, /<a href=\{href\} target="_blank" rel="noopener noreferrer" onClick=\{onTrigger\}/);
  assert.match(sheet, /function onTrigger\(event\) \{\n\s+event\.preventDefault\(\);/);
  assert.match(read('components/MobileListingBar.js'), /placement="listing_mobile_bar"\n\s+standalone/);
  assert.match(read('components/EnquiryCard.js'), /placement=\{placement \?\? undefined\}\n\s+standalone/);
  // Cards sit inside a card link: they keep the <button> (no <a> in an <a>).
  assert.doesNotMatch(read('components/WhatsAppCTA.js'), /standalone/);
});
