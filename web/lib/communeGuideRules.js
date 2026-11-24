// Rules for the app's commune guide (app/(site)/commune/[slug]/page.js),
// kept pure so they are tested without a database.

/** The room counts the guide shows, in order. */
export const GUIDE_BEDS = [1, 2, 3];

/**
 * The price guide's medians for one commune, 1 to 3 bedrooms, in order.
 * Only rows the price guide itself publishes (it enforces its own minimum
 * sample): a room count with too few listings is simply absent, never
 * estimated from its neighbours.
 */
export function communeGuideMedians(guides, commune) {
  const key = String(commune || '').trim().toLowerCase();
  if (!key || !Array.isArray(guides)) return [];
  return GUIDE_BEDS.map((beds) => guides.find((g) => String(g.commune || '').trim().toLowerCase() === key && Number(g.beds) === beds))
    .filter((g) => g && Number(g.median) > 0)
    .map((g) => ({ beds: Number(g.beds), median: Number(g.median), listings: Number(g.listings || 0), slug: g.slug }));
}

/** The saved search behind "Être prévenu des nouveaux biens à <commune>": every listing there, rent or sale. */
export function communeGuideQuery(commune) {
  const params = new URLSearchParams();
  params.set('commune', String(commune || '').trim());
  return params.toString();
}
