// Listing page, owner's calmer layout (2026-11-18): the story first, one
// "Équipements" list, a compact agent card on phones. Source-level checks
// like mobile-performance.test.js: these are server/client components with
// no DOM in this tier.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (file) => readFileSync(path.join(root, file), 'utf8');
const page = read('app/(site)/listings/[id]/page.js');

// The smoother flow (2026-11-18, second pass): opening block (price, FC,
// heading, facts row, reference) → section strip → agent row (phone) → story
// → Équipements → costs card → map → contact block (phone).
const main = page.slice(page.indexOf('<div className="flex w-full min-w-0 flex-col gap-6">'), page.indexOf('<aside'));

test('the page flows: opening block, agent row, story, équipements, costs card, map, contact', () => {
  const at = (needle) => {
    const i = main.indexOf(needle);
    assert.ok(i >= 0, `missing: ${needle}`);
    return i;
  };
  const order = [
    '<h1',
    '<ListingFactsRow listing={listing} />',
    '<ListingSectionNav',
    '<ListingAgentRow listing={listing} />',
    '<div id="caracteristiques"',
    '<ListingEquipment listing={listing} />',
    '<EntryCostsBreakdown listing={listing} />',
    '<div id="emplacement"',
    '<EnquiryCard',
  ].map(at);
  assert.deepEqual(order, [...order].sort((a, b) => a - b), 'sections out of order');
  assert.equal(page.split('<div id="caracteristiques"').length, 2, 'the story renders once');
  // The costs card sits directly before the map.
  const between = main.slice(at('<EntryCostsBreakdown listing={listing} />'), at('<div id="emplacement"'));
  assert.doesNotMatch(between, /<(ListingEquipment|PropertyDescription|ListingAgentRow)/);
  // The section strip follows page order and no longer lists "Aperçu".
  const nav = page.slice(page.indexOf('const sectionNav = ['), page.indexOf('].filter(Boolean);'));
  assert.doesNotMatch(nav, /id: 'apercu'/);
  assert.ok(nav.indexOf("id: 'caracteristiques'") < nav.indexOf("id: 'couts'"));
  assert.ok(nav.indexOf("id: 'couts'") < nav.indexOf("id: 'emplacement'"));
});

test('sections are separated by a hairline; the costs breakdown is the one card', () => {
  assert.match(page, /const RULE = 'border-t border-line pt-6';/);
  assert.match(main, /<section className="rounded-2xl border border-line bg-surface p-5 empty:hidden sm:p-6">\s*<EntryCostsBreakdown/);
  assert.doesNotMatch(main, /<KeyFacts|<PricePanel|<SimilarAlertButton|<AgentProfileLink/, 'the phone column repeats the rail');
  assert.doesNotMatch(read('components/listings/ListingEquipment.js'), /rounded-2xl border/);
});

test('the opening block: FC equivalent as a quiet line, no rate date; facts in one row', () => {
  const opening = main.slice(0, main.indexOf('<ListingSectionNav'));
  assert.match(opening, /subtextClassName="mt-1 block text-\[0\.875rem\] font-normal/);
  assert.doesNotMatch(opening, /rateNote|updatedAt/);
  const row = read('components/listings/ListingFactsRow.js');
  assert.match(row, /specItems\(listing, t\)/);
  assert.match(row, /terms && !terms\.itemized/);
  assert.match(row, /listings\.facts\.reference/);
});

test('the description leads, cut to four lines with a read-more, then the key features', () => {
  const desc = read('components/listings/PropertyDescription.js');
  const render = desc.slice(desc.indexOf('return ('));
  assert.ok(render.indexOf("t('listings.detail.description')") < render.indexOf("t('listings.detail.keyFeatures')"));
  assert.match(render, /<ReadMoreText[\s\S]*moreLabel=\{t\('agent\.portfolio\.readMore'\)\}/);
  const more = read('components/listings/ReadMoreText.js');
  assert.match(more, /lines = 4/);
  assert.match(more, /WebkitLineClamp: lines/);
  // The button only when the text is really longer than the cut.
  assert.match(more, /\{overflows \|\| open \?/);
});

test('one Équipements list replaces the two cards, declared not verified, each fact once', () => {
  assert.match(page, /<ListingEquipment listing=\{listing\} \/>/);
  assert.doesNotMatch(page, /<UtilityBadges|<PracticalDetails/);
  const eq = read('components/listings/ListingEquipment.js');
  assert.match(eq, /listings\.details\.form\.equipment/);
  assert.match(eq, /listings\.utilities\.declared/);
  assert.match(eq, /DUPLICATE_OF_UTILITY = Object\.freeze\(\{ generator: 'groupe', solar: 'solaire' \}\)/);
  assert.match(eq, /practicalDetailItems\(listing, t\)\.filter\(/);
});

test('the phone agent card is compact; the desktop rail keeps every action', () => {
  assert.match(page, /<EnquiryCard [^>]*saveShare=\{false\} compact \/>/);
  const rail = page.slice(page.indexOf('<aside'));
  assert.match(rail, /<EnquiryCard [^>]*placement="listing_desktop" \/>/);
  assert.doesNotMatch(rail.slice(0, rail.indexOf('</aside>')), /compact/);

  const card = read('components/EnquiryCard.js');
  assert.match(card, /\{!compact && canMessageListing\(listing\) \?/);
  assert.match(card, /\{!compact && agentPhone \?/);
  assert.match(card, /<AddToVisitCartButton\s+variant=\{compact \? 'link' : 'button'\}/);
  // The bottom bar's "Visiter" still needs a visible copy of the dialog's
  // listener on a phone: the compact card keeps it with a hidden anchor.
  assert.match(card, /<VisitRequestButton propertyId=\{id\} hiddenTrigger=\{compact\} \/>/);
  assert.match(card, /<span ref=\{triggerRef\} aria-hidden="true" className="block h-0" \/>/);
});
