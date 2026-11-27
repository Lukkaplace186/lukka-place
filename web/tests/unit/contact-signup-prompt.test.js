import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as fakePool from '../../tests/support/fakePool.js';
import {
  SNOOZE_DAYS, contactSignupAllowed, keepListingNext, returnPath, tappedListingId,
} from '../../lib/contactSignupPrompt.js';
import { CLAIM_CONTACT_TAPS_SQL, CLAIM_LEAD_CLICKS_SQL, claimRecentContactTaps } from '../../lib/contactTapClaim.js';
import { PROMPT_ENTRIES, cleanSignupEntry } from '../../lib/signupFunnelRules.js';

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const DAY = 24 * 60 * 60 * 1000;

/**
 * 2026-11-18 (owner: every contact on /admin/contacts was "Anonyme", because
 * WhatsApp goes straight to the agent). A guest who comes back from WhatsApp
 * is offered "Continuer avec WhatsApp" (the ♥ and alert prompts' own sign-in),
 * and an account made or signed into in the same browser — WhatsApp code,
 * password login or sign-up — takes that browser's taps of the last day.
 */

beforeEach(() => fakePool.reset());

test('the WhatsApp offer: once, then quiet for the snooze period', () => {
  const now = Date.UTC(2026, 10, 18);
  assert.equal(contactSignupAllowed(null, now), true);
  assert.equal(contactSignupAllowed({}, now), true);
  assert.equal(contactSignupAllowed({ dismissedAt: now - DAY }, now), false);
  assert.equal(contactSignupAllowed({ dismissedAt: now - (SNOOZE_DAYS - 1) * DAY }, now), false);
  assert.equal(contactSignupAllowed({ dismissedAt: now - SNOOZE_DAYS * DAY }, now), true);
  assert.equal(contactSignupAllowed({ dismissedAt: 'garbage' }, now), true);
});

test('tap detail and return path are cleaned', () => {
  assert.equal(tappedListingId({ listingId: 914 }), 914);
  assert.equal(tappedListingId({ listingId: '914' }), 914);
  assert.equal(tappedListingId({ listingId: -1 }), null);
  assert.equal(tappedListingId(null), null);
  assert.equal(returnPath({ pathname: '/listings/914', search: '?x=1' }), '/listings/914?x=1');
  assert.equal(returnPath({ pathname: '//evil.example', search: '' }), '/');
  assert.equal(keepListingNext({ pathname: '/listings/914', search: '' }, 914), '/listings/914?lkp_fav_return=914');
  assert.equal(keepListingNext({ pathname: '/listings', search: '?commune=Gombe' }, 12), '/listings?commune=Gombe&lkp_fav_return=12');
  assert.equal(keepListingNext({ pathname: '/', search: '' }, 0), '/');
});

test('the offer is a funnel entry of its own, counted as a prompt', () => {
  assert.equal(cleanSignupEntry('after_whatsapp'), 'after_whatsapp');
  assert.ok(PROMPT_ENTRIES.has('after_whatsapp'));
  for (const lang of ['fr', 'en']) {
    const dict = JSON.parse(read(`lib/i18n/${lang}.json`));
    assert.ok(dict.admin.growth.signup.entries.after_whatsapp, `${lang}: dashboard label for the entry`);
  }
});

test('claiming taps: this browser only, last 24 h, unclaimed visitor taps only', () => {
  for (const sql of [CLAIM_LEAD_CLICKS_SQL, CLAIM_CONTACT_TAPS_SQL]) {
    const text = fakePool.normalizeSql(sql);
    assert.match(text, /SET customer_id = \$1::bigint/);
    assert.match(text, /visitor_id = \$2::text/);
    assert.match(text, /customer_id IS NULL/);
    assert.match(text, /viewer_kind = 'visitor'/);
    assert.match(text, /now\(\) - make_interval\(hours => 24\)/);
  }
});

test('claimRecentContactTaps updates both tap tables and never throws', async () => {
  fakePool.enqueue([]);
  fakePool.enqueue([]);
  await claimRecentContactTaps(42, 'visitor-abc12345');
  assert.equal(fakePool.calls.length, 2);
  assert.deepEqual(fakePool.calls[0].values, [42, 'visitor-abc12345']);
  assert.match(fakePool.calls[0].text, /UPDATE whatsapp_clicks/);
  assert.match(fakePool.calls[1].text, /UPDATE agent_contact_taps/);

  fakePool.reset();
  assert.equal(await claimRecentContactTaps(0, 'visitor-abc12345'), 0);
  assert.equal(await claimRecentContactTaps(42, 'bad id!'), 0, 'a malformed cookie claims nothing');
  assert.equal(fakePool.calls.length, 0);
});

test('every customer sign-in claims the taps, after the session is set', () => {
  for (const [file, who] of [
    ['app/(site)/compte/inscription/actions.js', 'customer.id'],
    ['app/(site)/compte/connexion/actions.js', 'customer.id'],
    // One finishSignIn for the sent code and the WhatsApp message (2026-11-24),
    // and the new-number sign-in (lib/newCustomerSession.js).
    ['app/(site)/compte/connexion/whatsappActions.js', 'id'],
    ['lib/newCustomerSession.js', 'id'],
  ]) {
    const src = read(file);
    const session = src.indexOf('establishCustomerSession(');
    const claim = src.indexOf(`claimRecentContactTaps(${who})`);
    assert.ok(session > 0 && claim > session, `${file}: claims after signing in`);
  }
});

test('every listing WhatsApp tap reaches the prompt, mounted once on the site', () => {
  const analytics = read('lib/analyticsClient.js');
  const trackLeadClick = analytics.slice(analytics.indexOf('export function trackLeadClick'));
  assert.match(trackLeadClick.slice(0, 1200), /dispatchEvent\(new CustomEvent\(WHATSAPP_TAP_EVENT/);
  assert.match(read('app/(site)/layout.js'), /<ContactSignupPrompt \/>/);
  // The sheet is its own chunk since 2026-11-22 (components/ContactSignupSheet.js).
  const prompt = read('components/ContactSignupPrompt.js') + read('components/ContactSignupSheet.js');
  assert.match(prompt, /isLoggedInClient\(\) \|\| isAgentSignedInClient\(\)/, 'never offered to a signed-in customer or agent');
  assert.match(prompt, /const ENTRY = 'after_whatsapp';/);
  assert.match(prompt, /<WhatsAppSignInForm/, 'the same no-password sign-in as the ♥ prompt');
  // Or, with a "homes like this one" search, those results (2026-11-24).
  assert.match(prompt, /similarAlertNext\(tap\.similarQuery, tap\.id\) \|\| keepListingNext\(window\.location, tap\.id\)|similarNext \|\| keepListingNext\(window\.location, tap\.id\)/, 'the contacted listing is kept');
  assert.match(prompt, /snoozeContactSignup\(\)/);
});

test('the ♥ / alert prompt is left as it is (Continuer avec WhatsApp)', () => {
  assert.match(read('components/AuthPromptModal.js'), /<WhatsAppSignInForm /);
});
