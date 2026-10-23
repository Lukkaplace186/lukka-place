// "Créer un agent" / "Vérifier le numéro" (2026-10-23): the team vouches for
// a number with no code from the phone. The engine half is pinned by
// scripts/verify-pipeline.js §66; this pins the form, the wording, and that
// both actions stay admin-only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  BUSINESS_NUMBERS,
  ADMIN_AGENT_ERROR_KEYS,
  parseAdminAgentForm,
  activationShareHref,
  activationShareText,
  adminVerificationNote,
} from '../../lib/adminAgentCreate.js';

const root = path.resolve(import.meta.dirname, '..', '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

function form(fields) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    for (const v of [].concat(value)) data.append(key, v);
  }
  return data;
}

test('the form reads a DRC number in international form and keeps only known communes', () => {
  const parsed = parseAdminAgentForm(
    form({ first_name: ' Patrick ', last_name: 'Mbala', agency_name: 'Immo Limete', phone: '0899 066 066', phoneCountry: 'CD', primary_communes: ['Limete', 'Atlantide', 'Limete'] }),
    ['Limete', 'Lemba'],
  );
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.values, {
    phone: '243899066066', firstName: 'Patrick', lastName: 'Mbala', agencyName: 'Immo Limete', primaryCommunes: ['Limete'],
  });
});

test('an international number goes through lib/phone.js with its country', () => {
  const parsed = parseAdminAgentForm(form({ first_name: 'Awa', phone: '07932 673460', phoneCountry: 'GB' }), []);
  assert.equal(parsed.values.phone, '447932673460');
  assert.equal(parsed.values.lastName, null);
  assert.deepEqual(parsed.values.primaryCommunes, []);
});

test('no first name, a malformed phone or a business number is refused', () => {
  assert.equal(parseAdminAgentForm(form({ first_name: ' ', phone: '0899066066', phoneCountry: 'CD' })).errorKey, ADMIN_AGENT_ERROR_KEYS['name-required']);
  assert.equal(parseAdminAgentForm(form({ first_name: 'A', phone: '12', phoneCountry: 'CD' })).errorKey, ADMIN_AGENT_ERROR_KEYS['phone-invalid']);
  for (const own of BUSINESS_NUMBERS) {
    assert.equal(parseAdminAgentForm(form({ first_name: 'A', phone: `+${own}` })).errorKey, ADMIN_AGENT_ERROR_KEYS['phone-ours']);
  }
});

test('the business numbers match the engine\'s list', () => {
  const engine = read('../services/adminAgentAccounts.js');
  for (const own of BUSINESS_NUMBERS) assert.ok(engine.includes(`'${own}'`), own);
  assert.deepEqual(BUSINESS_NUMBERS, ['243976321848', '243846962654']);
});

test('every engine refusal code has wording in both languages', async () => {
  const fr = JSON.parse(read('lib/i18n/fr.json'));
  const en = JSON.parse(read('lib/i18n/en.json'));
  const lookup = (json, key) => key.split('.').reduce((node, part) => node?.[part], json);
  for (const key of Object.values(ADMIN_AGENT_ERROR_KEYS)) {
    assert.equal(typeof lookup(fr, key), 'string', `fr ${key}`);
    assert.equal(typeof lookup(en, key), 'string', `en ${key}`);
  }
  const engine = read('../services/adminAgentAccounts.js');
  for (const code of Object.keys(ADMIN_AGENT_ERROR_KEYS)) assert.ok(engine.includes(`'${code}'`), code);
});

test('the activation text is a wa.me link the admin sends from their own WhatsApp', () => {
  const link = 'https://lukkaplace.com/compte/agent/activer?phone=243899066066&token=abc';
  const href = activationShareHref({ phone: '243899066066', firstName: 'Patrick', link });
  assert.ok(href.startsWith('https://wa.me/243899066066?text='));
  assert.equal(decodeURIComponent(href.split('?text=')[1]), activationShareText({ firstName: 'Patrick', link }));
  assert.match(activationShareText({ firstName: null, link }), /^Bonjour, votre compte/);
  assert.equal(activationShareHref({ phone: '12', link }), null);
  assert.equal(activationShareHref({ phone: '243899066066', link: null }), null);
});

test('the timeline note says who vouched and that no code was asked', () => {
  assert.match(adminVerificationNote({ created: true, actor: 'Marie <m@lukkaplace.com>' }), /créé .* par Marie <m@lukkaplace\.com>, numéro vérifié sans code/);
  assert.match(adminVerificationNote({ created: false, actor: 'shared-password' }), /vérifié depuis la console par shared-password, sans code/);
});

test('both actions need agents.manage, audit, note, and go through the engine (requireApiKey)', () => {
  const actions = read('app/admin/agents/createAgentActions.js');
  assert.match(actions, /^'use server';/);
  assert.match(actions, /export async function adminCreateAgentAction[\s\S]*?requireAdmin\('agents\.manage'\)/);
  assert.match(actions, /export async function adminVerifyAgentAction[\s\S]*?requireAdmin\('agents\.manage'\)/);
  assert.match(actions, /getLocationHierarchyWithFallback\(\{ city: 'all' \}\)[\s\S]*?parseAdminAgentForm\(formData, communes\)/);
  assert.match(actions, /action: created \? 'agent\.admin_create' : 'agent\.admin_verify'/);
  assert.match(actions, /addNote\(session, 'agent', agentId/);
  // No second agents INSERT on the web side: the engine's onboarding path writes the row.
  assert.doesNotMatch(actions, /INSERT INTO agents/);
  const api = read('lib/adminApi.js');
  assert.match(api, /engineFetch\('\/admin\/agents\/admin-create'/);
  assert.match(api, /\/admin\/agents\/\$\{encodeURIComponent\(agentId\)\}\/admin-verify/);
});

test('the pages show the buttons only to agents.manage, and never on a public path', () => {
  assert.match(read('app/admin/agents/nouveau/page.js'), /if \(!can\(session\?\.role, 'agents\.manage'\)\) notFound\(\)/);
  assert.match(read('app/admin/agents/page.js'), /can\(session\?\.role, 'agents\.manage'\) \?[\s\S]*?\/admin\/agents\/nouveau/);
  assert.match(read('app/admin/agents/[id]/page.js'), /can\(session\?\.role, 'agents\.manage'\) && !agent\.phone_verified_at[\s\S]*?<AdminVerifyAgentButton/);
  const middleware = read('middleware.js');
  assert.doesNotMatch(middleware, /admin\/agents\/nouveau/, 'not in any public allow-list');
  for (const dir of ['app/(site)', 'app/(portfolio)', 'app/api']) {
    const hits = [];
    const walk = (d) => {
      for (const entry of fs.readdirSync(path.join(root, d), { withFileTypes: true })) {
        const rel = path.join(d, entry.name);
        if (entry.isDirectory()) walk(rel);
        else if (/\.(js|mjs)$/.test(entry.name) && /adminCreateAgent|adminVerifyAgent|createAgentActions/.test(read(rel))) hits.push(rel);
      }
    };
    walk(dir);
    assert.deepEqual(hits, [], `${dir} must not reach the admin vouch`);
  }
});

test('ticking "Numéro vérifié" on the profile claims the number\'s listings too', () => {
  const actions = read('app/admin/agents/[id]/actions.js');
  assert.match(actions, /phoneVerified && before && !before\.phone_verified_at && before\.phone[\s\S]*?claimListingsForPhone\(/);
});
