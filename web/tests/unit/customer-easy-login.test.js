import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import * as fakePool from '../../tests/support/fakePool.js';
import { getCustomerInquiries } from '../../lib/customerInquiries.js';

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

/**
 * Customer accounts are a number and a password (owner decision,
 * 2026-11-06): no code at signup or login, no confirmation banner, no
 * feature held back for an unconfirmed number. 13 of 30 web customer
 * accounts had been stuck at the code step. Logout ends this device only;
 * the login form remembers the number. Agents are unchanged.
 */

beforeEach(() => fakePool.reset());

test('signup signs in and goes straight on: no code, no verify page', () => {
  const src = read('app/(site)/compte/inscription/actions.js');
  assert.doesNotMatch(src, /sendCustomerOtp|setVerifyAttemptCookie|\/verifier/);
  const created = src.indexOf('createCustomer(');
  const session = src.indexOf('establishCustomerSession(');
  assert.ok(created > 0 && session > created);
  assert.match(src, /name: 'CompleteRegistration'/, 'the ad event moved here from the removed code step');
  // Ends on `next`, or on the move project for someone who answered the
  // "Mon déménagement" cards (2026-11-07) — never a verify step.
  assert.match(src, /redirect\(projectHref && next === '\/compte\/client' \? projectHref : next\);\r?\n\}/);
});

test('login signs in on the right password, without any code step', () => {
  const src = read('app/(site)/compte/connexion/actions.js');
  assert.doesNotMatch(src, /\/compte\/inscription\/verifier|sendCustomerOtp|setVerifyAttemptCookie/);
  // Non-blocking scrypt since 2026-11-07 (verifyPasswordAgainstHashAsync).
  const check = src.search(/verifyPasswordAgainstHash(?:Async)?\(password/);
  const session = src.indexOf('establishCustomerSession(');
  assert.ok(check > 0 && session > check, 'the session still comes only after the password check');
  assert.match(src, /rememberCustomerPhone\(phone\)/);
});

test('agents keep the strict shape: no session before the code', () => {
  assert.match(read('app/(site)/compte/agent/connexion/actions.js'), /phone_verified_at/);
});

test('nothing in the customer area is held back for an unconfirmed number', async () => {
  fakePool.enqueue([{ id: 7, phone: '243990000001', full_name: 'A', token_version: 0, phone_verified_at: null }]);
  await getCustomerInquiries(7).catch(() => {});
  // Past the customer row: the engine lookup by phone is attempted (and
  // fails here, with no engine), rather than returning [] for "unverified".
  assert.doesNotMatch(read('lib/customerInquiries.js'), /if \(!customer\.phone_verified_at\)/);
  assert.doesNotMatch(read('lib/customerPortal.js'), /phone_verified_at/);
  assert.doesNotMatch(read('app/(site)/compte/client/actions.js'), /phone_verified_at/);
  assert.doesNotMatch(read('app/(site)/compte/client/layout.js'), /VerifyPhoneBanner/);
  assert.equal(existsSync(new URL('../../app/(site)/compte/client/VerifyPhoneBanner.js', import.meta.url)), false);
});

test('alerts, price drops and chat reach every customer number that has not opted out', () => {
  assert.doesNotMatch(read('lib/searchAlerts.js'), /c\.phone_verified_at IS NOT NULL/);
  assert.doesNotMatch(read('lib/favoritePriceDrops.js'), /c\.phone_verified_at IS NOT NULL/);
  assert.doesNotMatch(read('lib/chat.js'), /customer\?\.phone_verified_at/);
  const notify = readFileSync(new URL('../../../services/chatNotify.js', import.meta.url), 'utf8');
  assert.doesNotMatch(notify, /c\.phone_verified_at IS NOT NULL/);
});

test('logout ends this device only; deleting the account forgets the remembered number', () => {
  const src = read('app/(site)/compte/actions.js');
  const logout = src.slice(src.indexOf('export async function logoutAction'), src.indexOf('export async function updateNameAction'));
  assert.doesNotMatch(logout, /bumpTokenVersion/);
  assert.doesNotMatch(logout, /forgetRememberedCustomerPhone/);
  assert.match(src.slice(src.indexOf('export async function deleteAccountAction')), /forgetRememberedCustomerPhone\(\)/);
});

test('the login form is prefilled with the remembered number, in its own country', () => {
  assert.match(read('app/(site)/compte/connexion/page.js'), /getRememberedCustomerPhone\(\)/);
  const form = read('app/(site)/compte/connexion/LoginForm.js');
  // A refused sign-in keeps what was typed; otherwise the remembered number.
  assert.match(form, /const phoneValue = values \? values\.phone : defaultPhone;/);
  assert.match(form, /defaultValue=\{phoneValue\}/);
  assert.match(form, /detectCountry=\{!phoneValue\}/);
  assert.match(read('lib/customerSession.js'), /httpOnly: true,[\s\S]*REMEMBERED_PHONE_MAX_AGE/);
});

test('a forgotten password still has two ways back', () => {
  assert.match(read('app/(site)/compte/connexion/LoginForm.js'), /\/mot-de-passe-oublie\?role=customer/);
  assert.match(read('app/(site)/mot-de-passe-oublie/page.js'), /contactSupport/, 'WhatsApp support when the code cannot be sent');
});
