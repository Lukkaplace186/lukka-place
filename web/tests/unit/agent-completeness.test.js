import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { calls, enqueue, reset } from '../support/fakePool.js';
import {
  getIncompleteListings,
  getAgentProfileGaps,
  getPhotographyOffer,
  listingGaps,
  profileGaps,
} from '@/lib/completeness';
import {
  LISTING_GAP_CODES,
  PROFILE_GAP_CODES,
  gapHintKey,
  gapLabelKey,
  listingGapHref,
  profileGapHref,
} from '@/lib/completenessRules';

beforeEach(() => reset());

const read = (rel) => readFileSync(path.join(process.cwd(), rel), 'utf8');

const COMPLETE_LISTING = {
  price: 700,
  purpose: 'rent',
  deposit_months: 3,
  latitude: '-4.32',
  longitude: '15.30',
  quartier: 'Righini',
  commune: 'Lemba',
  description: 'Bel appartement de deux chambres, eau et électricité.',
  photo_count: 5,
};

test('a complete listing has no gaps', () => {
  assert.deepEqual(listingGaps(COMPLETE_LISTING), []);
});

test('each listing gap fires on its own condition, in the declared order', () => {
  const gaps = listingGaps({ purpose: 'rent', price: 0, description: 'court', photo_count: 1, latitude: '', longitude: null });
  assert.deepEqual(gaps, LISTING_GAP_CODES);
});

test('thin photos: fewer than 3', () => {
  assert.deepEqual(listingGaps({ ...COMPLETE_LISTING, photo_count: 2 }), ['thin_photos']);
  assert.deepEqual(listingGaps({ ...COMPLETE_LISTING, photo_count: 3 }), []);
});

test('the deposit is a rental gap only, and 0 is a stated value', () => {
  assert.deepEqual(listingGaps({ ...COMPLETE_LISTING, deposit_months: null }), ['missing_deposit']);
  assert.deepEqual(listingGaps({ ...COMPLETE_LISTING, deposit_months: 0 }), []);
  assert.deepEqual(listingGaps({ ...COMPLETE_LISTING, purpose: 'sale', deposit_months: null }), []);
});

test('no map pin is a gap only when the agent has not given a quartier either', () => {
  const unpinned = { ...COMPLETE_LISTING, latitude: null, longitude: null };
  assert.deepEqual(listingGaps(unpinned), [], 'quartier set: the geocoder has what it needs');
  assert.deepEqual(listingGaps({ ...unpinned, quartier: '' }), ['no_map_pin']);
  assert.deepEqual(listingGaps({ ...COMPLETE_LISTING, quartier: '' }), [], 'a real pin needs no quartier');
  assert.deepEqual(listingGaps({ ...COMPLETE_LISTING, latitude: 'abc', quartier: null }), ['no_map_pin']);
});

test('the description floor is the 15 characters the save path enforces', () => {
  assert.deepEqual(listingGaps({ ...COMPLETE_LISTING, description: '   14 caractère ' }), ['missing_description']);
  assert.deepEqual(listingGaps({ ...COMPLETE_LISTING, description: '15 caractères ok' }), []);
});

test('profile gaps: serviced communes count as coverage', () => {
  const base = {
    primary_communes: [], serviced_communes: [], image: null, working_hours: '', agency_name: null,
    vendor_name: null, phone_verified_at: null,
  };
  assert.deepEqual(profileGaps(base), PROFILE_GAP_CODES);
  assert.ok(!profileGaps({ ...base, serviced_communes: ['Gombe'] }).includes('no_communes'));
  assert.ok(!profileGaps({ ...base, primary_communes: ['Gombe'] }).includes('no_communes'));
});

test('profile gaps: a phone-shaped or placeholder agency name is not a name', () => {
  const base = { primary_communes: ['Gombe'], image: 'x', working_hours: '8h-18h', phone_verified_at: '2026-01-01' };
  assert.deepEqual(profileGaps({ ...base, agency_name: '243853580738' }), ['no_agency_name']);
  assert.deepEqual(profileGaps({ ...base, vendor_name: 'Agence #12' }), ['no_agency_name']);
  assert.deepEqual(profileGaps({ ...base, vendor_name: 'Espace Kin' }), []);
  assert.deepEqual(profileGaps({ ...base, agency_name: 'Espace Kin' }), []);
});

test('every gap links to the exact field that fixes it', () => {
  assert.equal(profileGapHref('no_communes'), '/compte/agent/parametres#communes');
  assert.equal(profileGapHref('no_agency_name'), '/compte/agent/parametres#agency_name');
  assert.equal(profileGapHref('no_working_hours'), '/compte/agent/parametres#hours');
  assert.equal(listingGapHref(42, 'thin_photos'), '/compte/agent/biens/42/edit#photos');
  assert.equal(listingGapHref(42, 'missing_deposit'), '/compte/agent/biens/42/edit#deposit_months');

  // The anchors must exist where they point.
  const settings = read('app/compte/agent/parametres/page.js');
  for (const id of ['identity', 'communes', 'hours', 'agency_name', 'quick-replies']) {
    assert.ok(settings.includes(`id="${id}"`), `settings anchor #${id}`);
  }
  const editor = read('components/AgentListingEditor.js');
  for (const id of ['photos', 'price', 'commune', 'description', 'deposit_months', 'quartier']) {
    assert.ok(editor.includes(`id="${id}"`), `editor anchor #${id}`);
  }
});

test('every gap code has a label and a hint in both dictionaries', () => {
  for (const file of ['lib/i18n/fr.json', 'lib/i18n/en.json']) {
    const dict = JSON.parse(read(file));
    for (const code of [...LISTING_GAP_CODES, ...PROFILE_GAP_CODES]) {
      const [, , group, key] = gapLabelKey(code).split('.');
      assert.ok(dict.agent.completeness[group][key], `${file} label ${code}`);
      assert.ok(dict.agent.completeness.hints[gapHintKey(code).split('.').pop()], `${file} hint ${code}`);
    }
  }
});

test('getIncompleteListings: the contract shape, ownership in SQL, closed/archived excluded, limit applied', async () => {
  enqueue([
    { id: '10', title: 'A', ...COMPLETE_LISTING },
    { id: '11', title: 'B', ...COMPLETE_LISTING, photo_count: 1 },
    { id: '12', title: 'C', ...COMPLETE_LISTING, price: null, commune: null },
  ]);
  const rows = await getIncompleteListings(7, { limit: 1 });
  assert.deepEqual(rows, [{ id: 11, title: 'B', gaps: ['thin_photos'] }]);

  const { sql, values } = calls[0];
  assert.match(sql, /WHERE p\.agent_id = \$2/);
  assert.match(sql, /listing_status IS DISTINCT FROM 'closed'/);
  assert.match(sql, /archived_at IS NULL/);
  assert.deepEqual(values, [20, 7]);
});

test('getIncompleteListings never throws and refuses a bogus agent id without a query', async () => {
  assert.deepEqual(await getIncompleteListings('abc'), []);
  assert.equal(calls.length, 0);
});

test('profile gaps read serviced_communes only when the agent row lacks it', async () => {
  enqueue([{ serviced_communes: ['Gombe'] }]);
  const gaps = await getAgentProfileGaps({ id: 3, primary_communes: [], phone_verified_at: 'x', image: 'y', working_hours: 'z', agency_name: 'Kin' });
  assert.deepEqual(gaps, []);
  assert.match(calls[0].sql, /SELECT serviced_communes FROM agents WHERE id = \$1/);
});

test('the photography offer is read live from packages, never hardcoded', async () => {
  enqueue([{ id: '32', title: 'Photography Service', price: '30', term: 'lifetime' }]);
  assert.deepEqual(await getPhotographyOffer(), { id: 32, title: 'Photography Service', price: 30, term: 'lifetime' });
  assert.match(calls[0].sql, /status = 1 AND deleted_at IS NULL/);
  assert.equal(await getPhotographyOffer(), null, 'no package, no offer');

  assert.ok(read('components/AgentPlanPicker.js').includes('id={`plan-${pkg.id}`}'), 'the offer link has a target');
});
