import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { agentWhatsappSignupLink, agentWhatsappSignupText, whatsappSignupText } from '@/lib/whatsappSignup';
import { sanitizeSignupStep, SIGNUP_STEPS } from '@/app/api/telemetry/signup-funnel/route';

/**
 * The agent signup page after the 29–30 October 2026 campaign (4,215 phone
 * visitors, 2 reached the code step): WhatsApp route first, the agency
 * optional, the referral code folded away, and a funnel log.
 *
 * The WhatsApp message is only useful if the ENGINE answers it with the
 * signup instructions — so the engine's own matchers are run against the
 * exact text here. quickReplies.js has no dependencies and is required; the
 * customer-signup and referral patterns live in modules that open Chakra or
 * SQLite on load, so their regexes are read out of the source instead.
 */

const require = createRequire(import.meta.url);
const quickReplies = require('../../../services/quickReplies.js');
const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

function regexFromSource(source, name) {
  const match = new RegExp(`const ${name} = (/.+/[a-z]*);`).exec(source);
  assert.ok(match, `${name} not found in the engine source`);
  const literal = match[1];
  const last = literal.lastIndexOf('/');
  return new RegExp(literal.slice(1, last), literal.slice(last + 1));
}

const CUSTOMER_SIGNUP_RE = regexFromSource(read('../../../services/customerOnboarding.js'), 'SIGNUP_RE');
const REFERRAL_PHRASE = regexFromSource(read('../../../services/salesReferral.js'), 'REFERRAL_PHRASE');

test('without a code, the agent message gets the engine signup reply and is never a customer signup', () => {
  const text = agentWhatsappSignupText(null);
  assert.equal(quickReplies.matchQuickReply(text)?.kind, 'signup');
  assert.equal(quickReplies.matchQuickReply(text)?.reply, quickReplies.SIGNUP_REPLY);
  assert.equal(CUSTOMER_SIGNUP_RE.test(text), false);
  assert.equal(REFERRAL_PHRASE.test(text), false);
  assert.notEqual(text, whatsappSignupText(null));
});

test("with a rep's code, the message is read as that referral and still not a customer signup", () => {
  const text = agentWhatsappSignupText('jean01');
  assert.match(text, /Code parrainage : JEAN01$/);
  assert.equal(REFERRAL_PHRASE.exec(text)?.[1].toUpperCase(), 'JEAN01');
  assert.equal(CUSTOMER_SIGNUP_RE.test(text), false);
  // The referral handler only answers a message that is nothing but the code
  // and a greeting: no digit once the phrase is removed, ≤240 characters.
  assert.ok(text.length <= 240);
  assert.equal(/\d/.test(text.replace(REFERRAL_PHRASE, '')), false);
});

test('a malformed code is dropped, and no business number means no link', () => {
  assert.equal(agentWhatsappSignupText('not a code!'), agentWhatsappSignupText(null));
  assert.equal(agentWhatsappSignupLink(null, ''), null);
  const link = agentWhatsappSignupLink(null, '+243 976 321 848');
  assert.ok(link.startsWith('https://wa.me/243976321848?text='));
  assert.equal(decodeURIComponent(link.split('text=')[1]), agentWhatsappSignupText(null));
});

test('the funnel log only writes allow-listed steps and bounded tags', () => {
  const ctx = { source: 'fb', campaign: '120253650320780174', device: 'mobile', viewer: 'visitor', visitor: 'abcdefgh12' };
  for (const step of SIGNUP_STEPS) {
    assert.equal(sanitizeSignupStep({ form: 'agent', step }, ctx)?.step, step);
  }
  assert.equal(sanitizeSignupStep({ form: 'agent', step: 'drop table' }, ctx), null);
  assert.equal(sanitizeSignupStep({ form: 'customer', step: 'submit' }, ctx), null);
  assert.equal(sanitizeSignupStep(null, ctx), null);
  const odd = sanitizeSignupStep({ form: 'agent', step: 'submit' }, { ...ctx, source: 'a b<script>', campaign: 'x'.repeat(65) });
  assert.equal(odd.source, 'direct');
  assert.equal(odd.campaign, null);
});

test('the agency is optional on the page and in the action; the name comes first', () => {
  const page = read('../../app/(site)/compte/agent/inscription/page.js');
  const action = read('../../app/(site)/compte/agent/inscription/actions.js');
  assert.doesNotMatch(action, /redirect\([^)]*error=agency/);
  assert.match(action, /error=name/);

  const agencyInput = /<input\s+id="agency_name"[\s\S]*?\/>/.exec(page)?.[0];
  assert.ok(agencyInput);
  assert.doesNotMatch(agencyInput, /\brequired\b/);
  assert.ok(page.indexOf('id="contact_name"') < page.indexOf('id="agency_name"'));
  assert.doesNotMatch(page, /autoFocus/);
  // The WhatsApp route is offered above the form.
  assert.ok(page.indexOf('data-signup-step="whatsapp_tap"') < page.indexOf('<form'));
  assert.doesNotMatch(page, /Déjà un compte/);
});

test('both dictionaries carry the new agent signup copy with matching placeholders', () => {
  const fr = JSON.parse(read('../../lib/i18n/fr.json')).auth.agentSignup;
  const en = JSON.parse(read('../../lib/i18n/en.json')).auth.agentSignup;
  assert.deepEqual(Object.keys(fr), Object.keys(en));
  assert.match(fr.pitchLive, /\{count\}/);
  assert.match(en.pitchLive, /\{count\}/);
  // Same claim as the engine's WhatsApp reply, never a new one.
  assert.match(quickReplies.SIGNUP_REPLY, /2 mois gratuits/);
  assert.match(fr.pitchFree, /2 mois gratuits/);
});
