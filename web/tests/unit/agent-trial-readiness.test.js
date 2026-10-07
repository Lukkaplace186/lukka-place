import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { telHref } from '../../lib/phone.js';
import { leadTelHref } from '../../lib/leadContact.js';
import { countryFromAcceptLanguage } from '../../lib/requestCountry.js';
import { parseSearchQuery, searchedPlaceLabel } from '../../lib/searchParser.js';

const read = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');

// Pre-trial audit, 2026-10-07 (agents get access the following week).

test('a call link is international: tel:+<digits>, never a bare tel:243…', () => {
  assert.equal(telHref('243997123456'), 'tel:+243997123456');
  assert.equal(telHref('447932673460'), 'tel:+447932673460');
  assert.equal(telHref('+243 99 712 3456'), 'tel:+243997123456');
  assert.equal(telHref(''), null);
  assert.equal(telHref(null), null);
  assert.equal(telHref('12345'), null);
  assert.equal(leadTelHref('243997123456'), 'tel:+243997123456');
});

test('no storefront call button builds tel: from a raw number', () => {
  for (const file of [
    'components/CallCTA.js',
    'components/EnquiryCard.js',
    'components/MobileListingBar.js',
    'app/(portfolio)/agents/[id]/page.js',
    'app/(site)/compte/client/messages/InquiryThreads.js',
    'app/(site)/rapport/[token]/page.js',
  ]) {
    const src = read(file);
    assert.ok(!/`tel:\$\{/.test(src), `${file} builds a tel: link without telHref`);
  }
});

test('a phone set to plain French or English does not open the number field on France or the US', () => {
  assert.equal(countryFromAcceptLanguage('fr-FR,fr;q=0.9'), 'CD');
  assert.equal(countryFromAcceptLanguage('en-US,en;q=0.9'), 'CD');
  assert.equal(countryFromAcceptLanguage('fr'), 'CD');
  assert.equal(countryFromAcceptLanguage(''), 'CD');
  // A region that differs from the language default is still a real signal.
  assert.equal(countryFromAcceptLanguage('en-GB,en;q=0.9'), 'GB');
  assert.equal(countryFromAcceptLanguage('fr-BE,fr;q=0.9'), 'BE');
  assert.equal(countryFromAcceptLanguage('fr-CA'), 'CA');
  assert.equal(countryFromAcceptLanguage('fr-CD,fr;q=0.9'), 'CD');
  assert.equal(countryFromAcceptLanguage('fr-FR,en-GB;q=0.8'), 'GB');
});

test('the listings search box shows the place that was searched, and reads back to it', () => {
  const cases = [
    [{ commune: 'Bandalungwa' }, 'Bandalungwa'],
    [{ commune: 'Gombe', communes: 'Gombe,Ngaliema' }, 'Gombe ou Ngaliema'],
    [{ commune: 'Lemba', quartier: 'Righini' }, 'Righini'],
    [{ commune: 'Kinshasa' }, 'commune de Kinshasa'],
    [{}, ''],
  ];
  for (const [params, label] of cases) {
    assert.equal(searchedPlaceLabel(params), label);
    if (!label) continue;
    const parsed = parseSearchQuery(label);
    assert.equal(parsed.commune, params.commune, `${label} reads back to ${params.commune}`);
  }
  assert.match(read('components/FilterBar.js'), /searchedPlaceLabel\(defaults\)/);
  assert.match(read('components/MobileMapChrome.js'), /searchedPlaceLabel\(params\)/);
});

test('place suggestions are computed on the keystroke, not only when the API answers', () => {
  const src = read('components/LocationAutocomplete.js');
  // "Aucun lieu ne correspond" used to show while the first request was in
  // flight, and the previous query's places stayed under new text.
  assert.match(src, /remote\.query === trimmedValue/);
  assert.match(src, /searchGazetteer\(trimmedValue, 8\)/);
  assert.ok(!/setResults\(/.test(src), 'results are derived, not set from a response');
});

test('signup does not promise "no verification" while the verify page asks for a WhatsApp code', () => {
  const fr = JSON.parse(read('lib/i18n/fr.json'));
  const en = JSON.parse(read('lib/i18n/en.json'));
  assert.ok(!/aucun code/i.test(fr.auth.signup.noCodeNeeded));
  assert.match(fr.auth.signup.noCodeNeeded, /WhatsApp/);
  assert.ok(!/no verification/i.test(en.auth.signup.noCodeNeeded));
  assert.match(en.auth.signup.noCodeNeeded, /WhatsApp/);
});

test('a listing with 0 rooms or 0 doors prints no "0 ch" / "0 portes"', async () => {
  const { specItems } = await import('../../lib/listingView.js');
  const keys = (listing) => specItems(listing).map((i) => i.key);
  assert.deepEqual(keys({ beds: 0, bath: 0, area: '0', units_count: 0 }), []);
  assert.deepEqual(keys({ beds: 2, bath: 1, units_count: 7 }), ['beds', 'bath', 'units']);
  for (const file of ['components/KeyFacts.js', 'components/PropertyMetrics.js']) {
    assert.ok(!/beds != null \?/.test(read(file)), `${file} shows a 0 bedroom count`);
  }
});

test('a placeholder address ("N/A") is not printed as the place', async () => {
  const { PUBLIC_ADDRESS_EXPR } = await import('../../lib/listings.js');
  assert.match(PUBLIC_ADDRESS_EXPR, /n\/\?a/);
  assert.ok(!PUBLIC_ADDRESS_EXPR.includes(String.fromCharCode(92)), 'no backslash: a template literal would eat it');
  const src = read('lib/listings.js');
  assert.equal(src.match(/\$\{PUBLIC_ADDRESS_EXPR\} AS address/g)?.length, 2, 'both public SELECTs use it');
});
