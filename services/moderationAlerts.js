/**
 * "Une annonce attend votre validation" — a WhatsApp alert to the owners each
 * time a listing lands in the approval queue (`approve_status = 0`), with a
 * link straight to `/admin/listings/<id>`, so a listing can be approved from a
 * phone instead of waiting for someone at a laptop.
 *
 * Two callers:
 *   - db.publishListing, the first time a WhatsApp listing reaches Postgres
 *     (an agent answered OK). A correction's re-sync never alerts.
 *   - POST /admin/moderation-alert, from web's createListingAction (a listing
 *     typed in the agent dashboard).
 *
 * Recipients: ADMIN_ALERT_NUMBERS (comma-separated, the owners' own phones),
 * else the desk (OPS_WHATSAPP_NUMBER). Read at call time.
 *
 * Delivery: MODERATION_ALERT_TEMPLATE when set (UTILITY, fr — body
 * {{1}} listing number, {{2}} what and where, {{3}} agent; one DYNAMIC URL
 * button `https://lukkaplace.com/admin/listings/{{1}}`). Without a template,
 * or when it fails, a session message — which only reaches a phone that
 * messaged the business number in the last 24 hours.
 *
 * Once per listing, ever (`moderation_alerts_sent`), so a redelivery, a resync
 * or a double call cannot alert twice. A failed send does not block a retry.
 */

const chakra = require('./chakra');
const { db } = require('./db');
const { normaliseOpsNumber, opsNumber } = require('./opsDesk');

const SITE_URL = () => (process.env.PUBLIC_SITE_URL || 'https://lukkaplace.com').replace(/\/+$/, '');

db.exec(`
  CREATE TABLE IF NOT EXISTS moderation_alerts_sent (
    property_id INTEGER PRIMARY KEY,
    sent_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    recipients  INTEGER NOT NULL DEFAULT 0
  );
`);

/** Owners' phones, normalised and deduplicated; the desk when none are set. */
function alertRecipients() {
  const listed = String(process.env.ADMIN_ALERT_NUMBERS || '')
    .split(/[,;\s]+/)
    .map(normaliseOpsNumber)
    .filter(Boolean);
  const unique = [...new Set(listed)];
  if (unique.length) return unique;
  const desk = opsNumber();
  return desk ? [desk] : [];
}

function cleanText(value, max = 120) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function priceLine({ price, currency, purpose, pricePeriod }) {
  const amount = Number(price);
  if (!Number.isFinite(amount) || amount <= 0) return 'Prix non indiqué';
  const formatted = Math.round(amount).toLocaleString('fr-FR').replace(/ | /g, ' ');
  const unit = String(currency || 'USD').toUpperCase() === 'CDF' ? 'FC' : '$';
  const isRent = /^(rent|location|louer|à louer)$/i.test(String(purpose || ''));
  const period = !isRent ? '' : /an|year/i.test(String(pricePeriod || '')) ? ' / an' : ' / mois';
  return `${formatted} ${unit}${period}`;
}

/** "Appartement à louer — Industriel, Limete" */
function summaryLine({ type, purpose, place }) {
  const what = cleanText(type, 40) || 'Bien';
  const isRent = /^(rent|location|louer|à louer)$/i.test(String(purpose || ''));
  const isSale = /^(sale|sell|vente|vendre|à vendre)$/i.test(String(purpose || ''));
  const verb = isRent ? ' à louer' : isSale ? ' à vendre' : '';
  const where = cleanText(place, 60);
  return where ? `${what}${verb} — ${where}` : `${what}${verb}`;
}

function alertText(listing) {
  const link = `${SITE_URL()}/admin/listings/${listing.propertyId}`;
  const photos = Number(listing.photoCount) || 0;
  const lines = [
    `🆕 Annonce à valider — n° ${listing.propertyId}`,
    summaryLine(listing),
    `${priceLine(listing)} · ${photos ? `${photos} photo${photos > 1 ? 's' : ''}` : 'aucune photo'}`,
    `Agent : ${cleanText(listing.agentName, 60) || 'non identifié'}${listing.source ? ` (${listing.source})` : ''}`,
    '',
    `👉 Valider ou refuser : ${link}`,
  ];
  return lines.join('\n');
}

async function sendOne(to, listing, text) {
  const template = process.env.MODERATION_ALERT_TEMPLATE;
  if (chakra.templateConfigured(template)) {
    try {
      await chakra.sendTemplate(to, template.trim(), {
        bodyParams: [
          String(listing.propertyId),
          summaryLine(listing),
          cleanText(listing.agentName, 60) || 'non identifié',
        ],
        urlButton: String(listing.propertyId),
      });
      return 'template';
    } catch (err) {
      console.error(`[moderation-alert] template to …${to.slice(-4)} failed (${err.message}) — sending text`);
    }
  }
  try {
    await chakra.sendWhatsAppMessage(to, text, { previewUrl: false });
    return 'session';
  } catch (err) {
    console.error(`[moderation-alert] send to …${to.slice(-4)} failed: ${err.message}`);
    return null;
  }
}

/**
 * Tell the owners a listing is waiting. Never throws.
 *
 * @param {Object} listing
 * @param {number} listing.propertyId   Postgres properties.id.
 * @param {string} [listing.type]       "Appartement", "Maison"…
 * @param {string} [listing.purpose]    rent / sale.
 * @param {string} [listing.place]      "Industriel, Limete".
 * @param {number} [listing.price]
 * @param {string} [listing.currency]
 * @param {string} [listing.pricePeriod]
 * @param {number} [listing.photoCount]
 * @param {string} [listing.agentName]
 * @param {string} [listing.source]     "WhatsApp" / "site".
 * @returns {Promise<{sent: number, skipped?: string}>}
 */
async function alertPendingListing(listing) {
  try {
    const propertyId = Number.parseInt(listing?.propertyId, 10);
    if (!Number.isInteger(propertyId) || propertyId <= 0) return { sent: 0, skipped: 'no-property-id' };
    if (db.prepare('SELECT 1 FROM moderation_alerts_sent WHERE property_id = ?').get(propertyId)) {
      return { sent: 0, skipped: 'already-alerted' };
    }
    const recipients = alertRecipients();
    if (!recipients.length) {
      console.warn(`[moderation-alert] listing #${propertyId}: ADMIN_ALERT_NUMBERS and OPS_WHATSAPP_NUMBER unset — nobody told`);
      return { sent: 0, skipped: 'no-recipient' };
    }

    const full = { ...listing, propertyId };
    const text = alertText(full);
    let sent = 0;
    for (const to of recipients) {
      if (await sendOne(to, full, text)) sent += 1;
    }
    if (sent) {
      db.prepare('INSERT OR IGNORE INTO moderation_alerts_sent (property_id, recipients) VALUES (?, ?)').run(propertyId, sent);
    }
    console.log(`[moderation-alert] listing #${propertyId}: ${sent}/${recipients.length} owner(s) told`);
    return { sent };
  } catch (err) {
    console.error(`[moderation-alert] failed: ${err.message}`);
    return { sent: 0, skipped: 'error' };
  }
}

function capitalise(value) {
  const text = cleanText(value, 40);
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : '';
}

/** The alert for an engine listing row (services/db.js shape). */
function alertForEngineRow(row, propertyId) {
  const place = [row.quartier, row.commune].filter(Boolean);
  const label = place.length === 2 && place[0].toLowerCase() === place[1].toLowerCase() ? [place[0]] : place;
  return alertPendingListing({
    propertyId,
    type: capitalise(row.property_type === 'parcelle' && row.parcelle_subtype ? row.parcelle_subtype : row.property_type),
    purpose: row.transaction_type,
    place: label.join(', '),
    price: row.price,
    currency: row.currency,
    pricePeriod: row.price_period,
    photoCount: Array.isArray(row.photos) ? row.photos.length : 0,
    agentName: row.agent_name,
    source: 'WhatsApp',
  });
}

module.exports = {
  alertPendingListing,
  alertForEngineRow,
  alertRecipients,
  alertText,
  summaryLine,
  priceLine,
};
