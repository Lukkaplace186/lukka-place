import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { calls, enqueue, reset } from '../support/fakePool.js';
import {
  DEFAULT_QUICK_REPLIES,
  QUICK_REPLY_PLACEHOLDERS,
  quickReplyFacts,
  renderQuickReply,
  validateQuickReply,
  whatsappDigits,
} from '@/lib/quickReplyRules';
import {
  listQuickReplies,
  saveQuickReply,
  deleteQuickReply,
  getQuickReplyListings,
  isMissingSchema,
} from '@/lib/quickReplies';

beforeEach(() => reset());

const read = (rel) => readFileSync(path.join(process.cwd(), rel), 'utf8');

const LISTING = {
  id: 293,
  title: 'Appartement 2 chambres',
  price: 700,
  purpose: 'rent',
  price_period: 'mois',
  commune: 'Limete',
  quartier: 'Industriel',
  deposit_months: 3,
  advance_months: '1',
  commission_months: '1',
  is_public: true,
};

test('facts come from the real listing', () => {
  const facts = quickReplyFacts(LISTING, { name: 'Marie' });
  assert.equal(facts.listing_title, 'Appartement 2 chambres');
  assert.equal(facts.price, '700 $ / mois');
  assert.equal(facts.deposit, '3 + 1 + 1 mois');
  assert.equal(facts.commune, 'Limete');
  assert.match(facts.link, /\/listings\/293$/);
  assert.equal(facts.client_name, 'Marie');
});

test('no invented facts: no price, no deposit, pending listing, phone-shaped name', () => {
  const facts = quickReplyFacts({ ...LISTING, price: 0, deposit_months: null, is_public: false }, { name: '243812345678' });
  assert.equal(facts.price, null, '"Prix sur demande" is a label, not a price to quote');
  assert.equal(facts.deposit, null);
  assert.equal(facts.link, null, 'a pending listing link 404s');
  assert.equal(facts.client_name, null);
  assert.equal(quickReplyFacts({ ...LISTING, purpose: 'sale' }).deposit, null, 'a sale has no garantie');
});

test('an unfillable placeholder drops its whole line, never prints raw', () => {
  const body = 'Bonjour,\nPrix : {price}\nGarantie : {deposit}\nInconnu : {nope}\nMerci.';
  const { text, dropped } = renderQuickReply(body, quickReplyFacts({ ...LISTING, deposit_months: null }));
  assert.equal(text, 'Bonjour,\nPrix : 700 $ / mois\nMerci.');
  assert.deepEqual(dropped.sort(), ['deposit', 'nope']);
  assert.ok(!text.includes('{'));
});

test('with no listing every default still renders something sendable or says so', () => {
  const facts = quickReplyFacts(null);
  for (const template of DEFAULT_QUICK_REPLIES) {
    const { text } = renderQuickReply(template.body, facts);
    assert.ok(!text.includes('{'), template.key);
  }
});

test('defaults only use known placeholders and pass validation', () => {
  assert.ok(DEFAULT_QUICK_REPLIES.length >= 4 && DEFAULT_QUICK_REPLIES.length <= 5);
  for (const template of DEFAULT_QUICK_REPLIES) {
    assert.equal(validateQuickReply(template).ok, true, template.key);
  }
});

test('validation refuses empty, too long and unknown placeholders', () => {
  assert.equal(validateQuickReply({ title: '', body: 'x' }).errorKey, 'agent.quickReplies.errors.titleRequired');
  assert.equal(validateQuickReply({ title: 'x'.repeat(61), body: 'x' }).errorKey, 'agent.quickReplies.errors.titleTooLong');
  assert.equal(validateQuickReply({ title: 'x', body: '  ' }).errorKey, 'agent.quickReplies.errors.bodyRequired');
  assert.equal(validateQuickReply({ title: 'x', body: 'y'.repeat(1001) }).errorKey, 'agent.quickReplies.errors.bodyTooLong');
  assert.equal(validateQuickReply({ title: 'x', body: 'Hi {nom}' }).errorKey, 'agent.quickReplies.errors.unknownPlaceholder');
  const ok = validateQuickReply({ title: '  Déjà   loué ', body: 'A\r\nB {price}' });
  assert.deepEqual(ok, { ok: true, title: 'Déjà loué', body: 'A\nB {price}' });
});

test('wa.me gets digits only, and only a plausible number', () => {
  assert.equal(whatsappDigits('+243 81 234 5678'), '243812345678');
  assert.equal(whatsappDigits('12'), null);
  assert.equal(whatsappDigits(null), null);
});

test('an agent with no rows sees the code defaults — nothing inserted by a read', async () => {
  enqueue([]);
  const result = await listQuickReplies(5);
  assert.equal(result.customised, false);
  assert.equal(result.editable, true);
  assert.deepEqual(result.templates.map((t) => t.id), DEFAULT_QUICK_REPLIES.map((d) => `default:${d.key}`));
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /^SELECT/);
});

test('a customised agent sees their live rows; a soft-deleted one is hidden, not replaced by defaults', async () => {
  enqueue([
    { id: '9', title: 'Mine', body: 'B', default_key: null, archived_at: null },
    { id: '10', title: 'Gone', body: 'B', default_key: 'already_taken', archived_at: '2026-09-22' },
  ]);
  const result = await listQuickReplies(5);
  assert.equal(result.customised, true);
  assert.deepEqual(result.templates.map((t) => t.id), ['9']);

  enqueue([{ id: '10', title: 'Gone', body: 'B', default_key: 'x', archived_at: '2026-09-22' }]);
  const emptied = await listQuickReplies(5);
  assert.deepEqual(emptied.templates, [], 'deleting everything leaves nothing, not the defaults');
});

test('editing a default copies the defaults in (only when the agent has none) then updates, all scoped to the agent', async () => {
  const result = await saveQuickReply(5, { id: 'default:entry_terms', title: 'Conditions', body: 'Garantie : {deposit}' });
  // fakePool reports rowCount = rows.length (0) for the UPDATE, so the write reads as not found;
  // what this test pins is the SQL that was sent.
  assert.equal(result.ok, false);
  const sql = calls.map((c) => c.sql);
  assert.equal(sql[0], 'BEGIN');
  assert.match(sql[1], /INSERT INTO agent_quick_replies .* WHERE NOT EXISTS \(SELECT 1 FROM agent_quick_replies WHERE agent_id = \$1\)/);
  assert.match(sql[1], /ON CONFLICT \(agent_id, default_key\) WHERE default_key IS NOT NULL DO NOTHING/);
  assert.equal(JSON.parse(calls[1].values[1]).length, DEFAULT_QUICK_REPLIES.length);
  assert.match(sql[2], /UPDATE agent_quick_replies .* WHERE agent_id = \$1 AND default_key = \$2 AND archived_at IS NULL/);
  assert.deepEqual(calls[2].values.slice(0, 2), [5, 'entry_terms']);
  assert.equal(sql[3], 'ROLLBACK');
});

test('an invalid template or a foreign id format never reaches the database', async () => {
  assert.equal((await saveQuickReply(5, { id: '', title: '', body: 'x' })).ok, false);
  assert.equal((await saveQuickReply(5, { id: 'default:not_a_default', title: 'a', body: 'b' })).ok, false);
  assert.equal((await deleteQuickReply(5, '1 OR 1=1')).ok, false);
  assert.equal(calls.length, 0);
});

test('a new template is capped per agent', async () => {
  enqueue([]); // BEGIN
  enqueue([]); // materialise
  enqueue([{ n: 20, last: 20 }]);
  const result = await saveQuickReply(5, { id: '', title: 'x', body: 'y' });
  assert.deepEqual(result, { ok: false, errorKey: 'agent.quickReplies.errors.tooMany' });
  assert.ok(!calls.some((c) => /INSERT INTO agent_quick_replies \(agent_id, title, body, position\) VALUES/.test(c.sql)));
});

test('delete is a soft delete scoped to the agent', async () => {
  await deleteQuickReply(5, '12');
  const update = calls.find((c) => /archived_at = NOW\(\)/.test(c.sql));
  assert.match(update.sql, /WHERE agent_id = \$1 AND id = \$2 AND archived_at IS NULL/);
  assert.deepEqual(update.values, [5, '12']);
  assert.ok(!calls.some((c) => /DELETE FROM/.test(c.sql)));
});

test('missing table or column degrades instead of throwing', () => {
  assert.equal(isMissingSchema({ code: '42P01' }), true);
  assert.equal(isMissingSchema({ code: '42703' }), true);
  assert.equal(isMissingSchema({ code: '23505' }), false);
});

test('listing facts are read for the agent’s own listings, with the public gate computed', async () => {
  enqueue([{ id: '1', title: 'T', price: '500', purpose: 'rent', is_public: true }]);
  const rows = await getQuickReplyListings(5);
  assert.equal(rows[0].id, 1);
  assert.equal(rows[0].price, 500);
  assert.match(calls[0].sql, /WHERE p\.agent_id = \$1/);
  assert.match(calls[0].sql, /\(p\.status = 1 AND p\.approve_status = 1\) AS is_public/);
});

test('the migration is idempotent and seeds nothing', () => {
  const sql = read('../migrations/20260922_agent_quick_replies.sql');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS agent_quick_replies/);
  assert.match(sql, /BIGINT GENERATED BY DEFAULT AS IDENTITY/);
  assert.match(sql, /REFERENCES agents\(id\) ON DELETE CASCADE/);
  assert.ok(!/INSERT INTO/i.test(sql), 'defaults stay in code');
  for (const stmt of sql.match(/CREATE (UNIQUE )?INDEX[^;]*/g)) assert.match(stmt, /IF NOT EXISTS/);
});

test('shared cards gain exactly one quick-reply element each', () => {
  for (const file of ['components/AgentLeadCard.js', 'components/AgentVisitRequestCard.js']) {
    const src = read(file);
    assert.equal((src.match(/<AgentQuickReplies\b/g) || []).length, 1, file);
  }
  assert.ok(QUICK_REPLY_PLACEHOLDERS.includes('deposit'));
});
