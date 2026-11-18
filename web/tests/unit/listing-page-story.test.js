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

test('the description and features come right after the title, before the facts and the agent', () => {
  const story = page.indexOf('<div id="caracteristiques"');
  assert.ok(story > 0, 'story block missing');
  assert.ok(story < page.indexOf('<section id="apercu"'), 'story must precede the facts grid');
  assert.ok(story < page.indexOf('<EnquiryCard'), 'story must precede the agent card');
  assert.equal(page.split('<div id="caracteristiques"').length, 2, 'the story renders once');
  // The section menu follows page order.
  const nav = page.slice(page.indexOf('const sectionNav = ['), page.indexOf('].filter(Boolean);'));
  assert.ok(nav.indexOf("id: 'caracteristiques'") < nav.indexOf("id: 'apercu'"));
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
