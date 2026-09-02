/**
 * Rough compatibility scoring between an open Agent Demand Feed request
 * (a `leads` row — real `price_min`/`price_max`/`bedrooms` columns) and one
 * of the agent's own listings. Real inputs only, no external data, and no
 * fabricated percentage when the lead gives nothing to score against.
 *
 * Mirrors the shape of the engine's own services/propertyMatching.js
 * (budgetScore/bedroomsScore) — that module lives in a separate Express app
 * this Next.js app can't import — simplified to the two signals available
 * here. No freshness component: this scores one static listing against one
 * request, it isn't ranking a result list.
 *
 * Deliberately client-safe (no 'server-only', no DB import): used both by
 * the server-rendered demandes page (to compute a default pitch target) and
 * by AgentOpenLeadCard, a client component, to render the badge.
 */

function budgetScore(price, priceMin, priceMax) {
  const numericPrice = Number(price);
  if (!Number.isFinite(numericPrice)) return null;
  if (priceMin == null && priceMax == null) return null;

  if (priceMax != null && numericPrice > priceMax) {
    const overBy = (numericPrice - priceMax) / priceMax;
    return Math.max(0, 1 - overBy);
  }
  if (priceMin != null && numericPrice < priceMin) {
    // Under budget is a much softer miss than over — a cheaper option is
    // rarely a disqualifier the way an unaffordable one is.
    const underBy = (priceMin - numericPrice) / priceMin;
    return Math.max(0, 1 - underBy * 0.5);
  }
  return 1;
}

function bedroomsScore(beds, wanted) {
  if (wanted == null) return null;
  const numericBeds = Number(beds);
  if (!Number.isFinite(numericBeds)) return null;
  const diff = Math.abs(numericBeds - wanted);
  if (diff === 0) return 1;
  if (diff === 1) return 0.6;
  return 0.2;
}

/**
 * @param {{price?: number|string, beds?: number|string}} listing
 * @param {{price_min?: number|string|null, price_max?: number|string|null, bedrooms?: number|string|null}} lead
 * @returns {number|null} 0-100, or null when the lead gives no real signal
 *   (no budget, no bedroom count) to score against.
 */
export function matchPercent(listing, lead) {
  const priceMin = lead.price_min != null ? Number(lead.price_min) : null;
  const priceMax = lead.price_max != null ? Number(lead.price_max) : null;
  const wantedBeds = lead.bedrooms != null ? Number(lead.bedrooms) : null;

  const budget = budgetScore(listing.price, priceMin, priceMax);
  const bedrooms = bedroomsScore(listing.beds, wantedBeds);

  const parts = [budget, bedrooms].filter((s) => s != null);
  if (parts.length === 0) return null;

  const avg = parts.reduce((sum, s) => sum + s, 0) / parts.length;
  return Math.round(avg * 100);
}

/**
 * The single best-scoring listing for a lead among a set of candidates.
 * @returns {{listing: Object, score: number}|null}
 */
export function bestMatch(listings, lead) {
  let best = null;
  let bestScore = -1;
  for (const listing of listings) {
    const score = matchPercent(listing, lead);
    if (score != null && score > bestScore) {
      bestScore = score;
      best = listing;
    }
  }
  return best ? { listing: best, score: bestScore } : null;
}
