import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import * as customers from '@/lib/customers';
import { prefillFromSavedSearch } from '@/lib/requestPrefill';
import { calls, reset } from '../support/fakePool.js';

/**
 * Espace Client finishing touches (Phase 4 of the customer account audit).
 */

const ROOT = process.cwd();
const read = (file) => readFileSync(path.join(ROOT, file), 'utf8');

test.beforeEach(() => reset());

test('a request is pre-filled only from what the saved search really says', () => {
  const options = ['Gombe', 'Ngaliema'];
  assert.deepEqual(
    prefillFromSavedSearch({ query: 'transaction_type=location&commune=Gombe&price_max=900&beds_min=6', label: 'Gombe' }, options),
    { label: 'Gombe', transactionType: 'location', communes: ['Gombe'], budgetMin: '', budgetMax: '900', bedrooms: '4' },
  );
  assert.deepEqual(
    prefillFromSavedSearch({ query: 'commune=Atlantis&transaction_type=lease', label: 'x' }, options),
    null,
    'an unknown commune and an unknown transaction type prefill nothing',
  );
  assert.equal(prefillFromSavedSearch(undefined, options), null);
});

test('a note can only be written on one of the customer\'s own favourites', async () => {
  await customers.setFavoriteNote(7, 301, '  toiture à vérifier  ');
  assert.match(calls[0].sql, /WHERE customer_id = \$1 AND property_id = \$2/);
  assert.deepEqual(calls[0].values, [7, 301, 'toiture à vérifier']);

  reset();
  await customers.setFavoriteNote(7, 301, '   ');
  assert.equal(calls[0].values[2], null, 'an empty note clears it');
});

test('notes are read without depending on the column existing yet', async () => {
  await customers.listFavoriteNotes(7);
  assert.match(calls[0].sql, /to_jsonb\(f\) ->> 'note'/);
});

test('the legacy account pages redirect to the portal instead of drifting beside it', () => {
  assert.match(read('app/(site)/compte/alertes/page.js'), /redirect\('\/compte\/client\?tab=alertes'\)/);
  assert.match(read('app/(site)/compte/demandes/page.js'), /redirect\('\/compte\/client\/messages'\)/);
});

test('"mot de passe oublié" goes to the real self-service reset', () => {
  const source = read('app/(site)/compte/client/parametres/page.js');
  assert.match(source, /href="\/mot-de-passe-oublie"/);
  assert.ok(!source.includes('getCentralWhatsAppHref'));
});

test('no hardcoded French is left in the portal\'s own copy', () => {
  const phrases = {
    'app/(site)/compte/client/page.js': ['>Favoris', '>Alertes'],
    'app/(site)/compte/client/favoris/FavoritesBoard.js': ['sélectionnez-en deux', 'Vous pouvez comparer', 'Uniquement les informations'],
    'app/(site)/compte/client/alertes/AlertsBoard.js': ['recherche${', 'correspond{', "Il n&apos;y a pas encore"],
    'app/(site)/compte/client/messages/InquiryThreads.js': ["'Recherche personnalisée'", 'Demande du {', 'Envoyée le {', 'Proposé par {', ' ch.`', 'messagerie interne'],
    'app/(site)/compte/client/messages/page.js': ["'Messages & Visites — Lukka Place'"],
    'app/(site)/compte/client/demandes/page.js': ['Demande n° {', 'Soumise le {'],
    'app/(site)/compte/client/demandes/RequestForm.js': ["'Envoi en cours…'"],
    'app/(site)/compte/client/messages/EditPropertyRequestDialog.js': ["label: 'Acheter'", '>Chambres<', "'4 et plus'", "'Enregistrement…'"],
    'app/(site)/compte/client/parametres/page.js': ['title="Mon profil"', 'Membre depuis le {', 'Les prix sont enregistrés', 'rattaché au numéro {'],
  };
  for (const [file, list] of Object.entries(phrases)) {
    const source = read(file);
    for (const phrase of list) assert.ok(!source.includes(phrase), `${file} still contains ${phrase}`);
  }
});
