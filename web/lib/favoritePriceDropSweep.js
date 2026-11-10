import { formatPrice } from './format';

/**
 * WhatsApp a customer when a listing they SAVED drops in price (2026-11-03).
 * Pure: the cron route (app/api/cron/search-alerts) hands it the reads and
 * the sender, the unit tests hand it fakes.
 *
 * One message per customer per run, naming at most MAX_PER_MESSAGE cuts; a
 * cut is recorded only once the send was accepted, so a failure is retried on
 * the next daily run and a success is never repeated. A session message, like
 * the search alerts: it reaches a customer who wrote to us in the last 24 h.
 */

export const MAX_PER_MESSAGE = 5;
const WHATSAPP_TEXT_MAX = 4096;

function clip(text, max) {
  const value = String(text || '').trim();
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

/** −17 %, from the two real prices. */
export function dropPercent(from, to) {
  const a = Number(from);
  const b = Number(to);
  if (!(a > 0) || !(b > 0) || b >= a) return null;
  return Math.round(((a - b) / a) * 100);
}

export function priceDropMessageText({ drops, siteUrl }) {
  const base = String(siteUrl || 'https://lukkaplace.com').replace(/\/+$/, '');
  const many = drops.length > 1;
  const lines = [
    many
      ? `📉 Lukka Place — ${drops.length} biens que vous avez enregistrés baissent de prix`
      : '📉 Lukka Place — un bien que vous avez enregistré baisse de prix',
    '',
  ];
  for (const d of drops) {
    const percent = dropPercent(d.price_drop_from, d.price);
    const was = formatPrice(d.price_drop_from, d.purpose, d.price_period);
    const now = formatPrice(d.price, d.purpose, d.price_period);
    lines.push(`*${clip(d.title || `Annonce n° ${d.property_id}`, 90)}*`);
    lines.push(`${was} → *${now}*${percent ? ` (−${percent} %)` : ''}`);
    lines.push(`${base}/listings/${d.property_id}`);
    lines.push('');
  }
  lines.push(`Vos biens enregistrés : ${base}/compte/client/favoris`);
  lines.push(`Ne plus recevoir ces messages : ${base}/compte/client/parametres`);
  return lines.join('\n').slice(0, WHATSAPP_TEXT_MAX);
}

/**
 * @param {Object} input
 * @param {string} input.siteUrl
 * @param {Object} input.deps
 *   getDrops() -> rows from lib/favoritePriceDrops.js getUnnotifiedFavoritePriceDrops
 *   send(phone, text) -> resolves when accepted
 *   recordNotified(customerId, drops)
 * @returns {Promise<{customers: number, notifiedCustomers: number, notifiedDrops: number, errors: Object[]}>}
 */
export async function runFavoritePriceDropSweep({ siteUrl, deps }) {
  const result = { customers: 0, notifiedCustomers: 0, notifiedDrops: 0, errors: [] };
  const rows = await deps.getDrops();

  const byCustomer = new Map();
  for (const row of rows) {
    const key = String(row.customer_id);
    if (!byCustomer.has(key)) byCustomer.set(key, { phone: row.phone, drops: [] });
    byCustomer.get(key).drops.push(row);
  }
  result.customers = byCustomer.size;

  for (const [customerId, { phone, drops }] of byCustomer) {
    // Newest cut first; anything past the cap waits for tomorrow's message.
    const batch = drops
      .slice()
      .sort((a, b) => new Date(b.price_drop_at) - new Date(a.price_drop_at))
      .slice(0, MAX_PER_MESSAGE);
    try {
      const first = batch[0];
      await deps.send(phone, priceDropMessageText({ drops: batch, siteUrl }), {
        // For the app (cron route: pushed when the customer has it, else WhatsApp).
        customerId: Number(customerId),
        push: {
          title: batch.length > 1 ? `${batch.length} biens enregistrés baissent de prix` : 'Un bien enregistré baisse de prix',
          body: `${clip(first.title || `Annonce n° ${first.property_id}`, 90)} : ${formatPrice(first.price_drop_from, first.purpose, first.price_period)} → ${formatPrice(first.price, first.purpose, first.price_period)}`,
          url: batch.length > 1 ? '/compte/client/favoris' : `/listings/${first.property_id}`,
        },
      });
      await deps.recordNotified(Number(customerId), batch);
      result.notifiedCustomers += 1;
      result.notifiedDrops += batch.length;
    } catch (err) {
      result.errors.push({ customerId: Number(customerId), error: err.message });
    }
  }
  return result;
}
