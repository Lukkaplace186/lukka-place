import test from 'node:test';
import assert from 'node:assert/strict';
import { COMPARE_FIELDS, compareHref, compareToFirst, photoSet, sameValue } from '@/lib/listingCompare';
import { COMPARE_MAX, compareState, parseCompareIds } from '@/lib/adminListings';
import { DUPLICATE_IDS_SQL, DUPLICATE_LINK_LIMIT } from '@/lib/moderationQueue';

const base = {
  id: 801, title: '2 chambres — Appartement à louer à Limete', price: '400', purpose: 'rent', price_period: 'mois',
  reference: 'Ecole cartésien', commune: 'Limete', quartier: 'Industriel', beds: 2, agent_id: 12,
  featured_image: 'https://x/a.jpg', gallery: ['https://x/a.jpg', 'https://x/b.jpg'],
};

test('marks the facts equal to the first listing, ignoring case and outer spaces', () => {
  const twin = { ...base, id: 805, title: ' 2 CHAMBRES — Appartement à louer à Limete', reference: 'lycée Carnot', gallery: ['https://x/b.jpg', 'https://x/c.jpg'], featured_image: 'https://x/c.jpg' };
  const [first, second] = compareToFirst([base, twin]);
  assert.deepEqual(first, { same: [], sharedPhotos: [] });
  assert.deepEqual(second.same, ['title', 'price', 'commune', 'quartier', 'beds', 'agent']);
  assert.deepEqual(second.sharedPhotos, ['https://x/b.jpg']);
});

test('two blanks are not "the same", and a rent is not the same price as a sale', () => {
  assert.equal(sameValue({ reference: null }, { reference: '' }, 'reference'), false);
  assert.equal(sameValue({ price: 400, purpose: 'rent' }, { price: 400, purpose: 'sale' }, 'price'), false);
  assert.equal(sameValue({ price: '400', purpose: 'rent', price_period: 'mois' }, { price: 400, purpose: 'rent', price_period: 'mois' }, 'price'), true);
  assert.equal(sameValue({ agent_id: null }, { agent_id: null }, 'agent'), false);
  assert.ok(COMPARE_FIELDS.includes('reference'));
});

test('photos: featured first, no repeats, no "noimage" placeholder', () => {
  assert.deepEqual(photoSet({ featured_image: 'https://x/a.jpg', gallery: ['https://x/a.jpg', ' ', 'https://x/noimage.png', 'https://x/b.jpg'] }), ['https://x/a.jpg', 'https://x/b.jpg']);
  assert.deepEqual(photoSet({ featured_image: null, gallery: null }), []);
});

test('ids from the URL: positive integers, deduplicated, order kept, capped', () => {
  assert.deepEqual(parseCompareIds('801,#796, 801,abc,-3,0'), [801, 796]);
  assert.deepEqual(parseCompareIds(['805', '801']), [805, 801]);
  assert.equal(parseCompareIds('1,2,3,4,5,6,7,8').length, COMPARE_MAX);
  assert.deepEqual(parseCompareIds(undefined), []);
  assert.equal(compareHref(801, [796, 801, 790]), '/admin/listings/compare?ids=801,796,790');
});

test('the moderation state a compared listing shows', () => {
  assert.equal(compareState({ approve_status: 1, status: 1 }), 'live');
  assert.equal(compareState({ approve_status: 0, status: 1 }), 'pending');
  assert.equal(compareState({ approve_status: 2, status: 0 }), 'rejected');
  assert.equal(compareState({ approve_status: 1, status: 0 }), 'hidden');
  assert.equal(compareState({ approve_status: 1, status: 1, deleted_at: '2026-11-01' }), 'deleted');
});

test('the linked ids use the same rules as the flags, only for flagged rows, capped', () => {
  // Same title (case-insensitive), same price, another listing, not rejected — as f_duplicate_listing.
  assert.match(DUPLICATE_IDS_SQL, /WHEN f\.f_duplicate_listing THEN/);
  assert.match(DUPLICATE_IDS_SQL, /LOWER\(oc\.title\) = LOWER\(f\.title\) AND oc\.property_id <> f\.id/);
  assert.match(DUPLICATE_IDS_SQL, /o\.price = f\.price AND o\.approve_status <> 2/);
  // Photo reuse: the featured image or any gallery image on another listing — as f_duplicate_photo.
  assert.match(DUPLICATE_IDS_SQL, /WHEN f\.f_duplicate_photo THEN/);
  assert.match(DUPLICATE_IDS_SQL, /s2\.image = s1\.image AND s2\.property_id <> s1\.property_id/);
  assert.equal((DUPLICATE_IDS_SQL.match(new RegExp(`LIMIT ${DUPLICATE_LINK_LIMIT}`, 'g')) || []).length, 2);
});
