// What Google Play and the App Store require before approving the app
// (2026-11-14): a privacy policy page that covers phone numbers and device
// information, a support page with a way to reach us, and both reachable from
// inside the app.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { PRIVACY_POLICY, privacyPolicyFor } from '@/lib/legal/privacyPolicy';
import { STORE_LEGAL_URLS, SUPPORT_EMAIL, SUPPORT_WHATSAPP_DISPLAY } from '@/lib/legal/contact';
import { TERMS_ARTICLES_FR } from '@/lib/legal/termsFr';
import fr from '@/lib/i18n/fr.json' with { type: 'json' };
import en from '@/lib/i18n/en.json' with { type: 'json' };

const read = (file) => readFileSync(path.join(process.cwd(), file), 'utf8');
const textOf = (copy) => [copy.intro, ...copy.sections.flatMap((s) => [s.title, ...s.paragraphs])].join('\n');

test('the contact details are the ones the owner already publishes', () => {
  const terms = JSON.stringify(TERMS_ARTICLES_FR);
  assert.ok(terms.includes(SUPPORT_EMAIL), 'the e-mail address of the terms, not a new one');
  assert.match(SUPPORT_WHATSAPP_DISPLAY.replace(/\D/g, ''), /^\d{7,15}$/);
  assert.equal(STORE_LEGAL_URLS.privacy, 'https://lukkaplace.com/confidentialite');
  assert.equal(STORE_LEGAL_URLS.support, 'https://lukkaplace.com/contact');
  assert.equal(STORE_LEGAL_URLS.deletion, 'https://lukkaplace.com/confidentialite#suppression');
});

test('privacy policy: French and English say the same things in the same order', () => {
  const { fr: french, en: english } = PRIVACY_POLICY;
  assert.deepEqual(english.sections.map((s) => s.id), french.sections.map((s) => s.id));
  for (const [index, section] of french.sections.entries()) {
    assert.equal(english.sections[index].paragraphs.length, section.paragraphs.length, section.id);
  }
  const ids = french.sections.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length, 'one anchor per section');
  assert.ok(ids.includes('suppression'), 'the stores link to #suppression');
  assert.equal(privacyPolicyFor('en'), english);
  assert.equal(privacyPolicyFor('fr'), french);
  assert.equal(privacyPolicyFor(undefined), french, 'French is the default');
});

test('privacy policy: covers what the stores read it for', () => {
  const french = textOf(PRIVACY_POLICY.fr);
  const english = textOf(PRIVACY_POLICY.en);
  for (const [text, words] of [
    [french, ['numéro de téléphone', 'adresse IP', 'type d’appareil', 'identifiant de notification', 'Supprimer mon compte', 'Nous ne vendons pas', '18 ans', 'LukkaPlace TM SARL']],
    [english, ['phone number', 'IP address', 'kind of device', 'notification identifier', 'Delete my account', 'We do not sell', '18 or over', 'LukkaPlace TM SARL']],
  ]) {
    for (const word of words) assert.ok(text.includes(word), word);
    assert.ok(text.includes(SUPPORT_EMAIL));
    assert.ok(text.includes(SUPPORT_WHATSAPP_DISPLAY));
    // Everyone the code sends personal data to is named.
    for (const party of ['Meta', 'TikTok', 'Google', 'Firebase', 'OpenAI', 'WhatsApp']) assert.ok(text.includes(party), party);
  }
  // The claims below are only true while the app asks for no such permission.
  assert.match(french, /ne demande pas votre position/);
  assert.match(english, /does not ask for your location/);
});

test('the pages the stores are given: the policy with its anchors, the support page with both channels', () => {
  const privacy = read('app/(site)/confidentialite/page.js');
  assert.match(privacy, /privacyPolicyFor\(await getLocale\(\)\)/);
  assert.match(privacy, /id=\{section\.id\}/);
  assert.match(privacy, /href=\{`mailto:\$\{SUPPORT_EMAIL\}`\}/);
  assert.match(privacy, /alternates: \{ canonical: '\/confidentialite' \}/);

  const contact = read('app/(site)/contact/page.js');
  assert.match(contact, /getCentralWhatsAppHref/);
  assert.match(contact, /href=\{`mailto:\$\{SUPPORT_EMAIL\}`\}/, 'an e-mail address, for a reviewer without WhatsApp');
  assert.match(contact, /\/confidentialite#suppression/);
  for (const dict of [fr, en]) {
    assert.doesNotMatch(Object.values(dict.contact).join('\n'), /heures|hours|24 ?h/i, 'no opening hours or answer time: none was decided');
    for (const key of ['emailCta', 'emailLine', 'accountTitle', 'accountText', 'linkDelete', 'linkPrivacy', 'linkTerms']) {
      assert.ok(dict.contact[key], key);
    }
    assert.match(dict.contact.emailLine, /\{email\}/);
  }
});

test('in the app: help, privacy and terms sit at the bottom of both Compte screens', () => {
  const links = read('components/app/AppLegalLinks.js');
  for (const href of ['/contact', '/confidentialite', '/conditions']) assert.ok(links.includes(`href: '${href}'`), href);
  assert.match(links, /min-h-11/, 'small text, full-size tap target');
  assert.doesNotMatch(links, /'use client'/);
  for (const dict of [fr, en]) for (const key of ['label', 'help', 'privacy', 'terms']) assert.ok(dict.appShell.legal[key], key);

  for (const file of ['app/(site)/compte/menu/page.js', 'app/compte/agent/menu/page.js']) {
    const page = read(file);
    assert.match(page, /import AppLegalLinks from '@\/components\/app\/AppLegalLinks';/, file);
    // After sign out: the last thing on the screen.
    assert.ok(page.lastIndexOf('<AppLegalLinks />') > page.lastIndexOf('</form>'), file);
  }
});
