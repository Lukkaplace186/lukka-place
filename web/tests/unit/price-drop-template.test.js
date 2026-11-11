import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { runFavoritePriceDropSweep } from '@/lib/favoritePriceDropSweep';

// baisse_prix_client (approved 2026-11-11): {{1}} first name, {{2}} listing,
// {{3}} old price, {{4}} new price; dynamic link = the listing id. Sent only
// outside the customer's 24 h window; inside it the fuller text goes.

const root = path.resolve(import.meta.dirname, '..', '..');

test('the sweep hands the send its template values: first name, listing, old and new price, listing id', async () => {
  const sent = [];
  await runFavoritePriceDropSweep({
    siteUrl: 'https://lukkaplace.com',
    deps: {
      getDrops: async () => [{
        customer_id: 7, phone: '243990000007', customer_name: 'Dodave Dinanga', property_id: 659,
        title: 'Appartement 2 chambres\nà Gombe', price: 900, purpose: 'rent', price_period: 'mois',
        price_drop_from: 1000, price_drop_at: '2026-11-10T10:00:00Z', whatsapp_opted_out: false,
      }],
      send: async (phone, text, options) => { sent.push({ phone, text, options }); },
      recordNotified: async () => {},
    },
  });
  assert.equal(sent.length, 1);
  const { bodyParams, urlButton } = sent[0].options.template;
  assert.equal(bodyParams[0], 'Dodave');
  assert.equal(bodyParams[1], 'Appartement 2 chambres à Gombe', 'one line: Meta refuses a newline');
  assert.match(bodyParams[2], /1\s?000/);
  assert.match(bodyParams[3], /900/);
  assert.equal(urlButton, '659');
});

test('the cron sends PRICE_DROP_TEMPLATE only outside the window, else the text', () => {
  const src = readFileSync(path.join(root, 'app', 'api', 'cron', 'search-alerts', 'route.js'), 'utf8');
  assert.match(src, /process\.env\.PRICE_DROP_TEMPLATE/);
  assert.match(src, /onlyOutsideWindow: true/);
  assert.match(src, /if \(res\?\.sent !== false\) return;/);
});
