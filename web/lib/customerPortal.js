import 'server-only';
import { cache } from 'react';
import { getCurrentCustomerId, getCustomerById, listFavoriteIds, listSavedSearches } from './customers';
import { getLeadCountsByWaIds } from './adminApi';

/**
 * Shared server-side data for the Espace Client portal (`/compte/client/*`).
 *
 * The portal's layout renders the tab bar with real counts on every one of
 * its pages, and several pages then need the same underlying rows again.
 * Extracted here rather than re-derived per page — the same reason
 * lib/alerts.js exists (see its doc comment): N copies of one mapping drift
 * the moment one of them isn't updated.
 *
 * Everything here is real. There is deliberately no "unread messages" or
 * "upcoming viewings" count invented from nothing: the viewing count below
 * is a real count of the customer's own leads sitting at a viewing-stage
 * status, and nothing else.
 */

/**
 * The two LEAD_STATUSES (lib/adminLabels.js) that represent a viewing.
 *
 * No longer the main viewing signal. The engine now exposes a customer's own
 * `viewing_requests` (GET /admin/viewing-requests/by-customer), with the
 * agent's answer, the agreed time and the post-visit check-in, and
 * lib/customerInquiries.js attaches them to each lead. This remains only for
 * leads that carry a viewing status with no request row behind them (the
 * WhatsApp assistant's older rows). The comment here used to say that table
 * was unreachable from this app; it was, until it wasn't.
 */
export const VIEWING_LEAD_STATUSES = ['VIEWING_REQUESTED', 'VIEWING_COMPLETED'];

export function isViewingLead(lead) {
  return VIEWING_LEAD_STATUSES.includes(lead?.status);
}

/**
 * Resolves the signed-in customer, or null. Callers redirect; this never
 * does, so it stays usable from both the layout and each page.
 *
 * Memoised per request: the layout and the page both ask, and before this
 * each portal navigation read the session and the customer row twice.
 *
 * @returns {Promise<{customerId: number, customer: Object}|null>}
 */
export const getPortalCustomer = cache(async () => {
  const customerId = await getCurrentCustomerId();
  if (!customerId) return null;
  const customer = await getCustomerById(customerId);
  if (!customer) return null;
  return { customerId, customer };
});

/**
 * Real counts for the portal tab bar.
 *
 * Deliberately does NOT re-run every saved search through getListings() the
 * way lib/alerts.js's getSavedSearchMatches does — that is a query per
 * saved search, and this runs on every page of the portal. The Alertes page
 * itself still computes the real new-match counts; the tab badge is the
 * number of saved searches, which is what it says it is.
 *
 * Requests come from the engine's COUNT endpoint (`GET /admin/leads/counts`),
 * not from getCustomerInquiries. That call is a lead list, a proposals
 * lookup and a Postgres listings read, and the layout used to make it on
 * every tab — including Favoris, which shows none of it — while Messages
 * and Demandes then made it again. `viewings` is now a count of real
 * `viewing_requests` rows rather than leads at a viewing-stage status,
 * which the web visit form never set.
 *
 * `inquiries`/`viewings` are null when the engine is unreachable, so the
 * badge is omitted rather than claiming zero.
 *
 * @returns {Promise<{favorites: number, alerts: number, inquiries: number|null, viewings: number|null}>}
 */
export async function getPortalCounts(customerId) {
  const customer = await getCustomerById(customerId);
  const [favoriteIds, savedSearches, leadCounts] = await Promise.all([
    listFavoriteIds(customerId),
    listSavedSearches(customerId),
    customer?.phone
      ? getLeadCountsByWaIds([customer.phone]).catch((error) => {
        console.warn('[customerPortal] lead counts unavailable:', error.message);
        return null;
      })
      : Promise.resolve({}),
  ]);

  const own = leadCounts ? leadCounts[customer?.phone] || { leads: 0, viewings: 0 } : null;
  return {
    favorites: favoriteIds.length,
    alerts: savedSearches.length,
    inquiries: own ? own.leads : null,
    viewings: own ? own.viewings : null,
  };
}

/**
 * A human-readable one-line summary of a custom property request, built
 * from the real values the customer picked on the Demandes form. This is
 * what gets written to the lead's `requirements_summary` column — the
 * engine's POST /admin/leads accepts that field but not the structured
 * `transaction_type`/`commune`/`price_min`/`price_max`/`bedrooms` columns,
 * so a single honest summary string is the real, reachable shape here.
 *
 * @param {{transactionType?: string, communes?: string[], bedrooms?: string,
 *          budgetMin?: string, budgetMax?: string, movingDate?: string,
 *          flexibility?: string, notes?: string}} input
 */
export function buildRequirementsSummary({
  transactionType,
  communes = [],
  bedrooms,
  budgetMin,
  budgetMax,
  movingDate,
  flexibility,
  notes,
} = {}) {
  const parts = [];

  if (transactionType === 'vente') parts.push('Achat');
  else if (transactionType === 'location') parts.push('Location');

  if (communes.length > 0) parts.push(communes.join(', '));

  if (bedrooms) parts.push(bedrooms === 'studio' ? 'Studio' : `${bedrooms} chambres`);

  const min = budgetMin ? Number(budgetMin) : null;
  const max = budgetMax ? Number(budgetMax) : null;
  const fmt = (n) => `$${n.toLocaleString('en-US')}`;
  if (Number.isFinite(min) && min > 0 && Number.isFinite(max) && max > 0) parts.push(`Budget ${fmt(min)} – ${fmt(max)}`);
  else if (Number.isFinite(min) && min > 0) parts.push(`Budget à partir de ${fmt(min)}`);
  else if (Number.isFinite(max) && max > 0) parts.push(`Budget jusqu'à ${fmt(max)}`);

  if (movingDate) parts.push(`Entrée souhaitée : ${movingDate}`);
  if (flexibility) parts.push(flexibility);

  const summary = parts.join(' · ');
  const trimmedNotes = (notes || '').trim();
  if (!trimmedNotes) return summary;
  return summary ? `${summary}\n${trimmedNotes}` : trimmedNotes;
}
