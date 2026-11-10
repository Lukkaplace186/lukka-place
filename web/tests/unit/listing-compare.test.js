import test from 'node:test';
import assert from 'node:assert/strict';
import { COMPARE_FIELDS, compareHref, compareToFirst, photoSet, sameValue } from '@/lib/listingCompare';
import { COMPARE_MAX, compareState, parseCompareIds } from '@/lib/adminListings';
import {
  DUPLICATE_IDS_SQL, DUPLICATE_INDEX_CTES, DUPLICATE_LINK_LIMIT, FILTERABLE_FLAGS as FLAG_SQL_KEYS, PHOTO_FINGERPRINT_PATTERN,
  SAME_AGENT_MATCH, SAME_MESSAGE_SECONDS, findSameAgentResends,
} from '@/lib/moderationQueue';
import { BLOCKING_FLAGS, DUPLICATE_FLAGS, INFO_FLAGS } from '@/lib/moderation';
import { calls, enqueue, reset } from '../support/fakePool.js';

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
  // Photo reuse by ANOTHER agent, matched on the photo's content fingerprint — as f_duplicate_photo.
  assert.match(DUPLICATE_IDS_SQL, /WHEN f\.f_duplicate_photo THEN/);
  assert.match(DUPLICATE_IDS_SQL, /fp_index x JOIN fp_index o ON o\.fp = x\.fp/);
  assert.match(DUPLICATE_IDS_SQL, /o\.agent_id IS DISTINCT FROM f\.agent_id/);
  // Same agent's re-send — as f_same_agent_resend.
  assert.match(DUPLICATE_IDS_SQL, /WHEN f\.f_same_agent_resend THEN/);
  assert.equal((DUPLICATE_IDS_SQL.match(new RegExp(`LIMIT ${DUPLICATE_LINK_LIMIT}`, 'g')) || []).length, 3);
});

test('same agent, same property: the rule the owner set (2026-11-10)', () => {
  const rule = SAME_AGENT_MATCH('b');
  assert.match(rule, /o\.agent_id = b\.agent_id/);
  // Still on the market, not a hidden or closed copy.
  assert.match(rule, /o\.approve_status IN \(0, 1\) AND o\.status = 1 AND o\.listing_status IS DISTINCT FROM 'closed'/);
  assert.match(rule, /o\.purpose IS NOT DISTINCT FROM b\.purpose/);
  // Another unit of the building (other bedroom count) is not a re-send.
  assert.match(rule, /o\.beds IS NULL OR b\.beds IS NULL OR o\.beds = b\.beds/);
  // Units of one message are created together; a re-send comes later.
  assert.match(rule, new RegExp(`> ${SAME_MESSAGE_SECONDS}`));
  assert.equal(SAME_MESSAGE_SECONDS, 1800);
});

test('photo fingerprints come from the stored name, for WhatsApp and web uploads alike', () => {
  const re = new RegExp(PHOTO_FINGERPRINT_PATTERN);
  assert.equal(re.exec('https://x/properties/746/whatsapp_0a1b2c3d4e5f6_e5.jpg')[1], '0a1b2c3d4e5f6');
  assert.equal(re.exec('https://x/properties/801/agent_abcdefabcdef1.jpg')[1], 'abcdefabcdef1');
  assert.equal(re.exec('https://x/noimage.png'), null);
  // Only live / pending listings feed the index.
  assert.match(DUPLICATE_INDEX_CTES, /p\.deleted_at IS NULL AND p\.approve_status IN \(0, 1\)/);
});

test('a same-agent re-send stops bulk approval; a co-mandate or a look-alike title never does', () => {
  assert.ok(BLOCKING_FLAGS.has('same_agent_resend'));
  assert.ok(!BLOCKING_FLAGS.has('duplicate_photo') && !BLOCKING_FLAGS.has('duplicate_listing'));
  assert.ok(INFO_FLAGS.has('duplicate_photo') && INFO_FLAGS.has('duplicate_listing'));
  assert.deepEqual(DUPLICATE_FLAGS, ['same_agent_resend', 'duplicate_photo', 'duplicate_listing']);
  for (const flag of DUPLICATE_FLAGS) assert.ok(FLAG_SQL_KEYS.includes(flag), flag);
});

test('bulk approve asks the database for the same agent’s other copies', async () => {
  reset();
  enqueue([{ id: 746 }]);
  const twins = await findSameAgentResends(737);
  assert.deepEqual(twins, [746]);
  const { text, values } = calls[0];
  assert.match(text, /WITH\s+fp_index AS MATERIALIZED/);
  assert.match(text, /agent_id IS NOT NULL/);
  assert.deepEqual(values, [737]);
  assert.deepEqual(await findSameAgentResends('nope'), []);
});
