import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CONTACT_EVENT_TYPES, CONTACT_MAX_EVENTS, budgetOf, flushRefusals, maskIp, rateLimited,
} from '../../lib/eventIngest.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => fs.readFileSync(path.join(here, '..', '..', rel), 'utf8');

// 2026-11-21: WhatsApp taps fell from ~12 people a day to 3 while the ad sent
// ~3,300 visitors a day; every tracking call shared one 60/min budget per IP,
// and a refused tap left no trace.

test('a customer reaching an agent has its own budget: page views from the same IP never use it up', () => {
  const ip = '41.243.17.9';
  for (let i = 0; i < 60; i += 1) rateLimited(ip);
  assert.equal(rateLimited(ip), true, 'the shared budget is spent');
  assert.equal(rateLimited(`contact:${ip}`, CONTACT_MAX_EVENTS), false, 'a tap still goes through');
  for (let i = 1; i < CONTACT_MAX_EVENTS; i += 1) rateLimited(`contact:${ip}`, CONTACT_MAX_EVENTS);
  assert.equal(rateLimited(`contact:${ip}`, CONTACT_MAX_EVENTS), true, 'a loop of taps is still stopped');
});

test('refusals are logged by budget, with networks shortened — never silent, never a whole address', () => {
  flushRefusals();
  const ip = '102.68.200.4';
  for (let i = 0; i < 61; i += 1) rateLimited(ip);
  const lines = flushRefusals();
  assert.equal(lines.length, 1);
  assert.match(lines[0], /refused 1 event\(s\) .* on the shared budget — 1 network\(s\): 102\.68\.x\.x×1/);
  assert.doesNotMatch(lines[0], /200\.4/);
  assert.deepEqual(flushRefusals(), [], 'counted once');
});

test('budgets and masks: prefixes are budgets, IPv6 addresses are not', () => {
  assert.equal(budgetOf('contact:41.1.2.3'), 'contact');
  assert.equal(budgetOf('vitals:41.1.2.3'), 'vitals');
  assert.equal(budgetOf('41.1.2.3'), 'shared');
  assert.equal(budgetOf('abcd:ef01::1'), 'shared', 'a hex group is an address, not a budget');
  assert.equal(budgetOf('2c0f:f248::1'), 'shared');
  assert.equal(maskIp('contact:41.243.17.9'), '41.243.x.x');
  assert.equal(maskIp('2c0f:f248:1:2::9'), '2c0f:f248:…');
});

test('the tap and call endpoints use the contact budget', () => {
  assert.deepEqual([...CONTACT_EVENT_TYPES], ['call_click', 'whatsapp_click']);
  for (const file of ['app/api/telemetry/lead-click/route.js', 'app/api/telemetry/contact-tap/route.js']) {
    assert.match(read(file), /rateLimited\(contactKey\(request\), CONTACT_MAX_EVENTS\)/, file);
  }
  assert.match(read('app/api/track/route.js'), /contact \? rateLimited\(contactKey\(request\), CONTACT_MAX_EVENTS\) : rateLimited\(clientKey\(request\)\)/);
});
