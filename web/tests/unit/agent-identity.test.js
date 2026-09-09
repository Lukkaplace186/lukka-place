import test from 'node:test';
import assert from 'node:assert/strict';
import { isPhoneLikeName, displayableAgencyName, agencyInitials } from '@/lib/agentIdentity';

/**
 * The bug these guard: `agents.username` is the account's own phone digits on
 * every account created through WhatsApp onboarding or this app's phone+password
 * signup, and lib/listings.js used to select it as `agency_name`. Cards printed
 * "33766517388" where "NSUMBU Marie" belonged, and the detail page's avatar
 * circle printed the single character "3".
 *
 * The values below are the real live `agents` rows (ids 28, 33, 37-43), not
 * invented fixtures — every agent currently holding an approved listing.
 */

const LIVE_USERNAMES = ['243976321848', '243993960948', '447932673460', '447737127795', '33766517388', '447445787314', '243853580738', '243995305980'];

test('every phone-shaped username live today is rejected as a name', () => {
  for (const username of LIVE_USERNAMES) {
    assert.ok(isPhoneLikeName(username), `${username} should read as a phone`);
    assert.equal(displayableAgencyName(username), null);
    assert.equal(agencyInitials(username), null, 'a digit must never become a monogram');
  }
});

test('a real name survives untouched, including the single-word and accented cases', () => {
  // Agents #41 and #42 live today have a first name and no last name.
  assert.equal(displayableAgencyName('Sisi'), 'Sisi');
  assert.equal(displayableAgencyName('  NSUMBU Marie  '), 'NSUMBU Marie');
  assert.equal(displayableAgencyName('Kkimmo'), 'Kkimmo');
});

test('a username that is genuinely a name is not collateral damage', () => {
  // Agent #43's username really is "Kkimmo", not digits — the phone check must
  // reject phones, not every username.
  assert.equal(displayableAgencyName('Kkimmo'), 'Kkimmo');
  assert.equal(agencyInitials('Kkimmo'), 'K');
});

test('the E.164 floor is 7 digits, matching lib/phone.js and the engine — not 9', () => {
  assert.ok(isPhoneLikeName('1234567'), 'a real 7-digit international number is a phone');
  assert.ok(!isPhoneLikeName('123456'), '6 digits is below E.164 and is not a phone');
  assert.ok(!isPhoneLikeName('1234567890123456'), '16 digits is above E.164');
  assert.ok(isPhoneLikeName('+33766517388'), 'a leading + is still a phone');
});

test('initials are at most two real letters, uppercased', () => {
  assert.equal(agencyInitials('NSUMBU Marie'), 'NM');
  assert.equal(agencyInitials('Agence Test'), 'AT');
  assert.equal(agencyInitials('Ade J'), 'AJ');
  assert.equal(agencyInitials('immo kin plus sarl'), 'IK', 'never more than two');
  assert.equal(agencyInitials("D'Or Immobilier"), 'DO', 'apostrophes split like spaces');
  assert.equal(agencyInitials('Édouard Kabila'), 'ÉK', 'accented initials are letters');
});

test('a name with no letter in it yields no monogram rather than a stray glyph', () => {
  assert.equal(agencyInitials('123 456'), null);
  assert.equal(agencyInitials('—'), null);
  assert.equal(agencyInitials(''), null);
  assert.equal(agencyInitials(null), null);
  assert.equal(agencyInitials(undefined), null);
});

test('null and undefined are answers, not crashes', () => {
  assert.equal(displayableAgencyName(null), null);
  assert.equal(displayableAgencyName(undefined), null);
  assert.equal(isPhoneLikeName(null), false);
  assert.equal(isPhoneLikeName(undefined), false);
});
