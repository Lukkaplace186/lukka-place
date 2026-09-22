import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createTranslator } from '@/lib/i18n/translate';
import { parseShareIds, sharedSelectionMetadata } from '@/lib/sharedSelectionMeta';
import fr from '@/lib/i18n/fr.json' with { type: 'json' };

/**
 * The customer favourites board (reported 2026-09-22): its cards were a
 * static cover with no link to the listing, and "Partager ma sélection" sent
 * a /favoris?ids= link that unfurled as the site's generic logo card.
 */

const ROOT = process.cwd();
const read = (file) => readFileSync(path.join(ROOT, file), 'utf8');
const t = createTranslator({ locale: 'fr', messages: fr });

const listing = (over) => ({
  id: 286,
  title: '2 chambres — Appartement à louer à Limete',
  price: 700,
  purpose: 'rent',
  price_period: 'month',
  beds: 2,
  bath: 1,
  area: '0',
  quartier: 'Funa',
  commune: 'Limete',
  featured_image: 'https://example.supabase.co/storage/v1/object/public/p/cover.jpg',
  gallery: [],
  ...over,
});

test('share ids keep the link\'s order and drop anything non-numeric', () => {
  assert.deepEqual(parseShareIds('301,286,abc,,-4'), [301, 286]);
  assert.deepEqual(parseShareIds(['12,13']), [12, 13]);
  assert.deepEqual(parseShareIds(undefined), []);
});

test('a shared selection previews its first live listing: title, price, facts, photo', () => {
  const meta = sharedSelectionMetadata([286], [listing()], t);
  assert.match(meta.openGraph.title, /^Sélection Lukka Place : 2 chambres — Appartement à louer à Limete — 700/);
  assert.equal(meta.openGraph.description, '2 ch • 1 sdb • Funa, Limete, Kinshasa');
  assert.equal(meta.openGraph.images.length, 1);
  assert.equal(meta.twitter.card, 'summary_large_image');
});

test('the card follows the link order, counts the rest, and skips listings no longer public', () => {
  const rows = [listing({ id: 10, title: 'Premier' }), listing({ id: 11, title: 'Second' })];
  // getListingsByIds returns rows by recency; 99 is gone (unapproved / sold).
  const meta = sharedSelectionMetadata([99, 11, 10], rows, t);
  assert.match(meta.title, /Second/);
  assert.match(meta.description, /\+ 1 autre bien$/);
});

test('nothing public left means no override, so the default card stays', () => {
  assert.equal(sharedSelectionMetadata([5], [], t), null);
});

test('/favoris is a server page that emits the metadata around the client view', () => {
  const page = read('app/(site)/favoris/page.js');
  assert.doesNotMatch(page, /^'use client'/);
  assert.match(page, /export async function generateMetadata/);
  assert.match(read('app/(site)/favoris/FavorisView.js'), /^'use client'/);
});

test('the favourites board card swipes and opens the listing, with its controls outside the link', () => {
  const board = read('app/(site)/compte/client/favoris/FavoritesBoard.js');
  assert.match(board, /<CardImageCarousel/);
  assert.equal((board.match(/<Link href=\{listingHref\}|<Link\s+href=\{listingHref\}/g) || []).length, 2);
  // The checkbox and remove button must not be nested in an anchor.
  const imageLink = board.slice(board.indexOf('<Link\n          href={listingHref}'), board.indexOf('</Link>'));
  assert.doesNotMatch(imageLink, /type="checkbox"|onRemove/);
});
