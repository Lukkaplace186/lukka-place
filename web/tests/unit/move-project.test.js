import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { calls, reset } from '../support/fakePool.js';
import {
  MOVE_BUDGETS,
  MOVE_STEPS,
  answersFromProject,
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

test('a budget is one of the chips for that transaction; a short stay has none', () => {
  assert.equal(parseMoveProject({ transaction: 'location', budgetMax: 700 }).project.budgetMax, 700);
  assert.equal(parseMoveProject({ transaction: 'location', budgetMax: 650 }).project.budgetMax, null);
  assert.equal(parseMoveProject({ transaction: 'vente', budgetMax: 700 }).project.budgetMax, null);
  assert.equal(MOVE_BUDGETS.courte, undefined);
  const short = parseMoveProject({ transaction: 'courte', budgetMax: 200 }).project;
  assert.equal(short.transactionType, 'location');
  assert.equal(short.leaseTerm, 'short');
  assert.equal(short.budgetMax, null);
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
  const { project } = parseMoveProject({ transaction: 'location', city: 'Kinshasa', communes: ['Gombe', 'Ngaliema'], bedrooms: 4, budgetMax: 1000 });
  const q = new URLSearchParams(moveSearchQuery(project));
  assert.equal(q.get('transaction_type'), 'location');
  assert.equal(q.get('commune'), 'Gombe');
  assert.equal(q.get('communes'), 'Gombe,Ngaliema');
  assert.equal(q.get('beds_min'), '4');
  assert.equal(q.get('price_max'), '1000');
  assert.equal(q.get('ville'), null);
  assert.equal(moveSearchQuery(parseMoveProject({ reasons: ['travail'], household: 'deux' }).project), null);
});

test('a search saved before the sign-up gate prefills only what the cards can hold', () => {
  const out = projectFromSearchQuery('transaction_type=location&commune=Gombe&communes=Gombe,Ngaliema&beds_min=3&price_max=700&q=piscine');
  assert.deepEqual(out, { transaction: 'location', city: 'Kinshasa', communes: ['Gombe', 'Ngaliema'], bedrooms: 3, budgetMax: 700 });
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
  assert.equal(moveStoryFr(parseMoveProject({}).project), '');
});

test('agencies are reached by commune: a request needs a transaction and a commune', () => {
  assert.equal(moveRequestBlocker(null), 'transaction');
  assert.equal(moveRequestBlocker(parseMoveProject({ city: 'Kinshasa', communes: ['Gombe'] }).project), 'transaction');
  assert.equal(moveRequestBlocker(parseMoveProject({ transaction: 'vente' }).project), 'communes');
  assert.equal(moveRequestBlocker(parseMoveProject({ transaction: 'vente', city: 'Kinshasa', communes: ['Gombe'] }).project), null);
});

test('a stored project reopens the cards on the same answers', () => {
  const { project } = parseMoveProject({ reasons: ['travail'], transaction: 'courte', city: 'Kinshasa', communes: ['Gombe'], answeredSteps: ['reasons', 'transaction', 'bogus'] });
  const answers = answersFromProject(project);
  assert.equal(answers.transaction, 'courte');
  assert.deepEqual(answers.answeredSteps, ['reasons', 'transaction']);
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
