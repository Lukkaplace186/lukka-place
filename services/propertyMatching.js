/**
 * services/propertyMatching.js
 *
 * PropertyMatchingService — turns a customer's requirements (extracted by
 * the conversation engine from natural language) into a ranked shortlist of
 * REAL, approved listings, never random/unranked database records (product
 * spec §10).
 *
 * propertyRepository.searchProperties already enforces the hard filters
 * (commune, price range, minimum bedrooms, property type) at the SQL level;
 * this module adds:
 *   - Soft ranking on top of those hits — closeness to budget, bedroom
 *     match, listing freshness — so the best-fit properties surface first
 *     instead of just newest-first.
 *   - One "widen the search" fallback: a commune-scoped search that comes
 *     back empty is retried city-wide, so a customer asking about a quiet
 *     commune with no live listings gets real nearby alternatives instead
 *     of a dead end.
 *
 * Deliberately does NOT add a distance/geo ranking dimension — this schema
 * has no lat/lng columns, so "distance where relevant" from the product
 * spec is left out rather than faked with invented coordinates.
 */

const propertyRepository = require('./propertyRepository');

const WEIGHTS = { budget: 0.4, bedrooms: 0.3, freshness: 0.3 };

/**
 * 1.0 at or under the requested ceiling (more house for the money is never
 * penalised); decays linearly for every dollar over budget. 0.5 (neutral)
 * when the customer never gave a budget to score against.
 */
function budgetScore(price, priceMax) {
  const numericPrice = Number(price);
  if (!Number.isFinite(numericPrice) || priceMax == null) return 0.5;
  if (numericPrice <= priceMax) return 1;
  const overBy = (numericPrice - priceMax) / priceMax;
  return Math.max(0, 1 - overBy);
}

/** Exact bedroom match scores highest; more rooms than asked is still fine; fewer is a real gap. */
function bedroomsScore(beds, bedsTarget) {
  if (bedsTarget == null) return 0.5;
  const numericBeds = Number(beds);
  if (!Number.isFinite(numericBeds)) return 0.3;
  const target = Number(bedsTarget);
  if (numericBeds === target) return 1;
  return numericBeds > target ? 0.7 : 0.2;
}

/** Newest listings score highest, decaying to 0 over 90 days. */
function freshnessScore(createdAt) {
  if (!createdAt) return 0.3;
  const ageDays = (Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60 * 24);
  return Math.max(0, 1 - ageDays / 90);
}

function scoreListing(listing, requirements = {}) {
  return (
    budgetScore(listing.price, requirements.priceMax) * WEIGHTS.budget +
    bedroomsScore(listing.beds, requirements.bedsMin) * WEIGHTS.bedrooms +
    freshnessScore(listing.created_at) * WEIGHTS.freshness
  );
}

/**
 * @param {Object} requirements Same shape as propertyRepository.searchProperties's criteria.
 * @returns {Promise<{data: Object[], total: number, widened: boolean, error: boolean}>}
 *   `widened` is true when the commune filter had to be dropped to return
 *   any results — callers should say so ("Rien à {commune}, mais voici...")
 *   rather than presenting a widened result set as an exact match.
 */
async function matchProperties(requirements = {}) {
  const strict = await propertyRepository.searchProperties(requirements);

  if (strict.error) {
    return { data: [], total: 0, widened: false, error: true };
  }

  let result = strict;
  let widened = false;

  if (result.total === 0 && requirements.commune) {
    const { commune, quartier, ...cityWide } = requirements;
    const wider = await propertyRepository.searchProperties(cityWide);
    if (!wider.error && wider.total > 0) {
      result = wider;
      widened = true;
    }
  }

  const ranked = result.data
    .map((listing) => ({ listing, score: scoreListing(listing, requirements) }))
    .sort((a, b) => b.score - a.score)
    .map(({ listing }) => listing);

  return { data: ranked, total: result.total, widened, error: false };
}

module.exports = { matchProperties, scoreListing, budgetScore, bedroomsScore, freshnessScore };
