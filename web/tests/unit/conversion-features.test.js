import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  GUEST_REQUEST_TYPES,
  createLimiter,
  guestRequestPrefill,
  guestTypeSummary,
  parseGuestRequest,
} from '@/lib/guestRequestRules';
import { LISTING_VIEWERS_SQL, MIN_INTEREST_SHOWN, interestToShow } from '@/lib/listingInterest';
import { META_FEED_COLUMNS, metaFeedCsv, metaFeedItem, metaPropertyType } from '@/lib/metaHomeListingsFeed';
import { AD_EVENTS, TIKTOK_EVENT_NAME } from '@/lib/adTrackingRules';

/**
 * 2026-11-04 conversion pass: the no-account request ("Trouver pour moi"),
 * the "N personnes ont consulté ce bien" line, and the Meta home listings
 * catalogue feed.
 */

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const COMMUNES = ['Gombe', 'Limete', 'Ngaliema'];

// --- guest request ---------------------------------------------------------

test('a guest request needs a transaction and a commune from the server list', () => {
  assert.deepEqual(parseGuestRequest({ commune: 'Gombe' }, COMMUNES), { ok: false, error: 'transaction' });
  assert.deepEqual(parseGuestRequest({ transactionType: 'location', commune: 'Atlantis' }, COMMUNES), { ok: false, error: 'commune' });
  const ok = parseGuestRequest({ transactionType: 'location', commune: 'gombe' }, COMMUNES);
  assert.equal(ok.ok, true);
  assert.equal(ok.request.commune, 'Gombe');
  assert.equal(ok.request.budgetMax, null);
  assert.equal(ok.request.bedrooms, null);
  assert.equal(ok.request.propertyType, null);
});

test('budget, bedrooms, type and name are bounded, never guessed', () => {
  const r = parseGuestRequest(
    { transactionType: 'vente', commune: 'Limete', budgetMax: '80 000 $', bedrooms: '3', propertyType: 'maison', name: '  Jean   Kabeya ' },
    COMMUNES,
  ).request;
  assert.equal(r.budgetMax, 80000);
  assert.equal(r.bedrooms, 3);
  assert.equal(r.propertyType, 'maison');
  assert.equal(r.name, 'Jean Kabeya');
  assert.deepEqual(parseGuestRequest({ transactionType: 'location', commune: 'Gombe', budgetMax: 'cher' }, COMMUNES), { ok: false, error: 'budget' });
  const odd = parseGuestRequest({ transactionType: 'location', commune: 'Gombe', bedrooms: '40', propertyType: 'chateau' }, COMMUNES).request;
  assert.equal(odd.bedrooms, null);
  assert.equal(odd.propertyType, null);
  for (const type of GUEST_REQUEST_TYPES) assert.ok(guestTypeSummary(type));
});

test('the form is prefilled only with values it can hold, from the empty search', () => {
  assert.deepEqual(
    guestRequestPrefill({ transaction_type: 'vente', commune: 'ngaliema', price_max: '120000', beds_min: '2', property_type: 'Maison' }, COMMUNES),
    { transactionType: 'vente', commune: 'Ngaliema', propertyType: 'maison', budgetMax: '120000', bedrooms: '2' },
  );
  assert.deepEqual(
    guestRequestPrefill({ commune: 'Atlantis', price_max: '0', property_type: 'duplex' }, COMMUNES),
    { transactionType: 'location', commune: '', propertyType: '', budgetMax: '', bedrooms: '' },
  );
});

test('the limiter counts per key inside its window', () => {
  const limited = createLimiter({ max: 2, windowMs: 1000 });
  assert.equal(limited('a', 0), false);
  assert.equal(limited('a', 10), false);
  assert.equal(limited('a', 20), true);
  assert.equal(limited('b', 20), false);
  assert.equal(limited('a', 1500), false);
});

test('the action guards before it creates a lead, and the empty search no longer sends guests to a login', () => {
  const action = read('../../app/(site)/trouver-pour-moi/actions.js');
  const create = action.indexOf('await createLead(');
  for (const guard of ["formData.get('website')", 'phoneFromForm(formData)', 'parseGuestRequest(', 'ipLimited(']) {
    const at = action.indexOf(guard);
    assert.ok(at > -1 && at < create, `${guard} must run before createLead`);
  }
  assert.match(action, /source: GUEST_REQUEST_SOURCE/);
  assert.match(action, /name: 'Lead'/);

  const empty = read('../../components/ListingsEmptyState.js');
  assert.match(empty, /<GuestRequestForm/);
  assert.match(read('../../components/GuestRequestForm.js'), /name="website"/);
});

test('Lead is a known ad event on both platforms', () => {
  assert.ok(AD_EVENTS.includes('Lead'));
  assert.equal(TIKTOK_EVENT_NAME.Lead, 'SubmitForm');
});

// --- recent viewers --------------------------------------------------------

test('the viewer count is people, visitors only, last 7 days, shown as counted from 1', () => {
  assert.match(LISTING_VIEWERS_SQL, /COUNT\(DISTINCT visitor_id\)/);
  assert.match(LISTING_VIEWERS_SQL, /listing_id = \$1/);
  assert.match(LISTING_VIEWERS_SQL, /INTERVAL '7 days'/);
  assert.match(LISTING_VIEWERS_SQL, /COALESCE\(viewer_kind, 'visitor'\) = 'visitor'/);
  assert.match(LISTING_VIEWERS_SQL, /<> 'bot'/);
  assert.equal(MIN_INTEREST_SHOWN, 1);
  assert.equal(interestToShow(0), null);
  assert.equal(interestToShow(1), 1);
  assert.equal(interestToShow(4), 4);
  assert.equal(interestToShow(null), null);
  assert.equal(interestToShow('x'), null);
});

// --- Meta catalogue feed ---------------------------------------------------

const BASE = {
  id: 310,
  title: 'Appartement 2 chambres à Gombe',
  description: 'Bel appartement,\n eau et électricité.',
  purpose: 'rent',
  price: '1300',
  price_period: 'mois',
  category_name: 'Appartement',
  category_type: 'residential',
  featured_image: '/uploads/a.jpg',
  gallery: ['https://cdn.example/b.jpg', '/uploads/a.jpg'],
  beds: 2,
  bath: 2,
  quartier: 'Golf',
  commune: 'Gombe',
  city_name: 'Kinshasa',
  latitude: '-4.30791234',
  longitude: '15.31234567',
  listing_status: 'active',
};

test('a public rental becomes a home listing item with a blurred point', () => {
  const item = metaFeedItem(BASE);
  assert.equal(item.home_listing_id, '310');
  assert.equal(item.availability, 'for_rent');
  assert.equal(item.listing_type, 'for_rent_by_agent');
  assert.equal(item.property_type, 'apartment');
  assert.equal(item.price, '1300 USD');
  assert.equal(item.latitude, '-4.31');
  assert.equal(item.longitude, '15.31');
  assert.match(item['image[0].url'], /^https:\/\/.+\/uploads\/a\.jpg$/);
  assert.equal(item['image[1].url'], 'https://cdn.example/b.jpg');
  assert.match(item.url, /\/listings\/310\?utm_source=facebook&utm_medium=catalogue$/);
  assert.equal(item.description, 'Bel appartement, eau et électricité.');
  assert.equal(item['address.country'], 'CD');
});

test('anything we cannot stand behind is left out, never filled in', () => {
  assert.equal(metaFeedItem({ ...BASE, price_period: 'jour' }), null);
  assert.equal(metaFeedItem({ ...BASE, price_period: 'an' }), null);
  assert.equal(metaFeedItem({ ...BASE, price: '0' }), null);
  assert.equal(metaFeedItem({ ...BASE, listing_status: 'under_offer' }), null);
  assert.equal(metaFeedItem({ ...BASE, featured_image: 'default.jpg', gallery: [] }), null);
  assert.equal(metaFeedItem({ ...BASE, category_type: 'commercial', category_name: 'Bureau' }), null);
  assert.equal(metaFeedItem({ ...BASE, latitude: null, longitude: null, commune: null }), null);
  // No stored point: the commune's verified centroid, still rounded.
  const centroid = metaFeedItem({ ...BASE, latitude: null, longitude: null });
  assert.match(centroid.latitude, /^-4\.\d{2}$/);
  assert.equal(metaFeedItem({ ...BASE, purpose: 'sale', price_period: null }).availability, 'for_sale');
  assert.equal(metaPropertyType({ category_name: 'Villa' }), 'house');
  assert.equal(metaPropertyType({ category_name: 'Terrain' }), 'land');
});

test('the CSV quotes every field and neutralises formula starts', () => {
  const csv = metaFeedCsv([{ ...metaFeedItem(BASE), name: '=HYPERLINK("x")' }]);
  const [header, row] = csv.trim().split('\r\n');
  assert.equal(header, META_FEED_COLUMNS.map((c) => `"${c}"`).join(','));
  assert.ok(row.startsWith('"310","\'=HYPERLINK(""x"")"'));
});

test('one viewer reads in the singular in both languages', () => {
  const fr = JSON.parse(read('../../lib/i18n/fr.json')).listings.detail.recentViewers;
  const en = JSON.parse(read('../../lib/i18n/en.json')).listings.detail.recentViewers;
  assert.match(fr.one, /personne a consulté/);
  assert.match(fr.other, /personnes ont consulté/);
  assert.match(en.one, /person viewed/);
});

test('Meta listing events carry the catalogue item type', () => {
  assert.match(read('../../lib/adEvents.js'), /content_type = 'home_listing'/);
  assert.match(read('../../lib/adServerEvents.js'), /content_type = 'home_listing'/);
});
