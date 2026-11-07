import 'server-only';
import { getListings, getNearbyExtras } from './listings';
import { parseListingsSearchParams } from './searchQuery';
import { listingImages, feedLocationLine } from './listingView';
import { formatPriceParts } from './format';
import { closeMatchTags, moveSearchQuery, stretchedBudget } from './moveProjectRules';

/**
 * The homes a move project finds (2026-11-07): the exact matches, and — when
 * there are fewer than CLOSE_WHEN_FEWER_THAN — the closest real alternatives,
 * each with WHY it is close (closeMatchTags): a little above or below the
 * budget range (±MOVE_BUDGET_STRETCH, 25 %, at the chosen communes), or in a nearby commune
 * (lib/listings.js getNearbyExtras: distance from real commune centres, the
 * same rule /listings uses). Close homes are listed apart from exact ones and
 * never counted with them. One without a reason it can show is left out.
 *
 * Used by the budget card's live preview (/api/move/matches) and by
 * /compte/client/projet. Public approved listings only (getListings' gate).
 */

export const CLOSE_WHEN_FEWER_THAN = 4;

/**
 * @param {object} project parseMoveProject's shape
 * @returns {Promise<null | {query: string, total: number, exact: object[], close: Array<{listing: object, tags: object[]}>}>}
 */
export async function getMoveMatches(project, { exactLimit = 8, closeLimit = 6, withClose = true } = {}) {
  const query = moveSearchQuery(project);
  if (!query) return null;
  const base = parseListingsSearchParams(new URLSearchParams(query));
  const exact = await getListings({ ...base, sort: 'newest', limit: exactLimit });
  const seen = new Set(exact.data.map((l) => Number(l.id)));
  const close = [];

  if (withClose && exact.total < CLOSE_WHEN_FEWER_THAN) {
    if (project.budgetMin || project.budgetMax) {
      const s = stretchedBudget(project);
      const wider = await getListings({
        ...base,
        priceMin: s.priceMin ?? undefined,
        priceMax: s.priceMax ?? undefined,
        sort: 'newest',
        limit: closeLimit + seen.size,
      });
      for (const listing of wider.data) {
        if (seen.has(Number(listing.id))) continue;
        const tags = closeMatchTags(listing, project);
        if (!tags.length) continue;
        seen.add(Number(listing.id));
        close.push({ listing, tags });
      }
    }
    if (close.length < closeLimit && base.commune) {
      const extras = await getNearbyExtras(base, [...seen]).catch((err) => {
        console.warn(`[move-matches] nearby unavailable: ${err.message}`);
        return null;
      });
      for (const listing of extras?.listings || []) {
        if (seen.has(Number(listing.id))) continue;
        const tags = closeMatchTags(listing, project, extras.places);
        if (!tags.some((tag) => tag.kind === 'nearby')) continue;
        seen.add(Number(listing.id));
        close.push({ listing, tags });
      }
    }
  }

  return { query, total: exact.total, exact: exact.data, close: close.slice(0, closeLimit) };
}

/** What the live preview sends to the browser for one home — nothing but what its card shows. */
export function previewCard(listing, tags = []) {
  const { amount, period } = formatPriceParts(listing.price, listing.purpose, listing.price_period);
  return {
    id: Number(listing.id),
    href: `/listings/${listing.id}`,
    title: listing.title || null,
    image: listingImages(listing)[0] || null,
    amount,
    period: period || null,
    place: feedLocationLine(listing) || null,
    beds: listing.beds != null ? Number(listing.beds) : null,
    tags,
  };
}
