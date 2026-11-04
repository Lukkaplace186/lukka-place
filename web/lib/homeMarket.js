/**
 * Which price guides the homepage's market section shows (HomeMarketBand,
 * 2026-11-04). Pure, so the choice is tested without a database.
 *
 * Up to `max` communes, those with the most compared listings first, keeping
 * only bedroom counts 1–4 and only communes with at least two of them — one
 * bar is not a comparison. Every figure is a published guide passed through
 * unchanged (same MIN_PRICE_SAMPLE floor as /combien-coute); nothing is
 * averaged, interpolated or filled in.
 *
 * @param {{commune: string, beds: number, median: number, listings: number, slug: string}[]} guides
 */
export function marketCommunes(guides, { max = 4, label = (commune) => commune } = {}) {
  const byCommune = new Map();
  for (const guide of guides || []) {
    if (!(guide.beds >= 1 && guide.beds <= 4)) continue;
    const entry = byCommune.get(guide.commune) || { commune: guide.commune, total: 0, rows: [] };
    entry.total += guide.listings;
    entry.rows.push({ beds: guide.beds, median: guide.median, listings: guide.listings, slug: guide.slug });
    byCommune.set(guide.commune, entry);
  }
  return [...byCommune.values()]
    .filter((entry) => entry.rows.length >= 2)
    .sort((a, b) => b.total - a.total)
    .slice(0, max)
    .map((entry) => ({
      commune: entry.commune,
      label: label(entry.commune),
      rows: entry.rows.sort((a, b) => a.beds - b.beds),
    }));
}
