import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveWhatsAppRouting, ROUTING_TYPES } from '@/lib/leadRouting';
import * as listings from '@/lib/listings';
import { recordLeadClick, RECORD_LEAD_CLICK_SQL } from '@/lib/leadClicks';
import {
  CLOSED_TRANSACTIONS_SQL,
  SET_DIRECT_ROUTING_SQL,
  getClosedTransactions,
  setAgentDirectRouting,
} from '@/lib/adminLeadRouting';
import { getPool } from '@/lib/db';
import { calls, enqueue, normalizeSql, reset } from '../support/fakePool.js';

/**
 * Direct-to-agent lead routing.
 *
 * The rule under test: a listing's WhatsApp button goes straight to the agent
 * ONLY when that agent proved they hold the number and the team has not
 * switched direct routing off. The deciding happens in SQL (lib/listings.js
 * nulls agent_phone otherwise), so the SQL is asserted, not just the helper —
 * a helper test alone would pass with the gate deleted.
 */

const CENTRAL = '243899000000';

// The pre-typed text out of a wa.me href. formatPrice groups thousands with
// toLocaleString('fr-FR'), which emits a narrow no-break space ("1 100") —
// normalised here so the expectations can be written with a plain space.
const messageOf = (href) => decodeURIComponent(href.split('?text=')[1]).replace(/[  ]/g, ' ');

test.beforeEach(() => {
  reset();
  process.env.NEXT_PUBLIC_WHATSAPP_NUMBER = CENTRAL;
});

const LISTING = {
  id: 293,
  reference: 'Petit Boulevard',
  category_name: 'Appartement',
  commune: 'Limete',
  price: 1100,
  purpose: 'rent',
};

test('a verified agent routes DIRECT_WA to their own number, with the storefront message', () => {
  const { routingType, href } = resolveWhatsAppRouting({ ...LISTING, agent_phone: '243821122937' });
  assert.equal(routingType, ROUTING_TYPES.direct);
  assert.ok(href.startsWith('https://wa.me/243821122937?text='), href);
  const text = messageOf(href);
  // The central bot recognises a storefront enquiry by the listing link, so
  // the direct path must carry the same message.
  assert.equal(
    text,
    'Bonjour, je vous contacte via Lukka Place au sujet de ce bien :\n'
      + 'Appartement à Limete — 1 100 $ / mois\n'
      + 'Réf. Petit Boulevard\n'
      + '\n'
      + 'Est-il toujours disponible ? Si oui, quand serait-il possible de le visiter ?\n'
      + '\n'
      + 'https://lukkaplace.com/listings/293',
  );
});

// The screenshot this came from: listing 286 has no reference, and the old
// builder fell back to its slug — "Ref: 2-chambres-appartement-a-louer-a-limete-286".
test('a listing with no reference gets no Réf line — never its slug, never an invented code', () => {
  const { href } = resolveWhatsAppRouting({
    ...LISTING,
    id: 286,
    reference: null,
    slug: '2-chambres-appartement-a-louer-a-limete-286',
    price: 700,
    agent_phone: '243821122937',
  });
  const text = messageOf(href);
  assert.doesNotMatch(text, /R[ée]f/);
  assert.doesNotMatch(text, /2-chambres|null|undefined|LUK-/);
  assert.match(text, /\nAppartement à Limete — 700 \$ \/ mois\n/);
  assert.match(text, /\nhttps:\/\/lukkaplace\.com\/listings\/286$/);
});

test('a sale listing is not quoted per month, and a yearly rent says so', () => {
  const sale = messageOf(
    resolveWhatsAppRouting({ ...LISTING, purpose: 'sale', price: 85000, agent_phone: '243821122937' }).href,
  );
  assert.match(sale, /— 85 000 \$\n/);
  assert.doesNotMatch(sale, /mois/);

  const yearly = messageOf(
    resolveWhatsAppRouting({ ...LISTING, price_period: 'an', agent_phone: '243821122937' }).href,
  );
  assert.match(yearly, /1 100 \$ \/ an/);
});

test('missing type, commune or price never leaves a dangling separator', () => {
  const text = messageOf(
    resolveWhatsAppRouting({ id: 7, reference: null, category_name: null, commune: null, price: null, agent_phone: '243821122937' }).href,
  );
  assert.doesNotMatch(text, / à |— |null|undefined/);
  assert.match(text, /^Bonjour, je vous contacte via Lukka Place au sujet de ce bien :\n\nEst-il/);
});

test('no routable agent number falls back to the central number', () => {
  const { routingType, href } = resolveWhatsAppRouting({ ...LISTING, agent_phone: null });
  assert.equal(routingType, ROUTING_TYPES.central);
  assert.ok(href.startsWith(`https://wa.me/${CENTRAL}?text=`), href);
});

test('central fallback with no central number configured yields no link, never wa.me/undefined', () => {
  delete process.env.NEXT_PUBLIC_WHATSAPP_NUMBER;
  const { routingType, href } = resolveWhatsAppRouting({ ...LISTING, agent_phone: '' });
  assert.equal(routingType, ROUTING_TYPES.central);
  assert.equal(href, null);
});

test('the public listing query only exposes a verified, routing-enabled agent number', async () => {
  enqueue([{ total: '0' }]);
  enqueue([]);
  await listings.getListings({});
  const sql = normalizeSql(calls[1].sql);
  assert.match(
    sql,
    /CASE WHEN a\.phone_verified_at IS NOT NULL AND a\.direct_routing_enabled IS NOT FALSE THEN NULLIF\(TRIM\(a\.phone\), ''\) END AS agent_phone/,
  );
  assert.ok(!/a\.phone AS agent_phone/.test(sql), 'the raw, ungated phone must not reach a public query');
});

test('a lead click takes its agent from the listing row, never from the request body', async () => {
  await recordLeadClick(getPool(), {
    listingId: 293, commune: 'Limete', device: 'mobile', source: 'direct', price: 1100, routingType: 'DIRECT_WA',
  });
  const call = calls[calls.length - 1];
  assert.equal(normalizeSql(call.sql), normalizeSql(RECORD_LEAD_CLICK_SQL));
  assert.match(normalizeSql(call.sql), /\(SELECT agent_id FROM properties WHERE id = \$1\)/);
  assert.deepEqual(call.values, [293, 'Limete', 'mobile', 'direct', 1100, 'DIRECT_WA']);
});

test('an unknown routing type is refused rather than stored', async () => {
  await assert.rejects(
    () => recordLeadClick(getPool(), { listingId: 1, routingType: 'SOMEWHERE' }),
    /unknown routing type/,
  );
});

test('the admin switch cannot turn direct routing ON for an unverified number', async () => {
  assert.match(normalizeSql(SET_DIRECT_ROUTING_SQL), /\(\$2 = false OR phone_verified_at IS NOT NULL\)/);
  enqueue([]); // the guarded UPDATE matched nothing
  assert.equal(await setAgentDirectRouting(12, true), false);
  assert.deepEqual(calls[calls.length - 1].values, [12, true]);
});

test('closed transactions read approve_status only, so sold (status = 0) listings are included', async () => {
  enqueue([{ id: '5', price_source: 'WHATSAPP_AGENT_REPLY', list_price_usd: '750', sold_price_usd: '700', price_delta_pct: '-6.67' }]);
  const rows = await getClosedTransactions({ limit: 10 });
  const sql = normalizeSql(CLOSED_TRANSACTIONS_SQL);
  assert.match(sql, /p\.approve_status = 1/);
  assert.ok(!/p\.status = 1/.test(sql), 'filtering on status would drop every sold listing');
  assert.equal(rows[0].priceDeltaPct, -6.67);
  assert.equal(rows[0].soldPriceUsd, 700);
});
