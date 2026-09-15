import { parseListingsSearchParams } from './searchQuery';
import { formatPrice } from './format';

/**
 * One chunk of the saved-search WhatsApp alert sweep — the logic behind
 * app/api/cron/search-alerts/route.js, with every read, write and send passed
 * in so the unit tier can drive it without a database or WhatsApp.
 *
 * WHAT CHANGED, AND WHY
 * The previous sweep loaded EVERY saved search, re-ran each through
 * getListings() against the whole catalogue, and made a WhatsApp call per hit,
 * all inside one HTTP request. Correct at a few hundred searches; a timeout,
 * and a query per search per week, long before 100,000 customers.
 *
 *  1. Nothing new, nothing to do. The chunk first asks which approved
 *     listings were published in the look-back window. None: it returns
 *     straight away without touching a single saved search.
 *  2. Each search is matched against ONLY those listings — getListings() with
 *     `ids` restricted to them. Still the one real definition of a match (the
 *     one /listings and the Alertes tab use), never a second, drifting copy,
 *     but a query over a handful of ids rather than the catalogue.
 *  3. Keyset-paged and time-boxed. The engine's scheduler calls again with the
 *     returned cursor until `done`.
 *
 * A WIDENED RESULT IS NEVER AN ALERT. getListings() quietly relaxes a search
 * that matches nothing (drops the commune for a landmark search, steps the km
 * radius out). Fine on a results page that says so; in a WhatsApp message
 * titled with the customer's own search it would be a listing they did not
 * ask for. The previous sweep sent those.
 */

export const ALERT_LOOKBACK_DAYS = 8;
export const ALERT_BATCH_SIZE = 200;
export const ALERT_TIME_BUDGET_MS = 45 * 1000;
const MAX_LISTINGS_PER_ALERT = 10;
const WHATSAPP_TEXT_MAX = 1000;

function clip(text, max) {
  const value = String(text || '').trim();
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

/**
 * The session-message version of an alert, used when no approved template is
 * configured (or the template send fails). French: it is read by the customer
 * on WhatsApp, and the account has no stored language. Always ends with the
 * way to stop it.
 */
export function alertMessageText({ label, count, topLine, link, manageLink }) {
  const plural = count > 1;
  return [
    `🏠 Lukka Place — ${count} nouveau${plural ? 'x' : ''} bien${plural ? 's' : ''} pour votre alerte « ${clip(label, 120)} »`,
    '',
    clip(topLine, 200),
    link,
    '',
    `Gérer ou arrêter cette alerte : ${manageLink}`,
  ].join('\n').slice(0, WHATSAPP_TEXT_MAX);
}

/**
 * @param {Object} input
 * @param {number} [input.cursor] last saved-search id a previous chunk finished
 * @param {Date} [input.now]
 * @param {string} input.siteUrl absolute origin for links in the message
 * @param {Object} input.deps
 *   getRecentListings({since}) -> [{id, publishedAt: Date}] newest first
 *   getDueSearches({afterId, limit, newestPublishedAt}) -> saved search rows
 *   getListings(options) -> lib/listings.js getListings() result
 *   getNotified(savedSearchId) -> Set<number>
 *   send(phone, {bodyParams, text}) -> resolves when accepted
 *   recordNotified(savedSearchId, ids)
 *   markAlerted(savedSearchId)
 * @returns {Promise<{done: boolean, cursor: number|null, newListings: number, checked: number,
 *   notifiedSearches: number, notifiedListings: number, errors: Object[], warnings: string[]}>}
 */
export async function runAlertSweepChunk({
  cursor = 0,
  now = new Date(),
  siteUrl,
  deps,
  batchSize = ALERT_BATCH_SIZE,
  timeBudgetMs = ALERT_TIME_BUDGET_MS,
  clock = () => Date.now(),
}) {
  const result = {
    done: true, cursor: null, newListings: 0, checked: 0, notifiedSearches: 0, notifiedListings: 0, errors: [], warnings: [],
  };

  const since = new Date(now.getTime() - ALERT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const recent = await deps.getRecentListings({ since });
  result.newListings = recent.length;
  if (recent.length === 0) return result;

  const newestPublishedAt = recent.reduce(
    (latest, listing) => (listing.publishedAt > latest ? listing.publishedAt : latest),
    recent[0].publishedAt,
  );
  const searches = await deps.getDueSearches({ afterId: cursor || 0, limit: batchSize, newestPublishedAt });

  const started = clock();
  let lastId = cursor || 0;
  let timedOut = false;
  let markWarned = false;
  const base = String(siteUrl || 'https://lukkaplace.com').replace(/\/+$/, '');

  for (const search of searches) {
    if (clock() - started > timeBudgetMs) {
      timedOut = true;
      break;
    }
    lastId = Number(search.id);
    result.checked += 1;

    try {
      const savedAt = new Date(search.created_at).getTime();
      const filters = parseListingsSearchParams(new URLSearchParams(search.query));

      // Only listings published after the search was saved: an older one is
      // not "new" to this customer, it is one they never happened to be sent.
      let candidateIds = recent.filter((l) => l.publishedAt.getTime() > savedAt).map((l) => l.id);
      if (Array.isArray(filters.ids)) {
        const allowed = new Set(filters.ids);
        candidateIds = candidateIds.filter((id) => allowed.has(id));
      }
      if (candidateIds.length === 0) continue;

      const matched = await deps.getListings({ ...filters, ids: candidateIds, sort: 'newest', limit: MAX_LISTINGS_PER_ALERT });
      if (matched.locationRelaxed || matched.radiusExpanded) continue;

      const alreadyNotified = await deps.getNotified(search.id);
      const fresh = (matched.data || []).filter((listing) => !alreadyNotified.has(Number(listing.id)));
      if (fresh.length === 0) continue;

      const top = fresh[0];
      // `ids` makes the page agree with the number in the message; the saved
      // query rides along so clearing that chip leaves a working search.
      const params = new URLSearchParams(search.query);
      params.set('ids', fresh.map((l) => l.id).join(','));
      const link = `${base}/listings?${params.toString()}`;
      const topLine = `${top.title} — ${formatPrice(top.price, top.purpose, top.price_period)}`;

      await deps.send(search.phone, {
        bodyParams: [clip(search.label, 120), String(fresh.length), clip(topLine, 200), link],
        text: alertMessageText({
          label: search.label,
          count: fresh.length,
          topLine,
          link,
          manageLink: `${base}/compte/client?tab=alertes`,
        }),
      });

      await deps.recordNotified(search.id, fresh.map((l) => Number(l.id)));
      try {
        await deps.markAlerted(search.id);
      } catch (err) {
        if (!markWarned) {
          result.warnings.push(`last_alerted_at not written (${err.message}) — has the alert preferences migration run?`);
          markWarned = true;
        }
      }
      result.notifiedSearches += 1;
      result.notifiedListings += fresh.length;
    } catch (err) {
      // One bad query string or one failed send must not stop the rest, and a
      // failure records nothing as notified, so it is retried next sweep.
      result.errors.push({ savedSearchId: search.id, error: err.message });
    }
  }

  result.done = !timedOut && searches.length < batchSize;
  result.cursor = result.done ? null : lastId;
  return result;
}
