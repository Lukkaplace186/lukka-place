import test from 'node:test';
import assert from 'node:assert/strict';
import * as developments from '@/lib/developments';
import {
  generateLots, generateUnits, lotSummary, pinWithinCommune, portionBlockedIds, portionPriceWarnings, portionRows,
  projectReviewState, salesProgress, unitListingState, validateUnitInput, withLiveUnitCounts, wizardProgress,
} from '@/lib/developmentRules';
import { parseLooseNumber, parsePastedRows } from '@/lib/projectPaste';
import { placeResolvedListings } from '@/lib/geocoding';
import { groupListingsByBuilding } from '@/lib/buildingGroups';
import { QUOTA_COUNTED_SQL } from '@/lib/listingQuotaRules';
import { STATUS_WHERE } from '@/lib/moderationQueue';
import { calls, enqueue, reset } from '../support/fakePool.js';

/**
 * Developers upload their own projects (/compte/agent/projets) and a
 * building's ready units become real listings on the main map.
 *  - every developer write carries `agent_id = <session>` IN its SQL;
 *  - nothing is invented: generators, the pasted-table parser and the counts
 *    work only from what the developer typed.
 */

const allSql = () => calls.map((c) => c.sql).join('\n');
const DEV = { agentId: 7 };

test.beforeEach(() => reset());

test('developer writes are scoped to their own project in the SQL itself', async () => {
  enqueue([]);
  await developments.updateProject(3, { name: 'X', commune: 'Gombe' }, DEV);
  assert.match(allSql(), /WHERE id = \$1 AND agent_id = \$\d+/);
  assert.ok(calls[0].values.includes(7));
  assert.match(allSql(), /changes_pending = changes_pending OR approve_status = 1/, 'an edit to a live project is flagged for the team');

  for (const run of [
    () => developments.saveUnitType(3, 9, { label: 'T2' }, DEV),
    () => developments.insertLots(3, [{ label: 'Lot 1' }], DEV),
    () => developments.insertUnitTypes(3, [{ label: 'T2' }], DEV),
    () => developments.deleteLot(3, 4, DEV),
    () => developments.saveLot(3, 4, { label: 'Lot 1' }, DEV),
    () => developments.addProjectUpdate(3, { takenOn: '2026-09-01', caption: 'x', photos: [] }, DEV),
    () => developments.addProjectImages(3, 'photos', ['https://x/y.jpg'], DEV),
  ]) {
    reset();
    enqueue([]);
    await run();
    assert.match(allSql(), /d\.agent_id = \$\d+|AND agent_id = \$\d+/, 'owner check missing');
  }
});

test('a developer can never set who owns the project', async () => {
  enqueue([]);
  await developments.updateProject(3, { name: 'X', agent_id: 99 }, DEV);
  assert.ok(!/agent_id = \$2/.test(calls[0].sql.split('WHERE')[0]), 'agent_id is not in the SET list');
  assert.ok(!calls[0].values.includes(99));
});

test('submitting is the developer’s own unpublished draft only', async () => {
  enqueue([]);
  await developments.submitProject(7, 3);
  assert.match(allSql(), /WHERE id = \$1 AND agent_id = \$2 AND approve_status = 0/);
});

test('publishing approves the project’s pending units in the same transaction; unpublishing keeps closed ones', async () => {
  await developments.setProjectPublished(3, true, { moderatorId: 1 });
  const sql = allSql();
  assert.match(sql, /BEGIN/);
  assert.match(sql, /UPDATE properties SET approve_status = \$2[\s\S]*WHERE development_id = \$1 AND approve_status = \$5/);
  assert.match(sql, /COMMIT/);
  reset();
  await developments.setProjectPublished(3, false);
  assert.match(allSql(), /listing_status, 'active'\) <> 'closed'/, 'a let/sold unit keeps its approval (market record)');
});

test('the developer’s preview and list read their own projects only', async () => {
  enqueue([]);
  await developments.getAgentProject(7, 3);
  assert.match(allSql(), /d\.id = \$1 AND d\.agent_id = \$2/);
});

test('project units never take a plan slot and never wait in the listing queue', () => {
  assert.match(QUOTA_COUNTED_SQL, /p\.development_id IS NULL/);
  assert.match(STATUS_WHERE.pending, /p\.development_id IS NULL/);
});

test('unit generator: floors × units, two naming schemes, capped not truncated silently', () => {
  assert.deepEqual(generateUnits({ from: 0, to: 1, perFloor: 2, prefix: 'Apt ' }).units.map((u) => u.label), ['Apt RDC-A', 'Apt RDC-B', 'Apt 1A', 'Apt 1B']);
  assert.deepEqual(generateUnits({ from: 2, to: 2, perFloor: 3, naming: 'numbers' }).units.map((u) => [u.label, u.floor]), [['201', 2], ['202', 2], ['203', 2]]);
  const big = generateUnits({ from: 1, to: 50, perFloor: 26 });
  assert.equal(big.units.length, 300);
  assert.equal(big.truncated, true);
});

test('lot generator numbers from the start and keeps the stated area and price', () => {
  const lots = generateLots({ count: 3, start: 5, area: '300', price: '12000' });
  assert.deepEqual(lots.map((l) => l.label), ['Lot 5', 'Lot 6', 'Lot 7']);
  assert.equal(lots[0].area_m2, 300);
  assert.equal(generateLots({ count: 2 })[0].price, null, 'no price typed, no price');
});

test('a unit takes its type’s price when it has none of its own, and refuses a floor out of range', () => {
  assert.equal(validateUnitInput({ label: '1A' }, { price_min: '900' }).value.price, 900);
  assert.equal(validateUnitInput({ label: '1A' }, {}).errorKey, 'admin.projects.errors.unitPrice');
  assert.equal(validateUnitInput({ label: '1A', floor: '120', price: '5' }).errorKey, 'admin.projects.errors.floor');
});

test('numbers the way Kinshasa price lists write them', () => {
  assert.equal(parseLooseNumber('1 200,50'), 1200.5);
  assert.equal(parseLooseNumber('85 000 $'), 85000);
  assert.equal(parseLooseNumber('1.200.000'), 1200000);
  assert.equal(parseLooseNumber('1,200'), 1200);
  assert.equal(parseLooseNumber('12k'), 12000);
  assert.equal(parseLooseNumber('USD 900'), 900);
  assert.equal(parseLooseNumber('sur demande'), null);
});

test('pasted rows: header skipped and said so, bad rows kept with their reason', () => {
  const text = 'Type\tChambres\tSdb\tm²\tPrix dès\tPrix max\tTotal\tDispo\nT2\t2\t1\t65\t45 000\t52 000\t12\t5\n\t3\t2\t90\t80000\t\t\t\nT3\tdeux\t2\t90\t80000\t\t\t';
  const { rows, skippedHeader } = parsePastedRows(text, 'unitTypes');
  assert.equal(skippedHeader, true);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].value.price_min, 45000);
  assert.equal(rows[0].value.units_available, 5);
  assert.equal(rows[1].errorKey, 'admin.projects.errors.unitLabel');
  assert.equal(rows[2].errorKey, 'admin.projects.errors.pasteNumber');
  const lots = parsePastedRows('Lot 1;300;12 000\nLot 2;300;', 'lots').rows;
  assert.equal(lots[0].value.price, 12000);
  assert.equal(lots[1].value.price, null, 'an empty cell stays empty, never 0');
});

test('portions: selling 30 % rules out 100 %, and a sale that falls through frees it again', () => {
  const lots = [
    { id: 1, share_percent: 30, status: 'sold', price: 15000 },
    { id: 2, share_percent: 50, status: 'available', price: 24000 },
    { id: 3, share_percent: 100, status: 'available', price: 42000 },
  ];
  assert.deepEqual([...portionBlockedIds(lots)], ['3']);
  const summary = lotSummary(lots);
  assert.deepEqual([summary.available, summary.blocked, summary.sold], [1, 1, 1]);
  assert.equal(summary.priceMin, 24000, 'a blocked portion is never the "dès" price');
  assert.equal(portionBlockedIds([{ ...lots[0], status: 'available' }, lots[1], lots[2]]).size, 0);
  assert.equal(portionRows(lots, 1000).find((r) => r.id === 3).blocked, true);
});

test('a bigger portion dearer per m² is flagged, never refused', () => {
  const rows = portionRows([
    { id: 1, share_percent: 30, status: 'available', price: 15000 },
    { id: 2, share_percent: 50, status: 'available', price: 30000 },
  ], 1000);
  assert.deepEqual([...portionPriceWarnings(rows)], [2]);
});

test('units of a ready type are COUNTED from their listings; pending and withdrawn are not on offer', () => {
  const type = { id: 1, ready_now: true, units_available: 9, units_total: 9, price_min: 500 };
  const units = [
    { price: 900, approve_status: 1, status: 1, listing_status: 'active' },
    { price: 800, approve_status: 1, status: 0, listing_status: 'closed' },
    { price: 700, approve_status: 0, status: 1, listing_status: 'active' },
    { price: 600, approve_status: 1, status: 0, listing_status: 'active' },
  ];
  assert.deepEqual(units.map(unitListingState), ['available', 'taken', 'pending', 'withdrawn']);
  const counted = withLiveUnitCounts(type, units);
  assert.equal(counted.units_available, 1);
  assert.equal(counted.units_total, 2);
  assert.equal(counted.price_min, 900, '"dès" is what is actually on the market');
  assert.equal(withLiveUnitCounts({ ...type, ready_now: false }, units).units_available, 9, 'a typed type is untouched');
  assert.equal(withLiveUnitCounts(type, [units[2]]).counted, false, 'nothing public yet: the typed numbers stand');
});

test('sales progress only from real totals, never "0 % vendu"', () => {
  assert.equal(salesProgress({ kind: 'building', unit_types: [{ units_total: 10, units_available: 3 }] }).percent, 70);
  assert.equal(salesProgress({ kind: 'building', unit_types: [{ units_total: null, units_available: 3 }] }), null);
  assert.equal(salesProgress({ kind: 'building', unit_types: [{ units_total: 10, units_available: 10 }] }), null);
  assert.equal(salesProgress({ kind: 'land', lots: [{ status: 'sold' }, { status: 'available' }] }).percent, 50);
});

test('a pin far from its commune is refused; peripheral communes get their real reach', () => {
  const gombe = { lat: -4.305, lng: 15.305 };
  assert.equal(pinWithinCommune({ lat: -4.31, lng: 15.31 }, gombe, 'Gombe'), true);
  assert.equal(pinWithinCommune({ lat: -4.6, lng: 15.6 }, gombe, 'Gombe'), false);
  assert.equal(pinWithinCommune({ lat: -4.3, lng: 15.9 }, { lat: -4.3, lng: 15.6 }, 'Maluku'), true);
  assert.equal(pinWithinCommune(null, gombe, 'Gombe'), true, 'no pin is allowed');
});

test('review state from the developer’s side', () => {
  assert.equal(projectReviewState({ status: 1, approve_status: 0 }), 'draft');
  assert.equal(projectReviewState({ status: 1, approve_status: 0, submitted_at: '2026-09-02' }), 'submitted');
  assert.equal(projectReviewState({ status: 1, approve_status: 0, submitted_at: '2026-09-02', reviewed_at: '2026-09-03', review_note: 'x' }), 'changes');
  assert.equal(projectReviewState({ status: 1, approve_status: 0, submitted_at: '2026-09-04', reviewed_at: '2026-09-03', review_note: 'x' }), 'submitted', 'a resubmission is waiting again');
  assert.equal(projectReviewState({ status: 1, approve_status: 1, changes_pending: true }), 'live_edited');
});

test('wizard ticks come from the row, not from where the developer clicked', () => {
  const p = wizardProgress({ kind: 'land', land_area_m2: '1000', commune: 'Gombe', photos: [], renders: ['x'], lots: [{}], payment_plan: [] });
  assert.deepEqual(p, { etat: true, lieu: true, medias: true, offre: true, paiement: false, apercu: false });
});

test('a developer’s units share ONE exact pin: grouped into a building, never jittered', () => {
  const units = [1, 2, 3].map((id) => ({ id, price: 900 + id, parent_building_id: 'b-1', building_name: 'Résidence', lat: -4.3, lng: 15.3, exact: true }));
  const groups = groupListingsByBuilding(units);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].isBuilding, true);
  const placed = placeResolvedListings([{ id: 1, base: { lat: -4.3, lng: 15.3, source: 'existing', precise: true, exact: true } }]);
  assert.deepEqual([placed.get(1).lat, placed.get(1).lng], [-4.3, 15.3]);
  const jittered = placeResolvedListings([{ id: 1, base: { lat: -4.3, lng: 15.3, source: 'existing', precise: true } }]);
  assert.notEqual(jittered.get(1).lat, -4.3, 'an ordinary listing keeps its privacy jitter');
});
