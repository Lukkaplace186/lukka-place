import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizePhone, normalizeStoredPhone, splitPhone, formatPhoneDisplay, phoneFromForm } from '@/lib/phone';
import {
  COUNTRIES,
  DEFAULT_COUNTRY,
  SUGGESTED_COUNTRIES,
  PRIMARY_FOR_DIAL,
  findCountry,
  countryForNumber,
  flagEmoji,
  regionName,
} from '@/lib/countries';

/**
 * The country picker's whole job is to remove a guess from a phone number,
 * so these tests are mostly about the guess NOT happening any more — and
 * about the DRC shorthand that most of this user base types continuing to
 * work exactly as it did.
 */

test('a UK national number with the picked country becomes a real E.164 number', () => {
  // The number in the brief that motivated all of this.
  assert.equal(normalizePhone('07932673460', 'GB'), '447932673460');
  assert.equal(normalizePhone('07932 673 460', 'GB'), '447932673460');
  assert.equal(normalizePhone('7932673460', 'GB'), '447932673460');
  // Confirmed end-to-end in the browser: picking Belgium and typing
  // 0470123456 posts phone=0470123456 + phoneCountry=BE.
  assert.equal(normalizePhone('0470123456', 'BE'), '32470123456');
});

test('the same UK number without a country is refused, not guessed at', () => {
  // This is the regression the picker exists to prevent: the country-less
  // path would otherwise read 07932673460 as a DRC number.
  assert.equal(normalizePhone('07932673460'), null);
  assert.notEqual(normalizePhone('07932673460', 'GB'), '243793267346');
});

test('DRC shorthand still works, with or without the country', () => {
  assert.equal(normalizePhone('0997123456'), '243997123456');
  assert.equal(normalizePhone('997123456'), '243997123456');
  assert.equal(normalizePhone('243997123456'), '243997123456');
  assert.equal(normalizePhone('+243997123456'), '243997123456');

  assert.equal(normalizePhone('0997123456', 'CD'), '243997123456');
  assert.equal(normalizePhone('997123456', 'CD'), '243997123456');
  assert.equal(normalizePhone('243997123456', 'CD'), '243997123456');
});

test('a number already carrying its country code is not double-prefixed', () => {
  assert.equal(normalizePhone('447932673460', 'GB'), '447932673460');
  assert.equal(normalizePhone('0044 7932 673460', 'GB'), '447932673460');
  assert.equal(normalizePhone('+44 7932 673460', 'GB'), '447932673460');
});

test('an explicit + wins over the country still shown in the dropdown', () => {
  // Someone who pasted a full international number meant that number.
  assert.equal(normalizePhone('+33612345678', 'CD'), '33612345678');
});

test('the NANP trunk prefix is 1, not 0', () => {
  assert.equal(normalizePhone('(555) 123-4567', 'US'), '15551234567');
  assert.equal(normalizePhone('1 555 123 4567', 'US'), '15551234567');
  assert.equal(normalizePhone('876 123 4567', 'JM'), '18761234567');
});

test('Italy and Côte d’Ivoire keep the leading zero that is part of the number', () => {
  assert.equal(findCountry('IT').trunk, '');
  assert.equal(findCountry('CI').trunk, '');
  assert.equal(normalizePhone('06 6981 2345', 'IT'), '390669812345');
  assert.equal(normalizePhone('07 12 34 56 78', 'CI'), '2250712345678');
});

test('nonsense and half-typed entries are rejected rather than padded out', () => {
  assert.equal(normalizePhone('', 'GB'), null);
  assert.equal(normalizePhone('abc', 'GB'), null);
  assert.equal(normalizePhone('12', 'GB'), null);
  assert.equal(normalizePhone('0797123456789012345', 'GB'), null); // past E.164's 15 digits
});

test('an unknown country code falls back to the country-less behaviour, never to a wrong country', () => {
  assert.equal(normalizePhone('0997123456', 'ZZ'), '243997123456');
  assert.equal(normalizePhone('07932673460', 'ZZ'), null);
});

test('phoneFromForm reads the number and the country the field posts together', () => {
  const form = new FormData();
  form.set('phone', '07932673460');
  form.set('phoneCountry', 'GB');
  assert.equal(phoneFromForm(form), '447932673460');

  const named = new FormData();
  named.set('whatsapp', '0997123456');
  named.set('whatsappCountry', 'CD');
  assert.equal(phoneFromForm(named, 'whatsapp'), '243997123456');
});

test('a stored E.164 number is validated, never re-guessed', () => {
  // The agent activation link carries a wa_id. Running it back through the
  // country-less normalizePhone would have rejected every non-DRC agent.
  assert.equal(normalizeStoredPhone('447932673460'), '447932673460');
  assert.equal(normalizePhone('447932673460'), null);
  assert.equal(normalizeStoredPhone('243997123456'), '243997123456');
  assert.equal(normalizeStoredPhone('12'), null);
});

test('splitPhone re-opens a stored number into the picker', () => {
  assert.deepEqual(splitPhone('447932673460'), { country: 'GB', national: '7932673460' });
  assert.deepEqual(splitPhone('243997123456'), { country: 'CD', national: '997123456' });
  assert.deepEqual(splitPhone(''), { country: null, national: '' });
});

test('display formatting marks the country on every number, not just DRC ones', () => {
  assert.equal(formatPhoneDisplay('243997123456'), '+243 99 712 3456');
  assert.equal(formatPhoneDisplay('447932673460'), '+44 7932673460');
  assert.equal(formatPhoneDisplay(''), '');
});

test('every country entry is structurally real', () => {
  const seen = new Set();
  for (const country of COUNTRIES) {
    assert.match(country.iso2, /^[A-Z]{2}$/, `bad ISO code: ${country.iso2}`);
    assert.match(country.dial, /^\d{1,4}$/, `bad dial code for ${country.iso2}: ${country.dial}`);
    assert.ok(['', '0', '1'].includes(country.trunk), `bad trunk for ${country.iso2}`);
    assert.ok(!seen.has(country.iso2), `duplicate country: ${country.iso2}`);
    seen.add(country.iso2);
  }
  // A typo'd ISO code would still pass the regex above but resolves to no
  // real region name, which is what this catches. 'XK' (Kosovo) is a known
  // non-ISO user-assigned code and is allowed to name itself.
  const unnamed = COUNTRIES.filter((c) => regionName(c.iso2, 'en') === c.iso2 && c.iso2 !== 'XK');
  assert.deepEqual(unnamed, [], `ISO codes with no real region name: ${unnamed.map((c) => c.iso2).join(', ')}`);
});

test('the platform default and every pinned country are real entries', () => {
  assert.ok(findCountry(DEFAULT_COUNTRY), 'default country must exist');
  assert.equal(findCountry(DEFAULT_COUNTRY).dial, '243');
  for (const iso2 of SUGGESTED_COUNTRIES) {
    assert.ok(findCountry(iso2), `pinned country ${iso2} is not in the list`);
  }
});

test('countryForNumber matches the longest dial code, so +1 never shadows +212', () => {
  assert.equal(countryForNumber('212612345678').iso2, 'MA');
  assert.equal(countryForNumber('15551234567').iso2, 'US');
  assert.equal(countryForNumber('243997123456').iso2, 'CD');
  assert.equal(countryForNumber(''), null);
});

test('every shared dial code names the country it should resolve to', () => {
  const byDial = new Map();
  for (const country of COUNTRIES) {
    if (!byDial.has(country.dial)) byDial.set(country.dial, []);
    byDial.get(country.dial).push(country.iso2);
  }
  for (const [dial, list] of byDial) {
    if (list.length === 1) continue;
    const primary = PRIMARY_FOR_DIAL[dial];
    assert.ok(primary, `+${dial} is shared by ${list.join(', ')} with no primary declared`);
    assert.ok(list.includes(primary), `+${dial}'s primary ${primary} is not one of ${list.join(', ')}`);
  }
});

test('flagEmoji builds a real regional-indicator pair', () => {
  assert.equal(flagEmoji('GB'), '\u{1F1EC}\u{1F1E7}');
  assert.equal(flagEmoji('CD'), '\u{1F1E8}\u{1F1E9}');
  assert.equal(flagEmoji('nope'), '');
});
