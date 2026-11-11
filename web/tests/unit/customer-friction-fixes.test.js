import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { calls, enqueue, reset } from '../support/fakePool.js';
import {
  createCustomerSessionToken,
  renewedCustomerSessionToken,
  verifyCustomerSessionToken,
  RENEW_WHEN_LEFT_MS,
} from '@/lib/customerAuth';
import { getUnavailableFavorites, similarHomesHref } from '@/lib/favoriteUnavailable';

/**
 * Customer friction review (2026-11-08, owner request): the sign-up, sign-in
 * and account fixes. Behaviour where it can run here; the wiring by source.
 */

beforeEach(() => reset());
const read = (rel) => readFileSync(path.join(process.cwd(), rel), 'utf8');

// --- sign-up ------------------------------------------------------------------

test('a save (♥, alert) opens sign-up on the account card, not the move questions', () => {
  assert.match(read('components/AuthPromptModal.js'), /params\.set\('from', 'save'\)/);
  const page = read('app/(site)/compte/inscription/page.js');
  assert.match(page, /const fromSave = params\.from === 'save';/);
  assert.match(page, /startAtEnd=\{Boolean\(error\) \|\| fromSave\}/);
  const flow = read('components/MoveOnboarding.js');
  assert.match(flow, /const saveOnly = fromSave && isEnd && mode === 'signup' && answeredCount === 0;/);
  assert.match(flow, /account\.move\.account\.fromSave/);
});

test('a refused sign-up returns what was typed (never the password) instead of an empty form', () => {
  const action = read('app/(site)/compte/inscription/actions.js');
  assert.match(action, /export async function signupAction\(_prevState, formData\)/);
  // 'ref' left the list on 2026-11-11: an unknown referral code no longer
  // refuses the account (tests/unit/customer-signup-friction.test.js).
  for (const code of ['name', 'phone', 'password', 'exists']) {
    assert.match(action, new RegExp(`refuse\\('${code}', formData\\)`), code);
  }
  const typed = action.slice(action.indexOf('function typedValues'), action.indexOf('function refuse'));
  assert.doesNotMatch(typed, /password/);
  assert.doesNotMatch(action, /redirect\(`\/compte\/inscription\?error=/);
  const form = read('app/(site)/compte/inscription/SignupForm.js');
  assert.match(form, /useActionState\(action, null\)/);
  assert.match(form, /defaultValue=\{values \? values\.phone : initialPhone\}/);
  assert.match(form, /value=\{password\}/, 'the password stays in the form’s own state');
});

test('the cursor starts on the name, the first field', () => {
  const form = read('app/(site)/compte/inscription/SignupForm.js');
  const name = form.slice(form.indexOf('id="fullName"'), form.indexOf('id="fullName"') + 400);
  assert.match(name, /autoFocus/);
  const phone = form.slice(form.indexOf('<PhoneField'), form.indexOf('<PhoneField') + 500);
  assert.doesNotMatch(phone, /autoFocus/);
});

test('an existing account is said when the number is typed, with "Se connecter avec ce numéro"', () => {
  const action = read('app/(site)/compte/inscription/actions.js');
  assert.match(action, /export async function checkSignupPhoneAction\(rawPhone, country\)/);
  assert.match(action, /rateLimited\(`signup-phone-check:\$\{key\}`, SIGNUP_CHECKS_PER_MINUTE\)/, 'rate-limited per connection');
  assert.match(action, /export async function signInWithNumberAction\(formData\)/);
  const signIn = action.slice(action.indexOf('export async function signInWithNumberAction'));
  assert.match(signIn, /rememberCustomerPhone\(phone\)/, 'the number travels in the cookie, not the URL');
  assert.doesNotMatch(signIn, /params\.set\('phone'/);
  assert.match(signIn, /params\.set\('apres', 'projet'\)/);
  const form = read('app/(site)/compte/inscription/SignupForm.js');
  assert.match(form, /<div onBlur=\{checkNumber\} onInput=\{numberEdited\}>/);
  assert.match(form, /if \(state\) setKnownAccount\(state\.error === 'exists'\);/, 'a refusal for another reason clears it');
  assert.match(form, /formAction=\{signInAction\}/);
  assert.match(form, /formNoValidate/);
});

test('the move answers become a project after signing in from that notice', () => {
  const form = read('app/(site)/compte/connexion/LoginForm.js');
  assert.match(form, /if \(withProject\) setProjectValue\(draftProjectValue\(\)\);/);
  assert.match(form, /name="moveProject"/);
  assert.match(read('app/(site)/compte/connexion/page.js'), /withProject=\{params\.apres === 'projet'\}/);
  const action = read('app/(site)/compte/connexion/actions.js');
  assert.match(action, /saveProjectAndAlert\(Number\(customer\.id\), project, await getT\(\)\)/);
  assert.ok(action.indexOf('saveProjectAndAlert(') > action.indexOf('establishCustomerSession('), 'only once signed in');
});

test('the password has a show/hide eye on sign-up, sign-in and reset', () => {
  const input = read('components/PasswordInput.js');
  assert.match(input, /type=\{shown \? 'text' : 'password'\}/);
  assert.match(input, /aria-pressed=\{shown\}/);
  assert.match(read('app/(site)/compte/inscription/SignupForm.js'), /<PasswordInput/);
  assert.match(read('app/(site)/compte/connexion/LoginForm.js'), /<PasswordInput/);
  assert.match(read('app/(site)/mot-de-passe-oublie/verifier/page.js'), /<PasswordInput id="newPassword"/);
});

// --- sign-in --------------------------------------------------------------------

test('a refused sign-in keeps the number and "too many tries" offers the reset', () => {
  const action = read('app/(site)/compte/connexion/actions.js');
  assert.match(action, /export async function loginAction\(_prevState, formData\)/);
  assert.match(action, /return refuse\(shouldLock \? 'locked' : '1', formData\);/);
  assert.doesNotMatch(action, /redirect\(`\/compte\/connexion\?error=/);
  const form = read('app/(site)/compte/connexion/LoginForm.js');
  assert.match(form, /error === 'locked' \?/);
  assert.match(form, /auth\.errors\.lockedReset/);
});

test('a customer who resets their password is signed in at once', () => {
  const action = read('app/(site)/mot-de-passe-oublie/verifier/actions.js');
  assert.match(action, /if \(attempt\.role === 'customer'\)/);
  assert.match(action, /establishCustomerSession\(\{ id: customer\.id, tokenVersion: customer\.token_version \}\)/);
  assert.match(action, /redirect\('\/compte\/client\?motdepasse=change'\)/);
  assert.match(read('app/(site)/compte/client/page.js'), /params\?\.motdepasse === 'change'/);
});

test('a session is renewed once it is a week old, keeping its token version', () => {
  const fresh = createCustomerSessionToken({ customerId: 9, tokenVersion: 3 });
  assert.equal(renewedCustomerSessionToken(fresh), null, 'a fresh session is left alone');
  const weekOld = createCustomerSessionToken({ customerId: 9, tokenVersion: 3, ttlMs: RENEW_WHEN_LEFT_MS - 1000 });
  const renewed = renewedCustomerSessionToken(weekOld);
  assert.ok(renewed);
  assert.deepEqual(verifyCustomerSessionToken(renewed), { customerId: 9, tokenVersion: 3 });
  assert.ok(Number(renewed.split('.')[2]) > Number(weekOld.split('.')[2]));
  assert.equal(renewedCustomerSessionToken('9.3.1.bad'), null, 'never a forged or expired token');
  const middleware = read('middleware.js');
  assert.match(middleware, /request\.cookies\.get\(IMPERSONATION_COOKIE\) \? null : renewedCustomerSessionToken\(token\)/, 'never a "view as" session');
});

// --- inside the account ---------------------------------------------------------

test('the account tabs carry no running totals', () => {
  const tabs = read('app/(site)/compte/client/ClientPortalTabs.js');
  assert.doesNotMatch(tabs, /countKey: 'savedTotal'/);
  assert.doesNotMatch(tabs, /countKey: 'inquiries'/);
  assert.match(tabs, /dotKey: 'priceDrops'/, 'a real new event still marks the tab');
});

test('offline saved homes are listed with a reason and a link to similar homes, nothing more', async () => {
  enqueue([
    { id: 5, title: 'Appartement Gombe', purpose: 'rent', beds: 2, commune: 'Gombe', closed: true },
    { id: 6, title: null, purpose: 'sale', beds: 0, commune: null, closed: false },
  ]);
  const result = await getUnavailableFavorites(['4', '5', '6', '7'], new Set(['4']));
  assert.deepEqual(result.items.map((i) => [i.id, i.reason]), [[5, 'closed'], [6, 'withdrawn']]);
  assert.deepEqual(result.deletedIds, [7]);
  assert.equal(result.items[0].similarHref, '/listings?transaction_type=location&commune=Gombe&beds_min=2');
  assert.equal(result.items[1].similarHref, '/listings?transaction_type=vente');
  const sql = calls[0].sql;
  assert.match(sql, /NOT \(p\.status = 1 AND p\.approve_status = 1\)/);
  assert.doesNotMatch(sql, /price|featured_image|agent_id|address/, 'no price, photo, agent or address of an offline listing');
  assert.deepEqual(calls[0].values, [[5, 6, 7]]);
  assert.equal(similarHomesHref({}), '/listings');
});

test('a deleted listing is said neutrally: we do not know who removed it', () => {
  for (const lang of ['fr', 'en']) {
    const { deleted } = JSON.parse(read(`lib/i18n/${lang}.json`)).account.favorites.offline;
    assert.doesNotMatch(`${deleted.one} ${deleted.other}`, /agence|agency/i);
  }
});

test('nothing is queried when every saved home is online', async () => {
  assert.deepEqual(await getUnavailableFavorites(['1'], new Set(['1'])), { items: [], deletedIds: [] });
  assert.equal(calls.length, 0);
});

test('the empty pages name the button the listing really shows', () => {
  const fr = JSON.parse(read('lib/i18n/fr.json'));
  assert.match(fr.account.agenda.emptyBody, /« Demander une visite »/);
  assert.equal(fr.account.favorites.scheduleViewing, fr.enquiry.requestViewing);
  assert.match(fr.account.requests.emptyBody2, /WhatsApp directe avec un agent reste dans votre WhatsApp/);
});

test('sign-in and sign-up have no French left outside the dictionary', () => {
  for (const file of ['app/(site)/compte/connexion/page.js', 'app/(site)/compte/inscription/page.js']) {
    const src = read(file);
    for (const phrase of ['Déjà un compte ?', 'Pas encore de compte ?', "title: 'Connexion"]) {
      assert.ok(!src.includes(phrase), `${file} still contains ${phrase}`);
    }
  }
});
