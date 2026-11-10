import { parseListingsSearchParams } from './searchQuery';
import { formatPrice } from './format';

/**
 * C1 — instant match (app plan part 2 phase 3, 2026-11-10): a customer with
 * the Lukka Place app hears about a new listing matching a saved search
 * within minutes, instead of in tomorrow's daily alert.
 *
 * Same matching rules as the daily sweep (lib/searchAlertSweep.js): only
 * listings published after the search was saved, never a widened result,
 * nothing already notified. App only — a push that did not go records
 * nothing, so the daily alert still carries the listing on WhatsApp. A
 * listing pushed here is recorded in saved_search_notifications, so the
 * daily alert does not repeat it.
 *
 * At most MAX_PER_DAY instant pushes per customer (a busy search must not
 * buzz a phone all day); the rest wait for the daily alert.
 */
export const INSTANT_LOOKBACK_MINUTES = 40;
export const MAX_PER_DAY = 3;

function clip(text, max) {
  const value = String(text ?? '').replace(/\s+/g, ' ').trim();
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

/**
 * @param {Object} input
 * @param {Date} [input.now]
 * @param {Object} input.deps
 *   getRecentListings({since}) -> [{id, publishedAt}]
 *   getAppSearches() -> saved searches of customers with the app (id, customer_id, query, label, created_at)
 *   getListings(options) -> lib/listings.js getListings() result
 *   getNotified(savedSearchId) -> Set<number>
 *   countToday(customerId) -> number of instant pushes in the last 24 h
 *   push(alert) -> {pushed}
 *   recordNotified(savedSearchId, ids)
 * @returns {Promise<{newListings: number, searches: number, pushed: number, capped: number, errors: Object[]}>}
 */
export async function runInstantMatchSweep({ now = new Date(), deps }) {
  const result = { newListings: 0, searches: 0, pushed: 0, capped: 0, errors: [] };
  const recent = await deps.getRecentListings({ since: new Date(now.getTime() - INSTANT_LOOKBACK_MINUTES * 60 * 1000) });
  result.newListings = recent.length;
  if (recent.length === 0) return result;

  const searches = await deps.getAppSearches();
  result.searches = searches.length;
  const sentToday = new Map();

  for (const search of searches) {
    try {
      const savedAt = new Date(search.created_at).getTime();
      const filters = parseListingsSearchParams(new URLSearchParams(search.query));
      let candidateIds = recent.filter((l) => l.publishedAt.getTime() > savedAt).map((l) => l.id);
      if (Array.isArray(filters.ids)) {
        const allowed = new Set(filters.ids);
        candidateIds = candidateIds.filter((id) => allowed.has(id));
      }
      if (candidateIds.length === 0) continue;

      const matched = await deps.getListings({ ...filters, ids: candidateIds, sort: 'newest', limit: 3 });
      if (matched.locationRelaxed || matched.radiusExpanded || matched.relaxation) continue;
      const already = await deps.getNotified(search.id);
      const fresh = (matched.data || []).filter((listing) => !already.has(Number(listing.id)));
      if (fresh.length === 0) continue;

      const customerId = Number(search.customer_id);
      if (!sentToday.has(customerId)) sentToday.set(customerId, await deps.countToday(customerId));
      if (sentToday.get(customerId) >= MAX_PER_DAY) {
        result.capped += 1;
        continue;
      }

      const top = fresh[0];
      const { pushed } = await deps.push({
        userType: 'customer',
        userId: customerId,
        kind: 'instant_match',
        category: 'search_alerts',
        refId: String(search.id),
        title: fresh.length > 1
          ? `${fresh.length} nouveaux biens pour « ${clip(search.label, 50)} »`
          : `Nouveau bien pour « ${clip(search.label, 50)} »`,
        body: clip(`${top.title} — ${formatPrice(top.price, top.purpose, top.price_period)}`, 200),
        url: `/listings/${top.id}`,
      });
      if (!pushed) continue;
      sentToday.set(customerId, sentToday.get(customerId) + 1);
      await deps.recordNotified(search.id, fresh.map((l) => Number(l.id)));
      result.pushed += 1;
    } catch (err) {
      result.errors.push({ savedSearchId: search.id, error: err.message });
    }
  }
  return result;
}
