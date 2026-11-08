import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { hashToStoredForm, hashToStoredFormAsync, verifyAgainstStoredForm, verifyAgainstStoredFormAsync } from '@/lib/authCrypto';
import { rateLimited, SHARED_IP_MAX_EVENTS } from '@/lib/eventIngest';

const here = path.dirname(fileURLToPath(import.meta.url));
const web = path.resolve(here, '..', '..');
const read = (rel) => readFileSync(path.join(web, rel), 'utf8');

// Sign-up audit before the content campaign (2026-11-07), web/CLAUDE.md
// "Sign-up under a rush".

test('a refused sign-up keeps the move answers: the draft is cleared only inside the account', () => {
  const onboarding = read('components/MoveOnboarding.js');
  assert.doesNotMatch(onboarding, /onSubmitCapture/);
  assert.doesNotMatch(onboarding, /clearMoveDraft\(\)/);
  assert.match(read('app/(site)/compte/client/layout.js'), /<ClearMoveDraft \/>/);
  assert.match(read('components/ClearMoveDraft.js'), /clearMoveDraft\(\)/);
});

test('a double tap cannot send the account twice, and a duplicate number reads as "exists"', () => {
  const form = read('app/(site)/compte/inscription/SignupForm.js');
  assert.match(form, /const \{ pending \} = useFormStatus\(\);/);
  assert.match(form, /disabled=\{pending\}/);
  const action = read('app/(site)/compte/inscription/actions.js');
  assert.match(action, /if \(err\.code === '23505'\) return refuse\('exists', formData\);/);
});

test('passwords are hashed off the main thread on sign-up and login, and both forms agree', async () => {
  assert.match(read('app/(site)/compte/inscription/actions.js'), /await hashPasswordAsync\(password\)/);
  const login = read('app/(site)/compte/connexion/actions.js');
  assert.match(login, /await verifyPasswordAgainstHashAsync\(password, customer\.password_hash\)/);
  assert.match(login, /await burnConstantTimeAsync\(password\)/);
  const fromAsync = await hashToStoredFormAsync('motdepasse');
  assert.equal(verifyAgainstStoredForm('motdepasse', fromAsync), true);
  assert.equal(await verifyAgainstStoredFormAsync('motdepasse', hashToStoredForm('motdepasse')), true);
  assert.equal(await verifyAgainstStoredFormAsync('mauvais', fromAsync), false);
  assert.equal(await verifyAgainstStoredFormAsync('x', 'not-a-hash'), false);
});

test('shared mobile IPs: the live results and the beacon allow 600 a minute; others keep 60', () => {
  assert.equal(SHARED_IP_MAX_EVENTS, 600);
  assert.match(read('app/api/move/matches/route.js'), /rateLimited\(`move-matches:\$\{clientKey\(request\)\}`, SHARED_IP_MAX_EVENTS\)/);
  assert.match(read('app/api/telemetry/onboarding/route.js'), /rateLimited\(`onboarding:\$\{clientKey\(request\)\}`, SHARED_IP_MAX_EVENTS\)/);
  const key = `t-${Math.random()}`;
  for (let i = 0; i < 60; i += 1) assert.equal(rateLimited(key), false);
  assert.equal(rateLimited(key), true, 'the default stays 60');
  const shared = `s-${Math.random()}`;
  for (let i = 0; i < 600; i += 1) assert.equal(rateLimited(shared, SHARED_IP_MAX_EVENTS), false);
  assert.equal(rateLimited(shared, SHARED_IP_MAX_EVENTS), true);
});

test('identical live searches are answered from a one-minute memory; the pool is 10', () => {
  const route = read('app/api/move/matches/route.js');
  assert.match(route, /const CACHE_TTL_MS = 60_000;/);
  assert.match(route, /const query = moveSearchQuery\(project\);/);
  assert.match(route, /const hit = cached\(key\);/);
  assert.match(route, /remember\(key, payload\);/);
  assert.match(read('lib/db.js'), /max: Number\.parseInt\(process\.env\.DB_POOL_MAX, 10\) \|\| 10,/);
});
