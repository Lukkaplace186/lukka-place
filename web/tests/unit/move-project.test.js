import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { calls, enqueue, normalizeSql, reset } from '../support/fakePool.js';
import {
  MAX_MOVE_COMMUNES,
  MAX_MOVE_PROJECTS,
  MOVE_ANCHORS,
  MOVE_STAGES,
  MOVE_MANUAL_STAGES,
  MOVE_REASONS,
  MOVE_PRIORITIES,
  MOVE_BUDGETS,
  MOVE_BUDGET_STRETCH,
  MOVE_STEPS,
  answersFromProject,
  cleanBudgetRange,
  cleanProjectTitle,
  cleanStory,
  checkinDue,
  closeMatchTags,
  stretchedBudget,
  moveCriteriaFr,
  moveRequestBlocker,
  moveSearchQuery,
  moveStoryFr,
  parseMoveProject,
  projectDisplayName,
  projectFit,
  moveStagesReached,
  projectFromSearchQuery,
} from '@/lib/moveProjectRules';
import { createMoveProject, deleteMoveProject, getMoveProject, updateMoveProject } from '@/lib/moveProjects';
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

test('up to five projects per account: the ceiling is a COUNT guard in the INSERT itself', async () => {
  assert.equal(MAX_MOVE_PROJECTS, 5);
  reset();
  enqueue([{ id: 12 }]);
  const { project } = parseMoveProject({ reasons: ['travail'], transaction: 'location' });
  const created = await createMoveProject(7, project, 'Maison pour la famille');
  const { text, values } = calls.at(-1);
  assert.match(normalizeSql(text), /INSERT INTO customer_move_projects \(customer_id, .*title\) SELECT \$1, /);
  assert.match(normalizeSql(text), /WHERE \(SELECT COUNT\(\*\) FROM customer_move_projects WHERE customer_id = \$1\) < \$\d+ RETURNING id/);
  assert.equal(values[0], 7);
  assert.equal(values.at(-1), MAX_MOVE_PROJECTS);
  assert.ok(values.includes('Maison pour la famille'));
  assert.deepEqual(created, { saved: true, id: 12 });

  reset();
  enqueue([]); // the guard refused: no row came back
  assert.deepEqual(await createMoveProject(7, project), { saved: false, id: null, limit: true });
});

test('a project id never reaches another customer: every write is scoped by customer_id', async () => {
  const { project } = parseMoveProject({ transaction: 'vente' });
  reset();
  await updateMoveProject(7, 12, project, null);
  assert.match(normalizeSql(calls.at(-1).text), /WHERE customer_id = \$1 AND id = \$2$/);
  assert.deepEqual(calls.at(-1).values.slice(0, 2), [7, 12]);
  reset();
  await deleteMoveProject(7, 12);
  assert.equal(normalizeSql(calls.at(-1).text), 'DELETE FROM customer_move_projects WHERE customer_id = $1 AND id = $2');
  reset();
  enqueue([{ id: 3, customer_id: 9, reasons: [] }]);
  assert.equal(await getMoveProject(9, 4), null, 'an id not among the customer\'s projects reads as missing');
  assert.match(normalizeSql(calls.at(-1).text), /WHERE customer_id = \$1 ORDER BY created_at$/);
  const actions = read('app/(site)/compte/client/projet/actions.js');
  assert.match(actions, /!\(await getMoveProject\(customerId, projectId\)\)/, 'save refuses an id that is not the customer\'s');
});

test('reads and writes survive running before the migrations', () => {
  const src = read('lib/moveProjects.js');
  assert.match(src, /MISSING_TABLE = '42P01'/);
  // Before the multiple-projects migration: one project per customer, id 0.
  assert.match(src, /if \(err\.code === MISSING_COLUMN\) return legacyUpsert\(customerId, project\)/);
  assert.match(src, /ON CONFLICT \(customer_id\) DO UPDATE SET/);
  assert.match(src, /id: row\.id != null \? Number\(row\.id\) : LEGACY_PROJECT_ID/);
  // Before the budget_min migration: saved without it.
  assert.match(src, /MISSING_COLUMN && withBudgetMin\) continue;/);
  assert.match(src, /budgetMin: row\.budget_min \?\? null/);
  const sql = read('../migrations/20261107_move_projects_multiple.sql');
  assert.match(sql, /ADD COLUMN IF NOT EXISTS id bigint GENERATED BY DEFAULT AS IDENTITY/);
  assert.match(sql, /pg_get_constraintdef\(c\.oid\) = 'PRIMARY KEY \(customer_id\)'/);
  assert.doesNotMatch(sql, /\bDROP TABLE\b|\bDELETE\b/);
});

test('a project is called by its own name, else its reason and communes, else "Projet N"', () => {
  const label = (r) => ({ travail: 'Nouveau travail' })[r];
  assert.equal(projectDisplayName({ title: 'Maison de Papa' }, { reasonLabel: label, fallback: 'Projet 1' }), 'Maison de Papa');
  assert.equal(projectDisplayName({ reasons: ['travail'], communes: ['Gombe', 'Ngaliema'] }, { reasonLabel: label, fallback: 'x' }), 'Nouveau travail · Gombe, Ngaliema');
  assert.equal(projectDisplayName({ reasons: [], communes: [] }, { reasonLabel: label, fallback: 'Projet 3' }), 'Projet 3');
  assert.equal(cleanProjectTitle(`  Une   maison ${'x'.repeat(100)} `).length, 60);
  assert.equal(cleanProjectTitle('   '), null);
});

test('a project is always one tap from being edited', () => {
  assert.match(read('app/(site)/compte/client/ClientPortalTabs.js'), /href: '\/compte\/client\/projet'/, 'a tab of its own');
  assert.match(read('app/(site)/compte/client/projet/page.js'), /\/compte\/client\/projet\/\$\{project\.id\}\/modifier/, 'from the list');
  assert.match(read('app/(site)/compte/client/projet/[id]/page.js'), /\/compte\/client\/projet\/\$\{project\.id\}\/modifier/, 'from the project');
  assert.match(read('app/(site)/compte/client/page.js'), /\/compte\/client\/projet\/\$\{project\.id\}\/modifier/, 'from Accueil');
  assert.match(read('app/(site)/compte/client/projet/modifier/page.js'), /\/modifier` : '\/compte\/client\/projet\/nouveau'/, 'the old single-project link still lands somewhere');
});

test('sign-up saves the answers only after the account exists, and never blocks it', () => {
  const src = read('app/(site)/compte/inscription/actions.js');
  const create = src.indexOf('await createCustomer(');
  const save = src.indexOf('await saveProjectAndAlert(');
  assert.ok(create > 0 && save > create);
  assert.match(read('lib/moveProjects.js'), /Never throws/);
  assert.match(src, /\/compte\/client\/projet\/\$\{id\}\?nouveau=1/);
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

test('the place card: the city first, as boxes, then every commune of that city as boxes, up to five', () => {
  const src = read('components/MoveOnboarding.js');
  const place = src.slice(src.indexOf("case 'place': {"), src.indexOf("case 'budget': {"));
  assert.ok(place.indexOf("s('place.cityQuestion')") < place.indexOf("s('place.communesQuestion')"), 'city before communes');
  assert.match(place, /CITIES\.map\(\(c\) => \(\s*<Box/, 'every city is a box');
  assert.match(place, /cityCommunes\.map\(\(key\) => \(\s*<Box/, 'every commune of the chosen city is a box');
  assert.match(place, /toggleMany\('communes', key, 'place', MAX_MOVE_COMMUNES\)/);
  assert.match(place, /\{chosenCity \? \(/, 'no communes before a city is picked');
  assert.match(src, /const cityCommunes = answers\.city \? communesOfCity\(answers\.city\) : \[\];/);
  // A commune of another city is never carried over when the city changes.
  assert.match(src, /communes: a\.communes\.filter\(\(c\) => inCity\.includes\(c\)\)/);
  // The place that matters pre-ticks its commune, visibly, on the same card.
  assert.match(src, /if \(inCity && !a\.communes\.includes\(value\) && a\.communes\.length < MAX_MOVE_COMMUNES\)/);
  assert.equal(MAX_MOVE_COMMUNES, 5);
});

test('"C\'est le bon !" marks the request CONVERTED and stops the alert, unless another search shares it', () => {
  const src = read('app/(site)/compte/client/projet/actions.js');
  const found = src.slice(src.indexOf('export async function markProjectFoundAction'), src.indexOf('export async function pauseProjectAction'));
  assert.match(found, /setMoveProjectStatus\(customerId, project\.id, 'found'\)/);
  assert.match(found, /stopProjectAlert\(customerId, project\)/);
  assert.match(found, /updateLeadStatus\(project\.lastLeadId, 'CONVERTED'\)/);
  assert.match(src, /p\.id !== project\.id && p\.status === 'active'/, 'a shared alert is kept for the other project');
  // A found or paused move never reaches agencies again.
  assert.match(src, /if \(project\.status !== 'active'\) return \{ status: 'error', code: 'send' \};/);
});

test('the story is shared only with explicit consent, and only when there is a story', () => {
  const src = read('app/(site)/compte/client/projet/actions.js');
  assert.match(src, /const consent = formData\.get\('consent'\) === 'on' && Boolean\(story\);/);
  const sql = read('lib/moveProjects.js');
  assert.match(sql, /story_consent_at = CASE WHEN \$5::boolean AND \$4::text IS NOT NULL THEN NOW\(\) ELSE NULL END/);
  // The team sees a story only when its consent is recorded.
  assert.match(read('app/admin/customers/[id]/page.js'), /project\.storyText && project\.storyConsentAt \?/);
  assert.match(read('lib/moveProjectStats.js'), /WHERE to_jsonb\(p\) ->> 'story_consent_at' IS NOT NULL AND to_jsonb\(p\) ->> 'story_text' IS NOT NULL/);
  assert.equal(cleanStory('  a\r\nb\u0001 '), 'a\nb');
  assert.equal(cleanStory('   '), null);
  assert.equal(cleanStory('x'.repeat(2000)).length, 1000);
});

test('"Bien installés ?" is due 30 days after "C\'est le bon !", once', () => {
  const found = (days, extra = {}) => ({ status: 'found', foundAt: new Date(Date.parse('2026-12-31T00:00:00Z') - days * 86_400_000).toISOString(), settledAt: null, ...extra });
  const now = new Date('2026-12-31T00:00:00Z');
  assert.equal(checkinDue(found(29), now), false);
  assert.equal(checkinDue(found(30), now), true);
  assert.equal(checkinDue(found(40, { settledAt: '2026-12-20' }), now), false, 'answered once');
  assert.equal(checkinDue({ ...found(40), status: 'active' }, now), false);
});

test('stages cascade: the furthest real event ticks every stage before it', () => {
  const base = parseMoveProject({ transaction: 'location', city: 'Kinshasa', communes: ['Gombe'] }).project;
  const story = parseMoveProject({ reasons: ['travail'] }).project;
  assert.deepEqual(moveStagesReached({ ...base, status: 'active' }), ['projet', 'recherche']);
  // A visit confirmed outside the usual path still shows the earlier stages done.
  assert.deepEqual(moveStagesReached({ ...story, status: 'active' }, { hasVisit: true }), ['projet', 'recherche', 'demande', 'visites']);
  assert.deepEqual(moveStagesReached({ ...story, status: 'active' }, { hasRequest: true }), ['projet', 'recherche', 'demande']);
  assert.deepEqual(moveStagesReached({ ...story, status: 'found', settledAnswer: 'settled' }), [...MOVE_STAGES]);
  assert.deepEqual(moveStagesReached({ ...story, status: 'active' }), ['projet']);
  assert.deepEqual([...MOVE_STAGES], ['projet', 'recherche', 'demande', 'visites', 'trouve', 'installe']);
});

test('the customer can move their stage forward by hand, never past "found" without confirming', () => {
  const story = parseMoveProject({ reasons: ['travail'] }).project;
  assert.deepEqual([...MOVE_MANUAL_STAGES], ['recherche', 'demande', 'visites']);
  assert.deepEqual(moveStagesReached({ ...story, status: 'active', manualStage: 'visites' }), ['projet', 'recherche', 'demande', 'visites']);
  assert.deepEqual(moveStagesReached({ ...story, status: 'active', manualStage: 'trouve' }), ['projet'], 'not a manual stage');
  // A manual stage never moves a real event back.
  assert.deepEqual(moveStagesReached({ ...story, status: 'active', manualStage: 'recherche' }, { hasVisit: true }).at(-1), 'visites');
  const action = read('app/(site)/compte/client/projet/actions.js');
  assert.match(action, /MOVE_MANUAL_STAGES\.includes\(stage\) && \(await setMoveProjectManualStage\(customerId, project\.id, stage\)\)/);
  const pills = read('app/(site)/compte/client/projet/ProjectJourney.js');
  assert.match(pills, /\?confirmer=trouve#statut/, '"Trouvé" opens the confirmation');
  assert.match(pills, /\?installe=1#checkin/, '"Installé" opens the check-in');
  const page = read('app/(site)/compte/client/projet/[id]/page.js');
  assert.match(page, /if \(lead && at\(lead\.created_at\) >= since\) hasRequest = true;/, 'any request since the project counts');
});

test('close homes by price or by place on request, even when homes match', () => {
  const src = read('lib/moveMatches.js');
  assert.match(src, /const wantPrice = auto \|\| closeMode === 'price';/);
  assert.match(src, /const wantPlace = auto \|\| closeMode === 'place';/);
  const route = read('app/api/move/matches/route.js');
  assert.match(route, /const key = `\$\{closeMode\}\|\$\{query\}`;/, 'the cache keeps the modes apart');
  assert.ok(MOVE_REASONS.includes('inondation') && MOVE_REASONS.includes('fin_bail'));
  assert.ok(MOVE_PRIORITIES.includes('acces') && MOVE_PRIORITIES.includes('transport'));
});

test('a listing fits a project only on fields both state; the wrong kind of home gets no line', () => {
  const project = parseMoveProject({ transaction: 'location', city: 'Kinshasa', communes: ['Gombe'], bedrooms: 3, budgetMax: 700 }).project;
  const rent = (extra) => ({ purpose: 'rent', price: 600, currency: 'USD', price_period: 'mois', beds: 3, commune: 'Gombe', ...extra });
  assert.deepEqual(projectFit(rent({}), project).checks.map((c) => [c.kind, c.ok]), [['bedrooms', true], ['commune', true], ['budget', true]]);
  const off = projectFit(rent({ beds: 2, commune: 'Lingwala', price: 840 }), project);
  assert.deepEqual(off.checks.map((c) => [c.kind, c.ok]), [['bedrooms', false], ['commune', false], ['above', false]]);
  assert.equal(off.score, 0);
  assert.equal(projectFit(rent({ purpose: 'sale' }), project), null, 'a sale is not a rental search');
  assert.deepEqual(projectFit(rent({ beds: null, commune: null, currency: 'CDF' }), project), null, 'nothing comparable, no line');
  assert.ok(MOVE_ANCHORS.includes('eglise'));
});

test('the guest form tells agencies the situation, through the same French brief', () => {
  const src = read('app/(site)/trouver-pour-moi/actions.js');
  assert.match(src, /parseMoveProject\(\{ reasons: String\(formData\.get\('reasons'\) \|\| ''\)\.split\(','\) \}\)/);
  assert.match(src, /moveStory: story \|\| undefined/);
  assert.match(read('components/GuestRequestForm.js'), /name="reasons"/);
});
