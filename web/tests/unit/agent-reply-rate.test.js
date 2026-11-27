import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MIN_ALERTS, REPLY_RATE_WINDOW_DAYS, adminReplyRateLine, agentReplyRateCopy, replyRateCell, replyRateSince, replyRateSummary,
} from '../../lib/agentReplyRate.js';
import { filterContactRows, isUnanswered, UNANSWERED_PARAM } from '../../lib/contactLog.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => fs.readFileSync(path.join(here, '..', '..', rel), 'utf8');

test('no row, or no alert, is no figure — never a fabricated 0 %', () => {
  assert.equal(replyRateSummary(null), null);
  assert.equal(replyRateSummary(undefined), null);
  assert.equal(replyRateSummary({ alerted: 0, replied: 0, nothing: 0 }), null);
  assert.equal(agentReplyRateCopy(null), null);
});

test(`below ${MIN_ALERTS} alerts there is no rate: the agent sees nothing, the console sees the counts`, () => {
  const s = replyRateSummary({ alerted: 2, replied: 1, nothing: 0 });
  assert.equal(s.enough, false);
  assert.equal(s.percent, null);
  assert.equal(agentReplyRateCopy(s), null);
  assert.match(adminReplyRateLine(s), /1 alerte sur 2 — moins de 3 alertes, pas de taux/);
  assert.deepEqual(replyRateCell(s), { text: '1/2', low: false });
});

test('the agent reads « Vous nous avez confirmé avoir répondu à 4 clients sur 10 », with the rest and what to do', () => {
  const s = replyRateSummary({ alerted: 10, replied: 4, nothing: 2 });
  assert.deepEqual(
    { alerted: s.alerted, replied: s.replied, nothing: s.nothing, silent: s.silent, percent: s.percent },
    { alerted: 10, replied: 4, nothing: 2, silent: 4, percent: 40 },
  );
  const fr = agentReplyRateCopy(s, 'fr');
  assert.equal(fr.headline, `Vous nous avez confirmé avoir répondu à 4 clients sur 10 ces ${REPLY_RATE_WINDOW_DAYS} derniers jours.`);
  assert.equal(fr.rest, 'Les autres : 2 « Rien reçu », 4 sans réponse à notre alerte.');
  assert.match(fr.why, /ne revient pas/);
  assert.match(fr.todo, /« J’ai répondu »/);
  assert.match(fr.todo, /nous ne voyons pas vos conversations WhatsApp/);
  const en = agentReplyRateCopy(s, 'en');
  assert.match(en.headline, /You confirmed replying to 4 customers out of 10/);
  assert.deepEqual(replyRateCell(s), { text: '4/10 · 40 %', low: true });
});

test('French singular for 0 and 1; the wording never claims we saw the chat', () => {
  assert.match(agentReplyRateCopy(replyRateSummary({ alerted: 3, replied: 1 })).headline, /à 1 client sur 3/);
  assert.match(agentReplyRateCopy(replyRateSummary({ alerted: 3, replied: 0 })).headline, /à 0 client sur 3/);
  for (const s of [{ alerted: 5, replied: 2, nothing: 1 }, { alerted: 3, replied: 3 }]) {
    const copy = agentReplyRateCopy(replyRateSummary(s));
    const all = Object.values(copy).filter(Boolean).join(' ');
    assert.doesNotMatch(all, /vous a écrit|a écrit au client|vous avez écrit/);
  }
  assert.match(agentReplyRateCopy(replyRateSummary({ alerted: 3, replied: 3 })).todo, /Bravo/);
});

test('bad engine values are clamped, never more replies than alerts', () => {
  const s = replyRateSummary({ alerted: '4', replied: 9, nothing: 3 });
  assert.equal(s.replied, 4);
  assert.equal(s.nothing, 0);
  assert.equal(s.silent, 0);
});

test('the window starts 30 days back', () => {
  assert.equal(replyRateSince(new Date('2026-11-21T12:00:00Z')), '2026-10-22T12:00:00.000Z');
});

test('the agent card asks the engine for its own agent only, and shows nothing when the engine fails', () => {
  const card = read('components/AgentReplyRateCard.js');
  assert.match(card, /getContactTapReplyRates\(\{ since: replyRateSince\(\), agentIds: \[agentId\] \}\)/);
  assert.match(card, /catch \(err\)[\s\S]{0,160}return null;/);
  const overview = read('app/compte/agent/page.js');
  assert.match(overview, /<AgentReplyRateCard agentId=\{agentId\} \/>/);
});

test('« Sans réponse » on /admin/contacts: an expected agent answer is missing; repeats and unknowns are not', () => {
  const rows = [
    { key: 'a', status: 'waiting' },
    { key: 'b', status: 'failed' },
    { key: 'c', status: 'replied' },
    { key: 'd', status: 'earlier' },
    { key: 'e', status: 'noAlert' },
    { key: 'f', status: 'notContacted' },
    { key: 'g', status: 'waiting', repeat: true },
    { key: 'h', status: 'visitPending' },
    { key: 'i', status: 'tapOnly' },
  ];
  assert.deepEqual(rows.filter(isUnanswered).map((r) => r.key), ['a', 'b', 'f', 'h']);
  assert.deepEqual(filterContactRows(rows, { unanswered: true }).map((r) => r.key), ['a', 'b', 'f', 'h']);
  assert.equal(filterContactRows(rows, {}).length, rows.length);
  assert.equal(UNANSWERED_PARAM, 'sans');
  // The desk's morning message links to the same filter (engine services/unansweredContacts.js).
  const engine = read('../services/unansweredContacts.js');
  assert.match(engine, /\/admin\/contacts\?reponse=sans/);
  assert.match(read('app/admin/contacts/page.js'), /firstParam\(raw\.reponse\) === UNANSWERED_PARAM/);
});
