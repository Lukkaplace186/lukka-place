import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { calls, reset } from '../support/fakePool.js';
import {
  MOVE_BUDGETS,
  MOVE_BUDGET_STRETCH,
  MOVE_STEPS,
  answersFromProject,
  cleanBudgetRange,
  closeMatchTags,
  stretchedBudget,
  moveCriteriaFr,
  moveRequestBlocker,
  moveSearchQuery,
  moveStoryFr,
  parseMoveProject,
  projectFromSearchQuery,
} from '@/lib/moveProjectRules';
import { getMoveProject, saveMoveProject } from '@/lib/moveProjects';
import { sanitizeOnboardingEvent } from '@/app/api/telemetry/onboarding/route';

const here = path.dirname(fileURLToPath(import.meta.url));
const web = path.resolve(here, '..', '..');
const read = (rel) => readFileSync(path.join(web, rel), 'utf8');

// "Mon déménagement" (2026-11-07) — web/CLAUDE.md, same heading.

test('a skipped card is not said: an empty post has no answers and every field empty', () => {
  const { project, hasAnswers } = parseMoveProject({});
  assert.equal(hasAnswers, false);
  assert.deepEqual(project.reasons, []);
  assert.equal(project.transactionType, null);
  assert.equal(project.bedroomsMin, null);
  assert.equal(project.budgetMax, null);
  assert.equal(project.city, null);
  assert.deepEqual(project.communes, []);
});

test('unknown values are dropped, never an error', () => {
  const { project } = parseMoveProject({
    reasons: ['travail', 'pirate', 'travail'],
    transaction: 'louer-gratuit',
    household: 'onze',
    bedrooms: 9,
    priorities: ['eau', 'piscine'],
    timeline: 'hier',
  });
  assert.deepEqual(project.reasons, ['travail']);
  assert.equal(project.transactionType, null);
  assert.equal(project.household, null);
  assert.equal(project.bedroomsMin, null);
  assert.deepEqual(project.priorities, ['eau']);
  assert.equal(project.timeline, null);
});

test('nothing is deduced: household size never becomes bedrooms, a workplace never becomes a commune', () => {
  const { project } = parseMoveProject({ household: 'cinq_six', anchorKind: 'travail', anchorCommune: 'Gombe' });
  assert.equal(project.bedroomsMin, null);
  assert.deepEqual(project.communes, []);
  assert.equal(project.anchorCommune, 'Gombe');
});

test('communes must belong to the chosen city, at most five; an unknown commune is dropped', () => {
  const { project } = parseMoveProject({
    city: 'Kinshasa',
    communes: ['Gombe', 'Ngaliema', 'Atlantide', 'Limete', 'Lemba', 'Kintambo', 'Bandalungwa'],
  });
  assert.equal(project.city, 'Kinshasa');
  assert.deepEqual(project.communes, ['Gombe', 'Ngaliema', 'Limete', 'Lemba', 'Kintambo']);
});

test('the budget is a range the customer adjusts: whole dollars, capped, reversed ends swapped', () => {
  const p = (budgetMin, budgetMax, transaction = 'location') => {
    const { project } = parseMoveProject({ transaction, budgetMin, budgetMax });
    return [project.budgetMin, project.budgetMax];
  };
  assert.deepEqual(p(400, 650), [400, 650]);
  assert.deepEqual(p('$1,200', ' 800 '), [800, 1200]);
  assert.deepEqual(p(null, 700), [null, 700]);
  assert.deepEqual(p(300, ''), [300, null]);
  assert.deepEqual(p(0, -5), [null, null]);
  assert.deepEqual(p(400, 1_000_000), [400, null], 'past the rental cap is a typo, not a budget');
  assert.deepEqual(p(150000, 250000, 'vente'), [150000, 250000]);
  assert.equal(cleanBudgetRange('location', 1, 2).budgetMax, 2);
});

test('a short stay has no budget card (per day or per week cannot share one range)', () => {
  assert.equal(MOVE_BUDGETS.courte, undefined);
  const short = parseMoveProject({ transaction: 'courte', budgetMin: 20, budgetMax: 200 }).project;
  assert.equal(short.transactionType, 'location');
  assert.equal(short.leaseTerm, 'short');
  assert.deepEqual([short.budgetMin, short.budgetMax], [null, null]);
  for (const t of ['location', 'vente']) {
    for (const [lo, hi] of MOVE_BUDGETS[t].presets) assert.ok(lo == null || hi == null || lo < hi);
  }
});

test('five cards since 2026-11-07, every one skippable', () => {
  assert.deepEqual([...MOVE_STEPS], ['reasons', 'search', 'place', 'budget', 'details']);
});

test('a close home says why it is close, from real fields only', () => {
  const project = parseMoveProject({ transaction: 'location', city: 'Kinshasa', communes: ['Gombe'], budgetMin: 400, budgetMax: 700 }).project;
  const rent = (price, extra = {}) => ({ price, purpose: 'rent', price_period: 'mois', currency: 'USD', commune: 'Gombe', ...extra });
  assert.deepEqual(closeMatchTags(rent(784), project), [{ kind: 'above', pct: 12 }]);
  assert.deepEqual(closeMatchTags(rent(360), project), [{ kind: 'below', pct: 10 }]);
  assert.deepEqual(closeMatchTags(rent(500), project), []);
  assert.deepEqual(closeMatchTags(rent(784, { currency: 'CDF' }), project), [], 'a CDF price is another number');
  assert.deepEqual(closeMatchTags(rent(9000, { price_period: 'an' }), project), [], 'a yearly rent is not a monthly budget');
  assert.deepEqual(
    closeMatchTags(rent(500, { commune: 'Lingwala' }), project, [{ commune: 'Lingwala', km: 3 }]),
    [{ kind: 'nearby', commune: 'Lingwala', km: 3 }],
  );
  assert.deepEqual(closeMatchTags(rent(500, { commune: 'Lingwala' }), project, []), [], 'no measured distance, no claim');
  // 25 % either way while listings are few (owner, 2026-11-07).
  assert.equal(MOVE_BUDGET_STRETCH, 0.25);
  assert.deepEqual(stretchedBudget(project), { priceMin: 300, priceMax: 875 });
});

test('close homes are found apart from exact ones and never counted with them', () => {
  const src = read('lib/moveMatches.js');
  assert.match(src, /total: exact\.total/);
  assert.match(src, /exact\.total < CLOSE_WHEN_FEWER_THAN/);
  assert.match(src, /if \(!tags\.length\) continue;/);
  assert.match(src, /getNearbyExtras\(base/);
  const route = read('app/api/move/matches/route.js');
  assert.match(route, /parseMoveProject\(body\)/);
  assert.match(route, /rateLimited\(/);
});

test('"peu importe" carries no place; free text is trimmed, folded and capped', () => {
  const none = parseMoveProject({ anchorKind: 'aucun', anchorCommune: 'Gombe', anchorNote: 'x' }).project;
  assert.equal(none.anchorCommune, null);
  assert.equal(none.anchorNote, null);
  const note = parseMoveProject({ reasons: ['autre'], reasonOther: `  un   ${'a'.repeat(200)}\n` }).project.reasonOther;
  assert.ok(note.startsWith('un a'));
  assert.equal(note.length, 80);
  assert.equal(parseMoveProject({ reasons: ['travail'], reasonOther: 'ignored' }).project.reasonOther, null);
});

test('the saved search uses /listings parameter names and needs a transaction or a commune', () => {
  const { project } = parseMoveProject({ transaction: 'location', city: 'Kinshasa', communes: ['Gombe', 'Ngaliema'], bedrooms: 4, budgetMin: 600, budgetMax: 1000 });
  const q = new URLSearchParams(moveSearchQuery(project));
  assert.equal(q.get('transaction_type'), 'location');
  assert.equal(q.get('commune'), 'Gombe');
  assert.equal(q.get('communes'), 'Gombe,Ngaliema');
  assert.equal(q.get('beds_min'), '4');
  assert.equal(q.get('price_min'), '600');
  assert.equal(q.get('price_max'), '1000');
  assert.equal(q.get('ville'), null);
  assert.equal(moveSearchQuery(parseMoveProject({ reasons: ['travail'], household: 'deux' }).project), null);
});

test('a search saved before the sign-up gate prefills only what the cards can hold', () => {
  const out = projectFromSearchQuery('transaction_type=location&commune=Gombe&communes=Gombe,Ngaliema&beds_min=3&price_min=300&price_max=650&q=piscine');
  assert.deepEqual(out, { transaction: 'location', city: 'Kinshasa', communes: ['Gombe', 'Ngaliema'], bedrooms: 3, budgetMin: 300, budgetMax: 650 });
  assert.deepEqual(projectFromSearchQuery('price_max=123'), {});
});

test('the agency brief is French, story first, and only what was said', () => {
  const { project } = parseMoveProject({
    reasons: ['famille', 'autre'],
    reasonOther: 'un 4e enfant',
    household: 'cinq_six',
    transaction: 'location',
    city: 'Kinshasa',
    communes: ['Ngaliema'],
    bedrooms: 4,
    currentHomeType: 'appartement',
    currentCommune: 'Lingwala',
    priorities: ['cour'],
    timeline: 'un_mois',
  });
  const story = moveStoryFr(project);
  assert.match(story, /^Projet : la famille s’agrandit, « un 4e enfant »/);
  assert.match(story, /5–6 personnes/);
  assert.match(story, /quitte un appartement à Lingwala/);
  assert.match(story, /important : une cour/);
  assert.match(story, /entrée : dans le mois/);
  assert.equal(moveCriteriaFr(project), 'Location · Ngaliema · 4 chambres');
  const ranged = parseMoveProject({ transaction: 'location', budgetMin: 400, budgetMax: 1000 }).project;
  assert.equal(moveCriteriaFr(ranged), 'Location · Budget $400 – $1,000');
  assert.equal(moveCriteriaFr(parseMoveProject({ transaction: 'vente', budgetMin: 60000 }).project), 'Achat · Budget à partir de $60,000');
  assert.equal(moveStoryFr(parseMoveProject({}).project), '');
});

test('agencies are reached by commune: a request needs a transaction and a commune', () => {
  assert.equal(moveRequestBlocker(null), 'transaction');
  assert.equal(moveRequestBlocker(parseMoveProject({ city: 'Kinshasa', communes: ['Gombe'] }).project), 'transaction');
  assert.equal(moveRequestBlocker(parseMoveProject({ transaction: 'vente' }).project), 'communes');
  assert.equal(moveRequestBlocker(parseMoveProject({ transaction: 'vente', city: 'Kinshasa', communes: ['Gombe'] }).project), null);
});

test('a stored project reopens the cards on the same answers', () => {
  const { project } = parseMoveProject({ reasons: ['travail'], transaction: 'location', city: 'Kinshasa', communes: ['Gombe'], budgetMin: 300, budgetMax: 500, answeredSteps: ['reasons', 'search', 'transaction', 'bogus'] });
  const answers = answersFromProject(project);
  assert.equal(answers.transaction, 'location');
  assert.deepEqual([answers.budgetMin, answers.budgetMax], [300, 500]);
  assert.deepEqual(answers.answeredSteps, ['reasons', 'search']);
  assert.deepEqual(parseMoveProject(answers).project, project);
});

test('the project is one upserted row per customer, every answer replaced', async () => {
  reset();
  const { project } = parseMoveProject({ reasons: ['travail'], transaction: 'location' });
  await saveMoveProject(7, project);
  const sql = calls.at(-1).text;
  assert.match(sql, /INSERT INTO customer_move_projects/);
  assert.match(sql, /ON CONFLICT \(customer_id\) DO UPDATE SET/);
  assert.match(sql, /reasons = EXCLUDED\.reasons/);
  assert.equal(calls.at(-1).values[0], 7);
});

test('reads and writes survive running before the migration', async () => {
  const src = read('lib/moveProjects.js');
  assert.match(src, /'42P01'/);
  assert.match(src, /return \{ saved: false \}/);
  // budget_min has its own migration: until it runs, the rest still saves.
  assert.match(src, /err\.code === '42703'[\s\S]*upsertSql\(false\)/);
  assert.match(src, /budgetMin: row\.budget_min \?\? null/);
  assert.equal(typeof getMoveProject, 'function');
});

test('sign-up saves the answers only after the account exists, and never blocks it', () => {
  const src = read('app/(site)/compte/inscription/actions.js');
  const create = src.indexOf('await createCustomer(');
  const save = src.indexOf('await saveProjectAndAlert(');
  assert.ok(create > 0 && save > create);
  assert.match(read('lib/moveProjects.js'), /Never throws/);
  assert.match(src, /\/compte\/client\/projet\?nouveau=1/);
});

test('answering the cards never contacts an agency: only the explicit button creates a lead', () => {
  assert.doesNotMatch(read('app/(site)/compte/inscription/actions.js'), /createLead/);
  assert.doesNotMatch(read('lib/moveProjects.js'), /createLead/);
  const action = read('app/(site)/compte/client/projet/actions.js');
  assert.match(action, /export async function sendMoveRequestAction/);
  assert.match(action, /getCurrentCustomerId\(\)/);
  assert.match(action, /MOVE_RESEND_AFTER_MS/);
});

test('the onboarding beacon logs only known steps and numbers', () => {
  assert.deepEqual(sanitizeOnboardingEvent({ mode: 'signup', step: 'budget', index: 8, total: 11 }), { mode: 'signup', step: 'budget', index: 8, total: 11 });
  assert.equal(sanitizeOnboardingEvent({ mode: 'signup', step: '<script>', index: 1, total: 2 }), null);
  assert.equal(sanitizeOnboardingEvent({ mode: 'other', step: 'budget', index: 1, total: 2 }), null);
  assert.equal(sanitizeOnboardingEvent({ mode: 'edit', step: 'end', index: 3, total: 2 }), null);
  for (const step of MOVE_STEPS) assert.ok(sanitizeOnboardingEvent({ mode: 'edit', step, index: 1, total: 11 }));
});
