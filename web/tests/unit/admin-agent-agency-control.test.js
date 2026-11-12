import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

/**
 * "Changer d'agence" on the agent profile (2026-11-12). Chris Lubamba's account
 * was created with an agency of its own (#1037) while he works for Joker Agency
 * (#1024); the profile page the team was on had no way to move him, only the
 * agents list's row menu did.
 */

const root = path.resolve(import.meta.dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const actions = read('app/admin/agents/actions.js');
const page = read('app/admin/agents/[id]/page.js');
const control = read('app/admin/agents/[id]/AgentAgencyControl.js');

function body(source, name) {
  const start = source.indexOf(`export async function ${name}`);
  assert.ok(start >= 0, `${name} exists`);
  const next = source.indexOf('\nexport ', start + 1);
  return source.slice(start, next < 0 ? undefined : next);
}

test('the move is agents.manage only, refuses a deleted agency and reports an emptied one', () => {
  const move = body(actions, 'reassignAgentVendorAction');
  assert.match(move, /requireAdmin\('agents\.manage'\)/);
  assert.match(move, /FROM vendors WHERE id = \$1 AND deleted_at IS NULL/);
  assert.match(move, /details: \{ vendorId, from: previousVendorId \}/, 'the audit keeps where the agent came from');
  assert.match(move, /COUNT\(\*\)::int AS n FROM agents WHERE vendor_id = \$1 AND deleted_at IS NULL/);
  assert.match(move, /return \{ ok: true, previousVendorId, previousLeftEmpty \}/);
  assert.match(move, /revalidatePath\(`\/admin\/agents\/\$\{agentId\}`\)/, 'the profile shows the new agency at once');
});

test('the agency search is a bounded server search, not every agency in a select', () => {
  const search = body(actions, 'searchAgenciesForAgentAction');
  assert.match(search, /requireAdmin\('agents\.manage'\)/);
  assert.match(search, /term\.length < 2\) return \{ ok: true, agencies: \[\] \}/);
  assert.match(search, /listAgenciesForAdmin\(\{ q: term, sort: 'agents', limit: 8 \}\)/);
  assert.ok(!control.includes('getVendors'), 'the dialog never loads the whole vendors table');
  assert.match(control, /searchAgenciesForAgentAction\(term\)/);
  assert.match(control, /reassignAgentVendorAction\(agentId, formData\)/);
});

test('the profile page mounts it for agents.manage on a live account', () => {
  assert.match(page, /import AgentAgencyControl from '\.\/AgentAgencyControl'/);
  assert.match(page, /can\(session\?\.role, 'agents\.manage'\) && !agent\.deleted_at \? \(\s*<AgentAgencyControl/);
});

test('every string the dialog uses exists in both languages', () => {
  const fr = JSON.parse(read('lib/i18n/fr.json'));
  const en = JSON.parse(read('lib/i18n/en.json'));
  const keys = [...control.matchAll(/t\('admin\.agentProfile\.agency\.([a-zA-Z]+)'/g)].map((m) => m[1]);
  assert.ok(keys.length >= 10);
  for (const key of keys) {
    assert.ok(fr.admin.agentProfile.agency[key], `fr ${key}`);
    assert.ok(en.admin.agentProfile.agency[key], `en ${key}`);
  }
});
