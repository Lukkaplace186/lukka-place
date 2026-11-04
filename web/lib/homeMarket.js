/**
 * Which price guides the homepage's market section shows (HomeMarketBand,
 * 2026-11-04). Pure, so the choice is tested without a database.
 *
 * Every commune with at least one published guide for 1–4 bedrooms, those
 * with the most compared listings first, up to `max`. A commune with a
 * single bedroom count shows one bar — still a real median. Every figure is
 * a published guide passed through unchanged (same MIN_PRICE_SAMPLE floor as
 * /combien-coute); nothing is averaged, interpolated or filled in.
 *
 * Each row also carries what the guide page itself shows: the middle half of
 * the asking rents (p25–p75) and how many of the compared listings are
 * public on Lukka Place.
 *
 * @param {{commune: string, beds: number, median: number, p25: number, p75: number, listings: number, lukkaListings: number, slug: string}[]} guides
 */
export function marketCommunes(guides, { max = 12, label = (commune) => commune, keep = () => true } = {}) {
  const byCommune = new Map();
  for (const guide of guides || []) {
    if (!(guide.beds >= 1 && guide.beds <= 4)) continue;
    // The homepage keeps Kinshasa only for now (owner, 2026-11-04):
    // HomeMarketBand passes keep = cityOfCommune(c) === 'Kinshasa'.
    if (!keep(guide.commune)) continue;
    const entry = byCommune.get(guide.commune) || { commune: guide.commune, total: 0, rows: [] };
    entry.total += guide.listings;
    entry.rows.push({
      beds: guide.beds,
      median: guide.median,
      p25: guide.p25 ?? null,
      p75: guide.p75 ?? null,
      listings: guide.listings,
      lukkaListings: guide.lukkaListings ?? 0,
      slug: guide.slug,
    });
    byCommune.set(guide.commune, entry);
  }
  return [...byCommune.values()]
    .sort((a, b) => b.total - a.total || a.commune.localeCompare(b.commune, 'fr'))
    .slice(0, max)
    .map((entry) => ({
      commune: entry.commune,
      label: label(entry.commune),
      rows: entry.rows.sort((a, b) => a.beds - b.beds),
    }));
}

/**
 * /listings for a guide's commune and bedroom count — the search the guide
 * page's own button opens (app/(site)/combien-coute/[slug]). /listings
 * filters on a minimum bedroom count only, so the link carries no count.
 */
export function guideSearchHref(commune, beds) {
  return `/listings?transaction_type=location&commune=${encodeURIComponent(commune)}&beds_min=${beds}&lease_term=long`;
}
