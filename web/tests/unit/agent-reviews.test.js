import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { calls, enqueue, normalizeSql, reset } from '../support/fakePool.js';
import {
  MIN_PUBLIC_REVIEWS,
  formatAverage,
  getAgentPublicRating,
  publicRatingSummary,
} from '@/lib/agentReviews';
import { homeVisitInbox, needsAgentRating } from '@/lib/clientPortalView';

/**
 * "Notez l'agent" (2026-10-18): verified 1–5 star ratings of the AGENT after
 * a visit. Engine half and its rules: root CLAUDE.md / verify-pipeline §51.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(path.join(here, '..', '..', rel), 'utf8');

test('no public average below the threshold, shared with the engine', () => {
  assert.equal(MIN_PUBLIC_REVIEWS, 5);
  assert.equal(publicRatingSummary({ review_count: 4, average_stars: 5 }), null);
  assert.deepEqual(publicRatingSummary({ review_count: 5, average_stars: 4.66 }), { count: 5, average: 4.7 });
  assert.equal(publicRatingSummary(null), null);
  assert.equal(formatAverage(4.7, 'fr'), '4,7');
  assert.equal(formatAverage(4, 'en'), '4.0');
  const engine = read('../services/agentReviews.js');
  assert.match(engine, /const MIN_PUBLIC_REVIEWS = 5;/);
});

test('the public read is scoped to the agent and shows approved comments only', async () => {
  reset();
  enqueue([{ review_count: 6, average_stars: 4.5 }]);
  enqueue([{ id: 1, stars: 5, comment: 'Ponctuel', created_at: '2026-10-01' }]);
  const rating = await getAgentPublicRating(37);
  assert.equal(rating.count, 6);
  assert.equal(rating.comments.length, 1);
  assert.match(normalizeSql(calls[0].text), /WHERE agent_id = \$1/);
  assert.match(normalizeSql(calls[1].text), /comment_status = 'APPROVED'/);
  assert.deepEqual(calls[0].values, [37]);
});

test('too few ratings: no comment query, nothing shown', async () => {
  reset();
  enqueue([{ review_count: 2, average_stars: 5 }]);
  assert.equal(await getAgentPublicRating(37), null);
  assert.equal(calls.length, 1);
  assert.equal(await getAgentPublicRating('abc'), null);
});

test('only a visit the customer said happened asks for stars; "agent absent" never does', () => {
  assert.equal(needsAgentRating({ checkinResponse: 'GOOD', agentRating: null }), true);
  assert.equal(needsAgentRating({ checkinResponse: 'BAD', agentRating: null }), true);
  assert.equal(needsAgentRating({ checkinResponse: 'AGENT_ABSENT', agentRating: null }), false);
  assert.equal(needsAgentRating({ checkinResponse: 'GOOD', agentRating: 4 }), false);
  assert.equal(needsAgentRating({ checkinResponse: null, agentRating: null }), false);
});

test("Accueil lists a visit still waiting for the agent's stars", () => {
  const visit = { id: 9, status: 'COMPLETED', agreed: true, at: '2026-10-01T12:00:00Z', checkinResponse: 'GOOD', agentRating: null };
  const groups = { today: [], tomorrow: [], upcoming: [], unscheduled: [], past: [visit] };
  assert.deepEqual(homeVisitInbox(groups, new Date('2026-10-02T12:00:00Z')).checkin.map((v) => v.id), [9]);
});

test('the profile names the agent, not the property, and the rating card is the engine path', () => {
  const card = read('app/(site)/compte/client/visites/VisitCard.js');
  assert.match(card, /needsAgentRating\(visit\)/);
  const actions = read('app/(site)/compte/client/actions.js');
  assert.match(actions, /customerRateAgent\(id, \{ waId, stars: value/);
  const page = read('app/(portfolio)/agents/[id]/page.js');
  assert.match(page, /getAgentPublicRating\(agent\.id\)/);
  const fr = JSON.parse(read('lib/i18n/fr.json'));
  assert.match(fr.account.agenda.rating.hint, /pas le bien/);
});
